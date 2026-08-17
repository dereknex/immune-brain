# Spec: composable workflow contract

**任务 ID**: IMM-WORKFLOW-011
**负责人**: Planner
**状态**: Accepted（repo-facing contract 与 focused 测试已落地）

## 1. 目标

把 Immune-Brain 当前仍残留的“强流程 stage chain”表述，收敛成一份统一的组合式
workflow contract：

- 保留 authority、evidence、step lock 等硬边界
- 把 brainstorming、preplan、planning、review、party 等阶段改写为按状态触发的可组合能力
- 保持 `imm-work` 作为 validated plan 之后的默认 continue entry
- 明确哪些能力可以 attach，哪些能力只能在命中 trigger surface 时启用

首版只处理 repo-local contract、文档与 focused verification；不实现 runtime dispatcher、
shared registry、自动 fan-out、跨 agent 调度或新的 workflow state machine。

## 2. 问题背景

仓库曾同时继承两类思路（上游强流程 vs 本仓库的 authority / trigger / opt-in autowork），
易导致「默认过一关又一关」与「按状态组合」两套叙事并存。

**当前**：`IMMUNE.md`、`README.md`、主线 skills 与 `tests/test_skill_contracts.py` 已收口为组合式
contract；扩展 skill 目录与 Subagent 矩阵迁至 `docs/reference/workflow-and-subagents.md`，
与 README 合并后仍作为同一用户文档表面接受契约回归。**残余风险**是后续编辑时重新引入
ceremony 用语，需靠 spec + 测试继续防漂移。

## 3. 功能需求

### R1. Hard-boundary preservation

- 组合式 contract 必须保留以下硬约束，不得弱化：
  - advisory roles 不能写 plan、改代码或关闭 QA
  - execution roles 不能越过当前 active step
  - plan scope drift 必须返回 `imm-planner`
  - QA closure 必须依赖可验证 evidence
  - `imm-autowork` 仍然只允许 explicit opt-in
- “组合模式”不得被解释为 authority merge、skip QA 或无 spec 执行。

### R2. Trigger-based composition

- 以下能力必须被定义为“按状态触发”，而不是默认显式关卡：
  - `imm-brainstorm`
  - `imm-preplan-review`
  - `imm-planner`
  - `imm-party`
  - `imm-code-review`
  - `security-reviewer`
  - `api-contract-reviewer`
- 触发原则：
  - `imm-brainstorm`: 需求仍含关键歧义、约束未收敛、成功标准不清
  - `imm-preplan-review`: scope 不稳、验证路径不清、或存在明显跨角色分歧
  - `imm-planner`: 尚无可执行 validated plan，或 scope 变化需要重写 spec/plan
  - `imm-party`: 用户显式要求 multi-role advisory，或复杂取舍需要只读会诊
  - `imm-code-review`: 需要 broad technical review、review follow-up 或 CI-style blocker triage
  - `security-reviewer` / `api-contract-reviewer`: 仅在对应 trigger surface 被明确命中时加入
- 未命中 trigger 时，contract 必须允许 workflow 保持更短主链，而不是补 ceremony。

### R3. Mainline contract

- 默认主链必须被收敛为：
  - framing needed -> `imm-brainstorm`
  - scope gate needed -> `imm-preplan-review`
  - plan/spec needed -> `imm-planner`
  - current-step continuation -> `imm-work`
  - edit/closure semantics -> `imm-executor` / `imm-qa`
  - closure/learning -> `imm-compounder` / `imm-finish`
- 这里的箭头表示状态驱动的推荐 entry，不表示每次都必须显式经过所有前置 skill。
- `imm-work` 必须继续作为 validated plan 之后的默认 continue entry。
- `imm-executor` 与 `imm-qa` 必须继续保持 authority role，而不是默认对外 shell entry。

### R4. Attachable advisory layers

- `imm-party`、`imm-code-review`、`security-reviewer`、`api-contract-reviewer`
  必须被收敛为 attachable、bounded、non-default layers。
- 这些 layers：
  - 可以补 research、risk、findings、scope pressure
  - 不可以替代 planner 的 scope decision
  - 不可以替代 executor 的实现 authority
  - 不可以替代 QA 的 closure authority
- `imm-party` 只能作为只读 advisory roundtable；
  reviewer skills 只能作为 advisory evidence layer。

