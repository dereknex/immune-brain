---
title: Workflow patterns
reusability: high
next_reuse_scenarios:
  - documenting user-facing Immune-Brain entrypoints
  - reducing workflow ceremony without weakening role boundaries
  - explaining how lightweight aliases map to existing skills
  - reopening a passed review gate for a signature-bound same-boundary finding
  - isolating persisted review evidence when a State Ledger switches Plans
key_files:
  - plugins/immune-brain/runtime/immune_brain_runtime.ts
  - plugins/immune-brain/runtime/imm_core.ts
  - plugins/immune-brain/runtime/advisory_dispatch.ts
  - docs/reference/subagent-dispatch-protocol.md
  - docs/reference/immune-brain-config.md
  - tests/advisory-dispatch-core.test.ts
  - tests/planner-ensemble-contract.test.ts
  - tests/immune-brain-config-runtime.test.ts
  - tests/activation-config-runtime.test.ts
  - plugins/immune-brain/dist/imm-loop.md
  - plugins/immune-brain/bin/imm-autowork
  - plugins/immune-brain/dist/imm-work.md
  - docs/reference/subagent-dispatch-protocol.md
  - plugins/immune-brain/dist/registry.yaml
  - plugins/immune-brain/skills/registry.yaml
  - plugins/immune-brain/.opencode-plugin/index.ts
  - tests/imm-autowork-continuation-runtime.test.ts
  - tests/imm-loop-review-orchestration-contract.test.ts
  - tests/imm-loop-completion-gate.test.ts
  - tests/activation-plan-runtime-surface.test.ts
  - tests/plugin-package-runtime.test.ts
  - plugins/immune-brain/runtime/state_ledger.ts
  - tests/cross-plan-sync-reset.test.ts
  - tests/imm-follow-up-runtime.test.ts
  - plugins/immune-brain/dist/imm-code-review.md
  - plugins/immune-brain/dist/imm-ui-review.md
  - docs/specs/subagent-auto-token-budget.spec.md
  - docs/plans/2026-07-29-003-feat-subagent-auto-token-budget-plan.md
  - tests/roadmap-plan-transition-runtime.test.ts
  - plugins/immune-brain/runtime/loop_contract.ts
---

> Note: retired Python file paths appear as inline code and refer to the pre-TypeScript-migration runtime.

# Workflow patterns

## L2S-WF: Lightweight 2-Step Workflow

Use L2S-WF when users need a simpler installable Skill surface but the work
still requires Immune-Brain's planning, execution, review, QA, and learning
safeguards. It reduces conversation ceremony without merging role authority.

### `imm-planner`: What and how

`imm-planner` clarifies intent when ambiguity changes the outcome, records the
behavioral Spec, produces independently verifiable Steps, validates the Plan,
and syncs the State Ledger. Material ambiguity routes to `imm-brainstorm`.
Planning exits only when a validated Plan exists and no implementation edits
have been made.

### `imm-loop`: Do and check

`imm-loop` starts from a validated Plan or accepted same-boundary follow-up. In
the current host conversation it consumes `imm-autowork` checkpoints, executes
one active Step at a time, records evidence, obtains independent QA, runs the
runtime-required review gate, and returns review follow-up through `imm-work`.
When every Step closes, it reports the explicit `imm-compounder` handoff.

### Guards

- State continuity lives in `.imm/memory/current_iteration.json`; `HANDOFF.md` is a human-readable convenience summary.
- Planner owns scope, Executor owns implementation, QA owns Step closure, reviewer owns findings, and Compounder owns Learning extraction.
- `imm-loop` cannot replace planning or skip Step activation, execution evidence, QA, or a required review gate.
- L2S-WF adds no shell alias, parallel execution system, or alternate workflow state.
- Use `imm-brainstorm` first when material questions remain; use ordinary `imm-work` when manually continuing an already active Step.

Evidence basis:

- `IMMUNE.md`
- `docs/specs/l2s-workflow-pattern.spec.md`
- `docs/plans/2026-05-15-009-feat-l2s-workflow-pattern-plan.md`
- `docs/patterns/l2s-workflow.md` (stable compatibility pointer)

## Compaction-safe session handoff (pro-workflow slice)

When context compaction is imminent, dual-write continuity instead of relying on
conversation memory alone:

- `imm-work` populates **Compaction Handoff** in `HANDOFF.md` (plan, active Step,
  up to five priority files, uncommitted summary, session decisions, next boundary).
- `imm-dehydrate --logic-state <json>` mirrors the same fields under
  `logic_state.compaction_handoff` in `.imm/memory/state.json` for `--rehydrate`.

Host-specific rituals (Codex, Claude Code, Cursor) live in
`docs/reference/compaction-handoff-hosts.md`. Upstream borrow tiers live in
`docs/reference/upstream-pro-workflow-borrow-map.md`. Full pattern:
`docs/solutions/pro-workflow-compaction-handoff-integration.md`.

## Pattern: Match-Strength-Ordered Activation Under Parallel Caps

**领域**: Agent workflow / subagent dispatch / regression safety
**描述**: 当同一文件触发多个 reviewer 时，`max_parallel_children` 只是资源上限，不是优先级规则。应先按触发强度筛选（`keyword` > `specific_path` > `generic_path`），再按 host 固定顺序截断，防止显式关键字审查（如可用性/视觉）因通用路径信号被误挤掉。

**reusability**: high
**next_reuse_scenarios**:

- 同时命中 locale 与 component 路径时保留关键关键字镜头
- 新增子镜头（lens）时补齐关键字和路径触发的独立回归
- 重构 activation_plan 的并发上限时保持裁剪可解释性
- 需要同步主/插件 runtime 镜像且避免旧 host 顺序漂移

## 方案模板

1. 在 activation_plan 中为每个子镜头计算匹配原因，并定义可复用枚举等级（如 `keyword`、`specific_path`、`generic_path`）。
2. `max_parallel_children` 生效前先做匹配原因排序，再做 host 顺序排序，再截断。
3. policy 文档明确：并行上限按“强度+顺序”选择，而非“先出现先保留”。
4. `tests/test_activation_plan.py` 与 `tests/test_skill_contracts.py` 同步锁定顺序变化和 policy 描述。
5. 主/插件 dist 运行时与文档同步更新，避免 runtime 与契约文档的行为描述不一致。

## 收益

- 防止显式关键字触发在多匹配场景下被无视。
- 保留用户预期中的 domain-specific reviewer（例如 `ux_heuristic`、`ui_visual`）。
- 降低并行上限带来的调度漂移风险，便于后续审计。

## 沉淀日期: 2026-05-23 | 来源: 2026-05-23 feat-ui-i18n-review-lens follow-up

## Pattern: Runtime Host Owns Autowork Continuation

**status**: superseded
**superseded_by**: `#pattern-update-main-context-loop-with-isolated-authorities`
**retired_at**: 2026-07-12
**reason**: The executable Pi child runner proved less observable and lost the parent conversation context; the replacement keeps deterministic checkpoints but moves orchestration into the current host conversation.

**领域**: Agent workflow / autowork runtime / authority boundaries
**描述**: 当一个 skill 需要自动推进 `activate -> executor -> qa` 这类多阶段工作流时，不要只依赖 skill prose 告诉 host “应该继续”。更稳的做法是给该 skill 一个真实 runtime host，让它消费机器可读状态、进入 QA authority phase、记录 run accounting，并在 rework / replan / malformed follow-up 等硬停点退出。

**reusability**: high
**next_reuse_scenarios**:

- 将 prose-only 自动化入口升级为可回归 runtime surface
- 需要 same-run 跨越 QA 边界但不能伪造 QA 结论
- completed Plan 后仍要消费 bounded reviewer follow-up
- 防止自动化入口滑向 shared registry、generic dispatcher 或后台队列

### 方案模板

1. Runtime host 只负责 orchestration，不实现 executor 或 QA authority；执行证据仍通过 `imm-work record-execution`，闭合仍通过 `imm-review` / `imm-qa`。
2. `imm-work status --json` 暴露 `next_action`、`codex_status.can_auto_advance`、`recommended_entry`，autowork host 只消费这些结构化信号。
3. 当 `next_action.action == "qa"` 且 `can_auto_advance == true` 时，host 必须把 QA 视为同轮 authority phase，而不是权限边界 blocker。
4. `needs_rework`、`replan_required`、malformed follow-up、无 validated plan、预算耗尽等必须成为显式 stop reason，不能被 execution queue 或自动循环覆盖。
5. completed Plan plus bounded `pending_follow_up` 是独立执行目标：保留 `scope`、`change_goal`、`verification_hint`、`origin_review`，通过 executor 和 QA 后才能移交 compounder。
6. 在主 runtime 与 plugin dist runtime 同步暴露 surface，并用 MCP / CLI / skill contract tests 锁住 single-host-only 边界。

### Evidence

- `.imm/imm-autowork.py` 新增 bounded autowork runtime host，输出 `active_plan_path`、`steps_completed_in_run`、`follow_up_completed_in_run`、`stop_reason`、`next_recommended_skill`。
- `.imm/imm-work.py` 与 `.imm/imm-review.py` 支持 `pending_follow_up` 作为轻量执行目标，但不把它写回 Plan。
- `plugins/immune-brain/dist/immune_brain_runtime.py` 暴露 `imm_autowork` MCP tool，`plugins/immune-brain/bin/imm-autowork` 提供 thin wrapper。
- `tests/test_imm_autowork.py` 覆盖 same-run QA、QA pass 后解锁下一 Step、rework/replan/budget stop、completed Plan follow-up、malformed follow-up。
- `python3 -m unittest tests.test_imm_autowork tests.test_workflow_loop tests.test_imm_work tests.test_imm_review tests.test_immune_brain_mcp_runtime tests.test_skill_contracts` 通过 251 tests。

### reusability_critique_notes

- Falsifiability: 如果未来 host 不需要跨越 QA boundary，或 workflow 没有机器可读 `next_action` / `can_auto_advance`，这个 pattern 就不应套用。
- Evidence trail: 证据来自 runtime host、MCP exposure、follow-up state path、focused regression 和一次 solo code review；不是 provider-level background scheduler 证明。
- Entropy resistance: 该 learning 追加到 workflow hub，因为它是自动推进边界模式，不是新的平台架构；同时明确排除 shared registry / generic dispatcher，避免重复扩张旧 `Shared Runtime Host Before Subagent Platform`。

## 沉淀日期: 2026-05-25 | 来源: autowork runtime host U1-U3 + code review

## Pattern: Autowork Runtime as Deterministic Checkpoint

