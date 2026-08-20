> Historical note: pre-TypeScript-migration artifact; file paths reference the retired Python runtime/tests.

# Spec: plan sync enforcement follow-up

**任务 ID**: IMM-PLANSTATE-002
**负责人**: Planner
**状态**: Proposed

## 1. 目标

修复 `plan-state-sync-via-imm-plan` 首轮落地后的 3 个剩余 contract 缺口：

- `imm-plan` 校验通过但 runtime sync 失败时，不能继续返回成功；
- 同一路径 plan 内容变更后，旧的 `completed_steps` / `active_step` 不能被静默保留；
- `imm-work` 不能再作为 plan-level runtime writer 绕过 `imm-plan` 切换计划元信息。

本轮保持原边界，不引入新状态源、不扩展 scheduler、不重写 step lifecycle。

## 2. 问题背景

对 `2026-05-10-034-fix-imm-plan-state-sync-plan` 的跨 step code review 发现：

- `imm-plan` 已开始承担 plan-level sync，但 sync 失败仍只是 warning；
- `plan_signature` 已被写入，但 same-path revalidate 没有据此失效旧 closure；
- `imm-work activate` 仍会直接写 `plan_path` / `plan_summary` 并在切 plan 时重置完成态。

因此，当前实现还没有真正满足“任何 plan 变化都由 `imm-plan` 统一更新”的要求。

## 3. 功能需求

### R1. `imm-plan` sync 失败必须阻断成功返回

- `imm-plan <plan-path> [--json]` 只有在 plan 校验成功且 runtime sync 成功时才返回成功。
- 若 runtime sync 失败，命令必须返回非零退出码，并让调用方显式感知失败。
- 不允许默认吞掉 sync 异常后继续把该次校验当作可执行计划入口。

### R2. same-path plan 变更必须失效旧 closure

- 当 `plan_path` 不变但 `plan_signature` 变化时，runtime state 必须按最小安全原则失效旧 closure。
- 首版至少要处理：
  - 清空 `completed_steps`
  - 清空 `active_step`
  - 记录可追溯 history 事件
- 不要求在本轮实现更细粒度的 step 兼容迁移。

### R3. `imm-work` 不能再写 plan-level 元信息

- `imm-work activate` 只能基于已由 `imm-plan` 同步过的当前 runtime plan 工作。
- 当传入的 `plan_path` 与 runtime 当前计划不一致时，`imm-work` 应拒绝继续，并提示先运行 `imm-plan`。
- `imm-work` 可继续写 step-level 状态，但不能再承担 `plan_path` / `plan_summary` / plan switch reset 的所有权。

### R4. 验证路径

- 验证至少覆盖三条路径：
  - runtime sync 失败时 `imm-plan` 返回非零；
  - same-path plan 内容变更后 revalidate 会失效旧 closure；
  - 未先经过 `imm-plan` sync 的 plan 不能被 `imm-work activate` 直接切入并写入 plan-level state。

## 4. 验收标准

- [ ] `imm-plan` 只有在 runtime sync 成功后才返回成功。
- [ ] same-path plan 内容变更后，旧 `completed_steps` / `active_step` 不再被保留。
- [ ] `imm-work` 不再通过 `activate` 成为 plan-level runtime writer。
- [ ] `codex_plan` / `codex_status` 仍然从 `.imm/memory/current_iteration.json` + active plan 文件构建。
- [ ] 本轮不引入新的 runtime store、registry 或 scheduler。

## 5. 非目标

- 不重构 `imm-executor` / `imm-qa` / `imm-review` 权限边界。
- 不为 same-path 变更设计局部兼容迁移协议。
- 不扩展成通用 plan versioning 平台。

## 6. 依赖项

- [IMMUNE.md](IMMUNE.md)
- [plan-state-sync-via-imm-plan.spec.md](docs/specs/plan-state-sync-via-imm-plan.spec.md)
- [current-iteration-closure-contract.spec.md](docs/specs/current-iteration-closure-contract.spec.md)
- `.imm/imm-plan.py`
- `.imm/imm-work.py`
- `.imm/current_iteration_state.py`
