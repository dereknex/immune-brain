# Pattern: Plan Switch State Isolation

**领域**: Agent workflow / state management
**描述**: 当一个 workflow 允许从旧 plan 切换到新 plan 时，必须先隔离旧 plan 的运行态，再用新 plan 的状态做依赖校验，避免旧完成记录误解锁新步骤。

## 场景

- workflow 的 step 依赖来自当前 plan，例如 Step 2 depends on Step 1。
- 运行态里保存了 `completed_steps`，并可能来自上一份 plan。
- 用户或工具可以切换 active plan，甚至通过 `--force` 或协调入口绕过当前 active step 限制。

## 问题信号

如果代码先用旧 `completed_steps` 判断新 plan 的依赖，再清空旧状态，会出现这个错误路径：

1. 旧 plan 已完成 Step 1。
2. 切换到新 plan，并尝试激活新 plan 的 Step 2。
3. 依赖校验看到旧的 Step 1 完成记录，于是放行。
4. 随后系统清空 `completed_steps`，留下一个依赖实际未满足的 active step。

## 方案模板

1. **先识别 plan 边界**: 读取 state 后立即判断 `state.plan_path != requested_plan_path`。
2. **先隔离旧状态**: 对新 plan 清空或重建 `completed_steps`，必要时记录 reset history。
3. **再做依赖校验**: 依赖判断只能使用隔离后的本 plan 状态。
4. **失败不落盘**: 如果依赖不满足，保持旧持久状态不变，避免一次失败激活污染当前迭代。
5. **测试持久状态**: 回归测试除了断言抛错，还要断言 state 文件里的旧 plan、旧 completed steps 和 active step 未被改写。

## 可复用前提

- step 编号只在单个 plan 内有意义，不能跨 plan 复用。
- workflow state 同时保存 plan 标识和 step 完成记录。
- 激活步骤会更新持久化运行态，失败路径需要可审计。

## 验证依据

- code review 发现 `.imm/imm-work.py` 原先在切换 plan reset 之前校验依赖，会让旧 plan 的 Step 1 完成记录解锁新 plan 的 Step 2。
- 修复后 `.imm/imm-work.py` 先执行 `reset_completed_steps_for_new_plan`，再计算 `missing_dependencies`。
- `tests/test_imm_work.py::test_activate_step_rejects_dependent_step_when_switching_plans` 覆盖了旧 plan 已完成 Step 1、新 plan 激活 Step 2 必须失败，并验证持久化 state 未被污染。
- `python3 -m unittest tests/test_imm_work.py` 通过 12 个测试。
- `python3 -m py_compile .imm/imm-work.py` 通过。

## 约束与建议

- 不要把 step number 当成全局 ID；如果要跨 plan 引用，必须引入稳定 plan scope。
- reset history 可以在成功激活路径里记录，但失败路径不要提前保存半成品 state。
- 任何“切换上下文后再校验”的代码都应优先检查校验使用的是旧状态还是新状态。

---
*沉淀日期: 2026-05-07 | 来源: Codex plan sync review blocker 修复*