**领域**: Agent workflow / autowork runtime / authority boundaries
**描述**: 当现有 `imm-autowork` 入口想支持 `activate -> executor -> qa` 连续推进时，先固定一条边界：runtime 保持 deterministic checkpoint，只消费状态和输入队列，返回可恢复的边界信号；同一 `imm-autowork` 技能内的 host loop 负责执行 `imm-executor` / `imm-qa` / `imm-review` 的实际 authority。

**reusability**: high
**next_reuse_scenarios**:

- 现有 automation entry 的行为是“状态机 + 外层 Host”，不该再加新入口。
- 需要把普通缺失 `execution_queue` / `qa_queue` 的停顿从 `blocked` 区分为明确边界。
- 希望同一技能内保留 authority split，不把验证结果当作 QA 结论。

### 方案模板

1. `imm-autowork.py` 仅返回机器可读的 `stop_reason` 和最小 handoff 上下文（`active_step`、`required_input`、`recommended_authority`、`verification_requirement`、`execution_evidence`）。
2. 外层 host loop 只在以下 stop reason 上继续推进：`awaiting_execution_input` -> 调用 `imm-executor` 语义并 `record-execution`；`awaiting_qa_decision` -> 调用 `imm-qa` 语义并 `imm-review pass|rework|replan`。
3. 对 `rework_needed`、`replan_needed`、`finished`、`budget_reached`、schema/状态异常保留显式停止，不越权继续。
4. 任何新建默认 QA pass 或新 driver skill 的方向不写入代码，优先先更新技能约定与调用规范，再考虑 scope 划分重构。
5. 需要 `rework_needed` / `replan_needed` / `finished` 等硬边界时，停止同轮循环，交还给 host 进行后续路由。

### Evidence

- `docs/specs/autowork-skill-driver-simplification.spec.md` 明确要求 checkpoint/runtime 与 host loop 分离。
- `docs/plans/2026-05-27-001-fix-autowork-skill-driver-simplification-plan.md`：`U1` 交付 `awaiting_execution_input` 与 `awaiting_qa_decision`。
- `tests/test_imm_autowork.py` 覆盖未准备 execution/qa packet 的边界断言、snapshot handoff 字段和既有 stop 原语。
- `tests/test_skill_contracts.py` 锁定 `imm-autowork` 合约边界与 `imm-autowork-driver`/默认 QA pass 的拒绝条款。
- `plugins/immune-brain/dist/imm-autowork.md` 更新为同一入口、single host loop 的 checkpoint contract。
- `python3 -m unittest tests.test_imm_autowork tests.test_skill_contracts` 通过（含新 stop reason 与 snapshot 合规覆盖）。

### reusability_critique_notes

- Falsifiability: 如果未来需要一个真正的后台编排器，或 host loop 需要跨越更多 role 阶段，这个模式应先通过 planner 与契约重拆。
- Evidence trail: 证据来自 runtime schema contract、plan/spec 对齐、focused regression 和既有 code review，而非外部系统调度。
- Entropy resistance: 追加到 workflow hub 而不是新建 architecture 模式，避免把单点边界修复误解为平台级 orchestrator 扩展。

## 沉淀日期: 2026-05-27 | 来源: docs/specs/autowork-skill-driver-simplification.spec.md + step U1

## Pattern: Run Completion Loop as Review-Follow-up Outer Coordinator

**领域**: Agent workflow / review follow-up loops / skill authority boundaries
**描述**: 当用户想把 `imm-work` / `imm-autowork` 后的多轮 code review 或 UI review 修复自动化时，不要新增 post-planner Skill、generic dispatcher 或后台 scheduler。更稳的做法是让现有 `run` 成为 validated Plan 之后的 outer completion loop：推进 `imm-autowork`，按变更面进入 code/UI review，把 same-boundary `follow_up` 回流给 `imm-autowork`，然后重复对应 review gate，直到 review closure、blocker、replan 或 budget stop。

**reusability**: high
**next_reuse_scenarios**:

- 需要自动化 reviewer follow-up repair，但不想引入第二执行入口。
- validated Plan 已闭合主体工作，但 review 仍产生 same-boundary `follow_up`。
- 一个 workflow alias 需要组合 execution、review、follow-up 和 compound handoff。
- review host 需要显式 subagent activation intent，但实际 dispatch 仍要受 gate 控制。

### 方案模板

1. `run` 只做 outer coordinator：不实现代码、不改 Plan、不下 QA `pass`，也不替代 `imm-autowork`。
2. material code / behavior / contract / runtime / test changes 进入 `imm-code-review`；UI / visual / interaction / accessibility / responsive layout / design-contract changes 进入 `imm-ui-review`。
3. review gate 调用时传递 `explicit subagent activation intent`；实际 bounded subagents 仍由 trigger / activation plan、authorization、environment 和 cost gates 决定，不能承诺 `must dispatch` 或 `always dispatch`。
4. reviewer 产出的 same-boundary `follow_up` 交回 `imm-autowork`，由底层 `imm-work` / Executor / QA 闭合；cross-boundary finding 停止并路由 `imm-planner`。
5. `run_status` 暴露 active Plan、autowork progress、review status、follow-up status、budget state、stop reason 和 next recommended entry，保持可恢复但不成为新的 State Ledger authority。
6. 只有 Plan work、required review gates 和 same-boundary follow-up 都 after review closure 后闭合，才 hand off 到 `imm-compounder`。

### Evidence

- [docs/specs/run-completion-loop.spec.md](docs/specs/run-completion-loop.spec.md) 定义 `imm-loop` 的 outer completion loop、review selection、same-boundary follow-up、stop conditions、run_status 和 no new driver boundary。
- [plugins/immune-brain/dist/imm-loop.md](plugins/immune-brain/dist/imm-loop.md) 记录 Run Completion Loop、code/UI review gates、explicit subagent activation intent、environment/cost/authorization gates 和 compounder handoff only after review closure。
- [README.md](README.md) 在用户入口和推荐 workflow 中记录同一合同。
- `tests/test_skill_contracts.py` 锁定 skill contract、README/workflow docs、Spec 三处合同表面，并防止 `must dispatch` / `always dispatch` 语义。
- `python3 -m unittest tests.test_skill_contracts.SkillContractTests.test_run_completion_loop_contract_is_documented tests.test_skill_contracts.SkillContractTests.test_run_completion_loop_rejects_new_driver_and_default_pass tests.test_skill_contracts.SkillContractTests.test_run_completion_loop_status_contract` 通过。
- `python3 .imm/imm-plan.py docs/plans/2026-06-25-001-feat-run-completion-loop-plan.md --json` 通过。
- 两轮 `imm-code-review` 显式启用 bounded subagents；advisory `api_contract` findings 修复了 Spec coverage drift 和 environment gate drift。

### reusability_critique_notes

- Falsifiability: 如果未来需要跨会话后台执行、真正的 scheduler，或 reviewer follow-up 不再能由 `imm-autowork` 消费，本模式应升级为新的 runtime Plan，而不是继续扩大 `run` 的 prose contract。
- Evidence trail: 证据来自 Spec、Plan、skill contract、README、focused tests、plan validator 和两轮 code review/subagent findings；没有新增 State Ledger schema 或 host runtime wrapper。
- Architecture entropy resistance: 追加到 workflow hub，因为这是现有 workflow alias 的 outer-loop 编排模式；它明确复用 `imm-autowork`、review hosts 和 QA authority，避免引入被拒绝的 `imm-autowork-driver`、generic dispatcher 或 background scheduler。

## 沉淀日期: 2026-06-25 | 来源: run review closure runtime gate + plan 2026-06-25-003

## Pattern update: Run Completion Loop — executable review-required runtime gate

**领域**: Agent workflow / autowork completion boundaries / review follow-up loops
**描述**: 当 `imm-loop` 的 outer completion loop 已经在 contract 层承诺 code/UI review，但用户仍能在 `imm-run` 结束后手动跑 review 并发现问题时，不要把问题当成“文档没写清楚”。更稳的最小切片是在 `imm-autowork` 快照里派生 `stop_reason: review_required`，用当前 run 的 `changed_files` 决定 `imm-code-review` / `imm-ui-review`，并在 same-boundary `follow_up` 闭合后再次挡住 `imm-compounder` handoff，而不是新增 driver、scheduler 或 State Ledger schema。

**reusability**: high
**next_reuse_scenarios**:

- contract-only workflow promise 已落地，但 machine-readable boundary 仍会过早 `finished` / `follow_up_complete`。
- 需要多轮 `review -> follow_up -> imm-work -> review` 而不丢失 pending review gate。
- 想在 runtime 暴露 `required_review_gates`、`review_changed_files`、round state，但 review pass/fail 仍留在 advisory host。

### 方案模板

1. 在 `imm-autowork` completion boundary 上，从当前 run 的 `execution_evidence.changed_files` 派生 review gate；不要为 review pass 状态新增 State Ledger 字段。
2. material code / behavior / contract / runtime / test changes 推荐 `imm-code-review`；UI / visual / interaction / accessibility / responsive layout / design-contract paths 推荐 `imm-ui-review`；混合变更通过 `required_review_gates` 暴露顺序。
3. 当 gate 存在时，返回 `stop_reason: review_required`、`review_status: required`、`pending_review_gate`、`review_changed_files` 和 `next_recommended_skill`；不要标记 review 已通过，也不要在 runtime 内执行 advisory review。
4. same-boundary `follow_up` 闭合后，如果 repair 仍带 material/UI changed files，必须再次停在 review gate，而不是直接 hand off `imm-compounder`。
5. `imm-loop` contract / registry 只暴露这条 executable gate 和 reviewer routes；实际 subagent dispatch 仍受 activation plan、authorization、environment 和 cost gates 控制。
6. 保持 additive rollback：回滚 `.imm/imm-autowork.py`、packaged copy、focused tests、`imm-loop.md` / registry wording 即可，不需要 migration。

### Evidence

