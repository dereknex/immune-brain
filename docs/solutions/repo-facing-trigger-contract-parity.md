> Note: retired Python file paths appear as inline code and refer to the pre-TypeScript-migration runtime.

# Pattern: Repo-facing Trigger Contract Parity

**领域**: Agent workflow / repo-facing contract consistency
**描述**: 当一个 workflow gate 被定义为 trigger-only 语义时，不能只在 skill contract 里收紧规则；README 和其他 repo-facing 入口文案也必须表达同一条路由语义，并且 focused regression 要直接读取这些 repo-facing 文本，而不只是检查 skill snippet 是否存在。

**reusability**: high
**next_reuse_scenarios**: [`某个 workflow gate 从默认阶段收敛为条件触发 gate`, `README 与 skill contract 同时承担入口说明, 但现有测试只检查 skill 文本`, `review 暴露的矛盾来自 repo-facing 文案仍沿用旧默认流程`]

## 场景

- 某个 role 或 gate 的路由规则已经在 skill contract 中更新，例如从“默认阶段”改为“条件触发”。
- README、快速上手说明或其他 repo-facing 文案仍保留旧入口叙述。
- focused tests 只验证 skill snippet 存在，无法发现 README 与 skill 之间的语义冲突。
- code review 因而在实现完成后才暴露“同仓库两套入口规则并存”的问题。

## 方案模板

1. **先确定唯一触发语义**: 明确 gate 到底是默认阶段还是 trigger-only 风险 gate，不允许 README 和 skill 各说各话。
2. **同步 repo-facing 文案**: 把 README、上手卡片、流程顺序说明等面对用户的入口文本一起对齐到同一条路由语义。
3. **让测试读到 repo-facing surface**: focused regression 不只读取 skill contract，还要直接读取 `README.md` 或等价入口文档，防止“skill 对了、入口错了”。
4. **验证冲突被真正消除**: 同时检查 README 文案、skill contract 文案和 focused tests，证明新规则已经覆盖 repo-facing surface，而不是只在内部 contract 自洽。

## 可复用前提

- 仓库同时依赖 skill contract 和 README 这类 repo-facing 文本来说明 workflow 入口。
- 变更的核心是路由语义收紧，而不是 runtime state machine 改造。
- 本轮目标是修复 contract parity，不是扩展成完整文档生成或多层规则引擎。

## 验证依据

- `workflow friction reduction` 首轮计划把 `imm-preplan-review` 收紧为 trigger-only gate，但 [README.md](README.md) 仍保留“轻量 bugfix / hotfix 应先经过 `imm-preplan-review`”的旧路由文案，导致 repo-facing 语义冲突。
- follow-up 计划 [2026-05-09-016-fix-workflow-friction-review-followup-plan.md](docs/plans/2026-05-09-016-fix-workflow-friction-review-followup-plan.md) 的 Step 1 把 README 热修为：只有当 scope 不稳、验证路径不清或存在明显跨角色分歧时，才显式进入 `imm-preplan-review`；否则可直接进入 `imm-planner`。
- `tests/test_skill_contracts.py` 这次不再只检查 `skills/imm-preplan-review/SKILL.md`，而是新增直接读取 `README.md` 的断言，确保 repo-facing surface 与 skill contract 一起被 regression 守住。
- `python3 -m unittest tests.test_skill_contracts` 通过，说明这条 parity 修复已经从“review 发现的问题”变成“本地可回归的契约”。

## 约束与建议

- 不要把“skill contract 已对齐”误认为“用户入口已经对齐”；如果 README 仍在说旧流程，真实体验仍然会漂移。
- 不要只补 README，不补 focused tests；否则下次修改 skill 或流程说明时还会再次分叉。
- 这类问题优先用 docs-first repair 闭环；只有当 README/skill 无法表达同一条规则时，才回到 planner 讨论 runtime 语义是否本身不清楚。

---
*沉淀日期: 2026-05-09 | 来源: workflow friction review follow-up Step 1 闭环*
