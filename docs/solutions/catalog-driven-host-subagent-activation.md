# Pattern: Catalog-Driven Deterministic Subagent Activation Plan

**领域**: Agent workflow / subagent runtime / host-controlled dispatch
**描述**: 在已有共享 dispatch protocol（六阶段生命周期）的前提下，将 Phase 2「触发匹配」从纯模型临场判断，升级为 **machine-readable 触发目录（YAML）+ 纯函数 `activation_plan`（`.imm/activation_plan.py`）** 输出的确定性候选列表；host skill（首版为 `imm-code-review`）在 dispatch 前默认 consult 该计划，再落入既有 advisory、solo fallback 与并行上限约束。

**reusability**: high
**next_reuse_scenarios**: [`imm-code-review Phase 2 需要可回归的触发逻辑`, `扩展第二波 child reviewer 前先在 catalog 声明规则`, `评审希望区分「禁止全局调度器」与「会话内确定性规则表」`, `用 golden unittest 锁住路径/关键词 → child 集合映射`]

## 场景

- Dispatch protocol 已规定 Phase 2，但触发条件仅靠 prose，难以回归测试，也难以证明与安全/api-contract reviewer 的 SKILL 表面一致。
- 系统规格明确 **禁止** 无人值守全局调度器，但需要允许 **会话内、host-bound、确定性** 的规则表。
- 首波 child 仍限于 `security-reviewer` 与 `api-contract-reviewer`，且并行度有上限。

## 方案模板

1. **规格分层**: `.imm/specs/automatic-subagent-activation.spec.md` 定义 R1–R5；与 `workflow-skill-subagent-orchestration`、`system-subagents-design` 对齐—— carve out「catalog + 纯函数计划」不属于被禁止的全局 dispatcher。
2. **Machine-readable catalog**: `docs/reference/subagent-trigger-catalog.yaml` 声明 host、children、路径 glob、关键词、否定规则，并与 policy/spec 交叉引用。
3. **Policy 叙述载荷**: `docs/reference/automatic-subagent-activation-policy.md` 描述结构化输入字段与 `activation_plan` schema（candidates、parallel_allowed、`rationale_codes`、`solo_fallback_reason` 等）。
4. **纯函数核心**: `.imm/activation_plan.py` 的 `build_activation_plan(...)` 只读 catalog、无副作用、无网络、无 Task 调用。
5. **Host 文书**: `skills/imm-code-review/SKILL.md` Phase 2 默认先构建 `activation_plan`，再 dispatch；空集则走既有 solo 路径并记录 reason。
6. **验证**: `tests/test_activation_plan.py` 表格驱动 golden cases；`tests/test_skill_contracts.py` 断言 README / policy / code-review / spec 交叉引用。

## 可复用前提

- 共享 `docs/reference/subagent-dispatch-protocol.md` 仍约束完整生命周期；本模式只强化 Phase 2 的 **确定性输入**。
- Runtime 仍以 Cursor Task / 等价 primitive 为 dispatch 承载，本仓库不提供后台队列。

## 验证依据

- 计划 `docs/plans/2026-05-11-056-feat-automatic-subagent-activation-plan.md` 四步均已执行并通过 QA（历史见 `.imm/memory/current_iteration.json`）：spec carve-out、catalog+policy、`activation_plan`+golden tests、imm-code-review+README+contracts。
- `python3 -m unittest tests.test_activation_plan tests.test_skill_contracts` 作为回归口径（闭环时与合约测试一致）。

## 约束与建议

- 不要把 `activation_plan` 做成 LLM 路由器；首版规格禁止模块内 LLM。
- 第二波 reviewer（如 data-integrity）应通过 **独立计划** 扩展 catalog，避免单次切片混入过多 child。
- 规格 §4 勾选与计划 frontmatter 的 closure 状态可由后续 documentation-only slice 对齐（不影响模块与测试存在性）。

---
*沉淀日期: 2026-05-11 | 来源: feat-automatic-subagent-activation plan U1–U4 + 合约/ golden 测试*