- [docs/specs/run-review-closure-runtime-gate.spec.md](docs/specs/run-review-closure-runtime-gate.spec.md) 定义 material/UI review gate、multi-round follow-up resurfacing、budget visibility 和 no authority expansion。
- `.imm/imm-autowork.py` 通过 `_review_gates_for_changed_files` 和 `_build_snapshot(..., stop_reason="review_required")` 在 completion boundary 上派生 gate。
- [plugins/immune-brain/dist/imm-loop.md](plugins/immune-brain/dist/imm-loop.md) 与 [plugins/immune-brain/dist/registry.yaml](plugins/immune-brain/dist/registry.yaml) 暴露 executable review gate 与 `imm-code-review` / `imm-ui-review` routes。
- `python3 -m unittest tests.test_imm_autowork.ImmAutoworkTests.test_completed_material_run_requires_code_review_gate tests.test_imm_autowork.ImmAutoworkTests.test_completed_ui_run_requires_ui_review_gate tests.test_imm_autowork.ImmAutoworkTests.test_follow_up_completion_requires_review_before_compounder tests.test_imm_autowork.ImmAutoworkTests.test_multi_round_follow_up_resurfaces_review_gate tests.test_skill_contracts.SkillContractTests.test_run_runtime_review_gate_contract tests.test_skill_contracts.SkillContractTests.test_run_registry_includes_review_gate_routes tests.test_immune_brain_plugin_package.PluginPackageTest.test_packaged_runtime_matches_repo_runtime_sources` 通过。
- `python3 .imm/imm-plan.py docs/plans/2026-06-25-003-feat-run-review-closure-runtime-gate-plan.md --json` 通过。
- `current_iteration_state.dehydrate_closed_steps` 在本轮 closure 前返回 `0`（closed steps 无 `child_evidence` / `focus_delta` 需要脱水）。

### reusability_critique_notes

- Falsifiability: 如果未来需要跨会话 durable review-pass ledger、autonomous reviewer execution，或 review gate 不能再从单次 run 的 changed files 派生，应新开 runtime Plan，而不是继续堆 optional snapshot 字段。
- Evidence trail: 证据来自 Spec、Plan、autowork runtime、run contract/registry、focused autowork + contract + package parity tests；没有新增 State Ledger schema。
- Architecture entropy resistance: 作为 Run Completion Loop 的 pattern update 追加到 workflow hub，明确这是对 contract-only slice 的最小 executable promotion，而不是新的 orchestrator 平台。

## 沉淀日期: 2026-06-25 | 来源: run completion loop contract + code review follow-up closure

## Pattern: Agent-local Immune-Brain roots prevent cross-host config bleed

**领域**: Agent workflow / local runtime config / host isolation
**描述**: 当同一个 Immune-Brain plugin 被 Pi、Codex、Cursor、Claude Code、OpenCode 等不同 coding agent 共享时，不要把 config、dev-insights、cache 或 diagnostics 放进一个全局 `~/.immune-brain/` 目录。更稳的做法是先解析当前 coding agent 的 native local root（如 `~/.pi/agent/immune-brain/`、`~/.codex/immune-brain/`、`~/.cursor/immune-brain/`），再只读取该 root 下的 `config.toml` 和本地运行文件。旧全局目录只能作为显式单文件兼容桥，不能默认 fallback，也不能自动复制到所有 agent。

**reusability**: high
**next_reuse_scenarios**:

- 一个 plugin 同时支持多个 coding agent，且各 host 的模型 ID、授权方式或成本偏好不同。
- 本地 runtime 需要读取 dev-insights/cache/diagnostics，但这些状态不应跨 host 共享。
- 迁移旧全局配置目录时，需要避免把同一份历史状态 fan-out 到所有 host。
- CLI flags 需要覆盖文件配置，同时 missing config 仍保持 zero-config 行为。

### 方案模板

1. 暴露一个最小 root resolver：`--coding-agent` / `IMMUNE_BRAIN_CODING_AGENT` 选择 root；未显式选择 agent 时不要猜默认 Pi/Codex，否则会产生 host bleed。
2. 每个 agent 的默认 root 放在对应 host native directory：Pi `~/.pi/agent/immune-brain/`、Codex `~/.codex/immune-brain/`、Cursor `~/.cursor/immune-brain/`、Claude Code `~/.claude/immune-brain/`、OpenCode `~/.config/opencode/immune-brain/`。
3. `IMMUNE_BRAIN_CONFIG` / `IMMUNE_BRAIN_AGENT_CONFIG` 只作为显式文件路径覆盖；它们不是新的全局默认。
4. 旧 `~/.immune-brain/` 目录默认不读不写；用户迁移时移动到一个对应 agent root，多个 agent 混用过的内容只能手工拆分。
5. 用 temp HOME black-box tests 锁住：agent-local config 生效、其他 agent 不受影响、旧全局目录不生效、CLI flag 优先、未选择 agent 不猜测。
6. docs 和 packaged dist docs 同步说明 whole-directory migration，不只说明 `config.toml`。

### Evidence

- `plugins/immune-brain/runtime/imm_core.ts` 新增 agent-local root resolver、local path helper、bounded TOML config loader、explicit env merge 和 OpenCode primary/fallback root 处理。
- `plugins/immune-brain/runtime/immune_brain_runtime.ts` 将 `imm-activation-plan` 接到 file-backed `[subagent_activation]`，并保持 `--activation-mode` 高优先级。
- `tests/immune-brain-config-runtime.test.ts` 覆盖 agent-native roots、OpenCode fallback、explicit env merge、旧全局目录忽略和 invalid agent id。
- `tests/activation-config-runtime.test.ts` 覆盖 file-backed activation、agent isolation、`IMMUNE_BRAIN_CODING_AGENT` 和“不显式选择 agent 时不猜 Pi”。
- `tests/advisory-dispatch-core.test.ts` 与 `tests/planner-ensemble-contract.test.ts` 证明 `[subagent_models]`、`[workflow_models]` 可从 agent-local file config 驱动 advisory/planner routing。
- `docs/reference/immune-brain-config.md`、README、dispatch/activation docs 和 dist mirrors 说明 agent-local roots、whole-directory migration、env/CLI precedence。
- Verification: focused 28 tests passed, U3 docs verification 15 tests passed, `bun scripts/sync-dist-docs.ts --check` passed, Plan validation passed, `git diff --check` passed.
- Review: formal `imm-code-review` gate passed after same-boundary follow-up added the no-implicit-Pi regression.

### reusability_critique_notes

- Falsifiability: 如果未来 host runtime 明确提供可信的 current agent id，resolver 可以自动使用该 host signal；但在没有显式 signal 时仍不应猜一个默认 agent。
- Evidence trail: 证据来自 runtime helper tests、black-box CLI tests、routing tests、docs sync and formal review gate；不是 provider live dispatch proof。
- Entropy resistance: 追加到 workflow hub，因为这是本地 workflow/runtime 隔离模式，不是新的 dispatcher、secret manager 或 migration daemon。

## 沉淀日期: 2026-07-05 | 来源: host-specific local root runtime plan 2026-07-05-002

## Pattern: Host activation override must be runtime-backed, not docs-only

**领域**: Agent workflow / local runtime config / activation policy
**描述**: 当文档声明 `[subagent_activation.hosts]` 这样的 per-host override 优先于 `default`，runtime 必须真的消费它；否则用户写的 host 级 `disabled` 会被静默忽略，activation plan 仍报 `trigger_not_hit` 而不是 `config_disabled`。这类 docs-vs-runtime 契约缺口要被同边界 code review 黑盒复现抓住，而不是只看类型或文档措辞。

**reusability**: high
**next_reuse_scenarios**:

- 文档声明某个 config override 表，但 runtime 只读 default 字段。
- 需要确认 `[subagent_activation.hosts]` 的 host key 与 `--host` CLI flag 一致。
- 想为 lens/subagent override 表做 runtime 落地前的最小切片验证。

### 方案模板

1. 把 docs 声明的 precedence 直接写进 runtime：`hosts[host] > default > auto`，不要留“文档说了但代码没做”的缺口。
2. CLI `--activation-mode` 仍最高优先，保证测试和用户命令能强制行为。
3. 类型只扩展当前 slice 需要的字段（`hosts`），把 `lenses`/`subagents` 留为 documented-but-not-yet-runtime-backed，避免一次性扩大 scope。
4. 用 temp HOME 黑盒 CLI 测试锁住：host override `disabled` 返回 `config_disabled`，`--activation-mode auto` 返回 `trigger_not_hit`。
5. code review 用一次手工 repro 确认 docs 承诺的行为真的生效。

### Evidence

- `plugins/immune-brain/runtime/imm_core.ts` 扩展 `AdvisoryDispatchConfig.subagent_activation` 支持 `hosts?: Record<string, string>`。
- `plugins/immune-brain/runtime/immune_brain_runtime.ts` `runActivationPlanCommand` 改为 `loaded.config.subagent_activation?.hosts?.[host] || default || "auto"`。
- `tests/activation-config-runtime.test.ts` 新增 host override 回归。
- 黑盒 repro：host override `disabled` → `config_disabled`；`--activation-mode auto` → `trigger_not_hit`。
- Verification: focused 28 tests passed；`git diff --check` 通过；formal `imm-code-review` gate solo pass。

### reusability_critique_notes

- Falsifiability: 如果未来 runtime 改为 activation host 内部消费 lens/subagent override，这个 host-level 模式仍是其上层；本 pattern 只覆盖 host override 这一档。
- Evidence trail: 证据来自 runtime diff、black-box CLI repro、focused tests 和 formal review gate；不是 provider live dispatch proof。
- Entropy resistance: 追加到 workflow hub，因为这是 activation config 契约补全模式，不是新 dispatcher 或 schema 变更。

## 沉淀日期: 2026-07-05 | 来源: host activation override runtime plan 2026-07-05-003

## Pattern: Docs must distinguish runtime-backed from documented-only config tables

**领域**: Agent workflow / config docs / docs-vs-runtime honesty
**描述**: 当 config docs 列出多个 override 表（如 `hosts`、`lenses`、`subagents`），但 runtime 只消费其中一部分时，docs 必须显式标注哪些是 runtime-backed、哪些是 documented-but-not-yet-runtime-backed。否则用户会误以为写了 `lenses` override 就会生效，而 runtime 静默忽略它。

**reusability**: medium
**next_reuse_scenarios**:

- config 文档声明多个 override/section，但 runtime 只实现部分。
- deferred scope 需要让用户知道当前实际生效范围。
- 防止 docs-vs-runtime 契约缺口在后续 review 中被漏掉。

### 方案模板

1. 在 config docs 的 override section 顶部加一段 `Runtime support status` 说明。
2. 明确列出哪些表/字段是 runtime-backed，哪些是 documented-but-not-yet-runtime-backed。
3. 在引用同一契约的其他 docs（如 activation policy）同步加注。
4. dist mirror 同步；intentionally-adapted dist 副本手工更新。
5. 不回改历史 `docs/solutions/*.md`；它们是历史记录。

### Evidence

- `docs/reference/immune-brain-config.md` 增加 `Runtime support status` 段。
- `docs/reference/automatic-subagent-activation-policy.md` 增加 `Runtime support status` 句。
- dist mirror `immune-brain-config.md` 同步；`automatic-subagent-activation-policy.md` 手工更新。
- Verification: 4 tests / 0 fail；dist sync check 通过；`git diff --check` 通过。
- formal `imm-code-review` gate solo pass。