### R5. Composition stop conditions

- 组合式 contract 必须明确以下 stop conditions：
  - no validated plan -> route `imm-planner`
  - no executable active step -> route `imm-work` activation / planner as needed
  - evidence missing -> do not close through QA
  - scope drift / dependency mismatch -> return `imm-planner`
  - unresolved reviewer conflict -> return `imm-preplan-review` or `imm-planner`
  - user requests full multi-step advance -> only through explicit `imm-autowork`
- 同轮编排允许 current-step same-turn continuation；
  不允许因为组合模式成立，就默认自动执行下一个未激活 step。

### R6. Source-of-truth propagation

- 组合式 contract 必须在以下 repo-facing artifacts 保持一致：
  - `IMMUNE.md`
  - `README.md`
  - `docs/reference/workflow-and-subagents.md`（与 README 合并视为同一文档表面）
  - `skills/imm-brainstorm/SKILL.md`
  - `skills/imm-preplan-review/SKILL.md`
  - `skills/imm-planner/SKILL.md`
  - `skills/imm-work/SKILL.md`
  - `skills/imm-party/SKILL.md`
  - `skills/imm-code-review/SKILL.md`
  - `imm-advisory-reviewer` `security` lens
  - `imm-advisory-reviewer` `api_contract` lens
- 若某条 truth 只存在于 solution 文档或旧 spec，而 repo-facing contract 没同步，
  视为未完成。

### R7. Verification path

- 首版必须至少能验证：
  - repo-facing contract 明确区分硬边界与软阶段
  - `imm-preplan-review` 仍是 conditional，不是 ceremony
  - `imm-work` 仍是 post-plan default continue entry
  - advisory/reviewer layers 保持 attachable、bounded、non-default
  - `imm-autowork` 仍是 explicit opt-in
- 若本地不能 truthfully 验证 runtime behavior，plan 必须保留 focused contract test
  或 manual inspection path，而不是假装实现了新的 runtime orchestration。
- `tests/test_skill_contracts.py` 中的 composable / attachable / README 表面断言即本 spec 的
  focused verification（不含未实现的 runtime dispatcher）。

## 4. 验收标准

- [x] 仓库存在一份明确的组合式 workflow contract spec。
- [x] contract 清楚区分“硬边界必须保留”和“软阶段按状态触发”。
- [x] `imm-work` 的默认 continue entry 语义未退化。
- [x] `imm-party` 与 reviewer skills 被明确描述为 attachable、bounded、non-default。
- [x] `imm-autowork` 仍保持显式 opt-in，不被回灌成默认 continue 行为。
- [x] focused verification（`tests/test_skill_contracts.py`）能证明上述 truth 已同步到 repo-facing artifacts（含 `docs/reference/workflow-and-subagents.md`）。

## 5. 非目标

- 不实现新的 runtime dispatcher、agent registry、shared orchestration engine。
- 不新增后台常驻任务、跨 agent 通信、multi-reviewer automatic fan-out。
- 不改变 `imm-executor`、`imm-qa`、`imm-compounder` 的 authority class。
- 不在本切片中扩展 `.imm` runtime state schema。
- 不把组合式 contract 扩成完整执行引擎改造。

## 6. 依赖项

- 依赖 [IMMUNE.md](IMMUNE.md)
  的 authority boundary truth。
- 依赖 [README.md](README.md)
  与 [workflow-and-subagents.md](docs/reference/workflow-and-subagents.md)
  的 repo-facing workflow guidance（契约测试合并二者）。
- 依赖 [single-step-orchestration-entry.md](docs/solutions/single-step-orchestration-entry.md)
  的 same-turn current-step driver contract。
- 依赖 [opt-in-bounded-autowork-entry.md](docs/solutions/opt-in-bounded-autowork-entry.md)
  的 autowork opt-in boundary。
- 依赖 [read-only-advisory-roundtable-layer.md](docs/solutions/advisory-roundtable-layer.md)
  的 advisory-only party layer pattern。
- 依赖 [workflow-skill-orchestration-contract.md](docs/solutions/workflow-skill-orchestration-contract.md)
  的 orchestration truth，但本 spec 的目标不是继续扩大 subagent orchestration，而是把主流程 contract 改写为 composable shape。