### reusability_critique_notes

- Falsifiability: 如果未来 runtime 实现了 `lenses`/`subagents`，该注记应移除；pattern 只覆盖“标注”这一档。
- Evidence trail: 证据来自 docs diff、dist sync、focused tests 和 review gate；不是 runtime 行为变更。
- Entropy resistance: 追加到 workflow hub，因为这是 docs 诚实性模式，不是新 runtime 或 schema。

## 沉淀日期: 2026-07-05 | 来源: activation override runtime-status docs plan 2026-07-05-004

## Pattern: Plan-Lifecycle Reset Boundary and Stale State Mitigation

**领域**: Agent workflow / runtime state management / plan lifecycle
**描述**: 当系统需要在一套持久的运行态状态（如 `current_iteration.json`）上跨 Plan 切换时，必须显式区分“同 Plan 的 append-safe 签名更新”与“跨 Plan 的新 slice 切面（`same_plan: false`）”。前者通过计算完成前缀安全地保留并从前一次断点继续；后者必须在同步时彻底零化（completed_steps 设为空，active_step 置 null，新 Step 设为 pending 且新 body 不受旧 closed 步骤数据泄漏污染）。同时，系统必须提供可靠的 finish 闭环重置接口，使顺利完成的迭代转换为 idle 状态，彻底避免已完成迭代的 closed 状态在后续会话中重放造成 false-positive complete。

**reusability**: high
**next_reuse_scenarios**:

- 在 CLI 或 MCP 的 sync 逻辑中隔离不同 plan_path 的步骤继承。
- 实现命令级的迭代完成闭环接口（如 `imm-finish`），把运行态安全地切换回闲置态。
- 自愈健康检查（`imm-heal`）需要鉴别 intentional reset 与 accidental empty。

### 方案模板

1. **同异判断**: 同步时首先计算 `samePlan = previous.plan_path === normalized.plan_path`。仅在 `samePlan` 为 true 时，计算已完成前缀 `completedPrefixNumbers`；否则一律置 `[]`。
2. **防内容泄漏**: spread `{...old}` step body 动作必须仅在步骤属于 completed 前缀（且为同一计划）时执行。对于新计划 of Step，一律从 Spec 实例化为 pending 状态，屏蔽旧 evidence 和 notes 的数据残留。
3. **完成状态闭合（Finish Command）**: 实现 `imm-finish` 入口。当且仅当所有 Step 都 closed 后调用，更新 `runtime_status: idle` 和 `reset_reason: intentional_reset`，清除 `active_step`；但保留 `steps` 记录和 `validated_plan_snapshot` 供审计。
4. **无差错持久化（Dehydrate Command）**: 提供 no-op 安全的 `imm-dehydrate` 命令（最小支持直接保存当前 ledger 并退出），防止由于命令未实现导致自动化编排链在完成前崩溃。
5. **回归测试闭环**: 利用临时 root 隔离 state 目录进行黑盒单元与 CLI 验证，包含：cross-plan 重置全 pending、same-plan 前缀保留、finish/dehydrate 状态转变、以及 autowork 不误报 complete。

### Evidence

- [docs/specs/2026-06-29-004-fix-cross-plan-sync-reset-and-finish-runtime.spec.md](docs/specs/2026-06-29-004-fix-cross-plan-sync-reset-and-finish-runtime.spec.md) 规定 `same_plan: false` 时零化 completion 以及 `imm-finish`/`imm-dehydrate` 完整性的行为。
- [plugins/immune-brain/runtime/immune_brain_runtime.ts](plugins/immune-brain/runtime/immune_brain_runtime.ts) 的 `runPlanCommand` 在 `--sync` 时基于 `samePlan` 引入条件前缀；`runImmCommand` 中新增 `runFinishCommand` 和 `runDehydrateCommand` 的调度。
- [tests/cross-plan-sync-reset.test.ts](tests/cross-plan-sync-reset.test.ts) 固定跨计划同步重置和同计划 append 续作的对比单元用例。
- [tests/finish-dehydrate-runtime.test.ts](tests/finish-dehydrate-runtime.test.ts) 固定 finish 的 `idle` + `intentional_reset` 改变和 `dehydrate` 的 no-op 保障。
- [tests/autowork-false-completion.test.ts](tests/autowork-false-completion.test.ts) 固定新计划同步后 `imm-autowork` 正常阻断（awaiting_execution_input）而不误报完成。
- `bun test` 针对这三个新测试文件和 `runtime-state` / `plan-validation` 全量通过（25 pass）。

### reusability_critique_notes

- Falsifiability: 如果项目未来转为多会话、多 Plan 并行调试机制，当前基于单一全局 state ledger 的 `samePlan`（以 plan_path 是否相同作为全局隔离依据）可能会退化。此时应进行多实例隔离设计，而不是扩展全局字段。
- Evidence trail: 证据链包含完整的 3 个新回归验证用例、健康检测通过以及 `imm-finish` CLI 实例执行输出（状态正常转入 idle）。
- Architecture entropy resistance: 追加到 `docs/solutions/workflow.md`。这解决了运行态在不同迭代周期和切换边界的 state reset 契约，与 finish 状态清理语义一致，故追加到工作流主题中心，并彻底移除了临时新建的 `cross-plan-sync-reset-contract.md` 零散文件，控制知识库体积。

## 沉淀日期: 2026-06-29 | 来源: docs/specs/2026-06-29-004-fix-cross-plan-sync-reset-and-finish-runtime.spec.md + step U1-U4

## Pattern update: Persisted review lifecycle before compounder handoff

**领域**: Agent workflow / review lifecycle / compounder gating
**描述**: 当 `imm-loop` 不仅要在 completion boundary 暴露 review gate，还要在多轮 review/follow-up 后恢复进度时，仅靠 changed-files 推断不够。最小可靠切片是把 reviewer pass 以 compact `review_state` 记录到 State Ledger：按 normalized changed-files signature 存储 pass、reviewer Skill、evidence ref 和 timestamp；后续 autowork completion boundary 只在所有 required gates 的 signature pass 都存在时才允许 `imm-compounder` handoff。

**reusability**: high
**next_reuse_scenarios**:

- review gate 已能阻断 compounder，但 review pass 需要跨调用恢复。
- same-boundary follow-up 改了文件后，需要让旧 review pass 自动失效。
- code/UI review gate 顺序需要在 snapshot 中机器可读，同时保持 reviewer read-only。
- runtime host 需要修复 execution/QA continuation，但不能引入 default QA pass。

### 方案模板

1. `review_state` 保持 optional、compact、backwards compatible；旧 State Ledger 没有该字段时必须照常加载。
2. changed files 先 trim、去重、排序，再计算 deterministic signature；review pass 只对同一 signature 有效。
3. material runtime/test/code changes 要求 `imm-code-review`；UI/design/i18n/style/component/layout/theme paths 要求 `imm-ui-review`；混合变更按 `imm-code-review -> imm-ui-review` 顺序闭合。
4. autowork completion boundary 从 closed step `execution_evidence.changed_files` 派生 required gates；若任一 gate 缺少 matching signature pass，返回 `review_required` 而不是 `complete`。
5. `ready_for_review` 只能产生 `awaiting_qa_decision`；queued QA `pass|rework|replan` 可推进状态，但 runtime 不得从 executor verification 自动生成 QA pass。
6. `handoff_only: true` 只在 Plan closed 且所有 required review gates 都通过后返回给 `imm-compounder`。

### Evidence

- `plugins/immune-brain/runtime/imm_core.ts` 新增 `recordReviewPass`、`getReviewPassForChangedFiles`、`determineRequiredReviewGates`。
- `plugins/immune-brain/runtime/immune_brain_runtime.ts` 修复 autowork execution/QA continuation，并在 closed boundary 派生 review lifecycle gate。
- `plugins/immune-brain/dist/imm-loop.md` 明确 `run` automatically invokes pending reviewers instead of asking the user to run reviewer commands manually。
- `tests/imm-loop-review-lifecycle-state.test.ts` 覆盖 compact persisted pass、same/different signature lookup、旧 ledger 兼容。
- `tests/imm-autowork-continuation-runtime.test.ts` 覆盖 execution boundary、QA boundary、queued QA pass/rework/replan、budget stop、no default QA pass。
- `tests/imm-loop-review-orchestration-contract.test.ts` 覆盖 code/UI/mixed review gates、contract wording、same-boundary follow_up routing。
- `tests/imm-loop-completion-gate.test.ts` 覆盖 material/UI compounder blocking、stale pass reopen、all gates pass handoff。
- `bun test tests/imm-loop-review-lifecycle-state.test.ts tests/imm-autowork-continuation-runtime.test.ts tests/imm-loop-review-orchestration-contract.test.ts tests/imm-loop-completion-gate.test.ts tests/plugin-package-runtime.test.ts` 通过 24 tests；Plan validator 对 `docs/plans/2026-07-02-001-feat-imm-loop-review-lifecycle-runtime-plan.md --json` 通过。

### reusability_critique_notes

- Falsifiability: 如果未来 reviewer pass 必须跨分支、跨 workspace 或跨多 Plan 复用，changed-files signature 不足，需要新 Plan 设计 durable review ledger，而不能扩大本字段语义。
- Evidence trail: 证据来自 test-first/characterization-first RED/GREEN、runtime CLI snapshot、solo code review gate 和 focused regression；不是后台 scheduler 或 autonomous reviewer execution 证明。
- Architecture entropy resistance: 追加到 workflow hub，因为这是现有 run/autowork completion gate 的 executable promotion；它保留 authority split，拒绝 `imm-autowork-driver`、generic dispatcher、background scheduler 和 default QA pass。

## 沉淀日期: 2026-07-02 | 来源: imm-loop review lifecycle runtime plan U1-U4

## Pattern update: User-facing autorun over checkpoint-only autowork

**领域**: Agent workflow / autorun boundaries / checkpoint runtime
**描述**: 当系统已有 `imm-loop` 作为用户可见强自动入口，同时还保留 `imm-autowork` 的 CLI/MCP surface 时，不要让两者都自称 host loop。更稳的边界是：`imm-loop` 负责用户可见 orchestration；`imm-autowork` 保留为 deterministic checkpoint runtime，只报告 `run_snapshot` 并消费显式队列。

**reusability**: high
**next_reuse_scenarios**:

- 用户反复触发 `imm-loop` 却停在 `awaiting_execution_input`。
- 一个旧 autowork entry 和新 user-facing loop 同时存在，导致入口心智重复。
- 需要保留 CLI/MCP 兼容 surface，但不想让它拥有 executor、QA、review 或 compounder authority。
- active skill contracts 仍引用旧状态字段或 host-loop wording。

### 方案模板

1. `imm-loop` 是唯一 user-facing strong autorun Skill；它消费 `imm-autowork` checkpoints，并把 `awaiting_execution_input` 转入 `imm-work` / Executor，把 `awaiting_qa_decision` 转入 QA，把 `review_required` 转入 reviewer gate。
2. `imm-autowork` 是 checkpoint-only runtime：读取 State Ledger、激活 eligible Step、消费 host 显式 QA queue、返回 `stop_reason` / `next_recommended_skill` / `recommended_authority` / `required_input` / review gate fields。
3. active contracts 使用 `stop_reason` snapshot 字段作为真源；不要继续依赖未实现或未测试的旧 `can_auto_advance` 文案。
4. registry、README、user manual 与 package tool descriptions 必须同步表达同一边界：`imm-loop` 是 autorun，`imm-autowork` 是 checkpoint helper。
5. 保留兼容 surface，不新增 `imm-autowork-driver`、generic dispatcher、background scheduler 或 runtime default QA pass。
6. reviewer pass 仍通过 `imm-review gate-pass` 按 changed-files signature 持久化；compounder handoff 只在 Plan work、QA、follow-up 和 required review gates 都闭合后出现。

### Evidence

- `plugins/immune-brain/dist/imm-autowork.md` 改为 checkpoint-only contract，并显式声明 must not invoke executor / QA / reviewers / compounder。
- `plugins/immune-brain/dist/imm-loop.md` 改为消费 `imm-autowork` checkpoints，并把 `awaiting_execution_input` 写成 continuation boundary。
- `plugins/immune-brain/dist/registry.yaml` 与 `plugins/immune-brain/skills/registry.yaml` 将 `imm-autowork` 暴露为 `Autowork Checkpoint` / `role_class: checkpoint`。
- `plugins/immune-brain/runtime/immune_brain_runtime.ts` 与 `plugins/immune-brain/.opencode-plugin/index.ts` 将 `imm_autowork` tool description 收紧为 checkpoint snapshot。
- `README.md`、`docs/user_manual.md`、`IMMUNE.md` 将强自动入口收口到 `imm-loop`，同时保留 `imm-autowork` checkpoint compatibility。
- `tests/imm-loop-review-orchestration-contract.test.ts` 覆盖 checkpoint-only contract、registry wording、no stale `can_auto_advance` active contract、no competing user-facing autowork loop。
- `bun test tests/imm-autowork-continuation-runtime.test.ts tests/imm-loop-completion-gate.test.ts tests/imm-loop-review-orchestration-contract.test.ts tests/plugin-package-runtime.test.ts` 通过 23 tests；`plugins/immune-brain/bin/imm-plan docs/plans/2026-07-03-001-fix-autorun-boundary-simplification-plan.md --json` 通过；focused active-contract grep 通过。

### reusability_critique_notes

- Falsifiability: 如果未来 `imm-loop` 获得独立 shell command 并完全取代 checkpoint consumption，`imm-autowork` 可以进入 deprecation plan；在那之前删除它会破坏 CLI/MCP compatibility。
- Evidence trail: 证据来自 focused Bun runtime tests、package parity test、plan validator、active contract negative assertions、QA pass 和 code-review gate pass；不是自然语言偏好。
- Architecture entropy resistance: 追加到 workflow hub，因为这是 workflow entry boundary 收敛，不是新 runtime 平台；它明确拒绝新增 driver、generic dispatcher、background scheduler 与 default QA pass。

## 沉淀日期: 2026-07-03 | 来源: autorun boundary simplification U1

## Pattern: Preset-first read-only advisory model routing

**领域**: Agent workflow / multi-model advisory dispatch / planner ensemble
**描述**: 当 mainline workflow 需要多模型能力时，不要让每个 Skill 自己发明模型矩阵，也不要把旧的 generic dispatcher 复活成 authority router。更稳的边界是：共享层只做 read-only advisory mechanics（tier / preset resolution、delegation prompt、provider envelope、fallback reason、normalized advisory packet），最终 scope、Spec、Plan、execution 和 QA 仍归各 authority role。

**reusability**: high
**next_reuse_scenarios**:

- review lens、planner research、party advisory 或 planner ensemble 都需要同一组模型解析和 provider envelope 规则。
- 用户需要零配置 / preset / optional model slots，而不是强迫写完整 stage matrix。
- 多模型 planner candidates 能提供独立证据，但不能拥有最终 Plan authority。
- 新 host（如 Pi `Agent`）需要进入 dispatch protocol，但基础环境可能不暴露 subagent tool。

### 方案模板

1. 用户配置先走 `[workflow].model_preset`，再用 `[subagent_models]` 填 `fast` / `mid` / `strong` / `local` 槽位；只有少数 stage 需要例外时才写 `[workflow_models]`。
2. `workflow_models.<stage>` 覆盖 preset 的单个 stage，不替换整张 preset map；解析后对重复 concrete model 去重，少于两个不同模型时走 single-model fallback。
3. lens model resolution 保持原优先级：lens override > lens tier mapping > candidate tier fallback > inherit；`inherit` 通过省略 provider `model` 参数表达。
4. provider envelope 只覆盖机械调用形状：Cursor `Task`、Codex `spawn_agent`、Pi `Agent`；Pi 未暴露 `Agent` 时使用 `unavailable_environment`，不能伪造 dispatch。
5. delegation prompt 和 ensemble candidate 都必须内嵌 `tool_policy: no tools` 与 no edits / no plan writes / no workflow-state mutation / no QA closure boundary。
6. planner ensemble 只在 elevated planning risk 或显式请求时启用：agreement becomes evidence，disagreement becomes decision criteria，strong-model blockers become risks or verification requirements；final Spec and Plan stays with `imm-planner`。
7. review gate 要跑到 full runtime health：本轮 focused tests 通过后，全量 `bun test` 发现并修复了 `imm-heal` 的 missing import，说明 shared runtime helpers 必须被全量 CLI surfaces 覆盖，而不能只看新增 unit tests。

### Evidence

- `plugins/immune-brain/runtime/advisory_dispatch.ts` owns the advisory dispatch substrate and planner ensemble packet helpers; `imm_core.ts` remains the public barrel and local-config surface. Neither module owns host trigger decisions, real tool invocation, Plan writes, State Ledger mutation, or QA closure authority.
- `tests/advisory-dispatch-core.test.ts` 覆盖 lens override priority、`inherit` model omission、workflow preset expansion、stage override、duplicate model fallback、Cursor/Codex/Pi envelopes、authority-field absence 和 unsupported-host fallback。
- `tests/planner-ensemble-contract.test.ts` 覆盖 `workflow_models.planner_ensemble` candidates、planner-owned packet normalization、small-plan no fanout 和 planner source/dist contract wording。
- `docs/reference/subagent-dispatch-protocol.md`、`docs/reference/immune-brain-config.md` 及 dist mirrors 记录 Pi `Agent`、model slots、preset-first config 与 stage override 规则。
- `plugins/immune-brain/skills/imm-planner/SKILL.md` 与 `plugins/immune-brain/dist/imm-planner.md` 固定 planner ensemble 的 advisory-only / planner-owned boundary。
- `bun test` 全量通过：146 pass / 0 fail。Focused review gate 通过 24 tests / 0 fail，并验证 `sync-dist-docs --check`、`imm-plan --json`、`git diff --check`。
- `imm-code-review` gate 为 solo pass：activation plan 返回 `trigger_not_hit`，review 发现并修复 same-boundary `imm-heal` missing import 后 full tests 通过。

### reusability_critique_notes

- Falsifiability: 如果未来 child agents 需要写 Plan、执行代码、跨会话排队或拥有 QA closure，本模式失效；必须新开 planner/runtime slice，而不是扩大 advisory substrate。
- Evidence trail: 证据来自 RED/GREEN contract tests、dist doc sync、plan validator、full Bun suite、review gate 和实际 Pi/Codex/Cursor envelope contract；不声称真实 provider dispatch 已端到端自动化。
- Architecture entropy resistance: 追加到 workflow hub，因为这是 workflow model routing 和 advisory boundary 模式；它只窄化旧 shared-dispatch rejection，不创建 generic authority dispatcher。

## 沉淀日期: 2026-07-05 | 来源: multi-model advisory dispatch plan U1-U3 + imm-code-review gate

## Pattern update: Main-context loop with isolated authorities

**领域**: Agent workflow / observable autorun / authority isolation
**reusability**: high

**描述**: 当 completion loop 需要同时保留长上下文、独立 QA/review 和可恢复状态时，不要默认把整个循环与 Executor 放进外部 child process。更小且更可观察的边界是：当前 host 对话负责 checkpoint orchestration 与 active Step 实现，State Ledger 负责机器可读确定性，只有 QA/reviewer 等必须独立判断的 authority 才通过 host `Agent` subagent 隔离。

**next_reuse_scenarios**:

- 外部 agent runner 完成后没有自然回到主对话，用户看不到过程或终态。
- Executor child 丢失主对话中已经形成的实现理解，导致重复 discovery。
- 想移除专用 loop CLI/lock/backend，但仍保留 QA/review 独立性和中断恢复。
- Skill-driven loop 需要明确 malformed/stale subagent output 的 fail-closed contract。

### 方案模板

1. 每轮先读 `imm-autowork` checkpoint；`recommended_authority`、`allowed_actions`、target identity 和 review signature 决定唯一下一动作，conversation memory 不覆盖 State Ledger。
2. `awaiting_execution_input` / `rework_needed` 留在当前对话的 Executor boundary；验证后只通过既有 `imm-work record-execution` 写 evidence，不创建 replacement runner。
3. `awaiting_qa_decision` 和 `review_required` 使用隔离 `Agent` child。Parent 传递 current target/gate/signature，验证 decision-specific schema 后才调用 `imm-review`；stale identity、pass-with-findings、缺失 follow-up 字段或 malformed output 一律 no-write fail closed。
4. 每个 Agent round 恰好显示一次 dispatch 和一次 collection/result；每次 accepted write 后丢弃旧 snapshot 并重读 checkpoint。任何 stop 都输出 Plan、completed Steps、QA、Review、stop reason 和 next action。
5. 中断恢复只依赖 persisted Step/evidence/QA/review/follow-up state：pre-write interruption 不声称 transition，post-write interruption 在下一次 fresh checkpoint 中继续；取消、重复同错无策略变化和预算耗尽均先停再行动。
6. 删除专用 CLI、child process、repository loop lock 和 backend tests 时，保留 runtime checkpoint/review gate/follow-up regressions，并用 active-doc stale scan 防止已删除 surface 继续被宣传。

### Evidence

- `plugins/immune-brain/dist/imm-loop.md` 定义 current-conversation loop、decision-specific child schemas、target/gate/signature freshness、no-write-on-invalid、exactly-once dispatch/collection 和 terminal summary。
- `plugins/immune-brain/skills/imm-loop/SKILL.md` 不再调用 shell runner；`plugins/immune-brain/runtime/immune_brain_runtime.ts` 不再暴露 `imm-loop` command。
- `plugins/immune-brain/bin/imm-loop` 与 `plugins/immune-brain/extensions/imm-loop/` 删除；三组 Pi runner 专属测试删除，保留 checkpoint、review lifecycle、follow-up 和 package regressions。
- `tests/imm-loop-review-orchestration-contract.test.ts` 锁住 main-context、Agent isolation、decision schemas、fresh checkpoint、no-write、cancellation/repeated-failure/budget 和 observable output contract。
- Verification 通过 66 tests / 493 assertions、Plan validation、case-insensitive active-doc stale scan 与 `git diff --check`。
- 独立 U1 QA pass；第一轮 `imm-code-review` 的三个 findings 经 same-boundary follow-up 和一次 QA rework 后闭合；第二轮 exact changed-files review gate pass。

### reusability_critique_notes

- **Falsifiability**: 如果 host 无法持续当前对话 tool loop，或 completion 必须无人值守跨会话后台执行，Skill-driven main-context loop 不成立；应重新引入有观测通道的 runtime host，而不是假装主会话仍在线。
- **Evidence trail audit**: 证据来自已闭合 State Ledger、Spec/Plan、66-test regression、两轮独立 QA、两轮 code review、持久化 review follow-up 和最终 changed-files signature gate；不声称已证明所有 host 的 `Agent` primitive 行为完全一致。
- **Architecture entropy resistance**: 追加到 workflow hub 并就地标记旧 `Runtime Host Owns Autowork Continuation` 为 superseded；没有新建 dispatcher、extension、SDK session、State Ledger schema 或独立 solution 文件。

## 沉淀日期: 2026-07-12 | 来源: main-context imm-loop U1 + follow-up round 6

## Pattern: Adaptive Cache-First Route Before Subagent Dispatch

**Domain**: Agent workflow / discovery efficiency / subagent routing
**Premise**: When agent workflow work keeps paying repeated discovery and subagent startup costs, make the route executable in the existing activation surface instead of adding a new dispatcher. The route is: classify the task, read cache-first navigation pointers, then dispatch subagents only when the cost gate says the task is multi-domain, high-risk, explicitly delegated, or has concrete `parallel_probes`.

**reusability**: high
**next_reuse_scenarios**:

- small docs or single-domain fixes are being over-routed through subagents
- activation output needs to explain why solo fallback happened
- host prompts drift between “subagent-first” prose and runtime cost gates
- workflow efficiency work needs a runtime signal without creating a new driver

### Solution template

1. Put the shared route contract in `docs/reference/subagent-dispatch-protocol.md`, ahead of host-specific phases.
2. Keep the discovery order explicit: `CONTEXT.md` Architecture Map, active Step `discovery_cache`, `docs/solutions/` `key_files`, then targeted search.
3. Extend the existing `imm-activation-plan` JSON with additive route fields such as `route_class`, `dispatch_cost_gate`, `cache_first_sources`, and activation-mode reason.
4. Preserve existing fields like `candidates`, `candidate_lenses`, `parallel_allowed`, and `solo_fallback_reason` so older hosts keep working.
5. Update host skill prompts to consume the same route language; do not let one skill default to subagent dispatch while another short-circuits low-risk work.
6. Verify with focused activation runtime tests plus skill/packaging contract checks.

### Evidence

- `docs/reference/subagent-dispatch-protocol.md` now defines `Adaptive Cache-First Route`, `Task Classifier`, cache-first discovery, `Cost-Based Subagent Gate`, shared briefing, and focused verification.
- `plugins/immune-brain/runtime/immune_brain_runtime.ts` keeps the existing `imm-activation-plan` command and adds route evidence fields without changing the command surface.
- `tests/activation-plan-runtime-surface.test.ts` covers low-risk single-domain fallback and explicit subagent eligibility.
- `plugins/immune-brain/dist/imm-brainstorm.md`, `plugins/immune-brain/dist/imm-planner.md`, and `plugins/immune-brain/dist/imm-work.md` consume the same Adaptive Cache-First Route language.
- Verification passed: `bun test tests/activation-plan-runtime-surface.test.ts tests/code-review-activation-contract.test.ts`; `bun test tests/plan-validation.test.ts tests/baseline-packaging-contract.test.ts tests/dist-docs-sync-contract.test.ts plugins/immune-brain/tests/skill-registry-consistency.test.ts`; `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-05-001-feat-adaptive-cache-first-agent-workflow-plan.md --json`.
- Runtime review gate passed through `imm-review gate-pass --gate imm-code-review` after solo review found no actionable findings.

### reusability_critique_notes

- Falsifiability: If future telemetry shows low-risk single-domain tasks benefit from specialist reviewers often enough to beat startup and synthesis cost, the cost gate should be tuned rather than treated as permanent truth.
- Evidence trail: Evidence comes from runtime CLI output, focused tests, Plan validation, package sync checks, QA pass records, and review gate pass. It does not prove full DAG orchestration or semantic memory is worthwhile.
- Architecture entropy resistance: This belongs in the workflow hub because it reuses existing activation planning and skill contracts. It explicitly avoids generic dispatchers, new drivers, schedulers, and extra memory planes.

## Captured date: 2026-07-05 | Source: adaptive cache-first agent workflow Plan U1-U3

## Pattern: Stage-specific dispatch must pass global activation policy first

**领域**: Immune-Brain workflow / advisory dispatch / activation policy

When adding a stage-specific dispatch surface such as `--stage brainstorm_ensemble`, treat the stage helper as the inner candidate builder, not as authorization. The outer runtime must first resolve `[subagent_activation]`, explicit solo/subagent intent, and cost gate eligibility. Only call or expose stage candidates when that gate is eligible; otherwise return `dispatch: false`, empty `candidates`, `parallel_allowed: false`, and the stable fallback reason (`config_disabled`, `explicit_required`, or `cost_scope_mismatch`).

方案模板:

```ts
const fallback = routeSoloFallbackReason(resolvedMode, dispatchCostGate)
if (!dispatchCostGate.eligible) {
  return { dispatch: false, candidates: [], parallel_allowed: false, fallback_reason: fallback }
}
return buildStageSpecificRequest(...)
```

Evidence:

- `plugins/immune-brain/runtime/immune_brain_runtime.ts` gates `brainstorm_ensemble` before emitting candidates.
- `tests/activation-plan-runtime-surface.test.ts` covers `disabled` and `explicit_only` fallback before candidate emission.
- Review evidence from `docs/plans/2026-07-07-001-feat-brainstorm-multi-model-ensemble-plan.md`: code review found and fixed the policy bypass; final verification passed 23 targeted tests and plan validation warnings were zero.

reusability_critique_notes:

- Falsifiability: this pattern would be too strict only if a future stage intentionally returns candidate previews that are never executable; that surface must use a different field than `dispatch: true`.
- Evidence trail audit: the regression reproduced `disabled` and `explicit_only` returning candidates before the fix, then verified both return fallback with zero candidates.
- Architecture entropy resistance: append to workflow hub because the lesson is about runtime dispatch gating, not a new architecture component or ADR.

沉淀日期: 2026-07-07 | 来源: brainstorm multi-model ensemble review follow-up

## Pattern: Slice-specific host adapters must reject non-target hosts

**领域**: Immune-Brain workflow / host adapter contracts / dispatch safety

When a slice is scoped to one host adapter, such as Pi `Agent` envelopes, the helper must explicitly reject other hosts instead of silently reusing a generic envelope builder. Generic reuse is still useful internally, but the public helper should preserve the slice boundary with a stable fallback such as `unavailable_environment`.

方案模板:

```ts
if (host !== "pi") {
  return { ok: false, envelopes: [], fallback_reason: "unavailable_environment" }
}
return buildPiEnvelopeFromGatedRequest(...)
```

Evidence:

- `buildBrainstormEnsembleDispatchEnvelopes` is a Pi-only adapter and returns fallback for `codex`.
- `tests/planner-ensemble-contract.test.ts` covers the non-Pi fallback plus Pi `Agent` envelope shape.
- Review evidence from `docs/plans/2026-07-07-002-feat-pi-brainstorm-ensemble-host-adapter-plan.md`: code review found and fixed same-boundary overreach; final verification passed 26 focused tests and scope guard had no provider, Agent invocation, polling, or workflow-state mutation hits.

reusability_critique_notes:

- Falsifiability: if a future slice intentionally supports multiple hosts, name the helper generically and test every supported host rather than relying on this Pi-only guard.
- Evidence trail audit: the review observed the helper accepted arbitrary hosts before the fix, then verified `codex` falls back while Pi still emits Agent envelopes.
- Architecture entropy resistance: append to workflow hub because this is a dispatch boundary rule, not a new subsystem.

沉淀日期: 2026-07-08 | 来源: pi brainstorm ensemble host adapter review follow-up

## Pattern: Pi-collected subagent results must fail closed on correlation gaps

**领域**: Immune-Brain workflow / Pi subagent result contracts / advisory synthesis

When Pi executes advisory child subagents and returns completed outputs to runtime, never synthesize from an empty, duplicated, unknown, or incomplete child set. The parent-owned packet is only trustworthy if every expected `candidate_id` maps to exactly one child result.

方案模板:

```ts
const candidates = request.candidates || []
if (!candidates.length) return fallback("missing_candidate_result")
for (const result of results) {
  if (!candidateById.has(result.candidate_id)) return fallback("unknown_candidate")
  if (resultById.has(result.candidate_id)) return fallback("duplicate_candidate_result")
  resultById.set(result.candidate_id, result)
}
for (const candidate of candidates) {
  if (!resultById.has(candidate.candidate_id)) return fallback("missing_candidate_result")
}
```

Evidence:

- `normalizePiBrainstormAgentResults` consumes completed Pi subagent child outputs only; runtime does not call any agent, poll, or mutate state.
- `tests/planner-ensemble-contract.test.ts` covers JSON string outputs, object outputs, unknown candidate rejection, duplicate result rejection, missing result rejection, and errored child blockers.
- Review evidence from `docs/plans/2026-07-08-001-feat-pi-brainstorm-agent-result-contract-plan.md`: code review fixed duplicate/empty result correlation overreach; final validation passed 29 focused tests and scope guard had no provider, agent invocation, polling, or workflow-state mutation hits.

reusability_critique_notes:

- Falsifiability: if a future product wants partial synthesis, it must create an explicit policy and output marker for partial evidence instead of silently reusing this fail-closed helper.
- Evidence trail audit: the review observed empty or duplicate result sets could distort evidence, then verified deterministic fallback reasons and candidate-order synthesis.
- Architecture entropy resistance: keep this as a helper-level contract; do not introduce persisted sessions unless a future Pi-owned subagent collection slice needs them.

沉淀日期: 2026-07-08 | 来源: pi brainstorm subagent result contract review follow-up

## Pattern: Signature-Bound Review Gate Reopen

**Domain**: Immune-Brain workflow / State Ledger / reviewer follow-up authority

When a reviewer finds a same-boundary defect after every required review gate has already passed, do not infer a new execution target from Git state or silently reuse the old pass. Bind the finding to the runtime checkpoint's authoritative changed-files signature, then let the workflow-state owner reopen only the finding's origin gate and create the follow-up in one optimistic commit.

Reusable template:

1. The runtime checkpoint emits the normalized changed files and their deterministic signature.
2. The read-only reviewer returns that exact signature with any same-boundary `follow_up` handoff.
3. The state-owning command validates all ordinary follow-up guards before mutation.
4. If a gate is already pending, preserve backwards compatibility; an optional supplied signature must still match.
5. If all gates passed, require the signature, verify the origin gate belongs to the authoritative change set, remove only that gate's current pass, append an audit record containing prior-pass and finding evidence, and create `pending_follow_up` in the same compare-before-commit transaction.
6. Never rewrite closed Step evidence or invalidate unrelated gate passes.

Evidence:

- `tests/imm-follow-up-runtime.test.ts` proves exact-signature reopen, byte-identical state after missing/stale/non-required input, origin-gate isolation, closed-evidence preservation, audit history, backwards-compatible pending-gate calls, and concurrent commit rejection.
- `tests/imm-loop-review-orchestration-contract.test.ts` proves the checkpoint exposes the signature, stale gate writes fail before mutation, and Code/UI reviewer plus Loop contracts carry the same field.
- Plan `docs/plans/2026-07-14-002-fix-passed-review-followup-reopen-plan.md` closed after 65 related tests, one independent QA rework for Code/UI contract symmetry, a second QA pass, and an exact-signature `imm-code-review` pass.

reusability_critique_notes:

- Falsifiability: this pattern does not apply when policy requires every post-pass finding to become a new Plan, or when the workflow uses a stronger checkpoint revision token instead of a changed-files signature. A signature binds the reviewed snapshot; it does not prove review quality.
- Evidence trail audit: repository tests exercise success, stale/missing input, invalid origin, unrelated-gate preservation, immutable closed evidence, and optimistic concurrency. The QA rework demonstrates that runtime behavior alone was insufficient until both reviewer contracts carried the signature.
- Architecture entropy resistance: append to the workflow hub because this extends the existing review-follow-up state machine. It adds no state store, schema migration, background queue, or new authority role, so a standalone architecture pattern or ADR would duplicate existing ownership rules.

Captured: 2026-07-14 | Source: passed-review follow-up reopen Plan 002

## Pattern update: Review evidence must reset at Plan boundaries

**Domain**: Immune-Brain workflow / State Ledger / cross-Plan review isolation

**Premise**: A deterministic changed-files signature identifies a file set, not
the Plan that produced it. When one State Ledger retains append-only follow-up
history across Plans, review collection needs an explicit Plan boundary and old
review passes must be cleared at the same cross-Plan sync commit. Otherwise a
prior Plan can enlarge the new review scope or authorize an identical file set.

**reusability**: high

**next_reuse_scenarios**:

- a persistent workflow ledger keeps audit history while switching Plan paths
- review passes are keyed by normalized changed files rather than Plan identity
- same-Plan append must preserve valid review continuity
- explicit CLI review inputs could bypass authoritative state validation

### Reusable template

1. Keep `follow_up_history` append-only and add an inclusive marker into that
   history instead of truncating audit evidence.
2. On `same_plan: false`, set the marker to the pre-sync history length and
   clear `review_state` in the same optimistic commit. On `same_plan: true`,
   preserve both the marker and valid passes.
3. Treat a missing marker as `0` for legacy ledgers. Reject negative,
   fractional, non-numeric, or oversized explicit markers before deriving a
   checkpoint or recording any pass; never clamp corrupted state.
4. Build review scope from closed current-Plan Steps plus closed follow-ups at
   or after the marker. A matching old signature cannot substitute for the
   cross-Plan review-state reset.
5. Validate the authoritative collection even when a caller supplies explicit
   changed files. Overrides may select the reviewed set, but cannot bypass
   State Ledger integrity checks.

### Evidence

- `plugins/immune-brain/runtime/state_ledger.ts` implements the optional marker,
  strict bounds validation, and marker-scoped follow-up collection.
- `plugins/immune-brain/runtime/immune_brain_runtime.ts` performs the atomic
  cross-Plan marker/review reset and validates the marker before every
  `gate-pass`, including explicit `--changed-files`.
- `tests/cross-plan-sync-reset.test.ts` covers cross-Plan reset, same-Plan
  preservation, identical-signature stale-pass rejection, and failed optimistic
  sync with byte-identical state.
- `tests/imm-loop-review-lifecycle-state.test.ts` covers legacy defaulting,
  marker-scoped collection, and invalid marker classes.
- `tests/imm-loop-review-orchestration-contract.test.ts` reproduced the explicit
  changed-files bypass before the fix and proves invalid input cannot mutate the
  Ledger while a valid marker still permits the pass.
- Final verification passed 67 tests with 550 assertions, Plan validation with
  no warnings, `git diff --check`, independent follow-up QA, and exact-signature
  `imm-code-review` with no remaining findings.

### reusability_critique_notes

- **Falsifiability**: The marker is unnecessary if every Plan has an isolated
  ledger or review passes carry a stronger Plan-bound identity. It does not
  support concurrent Plans in one ledger; that would require a new state model.
- **Evidence trail audit**: Repository evidence covers compatibility, reset and
  preservation semantics, stale-pass reuse, corrupt markers, explicit-input
  bypass, optimistic concurrency, QA, and code review. It does not prove a
  multi-workspace or distributed review protocol.
- **Architecture entropy resistance**: This extends the existing persisted
  review lifecycle and Plan-reset patterns, so it belongs in the workflow hub.
  It adds no migration framework, Plan identity model, generic cursor, or new
  solution file. The current rollout marker remains `0` intentionally; the next
  cross-Plan sync establishes the first isolated boundary.

Captured: 2026-07-21 | Source: cross-Plan review scope reset Plan 002 + review follow-up round 8

## Pattern update: Path signatures do not prove post-review content freshness

**Domain**: Immune-Brain workflow / review lifecycle / same-boundary repair

**Premise**: A changed-files signature proves which paths a reviewer covered, not
which bytes were present. Any post-gate content mutation, including automated
formatting on already-reviewed paths, makes the evidence stale even when the
path signature still matches. Reopen the passed gate through a same-boundary
follow-up, preserve the intended semantics, and rerun QA plus exact-scope review.

**reusability**: high

**next_reuse_scenarios**:

- a formatter, generator, lint fixer, or editor hook runs after review pass
- an already-reviewed file changes without adding a new path to review scope
- a narrow semantic change becomes hidden by whole-file formatting churn
- a path-bound gate remains green after file mtimes or diff content change

### Reusable template

1. Freeze implementation edits before recording a reviewer gate. Treat any later
   content mutation as unreviewed, even if the changed-files set is unchanged.
2. For a direct repair, open a same-boundary follow-up with the authoritative
   checkpoint signature; do not rewrite the closed Step or append a fake Plan step.
3. Remove mechanical churn from a known baseline while preserving behavior.
   For syntax-preserving cleanup, compare parsed ASTs and rerun focused tests rather
   than trusting a smaller line count alone.
4. Record fresh execution evidence and require independent QA. Let the closed
   follow-up enlarge the derived review scope when it touches an additional file.
5. Rerun the required reviewer with the newly derived signature. Do not reuse the
   prior evidence ref merely because every path name is unchanged.

### Evidence

- The finish Plan's `imm-code-review` gate passed at `2026-07-28T02:49:35Z`;
  five scoped TypeScript files were modified afterward while the Ledger still
  reported `stop_reason: complete` because the signature remained path-identical.
- Review found about 7,300 lines of formatter churn plus two TS2451 diagnostics.
  Follow-up `follow-up-ea3b46eb10a6` reduced the five tracked files to bounded
  12/227/374/4/58-line diffs and converted the Brainstorm contract test to ESM.
- Babel AST comparison proved the five format-cleaned tracked files preserved their
  pre-repair semantics. Verification passed 81 tests / 797 assertions, primary LSP,
  dist sync, two Plan validators, `git diff --check`, independent QA, and a fresh
  exact-signature `imm-code-review` gate.

### reusability_critique_notes

- **Falsifiability**: This process rule becomes unnecessary if review evidence is
  bound to an immutable commit or content digest and every mutation invalidates the
  gate automatically. File mtimes alone are supporting evidence, not durable identity.
- **Evidence trail audit**: One concrete post-gate formatter incident demonstrates
  path-signature insufficiency and successful same-boundary recovery. It does not
  establish a distributed review protocol or justify changing signature schema now.
- **Architecture entropy resistance**: Append to the workflow hub because this
  extends existing gate-reopen and cross-Plan isolation guidance. Do not create a
  new authority role, content-hash migration, formatter subsystem, or standalone ADR.

Captured: 2026-07-28 | Source: imm-finish Plan 001 + review follow-up round 9

## Pattern: Finish Markers Are Plan-Revision Bound

**Domain**: Plan lifecycle / State Ledger authority / independent Plan sync

**Premise**: `finish_reset` and `reset_reason=intentional_reset` prove closure only for the Plan revision that was actually finished. Reusing the same `plan_path` after a signature-changing sync can introduce pending Steps while leaving an old finish marker in history. Any operation that relies on terminal predecessor state must recheck the current Steps and invalidate stale reset state when the Plan revision changes.

**reusability**: high

**next_reuse_scenarios**:

- same-Plan sync preserves a closed prefix while appending new Steps
- a completed contracted Plan is followed by an independent non-contracted Plan
- a command uses historical finish/reset markers to authorize replacement or transition
- closure state survives Plan bytes, signature, follow-up, or review changes

### Reusable template

1. Bind terminal evidence to current Plan identity, including the signature or equivalent revision. A matching path is not enough.
2. On same-Plan sync, clear `intentional_reset` whenever the normalized Plan signature changes. Preserve the closed prefix, but treat any newly introduced Step as pending work.
3. Before accepting a finished predecessor, require `runtime_status=idle`, no active Step, no replan, no pending follow-up, at least one Step, every current Step exactly `closed`, and a latest `finish_reset` that names the current Plan.
4. Distinguish an independent Plan from a declared successor. A genuinely finished contracted predecessor may ordinary-sync to an independent non-contracted Plan; an unfinished contracted predecessor or any contracted target still requires the approved transition path.
5. Keep the existing error and no-write guarantee for rejected cross-Plan sync. Compare Ledger bytes in regression tests so an authority failure cannot partially install the target.
6. Do not add `terminal_plan`, `independent_plan`, queue, or automatic-successor state merely to express this distinction; derive it from current Plan contract and closure facts.

### Evidence

- `plugins/immune-brain/runtime/immune_brain_runtime.ts` clears stale reset state on signature-changing sync and makes `currentPlanAlreadyFinished` validate current closure facts rather than trusting path/history alone.
- `tests/roadmap-plan-transition-runtime.test.ts` proves a finished contracted predecessor can start an independent legacy Plan, while same-path append of a pending Step invalidates the finish and blocks ordinary cross-Plan sync with byte-identical Ledger state.
- Existing transition tests continue to prove contracted targets require `--approve-successor`, unfinished predecessors are rejected, approved transitions retain canonical identity/revision checks, and legacy-to-legacy compatibility remains intact.
- Final broad verification passed 102 focused tests with zero failures, primary diagnostics, independent QA, and exact-signature code review. One transient parallel test failure was recorded; the isolated test, identical suite rerun, and every later broad run passed.

### reusability_critique_notes

- **Falsifiability**: This pattern becomes unnecessary if Plans are immutable content-addressed objects and every revision receives a new identity. It is also too permissive if product policy later requires explicit user approval for every cross-Plan switch, including independent non-contracted work; that would be an authority-policy change, not a bug fix.
- **Evidence trail audit**: A concrete runtime sequence reproduced the bypass: finish a contracted Plan, append a pending Step under the same path, then ordinary-sync to a legacy target. The repaired test proves reset invalidation, blocked transition, and no write. Evidence does not establish DAG, parallel active Plans, historical migration, or automatic successor authority.
- **Architecture entropy resistance**: Append to the workflow hub because this refines existing Plan reset, transition, and follow-up lifecycle guidance. No new state type, queue, scheduler, or ADR is introduced. `CONTEXT.md` already maps Plan sync, workflow runtime, State Ledger, and durable learnings, so no Architecture Map change is needed.

---
Captured: 2026-07-29 | Source: subagent auto token budget Plan lifecycle repair + follow-up round 14

## Pattern: Legacy Replacement Transition Uses Ordinary Sync After User Termination

**Domain**: Plan lifecycle / replacement after QA replan / transition authority

**Premise**: `--approve-successor` is the roadmap-slice/v1-only transition mechanism and rejects legacy v2 Plans. A replacement Plan that repairs a superseded legacy Plan's immutable Scope must transition through the ordinary `imm-plan <successor> --sync` path once the user has explicitly terminated the predecessor; the runtime treats a user-terminated predecessor as a finished current Plan.

**reusability**: high

**next_reuse_scenarios**:

- any legacy v2 Plan whose Step was QA-replanned for an immutable-Scope defect
- writing a replacement Plan that reuses the Spec and only re-commits the failed Step
- deciding between `--sync` and `--sync --approve-successor` for a successor Plan
- verifying a terminated predecessor's Ledger satisfies the transition preconditions

### Reusable template

1. When QA replan finds required owner files outside an immutable Step Scope, the Planner writes a new sequential replacement Plan: same Spec, single Step re-committing only the failed Step, Scope augmented with the exact missing owners, explicit exclusions, and per-shared-owner minimal-contract constraints. Closed predecessor Steps are not re-executed.
2. Only a literal user may terminate the predecessor: `imm-plan --terminate-current --status superseded --reason ... --reason-code boundary_error --stage ... --invalidated-assumption ... --avoidable ... --user-confirmed` (observability fields required for `superseded`, memory #667).
3. After termination the Ledger reports `runtime_status=idle`, `reset_reason=intentional_reset`, `requires_replan=false`, `active_step=null`, `next_action=null`, and a matching `plan_terminal` — which makes `currentPlanAlreadyFinished` true and the predecessor eligible as a finished current Plan.
4. Do not attempt `--approve-successor` for legacy v2 Plans: `runApprovedTransition` hard-requires both predecessor and successor `task.plan_contract === "roadmap-slice/v1"` and fails with "Approved transition requires both plans to use roadmap-slice/v1". That rejection is the contract working correctly, not a retry signal.
5. Use the ordinary `imm-plan docs/plans/<successor>.md --sync`; the sync path accepts the terminated predecessor via `currentPlanAlreadyFinished` (terminal matches current path + idle + intentional_reset + no replan + no active Step + no pending follow-up) and installs the successor with `reset_reason=null` and all Steps pending.
6. If the successor's Step Scope still misses a required owner, execution evidence and review will fail again — validate Scope completeness before syncing (hostile read-only review of the replacement boundary).

### Evidence

- Plan `2026-08-12-012` repair sequence: `--terminate-current --status superseded` (with reason-code/stage/invalidated-assumption/avoidable) → `--approve-successor` rejected with "requires both plans to use roadmap-slice/v1" → ordinary `--sync` accepted and activated U1.
- `plugins/immune-brain/runtime/immune_brain_runtime.ts` `runApprovedTransition` enforces `predContract === "roadmap-slice/v1" && succContract === "roadmap-slice/v1"`; `plugins/immune-brain/runtime/commands/plan.ts` `--sync` gate accepts terminated predecessors via `currentPlanAlreadyFinished` (defined in `immune_brain_runtime.ts`).
- Full Plan 012 closure: 1 Step closed, strict QA pass, 1 review follow-up round, final review gate pass, full suite 795 pass / 0 fail.

### reusability_critique_notes

- **Falsifiability**: This pattern dies if legacy Plans are migrated to roadmap-slice/v1 (then `--approve-successor` becomes the correct path and ordinary sync for terminated predecessors may be restricted), or if product policy starts requiring approved transitions for every cross-Plan switch.
- **Evidence trail audit**: The evidence covers one complete legacy replacement lifecycle plus the two runtime code paths named above. It does not establish behavior for v1 Plans, partially terminated Ledgers, or successor Plans with different Specs.
- **Architecture entropy resistance**: Append to the workflow hub because this refines the existing "Finish Markers Are Plan-Revision Bound" transition guidance and `contracts.md` explicit-termination contract. No new runtime state, queue, or ADR is introduced; `CONTEXT.md` already maps Plan sync and lifecycle, so no Architecture Map change is needed.

---
Captured: 2026-08-12 | Source: Plan 2026-08-12-012 replacement of 011 U2 + strict loop closure

## Pattern: QA and Review Child Outputs Are Schema-Strict

**Domain**: loop child dispatch / output contract / follow-up routing

**Premise**: `imm-check-child-output` rejects any field outside the child decision schema and derives the expected identity from the State Ledger. QA children must emit exactly `decision/evidence/target_id/repair_target/notes/artifacts`; review children exactly `decision/evidence_ref/findings/review_gate/changed_files_signature/scope/change_goal/verification_hint`. A follow-up's `target_id` is the follow-up id (e.g. `follow-up-73bfda7ec291`), not the round number. Any invented field is treated as authority-widening and fails validation.

**reusability**: high

**next_reuse_scenarios**:

- dispatching an isolated imm-qa child for a Strict Step or reviewer follow-up
- dispatching an imm-code-review / imm-ui-review child for a runtime review gate
- writing child prompts that request flat JSON decisions
- mapping a reviewer finding to a follow-up whose scope fits the Step Scope

### Reusable template

1. Before dispatch, tell the child the exact allowed fields and required per-decision fields (QA: `repair_target` required for `rework`, forbidden otherwise; `notes` required for `replan`. Review: `scope`+`change_goal`+`verification_hint` required for `follow_up`; `findings` must be empty for `pass` and non-empty otherwise; `review_gate` and `changed_files_signature` must equal the checkpoint values).
2. QA `target_id` must equal the Ledger target: the Step number as a numeric string for an active Step, or the follow-up id for a reviewer follow-up. Do not guess from round state.
3. Re-map an advisory child's free-form report (e.g. `summary`/`blockers`) into the schema fields in the parent before validation — the child output is advisory, the schema is the contract.
4. A reviewer finding must be repairable inside the Step Scope: `record-execution` checks changed files against the active Step/follow-up Scope, so a finding whose natural home is an out-of-Scope file must be re-targeted to an in-Scope equivalent (e.g. handler-level integration coverage in an in-Scope extension test) or routed to replan.
5. On `qa_output_invalid` / `reviewer_output_invalid` perform no runtime write and stop with the reported violations.

### Evidence

- Two live rejections during Plan 012 loop: `qa_output_invalid: unknown field: summary; unknown field: blockers` and `qa_output_invalid: target_id must equal the current target follow-up-73bfda7ec291`.
- `plugins/immune-brain/runtime/loop_contract.ts` `QA_FIELDS` / `REVIEW_FIELDS` / `validateQaChildOutput` / `validateReviewChildOutput`; follow-up scope enforcement in `plugins/immune-brain/runtime/commands/work.ts` `assertChangedFilesWithinScope`.
- Plan 012 follow-up-73bfda7ec291 closed with 4 handler-level integration tests confined to the in-Scope `tests/pi-canary-enroll-extension.test.ts`.

### reusability_critique_notes

- **Falsifiability**: This pattern is only as stable as `loop_contract.ts`; a schema change there immediately falsifies the field lists. It is too prescriptive if children are later allowed to emit free-form fields through an explicit `attachments` channel.
- **Evidence trail audit**: Evidence is two concrete validation failures plus the validator source; it does not cover UI-review outputs or future schema versions.
- **Architecture entropy resistance**: Appends to the workflow hub next to existing child-output and review-lifecycle patterns; no new validator, state, or ADR. `CONTEXT.md` maps loop/skill contracts already, so no Architecture Map change.

---
Captured: 2026-08-12 | Source: Plan 2026-08-12-012 strict loop QA/review dispatch + follow-up closure
