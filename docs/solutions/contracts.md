---
title: Contracts Solution Hub
reusability: high
key_files:
  - .imm/memory/current_iteration.json
  - .imm/memory/MEMORY.md
  - docs/reference/subagent-dispatch-protocol.md
  - docs/reference/automatic-subagent-activation-policy.md
  - docs/reference/subagent-remaining-work.md
  - docs/reference/subagent-trigger-catalog.yaml
  - plugins/immune-brain/runtime/immune_brain_runtime.ts
  - plugins/immune-brain/runtime/plan_core.ts
  - plugins/immune-brain/runtime/state_ledger.ts
  - plugins/immune-brain/runtime/kernel/storage.ts
  - plugins/immune-brain/runtime/kernel/reducer.ts
  - plugins/immune-brain/runtime/kernel/legacy.ts
  - plugins/immune-brain/runtime/commands/kernel.ts
  - plugins/immune-brain/bin/imm-kernel
  - tests/kernel-core.test.ts
  - tests/kernel-migrate.test.ts
  - plugins/immune-brain/runtime/project_migration.ts
  - plugins/immune-brain/runtime/commands/finish.ts
  - plugins/immune-brain/runtime/work_probes.ts
  - plugins/immune-brain/runtime/progress_projection.ts
  - plugins/immune-brain/.pi-extension/index.ts
  - plugins/immune-brain/.pi-extension/progress_client.ts
  - plugins/immune-brain/.pi-extension/progress_views.ts
  - tests/pi-progress-extension.test.ts
  - tests/progress-projection-runtime.test.ts
  - docs/specs/2026-08-10-pi-progress-visualization.spec.md
  - plugins/immune-brain/runtime/commands/work.ts
  - plugins/immune-brain/.opencode-plugin/index.ts
  - plugins/immune-brain/.opencode-plugin/runtime.ts
  - tests/work-probes-runtime.test.ts
  - tests/work-probe-packaging-contract.test.ts
  - plugins/immune-brain/runtime/commands/review.ts
  - plugins/immune-brain/runtime/imm_core.ts
  - tests/plugin-package-runtime.test.ts
  - tests/runtime-state.test.ts
  - plugins/immune-brain/bin/imm-activation-plan
  - plugins/immune-brain/dist/imm-code-review.md
  - tests/activation-plan-runtime-surface.test.ts
  - tests/code-review-activation-contract.test.ts
  - docs/specs/cost-efficiency-r3.spec.md
  - docs/specs/ui-ux-review-upgrade.spec.md
  - docs/plans/2026-05-17-003-feat-cost-efficiency-r3-plan.md
  - docs/plans/2026-05-21-001-feat-ui-ux-review-upgrade-plan.md
  - docs/plans/2026-05-22-001-feat-imm-work-parallel-probes-runtime-plan.md
  - docs/specs/imm-work-parallel-probes-runtime.spec.md
  - docs/plans/2026-05-24-002-feat-subagent-host-maturity-second-wave-plan.md
  - docs/specs/subagent-host-maturity-second-wave.spec.md
  - skills/BASELINE.md
  - docs/specs/baseline-contract-repair.spec.md
  - docs/plans/2026-05-24-005-fix-baseline-contract-repair-plan.md
  - docs/reference/gstack-quality-ceiling-protocol.md
  - docs/specs/gstack-quality-ceiling-protocol.spec.md
  - docs/plans/2026-05-24-006-feat-gstack-quality-ceiling-protocol-plan.md
  - docs/specs/gstack-quality-ceiling-closure.spec.md
  - docs/plans/2026-05-24-007-feat-gstack-quality-ceiling-closure-plan.md
  - skills/imm-brainstorm/SKILL.md
  - skills/imm-planner/SKILL.md
  - skills/imm-compounder/SKILL.md
  - plugins/immune-brain/dist/imm-compounder.md
  - plugins/immune-brain/dist/imm-planner.md
  - plugins/immune-brain/dist/imm-preplan-review.md
  - plugins/immune-brain/dist/imm-ui-review.md
  - docs/specs/validate-only-plan-command.spec.md
  - docs/plans/2026-05-25-003-fix-validate-only-plan-command-plan.md
  - docs/specs/plugin-package-reference-integrity.spec.md
  - docs/plans/2026-05-25-004-fix-plugin-package-reference-integrity-plan.md
  - plugins/immune-brain/dist/docs/reference/agent-quality-checklists.md
  - plugins/immune-brain/dist/docs/reference/code-simplification-checklist.md
  - plugins/immune-brain/dist/docs/reference/ux-heuristic-checklist.md
  - plugins/immune-brain/dist/docs/reference/HANDOFF-template.md
  - plugins/immune-brain/dist/docs/reference/compaction-handoff-hosts.md
  - docs/reference/planning-quality-gate.md
  - plugins/immune-brain/dist/imm-qa.md
  - tests/technical-design-conformance-contract.test.ts
  - docs/specs/2026-07-10-risk-tiered-technical-design-conformance.spec.md
  - docs/plans/2026-07-10-001-feat-risk-tiered-technical-design-conformance-plan.md
  - docs/specs/planning-quality-gate-planner-contract.spec.md
  - docs/plans/2026-05-26-010-feat-planning-quality-gate-planner-contract-plan.md
  - plugins/immune-brain/skills/imm-page-design/SKILL.md
  - plugins/immune-brain/dist/imm-page-design.md
  - plugins/immune-brain/skills/registry.yaml
  - plugins/immune-brain/dist/registry.yaml
  - README.md
  - docs/user_manual.md
  - docs/reference/immune-brain-skills-guide.md
  - docs/reference/immune-brain-skill-details/README.md
  - plugins/immune-brain/dist/imm-arch-explorer.md
  - plugins/immune-brain/skills/imm-arch-explorer/SKILL.md
  - docs/specs/imm-arch-explorer-overdesign-scan.spec.md
  - docs/plans/2026-06-06-001-feat-imm-arch-explorer-overdesign-scan-plan.md
  - docs/reference/immune-brain-config.md
  - plugins/immune-brain/dist/docs/reference/immune-brain-config.md
  - skills/imm-init/templates/AGENTS.md
  - plugins/immune-brain/skills/imm-init/templates/AGENTS.md
  - .imm/templates/iteration-plan-template.md
  - docs/specs/user-configured-output-language.spec.md
  - docs/plans/2026-06-08-006-feat-user-configured-output-language-plan.md
  - docs/specs/roadmap-human-acceptance-gating.spec.md
  - docs/plans/2026-06-27-001-feat-roadmap-human-acceptance-gating-phase1-plan.md
  - docs/brainstorms/roadmap-example-notification-system.md
  - docs/specs/2026-07-28-roadmap-plan-boundary-successor.spec.md
  - docs/plans/2026-07-28-002-feat-roadmap-plan-boundary-successor-phase1-plan.md
  - docs/plans/2026-07-28-003-feat-roadmap-plan-boundary-successor-phase2-plan.md
  - docs/plans/2026-07-29-001-feat-roadmap-plan-boundary-successor-phase3-plan.md
  - plugins/immune-brain/runtime/state_ledger.ts
  - plugins/immune-brain/runtime/workspace_scope.ts
  - plugins/immune-brain/runtime/commands/plan.ts
  - plugins/immune-brain/runtime/commands/review.ts
  - tests/plan-execution-boundary-runtime.test.ts
  - tests/imm-follow-up-runtime.test.ts
  - plugins/immune-brain/runtime/plan_core.ts
  - tests/roadmap-plan-transition-runtime.test.ts
  - tests/plan-validation.test.ts
  - tests/roadmap-plan-boundary-contract.test.ts
  - docs/specs/subagent-auto-token-budget.spec.md
  - scripts/benchmark_eval.ts
  - tests/benchmark-eval-runner.test.ts
  - tests/benchmark-baseline-contract.test.ts
  - tests/advisory-budget-contract.test.ts
  - docs/specs/provider-runtime-token-telemetry.spec.md
  - docs/plans/2026-07-30-001-feat-provider-runtime-token-telemetry-plan.md
  - tests/fixtures/immune-brain-benchmark.json
  - mise.toml
  - benchmark-results/immune-brain-u5-telemetry/latest.json
  - plugins/immune-brain/runtime/canonical_json.ts
---

> Note: retired Python file paths appear as inline code and refer to the pre-TypeScript-migration runtime.

# Contracts Solution Hub

This hub collects reusable contract patterns for Immune-Brain skill handoffs,
validation surfaces, and closure gates. Prefer appending contract-level patterns
here when they cross multiple skills or tools.

## Pattern: Git-Bound Execution Evidence and Immutable Plan Semantics

**Domain**: Workflow runtime / State Ledger / execution boundaries
**Description**: When Plan execution can cross failed retries, review follow-ups, or Plan switches, the runtime cannot trust only the Executor's claimed `changed_files`, nor let a same-path revised Plan inherit old closure evidence. The safer contract is: Step activation records a workspace baseline; `record-execution` derives paths from the actual workspace delta when Git is available and checks Step/follow-up `Scope`; every execution attempt is append-only; and core Plan semantics become immutable once execution starts. The runtime keeps exactly one current Plan, and cross-Plan switching is allowed only after `completed`, explicit `cancelled`, or `superseded` termination.

**reusability**: high
**next_reuse_scenarios**: [`adding execution evidence to a workflow with failed retries`, `review follow-ups may expand changed files`, `Plan sync needs to preserve old closure evidence`, `repairing a Plan without allowing stale State Ledger facts to cross boundaries`, `evaluating a multi-Plan scheduler or worktree parallelism`]

### Template

1. **Activation baseline**: At Step activation, record enough Git baseline data to calculate the workspace delta, and bind it to both the Plan signature and the independent execution-contract signature.
2. **Runtime-derived paths**: When Git is available, derive `changed_files` from the real baseline-to-workspace delta; the caller's file list is descriptive fallback only and cannot override runtime results.
3. **Scope gate**: Normalize actual paths and compare them with Step/follow-up `Scope`. Reject recording or closing Evidence outside the boundary, and leave the Ledger unchanged.
4. **Append-only attempts**: Store every failed, blocked, and passed attempt in `execution_attempts`. An Executor cannot directly overwrite `ready_for_review` with passed; QA must first move it to `rework_needed`.
5. **Immutable semantics**: Once any Step starts, do not rewrite `contract`, `phase`, `successor`, `Result`, `Verification`, or `Scope`, and do not append a Step in place. For a different boundary, terminate the current Plan before creating a new Plan path.
6. **Explicit termination**: Only the user may mark a permanently blocked current Plan `cancelled` or `superseded`; termination archives the complete runtime state and the terminated Plan cannot resume.

### Evidence

- `plugins/immune-brain/runtime/workspace_scope.ts` derives the Git workspace delta from the activation baseline and checks Step/follow-up Scope.
- `plugins/immune-brain/runtime/state_ledger.ts` stores `execution_attempts`, validates termination records, and rejects direct re-recording during `ready_for_review`.
- `plugins/immune-brain/runtime/commands/plan.ts`, `commands/review.ts`, and `plan_core.ts` enforce semantic immutability, execution-contract signatures, and review-boundary checks.
- `tests/plan-execution-boundary-runtime.test.ts` covers forged `changed_files`, failed-then-passed attempts, QA rework, Plan signature edits, termination archival, and post-termination non-resumption.
- The project test run excluding `upstreams/` passed `441 pass / 0 fail`; 13 related files had no LSP diagnostics, Pi Lens reported no issues, and `git diff --check` passed.

- **Falsifiability**: If a workflow has no persisted execution evidence, no retry/review boundary, or an immutable external artifact is its only trusted input, the full template need not be copied; workspace delta cannot replace that external provenance contract.
- **Evidence trail audit**: The conclusion is supported by the incident replay, runtime scope/ledger regressions, 89 focused tests, the 441-project-test run excluding `upstreams/`, LSP, Pi Lens, and diff checks. The evidence supports this TypeScript runtime; it does not prove equivalent provenance for every future host or non-Git workspace.
- **Architecture entropy resistance**: This belongs in the existing Contracts Hub because it spans `imm-plan`, `imm-work`, `imm-review`, and the State Ledger. It does not add a scheduler abstraction or duplicate the stale-dependency rule in `plan-switch-state-isolation`. `CONTEXT.md` was not updated because no runtime entry or directory-level navigation node changed.

---

## Pattern: Explicit Evidence Inputs Must Precede Transport Stdin

**领域**: Runtime CLI / MCP bridge / evidence contracts
**描述**: 当一个 workflow command 同时支持 CLI flags、JSON evidence 和 stdin JSON 时，parser 必须先处理显式参数，再考虑 stdin。stdin 很可能是 host transport（MCP pipe/socket、spawn pipe、terminal fd），不是业务 evidence；如果先读 stdin，direct tool/MCP 调用会被阻塞或误解析，即使调用方已经传了完整 flags。

**reusability**: high
**next_reuse_scenarios**: [`为 CLI 增加 JSON stdin 支持`, `把 CLI command 暴露为 MCP/direct tool`, `同一命令同时接受 flags 与 JSON payload`, `修复工具调用 timeout 但 CLI fallback 正常的差异`]

### 场景

- 命令已经有明确 flags，例如 `--changed-files`、`--verification-result`。
- 同一命令又为了 shell pipeline 支持 stdin JSON。
- MCP/direct tool 通过 runtime adapter 调用同一个命令，fd0 可能仍是 transport channel。
- session 里出现 direct tool timeout，但 plugin-local CLI fallback 成功。

### 方案模板

1. **显式输入优先**: 解析顺序固定为 dedicated JSON option（如 `--evidence-json`）→ flags → explicit stdin mode / auto stdin → empty fallback。不要在 flags 前读取 stdin。
2. **stdin 自动读取要保守**: 只有没有显式 evidence flags 时才尝试读取 stdin；若支持 `--json-stdin`，让它成为强制 stdin 的可见开关。
3. **统一归一化层**: flags string、JSON array 和 stdin JSON 最终都进入同一个 normalizer，例如把 `changed_files` 归一为 `string[]`。
4. **测试真实冲突**: 增加回归测试：传入 valid flags，同时 stdin 输入非法 JSON，命令仍必须成功并使用 flags。这比只测纯 stdin JSON 更能防止 transport-read 回归。
5. **MCP schema 同步**: direct tool schema 应反映 runtime 真实输入形状，例如 `changed_files` 可接受 string 或 string array。

### 验证依据

- `plugins/immune-brain/runtime/immune_brain_runtime.ts` 中 `parseRecordExecutionEvidence` 改为 `--evidence-json` → flags → stdin 的顺序，避免 flags 场景读取 fd0。
- `plugins/immune-brain/runtime/imm_core.ts` 新增 `normalizeChangedFiles` / `normalizeExecutionEvidence`，让 CLI/MCP/stdin 输入进入同一 State Ledger 形状。
- `tests/plugin-package-runtime.test.ts` 覆盖 `record-execution --help`、flags evidence、`--evidence-json`、stdin JSON、MCP array `changed_files`，并新增 “valid flags + invalid stdin still succeeds” 回归。
- `tests/runtime-state.test.ts` 覆盖 normalized evidence 的 array/string changed files。
- `bun test tests/*.test.ts` 通过 94 tests，`git diff --check` 通过。

### reusability_critique_notes

- Falsifiability: 如果某个 command 的唯一输入契约就是 stdin streaming，则本 pattern 不适用；它适用于多输入模式 command，特别是被 MCP/direct tool adapter 复用的 command。
- Evidence trail: 证据来自本次 `record-execution` direct tool timeout、same-boundary review follow-up、runtime parser 修复和全量 Bun regression。不是从抽象偏好推导。
- Architecture entropy resistance: 该 pattern 不新增 workflow authority，也不要求每个命令支持 stdin；它只规定多输入 parser 的优先级，避免把 host transport 当作业务 payload。

---
*沉淀日期: 2026-07-03 | 来源: agent-skills session friction repair follow-up*

## Pattern: Risk-Triggered Planning Quality Gate

**领域**: Agent workflow / planner contract / design readiness
**描述**: 当团队想提升大型或高风险方案的设计质量时，不要先把新规则写成全局强制流程或新 parser schema。更稳的做法是先把质量门作为 planner-owned contract guidance：用 checklist 定义触发信号和必查项，让 `imm-planner` 在高风险场景引用它，并用 contract tests 锁住“风险触发但非全局 ceremony”的边界。等语言稳定后，再单独评估哪些规则值得进入 `imm-plan.py` enforcement。

**reusability**: high
**next_reuse_scenarios**: [`需要把文档级设计原则接入 planner contract`, `高风险 plan 反复漏掉 compatibility / rollback / interruption recovery`, `想提高验证质量但不想把所有小任务变重`, `准备把 advisory guidance 分阶段推进到 validator enforcement`]

### 场景

- 方案涉及 runtime state、State Ledger、migration、compiled skill contract、reviewer/subagent contract 或 rollback-sensitive workflow。
- 现有 workflow 已有 `IMMUNE.md`、`imm-plan.py` 和 `imm-preplan-review`，新规则不能绕开这些 authority。
- 团队需要降低 execution 阶段返工，但还没有足够证据把所有规则做成 validator 硬门禁。

### 方案模板

1. **先定义 advisory checklist**: 在 `docs/reference/` 写稳定 checklist，明确 trigger signals、required checks 和 non-ceremony boundary。
2. **planner contract 消费 checklist**: `imm-planner` 在 elevated-risk plans 中引用 checklist，而不是让每个 plan 默认套用新 ceremony。
3. **保留现有 authority**: checklist 不替代 `IMMUNE.md`、`imm-plan.py` 或可选的 `imm-preplan-review`；planner 仍负责 scope/spec/step decomposition。
4. **测试锁住双边界**: contract tests 同时断言高风险触发项存在，以及“not mandatory ceremony for every plan”存在，防止两类漂移：忘记使用质量门，或把质量门扩大成全局流程。
5. **validator enforcement 后置**: 只有当 checklist 语言经过实际 plan 使用验证后，才单独开 slice 修改 `.imm/imm_core/plan_runtime.py`。

### 证据

- [docs/reference/planning-quality-gate.md](docs/reference/planning-quality-gate.md) 定义 trigger signals、六项 required checks 和非全局 ceremony 边界。
- [plugins/immune-brain/dist/imm-planner.md](plugins/immune-brain/dist/imm-planner.md) 在 Planning Rules 中要求 elevated-risk plans 先 consult 该 checklist。
- `tests/test_skill_contracts.py` 覆盖 planner 引用、trigger signals、六项检查，以及非强制 ceremony 边界。
- [docs/specs/planning-quality-gate-planner-contract.spec.md](docs/specs/planning-quality-gate-planner-contract.spec.md) 和 [docs/plans/2026-05-26-010-feat-planning-quality-gate-planner-contract-plan.md](docs/plans/2026-05-26-010-feat-planning-quality-gate-planner-contract-plan.md) 记录了先 planner-contract、后 validator enforcement 的分阶段决策。
- `python3 -m unittest tests.test_skill_contracts` 通过 140 tests；`python3 .imm/imm-plan.py docs/plans/2026-05-26-010-feat-planning-quality-gate-planner-contract-plan.md --json` 通过。

### reusability_critique_notes

- Falsifiability: 如果未来规则已经稳定且每个计划都必须强制执行，或者 validator 已经能准确判定这些字段，这个 pattern 应升级为 enforcement slice，而不是继续停留在 planner guidance。
- Evidence trail: 证据来自完成的 009/010 plans、planner contract 更新、完整 skill contract test suite 和 plan validator；不包含 runtime parser enforcement 证据。
- Architecture entropy resistance: 追加到 contracts hub，因为这是 planner contract + verification surface 的边界模式，不是新 workflow runtime 或架构分发模式；同时明确排除全局 ceremony，避免重复早先被修正的 Master-Phase 过度扩张。

---
*沉淀日期: 2026-05-26 | 来源: planning quality gate 009/010 plans U1-U2*

## Pattern: Scoped Global Subagent Activation Control

**领域**: Agent workflow / subagent governance / policy layering
**描述**: 当系统支持多个 host、多个 subagent（含 lens）时，不要把触发策略硬编码为“是否调用子代理”与 fallback。应采用统一的全局默认策略配置（如 `auto`, `explicit_only`, `disabled`）并叠加 host/lens/subagent 级别覆盖，同时保留 `explicit` 子代理列表作为用户/上层手动触发开关。这样可在团队策略变更时实现无代码切换，并保留最小安全退场。

**reusability**: high
**next_reuse_scenarios**: [`新 host 落地且期望不同子代理策略`, `需要按项目临时关闭某些 subagent`, `希望默认走 explicit-only 的治理模式但保留手动 override`, `统一子代理激活与可见证 fallback reason 在多个 host 下保持一致`]

### 场景

- 多个 host（如 code-reviewer、planner、work）共享同一套子代理路由逻辑。
- 组织层面需要“默认打开子代理但可全局关闭”或“默认关闭仅显式调用”的策略开关。
- 需要对特定 host（例如高风险场景）临时强制关闭子代理。
- 需要将“为什么只走 solo”写入可审计字段（如 `explicit_required`、`config_disabled`）。

### 方案模板

1. **统一配置入口**: 在 `~/.immune-brain/config.toml` 定义 `[subagent_activation]`，支持 `default` 与 `hosts/lenses/subagents` 的覆盖表，值仅允许 `auto|explicit_only|disabled`。
2. **运行时透传**: 主逻辑入口在构建 activation plan 前解析该配置，向 `.imm/imm_core/activation_plan.py`、`work_probes.py`、`domain_mapper_dispatch.py` 传入最终 mode、显式列表与 override map。
3. **显式优先策略**: 当全局/局部为 `explicit_only` 或 `disabled` 时，除非在 `explicit_subagents` 提供同名子代理，否则统一走 solo fallback，并记录原因。
4. **双路径一致性**: 同步更新插件分发 runtime（`plugins/immune-brain/dist/.imm/imm_core/*`）与文档，避免宿主 A 写新策略、宿主 B 仍用旧策略。
5. **证据化测试**: 用 `tests/test_activation_plan.py`、`tests/test_work_probes.py`、`tests/test_domain_mapper_dispatch.py` 覆盖 explicit-only 与 disabled 在不同 host/lens/subagent 组合下的返回与 fallback reason。

### 可复用前提

- `subagent` 的触发已存在 catalog 驱动链路，不依赖 LLM 进行 runtime dispatch。
- 需要一个稳定、可审计且可快速回滚的策略层，而不是每次通过变更代码调整策略。

### 验证依据

- [docs/reference/automatic-subagent-activation-policy.md](docs/reference/automatic-subagent-activation-policy.md) 定义 `auto`/`explicit_only`/`disabled` 及优先级顺序。
- [docs/reference/immune-brain-config.md](docs/reference/immune-brain-config.md) 记录配置键、示例与边界语义。
- [plugins/immune-brain/dist/docs/reference/automatic-subagent-activation-policy.md](plugins/immune-brain/dist/docs/reference/automatic-subagent-activation-policy.md) 与本体一致，支持宿主隔离下配置兼容。
- [docs/reference/subagent-dispatch-protocol.md](docs/reference/subagent-dispatch-protocol.md) 约定 fallback reason 在 `solo` 与 `dispatch` 结果中的语义位置。
- `tests/test_activation_plan.py`, `tests/test_work_probes.py`, `tests/test_domain_mapper_dispatch.py` 覆盖 explicit-only 与 disabled 场景。
- `.imm/imm_core/activation_plan.py` 与 `plugins/immune-brain/dist/.imm/imm_core/activation_plan.py` 通过测试与签名对齐。

### 约束与建议

- 不要把 `explicit_only` 误读为“禁用所有可见子代理”；它只是不带显式请求时不自动激活。
- 不要只更新 root runtime，不更新 plugin runtime；否则不同宿主会产生策略漂移。
- 不要把缺少 explicit 参数作为配置 bug；应明确记录 `explicit_required` / `config_disabled` 便于审计。

---
*沉淀日期: 2026-05-22 | 来源: global subagent activation policy plan U1–U4*

## Pattern: Origin Coverage Closed-World Handoff

**领域**: Agent workflow / brainstorm-to-plan traceability / QA closure contracts
**描述**: 当 brainstorm 已经确认一组方案时，不要依赖正文编号或 planner 记忆来保证完整进入计划。更稳的做法是让 brainstorm 交出最小 `Brainstorm manifest`，planner 对每个 `BR-*` item 做 closed-world 映射，`imm-plan` 输出覆盖统计，QA 在最终关闭时把 unresolved origin coverage 视为 `replan` 条件。

**reusability**: high
**next_reuse_scenarios**: [`brainstorm 共识在 planner 阶段被部分遗漏`, `需要证明 origin requirements 全部进入 plan 或被明确延期`, `QA 不能只看 step tests 还要确认计划来源已闭合`, `新增 planner validation summary 但要兼容历史 plan`]

### 场景

- brainstorm 已确认 requirements、decisions、non-goals、deferred items、open questions，但 planner 只规划其中一部分。
- Plan step 粒度仍应保持 outcome-first，不希望强制一条 brainstorm item 对应一个 Step。
- QA 需要知道“来源范围是否闭合”，但不能越权重新决定 planner scope。
- 历史 Plan 可能没有 `Brainstorm manifest`，新 validation 不能把这些旧 Plan 误判为 coverage failure。

### 方案模板

1. **Brainstorm 输出 manifest，不写 Plan**: 用稳定 `BR-*` ID 区分 `BR-REQ-*`、`BR-DEC-*`、`BR-OUT-*`、`BR-DEFER-*`、`BR-Q-*`。正文可以解释理由，但 manifest 才是 planner coverage source。
2. **Planner 做 closed-world trace**: Plan 中保留 `Brainstorm manifest` 和 `Brainstorm Trace`。每个 declared item 必须是 `covered_by_step`、`partially_covered`、`captured_as_decision`、`out_of_scope`、`deferred` 或 `resolved_as_assumption`，没有“没提到”状态。
3. **部分覆盖、延期或排除必须有 reason**: `partially_covered`、`out_of_scope` 与 `deferred` 行不能只写目标；必须说明为什么不完整进入当前交付。
4. **Validator 输出派生 summary**: `imm-plan --json` 输出 `origin_coverage`，至少包含 `applicable`、`declared_items`、`mapped_items`、`unmapped_items`、`reason_required_without_reason`、兼容字段 `deferred_or_out_of_scope_without_reason`、`complete`。`deferred_or_out_of_scope_without_reason` 是旧字段名 alias，计数等同 `reason_required_without_reason`；因此它现在也包含 `partially_covered` 缺 reason 的行，而不只包含 `deferred` / `out_of_scope`。该 summary 是输出层派生信息，不应进入 Plan signature。
5. **历史 Plan 显式 not applicable**: 无 manifest 的 Plan 输出 `applicable: false` 且 `complete: true`，避免把“没有 origin coverage contract”误读成“coverage 未完成”。
6. **QA 只查 unresolved coverage，不接管 scope**: 最终 closure 前，如果 `origin_coverage.unmapped_items > 0` 或 reason-required trace row 缺 reason，QA 返回 `replan`；是否覆盖、延期或排除仍由 planner 决定。

### 可复用前提

- 上游 framing 阶段已经能稳定列出 planner-relevant items。
- Planner 有可验证的 Plan artifact，且已有 focused validation/test 入口。
- Workflow 区分 planner authority 与 QA closure authority，不允许 QA 临时改 Plan 或重判产品范围。

### 验证依据

- [docs/specs/origin-coverage-closure.spec.md](docs/specs/origin-coverage-closure.spec.md) 定义了 manifest categories、closed-world mapping、coverage summary 和 QA closure gate。
- [docs/plans/2026-05-15-002-feat-origin-coverage-closure-plan.md](docs/plans/2026-05-15-002-feat-origin-coverage-closure-plan.md) dogfood 了 `BR-*` manifest + `Brainstorm Trace`，并完成 3 个 Step。
- [skills/imm-brainstorm/SKILL.md](skills/imm-brainstorm/SKILL.md) 明确 `BR-Q-*` 表示 open questions。
- [skills/imm-planner/SKILL.md](skills/imm-planner/SKILL.md) 要求 `imm-plan --json` 报告 `origin_coverage` totals。
- [skills/imm-qa/SKILL.md](skills/imm-qa/SKILL.md) 将 unresolved origin coverage 定义为 final closure `replan` condition。
- `.imm/imm-plan.py` 输出 `origin_coverage` 派生 summary，并对历史无 manifest Plan 输出 `applicable: false`。
- `tests/test_imm_plan.py` 覆盖 complete manifest trace 与无 manifest 历史兼容。
- `tests/test_skill_contracts.py` 锁住 brainstorm / planner / QA 三方 contract。
- `python3 -m unittest tests.test_skill_contracts tests.test_imm_plan` 通过，共 120 条测试。

### 约束与建议

- 不要把 closed-world coverage 误解成“一条 `BR-*` 必须一个 Step”；多个 item 可以映射到同一个 independently closable outcome Step。
- 不要把 `origin_coverage.complete` 纳入 Plan signature，否则输出层统计会污染 runtime sync。
- 不要让 QA 判定某个 `BR-*` 是否该延期；QA 只在映射未闭合或证据缺失时要求 replanning。
- 如果未来需要跨文档、多来源 origin coverage，再考虑 schema store；首版 Markdown trace + validator summary 足够。

---
*沉淀日期: 2026-05-15 | 来源: origin coverage closure plan U1-U3 全步骤验收*

## Pattern: Post-Closure Evidence Correction Uses a Fresh Step

**领域**: Agent workflow / State Ledger / QA closure contracts
**描述**: 当 review 在 Step 已经 closed 之后发现 closure evidence 不完整时，不要回写 closed Step 的 evidence 或 backdate 时间线。更稳的做法是新建一个很小的 Plan/Step，把“修复证据表达”本身作为新的可验证结果，保留旧 Step 的历史事实，并让新 Step 通过正常的 activate -> record evidence -> QA pass 生命周期闭合。

**reusability**: high
**next_reuse_scenarios**: [`closed Step 后发现 evidence/artifacts 漏记`, `HANDOFF 或 docs 在 QA pass 后补写导致 closure 证据不完整`, `State Ledger 时间线出现 recorded_at 晚于 closed_at`, `compounder 前需要判断 closure state 是否 settled`]

### 场景

- 原 Step 已经 QA pass，但后续 review 发现最终 diff 里有文件没有被纳入 execution evidence。
- 直接补改 `.imm/memory/current_iteration.json` 会让 `recorded_at` 晚于 `closed_at`，或者让 history 看起来像 evidence 在 QA 前已记录。
- `imm-compounder` 需要可信的 closure evidence；如果 ledger 时间线不自洽，学习沉淀会把错误流程固化。

### 方案模板

1. **不要修改 closed Step 的原始证据来包含事后事件**: closed Step 的 `execution_evidence`、`recorded_at`、`closed_at` 和 review evidence 是该 Step 的历史事实。发现漏记后，不要把后来才发生的修复塞回旧 Step。
2. **不要 backdate**: 不要把 `recorded_at`、`history[].at` 或 review timestamp 改早来制造“证据先于 closure”的假象。
3. **新建 correction Step**: 用 planner 创建一个新的 one-step Plan，Result 直接表达“post-closure evidence correction uses a fresh State Ledger Step”之类的证据修复目标。
4. **让 correction Step 自己闭环**: 激活新 Step，记录它自己的 changed files 和 verification result，再由 QA pass。这样新 Step 的 `recorded_at < closed_at`，compounder 可以信任当前 closure。
5. **测试守住 policy**: 用 focused contract test 锁住“closed Step evidence 不可回写/backdate，post-closure correction 必须 fresh Step”的规则。

### 可复用前提

- State Ledger 是 workflow source of truth，且每个 Step 有独立生命周期。
- Review 发现的是证据表达问题，而不是原功能行为本身失败。
- 当前系统允许新建小型 correction Plan，并通过常规 `imm-work` / QA 生命周期关闭。

### 验证依据

- [.imm/specs/post-closure-evidence-correction-policy.spec.md](docs/specs/post-closure-evidence-correction-policy.spec.md) 定义了 closed Step chronology immutability、fresh correction Step 和 narrow scope。
- [docs/plans/2026-05-15-005-fix-post-closure-evidence-correction-policy-plan.md](docs/plans/2026-05-15-005-fix-post-closure-evidence-correction-policy-plan.md) 将 code review finding 收敛为一个 outcome Step。
- [.imm/memory/current_iteration.json](.imm/memory/current_iteration.json) 当前 correction Step 的 `recorded_at` 为 `2026-05-15T07:54:10Z`，`closed_at` 为 `2026-05-15T07:54:27Z`，证据先于 closure。
- `tests/test_skill_contracts.py` 覆盖 fresh Step policy 和 no-backdate contract。
- `python3 -m unittest tests.test_skill_contracts` 通过，共 102 条测试。
- `imm-plan docs/plans/2026-05-15-005-fix-post-closure-evidence-correction-policy-plan.md --json` 通过。

### 约束与建议

- 不要把这种 correction Step 当成重开旧 Step；它修的是证据表达，不是 retroactive QA。
- 不要把所有小漏记都塞进同一个长期 Plan；每次 post-closure correction 都应该有明确 scope 和验证路径。
- 如果需要长期支持 correction metadata，再另开 runtime schema 计划；不要在本地手工扩展 `.imm/memory/current_iteration.json` 字段。

### 后续复发证据

- 2026-06-09 的旧页面布局设计 skill（后续演进为 `imm-page-design`）/ `imm-ui-review` contract work 在 QA pass 后，code review 发现 packaged UX heuristic checklist 与 source/dist parity verification 没有进入 `execution_evidence`。
- 随后的 bookkeeping 修正直接编辑 closed Step evidence，把 `recorded_at` 刷到晚于 `closed_at` 的时间，复现了本 pattern 要避免的 chronology drift。
- 该复发确认：即使只是补 packaged reference 或 verification command，closed Step 后也应走 fresh correction Plan/Step，而不是把旧 Step evidence 改成“看起来完整”。

---
*沉淀日期: 2026-05-15 | 来源: post-closure evidence correction policy U1 验收*
*更新日期: 2026-06-09 | 来源: page layout design enhancement code review follow-up bookkeeping recurrence*

## Pattern: Three-tier Discovery Navigation Contract

**领域**: Agent workflow / discovery contracts / durable navigation
**描述**: 当 agents 反复用 broad search 才能定位项目文件时，不要只靠个人记忆或一次性 handoff。更稳的做法是把导航信息拆成三层契约：`CONTEXT.md` 保存全局 Architecture Map，Plan / State Ledger 保存当前 Step 的 `discovery_cache`，`docs/solutions/` frontmatter 保存可复用 `key_files`。

**reusability**: high
**next_reuse_scenarios**: [`新 repo 初始化后 agents 找不到入口文件`, `多个 skills 需要共享同一组 hot paths`, `compounder 沉淀学习但未来检索成本仍高`, `给 Plan 增加只读导航元数据且要保持历史 state 兼容`]

### 场景

- 项目已经有 Skill、Plan、State Ledger、Learning 等多类 artifact，但没有统一导航入口。
- Planner 可以提前识别本轮最可能相关的文件，但 executor 仍需要在运行态先读这些 hot paths。
- Compounder 已经沉淀了 reusable learning，但 future agents 需要先知道哪些源文件最值得打开。
- 运行态签名已经用于保护 closed Step，新增导航 metadata 不能误触发历史 Step 重置。

### 方案模板

1. **静态层放 Architecture Map**: 在根 `CONTEXT.md` 增加 `## Architecture Map`，只列长期稳定的 domain -> path 指针，不写临时任务细节。
2. **动态层放 discovery_cache**: Planner 在 Plan Step 中记录 `Discovery cache`，`imm-plan.py` 解析为 `discovery_cache` 并同步进 `.imm/memory/current_iteration.json`；executor 先读缓存，再决定是否需要 broad search。
3. **模式层放 key_files**: Compounder 创建或触碰 solution 文件时维护 `key_files` frontmatter，让未来 agent 从历史模式直接跳到最有用代码。
4. **reason 是契约的一部分**: 每个 hot path 都要有 reason，避免未来读者只看到路径但不知道它为什么相关。
5. **历史 state 要兼容**: 如果新增的 `discovery_cache` 为空，runtime sync 应兼容旧 snapshot 签名，避免把 schema-only metadata 变化当成 Plan 内容变更。
6. **执行期发现的新 hot paths 不直接改 runtime**: 当前 slice 只让 executor 读取缓存；执行中发现的新路径交给下一轮 planner 或 compounder 更新，避免 executor 越权改 Plan/State schema。

### 可复用前提

- Repo 有稳定的根上下文文件、可验证 Plan artifact 和持久 State Ledger。
- Workflow 区分 planner、executor、QA、compounder 权限。
- 团队愿意维护少量高信号路径，而不是生成完整文件清单。

### 验证依据

- [.imm/specs/discovery-navigation-layer.spec.md](docs/specs/discovery-navigation-layer.spec.md) 定义 static / dynamic / pattern 三层导航与 `discovery_cache` 生命周期。
- [docs/plans/discovery-navigation-layer.plan.md](docs/plans/discovery-navigation-layer.plan.md) 将三层能力拆成 U101-U104，且 Brainstorm Trace 全部映射。
- `.imm/imm-plan.py` 解析并同步 `discovery_cache`，同时兼容旧 snapshot。
- `skills/imm-init/scripts/init_project.py` bootstrap `CONTEXT.md`、`CLAUDE.md` 与 `AGENTS.md` 导航入口。
- [skills/imm-compounder/SKILL.md](skills/imm-compounder/SKILL.md) 要求 touched solution files 维护 `key_files` 并同步 Architecture Map。
- [skills/imm-brainstorm/SKILL.md](skills/imm-brainstorm/SKILL.md) 和 [skills/imm-planner/SKILL.md](skills/imm-planner/SKILL.md) 记录 Discovery Protocol。
- `python3 -m unittest tests.test_imm_plan tests.test_imm_init tests.test_skill_contracts` 通过，共 135 条测试。
- `imm-work status --json` 显示 U101-U104 全部 closed，下一步为 `imm-compounder`。

### 约束与建议

- 不要把 Architecture Map 变成全量目录索引；只放跨任务稳定入口。
- 不要把 `discovery_cache` 当成 executor 可随手写的 scratchpad；写入仍由 Plan / State sync 管理。
- 不要省略 reason 字段；路径没有意图说明会迅速退化成噪音。
- ADR 评估：本次不建议新增 ADR；三层导航是轻量工作流契约，可通过模板和 skill 文本迭代，不满足“硬到难逆转”的门槛。
- Rejected decision：本轮 spec / plan 没有记录明确被拒绝的替代方案，因此不创建 rejected solution。

---
*沉淀日期: 2026-05-15 | 来源: discovery navigation layer U101-U104 全步骤验收*

## Pattern: Context-Sharded Delegation Packets

**领域**: Agent workflow / Token Optimization / Subagent Dispatch
**描述**: 当委派子代理 (subagent) 且目标项目的上下文非常庞大时，不要发送完整的文件内容。更稳的做法是使用分片委派 (Context Sharding)，在委派包的 `focus_delta.specific_changes` 中仅包含相关文件的代码片段 (Fragments) 而非全文。这不仅能节省 60-90% 的 token，还能显著提高子代理对特定变更区域的聚焦度。

**reusability**: high
**next_reuse_scenarios**: [`在超大型文件上运行 code review`, `委派子代理修复特定行的测试失败`, `跨多个文件进行局部重构`, `在 token 预算有限的 runtime 下运行分发`]

### 方案模板

1. **定义分片契约**: 在 `docs/reference/subagent-dispatch-protocol.md` 中增加 `focus_delta.specific_changes` 的分片语义。
2. **宿主实现分片**: 宿主 (Host) 技能 (如 `imm-code-review`) 根据 lens 识别受影响的行或方法，并仅将这些片段放入 `specific_changes`。
3. **子代理适配**: 子代理 (Subagent) 必须能够基于片段进行分析，或者在片段不足时明确返回 `insufficient_context` fallback reason。
4. **验证节约率**: 通过 `tests/test_imm_review.py` 验证生成的委派包中是否只包含相关分片。

### Evidence

- `.imm/imm_core/delegation_packet.py` 增加了对分片结构的支持。
- [docs/reference/subagent-dispatch-protocol.md](docs/reference/subagent-dispatch-protocol.md) 定义了分片委派协议。
- [skills/imm-code-review/SKILL.md](skills/imm-code-review/SKILL.md) 实现了按 lens 裁剪的分片逻辑。
- `tests/test_imm_review.py` 验证了分片生成的正确性。
- `python3 -m unittest tests.test_imm_review` 通过。

---
*沉淀日期: 2026-05-17 | 来源: subagent evolution plan U2 验收*

## Pattern: Dehydrate Closed Step Payload Before Finish Snapshot

**领域**: State Ledger / Runtime state / Workflow closure
**描述**: 当工作闭合后才进入 finish 阶段时，不要把大量 `closed` step 的 `child_evidence` 与 `execution_evidence.focus_delta` 原样保留进 `current_iteration` snapshot。更稳的做法是先在 finish 里对 closed step 做脱水：把详细 payload 挪到 `*_ref` 字段，用最小引用保留审计链路，再让 run_dehydrate 只消费精简版运行态。

**reusability**: high
**next_reuse_scenarios**: [`imm-finish` 后 state snapshot 包含太多 closed-step payload, `close 步骤后要避免 current_iteration JSON 体量持续膨胀`, `需要把 child_evidence 和 focus_delta 保留为可追溯引用`, `v2/legacy state 关闭流程需保留兼容`]

### 场景

- closed step 已通过 QA 闭合并有 `child_evidence`。
- `child_evidence` 包含子代理返回的执行细节，`execution_evidence.focus_delta` 还带有重复变更片段。
- finish 成功后要写入 durable snapshot 和运行态回收历史，但不能让下一轮读取到冗余或过期的闭合细节。

### 方案模板

1. **before finish dehydrate**: 在 `imm-finish` 中 `run_dehydrate` 前执行 closed-step 脱水。
2. **引用替换**: 对每个 closed step 的 `child_evidence` 写入 `child_evidence_ref`，并保留 `archive_id` / `field` / `state: dehydrated` / `item_count`。
3. **聚焦证据引用**: 把每个 `execution_evidence.focus_delta` 替换为 `execution_evidence.focus_delta_ref`（同样带 `archive_id`、`field`、`state`），仅保留追溯信息。
4. **保持闭合语义**: 脱水只处理 `v2` close-state 语义，不回改 `recorded_at/closed_at` 等时间线字段，避免历史事实被污染。
5. **回写 + 回归**: 脱水有结果时要持久化当前 iteration，再执行既有 `run_dehydrate` 与 summarize。

### 可复用前提

- `imm-finish` 负责关闭闭环并接入 `run_dehydrate`。
- v2 State Ledger 约定 step 里包含结构化 `child_evidence` 与 `execution_evidence.focus_delta`。
- close-state 与 summary 的稳定性比“临时可读性”更重要，允许用小量 `*_ref` 保留回溯。

### 验证依据

- `.imm/imm-finish.py` 在 `finish_closure` 前新增 `dehydrate_current_iteration`，并在有脱水改动时保存 `current_iteration`。
- `.imm/imm_core/current_iteration_state.py` 新增 `dehydrate_closed_steps` 与 `dehydrated_fields` 记录。
- `tests/test_current_iteration_state.py` 覆盖 child_evidence 与 focus_delta 的 closed-step 脱水引用。
- `tests/test_workflow_loop.py` 校验 finish 前 closed-step 脱水确实进入 snapshot。

### 约束与建议

- 不要把 `recorded_at`、`closed_at` 改写成后续状态，以免闭环证据时间线被倒挂。
- 不要只删除 `child_evidence` 而不写 `*_ref`，否则会丢审计链路。
- 在 v1 state 或非 closed step 上不要强制写入脱水字段。

---
*沉淀日期: 2026-05-17 | 来源: cost-efficiency r3 plan U1-U4 + follow-up P1 修复*

## Pattern: Shallow Discovery with Cost-Scoped Dispatch Short-Circuit

**领域**: Workflow contracts / Dispatch safety / Runtime efficiency
**描述**: 当任务是低风险、单域且可在当前边界内完成时，不要立刻进入长链条多阶段分发。更稳的做法是先用轻量发现与 shallow check 做 `cost_scope_mismatch` 判断；只有明确触发多技能协作条件时再走 full dispatch。

**reusability**: medium
**next_reuse_scenarios**: [`cost_scope_mismatch 的子代理回退仍然高价值`, `单文件单域修复可避免无效分发`, `executor 需要在保持准确率前提下降低检索成本`, `BASELINE 改造后要收敛读取工具链`]

### 场景

- Host/Planner 已经确认 scope，且变更看起来限定在一个已有文件块。
- 自动激活分发会显著增加读写开销，甚至导致不必要的子代理参与。
- 现有 BASELINE 发现链路仍偏重全文读取时，token / I/O 会明显上升。

### 方案模板

1. **低成本先行**: 在 BASELINE 中优先使用 `rg`、文件列表、符号扫描、`targeted` 行范围读、repo-local parser；只在确需时读取整个文件。
2. **单域快速判定**: 在分发协议中新增 Phase 0 规则，明确低风险单域改动可直接用 `solo_fallback_reason: cost_scope_mismatch` 跳过多阶段流程。
3. **保留可证明性**: 对每次 `solo` 与 `fallback` 写明 reason code，并在回退时输出人类可读解释，避免“为什么没分发”不可追踪。
4. **防回归**: 给 skill contract tests 增加 shallow-discovery 与 reason 语义断言，避免后续回到全量读 + 盲目分发状态。

### 可复用前提

- Planner / executor 的分发边界可被明确识别（单域 vs 跨域）。
- BASELINE 已有统一文件读取约束，执行链路可承受“先浅后深”模式。
- fallback reason 被系统化消费（例如记录 `solo_fallback_reason`）且能在 review 里还原。

### 验证依据

- [docs/reference/subagent-dispatch-protocol.md](docs/reference/subagent-dispatch-protocol.md) 新增 `Phase 0: Lightweight Short-circuit`。
- [skills/BASELINE.md](skills/BASELINE.md) 增加 `Shallow Discovery` 区块。
- `tests/test_skill_contracts.py` 新增 `test_baseline_documents_shallow_discovery` 与 contract coverage。
- [docs/plans/2026-05-17-003-feat-cost-efficiency-r3-plan.md](docs/plans/2026-05-17-003-feat-cost-efficiency-r3-plan.md) 记录本次 U1-U4 跟进闭环。

---
*沉淀日期: 2026-05-17 | 来源: cost-efficiency r3 plan U1-U4 + follow-up P1 修复*

## Pattern: Parallel Domain Survey via Domain Mapper

**领域**: Architecture Exploration / Subagent Dispatch / Context Sharding
**描述**: 当探索大型或未知代码库的架构时，不要让单个代理尝试读取所有文件。更稳妥的做法是使用 **Domain Mapper** 模式进行平行领域调查 (Parallel Domain Survey)：将代码库按顶级目录或领域表面划分为多个分片 (Shards)，并委派多个只读子代理并行分析每个分片。每个子代理返回标准化的架构证据 (Evidence)，由宿主进行汇总。

**reusability**: high
**next_reuse_scenarios**: [`对超大型项目进行初步架构摸底`, `跨多个独立包或服务进行依赖分析`, `在不熟悉的代码库中寻找重构机会`, `多领域专家并行审阅架构一致性`]

### 场景

- 代码库过于庞大，单个上下文窗口无法容纳所有关键架构信息。
- 需要在短时间内对多个领域（如 UI、Runtime、Persistence、Docs）进行广度覆盖。
- 宿主需要高信号的架构事实（关键文件、领域术语、耦合证据）来生成 ADR 或重构建议。

### 方案模板

1. **确定分片形状 (Shard shape)**: 根据顶级目录、领域边界或包结构，为每个 Domain Mapper 分配一个受限的 `focus_delta.specific_changes` 分片。
2. **强制只读与无工具 (Tool policy)**: 委派包必须包含 `tool_policy: no tools` 和 `readonly: true`，确保调查不会产生副作用。
3. **标准化证据 Schema**: 所有 Mapper 返回统一的 JSON 结构，包含 `key_files`、`domain_terms`、`ownership_boundaries`、`weak_boundaries`、`coupling_evidence`、`candidate_opportunities` 和 `uncertainties`。
4. **宿主汇总 (Synthesis)**: 宿主技能 (如 `imm-arch-explorer`) 收集所有 Mapper 的输出，并将其作为证据输入，而不是直接采取行动。
5. **Telemetry 记录**: 在分发过程中通过 `dispatch_telemetry.jsonl` 记录分片覆盖率和分发效率。

### 可复用前提

- 运行环境支持 `generalPurpose` 或类似的子代理分发协议。
- 宿主具备上下文切片 (Context Sharding) 和证据聚合 (Evidence Synthesis) 的能力。
- 任务目标是架构探索或机会发现，而非直接代码修改。

### 验证依据

- [skills/imm-arch-explorer/SKILL.md](skills/imm-arch-explorer/SKILL.md) 锁定了 Domain Mapper mode 契约与输出 Schema。
- `.imm/imm_core/domain_mapper_dispatch.py` 实现了确定性的分片封包与结果归一化。
- `tests/test_domain_mapper_dispatch.py` 验证了分发路径与证据采集的正确性。
- `tests/test_skill_contracts.py` 覆盖了 arch-explorer 的分发协议约束。

### 约束与建议

- 不要让 Domain Mapper 选择或执行计划；它们只产出事实证据。
- 汇总时必须保留 `uncertainties` 字段，以防子代理在分片视图下产生的幻觉被误当成事实。
- 优先选择顶级目录作为初始分片，只有在确需深度垂直分析时才使用更细粒度的逻辑分片。

---
*沉淀日期: 2026-05-18 | 来源: imm-arch-explorer domain mapper plan U1-U3 验收*

## Pattern: Value-Driven Public Surface for Agentic Systems

**领域**: Documentation / Public Release / User Onboarding
**描述**: 当向公众发布复杂的 Agentic 工程系统时，不要只列出技术规格或内部脚本。更稳的做法是构建一个以用户价值为导向的表面：用“文件即大脑” (FileSystem-as-Brain) 等隐喻解释核心哲学，将内部角色包装成直观的“生命周期技能” (Lifecycle Skills)，并提供明确的 `Plan -> Work -> Review` 核心循环引导，让用户快速理解如何通过 Agent 实现长效工程目标。

**reusability**: high
**next_reuse_scenarios**: [`新用户 onboarding 到 Immune-Brain`, `同步 internal 变更到 public README 时保持表达一致性`, `向非技术决策者介绍 Agentic 工作流价值`, `编写产品级文档或宣传材料`]

### 场景

- 系统内部逻辑复杂（含多角色分发、状态脱水、验证协议等），直接暴露会让新用户感到畏惧。
- 需要在有限的 README 空间内传达“持久化”、“可验证”和“知识复利”这三大核心价值。
- 安装后的 skill 和命令需要有清晰的职责划分，避免用户在使用 `imm-work` 时不知道为什么还要 `imm-qa`。

### 方案模板

1. **价值先行 (Value Proposition)**: 在顶部使用强 tag line (如 "The Lifecycle Agentic Engineering System") 和 3-5 条核心 feature 摘要。
2. **核心循环可视化 (Workflow Visualization)**: 用极简步骤描述 `Plan -> Work -> Review`。不要在首页展开异常流程（如 rework/replan）。
3. **角色包装 (Skill Packaging)**: 将 `imm-*` skill 包装成“专业代理”，并用动词描述其职责（如 `imm-brainstorm` -> "Clarify requirements"）。
4. **CLI 概览 (CLI Quick Reference)**: 提供一张高信号命令表，明确区分“启动计划”、“推进步骤”和“验收结果”。
5. **分层阅读 (Progressive Disclosure)**: 首页保留最常用的 Core Skills；高级功能（如 advisory lenses、telemetry）放入 reference 文档或折叠区块。

### 可复用前提

- 系统具备稳定的闭环流程（Plan/Work/Review）。
- 具备 installable skill 机制，且 CLI 命令与 skill 名称一一对应或语义对齐。
- 重视长期知识沉淀 (`docs/solutions/`) 这一差异化价值点。

### 验证依据

- [public-release/templates/README.md](public-release/templates/README.md) 实现了上述分层表达、价值锚点和核心循环引导。
- [docs/reference/workflow-and-subagents.md](docs/reference/workflow-and-subagents.md) 作为 reference 层承接了更深度的角色契约与 subagent 细节。
- `imm-work status` 输出已优化为高信号摘要，与 README 中的 `imm-status` 描述一致。

### 约束与建议

- 不要因为追求简洁而隐瞒权限边界（如 `imm-work` 只推进单步）；诚实地告知边界是建立信任的前提。
- 隐喻 (FileSystem-as-Brain) 要保持一贯性，并在文档后续部分（如 Layout）中得到印证。

---
*沉淀日期: 2026-05-18 | 来源: public-release README templates improvement*

## Pattern: Lens Extension Requires Runtime- and Plugin-Copy Parity

**领域**: Agent workflow / Subagent governance / Runtime parity
**描述**: 当给现有 review host（如 `imm-ui-review`）新增专用 advisory lens（如 `ux_heuristic`）时，不要只改单一运行层。应同时同步 catalog、activation 计算、delegation packet、host skill 文档、测试和 plugin 运行时副本；缺一会在某些运行环境出现行为不一致。

**reusability**: medium
**next_reuse_scenarios**: [`在现有 host 接入新的 review lens`, `同一项目需要同步本体/runtime 与插件分发副本`, `新增触发关键词需要独立 trigger + 合成测试`, `修订 activation_plan 后要保持 plugin copy 可执行`]

### 场景

- 已有一套 `subagent-trigger-catalog.yaml` + `activation_plan.py` 的 dispatch 体系，但某个 host 需要新增一个 lens（如 `ux_heuristic`）。
- 触发条件应以明确关键词与文件路径组合为准，避免非预期的默认 dispatch 扩张。
- 代码修改同时涉及主 repo 与 plugin 分发包时，必须避免行为分裂与回归。

### 方案模板

1. **一次性更新 catalog 与 policy 对齐**: 为新 lens 补齐 host/child 级配置、关键词、否定规则和 rationale code。
2. **同步 runtime 计算层**: 更新主 runtime 与 plugin dist 的 `activation_plan`、`delegation_packet`，确保两者输出一致的 `candidates`、`lenses`、`candidate_lenses`、`model_tiers`。
3. **更新 host skill 与验证规范**: 在 `imm-ui-review` 文档和 specs 中落地 lens 行为（包括 `ux-heuristic-checklist` 入口与 advisory-only 约束）。
4. **锁定回归测试**: 在 `tests/test_activation_plan.py` 增加独立 keyword trigger + 组合场景断言，并在 `tests/test_skill_contracts.py` 锁住 docs/spec/policy/skill 合约一致性。
5. **收口验证闭环**: 用 tests + Plan 验证作为一个闭合块，避免只在某一副本通过而另一副本失配。

### 可复用前提

- 系统仍采用 host-bound 的 advisory 分发模型，不打算当期引入 shared registry。
- 有主 runtime 与 plugin runtime 两套可执行副本，需要同步维护。
- 变更范围能在 `lenses`、`rationale_codes` 和 `dispatch` 协议内表达，无需新 dispatch infra。

### 验证依据

- [docs/reference/subagent-trigger-catalog.yaml](docs/reference/subagent-trigger-catalog.yaml), [docs/reference/automatic-subagent-activation-policy.md](docs/reference/automatic-subagent-activation-policy.md), [docs/reference/subagent-remaining-work.md](docs/reference/subagent-remaining-work.md)
- `.imm/activation_plan.py`, `plugins/immune-brain/dist/.imm/imm_core/activation_plan.py`
- `tests/test_activation_plan.py`, `tests/test_skill_contracts.py`
- [docs/specs/ui-ux-review-upgrade.spec.md](docs/specs/ui-ux-review-upgrade.spec.md), [docs/plans/2026-05-21-001-feat-ui-ux-review-upgrade-plan.md](docs/plans/2026-05-21-001-feat-ui-ux-review-upgrade-plan.md)
- `.imm/imm_core/delegation_packet.py`, `plugins/immune-brain/dist/.imm/imm_core/delegation_packet.py`

### 约束与建议

- 不要只改单一 runtime 副本；plugin copy 漏更新是最常见的异步行为来源之一。
- 不要把该模式当成推进 shared registry 的替代方案；当前只用于 host-bound 专项扩展。
- 不要合并多个未验证的 lens 扩展请求到同一 step，优先最小闭环。

---
*沉淀日期: 2026-05-21 | 来源: ui/ux review upgrade plan U1-U4 与代码/文档修订*

## Pattern: Read-Only Parallel Probe Runtime in a Single Active Step

**领域**: Agent workflow / State Ledger / Subagent truth protocol
**描述**: 当 Planner 在 Step 中预置 `parallel_probes` 时，不要只写文档约定。更稳的做法是让 `imm-work continue` 在进入执行前实际分发 probe，但保持 probe 为只读 advisory 角色：`active -> probing -> executing`，结果写入 `child_evidence` 给 executor 作为上下文输入，且失败时用 fallback reason 走顺序方式继续闭环。

**reusability**: high
**next_reuse_scenarios**: [`一个 Step 涉及多片只读预研区域`, `需要把并行侦测前置于实际实现但不改变单步执行边界`, `想把 dispatch 成败和 fallback 原因作为 QA 可见证据`, `plan/runtime/schema 需要兼容老状态签名`]

### 场景

- Planner 能按路径/目录预置多个只读并行探针（`scope`、`output`、`readonly: true`）。
- runtime 需要在不改变单步执行权威边界的前提下，提高 executor 的先验 context。
- 方案必须对旧状态兼容，尤其是历史 `discovery_cache` 或新增空列表字段不能误触发 `Plan signature` 变更。

### 方案模板

1. **Plan 端保持可选标注**: 在 `imm-plan` 解析器中新增 `Parallel probes` 字段解析与校验，归一化为 `parallel_probes`，并保留空列表时保持默认兼容。
2. **签名与同步兼容**: `plan_signature` 变更时保持“可选默认字段”兼容集合（如 `discovery_cache` / `parallel_probes` 为空时可忽略），避免把 schema-only 变化当作重跑所有旧 Step。
3. **构建 probe envelope**: 在 `imm-work` 前置路径中新增 helper（如 `work_probes`）将 `scope/output/readonly` 映射为确定性子代理 envelope；仅记录无副作用调用形状，不直接发起 provider call。
4. **执行状态串接**: 对带 probe 的 active Step 走 `active -> probing -> executing`，将每个 probe 结果标准化为成功/失败/fallback，并持久化到 `child_evidence`。
5. **非阻塞降级**: 当 dispatch 不可用时记录 `unavailable_environment`，或遇到 timeout/fail 记录具体 `fallback_reason`，仍保持可继续向 executor 转交顺序化执行。
6. **合同统一**: 同步更新 `imm-work`/`imm-planner`/`imm-executor` docs，测试用例覆盖：deterministic envelope、fallback 记录、child_evidence 传递，避免 shared registry 或通用 dispatch 的误扩张。

### 可复用前提

- Step 的执行权仍采用单步模式，不并行执行多个 Step。
- `imm-work` 拥有 state_machine 与 child_evidence 的持久化能力。
- 团队认可只读 parallel probe 仅提供 context，不能直接改变计划、state 或关闭 QA。

### 验证依据

- [docs/specs/imm-work-parallel-probes-runtime.spec.md](docs/specs/imm-work-parallel-probes-runtime.spec.md) 的 R1-R8 要求。
- [docs/plans/2026-05-22-001-feat-imm-work-parallel-probes-runtime-plan.md](docs/plans/2026-05-22-001-feat-imm-work-parallel-probes-runtime-plan.md) 的 U1-U5 全流程闭环记录。
- `.imm/imm_core/plan_runtime.py` 与 `tests/test_imm_plan.py` 覆盖 `parallel_probes` 解析和 state sync。
- `.imm/imm_core/work_probes.py` 与 `tests/test_work_probes.py` 覆盖 envelope 构建与结果标准化。
- `.imm/imm-work.py`、`.imm/imm_core/current_iteration_state.py`、`.imm/imm_core/state_machine.py` 与 `tests/test_workflow_loop.py`、`tests/test_current_iteration_state.py` 覆盖 probe->probing->executing 与 `child_evidence` 持久化。
- [plugins/immune-brain/dist/imm-work.md](plugins/immune-brain/dist/imm-work.md)、[plugins/immune-brain/dist/imm-planner.md](plugins/immune-brain/dist/imm-planner.md)、[plugins/immune-brain/dist/imm-executor.md](plugins/immune-brain/dist/imm-executor.md) 与 `tests/test_skill_contracts.py` 锁死合约一致性。
- `python3 -m unittest tests.test_imm_plan tests.test_current_iteration_state tests.test_work_probes tests.test_workflow_loop tests.test_skill_contracts` 通过，共 194 条测试。

### 约束与建议

- 不要把 `parallel_probes` 变成可写入口；它只提供 readonly 上下文和证据提示。
- 不要让 probe 失败阻断 Step；失败必须可见但应 fallback 到顺序执行。
- 若以后引入真正 shared registry，请重新评估 host-bound 前置条件，因为本模式不包含集中式调度器。

---
*沉淀日期: 2026-05-22 | 来源: imm-work parallel probes runtime plan U1-U5 全步骤验收*

## Pattern: Host-Bound Evidence Loops for Planning Subagents

**领域**: Agent workflow / planning subagents / advisory evidence contracts
**描述**: 当 planner 或 preplan 这类 authority role 需要子代理帮助时，不要让子代理产出 Plan、Spec、scope posture 或 QA 结论。更稳的做法是给每个 host 一个专用 helper：先做 host-local eligibility 和 activation fallback，再生成 readonly envelope，最后把 child output 归一成父级可消费的 evidence。Compounder 只消费 scorecard summary 判断结果价值；缺少 scorecard 数据时必须输出 `insufficient_evidence`，不能把 prose impression 当作 shared registry 依据。

**reusability**: high
**next_reuse_scenarios**: [`为新的 planning host 增加 readonly subagent`, `review 发现 helper trigger 与 skill contract 漂移`, `compounder 需要判断 subagent 是否真的提升结果`, `多个 host 看起来相似但 shared registry 证据仍不足`]

### 场景

- `imm-planner` 需要并行研究输入，但最终 Spec / Plan / Step Result / Verification 仍必须由 planner 写。
- `imm-preplan-review` 需要 adversarial voice，但最终 scope posture 仍必须由 preplan host 判断。
- `imm-compounder` 需要总结 subagent 结果价值，但不能因为“看起来多个 host 相似”就建议 shared registry。
- Review 发现 runtime helper 的 trigger 比 skill contract 更宽时，需要同边界 follow-up 收紧 helper，而不是扩大 contract 来迁就实现。

### 方案模板

1. **每个 host 保持专用 helper**: 使用 `planner_research.py`、`preplan_adversary.py` 这类 host-bound helper，不抽 shared dispatcher。helper 命名和输出字段直接反映 host contract。
2. **eligibility 先于 envelope**: helper 先判断 `cost_scope_mismatch`、`explicit_required`、`config_disabled`、`unavailable_environment` 等 fallback，再验证 probe / finding shape。fallback path 不应因为不完整 probe schema 报错。
3. **readonly envelope 只请求 evidence**: envelope 使用 `generalPurpose` + readonly / `tool_policy: no tools`，并在 prompt 中明确禁止写 Plan、Spec、workflow state、QA closure 或最终 scope posture。
4. **child output 归一成父级 evidence**: planner research 只产出 `constraints`、`risks`、`unknowns`、`file_pointers`、`verification_implications`；preplan adversary 只产出 `risk`、`disputed_assumption`、`verification_concern`、`recommendation`、`confidence`、`disposition`。
5. **trigger 必须跟 skill contract 对齐**: 测试要覆盖“只 multi-domain 不触发 preplan adversary”这类负例，防止 helper 比文档更激进。
6. **scorecard 决定是否值得平台化**: compounder 使用 `summarize_scorecard_for_compounder` 汇总 host-level result value、degraded reasons、routing effects。少于三个 host 有 adopted/degraded 证据时，shared registry review 必须保持 `insufficient_evidence`。
7. **主 runtime 和 plugin dist 同步**: 每个 helper 在 `.imm/imm_core/` 和 `plugins/immune-brain/dist/.imm/imm_core/` 保持一致；skill contract 和 `tests/test_skill_contracts.py` 同步锁定入口名与边界措辞。

### 可复用前提

- 子代理只是 advisory / evidence provider，不拥有 planner、preplan、executor 或 QA authority。
- Host 已经有明确 skill contract、fallback reason 词表和 focused unit test 入口。
- 还没有足够 scorecard evidence 证明 shared registry 或 generic dispatcher 的收益。

### 验证依据

- `.imm/imm_core/planner_research.py` 与 `tests/test_planner_research.py` 覆盖 evidence-only planner research helper。
- `.imm/imm_core/preplan_adversary.py` 与 `tests/test_preplan_adversary.py` 覆盖 non-gating adversarial helper，包括 `multi_domain_count` 不单独触发 adversarial dispatch 的回归。
- `.imm/imm_core/subagent_scorecard.py` 与 `tests/test_subagent_scorecard.py` 覆盖 compounder scorecard summary 和 `insufficient_evidence`。
- [plugins/immune-brain/dist/imm-planner.md](plugins/immune-brain/dist/imm-planner.md), [plugins/immune-brain/dist/imm-preplan-review.md](plugins/immune-brain/dist/imm-preplan-review.md), [plugins/immune-brain/dist/imm-compounder.md](plugins/immune-brain/dist/imm-compounder.md) 记录 host-facing contract。
- [docs/plans/2026-05-24-002-feat-subagent-host-maturity-second-wave-plan.md](docs/plans/2026-05-24-002-feat-subagent-host-maturity-second-wave-plan.md) 与 [docs/specs/subagent-host-maturity-second-wave.spec.md](docs/specs/subagent-host-maturity-second-wave.spec.md) 定义第二波边界和 deferred hosts。
- `python3 -m unittest tests.test_planner_research tests.test_preplan_adversary tests.test_subagent_scorecard tests.test_telemetry_trace tests.test_current_iteration_state tests.test_skill_contracts` 通过，共 183 条测试。
- Follow-up review 后 `python3 -m unittest tests.test_preplan_adversary tests.test_skill_contracts` 通过，共 140 条测试。

### 约束与建议

- 不要因为多个 host helper 形状相似就提前抽 shared registry；先看 scorecard 是否证明三个以上 host 有真实复用或 drift 成本。
- 不要把 `multi_domain_count` 直接等同于 preplan adversarial trigger；preplan adversary 需要 major architecture、cross-module、high-risk 或 explicit challenge。
- 不要让 child evidence 变成父级 artifact 草稿；父级 host 负责最终 Plan、Spec、scope posture 和 closure。
- 不要只改 root helper；plugin dist 副本漏同步会造成不同 host 行为漂移。

---
*沉淀日期: 2026-05-24 | 来源: subagent host maturity second wave U1-U4 与 code review follow-up*

## Pattern: Repair Shared Baseline Contract Drift as Its Own Step

**领域**: Agent workflow / skill contract baseline / regression repair
**描述**: 当完整 skill contract suite 暴露 `skills/BASELINE.md` 这类共享契约漂移时，不要把修复塞进触发失败的业务 Plan，也不要削弱既有断言。更稳的做法是开一个独立的 one-step repair Plan，把现有测试当作 source of truth，只补回共享 baseline wording，并在 closure 后再回到原 Plan。

**reusability**: high
**next_reuse_scenarios**: [`完整 skill contract suite 在业务 Step 中暴露共享 baseline 漂移`, `修复共享 Skill wording 但不想扩大业务 Plan scope`, `需要保持已有 contract test 强度而不是改测试迁就文档`, `compounder 前发现 review-time validation 或 sync 入口语义漂移`]

### 场景

- 某个业务 Plan 的 focused guard 已通过，但完整 `tests.test_skill_contracts` 失败在共享 baseline section。
- 失败项是已有契约断言，例如 `Success Criteria`、`Collaboration Posture`、`Hub skill anatomy`、`Shallow Discovery`。
- 业务 Plan 的结果已经闭合或接近闭合，直接把 baseline 修复追加进去会混淆 scope 和 evidence。
- Review 需要验证 Plan JSON；历史上 `imm-plan --json` 曾同步当前 State Ledger，这类 validation/sync contract 漂移必须独立修复，不能混进业务 Plan。

### 方案模板

1. **先分流，不扩大原 Plan**: 如果失败 surface 是共享 baseline contract，创建独立 one-step repair Plan，Result 直接表达 baseline 满足既有 guards。
2. **测试是 source of truth**: 读取 `tests/test_skill_contracts.py` 中的既有断言和相关 solution pattern，只补齐缺失 wording，不降低断言强度。
3. **保持 baseline concise**: `BASELINE.md` 只承载跨 Skill 共用 guard，不把具体 Skill 的 workflow rules 全部搬进去。
4. **验证 sync contract**: review 历史或非当前 Plan 时使用 validate-only 入口；如果发现 validation 命令会写 State Ledger，应单独规划 CLI contract repair，而不是手工恢复 state 后继续忽略。
5. **回到上游业务 Plan**: repair Step 关闭后，下一步再恢复触发失败的原业务 Plan，而不是把两个 Plan 的 closure 证据混在一起。

### 可复用前提

- 失败来自已有 contract test，而不是新需求要求重写 Skill 架构。
- 共享 baseline 的缺口能通过文档 wording 修复，不需要改 runtime、plugin dist 或安装流程。
- 当前工作流允许为 post-review contract drift 创建小型 repair Plan。

### 验证依据

- [docs/specs/baseline-contract-repair.spec.md](docs/specs/baseline-contract-repair.spec.md) 将失败范围限定为 `BASELINE.md` 的四类既有 section wording。
- [docs/plans/2026-05-24-005-fix-baseline-contract-repair-plan.md](docs/plans/2026-05-24-005-fix-baseline-contract-repair-plan.md) 用 one-step repair 明确不修改 gstack P1 guidance scope。
- [skills/BASELINE.md](skills/BASELINE.md) 补回 Shared Guards、Success Criteria、Collaboration Posture、Hub skill anatomy 和 Shallow Discovery。
- `tests/test_skill_contracts.py` 保持既有断言强度，并通过完整 contract suite。
- `rtk python3 -m unittest tests.test_skill_contracts` 通过，共 135 条测试。
- `rtk python3 .imm/imm-work.py status --json` 显示 repair Plan 005 的 U1 closed，下一步为 `imm-compounder`。

### 约束与建议

- 不要把共享 baseline drift 当成原业务 Plan 的隐含子任务；它有自己的 source of truth 和 closure evidence。
- 不要通过修改 tests 降低已有 section wording 要求，除非另有明确 spec 要改变 contract。
- 不要让 validation 输出格式决定 runtime mutation；`--json` 应保持只读，写入必须走显式 sync 入口。
- 如果修复需要改 hub Skill、plugin dist 或 runtime 行为，说明已经超出 baseline wording repair，应重新规划。

---
*沉淀日期: 2026-05-24 | 来源: baseline contract repair U1 与 code review 状态恢复*

## Pattern: gstack Quality Ceiling as Skill Contract Guidance

**领域**: Agent workflow / Skill contracts / upstream borrowing
**描述**: 当从 gstack 借鉴强角色偏好、严格交互仪式和“湖水烧干式”完备性时，不要把它直接翻译成更重的 runtime、shared registry 或默认多角色 fan-out。更稳的做法是把这些哲学压进现有 Skill contract guidance：每个角色保留一个 `preferred bias` 和一个 `prohibited drift`，交互仪式压缩成 Entry / Exit gate，完备性只在 finite source packets 上启用，并用 contract tests 防止派生阶段被误写成输入源。

**reusability**: high
**next_reuse_scenarios**: [`借鉴上游 agent workflow 哲学但不想扩张 runtime`, `Skill contract wording 需要提升质量上限`, `closed-world completeness 被误用于普通小任务`, `review 发现派生阶段被写成 source input`]

### 场景

- 用户希望学习 gstack 的强角色偏好、严苛仪式和完备性哲学来提高 AI 质量上限。
- 本地系统已经有 `imm-planner`、`imm-executor`、`imm-qa`、`imm-compounder` 的角色边界，以及 `Brainstorm manifest -> Brainstorm Trace -> origin_coverage -> QA closure gate` 的闭环。
- 直接复制 gstack runtime、browser daemon、ONNX、Canary Token、shared registry 或重复 memory plane 会扩大 scope 并冲突既有 rejected boundaries。
- Review 发现文档把 `Brainstorm Trace`、`origin_coverage`、`QA closure gate` 这类 derived processing stages 写进 closed-world inputs，可能误导后续 agent 重新触发重流程。

### 方案模板

1. **角色偏好写成 contract pair**: 每个核心 Skill 用 `preferred bias` 表达它最该坚持的质量目标，用 `prohibited drift` 表达它绝不能越界承担的权力。
2. **仪式压缩为 Entry / Exit gate**: Entry gate 检查目标、边界、验证路径和会改变结果的不确定项；Exit gate 检查证据、风险、下一步和 authority handoff。
3. **完备性只吃 finite source packets**: closed-world inputs 只包括 `Brainstorm manifest` 和 explicit review follow-up packet 这类有限源输入。
4. **派生阶段单独命名**: `Brainstorm Trace`、`origin_coverage`、`QA closure gate` 是 derived processing stages，用来证明覆盖，不是新的 source input。
5. **用 focused guard 防漂移**: contract test 同时断言 key phrases 存在，并断言派生阶段不出现在 closed-world input 段落。
6. **保留 rejected boundaries**: `No shared registry`、`No duplicate memory`、`No browser daemon`、`No ONNX`、`No Canary` 必须留在 guidance 中，P2/P3 runtime 候选另开 Spec/Plan。

### 可复用前提

- 本地 workflow 已经有明确 Skill role boundary 和可验证 contract tests。
- 目标是提升 prompt / Skill contract 质量，而不是实现新的 runtime 能力。
- closed-world 输入是有限且显式声明的；普通小任务不能自动升级为 heavy completeness flow。

### 验证依据

- [docs/reference/gstack-quality-ceiling-protocol.md](docs/reference/gstack-quality-ceiling-protocol.md) 记录 Role Preference Contract、Interaction Ritual Gates、finite source packets、derived processing stages 和 rejected runtime boundaries。
- `tests/test_skill_contracts.py` 中 `test_gstack_quality_ceiling_protocol_preserves_boundaries` 锁定 `preferred bias`、`prohibited drift`、Entry / Exit gate，并确保 `Brainstorm Trace`、`origin_coverage`、`QA closure gate` 不在 closed-world input section。
- [docs/plans/2026-05-24-006-feat-gstack-quality-ceiling-protocol-plan.md](docs/plans/2026-05-24-006-feat-gstack-quality-ceiling-protocol-plan.md) 完成 quality ceiling protocol guidance 和 drift guard。
- [docs/specs/gstack-quality-ceiling-protocol.spec.md](docs/specs/gstack-quality-ceiling-protocol.spec.md) 明确本轮不新增 runtime、shared registry、browser daemon、classifier 或 memory plane。
- Code review follow-up 后 `python3 -m unittest tests.test_skill_contracts` 通过，共 136 条测试；`python3 .imm/imm-plan.py docs/plans/2026-05-24-006-feat-gstack-quality-ceiling-protocol-plan.md --json` 通过。

### 约束与建议

- 不要把强仪式误解成每个请求都要 Brainstorm manifest；只有 finite source packet 才触发 closed-world completeness。
- 不要把 derived processing stages 当成 source inputs；它们只证明覆盖关系。
- 不要把上游哲学借鉴变成 shared dispatcher、第二套 memory store 或 untrusted-output security runtime。
- 如果未来要实现 Accessibility Ref、browser daemon、ONNX 或 Canary Token，必须先 threat model，再单独开 Spec 和 Plan。

---
*沉淀日期: 2026-05-24 | 来源: gstack quality ceiling protocol Plan 006、code review follow-up 与 closure Plan 007*

## Pattern: Validate-Only CLI With Explicit Runtime Sync

**领域**: Agent workflow / CLI contracts / State Ledger
**描述**: 当同一个 CLI 同时承担 plan validation 和 runtime sync 时，不要让默认验证命令带写副作用。更稳的做法是把只读验证设为默认，把 State Ledger 写入放到显式 `--sync` 开关，并同步更新执行入口、planner handoff、plugin dist runtime 和 package parity tests。

**reusability**: high
**next_reuse_scenarios**: [`review 需要验证历史 Plan 但不能切换当前 State Ledger`, `CLI 既有 linter/validator 又有 runtime writer 能力`, `planner handoff 需要明确区分 merge-ready validation 与 execution-ready sync`, `plugin dist runtime 容易滞后于 repo runtime`]

### 场景

- Code review 或 docs verifier 需要运行 `imm-plan <plan> --json` 来检查历史 Plan、旧 Plan 或非当前 Plan。
- State Ledger 是当前执行真源；普通 validation 不应改变 `.imm/memory/current_iteration.json`。
- 执行入口仍需要已同步的当前 Plan，否则 `imm-work activate` 无法证明 step 属于当前 runtime。
- Repo runtime 与 `plugins/immune-brain/dist/.imm/` 都可执行，任一副本滞后都会造成宿主行为漂移。

### 方案模板

1. **默认验证只读**: `imm-plan <plan> --json` 只解析、校验并输出 normalized JSON，不调用 runtime sync。
2. **写入必须显式**: 只有 `imm-plan <plan> --sync` 才更新 State Ledger；`--json --sync` 可同时输出 JSON 与同步 runtime。
3. **执行入口提示 sync**: `imm-work` 对未同步或 plan mismatch 的报错必须明确提示 `imm-plan --sync`，避免用户以为 `--json` 已准备 runtime。
4. **Planner handoff 双门禁**: Planner 先要求 `imm-plan <plan> --json` 证明 Plan merge-ready，再要求 `imm-plan <plan> --sync` 准备 execution handoff。
5. **同路径 metadata-only 兼容**: 如果同一 Plan 只增加 planner-owned metadata 且 completed proof fields 不变，应保留已关闭 Step；删 Step 或改 completed proof fields 仍必须重置。
6. **Package parity 测试**: 对 `.imm/imm-plan.py`、`.imm/imm-work.py`、`.imm/imm_core/plan_runtime.py` 与 plugin dist 副本做 exact parity check，防止只修 repo runtime。

### 可复用前提

- validation 命令会被 review、docs、planner、executor 多角色复用。
- runtime state 是持久 source of truth，不允许历史验证命令悄悄切换当前执行上下文。
- CLI 仍需要保留一个显式 writer path，不能把 sync 逻辑散给 executor。

### 验证依据

- `.imm/imm_core/plan_runtime.py` 将 `--sync` 作为唯一 runtime sync 开关，默认 `--json` 不写 State Ledger。
- `.imm/imm-plan.py` CLI wrapper 同步采用 validate-only 默认。
- `.imm/imm-work.py` 未同步错误提示改为 `imm-plan --sync`。
- `plugins/immune-brain/dist/.imm/imm_core/plan_runtime.py`、`plugins/immune-brain/dist/.imm/imm-plan.py`、`plugins/immune-brain/dist/.imm/imm-work.py` 与 repo runtime 保持一致。
- [plugins/immune-brain/dist/imm-planner.md](plugins/immune-brain/dist/imm-planner.md) 明确 handoff 前运行 `imm-plan <plan-path> --sync`。
- `tests/test_imm_plan.py` 覆盖 default validation 不调用 sync、`--sync` 更新 runtime、历史 Plan validation 不改变 State Ledger、metadata-only same-plan sync 保留 closed steps。
- `tests/test_imm_work.py` 覆盖 activation guard 的显式 sync 入口。
- `tests/test_immune_brain_plugin_package.py` 覆盖 packaged runtime parity 与 planner handoff wording。
- `rtk python3 -m unittest tests.test_imm_plan tests.test_imm_work tests.test_skill_contracts tests.test_immune_brain_plugin_package` 通过，共 203 条测试。

### 约束与建议

- 不要把 `--json` 当成 execution handoff；它只证明 Plan 本身有效。
- 不要在 review 历史 Plan 后手工恢复 State Ledger；正确修复是让 validation 默认无写副作用。
- 不要只同步 root runtime；plugin dist runtime 和 planner skill 文本必须一起更新。
- 如果未来新增更多 CLI 输出格式，保持“默认只读、显式写入”的 contract，不要让格式参数隐式决定 mutation。

---
*沉淀日期: 2026-05-25 | 来源: validate-only plan command U1、code review follow-up 与 package parity repair*

## Pattern: Repo-Local Runtime Loader Tests Plus Package Parity

**领域**: Agent workflow / runtime contracts / test reliability
**描述**: 当 `.imm/imm_core/*.py` 这类 runtime 文件同时存在于工作区与已安装环境时，不要只通过 wrapper 入口或间接 import 来验证行为。更稳的做法是补一个直接从当前 repo path 加载 runtime 模块的 focused test，再用 plugin dist parity test 锁住打包副本，确保本地修复、已安装副本和兼容别名字段的语义一致。

**reusability**: high
**next_reuse_scenarios**: [`本地 runtime 与安装环境都可能提供同名模块`, `新增兼容字段但需要保证 legacy alias 仍对齐`, `wrapper 入口可能误导测试命中缓存安装`, `repo runtime 与 plugin dist 需要同时保持行为一致`]

### 场景

- 现有测试通过 `.imm/imm-plan.py` 或其他 wrapper 入口加载模块，但当前环境里已经存在一个同名安装副本。
- runtime 变更需要同时验证 repo-local 源文件和 plugin dist 副本。
- 需要给 legacy alias 字段保留兼容语义，但不能只测“字面存在”，要测数值与状态是否真的一致。
- review 关注的是当前工作区改动是否真的生效，而不是某个外部安装副本的历史状态。

### 方案模板

1. **直接加载本地 runtime**: 至少一个 focused test 用 `spec_from_file_location` 指向当前 repo 的 `.imm/imm_core/*.py`，不要依赖 wrapper import 的搜索路径。
2. **断言本地文件路径**: 测试里显式断言 `module.__file__` 落在当前工作区，避免误命中外部安装副本。
3. **把兼容别名当成行为契约**: 如果导出新字段同时保留 legacy alias，测试要断言两者数值一致，而不只是断言旧字段存在。
4. **保留 package parity**: 继续用 plugin dist parity test 锁住 `.imm/` 与 `plugins/immune-brain/dist/.imm/` 的同步，防止只修 repo runtime。
5. **把 loader test 留在同一测试簇**: 这类回归应放进已经覆盖 runtime contract 的单元测试文件里，保持证据和断言相邻，避免散成孤立 smoke test。

### 可复用前提

- 当前环境可能已经装有同名 runtime 或 plugin cache。
- 需要验证的行为属于 repo-local contract，而不是单纯 wrapper CLI 输出。
- plugin dist 与 repo 源文件都需要维持 exact parity。

### 验证依据

- `.imm/imm_core/plan_runtime.py` 与 `plugins/immune-brain/dist/.imm/imm_core/plan_runtime.py` 保持 exact parity。
- `tests/test_imm_plan.py` 新增 direct local loader 测试，显式断言本地文件路径与 `partially_covered` 行为。
- `tests/test_immune_brain_plugin_package.py` 将 `docs/reference/planning-quality-gate.md` 加入 source/dist parity 保护。
- [docs/solutions/contracts.md](docs/solutions/contracts.md) 现有 `Validate-Only CLI With Explicit Runtime Sync` 与本 pattern 共同约束 validate / sync / parity 边界。
- `python3 -m unittest tests.test_imm_plan tests.test_skill_contracts tests.test_immune_brain_plugin_package` 通过，共 195 条测试。

### 约束与建议

- 不要把 wrapper 入口通过了就当成本地 runtime contract 已被验证；wrapper 可能先命中环境里已有安装副本。
- 不要只测 legacy alias 的存在，不测新旧字段的语义对齐。
- 不要只更新 repo runtime；plugin dist parity 还是必须保留。

---
*沉淀日期: 2026-06-03 | 来源: roadmap/executable-slice contract review follow-up 与 repo-local runtime direct loader repair*

## Pattern: Packaged Reference Closure Tests

**领域**: Plugin packaging / Skill contracts / reference integrity
**描述**: 当插件把 Skill 正文、reference docs 和 runtime docs 打包到宿主缓存时，不要只校验顶层 `SKILL.md` 或 catalog refs。更稳的做法是把 packaged artifact 当成独立文件系统闭包来测：Markdown links、`docs/reference/*` 文本引用、以及反引号中的 packaged local paths 都必须能在插件包内解析；source-only upstream references 必须写成说明文字，不能保留成看似可加载的本地路径。

**reusability**: high
**next_reuse_scenarios**: [`插件 dist 文档引用 source repo 文件`, `新增 packaged reference index`, `安装后技能提示 agent 加载不存在文件`, `修复坏链后又从二级 reference 引入 upstream 路径`]

### 场景

- Plugin package 在 `plugins/immune-brain/dist/` 下携带 compiled Skill bodies，而 host 实际从 `.codex/plugins/cache/...` 等隔离路径加载。
- Skill 正文会指示 agent 读取 `docs/reference/*`、`skills/*/SKILL.md` 或 `dist/*`，这些路径安装后必须仍然可用。
- 一些 reference 文件本身是索引，可能继续指向 source repository 的 upstream submodules；如果直接打包这些索引，会把不可用路径带进插件。
- 只检查 `registry.yaml`、manifest、runtime entrypoint 或 activation catalog refs 无法发现这类二级 reference drift。

### 方案模板

1. **按插件根解析闭包**: 测试从 `plugins/immune-brain` 作为 package root 出发，扫描 `dist/**/*.md` 与 `skills/**/SKILL.md`。
2. **Markdown link 必须留在包内**: 对相对 Markdown links 做 `document.parent / target` 解析，要求路径存在且 `relative_to(PLUGIN_ROOT)` 成功。
3. **`docs/reference/*` 文本引用必须打包**: 即使不是 Markdown link，只要 Skill 或 reference 文本提到 `docs/reference/foo.md`，就要求 `dist/docs/reference/foo.md` 存在。
4. **反引号 local path 也要测**: 对 `` `docs/reference/...` ``、`` `docs/specs/...` ``、`` `skills/...` ``、`` `dist/...` ``、`` `upstreams/...` `` 这类 code spans 做 package-local 解析，防止二级 reference 继续引入不可用 upstream path。
5. **source-only upstream 写成 prose**: 如果插件不打包 upstream 全文，reference index 应写“source repository upstreams”，不要保留 `` `upstreams/...` `` 路径。
6. **避免无限打包**: 当一个 source spec 带有绝对路径或开发机路径时，不要把它直接补进 dist；改为把调用方文案降级为 source-only reference。

### 可复用前提

- 插件包是宿主运行时的实际 source of truth，不能假设完整仓库同路径存在。
- Skill 文本会让 agent 根据本地路径加载补充文档。
- Package 需要保持轻量，不应递归打包整个 repository 或 upstream submodules。

### 验证依据

- [docs/specs/plugin-package-reference-integrity.spec.md](docs/specs/plugin-package-reference-integrity.spec.md) 明确 packaged reference closure 目标和 non-goals。
- [docs/plans/2026-05-25-004-fix-plugin-package-reference-integrity-plan.md](docs/plans/2026-05-25-004-fix-plugin-package-reference-integrity-plan.md) 将修复分为 reference closure 与 regression guard 两步。
- `tests/test_immune_brain_plugin_package.py` 中 `test_packaged_skill_local_references_resolve_inside_plugin` 扫描 Markdown links、`docs/reference/*` 文本引用和反引号 local paths。
- [plugins/immune-brain/dist/docs/reference/agent-quality-checklists.md](plugins/immune-brain/dist/docs/reference/agent-quality-checklists.md)、[code-simplification-checklist.md](plugins/immune-brain/dist/docs/reference/code-simplification-checklist.md)、[compaction-handoff-hosts.md](plugins/immune-brain/dist/docs/reference/compaction-handoff-hosts.md) 将 upstream references 改成 source-only prose。
- `python3 -m unittest tests.test_immune_brain_plugin_package tests.test_skill_contracts` 通过，共 145 条测试。
- 手动 packaged path scanner 输出 `missing_packaged_paths 0`，且 `rg` 未发现 `` `upstreams/`` 或开发机绝对路径残留。

### 约束与建议

- 不要把 source repo 相对路径误当成 plugin package 相对路径；`dist/*.md` 的 `../BASELINE.md` 在安装包内就是坏链。
- 不要只修引用的第一跳；新打包的 reference 文件内部也要过同一套 closure 测试。
- 不要通过打包一个 source spec 来掩盖更深的绝对路径；如果该 spec 是 source-only 背景，应在 packaged policy 中改成 prose reference。
- 不要让测试扫描用户项目运行时路径如 `.imm/memory/*`、`docs/plans/*`，这些不是插件包应随附的静态依赖。

---
*沉淀日期: 2026-05-25 | 来源: plugin package reference integrity Plan 004、code review follow-up 与 packaged path scanner*

## Pattern: Explicit Sync Capability and Stale Wrapper Warnings

**领域**: Agent workflow / CLI contracts / Health checks
**描述**: 当 `imm-plan` 有多条可见执行路径时，不要把 PATH wrapper 的旧行为当作当前语义来源。应把“是否带 `--sync`”作为 tool contract 里可见能力，并把全局过时 wrapper 的偏差作为 health warning，而非强失败。

**reusability**: high
**next_reuse_scenarios**: [`MCP tool 参数需要表达 runtime write 能力`, `插件 runtime 与用户环境 PATH 版本漂移`, `希望在不阻塞 workflow 的前提下提示环境问题`, `把 validate 与 sync 的边界固化进 contract tests`]

### 场景

- `imm-plan --sync` 是 plan execution handoff 的前置能力，但用户 PATH 命令行只支持旧参数。
- health 检查需要发现本体能力与 PATH 全局命令能力不一致，但不能把 warning 计入 fail。
- 同一仓库既有 repo runtime、plugin runtime 与 plugin dist，三者在能力开关上要保持一致。

### 方案模板

1. **让 sync 成为显式参数**: MCP/host tool schema 增加 `sync` boolean，默认 false，`sync=true` 才发起 `imm-plan --sync`。
2. **默认只读校验**: `imm_plan_validate` 默认只发起 `imm-plan <plan> --json`，保持 validate 与 sync 解耦。
3. **同步告警但不中断**: health 中检测 PATH wrapper 是否支持 `--sync`，缺失时给可操作 warning 和修复建议。
4. **保持 plugin-parity**: 同一告警/参数行为在 `.imm/imm-heal.py` 与 `plugins/immune-brain/dist/.imm/imm-heal.py` 保持一致。

### 证据

- `plugins/immune-brain/dist/immune_brain_runtime.py` 的 `imm_plan_validate` schema 增加 `sync`，并正确映射 `sync` 与 `json` 组合。
- `.imm/imm-heal.py` 和 `plugins/immune-brain/dist/.imm/imm-heal.py` 新增 stale PATH wrapper 探测。
- `tests/test_immune_brain_mcp_runtime.py` 覆盖默认不传 sync、仅 json、json+sync 的三种分支。
- `tests/test_immune_brain_plugin_package.py` 覆盖 PATH wrapper 有无、过时、有能力三类场景。
- [docs/specs/stale-global-imm-plan-sync.spec.md](docs/specs/stale-global-imm-plan-sync.spec.md) 及 [docs/plans/2026-05-27-002-fix-stale-global-imm-plan-sync-plan.md](docs/plans/2026-05-27-002-fix-stale-global-imm-plan-sync-plan.md) 记录本次修复边界与闭环。

### 约束与建议

- 不要把用户级 PATH wrapper 当作本体真源；真源应来自 repo / plugin runtime contract。
- 不要把 warning 升级成 fail，否则会把环境污染与能力缺失混为“未完成”状态。
- 不要在默认 `--json` 里触发 State Ledger 写入；`--sync` 必须是明确 opt-in。

---
*沉淀日期: 2026-05-27 | 来源: stale global imm-plan sync Plan U1-U2、code review follow-up 与 docs/solutions/packaged reference closure tests*

## Pattern: Constitution-Driven Contract Guards and Export-Symbol Test Alignment

**领域**: Agent workflow / Documentation sync / Test architecture
**描述**: 随着系统的演进，核心规约文件（如 `IMMUNE.md`）很容易由于开发人员遗忘而与实际代码逻辑或工具链参数脱节。此时，不应仅仅依赖开发人员的手工同步，而应在测试套件中编写声明式的“契约测试”（如基于 AST 解析或特定短语扫描），强制将最新特性名词、Agent 角色及命令行规则记录到系统宪法中。此外，测试用例必须严密对齐实现模块导出的实际符号，防止符号重构引发 `AttributeError` 等静态死角。

**reusability**: high
**next_reuse_scenarios**: [`在规约中新增核心 Agent 协作职责描述`, `修改核心常量或导出符号`, `确保命令行新选项被全局文档真实覆盖`, `防止代码重构破坏静态测试套件`]

### 场景

- 新增了 `imm-autowork`、`parallel_probes` 等核心工作流及参数约定，但 `IMMUNE.md` 未予体现，可能导致后来的 Agent 遵循旧的协作规约造成行为漂移。
- 开发人员希望以最低成本维护一份真实的宪法规约，防止文档自然衰减（Decay）。
- 在测试包初始化逻辑时，测试用例为了验证导入结果，手工引用了内部常量。后来该常量在主模块中重构，但遗留测试未被运行，导致系统在生产发布时突然抛出 `AttributeError` 崩溃。

### 方案模板

1. **规约契约化**: 在契约测试中引入对规约文件（如 `IMMUNE.md`）的内容扫描。
2. **名词与断言强绑定**: 在测试中使用 `self.assertIn`、`content.count` 等，强制检查规约中是否包含特定的演进名词（例如 `imm-autowork`、`parallel_probes`、`--sync`、`gstack quality ceiling` ）。
3. **测试引用导出源**: 测试用例中的常数引用必须与实现代码的导出别名严格一致（例如直接使用 `self.module.START` 而非过期的内部表示 `self.module.AGENTS_SECTION_START`），确保单一真源。
4. **验证自动化与一键覆盖**: 将契约扫描集成进 `mise run test` 默认验证链路，任何未同步规约或符号漂移都会直接阻断集成，迫使开发人员保持文档与代码的高内聚性。

### 证据

- [IMMUNE.md](IMMUNE.md) 正式升至 `v1.1.0`，包含完整的 `imm-autowork`、`parallel_probes`、`--sync` 显式提交、gstack 质量上限与 `host-bound evidence loops` 描述。
- `tests/test_imm_init.py` 修复 `AttributeError` 并对齐为 `self.module.START`。
- `tests/test_skill_contracts.py` 包含针对 `IMMUNE.md` 最新核心词条与名词占位符的声明式静态扫描契约，共运行并成功通过 140 项测试。
- `mise run test` 单元测试通过，全套 523 项测试全部绿灯。

### 约束与建议

- 不要编写过于脆弱的字符串测试。契约测试应聚焦于**核心概念**及**协作职责划分**，而非细节语法。
- 宪法文档的演进应当是**增量且保守**的，仅记录确定性已落地、受测试保护的运行时规约，避免 speculative documentation。
- 测试用例中测试实现符号时，应尽可能依赖公共导出模块（Public Export API），不建议穿透到过于深层的私有变量。

---
*沉淀日期: 2026-05-29 | 来源: quality-fixes-round-1 Plan U1-U3、code review 与 140 项静态契约回归测试*

## Pattern: Shared Dispatch Vocabulary, Host-Owned Dispatch Logic

**领域**: Agent workflow / subagent dispatch contracts / runtime parity
**描述**: 当多个 host-bound dispatch helper 反复复制 activation mode、fallback reason、attempt status、tool policy 或 boundary wording 时，不要直接抽 shared dispatcher。更稳的做法是只把无副作用的词汇、校验、去重和状态标准化收敛到小模块；trigger matching、fallback map、delegation envelope、host prompt 仍留在各 host helper。这样能消除常量漂移，又不把业务调度权提前交给通用平台。

**reusability**: high
**next_reuse_scenarios**: [`多个 host helper 重复 fallback/status 常量`, `review 发现 helper wording 漂移但 shared registry 证据不足`, `新增 dispatch host 时需要统一 tool policy 与 boundary vocabulary`, `plugin dist 与 repo runtime 必须保持 helper parity`]

### 场景

- 系统已有多个 host-bound helper，如 `work_probes`、`domain_mapper_dispatch`、`party_dispatch`、`planner_research`、`preplan_adversary`、`brainstorm_research`、`code_review_subagents`。
- helper 的通用词汇开始重复，但每个 host 的触发条件、证据形状和 delegation packet 仍明显不同。
- 既有 solution 已明确反对在证据不足时推进 shared registry 或 generic dispatcher。

### 方案模板

1. **只抽纯词汇层**: 新建小模块集中 `DEFAULT_RUNTIME`、`NO_FALLBACK`、activation mode、attempt status、tool policy、boundary wording 等常量，以及 `normalize_attempt_status`、`validate_activation_mode`、`fallback_explanation`、`unique_ordered` 这类纯函数。
2. **host 继续拥有调度逻辑**: trigger matching、fallback map、probe/finding shape、delegation envelope 和 host prompt 不进共享模块，避免把不同 role 的 authority 边界混在一起。
3. **用测试锁身份与边界**: 每个 helper 保留 focused tests，断言 fallback reason、runtime identity、readonly/no-tools policy 和 boundary text 没有漂移。
4. **同步 plugin dist**: 共享词汇模块本身和所有触达 helper 都要进入 plugin runtime parity 测试，避免 repo 运行时与 packaged runtime 行为分裂。
5. **把 shared dispatcher 作为后续证据门**: 只有当 scorecard 或 drift 数据显示三个以上 host 在 envelope/trigger 层有真实重复成本时，才单独开平台化 Plan。

### 证据

- `.imm/imm_core/dispatch_contracts.py` 与 `plugins/immune-brain/dist/.imm/imm_core/dispatch_contracts.py` 承载共享词汇与纯函数。
- `.imm/imm_core/work_probes.py`、`.imm/imm_core/domain_mapper_dispatch.py`、`.imm/imm_core/planner_research.py`、`.imm/imm_core/preplan_adversary.py`、`.imm/imm_core/brainstorm_research.py`、`.imm/imm_core/code_review_subagents.py` 继续保留 host-specific envelope 与 fallback 逻辑。
- `tests/test_work_probes.py`、`tests/test_domain_mapper_dispatch.py`、`tests/test_party_dispatch.py`、`tests/test_planner_research.py`、`tests/test_preplan_adversary.py`、`tests/test_brainstorm_research.py`、`tests/test_imm_review.py` 覆盖 helper 行为与边界词汇。
- `tests/test_immune_brain_plugin_package.py` 的 runtime parity manifest 覆盖本轮 touched runtime sources，包括 `dispatch_contracts.py`。
- `python3 -m unittest tests.test_imm_work tests.test_immune_brain_plugin_package tests.test_work_probes tests.test_domain_mapper_dispatch tests.test_party_dispatch tests.test_planner_research tests.test_preplan_adversary tests.test_brainstorm_research tests.test_imm_review tests.test_skill_contracts tests.test_compound_debt_inventory` 通过 294 tests；`python3 -m unittest tests.test_imm_plan tests.test_current_iteration_state tests.test_workflow_loop tests.test_immune_brain_mcp_runtime` 通过 87 tests；touched runtime `py_compile` 与 `git diff --check` 均通过。

### 证据批判

- 支持的结论是“共享词汇可以减少漂移”，不是“共享 dispatcher 已经值得做”。
- `.imm/memory/dispatch_telemetry.jsonl` 本轮只有 activation-plan planned entries；由于 Codex subagent spawn 需要显式用户授权，实际 advisory execution 未发生，不能把它当作 subagent ROI 证据。
- 如果未来 helper 开始共享 envelope construction 或 trigger graph，应该用新的 scorecard/drift 数据重新评估，而不是继续把差异塞进 `dispatch_contracts.py`。

### 约束与建议

- 不要把 host prompt、packet schema 或 role-specific fallback map 放进共享词汇模块。
- 不要用“多个 helper import 同一模块”作为 shared registry 的充分理由；平台化需要跨 host 的 adopted/degraded 证据。
- ADR 暂不需要：本轮是可逆的小模块收敛，未改变调度 authority 或外部接口。

---
*沉淀日期: 2026-06-01 | 来源: architecture convergence wave 4 U1-U5、code review follow-up 与 runtime parity verification*

## Pattern: Host-Bound Probe Contract Primitives

**领域**: Agent workflow / readonly probe contracts / host-owned dispatch
**描述**: 当多个 probe-style host helper 反复构造 readonly `focus_delta`、Codex/Cursor call fragment、fallback explanation 和 child outcome normalization 时，不要升级成通用 dispatcher。更稳的做法是抽一个无副作用的 probe contract helper，只输出可嵌入的 contract primitives；host helper 继续拥有 envelope construction、host-specific evidence、fallback context、synthesis 和 telemetry。这样能减少 probe contract 漂移，同时守住“shared primitive, host-owned dispatch”的边界。

**reusability**: high
**next_reuse_scenarios**: [`多个 readonly probe host 重复 no-tools focus_delta`, `Codex/Cursor probe call shape 在 helper 间漂移`, `failed/missing/timeout child outcomes 丢失 host 上下文`, `新增 packaged runtime helper slice 需要 parity 测试保护`]

### 场景

- `work_probes`、`domain_mapper_dispatch`、`brainstorm_research`、`planner_research` 都需要 readonly/no-tools 子代理探针形状。
- 每个 host 的 envelope、evidence 字段和 synthesis 结果不同，但公共 primitive 已经重复到容易漂移。
- 既有 rejected learning 已明确：shared registry 或 generic dispatcher 需要更强证据，不能被一次 helper 去重顺手引入。

### 方案模板

1. **抽纯 primitive helper**: 新建 `probe_contracts.py`，只暴露 `readonly_focus_delta`、`build_dispatch_call`、`explain_fallback`、`normalize_child_outcome` 这类纯函数；不读配置、不写状态、不写 telemetry、不执行 dispatch。
2. **保护 readonly 边界字段**: `readonly_focus_delta` 必须拒绝 `extra` 覆盖 `role`、`tool_policy`、`readonly`、`boundary`，以及显式传入时的 `output_schema`，避免 host 调用方无意破坏 no-tools contract。
3. **failure payload 保留 host 语义**: `normalize_child_outcome` 的 missing/failed/timeout 分支要允许 host 提供 `failure_payload`，这样 Work Probe 的 `probe/scope`、Domain Mapper 的 `shard/covered_paths`、Planner Research 的空 evidence、Brainstorm Research 的空 manifest 都不会在异常路径丢失。
4. **host 继续构造 envelope 和 synthesis**: 共享 helper 不能接管 trigger matching、subagent selection、delegation envelope、host prompt、telemetry 或 result synthesis；这些仍留在各 host 模块。
5. **repo runtime 与 packaged runtime 同步**: 新 helper 及所有迁移 host helper 都要同步到 `plugins/immune-brain/dist/.imm/imm_core/`，并纳入 `tests/test_immune_brain_plugin_package.py` parity manifest。

### 证据

- `.imm/imm_core/probe_contracts.py` 提供纯 probe contract primitives，并在文件注释中声明不 dispatch、不写 state/telemetry。
- `.imm/imm_core/work_probes.py`、`.imm/imm_core/domain_mapper_dispatch.py`、`.imm/imm_core/brainstorm_research.py`、`.imm/imm_core/planner_research.py` consume the primitives while retaining host-owned envelopes and synthesis.
- `tests/test_probe_contracts.py` 覆盖 readonly field protection、Codex/Cursor call fragments、unsupported runtime rejection、fallback explanation delegation、success/missing/timeout outcome normalization。
- `tests/test_work_probes.py`、`tests/test_domain_mapper_dispatch.py`、`tests/test_brainstorm_research.py`、`tests/test_planner_research.py` lock host-specific behavior after migration.
- `tests/test_immune_brain_plugin_package.py` now includes `.imm/imm_core/probe_contracts.py` in runtime parity coverage.
- `python3 -m unittest tests.test_probe_contracts tests.test_work_probes tests.test_domain_mapper_dispatch tests.test_brainstorm_research tests.test_planner_research tests.test_immune_brain_plugin_package tests.test_skill_contracts` passed with 213 tests; `python3 .imm/imm-plan.py docs/plans/2026-06-05-001-feat-host-bound-probe-contract-helper-plan.md --json` passed.

### reusability_critique_notes

- Falsifiability: 如果未来 helper 开始共享 trigger graph、retry scheduler、model routing 或 telemetry ownership，这个 pattern 就不足够；那会是 shared dispatcher/platform work，需要新的 evidence gate。
- Evidence trail: 证据来自完成的 2026-06-05 Plan U1-U3、focused probe/host tests、package parity tests 和 plan validation；没有实际 subagent ROI 或 scorecard 证据。
- Architecture entropy resistance: 追加到 contracts hub，因为这是跨 host 的 contract primitive pattern；不新建 solution 文件，避免把一个 helper 去重误包装成新架构层。`CONTEXT.md` Architecture Map 已补充 `probe_contracts.py`，因为它现在是长期 runtime navigation entry。

### dispatch_metrics

- dispatch_count: 3 planned parallel probes in U2.
- solo_fallback_count: 3.
- fallback_reasons: `unavailable_environment` x3.
- dispatch_efficiency: `.imm/memory/dispatch_telemetry.jsonl` only records planned solo fallback entries for this run, so it supports fallback visibility but not subagent result value.
- scorecard_summary: `.imm/memory/subagent_scorecard.jsonl` is absent; `shared_registry_review.status = insufficient_evidence`.

### 约束与建议

- 不要把 `probe_contracts.py` 扩展成 registry、scheduler、model router 或 telemetry sink。
- 不要让 `extra` 覆盖 readonly/no-tools contract 字段；host-specific metadata 应只追加在非保护字段。
- ADR 暂不需要：本轮是可逆 helper extraction，且没有改变外部接口或 dispatch authority。

---
*沉淀日期: 2026-06-05 | 来源: host-bound probe contract helper Plan U1-U3、dehydrated U2 child_evidence before finish*

## Pattern: Pre-Implementation Advisory Skill Contract Rollout

**领域**: Skill contract / frontend workflow / documentation routing
**描述**: 当需要对于 UI 页面或布局进行前置规范定义时，不应局限于物理布局（网格、表单最大宽度等），也不应在缺少设计来源时发明默认风格。更稳的做法是把它扩展为来源驱动的页面设计契约（`page_design`）：默认收敛信息层级、区块结构、操作区、表单宽度与响应式；有设计来源或用户明确要求时才定义视觉字段，例如 `visual_palette`、`theme`、`image_strategy`、`motion_contract` 与 `aesthetic_genre`；缺少来源时标记为 `unknown` / `not_applicable` 并记录 open question。通过 Standard 与 Rich 两档复杂度分级（`design_tiers`），后置 UI Review 实施声明式对照审计并按严重性分级，避免主观美学裁判。该契约应作为独立 pre-implementation contract surface：轻量 shim + compiled dist 正文 + registry artifact + focused contract test + 用户入口文档同步，并产出可被 planner/work/reviewer 消费的契约工件，同时明确不写代码、不创建 fallback 设计文件、不改变默认主线。

**reusability**: high
**next_reuse_scenarios**: [`新增生成前 advisory skill`, `把 UI/design 规则前移到页面级设计契约`, `有设计来源或用户明确要求时才定义视觉字段`, `后置 UI Review 实施参数化对照审计以杜绝主观美感评判`]

### 场景

- 现有 `imm-ui-review` 只能事后评审 UI，容易沦为主观美学评判；用户需要实现前先锁定版式、操作区、响应式，以及来源支持的视觉/主题/动效约束。
- 已有 rejected learning 禁止 reviewer 在缺少 `DESIGN.md` 时生成 fallback style 或默认 SaaS 风格。
- 新 skill 升级扩展为 `page_design` 契约，需要兼容原布局能力，并提供设计等级（Standard/Rich）以应对不同复杂度的任务；Rich 视觉字段必须有来源或明确要求。

### 方案模板

1. **独立 skill surface**: 在 `plugins/immune-brain/skills/<name>/SKILL.md` 添加轻量 loader，在 `plugins/immune-brain/dist/<name>.md` 写完整 contract。保持 progressive disclosure，不引入无用资源目录。
2. **artifact first**: 明确新 skill 的输出工件（如 `page_design`），让后续 `imm-planner`、`imm-work` 或 `imm-ui-review` 有稳定引用物，而不是只输出风格建议。
3. **registry 双副本同步**: 同时更新 `plugins/immune-brain/skills/registry.yaml` 和 `plugins/immune-brain/dist/registry.yaml`，并声明 role、role_class、output_artifacts、next_actions、boundary。
4. **用户入口同步**: 更新 README、用户手册、技能全景指南，说明何时使用、插入位置和非默认边界。不要把可选设计步骤写进所有任务默认主线。
5. **声明过的文档面必须闭合**: 如果 Spec 或 Plan 把某个文档列为更新面，该文件必须实际新增/改写对应入口；若它只是导航占位或无独立条目，必须在 Spec/Plan 中明示 no-op，并用测试锁住该 no-op 解释。不要只断言“旧词不存在”，否则会掩盖“承诺更新但实际没更新”的假阳性。
6. **contract test 锁边界**: 在 `tests/test_skill_contracts.py` 加 focused assertions，覆盖 skill 存在、registry artifact、核心规则、blocked 行为、输出工件和每个声明文档面的新入口或 no-op 解释。

### 证据

- [plugins/immune-brain/skills/imm-page-design/SKILL.md](plugins/immune-brain/skills/imm-page-design/SKILL.md) 添加轻量 loader。
- [plugins/immune-brain/dist/imm-page-design.md](plugins/immune-brain/dist/imm-page-design.md) 定义 reduction-first、single-message sections、list/detail page rules、action/info separation 和 `page_design`。
- [plugins/immune-brain/skills/registry.yaml](plugins/immune-brain/skills/registry.yaml) 与 [plugins/immune-brain/dist/registry.yaml](plugins/immune-brain/dist/registry.yaml) 注册 `imm-page-design`。
- [README.md](README.md)、[docs/user_manual.md](docs/user_manual.md)、[docs/reference/immune-brain-skills-guide.md](docs/reference/immune-brain-skills-guide.md) 和 [docs/reference/immune-brain-skill-details/README.md](docs/reference/immune-brain-skill-details/README.md) 说明它在页面任务中按需插入于 `imm-planner` 后、`imm-work` / `imm-ui-review` 前。
- `tests/test_skill_contracts.py` 增加 `test_imm_page_design_defines_pre_implementation_design_contract`，并断言每个声明文档面都出现 `imm-page-design`、`page_design` 与来源驱动视觉字段边界。
- `python3 -m unittest tests.test_skill_contracts`、`python3 .imm/imm-plan.py docs/plans/2026-06-15-001-feat-imm-page-design-expansion-plan.md --json` 和 targeted packaged reference checks 通过。

### reusability_critique_notes

- Falsifiability: 如果某个新增 skill 实际拥有执行或 QA 权限，或需要 runtime parser 支持，就不能照搬该模式；那应进入 planner/runtime 方案而不是 advisory contract rollout。
- Evidence trail: 证据来自完成的 `imm-page-design` skill 文件、registry 双副本、用户文档入口、focused contract test、Plan validator、packaged reference checks，以及 follow-up code review 发现并修复 `skill-details` 声明更新面缺口。
- Architecture entropy resistance: 追加到 contracts hub，因为这是 skill contract rollout 模式；不新建独立 solution 文件，避免把一次 skill 增量包装成新架构层。`CONTEXT.md` Architecture Map 不需要更新，因为没有新的 runtime 导航入口，只有可发现 skill surface 和用户文档入口。

### 约束与建议

- 不要把 pre-implementation advisory skill 混进 post-implementation reviewer；二者产物和时机不同。
- 不要为了“更完整”把可选设计步骤写成默认必经关卡；保持主线轻量，页面任务按需插入。
- 不要让 Spec/Plan 的“需要更新文档列表”变成空承诺；每个声明文档面都要有正向断言，或明确记录它为什么是 no-op。
- 不要在该 skill 中生成 `DESIGN.md`、CSS、组件或测试；实现仍回到 `imm-work` / executor，复核回到 `imm-ui-review`。

---
*沉淀日期: 2026-06-05 | 来源: page layout design skill rollout；2026-06-16 更新为 imm-page-design expansion、docs follow-up、code review closure*

## Pattern: Bidirectional Architecture Explorer Contract

**领域**: Skill contract / architecture exploration / overdesign control
**描述**: 当架构探索 skill 已经擅长发现浅模块、弱边界和耦合问题时，不要只继续强化“加深架构”的方向。更稳的做法是在同一个 explorer contract 中加入反向的 **Overdesign Scan**：用可证据化信号识别过度抽象，并要求推荐候选同时说明“保留复杂度的证据”和“更无趣的简单替代”。这样可以避免为单消费者接口、空转扩展点、传话层或平台化早产继续加抽象，同时不创建新的简化架构 skill。

**reusability**: high
**next_reuse_scenarios**: [`架构审计倾向只找欠设计`, `skill 合约需要同时约束过度耦合和过度解耦`, `reviewer/explorer 想推荐简化但必须保持 read-only`, `需要用 contract test 防止新规则漂成运行时扫描器或新 skill`]

### 场景

- `imm-arch-explorer` 已经要求 Architecture Deepening、coupling evidence、ADR Awareness 和 Best-Fit Challenge。
- 用户希望发现架构过度设计问题，而不是只增加一个“简化架构视角”或新 skill。
- 过度设计判断如果没有证据，很容易退化成主观“我觉得复杂”。

### 方案模板

1. **放在现有 explorer contract 内**: Overdesign Scan 是架构探索的一部分，不是新的默认 workflow stage，也不是独立 `imm-simplify-architecture` skill。
2. **列出可观察信号**: 至少覆盖 single-consumer abstractions、idle extension points、pass-through layer stacks、premature platformization、ceremonial state models、domain-language erosion、structure-only tests 和 change-cost mismatch。
3. **保留复杂度的正当化门槛**: 当前复杂度只有在有多个真实消费者、已承诺 roadmap 压力、ADR 约束、test-backed behavior 或清晰 ownership isolation 时才算合理。
4. **推荐检查双向化**: Recommended Candidate Check 不只问 blast radius、cost of doing nothing 和 simpler boring alternative，也要问 evidence that justifies keeping the current complexity。
5. **测试锁住边界**: focused contract test 断言 Overdesign Scan、关键 overdesign signals、simplification candidate、No Automatic Rewrite 和 `imm-planner` handoff，防止规则漂成自动改代码或 runtime scanner。

### 证据

- [docs/specs/imm-arch-explorer-overdesign-scan.spec.md](docs/specs/imm-arch-explorer-overdesign-scan.spec.md) 定义 accepted behavior、overdesign signals、output contract 和 non-goals。
- [plugins/immune-brain/dist/imm-arch-explorer.md](plugins/immune-brain/dist/imm-arch-explorer.md) 新增 `Overdesign Scan`、`Overdesign Evidence` 和 recommended-candidate complexity justification。
- [plugins/immune-brain/skills/imm-arch-explorer/SKILL.md](plugins/immune-brain/skills/imm-arch-explorer/SKILL.md) 同步 wrapper contract，提示 read-only exploration includes Overdesign Scan signals。
- `tests/test_skill_contracts.py` 新增 `test_arch_explorer_has_overdesign_scan_policy`，锁住信号与边界。
- `python3 -m unittest tests.test_skill_contracts` passed with 149 tests；`python3 .imm/imm-plan.py docs/plans/2026-06-06-001-feat-imm-arch-explorer-overdesign-scan-plan.md --json` passed with origin coverage complete.
- 两轮 `imm-code-review` 后无剩余 findings；review follow-up 已修正 State Ledger `changed_files` 结构。

### reusability_critique_notes

- Falsifiability: 如果未来 explorer 的任务是建立全新架构底座，或已经有 ADR 明确要求通用平台化，这个模式不能用来反对必要抽象；它只适用于“是否继续加深架构”仍需证据判断的探索场景。
- Evidence trail: 证据来自完成的 2026-06-06 Plan U1、Spec、skill contract edits、focused contract test、plan validation、State Ledger closure 和两轮 code review。没有 runtime scanner 或实际代码重构效果证据，所以本学习保持在 skill contract 层。
- Architecture entropy resistance: 追加到 contracts hub，因为这是 skill contract + verification surface 的边界模式；不新建 solution 文件，避免把一个 explorer 合约补强包装成新架构层。`CONTEXT.md` Architecture Map 不需要更新，因为没有新增 runtime 导航入口。

### 约束与建议

- 不要把 Overdesign Scan 写成“所有抽象都有罪”；必须保留 ADR、真实消费者、测试行为和 ownership isolation 这些正当化证据。
- 不要让 explorer 自动删抽象；它只产出候选和证据，执行仍走 `imm-planner` / `imm-work`。
- 不要创建新的简化架构 skill，除非未来有多次独立证据证明 explorer 内嵌反向扫描不够用。

---
*沉淀日期: 2026-06-06 | 来源: imm-arch-explorer overdesign scan Plan U1、code review follow-up closure*

## Pattern: Project-Level Output Language Policy for Persisted Prose

**领域**: Skill contract / user language preference / persisted documentation
**描述**: 当 agent workflow 需要支持用户设定输出语言时，不要把语言偏好做成会翻译所有 token 的机器规则。更稳的做法是把它定义为项目级 Output Language Policy：用户可在项目指令或 Immune-Brain 配置中声明偏好语言；agent 的用户可见说明遵循该语言；持久化 workflow 文档默认 English，只有显式 document-language 指令才改变文档语言；schema 字段、enum、CLI JSON、State Ledger keys、文件路径、工具名和代码标识符保持 literal。

**reusability**: high
**next_reuse_scenarios**: [`需要区分 reply language 与 document language`, `已有项目希望设置默认回复语言`, `新增配置项但不能改变机器契约`, `bootstrap 模板需要给用户留下可编辑语言策略`, `自然语言策略检测反复出现 false positive / false negative`]

### 场景

- 用户希望 Immune-Brain 在中文、英文或其他语言中稳定输出，而不是每次都靠 prompt 纠正。
- Workflow 会持久化 spec、plan、handoff、solution、memory 等人类可读文档；这些文档默认应保持 English，除非用户、项目指令或配置明确指定 document language。
- 同一个 artifact 混有人类 prose 和机器可消费字段，不能把语言偏好扩展到 schema / enum / JSON keys。
- 已有项目与新项目都需要可发现、可覆盖的语言设置入口。

### 方案模板

1. **分层优先级**: 明确当前用户消息优先，其次项目级 `AGENTS.md` / developer instruction，再其次 Immune-Brain `[output_language]` 偏好，最后才是默认语言。
2. **拆开 reply language 与 document language**: reply-only 指令只影响用户可见回复和短摘要；持久化 `HANDOFF.md`、`docs/brainstorms/`、`docs/specs/`、`docs/plans/`、`docs/solutions/` 默认 English，只有显式 document-language 指令才改变它们。
3. **项目模板暴露入口**: `imm-init` 生成的 `AGENTS.md` 应包含可编辑 Output Language Policy 占位，让已有/新项目都能在项目根指令中设置语言。
4. **配置作为偏好，不抢显式指令**: `[output_language]` 是用户级默认偏好；它不能覆盖当前对话里的显式语言要求，也不能覆盖更近的项目指令。
5. **测试锁住“不翻译机器契约”**: focused contract tests 要同时断言语言策略存在，以及不能建议翻译 schema、enum、CLI JSON、State Ledger keys、file paths、tool names、code identifiers。
6. **Planner 局部门槛**: 共享 baseline 里的语言策略不够；`imm-planner` 自身要有 Output Language Gate 和 Red Flag，要求写 Spec / Plan 前读取项目语言策略。
7. **Artifact 显式声明**: Plan / Spec 模板在 `Task` 后写 `## Output Language`，让 reviewer 和后续 agent 一眼看到人类正文语言与保留 literal 的边界。
8. **Validator 先 warning 后严格**: `imm-plan --json` 可先输出非阻断 `output_language` warning，避免英文项目误伤；严格模式应等误报率稳定后再加。
9. **按 artifact 检查语言**: Plan 和引用 Spec 要分别计算正文语言信号，不能汇总后判断；否则中文 Plan 会掩盖英文 Spec。
10. **自然语言策略检测分层**: detector 必须按 statement 判断“语言 + 文档范围”是否同句出现；保护 `*.md` literal 后再切句；对 `do not write documents in Chinese`、`Documents default to English, not Chinese`、`文档默认使用 English` 这类否定/排除语义先行排除；并用 direct runtime tests 覆盖 reply-only、explicit document-language、literal path 和 negative-policy 四类样例。

### 证据

- [README.md](README.md) 在默认输出契约附近记录 `Output Language Policy`。
- [docs/reference/immune-brain-config.md](docs/reference/immune-brain-config.md) 和 [plugins/immune-brain/dist/docs/reference/immune-brain-config.md](plugins/immune-brain/dist/docs/reference/immune-brain-config.md) 记录 `[output_language]` 配置、优先级和边界。
- [skills/BASELINE.md](skills/BASELINE.md)、[plugins/immune-brain/skills/BASELINE.md](plugins/immune-brain/skills/BASELINE.md) 和 [plugins/immune-brain/BASELINE.md](plugins/immune-brain/BASELINE.md) 定义共享语言策略。
- [skills/imm-init/templates/AGENTS.md](skills/imm-init/templates/AGENTS.md) 和 [plugins/immune-brain/skills/imm-init/templates/AGENTS.md](plugins/immune-brain/skills/imm-init/templates/AGENTS.md) 为项目级语言设置保留可编辑占位。
- `tests/test_skill_contracts.py` 和 `tests/test_imm_init.py` 覆盖 shared contract 与 bootstrap template。
- `python3 -m unittest tests.test_skill_contracts tests.test_imm_init`、`python3 .imm/imm-plan.py docs/plans/2026-06-08-006-feat-user-configured-output-language-plan.md --json`、`git diff --check` 和 baseline/template/config mirrored `cmp` checks 通过；`imm-code-review` decision 为 pass。
- [plugins/immune-brain/dist/imm-planner.md](plugins/immune-brain/dist/imm-planner.md) 后续加入 Output Language Gate、对应 Red Flag，并修正 handoff sync 说明：优先 MCP `imm_plan_validate(sync=true)`，CLI `imm-plan <plan-path> --sync` 仅在安装版本支持时使用。
- [.imm/templates/iteration-plan-template.md](.imm/templates/iteration-plan-template.md) 与 `plugins/immune-brain/dist/.imm/templates/iteration-plan-template.md` 后续加入 `## Output Language` section。
- `.imm/imm_core/plan_runtime.py` 与 packaged copy 后续加入 Chinese policy warning：读取 `AGENTS.md`、`IMMUNE.md` 或 `[output_language]` config，忽略 code fences、inline code、路径、命令、表格字段和 canonical terms 后扫描正文。
- `tests/test_imm_plan.py` 后续覆盖 English Plan warning、JSON warning、config `zh-CN`、无 policy 时省略 `output_language`、历史未引用 docs 不影响当前 Plan、以及引用 English Spec 在中文策略下 warning。
- 后续验证：`python3 -m unittest tests.test_imm_plan tests.test_skill_contracts tests.test_immune_brain_plugin_package.PluginPackageTest.test_packaged_runtime_matches_repo_runtime_sources tests.test_immune_brain_plugin_package.PluginPackageTest.test_planner_handoff_mentions_explicit_runtime_sync tests.test_immune_brain_plugin_package.PluginPackageTest.test_plugin_local_imm_plan_help_exposes_sync` 通过 199 tests；`python3 -m py_compile .imm/imm-plan.py .imm/imm_core/plan_runtime.py plugins/immune-brain/dist/.imm/imm-plan.py plugins/immune-brain/dist/.imm/imm_core/plan_runtime.py`、`git diff --check` 和 runtime/template parity `cmp` checks 通过。
- `imm-code-review` 曾发现 P2：语言信号汇总会让中文 Plan 掩盖英文 Spec；修复为 per-artifact 检查后，第二轮 review 无 actionable findings。
- [docs/specs/document-language-default-policy.spec.md](docs/specs/document-language-default-policy.spec.md) 与 [docs/plans/2026-06-22-001-fix-document-language-default-policy-plan.md](docs/plans/2026-06-22-001-fix-document-language-default-policy-plan.md) 后续收紧：persisted Immune-Brain documents default to English，reply-only Chinese project instructions do not change document language。
- `.imm/imm_core/plan_runtime.py` 与 `plugins/immune-brain/dist/.imm/imm_core/plan_runtime.py` 后续把 document-language policy detector 改为 statement-level matching，保护 `HANDOFF.md` / `*.md` literal，并加入 negative-policy gate。
- `tests/test_imm_plan.py` 后续覆盖 reply-only Chinese policy ignored、template document guidance ignored、`zh-CN` config ignored、explicit `docs/specs` / `docs/plans` config warning、`HANDOFF.md` scope detection、negative phrases such as `Do not write documents in Chinese` and `Documents default to English, not Chinese`。
- 2026-06-22 focused verification passed: 17 related language-policy tests, `py_compile` for repo and packaged runtime, `git diff --check`, manual detector probes, and packaged runtime parity. Multiple `imm-code-review` rounds found and then closed false-positive/false-negative edges around cross-sentence matching, `HANDOFF.md`, ordinary English sentence splitting, and negative policy wording.

### reusability_critique_notes

- Falsifiability: 如果未来项目允许同一 Plan / Spec 有意混用多种人类语言，或者 validator 误报率高到阻断正常英文项目，这个 pattern 需要降级为 reviewer-only guidance 或增加 artifact-level opt-out。若 detector 需要支持更复杂自然语言（多语言否定、quoted examples、Markdown tables），应升级为 explicit structured config/schema，而不是继续扩展 fragile substring rules。
- Evidence trail: 证据来自完成的 Plan U1、Spec、README/config/baseline/template 文档更新、focused tests、Plan validation、QA pass、code review pass，以及后续 planner gate、template section、`imm-plan` warning、per-artifact Spec regression、199-test focused suite、2026-06-22 English document default regression suite、manual detector probes and repeated code-review follow-up closure。
- Architecture entropy resistance: 追加到 contracts hub，因为这是跨 skill 的语言契约与验证边界；`CONTEXT.md` Architecture Map 已有 plan validation / durable learnings 导航，不需要新增入口。

### 约束与建议

- 不要把语言偏好写成“翻译所有输出”；机器字段必须保持稳定。
- 不要让 `[output_language]` 覆盖当前用户显式要求；近端指令优先。
- 已有项目设定回复语言时，优先在项目根 `AGENTS.md` 添加或修改 reply-language policy；只有确实要改变持久化文档语言时，才写 explicit document-language policy。
- 不要只在 shared baseline 写语言策略；planner contract、生成模板和 validator warning 至少要覆盖一层“模型会忘”的风险。
- 不要用 aggregate English / Chinese ratio 判断混合 artifact；当前 Plan 和引用 Spec 应分别给出 pass / warning 信号。
- 不要用 whole-document substring detection 判断 document-language policy；reply-only 语言、文档默认说明、否定句和文件名 literal 会互相污染。

---
*沉淀日期: 2026-06-08 | 来源: user-configured output language Plan U1、QA pass、code review pass*
*更新日期: 2026-06-09 | 来源: planner Output Language Gate、Plan template section、imm-plan warning、per-artifact Spec regression、code review P2 fix*
*更新日期: 2026-06-22 | 来源: document-language default policy Plan U1-U2、reply-vs-document language regression、HANDOFF.md literal fix、negative policy detector fix、code review follow-up closure*

## Pattern: Confirmation Gate Before Planner Handoff

**领域**: Skill contract / framing-stage routing / planner handoff
**描述**: 当一个只读 framing skill 会提出推荐方向并把用户送入 planner 时，不能只靠 agent 判断 framing stable 就自动 handoff。更稳的做法是把 planner handoff 拆成两段：先给推荐方案并请求用户确认；只有用户明确确认 proposed direction / scope 后，才把 `imm-planner` 作为当前 Next Action。这样保留低摩擦推荐路径，同时避免“讨论还没确认就进入规划”的 workflow 漂移。

**reusability**: high
**next_reuse_scenarios**: [`framing skill 会自动推荐 planner`, `用户抱怨还没确认方案就进入下一阶段`, `Next Action 既要给建议又不能伪装成人工授权`, `需要用 focused contract test 锁住 handoff gate`]

### 场景

- `imm-brainstorm` 已支持内联收窄挑战，并能把稳定 framing 交给 `imm-planner`。
- 用户期望先讨论方案，等明确说“确认 / 可以 / 按这个来”后再进入 planner。
- 旧文案把 “framing stable” 和 “planner-ready” 混在一起，导致默认 Next Action 太容易写成 `imm-planner`。

### 方案模板

1. **把 stable framing 和 confirmed handoff 分开**: stable framing 只代表问题边界清楚；planner handoff 还需要用户显式确认 proposed direction / scope。
2. **允许推荐但不允许伪 handoff**: brainstorm 可以写“我建议这样做”，但未确认时 Next Action 只能请求确认，不把 `imm-planner` 写成当前 next skill。
3. **manifest 只在确认后生成/交接**: `Brainstorm manifest` 是 planner 的 closed-world 输入；未确认时不要把建议 scope 包装成已确认 handoff。
4. **focused regression 锁住门槛**: 测试要同时断言 explicit user confirmation、recommended direction before confirmation、do not name a next skill 和 confirmation missing fail path，避免后续文案回漂。
5. **同步 Plan verification selector**: 如果新增 focused test，Plan 里的 Verification 必须使用真实可解析的 unittest selector；否则 runtime sync 会带着坏命令进入执行证据。

### 证据

- [docs/specs/imm-brainstorm-confirmation-gate.spec.md](docs/specs/imm-brainstorm-confirmation-gate.spec.md) 定义显式确认 gate、推荐方案能力、未确认时不命名 planner 和只读边界。
- [docs/plans/2026-06-09-001-fix-imm-brainstorm-confirmation-gate-plan.md](docs/plans/2026-06-09-001-fix-imm-brainstorm-confirmation-gate-plan.md) 以 one-step Plan 闭合该 contract 行为，并记录 Brainstorm Trace。
- [plugins/immune-brain/dist/imm-brainstorm.md](plugins/immune-brain/dist/imm-brainstorm.md) 将 `Default Next Route` 收紧为 confirmation-before-planner，未确认时要求请求确认而不是 skill route。
- `tests/test_skill_contracts.py` 新增 `test_brainstorm_requires_explicit_confirmation_before_planner_handoff`，并保留 terse handoff 与 inline clarification regression。
- `python3 -m unittest tests.test_skill_contracts.SkillContractTests.test_brainstorm_requires_explicit_confirmation_before_planner_handoff tests.test_skill_contracts.SkillContractTests.test_brainstorm_defines_terse_default_handoff tests.test_skill_contracts.ReviewFollowUpAppendContractTests.test_inline_clarification_and_preplan_demotion tests.test_skill_contracts.SkillContractTests.test_gated_handoff_discipline_in_workflow_skills && python3 .imm/imm-plan.py docs/plans/2026-06-09-001-fix-imm-brainstorm-confirmation-gate-plan.md --json` 通过。
- `imm-autowork` 完成 Step U1，`imm-qa` 记录 pass；`imm-code-review` solo review 无 findings。activation plan 曾触发 `api_contract` lens，但当前 Codex subagent 工具要求用户显式请求 subagents，因此未派发。

### reusability_critique_notes

- Falsifiability: 如果用户直接点名 `imm-planner` 且 scope 已经明确，或 planner 自己的 bootstrap 入口正在处理直接规划请求，不应强制绕回 brainstorm 确认；该模式只约束已进入 framing skill 后的 handoff。
- Evidence trail: 证据来自完成的 confirmation-gate Spec、Plan U1、test-first focused regression、Plan validation、autowork execution evidence、QA pass 和 code review pass。
- Architecture entropy resistance: 追加到 contracts hub，因为这是 handoff contract 与 regression pattern；不更新 `CONTEXT.md` Architecture Map，因为没有新增 runtime、目录或长期导航入口。

### 约束与建议

- 不要把“确认后 planner”写成恢复 `imm-preplan-review` 默认阶段；preplan 仍是高风险可选 gate。
- 不要在未确认时输出 `Brainstorm manifest`，否则 planner 可能把建议误读成 confirmed requirements。
- 不要只改 skill prose；要配 focused contract test，最好还在 Plan verification 中跑到这条 test。
- 如果后续要把确认状态机器化，先回到 planner 定义 schema；不要让 brainstorm 写运行态。

---
*沉淀日期: 2026-06-09 | 来源: imm-brainstorm confirmation gate Plan U1、QA pass、code review pass*

## Pattern: Per-Phase Human Acceptance Criteria in Multi-Phase Roadmaps

**领域**: Agent workflow / Roadmap planning / verification contracts
**描述**: 多阶段路线图（Roadmap）中，每个 deferred phase 必须携带结构化的 `acceptance_criteria`，使得开发者无需阅读实现代码即可独立判定阶段是否闭环。`acceptance_criteria` 必须描述可观测的行为（behavior assertions），而非内部技术信号（如“测试通过”）。它与描述“何时可以启动下一阶段”的 `promotion_criteria` 相互独立且相互配合。

**reusability**: high
**next_reuse_scenarios**:

- `imm-planner` 规划包含 3 个及以上 phase 的多阶段任务时强制要求该结构。
- `imm-plan.py --json` 在 Phase 3 对路线图规约（Spec）实施 L1（结构完整性）与 L2（行为描述合规性）校验。
- 路线图的 deferred phase 被推进（promote）到可执行计划（Plan）时，其 `acceptance_criteria` 作为 Plan 级验收条件的来源。

### 方案模板

1. **结构分离**: 每一个 Phase 同时定义 `acceptance_criteria`（是否做完）与 `promotion_criteria`（是否能启动下一阶段）。
2. **行为断言要求**: `acceptance_criteria` 下 of 每一条断言必须采用用户/外部视角的可观测行为格式（例如 `当<条件>时，系统应<行为>`，或 `运行<命令>后，输出包含<预期>`）。严禁使用 `测试通过` 或 `CI passes` 等宽泛的技术/过程性描述。
3. **双轨验证模式**: 明确区分 `verification_mode: observable`（人工视觉/交互确认）与 `verification_mode: verifiable`（命令行执行并判定输出），它们都应最终由人类或验证脚本在外部视角做出客观判定。
4. **推进继承**: 在 deferred phase 晋升为 Plan 时，自动将其 `acceptance_criteria` 完整复制并添加阶段前缀作为 Traceability 继承至 Plan 验收条件段。

### 证据

- [docs/specs/roadmap-human-acceptance-gating.spec.md](docs/specs/roadmap-human-acceptance-gating.spec.md) 定义了该合约规约、L1/L2 校验边界、双轨验证模式。
- [docs/plans/2026-06-27-001-feat-roadmap-human-acceptance-gating-phase1-plan.md](docs/plans/2026-06-27-001-feat-roadmap-human-acceptance-gating-phase1-plan.md) 闭合了 Phase 1 阶段定义（Step U1）。
- [docs/brainstorms/roadmap-example-notification-system.md](docs/brainstorms/roadmap-example-notification-system.md) 作为通知系统的示例文档，成功行使并校验了该格式的可用性，证明模式是可填充且可验证的。
- [CONTEXT.md](CONTEXT.md) 新增 `Phase`、`acceptance_criteria` 和 `promotion_criteria` 作为 canonical 术语并定义了它们在架构图上的关系。

### reusability_critique_notes

- Falsifiability: 如果任务本身是一次性或双阶段以内的小型迭代，强制要求 per-phase `acceptance_criteria` 会带来过度仪式感（Spec 已在 R3 中放开限制，单/双阶段可选）。如果 `verifiable` 模式被滥用于断言单元测试通过（如 pytest 运行），它将退化为内部技术信号，破坏外部行为断言的本意。
- Evidence trail: 证据链包含完整的 Phase 1 特征 Spec、Plan U1、CONTEXT.md 新术语图谱更新、通知系统实例路线图、以及 `imm-autowork`/`imm-review` 成功的状态记录。
- Architecture entropy resistance: 追加到 contracts hub，因为这是关于规划校验契约的复用沉淀；不更新 `CONTEXT.md` Architecture Map，因为这次变更是在已有的 Roadmap 概念下细化字段属性，没有增加新的 runtime 或导航入口。

### 约束与建议

- 验收条件必须是面向外部可观测行为的判据。非行为判据（如“代码审查通过”）在 L2 校验阶段必须抛出警告。
- `promotion_criteria` 不能只写“验收条件通过人工评审”，它应当着重反映依赖性解锁、环境就绪或利益相关方确认等外部晋升前置条件。
- 严禁在单步/双步的极简规划中强制阻断缺失 `acceptance_criteria`，保持极简规划的轻量级与敏捷性。

---
*沉淀日期: 2026-06-27 | 来源: roadmap-human-acceptance-gating Phase 1 Plan U1、QA pass、code review pass*

## Pattern: MCP-First Runtime Contracts with Plugin-Local CLI Fallback

**领域**: Agent workflow / runtime contracts / plugin fallback
**描述**: 当一个 host-facing 工具既能通过 MCP 暴露，又需要 CLI fallback 时，不要把缺失的全局 PATH wrapper 误判为 runtime 不可用，也不要因此改成 CLI-only 架构。更稳的做法是保留 MCP-first，把 plugin-local wrapper 与直接 runtime CLI 作为可测试 fallback，最后才把全局 installed CLI 当成可选便利入口；只有这些本体路径都不可用时才报告 `activation_runtime_unavailable`。

**reusability**: high
**next_reuse_scenarios**:

- MCP 工具在某个 host 不可见，但 plugin package 自带 runtime wrapper 可执行。
- review/dispatch host 需要区分 `trigger_not_hit`、`explicit_required`、`host_authorization_required` 与真实 runtime 不可用。
- 全局 PATH wrapper 漂移或缺失，但 repo/plugin-local runtime 仍是 source of truth。
- 需要避免因为某个 host MCP 接入失败而重构成 CLI-only。

### 场景

- `imm-code-review` 需要先调用 `imm_activation_plan` 生成 activation plan，再决定是否触发 bounded advisory subagents。
- 用户环境可能没有全局 `imm-activation-plan`，但 `plugins/immune-brain/bin/imm-activation-plan` 和 `bun plugins/immune-brain/runtime/immune_brain_runtime.ts cli imm-activation-plan` 都可执行。
- 如果 contract 只写“installed CLI fallback”，review host 会把 PATH 缺口解释成 subagent activation chain unavailable，从而不必要地 solo fallback。

### 方案模板

1. **固定 ordered fallback**: MCP tool -> plugin-local wrapper -> direct runtime CLI -> optional installed CLI -> explicit unavailable reason。
2. **把 PATH wrapper 降级为便利入口**: 缺失全局 command 只能是环境提示，不能作为本体 runtime failure。
3. **用 runtime surface tests 锁住真实可执行性**: 测试应覆盖 `list-tools`、framed MCP `tools/list`、framed MCP `tools/call`、direct runtime CLI 和 plugin-local wrapper。
4. **用 contract tests 锁住 skill wording**: source loader 与 packaged dist 文本都要说明 ordered fallback、禁止 CLI-only 替代、并保持 same-boundary `follow_up` 路由到 `imm-work`。
5. **fallback reason 分层**: `activation_runtime_unavailable` 只表示 MCP 与 plugin-local fallback 都不可用；触发缺失、策略限制、授权缺失继续使用各自 reason code。

### 证据

- [tests/activation-plan-runtime-surface.test.ts](tests/activation-plan-runtime-surface.test.ts) 覆盖 `imm_activation_plan` 的 list-tools、MCP tools/list、MCP tools/call、direct runtime CLI、plugin-local wrapper。
- [tests/code-review-activation-contract.test.ts](tests/code-review-activation-contract.test.ts) 覆盖 ordered fallback wording、禁止 CLI-only 替代、same-boundary `follow_up` 路由。
- [plugins/immune-brain/dist/imm-code-review.md](plugins/immune-brain/dist/imm-code-review.md) 明确 `activation_runtime_unavailable` 与 `trigger_not_hit`、`explicit_required`、`host_authorization_required` 的区分。
- [plugins/immune-brain/skills/imm-code-review/SKILL.md](plugins/immune-brain/skills/imm-code-review/SKILL.md) 在 loader-visible 层保留同一 fallback 边界，避免只读 stub 掩盖 host 行为契约。
- `bun test tests/activation-plan-runtime-surface.test.ts tests/code-review-activation-contract.test.ts` 通过，8 项测试全绿。

### reusability_critique_notes

- Falsifiability: 如果未来 host 完全不支持 MCP 且产品明确放弃 MCP-capable clients，本模式会变成过度兼容；但当前 `.mcp.json` 与 MCP tool surface 仍是 Codex/Cursor/Claude 的默认 host path，因此 CLI-only 不是更小解。
- Evidence trail: 证据链包含 runtime surface 可执行测试、skill contract wording 测试、Plan U1/U2 QA pass、以及 final code review 的 `trigger_not_hit` solo fallback 记录。
- Architecture entropy resistance: 追加到 contracts hub，因为该学习约束的是 host/runtime contract 与 fallback reason 分层；不更新 `CONTEXT.md` Architecture Map，因为没有新增 runtime 入口，只澄清既有 MCP/CLI fallback 边界。

### 约束与建议

- 不要用 `which imm-activation-plan` 判定 activation runtime 是否存在；先检查 plugin-local wrapper 和 direct runtime CLI。
- 不要把 `python3 .imm/activation_plan.py` 重新引入 review-host fallback；它最多是 full-checkout development reference。
- 不要把 `activation_runtime_unavailable` 用来表达 trigger 未命中、explicit policy 或 host authorization 缺口。
- 不要在同边界 review follow-up 中改 Plan；应发 `follow_up` artifact 给 `imm-work`。

---
*沉淀日期: 2026-06-30 | 来源: activation-plan-runtime-fallback Plan U1-U2、QA pass、final code review pass*

## Pattern: CLI-Only Runtime Contracts with Command Manifest Discovery

**领域**: Agent workflow / runtime contracts / plugin integration
**描述**: 当产品明确放弃协议 server 兼容并选择 CLI-only runtime 时，不要只删除协议入口；必须同时提供 plugin-local wrappers、直接 runtime CLI、结构化 `list-commands --json` manifest、负向 contract tests 和 active docs 清理。这样可以保留 agent-facing 可发现性，同时降低 stdio/framing/server 维护成本。

**reusability**: high
**next_reuse_scenarios**:

- 需要从协议 adapter 迁移到 plugin-local CLI，但仍要给 host/agent 保留结构化 command discovery。
- 删除 server/launcher/config 后，测试仍在期待 `tools/list`、`tools/call` 或旧 tool schema。
- active docs 和 packaged Skill contracts 对 fallback 顺序出现漂移。
- release template 或 developer task 仍校验已删除的 protocol config。

### 场景

- `plugins/immune-brain/runtime/immune_brain_runtime.ts` 已经有 `cli <command>` 和 `runImmCommand(...)`，协议入口只是 thin adapter。
- 删除协议 server 后，核心 CLI smoke 仍通过，但测试和文档会集中暴露旧 contract。
- 裸 CLI 会丢失 tool discovery，因此需要 `list-commands --json` 作为 CLI-native manifest。

### 方案模板

1. **CLI runtime 成为唯一入口**: 保留 `plugins/immune-brain/bin/imm-*` 和 `bun plugins/immune-brain/runtime/immune_brain_runtime.ts cli <command>`。
2. **删除协议 surface**: 删除 server config、launcher、framing parser、protocol request dispatcher、tool-to-command adapter 和旧 discovery mode。
3. **补结构化发现**: 新增或保留 `list-commands --json`，列出 command、description、args、examples 和 JSON 输出能力。
4. **测试从工具协议迁移到命令契约**: 把 `tools/list` / `tools/call` / initialize 测试改成 CLI manifest、wrapper smoke 和 removed-mode negative tests。
5. **同步 active contracts**: README、CONTEXT、user manual、Skill source/dist、reference docs、release template 和 developer tasks 必须一致描述 CLI-only。
6. **保留 authority 边界**: transport 迁移不得改变 Plan、State Ledger、QA、review gate 或 Compounder 语义。
7. **在 canonical router 分类访问权**: 即使新命令是 shadow-only/read-only，也必须注册到统一 manifest、统一 `cli <command>` dispatcher 和显式 project-access table；plugin-local wrapper 只做 argv 透传，不得直接启动内部 command module 形成第二入口。

### 证据

- [plugins/immune-brain/runtime/immune_brain_runtime.ts](plugins/immune-brain/runtime/immune_brain_runtime.ts) 暴露 `list-commands --json` 和 `cli <command>`，并删除协议 server mode；shadow-only `imm-kernel` 同样经该 router 注册、发现和访问分类，而 wrapper 不直接执行内部 module。
- [tests/plugin-package-runtime.test.ts](tests/plugin-package-runtime.test.ts)、[tests/activation-plan-runtime-surface.test.ts](tests/activation-plan-runtime-surface.test.ts)、[tests/host-runtime-cutover.test.ts](tests/host-runtime-cutover.test.ts)、[tests/python-reference-boundary.test.ts](tests/python-reference-boundary.test.ts) 覆盖 CLI manifest、wrapper smoke、canonical single-entrypoint、read-only byte invariants 和 removed protocol mode。
- [README.md](README.md)、[CONTEXT.md](CONTEXT.md)、[docs/reference/automatic-subagent-activation-policy.md](docs/reference/automatic-subagent-activation-policy.md)、[docs/user_manual.md](docs/user_manual.md)、[public-release/templates/README.md](public-release/templates/README.md)、[public-release/templates/mise.toml](public-release/templates/mise.toml) 已同步 CLI-only wording。
- `bun test` 通过 90 tests；`mise run check-plugin` 通过；`plugins/immune-brain/bin/imm-plan docs/plans/2026-07-03-002-refactor-cli-only-runtime-plan.md --json` 通过；expanded active/package stale-scan 覆盖 `public-release/templates`、README、CONTEXT、`docs/reference`、`docs/user_manual.md`、plugin dist 与 skill templates，确认当前行为层不再指向已删除的 protocol surface。

### reusability_critique_notes

- Falsifiability: 如果目标 host 仍强依赖协议 tool schema 或不能安全执行 plugin-local CLI wrapper，CLI-only 会降低集成质量；此模式只适用于产品已明确接受删除协议兼容的场景。
- Evidence trail: 证据链包含 worktree removal spike、Plan U1/U2 execution evidence、90-test Bun suite、expanded active/package stale-scan、developer task `mise run check-plugin`、QA passes、solo code-review gate pass，以及 review follow-up 对 public release template、init template、planner/UI/autowork/compounder stale wording 的修复。
- Architecture entropy resistance: 追加到 contracts hub，因为这是 runtime integration contract 与 test migration 模式；已更新 `CONTEXT.md` Architecture Map，将 plugin-local runtime 导航改为 Bun + TypeScript CLI runtime、wrappers 与 `list-commands --json`。

---
*沉淀日期: 2026-07-10 | 来源: risk-tiered Technical Design conformance U1*

## Pattern: Risk-Tiered Technical Design Conformance

**领域**: Agent workflow / planner and QA contract / design traceability
**描述**: 不要为每个改动创建独立设计文档、强制 Mermaid 或新增 approval state。以 Spec 作为唯一 Technical Design 基线：Low risk 可保持简洁；Medium/High risk 在 Spec 记录可验证的边界、决策、invariant 与 failure behavior；仅在结构、时序、数据流或状态关系需要时使用 Mermaid。Plan 只引用基线。最终 QA 以 `Spec -> implementation evidence` 检查一致性：局部实现不符走 `rework`，边界或设计意图改变走 `replan` 并由 Planner 先更新 Spec。

**reusability**: high
**next_reuse_scenarios**: [`复杂 workflow contract 需要设计基线`, `想避免全局 Mermaid ceremony`, `实现发现与原设计不一致`, `需要把设计偏差路由回既有 Planner/QA authority`]

### 证据

- `plugins/immune-brain/dist/imm-planner.md` 定义 Low/Medium/High 设计深度、单一 Spec authority 和条件 Mermaid。
- `plugins/immune-brain/dist/imm-qa.md` 在最终 closure 前要求 `Design Conformance`，并明确 `rework`/`replan` 路由及 QA 不得批准设计改动。
- `docs/reference/planning-quality-gate.md` 与 packaged mirror 将设计深度、基线、图示意图和 conformance 加入 elevated-risk guidance。
- `tests/technical-design-conformance-contract.test.ts` 加上 `tests/dist-docs-sync-contract.test.ts` 通过 8 个 focused assertions；`imm-plan --json` 无 warnings；`git diff --check` 通过；solo `imm-code-review` 无 findings。

### reusability_critique_notes

- Falsifiability: 若长期证据显示自然语言风险分级被系统性误用，或 Plan parser 能可靠判定设计字段，再单独规划 machine-enforced validator slice；不要把该 guidance 伪装成已自动强制的规则。
- Evidence trail: 本次证据是 Planner/QA/quality-gate contract、source/dist mirror、focused positive/negative assertions、Plan validation 与 formal review gate；没有 runtime schema 或 semantic diagram parser 证据。
- Architecture entropy resistance: 追加到现有 contracts hub，因为该模式复用既有 Spec、Plan、Planner 与 QA authority；它明确拒绝独立 Technical Design 文档系统、全局 Mermaid 门禁和额外 approval state。未更新 `CONTEXT.md` Architecture Map：现有 Skill contracts、Plan validation 与 durable learnings 导航已覆盖这些入口。

---
*沉淀日期: 2026-07-10 | 来源: risk-tiered Technical Design conformance U1*

## Pattern: Help Flags Must Short-Circuit Before State Access

**领域**: CLI contract / State Ledger safety
**描述**: 对会改变 workflow state 的 command，`--help` 和 `-h` 不是普通参数；它们必须在加载、创建或保存 State Ledger 前成功返回 usage。把 help 处理留到 action dispatch 之后，会让检查命令意外记录 QA 决定或 reset iteration。保持 action-local guard，并用不存在与已存在 State Ledger 的 byte-level regression 覆盖前置/后置 help flag 与正常 action control。

**reusability**: high
**next_reuse_scenarios**: [`新增会写 workflow state 的 CLI command`, `给既有 CLI 增加 help`, `wrapper 仅透传到共享 runtime`, `测试命令是否可能在检查时产生副作用`]

### 证据

- `plugins/immune-brain/runtime/immune_brain_runtime.ts` 在 `runReviewCommand` 和 `runFinishCommand` 中，于 State Ledger access 前处理 `--help` / `-h`。
- `tests/plugin-package-runtime.test.ts` 证明 `imm-review` 和 `imm-finish` 在无 State Ledger 或既有 active State Ledger 时的 help 都零变更，并保留正常 `imm-finish` reset control。
- `bun test tests/plugin-package-runtime.test.ts`、Plan validation 和 `git diff --check` 通过；solo `imm-code-review` 无 findings。

### reusability_critique_notes

- Falsifiability: 无状态或纯查询 command 不需要此模式；若 command 的 help 本身必须读取只读 schema metadata，也只需保持不写 State Ledger。
- Evidence trail: 本次缺陷由 `imm-review pass --help` 误写 pass 与 `imm-finish --help` 误 reset 直接暴露，修复后以 isolated-root byte comparisons 和 normal-action control 验证。
- Architecture entropy resistance: 追加到 contracts hub，因为是共享 TypeScript CLI 的安全边界；只加两处 command-local guards，不新增 global parser、wrapper layer 或 State Ledger schema。

---
*沉淀日期: 2026-07-10 | 来源: CLI help no-state-mutation U1*

### 约束与建议

- 不要删除 discovery 后只留下裸 CLI；agent-facing runtime 至少需要 machine-readable command manifest。
- 不要让 release template、developer tasks 或 packaged Skill docs 继续校验已删除的 config file。
- 不要用 transport 迁移顺手改变 workflow authority；review gate、QA pass、State Ledger sync 仍必须走原有 runtime primitives。
- 旧的协议优先模式可以作为历史 rejected/previous decision 保留，但 active contracts 必须只描述当前入口。

---
*沉淀日期: 2026-07-03 | 来源: cli-only-runtime Plan U1-U2、QA pass、solo code review gate pass*

## Pattern: Semantic Roadmap Slices with Non-Authoritative Successors

**Domain**: Planning contracts / Roadmap progression / workflow authority

**Description**: Large initiatives should keep full scope in a durable Roadmap while each executable Plan owns one semantically cohesive slice. A Plan boundary follows outcome, authority, risk, verification, review, promotion, and rollback cohesion; file count, token count, compactions, and review rounds are only scope-pressure evidence. When continuation identity must be machine-readable, use opt-in static Phase metadata and keep declaration, Planner validation, user approval, and runtime activation as separate facts.

**reusability**: high

**next_reuse_scenarios**:

- A multi-phase initiative is becoming one large Plan with unrelated authority or verification boundaries.
- A Planner needs to identify the likely next Roadmap Phase without creating or activating its Plan.
- A validator needs to add successor metadata without migrating legacy Plans.
- Session size, file count, or review rounds are being proposed as automatic workflow gates.

### Reusable template

1. Keep the Spec/Roadmap authoritative for full initiative scope, stable Phase IDs, acceptance criteria, promotion criteria, deferred work, and non-goals.
2. Give the current Plan one `Plan boundary` and a rationale based on semantic cohesion. Promote independent authority, risk, verification, review, promotion, or rollback boundaries into later Plans.
3. Record quantitative signals as `Scope pressure`; never let them alone decide Plan validity or session lifecycle.
4. Use an explicit versioned contract for static metadata. In `roadmap-slice/v1`, require a Roadmap source, current Phase, execution scope, zero or one direct successor candidate, and successor preconditions.
5. Make validation opt-in and pure. Plans without the contract retain legacy behavior, while contracted Plans receive deterministic local shape checks without resolving Roadmap membership, Plan files, approval, or State Ledger state.
6. Treat successor declaration, successor Plan creation and validation, explicit user approval, and atomic runtime activation as distinct transitions owned by different authorities.
7. Bind one direct transition to canonical predecessor/successor identities and an opaque Ledger revision. Under the write lock, recheck revision, Plan bytes, closure, review gates, and linkage before atomically archiving the predecessor, appending one transition, and installing only pending successor Steps.
8. Derive status and host-checkpoint successor facts from the current Plan plus Ledger bytes; never persist the projection as approval-like state. Missing or drifted Plan identity must fail the entire read without external writes.
9. Preserve closure ordering: independent QA and required reviews, explicit Compounder handoff, `imm-finish`, then `awaiting_user_successor_decision` for a non-terminal successor. That checkpoint has literal user authority, no next skill, and no automatic Planner, transition, Compounder, host, or session action.
10. Mirror successor facts into HANDOFF only for human continuity. Label the mirror stale-tolerant and non-authoritative, and never parse it to recover approval or activation state.

### Evidence

- `docs/specs/2026-07-28-roadmap-plan-boundary-successor.spec.md` defines the P1-P4 Roadmap, semantic boundary model, authority separation, compatibility rules, and user-owned session lifecycle.
- `docs/plans/2026-07-28-002-feat-roadmap-plan-boundary-successor-phase1-plan.md` applies the model to a two-Step P1 slice and preserves P2-P4 as deferred Roadmap content.
- `plugins/immune-brain/dist/imm-planner.md`, `docs/reference/planning-quality-gate.md`, `.imm/templates/iteration-plan-template.md`, and `CONTEXT.md` expose one consistent authoring vocabulary.
- `plugins/immune-brain/runtime/plan_core.ts` implements pure opt-in validation. `tests/plan-validation.test.ts` covers valid, missing, malformed, terminal, self-successor, unknown-contract, legacy, free-text, and validate-only no-write behavior.
- `tests/roadmap-plan-boundary-contract.test.ts` locks semantic sizing, non-authoritative successor wording, advisory scope pressure, user-owned sessions, and packaged quality-gate parity.
- `docs/plans/2026-07-28-003-feat-roadmap-plan-boundary-successor-phase2-plan.md`, `plugins/immune-brain/runtime/state_ledger.ts`, and `tests/roadmap-plan-transition-{state,runtime}.test.ts` prove strict identity, revision-bound approval, lock-time rereads, append-only archive/transition records, compatibility, and failure/no-write semantics.
- `docs/plans/2026-07-29-001-feat-roadmap-plan-boundary-successor-phase3-plan.md`, `plugins/immune-brain/runtime/immune_brain_runtime.ts`, and `tests/roadmap-plan-progression-{runtime,contract}.test.ts` prove derived status, post-finish literal-user stop, lifecycle priority, terminal/legacy controls, role-option rejection, HANDOFF non-authority, and session-neutral repeated reads.
- P3 final verification passed 54 focused tests and 141 transition/workflow compatibility tests, runtime build, Plan validation with zero warnings, deterministic dist-doc sync, primary LSP, independent QA, and exact-signature `imm-code-review` with zero accepted findings.

### reusability_critique_notes

- Falsifiability: This pattern is too heavy for a small one-Plan change with no credible successor, or false if future product policy deliberately delegates activation authority away from the user. Its current guarantees are also insufficient if the product needs DAG topology, multiple active Plans, Roadmap membership proof, historical adoption, or cross-host acceptance; those require separately designed authority and compatibility contracts.
- Evidence trail audit: P1 tests prove semantic authoring and opt-in validation; P2 tests prove one truthful revision-bound append-only direct transition; P3 tests and independent gates prove derived projection, closure ordering, user stop, role separation, HANDOFF non-authority, and no-write/session-neutral behavior. The evidence deliberately does not prove P1-to-P2 historical approval, global Roadmap topology, migration policy, or cross-host UAT.
- Architecture entropy resistance: Append to the existing contracts hub because P2/P3 complete the runtime and workflow portions of the same Roadmap-slice authority pattern. `CONTEXT.md` Architecture Map already points to Plans/Specs, workflow runtime, State Ledger, Skill contracts, and durable learnings, so no map update is needed.

### Constraints

- Do not interpret a valid `Successor candidate` as a Plan path, queue entry, approval, or activation instruction.
- Do not force session creation, closure, or continuation from Plan boundaries or context-pressure metrics.
- Do not make local linkage or status projection claim global Roadmap membership, phase order, predecessor graph validity, or cycle freedom.
- Do not synthesize historical approval or transition records for activations that predate the transition contract.
- Keep DAGs, branches, parallel active Plans, generic scheduling, session control, historical adoption, and cross-host acceptance outside this pattern until separately designed and verified.

---
Captured: 2026-07-28; updated 2026-07-29 | Source: Roadmap Plan boundary and successor Phases P1-P3, independent QA passes, and exact-signature code review passes

## Pattern: Revalidate Evidence and Budgets After Composition

**Domain**: Runtime contracts / persisted evidence / bounded advisory aggregation

**Premise**: A producer-level type, provenance check, or result budget does not survive a lossy boundary automatically. JSON persistence removes TypeScript guarantees, paired cohorts can drift after their first record, and merging several individually bounded child packets can exceed the parent packet budget. Revalidate the complete runtime value after deserialization and reapply limits after aggregation before producing any accepted claim or complete packet.

**reusability**: high

**next_reuse_scenarios**:

- persisted JSON or JSONL is loaded into a typed comparator
- a benchmark claim depends on multiple records, scenarios, sources, or quality outcomes
- several bounded child results are merged into one parent-owned packet
- one status field, scope label, or synthetic harness result could be mistaken for an accepted provider claim

### Reusable template

1. Separate run evidence, comparison status, and claim acceptance. `claim_scope` states what kind of claim is being evaluated; it is not acceptance. Explicitly unavailable provider evidence remains provider-scoped but cannot become comparable or accepted.
2. Treat every deserialized field as `unknown` until checked. Validate required strings, canonical outcome values, finite nonnegative integer metrics, source provenance, and successful execution before marking a run complete.
3. Validate every record in both cohorts, not only the first. Require cohort-wide benchmark, version, model, comparison fingerprints, contiguous indexes, and one identical scenario matrix.
4. Keep deterministic harness evidence `contract_only`. It may prove comparator behavior and expose simulated medians, but it must remain unaccepted as provider evidence.
5. Make malformed, missing, duplicated, unavailable, failed, or untrusted evidence fail closed with stable reason codes before median or parity calculations.
6. Reapply `max_result_entries` and entry-size limits after deduplication and aggregation. If aggregate content is dropped, propagate `truncated=true` and `degraded=true`; per-child compliance alone is insufficient.
7. Preserve one canonical QA artifact namespace and a freshness assertion. Historical artifacts remain readable evidence for their original slice but cannot silently acquire a newer claim meaning.

### Evidence

- `scripts/benchmark_eval.ts` implements schema-v2 run evidence, explicit unavailable/incomplete states, contract-only deterministic evidence, all-record paired identity checks, scenario-matrix validation, runtime metric/token validators, canonical quality/parent-authority parity, and fail-closed provider acceptance.
- `plugins/immune-brain/runtime/imm_core.ts` reapplies advisory result limits after Planner and Brainstorm aggregation and propagates truncation/degradation metadata.
- `tests/benchmark-eval-runner.test.ts` covers run-level execution, quality, provenance, deterministic scope, unavailable capability, persistence, and malformed token handling.
- `tests/benchmark-baseline-contract.test.ts` covers ten-pair policy, all-record benchmark/model/version identity, matrix drift, malformed advisory metrics and token counts, canonical quality outcomes, source trust, duplicate indexes, and contract-only suppression.
- `tests/advisory-budget-contract.test.ts` reproduces aggregate fields growing to nine entries from three individually valid children and proves the normalized parent packet is capped at three with visible degradation metadata.
- Final verification passed 102 focused contract tests with zero failures, focused benchmark reruns up to 23/23, primary LSP and pi-lens diagnostics, generated-doc sync, independent QA for every follow-up, and final exact-signature `imm-code-review` with no findings.
- `benchmark-results/immune-brain-u4-provider/latest.json` remains the canonical current-host artifact with `evidence_status=unavailable`, `evidence_reason_code=runtime_advisory_metrics_unavailable`, `claim_scope=provider_runtime`, and `metrics_complete=false`; it supports classification, not a provider reduction claim.

### reusability_critique_notes

- **Falsifiability**: This pattern is unnecessary for values that never cross a serialization, aggregation, trust, or claim boundary and remain construction-private. Canonical quality tokens (`completed`, `passed`, `parent-owned`) are local benchmark vocabulary; another provider adapter must normalize into them rather than assuming those literals are universal API values.
- **Evidence trail audit**: Repository evidence includes executable reproductions for stale first-record identity, mixed scenario matrices, failed exits, malformed metrics/tokens, equally invalid quality outcomes, aggregate overflow, canonical artifact freshness, repeated independent QA, and code review. U5 now adds four structured foreground `host_runtime` scenario totals, but it does not include a runnable legacy-auto provider cohort, billing data, runtime advisory metrics, or a measured provider token reduction.
- **Architecture entropy resistance**: Append to the contracts hub because the lesson extends existing runtime evidence and bounded-packet primitives. No new evidence service, schema registry, telemetry platform, or standalone solution file is justified. `CONTEXT.md` already maps runtime contracts and durable learnings, so its Architecture Map is unchanged.

---
Captured: 2026-07-29 | Source: subagent auto token budget Plan U1-U4 + same-boundary follow-up rounds 14-17

## Pattern: Scenario-Level Provider Telemetry Requires Trusted Foreground Provenance

**Domain**: Benchmark telemetry / runtime provenance / claim boundaries

**Premise**: Scenario-level token telemetry is authoritative only when the runner receives a structured foreground Agent result that carries exact scenario identity and a valid token total. Map only that structured `details.tokens` value to `reported_tokens_source = "host_runtime"`; keep parent outer-session usage and background text headers supplementary or unavailable. Transport success must remain separate from provider performance, billing, advisory-metric availability, and reduction claims.

**reusability**: high

**next_reuse_scenarios**:

- a benchmark launches multiple foreground Agent calls and must correlate each result to one declared scenario
- a host emits formatted token strings such as `1.5k token` through structured details while raw numeric fractional values must remain invalid
- a regression test must distinguish `host_runtime`, `child_footer`, parent `message_end` usage, missing identity, malformed totals, and duplicate events
- a future paired cohort needs valid scenario telemetry before it can evaluate comparison identity and claim acceptance

### Reusable template

1. Declare the result transport in the fixture and make the task prompt require one foreground Agent batch with exact `Benchmark: <scenario-id>` descriptions.
2. Consume structured foreground result details only after validating status, expected scenario identity, and a positive finite integer token total. Normalize supported host formatting such as `1.5k token`, but reject malformed, missing, zero, negative, non-finite, or numeric fractional values.
3. Deduplicate repeated transport notifications only when a stable `toolCallId` proves they are the same event. Missing identity must fail closed as a duplicate or otherwise non-authoritative observation.
4. Do not divide parent `message_end.message.usage` across scenarios and do not promote background `get_subagent_result` text or `child_footer` values to `host_runtime`.
5. Persist explicit unavailable/incomplete states when advisory metrics or comparison evidence are absent. A successful telemetry transport run is not a provider reduction claim.

### Evidence

- `docs/specs/provider-runtime-token-telemetry.spec.md` and `docs/plans/2026-07-30-001-feat-provider-runtime-token-telemetry-plan.md` require structured foreground attribution, exact scenario correlation, fail-closed outer-session/background handling, and no claim promotion.
- `scripts/benchmark_eval.ts` implements the declared foreground transport, structured token parsing, event identity handling, provenance mapping, status/scenario validation, and explicit unavailable evidence.
- `tests/benchmark-eval-runner.test.ts` covers structured numeric and formatted host tokens, malformed values, invalid status, unexpected scenarios, duplicate calls, matching transport-event deduplication, missing `toolCallId` fail-closed behavior, background-result rejection, and parent-usage isolation.
- `benchmark-results/immune-brain-u5-telemetry/latest.json` records four completed positive-integer `host_runtime` scenarios while preserving `evidence_status=unavailable`, `evidence_reason_code=runtime_advisory_metrics_unavailable`, `claim_scope=provider_runtime`, `metrics_complete=false`, and no comparison.
- The real `mise r benchmark-eval` probe, U3/U4 byte-identity checks, independent QA, and exact-signature `imm-code-review` all passed.

### reusability_critique_notes

- **Falsifiability**: This pattern is unnecessary when a provider API already supplies trusted per-invocation usage with exact scenario correlation, or when no scenario-level accounting is required. It must not be generalized from four scenarios to exact provider-side accounting, billing, cross-host portability, or performance improvement without new evidence.
- **Evidence trail audit**: The U5 artifact and focused tests prove transport-level scenario provenance and fail-closed behavior. They do not prove provider-billed token precision, advisory metrics, a legacy-auto baseline, paired comparison identity, or an accepted reduction claim.
- **Architecture entropy resistance**: Append to the existing contracts hub because this is a narrow extension of runtime evidence, provenance, and claim-boundary guidance. It introduces no new dispatcher, registry, State Ledger field, provider adapter, or global dependency. `CONTEXT.md` already maps benchmark contracts and durable learnings, so no Architecture Map update is needed.

---
Captured: 2026-07-30 | Source: Provider Runtime Token Telemetry Plan U1

## Pattern: Risk-Bound Workflow Profiles with Runtime-Owned Closure

**Domain**: Workflow routing / quality gates / state-machine authority

**Premise**: Workflow speed can be improved without weakening closure by binding one immutable risk profile to the validated Plan and letting the runtime, rather than the host or Executor, choose each closure boundary. A Standard profile may close Steps from freshly validated passing evidence and retain one final changed-files-signature review; Strict and legacy Plans preserve per-Step independent QA. The last Standard review gate may finish in the same optimistic commit only when deterministic Compounder triggers are absent.

**reusability**: high

**next_reuse_scenarios**:

- a managed workflow's fixed ceremony costs more than the bounded code change
- several hosts must make the same QA, review, learning, and finish decision
- a final approval and terminal state transition must not be partially persisted
- repair loops need a durable cap that rejects the next write before mutation

### Reusable template

1. Keep Direct Path outside Plan and Ledger state. For managed work, declare `standard` or `strict` in immutable, signature-bound Plan metadata; normalize omissions to Strict for compatibility.
2. Reject Standard when the Plan names security, migration, concurrency, public API, workflow/Ledger, or cross-host release risk, or when a Step lacks automated verification.
3. Let the runtime close a Standard Step only after the same evidence schema, Git delta, Scope, test-path, and freshness checks used before QA. Record a runtime-authored review event; do not grant Executor pass authority.
4. Preserve every final code/UI gate derived from the current changed-file signature. Apply the last gate pass and eligible finish to one in-memory state and one compare-and-swap commit so neither can persist alone.
5. Derive Compounder from immutable policy plus current evidence: Strict, explicit required, two completed follow-ups, or durable-learning surfaces. Expose reasons in the checkpoint.
6. Count follow-ups from the current Plan's review boundary and reject a Standard third round before creating a target or changing state.
7. Publish profile, budget, and Compounder decisions as exact checkpoint fields. Host contracts consume those names verbatim and never re-derive risk or lifecycle state from prose.

### Evidence

- `plugins/immune-brain/runtime/plan_core.ts` parses and validates immutable profile/policy metadata, defaults legacy Plans to Strict, and rejects Standard high-risk or non-automated Plans.
- `plugins/immune-brain/runtime/state_ledger.ts` owns profile lookup, two-round follow-up budget, deterministic Compounder reasons, and shared finish mutation.
- `plugins/immune-brain/runtime/commands/work.ts` performs Standard evidence-bound Step closure; `commands/review.ts` combines final gate pass and eligible finish under one Ledger CAS.
- `tests/plan-validation.test.ts`, `tests/imm-autowork-continuation-runtime.test.ts`, `tests/imm-follow-up-runtime.test.ts`, and `tests/imm-loop-review-lifecycle-state.test.ts` cover legacy compatibility, strict-risk rejection, Standard closure, multiple gates, CAS failure, Compounder triggers, and no-write third-round rejection.
- Focused Step verification passed 61 runtime tests and 49 host-contract tests. Independent QA passed for all three Steps. Final exact-signature Code Review found one host field-name mismatch; a bounded follow-up corrected `review_budget_state.budget_stop`, passed 33 focused tests and independent QA, and the second review passed with no findings.

### reusability_critique_notes

- **Falsifiability**: This pattern is too heavy for Direct Path work and unsafe when risk classification cannot be validated from immutable Plan data. It should be revised if Step evidence no longer proves current workspace state, if review signatures become path-only freshness claims, or if Compounder gains nondeterministic triggers that cannot be checked inside the final commit boundary.
- **Evidence trail audit**: Tests prove parser compatibility, evidence-bound closure, required final gates, same-commit finish, CAS no-partial-write behavior, deterministic learning triggers, and follow-up budget rejection. They do not prove throughput improvement in production usage, cross-host UX acceptance, or safety for new high-risk categories not represented in validation.
- **Architecture entropy resistance**: Append to the contracts hub because this composes existing Plan signatures, State Ledger CAS, review signatures, and Compounder handoff primitives. No new scheduler, queue, Ledger schema, or host-specific state is needed. `CONTEXT.md` already maps Plan validation, workflow runtime, State Ledger, Skill contracts, and durable learnings, so its Architecture Map is unchanged.

---
Captured: 2026-08-05 | Source: Risk-Tiered Workflow Execution Plan U1-U3, independent QA, exact-signature Code Review, and bounded review follow-up

## Pattern: Crash-Recoverable Host Probes Use Runtime-Owned Checkpoints

**Domain**: Host adapters / State Ledger lifecycle / read-only subagent probes

**Premise**: A host may dispatch advisory probes, but the durable workflow must not depend on the host process, provider session, or conversation memory. Persist a runtime-owned checkpoint before dispatch, give every envelope a stable identity plus an expected Ledger revision, and accept one complete structured result packet through a translation-only adapter. The runtime alone validates identity, freshness, completeness, fallback consistency, replay safety, and the transition into execution.

**reusability**: high

**next_reuse_scenarios**:

- a workflow pauses for host- or provider-executed read-only work
- a host retry may replay a response after the runtime already committed it
- multiple adapters must expose one lifecycle without copying validation logic
- advisory evidence must remain unable to grant execution, QA, review, or Plan authority

### Reusable template

1. Persist `active -> probing` under the State Ledger lock before returning any host envelope. Include stable probe IDs, immutable Plan-derived scope, and the post-commit Ledger revision.
2. Keep provider calls outside the deterministic runtime. The host consumes bounded read-only envelopes and returns typed outcomes; it does not infer scope or state transitions.
3. Submit Step identity, expected revision, and the complete result set as one structured packet. Reject stale, missing, duplicate, unknown, cross-Step, and caller-scoped results without mutation.
4. Normalize success, failure, timeout, and policy/environment fallback into one evidence shape. Require status/reason combinations to be internally consistent.
5. Make exact replay idempotent and conflicting replay fail closed. Recover a persisted `probing` checkpoint by rebuilding the same stable envelopes rather than allocating new identities.
6. Persist `probing -> executing` and advisory `child_evidence` together. Execution evidence, QA, final review, Compounder, and finish remain separate downstream authorities.
7. Give host adapters bounded schemas and exact argv translation tests. Keep identity, CAS, completeness, replay, and lifecycle decisions in the runtime owner.

### Evidence

- `plugins/immune-brain/runtime/work_probes.ts`, `plugins/immune-brain/runtime/commands/work.ts`, and `plugins/immune-brain/runtime/state_ledger.ts` implement deterministic envelopes, fallback normalization, lock-time revision checks, replay handling, and durable state transitions without provider calls or schema v3 changes.
- `plugins/immune-brain/.opencode-plugin/index.ts` and `runtime.ts` expose typed `imm_work_continue` / `imm_work_record_probes` tools while forwarding one `--results-json` packet to the TypeScript CLI.
- `tests/work-probes-runtime.test.ts`, `tests/runtime-state.test.ts`, and `tests/execution-evidence-runtime.test.ts` cover stable IDs, mixed outcomes, stale/conflicting replay, lost-response recovery, crash-state recovery, no-probe/rework compatibility, and execution bypass rejection.
- OpenCode, package-wrapper, packaged-contract, and completion-gate suites prove schema rejection, exact argv, separate-process persistence, retired Python reference removal, and advisory evidence authority limits.
- U1 independent QA passed 33 tests / 171 assertions. Final host verification and independent QA passed 69 tests / 405 assertions. Cumulative exact-signature Code Review passed with no material findings.

### reusability_critique_notes

- **Falsifiability**: This pattern is unnecessary for stateless queries whose results never participate in workflow recovery or authority. It is insufficient if multiple concurrent writers or parallel active Steps are introduced without separate scheduler, ownership, and integration contracts.
- **Evidence trail audit**: Tests prove deterministic reconstruction from persisted probing state, stale and replay handling, complete-set validation, and separate-process CLI behavior. They do not inject a crash inside the atomic commit itself or launch a real OpenCode host/provider end to end.
- **Architecture entropy resistance**: Append to the contracts hub because this composes existing State Ledger lock/CAS, host-bound envelope, CLI, and evidence primitives. It adds one domain helper and two additive host tools, not a provider runtime, generic dispatcher, registry, or second state abstraction.

---
Captured: 2026-08-09 | Source: TypeScript Work-Probe Lifecycle Repair Plans, independent QA, and cumulative Code Review

## Pattern: Step Verification Must Isolate Out-of-Scope Health Failures

**Domain**: Plan verification / immutable Scope / test ownership

**Premise**: A Step Verification is part of the executable contract, not a convenient command list. If it runs a known failing repository-health assertion whose repair owner is outside Step Scope, the Step is permanently uncloseable: passing requires either a Scope violation or weakening unrelated protection. Put the new behavior assertion in a focused owner test and report the pre-existing health failure separately.

**reusability**: high

**next_reuse_scenarios**:

- a focused feature test shares a file with an unrelated known-failing parity or generated-copy assertion
- an immutable Plan reaches RED but one failure predates and cannot be repaired inside Scope
- a broad suite is useful diagnostically but cannot be the legal closure boundary for a narrow Step

### Reusable template

1. Run the proposed exact Verification before activation when practical, and distinguish target RED from unrelated baseline failures.
2. Never weaken, skip globally, or silently repair an out-of-scope health assertion just to close the current Step.
3. Move only the new contract assertion into a dedicated focused test owned by the Step; preserve the original health test unchanged.
4. Keep the broad failure visible as an external diagnostic with a separate owner and future repair path.
5. If the Plan is already activated, treat an unreachable immutable Verification as `replan`, not ordinary implementation rework or fabricated passing evidence.

### Evidence

- The first OpenCode successor's exact command produced 35 passing tests and 6 failures: five intended test-first RED failures plus the pre-existing `plugins/immune-brain/skills/BASELINE.md` copy drift.
- Independent QA isolated the parity case at 0 pass / 1 fail and confirmed that all BASELINE copies were outside the activated Scope, requiring `replan`.
- The final successor moved the new assertion from `tests/baseline-packaging-contract.test.ts` to `tests/work-probe-packaging-contract.test.ts`; final review confirmed the broad parity file was byte-identical to `HEAD`.
- The corrected exact Verification passed 69 tests / 405 assertions, Plan validation with zero warnings, and `git diff --check` while the external BASELINE diagnostic remained visible.

### reusability_critique_notes

- **Falsifiability**: This does not justify avoiding broad suites when they are green or when their repair paths are inside the declared Scope. It applies only when a reproduced independent failure has a different owner and predates the Step.
- **Evidence trail audit**: Two QA-directed replans, isolated test runs, Git byte comparison, and the final focused suite support the pattern. It does not establish that every pre-existing failure should be ignored; unclassified failures remain blockers.
- **Architecture entropy resistance**: The pattern favors one focused test owner and a separate health task over compatibility flags, conditional skips, or expanding feature Scope. It introduces no runtime behavior or new validation framework.

---
Captured: 2026-08-09 | Source: OpenCode Work-Probe Contract Verification successor Plan and independent QA

## Pattern: Read-Only Workflow Projections Revalidate Authority at the Read Boundary

**Premise**: A host-facing progress view must remain a versioned projection over authoritative workflow artifacts, not a convenient cache or second state model. The runtime should fail closed when current Plan or Ledger authority is invalid, represent optional Roadmap failures explicitly without hiding valid current-Plan facts, and attach presentation relations only to persisted evidence.

**reusability**: high

**next_reuse_scenarios**:

- a TUI, dashboard, IDE extension, or API needs to display workflow progress without acquiring mutation authority
- one read combines authoritative state with optional Markdown or file-backed metadata
- mutable local paths must be read without projecting bytes from a retargeted source
- semantic lifecycle and relationship labels must remain deterministic across hosts and sessions

### Reusable template

1. Publish a literal versioned contract and keep it separate from legacy raw-status payloads.
2. Derive lifecycle from one explicit precedence table over authoritative records; reject ambiguous active candidates instead of choosing a display winner.
3. Keep the primary authority strict: unsupported Ledger schema, current Plan identity drift, malformed active state, or authoritative size overflow fails the whole command.
4. Keep optional sources honest: missing, malformed, unsafe, or oversized Roadmap input returns a stable unavailable/error shape with no fabricated Phase list while unaffected Plan facts remain readable.
5. For mutable file sources, reject absolute/traversal/symlink paths, enforce canonical root containment, read from an opened descriptor, and recheck canonical path plus opened-file device/inode identity before publishing parsed content.
6. Bound item counts and UTF-8 text sizes without silent truncation; omit timestamps and session data so identical persisted bytes produce byte-stable output.
7. Emit relations such as `current`, `successor_candidate`, or `transition_recorded` only from matching Plan/Ledger evidence. Document order is display order, not completion evidence.
8. Prove read-only behavior by snapshotting full file sets, types, symlink targets, and content hashes on both success and failure; existing-file byte checks alone miss temporary locks and cache artifacts.

### Evidence

- `plugins/immune-brain/runtime/progress_projection.ts` implements `progress_projection/v1`, explicit lifecycle precedence, bounded Plan/Roadmap output, evidence-backed Phase relations, and opened-file identity revalidation.
- `tests/progress-projection-runtime.test.ts` covers pending/executing/review/rework/replan/follow-up/termination/closed/finished states, ambiguous active Steps, stale finish evidence, optional-source diagnostics, traversal and symlink rejection, post-read retargeting, output limits, signature/schema failures, deterministic output, and recursive no-write snapshots.
- Package-wrapper and Roadmap progression suites preserve the `imm-work status --json` boundary and verify `imm-work progress --json` through the shipped CLI surface.
- The activated U1 Verification passed 40 tests across three files, Plan validation with zero warnings, and `git diff --check`; independent Strict QA repeated the same checks and passed closure.
- Exact-signature Code Review repeated 40 tests plus real-Ledger determinism/status-compatibility smoke checks and found no blocking issues.

### reusability_critique_notes

- **Falsifiability**: This pattern is unnecessary for an immutable single-source report and does not prove safety against a hostile filesystem or kernel. If a consumer needs remote consistency, multi-writer transactions, or cryptographic provenance, local canonical-path and inode checks are insufficient and a stronger storage protocol is required.
- **Evidence trail audit**: Focused fixtures, real-Ledger smoke checks, independent QA, and exact-signature review support deterministic local runtime behavior. Phase completion, global Roadmap topology, cross-host UI quality, and the future Pi Extension remain unproved and outside P1.
- **Architecture entropy resistance**: Append to the Contracts hub because the lesson strengthens the existing State Ledger and semantic Roadmap authority patterns. The projection stays in one runtime module, adds no persistence schema, and keeps host adapters translation-only. `CONTEXT.md` already names the new module and command, so Compounder requires no additional Architecture Map edit.

---
Captured: 2026-08-10 | Source: Pi Progress Visualization Phase P1, U1 QA, and exact-signature Code Review

## Pattern: CAS-Protected Storage Must Still Enforce Domain Transitions

**Domain**: State authority / optimistic concurrency / crash recovery / legacy migration

**Premise**: Compare-and-swap proves that bytes have not changed since a caller read them; it does not prove that the proposed next state is legal. Persisted lifecycle records must be created or advanced only through the domain reducer, while cross-file ownership invariants require a recoverable transaction protocol. Legacy pointers are corroborating evidence only: migration must enumerate every current candidate before trusting a pointer. Terminal projection likewise requires a complete positive evidence set; absence of a current candidate does not prove that every persisted candidate closed legally.

**reusability**: high

**next_reuse_scenarios**:

- a public storage API accepts a complete next-state object and can bypass reducer or append-only history rules
- one logical ownership transition updates a per-item record plus a workspace, lease, or scheduler pointer
- a killed process can leave transaction or lock artifacts that later readers must recover safely
- retries need exact event idempotence without accepting a different payload under the same event identity
- a legacy pointer can select one plausible record while another current record contradicts it

### Reusable template

1. Expose creation plus action application, not arbitrary replacement, as the public mutation API. Parse the existing record, run the domain reducer, validate the resulting invariant set, and only then enter storage commit.
2. Treat item revision and workspace revision as one optimistic precondition. Serialize all item/workspace writers under a worktree-local lock, persist a write-ahead transaction marker, converge both target files, then remove the marker. Readers acquire the same lock and complete a pending marker before publishing either file.
3. Make stale lock recovery evidence-based. Store owner PID metadata, remove only a regular lock whose owner is no longer alive, and recheck file identity before cleanup; unknown or live ownership fails closed.
4. Record a canonical action fingerprint with each event ID. An exact replay returns the already-reduced record without another history append; reusing the event ID with any different action payload is an invariant violation.
5. Derive cross-file ownership from phase transitions: entering `working` claims the workspace pointer, leaving `working` releases it, and rework cannot reclaim while another task owns it. A stale caller must fail before either target becomes externally observable.
6. For legacy projection, collect all non-terminal candidates first. Multiple current records, a pointer to a terminal/future record, or a pointer that masks another current record maps conservatively to an explicit stopped/inconsistent result.
7. Prove terminal state from positive, well-typed evidence. Require every item to carry the exact terminal state, require blocker fields to carry their canonical inactive values, and bind the latest terminal marker to the current intent identity. A missing current candidate, a truthy/falsy coercion, or an older matching marker is not completion evidence.
8. Keep shadow migration read-only until production routing is separately approved. Dry-run reports and friction journals must not create task records or become workflow authority.
9. Pass privileged authority outside the action payload. The caller boundary supplies a non-forgeable context; the reducer validates it only for named privileged actions, binds its non-secret audit descriptor into the event fingerprint, and persists that descriptor in append-only history. Generic actions must reject the context, and exact event replay with a different descriptor must fail closed.

### Evidence

- `plugins/immune-brain/runtime/kernel/reducer.ts` requires a symbol-branded context for `stop` and user-decision resolution, rejects generic resolution of `unresolved_user_decision`, fingerprints the authority descriptor with the action, and persists actor/source/confirmation reference in history. P1 exposes only a test seam inside the private reducer module; the public kernel index and CLI expose no issuer.
- `plugins/immune-brain/runtime/kernel/storage.ts` accepts that context separately from `TaskAction`, preserves reducer-owned replay semantics through CAS, and restricts canonical creation to an empty `working` lifecycle record; terminal/import creation remains unavailable.
- `plugins/immune-brain/runtime/kernel/legacy.ts` maps multi-current and pointer/state contradictions to `stopped("legacy-inconsistent")`. An all-closed active Plan awaiting its final gate maps to `review`; `done` additionally requires every raw Step to be exactly `closed`, `requires_replan` to be exactly `false`, active/follow-up ownership to be absent, and the latest `finish_reset` to bind the current Plan path.
- `tests/kernel-core.test.ts` and `tests/kernel-migrate.test.ts` cover all action retries, conflicting reuse, direct transition/history bypass, same-snapshot working contention, release/transfer/reclaim, injected transaction interruption, stale lock recovery, symlink rejection, contradictory legacy aggregates, malformed lifecycle fields, and matching-versus-stale finish markers.
- The bounded review follow-up passed 43 focused tests, real-Ledger shadow projection (`phase=review`, no divergence), migration dry-run (`writes_performed=false`), and `git diff --check`; independent follow-up QA and a second full-diff `imm-code-review` passed.

### reusability_critique_notes

- **Falsifiability**: A single-file aggregate can use one atomic CAS without a cross-file transaction marker. This protocol is insufficient for network filesystems, distributed writers, PID namespaces, or hostile local administrators; those require a real transactional store or lease service. If the workspace pointer ceases to be authoritative, coordinating it transactionally is unnecessary.
- **Evidence trail audit**: Tests prove reducer-only updates, privileged-context separation and audit binding, generic user-decision rejection, canonical empty-working creation, logical contention from the same stale snapshot, injected mid-commit recovery, stale PID lock cleanup, idempotent replay, and fail-closed legacy projection. They do not prove production host authentication or issuer provenance, inject an operating-system kill between every filesystem syscall, prove multi-host behavior, or demonstrate production v4 routing; P1 remains shadow-only.
- **Architecture entropy resistance**: Append to the Contracts hub because the lesson extends existing CAS, replay, authority, and migration guidance. The implementation stays inside one pure kernel plus one shadow CLI, does not alter schema v3 routing, and names P2 production integration as a separate Plan boundary. `CONTEXT.md` is updated because `runtime/kernel/` and `imm-kernel` are new durable navigation surfaces.

---
Captured: 2026-08-11 | Source: Assurance Kernel Foundation Plan U1-U3, finished-shadow repair, bounded review follow-ups, independent QA, and repeated full-diff Code Review

## Pattern: Host TUI Projection Consumers Use Disposable Refresh Generations

**Premise**: A resident host UI over file-backed workflow authority should own only disposable presentation generations, never workflow state. Keep process translation, pure rendering, and host lifecycle ownership separate; make every refresh replaceable, every filesystem recovery bounded and event-driven, and every published frame traceable to the versioned projection that produced it.

**reusability**: medium

**next_reuse_scenarios**:

- another TUI, IDE panel, or dashboard consumes `progress_projection/v1` without receiving mutation authority
- a local UI watches an authority directory whose files are atomically replaced
- asynchronous refreshes can overlap with host reload, shutdown, or a newer refresh trigger
- package discovery must preserve existing Skills while adding a host-native Extension entry point

### Reusable template

1. Split the adapter into three explicit layers: one package-local process client, pure width-bounded views, and one lifecycle controller. Do not let renderers read files, execute commands, or persist state.
2. Call a literal read-only runtime command through the host process API with an argv array, timeout, and Extension-owned abort signal. Validate the literal projection version and clone only bounded known fields; ignore additive unknown fields rather than exposing them to views.
3. Guard non-interactive host modes before registering UI or allocating processes, timers, watchers, or detail views. Use stable owned UI keys so cleanup can clear exactly what the Extension created.
4. Treat refreshes as generations. Coalesce triggers behind one bounded debounce, abort superseded in-flight work, queue at most one successor read, and publish only when the generation is current and the controller is still live.
5. Watch the authority directory, not one atomically replaced file. Track directory device/inode identity; ordinary change events perform a bounded identity check, rename events force one reattachment attempt even when the immediate identity is still unchanged, and watcher errors close the old handle before one event-driven recovery attempt. Never add a polling fallback.
6. Replace stale success with an explicit bounded error when process, JSON, schema, watcher, or reattachment work fails. Operational handler errors must not escape into the host agent process.
7. Own at most one editor-area detail view. A repeated invocation closes the previous component before replacement; shutdown aborts pending work, closes the watcher, closes the detail view, and clears Widget keys idempotently.
8. Verify both contracts and experience: source-spy tests reject workflow/session authority bypasses, package resolver smoke proves co-discovery, race tests exercise abort and rename timing, strict type checks bind the installed host API, and a real host TUI run covers reload, keyboard navigation, live authority refresh, duplicate-free cleanup, and shutdown.

### Evidence

- `plugins/immune-brain/.pi-extension/progress_client.ts`, `progress_views.ts`, and `index.ts` implement the process/view/lifecycle split over `progress_projection/v1` with no Session persistence or workflow mutation surface.
- `tests/pi-progress-extension.test.ts` covers package resolution, exact argv, bounded schema cloning, authority source restrictions, lifecycle visibility, ANSI-aware width, keyboard navigation, single-flight abort, stale-generation suppression, watcher absence/error/identity change, unchanged-identity rename reattachment, detail-view replacement, and idempotent shutdown.
- Final Plan verification passed 46 tests across three files; the focused Extension suite passed 17 tests; standalone strict TypeScript, Plan validation, and `git diff --check` passed.
- First Code Review found that an unconditional identity early return neutralized forced rename reattachment. A same-boundary follow-up added the event-type contract and unchanged-identity race test; isolated QA passed it, and second-round exact-signature Code Review found no remaining material issue.
- Real Pi 0.84.1 TUI acceptance exercised `/reload`, Roadmap/Plan/Gates navigation, paging, Escape, copied-Ledger atomic transitions from Closed to Executing to Review, duplicate-free second reload, and normal Ctrl-D shutdown. Later acceptance replaced the floating Overlay with a framed non-overlay editor-area detail view and proved transcript separation at 40 and 100 columns.

### reusability_critique_notes

- **Falsifiability**: This pattern does not make `fs.watch` reliable on network filesystems, guarantee delivery after host suspension, or establish remote consistency. If events can be lost without a later host trigger, the product needs a separately designed reconciliation protocol rather than silent polling inside this adapter.
- **Evidence trail audit**: Deterministic race tests, resolver smoke, strict Pi 0.84.1 types, two Code Review rounds, isolated follow-up QA, and a real macOS Pi TUI run support the local-host claims. Cross-platform watcher behavior, screen-reader semantics, color contrast across themes, and remote storage remain unproved.
- **Architecture entropy resistance**: Append to the Contracts hub because this is the consumer half of the existing read-only projection boundary. It adds no State Ledger field, cache, session state, second parser, workflow command, or generic host framework. `CONTEXT.md` already maps the Pi Extension layers, so no additional Architecture Map update is required.

---
Captured: 2026-08-10 | Source: Pi Progress Visualization Phase P2, reviewer follow-up, real Pi TUI acceptance, and exact-signature review gates

## Pattern: Phase Completion Is Its Own Signature-Bound Authority

**Premise**: A workflow must persist Phase completion when finish authority exists, rather than trying to reconstruct completion later from successor selection or transition history. Completion, transition, and current selection are independent facts: write completion atomically with `finish_reset`, migrate only exact signed historical evidence, and let projections combine matching relations without inventing one from another.

**reusability**: high

**next_reuse_scenarios**:

- a completed Plan is replaced by a successor snapshot but its Roadmap Phase must remain visibly finished
- schema-compatible history needs a one-time backfill without making ordinary runtime readers interpret legacy evidence
- one Roadmap Phase may simultaneously be `current`, `finished`, a successor candidate, or transition-backed
- a narrow host view must preserve semantic state even when descriptive titles are truncated

### Reusable template

1. Define one bounded, versioned completion record with canonical Roadmap source, exact Phase ID, canonical Plan path, Plan signature, completion timestamp, provenance, and a deterministic ID. Keep it separate from successor and transition records.
2. Build direct completion evidence only from the validated Plan snapshot already held by the finish transaction. Append it together with `finish_reset` through the existing lock/CAS commit; a stale or failed finish exposes neither fact. Plans without signed Roadmap fields retain normal finish behavior without a fabricated completion.
3. Keep historical interpretation in the migration gateway. Pair each `finish_reset` with the nearest unused prior same-path signed sync, recompute the current Plan file signature, parse its declared Roadmap source and Phase, and backfill only on exact agreement. Enforce project containment, whole-path symlink rejection, one-sync-per-finish pairing, deterministic output, content-addressed backup, and replacement-time CAS.
4. Treat every skipped candidate as a diagnostic, not a partial truth. Missing, moved, symlinked, escaping, signature-drifted, ambiguous, or Roadmap-free Plans remain unresolved; active Steps or follow-ups defer migration so ordinary stateful commands cannot rewrite authority mid-execution.
5. In the projection, match completion by normalized Roadmap source plus exact declared Phase ID. Emit independent relations in deterministic order: `current`, `finished`, `successor_candidate`, `transition_recorded`; use `deferred` only when none exists. Preserve the literal projection version when relation strings are already additive and bounded.
6. Keep hosts translation-only. Parse additive relation strings without a second completion model, and render semantic relations before truncatable titles so narrow layouts retain the state the user opened the view to inspect.
7. Test direct finish atomicity, malformed and duplicate record rejection, migration check/write/idempotence/crash/CAS paths, uncertain-history skips, relation overlap/order, source and Phase mismatches, recursive no-write projection, tolerant host parsing, and real narrow/wide host frames.

### Evidence

- `plugins/immune-brain/runtime/state_ledger.ts` defines and validates `roadmap_phase_completion/v1`; `applyIntentionalFinish` appends direct evidence and `finish_reset` through one mutation. `tests/finish-dehydrate-runtime.test.ts` and `tests/runtime-state.test.ts` cover direct finish, deterministic IDs, legacy missing-field normalization, malformed records, duplicates, and stale CAS behavior.
- `plugins/immune-brain/runtime/project_migration.ts` is the sole historical interpreter. It recovered P1 and P2 from exact signed-sync plus finish pairs, preserved skipped diagnostics, generated content-addressed backup/manifest evidence, and left active targets byte-identical. Migration and Roadmap progression tests cover missing, moved, symlinked, escaping, mismatched, ambiguous, unpaired, idempotent, interrupted, and concurrent-replacement cases.
- `plugins/immune-brain/runtime/progress_projection.ts` emits evidence-backed `finished` relations and `phase_completion` references without reading historical Plans or writing state. Projection tests cover matching, unrelated records, malformed authority, overlap order, reordered Roadmaps, zero-evidence `deferred`, deterministic output, and recursive no-write behavior.
- The primary workspace migration recovered P1 as `finished` and P2 as `current, finished`. Final follow-up Strict QA passed 116 tests plus strict Pi TypeScript, Plan validation, and `git diff --check`. Real Pi 0.84.1 GNU screen frames at 100 and 40 columns showed both literal relations with zero over-width lines and clean Esc restoration. Round 2 exact-signature Code Review found no P0-P3 issues.

### reusability_critique_notes

- **Falsifiability**: This pattern does not prove that external work actually happened; it preserves completion granted by this workflow's validated Plan and finish authority. Historical recovery is impossible when the signed Plan bytes or exact pairing evidence no longer exist, and the correct result is unresolved/deferred rather than a guessed completion.
- **Evidence trail audit**: Unit and integration suites cover finish atomicity, record validation, migration safety, relation semantics, and host parsing. Primary and isolated migrations reproduced the P1/P2 incident, while real Pi frames proved the user-visible outcome. Remote filesystems, multiple concurrent writers, cryptographic signatures, and migration from absent Plan artifacts remain unproved.
- **Architecture entropy resistance**: Append to the Contracts hub because the solution extends the existing State Ledger, migration gateway, projection, and host adapter boundaries. It adds no schema version, second history interpreter, successor coupling, polling, session state, or UI authority. `CONTEXT.md` now maps completion persistence, signed-history migration, and evidence-backed `finished` projection, so no further Architecture Map edit is needed.

---
Captured: 2026-08-10 | Source: Roadmap Finished Phase Evidence Plan U1-U3, primary migration, narrow-view follow-up, Strict QA, and exact-signature Code Review

## Pattern: Durable Commit Receipts with Replay-Sufficient Observation Seeds

**Domain**: State authority / observability / crash recovery / promotion evidence

**Premise**: A shadow observer that rereads live authority state after a commit cannot prove what was committed if a later commit has already advanced the state. Post-commit telemetry is only trustworthy when the authority commit itself persists a replay-sufficient seed inside a durable, hash-chained receipt journal, and the observation store is deduplicated by the terminal receipt record identity rather than by derived content hashes.

**reusability**: high

**next_reuse_scenarios**:

- a readiness or promotion gate must reconcile "every authority commit" against "every observation" across process restarts
- an observer failure must not roll back or alter an already-committed authority write, yet the next startup must still recover the missed observation exactly
- multiple production writer paths (command mutation, migration, CAS authority snapshots) must share one commit denominator
- legacy observation formats must stay readable for diagnostics while never qualifying a new promotion window

### Reusable template

1. Persist a receipt per authority attempt before the authority write lands: unique attempt ID, source kind/ref, and (for v2) an observation seed carrying observer generation, source identity, committed-bytes hash, committed revision, and shadow projection — all derived from the exact proposed bytes inside the commit lock.
2. Terminalize the receipt after the write: `committed`/`recovered_committed` terminals repeat the same seed; `aborted`/`recovered_aborted` carry no qualifying seed. Record identity participates in a per-contract hash chain with the predecessor.
3. Append observations to a dedicated automatic-evidence journal keyed by the terminal receipt record ID: identical replay is a no-op, conflicting payload under the same record ID fails closed. Observations are built only from the terminal seed, never by rereading the live authority file.
4. On the next startup or authority write, recover a pending prepared attempt first (recovered-committed/aborted by comparing exact target bytes), then replay any missing observation from its terminal seed — even if later commits have already landed.
5. Keep observer failure strictly best-effort: it changes neither the committed bytes nor the command result; the gap is detected later from the durable receipts, not from the volatile observer output.
6. Classify legacy observations (pre-receipt hash IDs, attempt-only v1) as readable diagnostics that never enter the qualifying window; do not rewrite historical journals.

### Evidence

- `plugins/immune-brain/runtime/authority_commit_receipts.ts` enforces the v1/v2 mixed chain, exact-key schemas, unique attempt IDs, fail-closed recovery, and binds `observation_seed.committed_revision === record.ledger_revision` into the record hash.
- `plugins/immune-brain/runtime/state_ledger.ts` (normal mutation + autowork authority CAS) and `plugins/immune-brain/runtime/project_migration.ts` (migration, with rollback producing only an aborted receipt) prepare the seed inside the lock, fsync + rename, terminalize, and replay observations best-effort in `finally`.
- `plugins/immune-brain/runtime/kernel/automatic_observations.ts` provides the dedicated v2 journal with NOFOLLOW path guards, lock, and record-ID dedup; `kernel/observation.ts` builds observations solely from terminal seeds.
- `tests/authority-commit-receipts.test.ts` proves SIGKILL recovery after rename, append-failure replay after a later commit (two distinct byte hashes), and A→B→A→B identity uniqueness; `tests/kernel-readiness.test.ts`, `tests/kernel-readiness-evidence.test.ts`, and `tests/kernel-r2a-boundary.test.ts` prove exact v2 reconciliation, sticky generation blocking, Git-tracked clean evidence loading, canonical read-only routing, v1 non-qualification, and journal boundaries; full repo `646 pass / 0 fail`.

### reusability_critique_notes

- **Falsifiability**: Receipts prove ordering and content binding on one filesystem with the Ledger lock held; they do not defend against a writer that bypasses the runtime entirely (direct file edit). Multi-host or NFS semantics would require stronger consensus/storage guarantees.
- **Evidence trail audit**: The readiness projector reconciles every terminal v2 receipt against one exact automatic v2 observation, keeps integrity/version failures sticky for the generation, and excludes manual query/friction records. Operational promotion inputs (migration digest and rollback rehearsal) arrive through one bounded, Git-tracked, unstaged/clean, symlink-free evidence bundle whose digest is independently recomputed by the canonical migration report builder; query execution never manufactures its own presented evidence.
- **Architecture entropy resistance**: The pattern extends the existing CAS/transition pattern without changing v3 production routing; readiness remains a read-only projection and cannot issue authority, mutate TaskRecords/Intent, import terminal state, or activate P2B routing.

---
Captured: 2026-08-11 | Source: Assurance Kernel P2A R2A exact-observation Plan (single Step), strict QA, and isolated full-diff code review

## Pattern: Secure Git-Owned Descriptor Identity with Opaque Token

### Problem

A managed task's intent must be read from a human-edited, Git-tracked sidecar, yet later mutation and completion decisions need one exact, race-resistant identity of the bytes that were actually read. Ordinary path reads are vulnerable to symlink substitution, parent-directory replacement, and A→B→A swaps, and any serializable token can be forged or leaked into persisted records.

### Reusable template

1. Bind one canonical root: `realpath(root)` becomes both the Git command `cwd` and the filesystem containment authority; a symlink supplied as the root is rejected, and root drift after the read is rejected. Parent components may be symlinks (e.g. macOS `/var` → `/private/var`) — the canonical root is the single identity.
2. Require Git tracking (`git ls-files --error-unmatch`) as an ownership convention but never require clean/staged state: intent editing is the ordinary input path, and tracking is not user authentication.
3. Walk every path component with `lstat` before the read, recording `{dev, ino}`; open the file with `O_NOFOLLOW` (fail closed where unsupported); verify descriptor `fstat` against the path identity; read bounded bytes; then re-verify path, parents, and root before returning. Bytes come only from the descriptor.
4. Derive identity from canonical normalized JSON (stable key ordering, no insignificant whitespace) hashed as `sha256:<64-hex>`, so formatting-only edits preserve identity and semantic edits change it. Exclude pure version metadata (revision) from the content hash used for change classification.
5. Return an opaque token: a module-private branded runtime value stored in a module-level `WeakMap`, attached via a non-enumerable symbol property, absent from `Object.keys`/spread/`JSON.stringify`, with no exported constructor or consumer. A later boundary (authority consumption) must reread and CAS against the token's identity before any mutation.

### Evidence

- `plugins/immune-brain/runtime/kernel/intent.ts` implements the strict `task_intent/v1` parser, canonical hash, revision classifier, descriptor reader (canonical root binding, `O_NOFOLLOW`, fstat/path/parent re-verification, 64 KiB bound, Git tracking without clean), and the opaque `WeakMap`-backed token; the only test seam is a module-level read hook.
- `plugins/immune-brain/runtime/kernel/validation.ts` (`parseTaskRecordV2`, `assertKernelInvariantsV2`) and `completion.ts` (`completionDecisionV2`, `projectTaskV2`) add independently named TaskRecord v2 APIs that bind evidence/approvals to `intent_content_hash`; v1 APIs and storage/reducer call sites remain byte-for-byte unchanged and reject v2 before writes.
- `tests/kernel-intent-v2.test.ts` proves root/sidecar symlink, untracked, traversal, oversize, malformed, dirty/staged acceptance, seam-injected file/A→B→A/parent replacement rejection, token opacity, hash formatting-independence, and the classifier truth table; `tests/kernel-record-v2.test.ts` proves exact v2 wire, snapshot/ref matching, every-acceptance completion, drift staleness, and v1 writer rejection; `tests/kernel-r2c1-boundary.test.ts` pins v1 signatures and the absence of mutation/issuer/import/CLI surface; full repo `684 pass / 0 fail`.

### reusability_critique_notes

- **Falsifiability**: The reader verifies identity against one filesystem at read time; it cannot defend against a writer that bypasses the runtime, and mid-read races are only injectable through the documented test seam.
- **Evidence trail audit**: Completion freshness requires every current acceptance ID to have fresh passed evidence bound to intent revision, intent content hash, and diff hash; intent drift stales evidence and approvals by projection only, never by rewrite.
- **Architecture entropy resistance**: The pattern is additive and read-only; it changes no v3 routing, readiness, receipt, or observation behavior and exposes no production mutation, authority issuer, token consumer, or import surface.

---
Captured: 2026-08-12 | Source: Assurance Kernel P2C1 Intent Identity Plan (single Step), strict QA, and isolated full-diff code review

## Pattern: Closed Mutation Ports Consume Opaque Capabilities Before One Recoverable Transaction

When a production-bound mutation surface must exist without a production issuer, keep the port library-only and make every mutation a single identity-bound reducer result committed through one recoverable CAS transaction, with opaque single-use authority consumed only after all fallible policy checks.

### Rule

1. Define a closed action vocabulary as a strict discriminated union with exact payloads and a single factual effect per action; reject unknown fields and generic patch shapes at the parser boundary.
2. Keep the pure reducer separate from storage: the reducer validates phase rules, replay identity, and update invariants, and returns a module-branded, non-constructible, non-serializable result; storage accepts only that brand.
3. Fingerprint committed events against the action-expected identity (expected record hash, intent revision/hash, diff hash, authority audit) so an identical retry returns the committed snapshot after the record has advanced, while conflicting reuse of an event ID fails.
4. Make authority an opaque WeakMap-backed capability bound to task, exact action digest, record hash, intent revision/hash, diff hash, actor, confirmation ref, and expiry. Inspect without consuming for preflight; consume irreversibly only after every fallible check passes and immediately before writing the transaction marker. A marker-write failure intentionally burns the capability and requires reissue.
5. Reread and consume the Git-owned intent identity inside the same store lock, pairing the prior token with a fresh reread and rejecting A→B→A swaps even when final bytes match.
6. Give the v2 transaction its own marker path and contract under the same exclusive store lock; simultaneous v1/v2 markers fail closed, each parser rejects the other contract, and recovery converges exact bytes and removes the marker.

### Evidence

- `plugins/immune-brain/runtime/kernel/reducer_v2.ts` implements the closed `TaskActionV2` vocabulary (12 actions), exact replay/conflict, compatible vs breaking intent revision classification, authority-role binding, and the branded `ReducedTaskMutationV2`.
- `plugins/immune-brain/runtime/kernel/authority_port.ts` implements the opaque single-use capability with a test-only issuer (never exported from `kernel/index.ts`); `intent_token_registry.ts` holds the token brand/WeakMap with private inspect/consume.
- `plugins/immune-brain/runtime/kernel/application_v2.ts` implements the same-lock reread, prior/current token pairing, trusted diff provider, consume-after-preflight ordering, and workspace ownership transitions; `storage.ts` adds the dedicated `.workspace-transaction-v2.json` marker with mutual exclusion and recovery.
- `tests/kernel-r2c2-*.test.ts` prove the closed vocabulary matrix, capability/token failure modes, consumption ordering, stale CAS zero-write behavior, transaction recovery, and the absence of issuer/CLI/creation surface; full repo `727 pass / 0 fail`.

### reusability_critique_notes

- **Falsifiability**: Capability and token identity live in module-private WeakMaps; only the documented test issuer can mint them, and restart discards all in-memory state so the host must re-confirm.
- **Evidence trail audit**: The persisted history audit descriptor is evidence only and cannot authorize another operation; the action fingerprint binds the authority audit so replay of a privileged event is distinguishable.
- **Architecture entropy resistance**: The port is library-only; no CLI, runtime manifest, host adapter, enrollment, import, or creation path exists, and v1 reducer/storage/validation remain byte-compatible.

---
Captured: 2026-08-12 | Source: Assurance Kernel R2C2 Mutation Port Plan (single Step), strict QA (pass), isolated final review with one bounded follow-up (closed), full repo 727 pass / 0 fail

## Pattern: Durable Backend Claim Gates Managed-Mutation Routing

While a production cutover is phased, pin each task's backend with a durable claim and make the legacy runtime's managed-mutation preflight fail closed on any active/draining/terminal Kernel claim.

### Rule

1. Persist one `assurance_kernel/backend_claim/v1` record binding `backend: "kernel"`, task ID, intent revision/hash, enrollment event ID, readiness/evidence digests, lifecycle status (`active | draining | terminal`), and timestamps.
2. Affinity is immutable: `draining` disables new enrollment but lets the same Kernel task finish or receive a user-authorized stop; `terminal` never routes back into v3 and never reconstructs Plan/Step state.
3. The v3 canonical runtime checks the claim before any `projectAccess === "write"` command (plan sync/terminate, work activate/continue/record, review pass/rework/replan/gate-pass, autowork, finish). Absent claim preserves existing v3 behavior; malformed/symlinked/contradictory claim fails closed.
4. Read-only status/progress/readiness/shadow commands and the kernel command itself are never blocked by the guard.
5. Rehearsal (capability inspect + precondition scan) writes nothing and never consumes the capability, producing strict evidence.

### Evidence

- `plugins/immune-brain/runtime/kernel/backend_claim.ts` implements strict parse/read/write/remove plus `assertNoKernelBackendForV3`; `immune_brain_runtime.ts` inserts the guard after project-access preparation and before dispatch.
- `tests/kernel-backend-claim.test.ts` covers absent/active/draining/terminal/malformed; `tests/kernel-canary-rehearsal.test.ts` proves zero-write rehearsal and non-consumption.
- Full repo `771 pass / 0 fail`.

### reusability_critique_notes

- **Falsifiability**: The claim is a plain durable file; protection holds only when every write path checks it. The guard is enforced at the single canonical dispatch point, not per command implementation.
- **Evidence trail audit**: Enrollment history records the waiver descriptor and the actual readiness status/window; nothing rewrites readiness to claim the ordinary gate passed.
- **Architecture entropy resistance**: The claim is additive and off by default; no production issuer, CLI mutation, enrollment side effect, or readiness falsification exists in P2B0.

---
Captured: 2026-08-12 | Source: Assurance Kernel P2B0 Risk-Accepted Canary Core Plan (U1+U2), strict QA (pass), isolated final review (pass), full repo 771 pass / 0 fail

## Pattern: Atomic Enrollment Embeds the Mutation Transaction and Claim Under One Marker

When enrollment must atomically create a TaskRecord, a workspace working claim, and a backend claim, embed the mutation transaction plus the claim inside a single enrollment marker and recover it as one unit under the shared store lock.

### Rule

1. The enrollment marker (`assurance_kernel/enrollment_transaction/v1`) contains the v2 workspace transaction (expected record/workspace hashes + next contents) plus the backend claim.
2. Recovery completes the v2 convergence (task file then workspace file, exact before/after bytes) and only then re-writes the claim and removes the marker; any other partial combination fails closed.
3. The v1 marker, v2 marker, and enrollment marker are mutually exclusive: presence of any two throws `KernelStoreSecurityError` before any recovery write.
4. The enrollment capability is consumed only after every fallible precondition passes and immediately before writing the marker; a marker-write failure burns the capability and requires re-confirmation.
5. Preconditions under the lock include no existing TaskRecord at the task path, no working owner, no existing claim, exact TaskIntent reread/token identity, and readiness/evidence/capability digest agreement.

### Evidence

- `plugins/immune-brain/runtime/kernel/storage.ts` adds `ENROLLMENT_MARKER_PATH`, `commitEnrollmentLocked`, `recoverPendingEnrollmentLocked`, and three-marker mutual exclusion; `enrollment.ts` implements `enrollCanaryTask` and `runEnrollmentRehearsal`.
- `tests/kernel-enrollment-transaction.test.ts` proves atomic absent-to-created, capability-before-marker, mismatch/missing/duplicate/owned rejection; recovery converges and re-writes the claim.
- Full repo `771 pass / 0 fail`.

### reusability_critique_notes

- **Falsifiability**: The marker embeds exact next contents; recovery accepts only combinations matching the marker's exact before/after hashes, so contradictory partial bytes fail closed.
- **Evidence trail audit**: Capability consumption is irreversible and recorded in the enrollment event; replay returns before capability checks.
- **Architecture entropy resistance**: Enrollment is library-only and unreachable from any CLI, host adapter, or RPC in P2B0; the v1 marker path still only recovers v1 and the v2 path only v2/v1/enrollment mutual exclusion.

---
Captured: 2026-08-12 | Source: Assurance Kernel P2B0 Risk-Accepted Canary Core Plan (U1+U2), strict QA (pass), isolated final review (pass), full repo 771 pass / 0 fail

## Pattern: Canonical JSON Signature Format Must Stay Byte-Exact

**Domain**: signature / hash-chain identity / test fixture construction

**Premise**: Authority records that self-hash their body (receipt `record_id`, observation `observation_id`) serialize with the canonical `stableStringify`: objects with `": "` after keys, arrays with `", "` between entries, `undefined` → `"null"`, and sorted keys — matching Python `json.dumps(sort_keys=True)` separators. Any fixture or re-implementation that rebuilds these hashes must copy that exact byte format; a compact `,`/`:` variant silently produces "record hash mismatch".

**reusability**: high

**next_reuse_scenarios**:

- writing integration fixtures that fabricate v2 authority receipts or automatic observations
- re-implementing stable serialization in another runtime (Python, host adapters)
- extending hash-chained journals with new record kinds
- debugging "chain predecessor mismatch" or "record hash mismatch" in test setup

### Reusable template

1. Serialize with sorted keys, `": "` after each key, `", "` between array entries and between object entries, `undefined`/`null` → `null`.
2. Derive record identity as `sha256:${sha256hex(`${domain}\0${stableStringify(body)}`)}` with the record's own domain string (e.g. `assurance-kernel-authority-commit-receipt/v2`, `assurance-kernel-v3-observation/v2`); the body excludes the identity field itself.
3. Chain journals additionally bind `previous_record_hash` to the previous record's `record_id` and verify it on read.
4. For read-only preparation fixtures, compute evidence digests from the live fixture state (e.g. `migrationDryRunDigest(buildMigrationDryRunReport(root))`) rather than hard-coding, so the digest always matches the current ledger bytes.

### Evidence

- `plugins/immune-brain/runtime/canonical_json.ts` (single source of truth, shared by `authority_commit_receipts.ts` and `automatic_observations.ts`); `recordHash` and observation `digest` domains in those modules.
- `tests/pi-canary-enroll-extension.test.ts` `makeEligibleRepo`: the first fixture attempt failed with "authority receipt line 1 record hash mismatch" because it used a compact serializer; switching to the canonical `", "`/`": "` format passed (795 full suite green).
- `docs/solutions/workflow.md` "QA and Review Child Outputs Are Schema-Strict" for the follow-up that shipped this fixture.

### reusability_critique_notes

- **Falsifiability**: The byte format is pinned by existing signatures; a change to `canonical_json.ts` breaks all stored hashes and immediately falsifies this guidance.
- **Evidence trail audit**: Evidence is the canonical module source plus one live fixture failure/pass pair; it does not cover v1 receipts or non-JSON serialization.
- **Architecture entropy resistance**: Appends to the contracts hub next to authority-receipt and observation contracts; no new serializer, schema, or ADR. `CONTEXT.md` maps the runtime kernel contracts already, so no Architecture Map change.

---
Captured: 2026-08-12 | Source: Plan 2026-08-12-012 follow-up handler-level fixture + canonical_json.ts

## Pattern: Privileged Capability Authority Is Minted and Consumed Inside One Closure Pair

Production privileged authority (QA/review/user capabilities) must be minted and
consumed inside one closure-private registry/application pair: the registry owns
its capability state in a WeakMap, the application accepts only its paired
registry, and every consume happens under the Kernel store lock immediately
before the atomic commit. No module-level singleton, no exported issuer, no
serialized capability. Tests issue through a fixture seam under `tests/fixtures/`
so packed runtime bytes contain no `ForTest` issuer.

**reusability**: high

**next_reuse_scenarios**:

- adding any new privileged action kind to the Kernel or another locked state machine
- building a host adapter (Pi, CLI, RPC) that must mint one-shot authority
- auditing "can a capability cross modules/extensions?" in any capability design

### Reusable template

1. Registry factory returns `{ issue, inspect, consume, isConsumed }` with a
   closure `WeakMap`; capabilities carry a registry-branded symbol so a foreign
   registry rejects them.
2. Capability bindings pin the exact action digest (excluding CAS expectations),
   task identity, record/intent/diff identities, and any payload digest
   (e.g. normalized findings for `request_rework`).
3. The consuming application re-validates the full snapshot under the store lock,
   consumes the capability, and commits in the same locked critical section;
   replay returns the committed snapshot without re-consuming; consumed-capability
   retries fail closed and require a fresh invocation.
4. Route "can I have a new invocation?" through a task-scoped linear registry
   (`open -> committed | cancelled`) where timeout/cancel wins first and only the
   `committed` winner may mint/apply; failure leaves the invocation closed.

### Evidence

- `plugins/immune-brain/runtime/kernel/authority_port.ts` (registry/application
  pair), `canary_application.ts` (closed semantic operations + `begin_drain`),
  `storage.ts` (single transaction owner), `.pi-extension/pi-canary-invocations.ts`.
- `tests/kernel-canary-authority.test.ts`, `tests/pi-canary-invocation-registry.test.ts`
  (cross-registry rejection, consumed-capability retry fail-closed, linearization
  races), `tests/kernel-canary-rework-authority.test.ts` (findings-digest binding).
- Live failure during P2B2: initial module-level `inspect/consume` helpers could
  not prove capability provenance; the registry refactor made cross-registry
  rejection a testable property (926/0 suite green after).

### reusability_critique_notes

- **Falsifiability**: A change that exports an issuer, serializes a capability,
  or consumes outside the store lock breaks multiple focused tests immediately.
- **Evidence trail audit**: Covered by 5 focused test files plus the full-suite
  regression; does not cover a second host (OpenCode/RPC deliberately out of scope).
- **Architecture entropy resistance**: Appends to the contracts hub; no new
  abstraction, no ADR (the trade-off is documented in the P2B2 Spec).
  `CONTEXT.md` architecture map already names the Kernel runtime; no map change.

---
Captured: 2026-08-12 | Source: Plan 2026-08-12-013 (U1/U2)

## Pattern: Acceptance Verification Text Is Never Executable — Strict Descriptor Plus Frozen Runner

Free-form `acceptance[].verification` strings must never be executed by a host
adapter. Encode each verification as strict canonical JSON
(`assurance_kernel/verification_descriptor/v1`: contract, runner_id, runner_version,
argv, cwd, timeout_ms, max_output_bytes) with unknown fields rejected; the runner
registry contains only a host-resolved frozen `bun` (absolute realpath,
device/inode, content hash, version) resolved at extension activation and never
from descriptor/model/session input. argv tokens reject shell metacharacters,
`..`, absolute paths, spaces, and control bytes; cwd is repository-relative and
whole-path no-symlink. An Intent whose verification string cannot parse is
ineligible for assurance, never silently downgraded.

**reusability**: high

**next_reuse_scenarios**:

- any adapter that must run user-declared verification commands (Pi extension, future hosts)
- extending the runner registry beyond `bun` (structural trust-boundary change; needs a plan)
- auditing "can the model/child influence the executed command?" in agent tooling

### Reusable template

1. `parseVerificationDescriptor(text)` returns a typed descriptor or throws;
   the complete string is the whole payload (no prefix/suffix tolerance).
2. `resolveBunRunner()` freezes realpath/dev/ino/content-hash/version once per
   process; `assertRunnerCompatible(descriptor, runner)` gates every invocation.
3. Execute with `execFile(frozen.path, argv, { cwd, env: minimal, timeout, maxBuffer })`
   — no shell, no PATH lookup, no environment overrides.
4. The isolated child session construction (fresh `0700` empty no-symlink
   agentDir outside the repo, empty untrusted in-memory settings, all five `no*`
   discovery flags, zero additional/factory paths, no trust preload, same
   loader/settings/agentDir into `createAgentSession`, exact tool-closure
   assertion) is the code-execution isolation boundary; post-load overrides are
   defense/evidence only.

### Evidence

- `plugins/immune-brain/.pi-extension/pi-canary-verification.ts`,
  `pi-canary-child.ts`; `tests/pi-canary-verification-descriptor.test.ts`,
  `tests/pi-canary-child-resource-isolation.test.ts`.
- Live failure during P2B2: the first child-tool design executed verification
  strings as tokenized free text; the descriptor refactor made shell/PATH/cwd
  escape rejection a tested property (full suite 926/0 green after).

### reusability_critique_notes

- **Falsifiability**: Any path that executes a non-descriptor string, resolves a
  runner from input, or skips the version gate breaks focused tests immediately.
- **Evidence trail audit**: Descriptor matrix (12+ rejection cases), frozen-runner
  identity, malicious resource layouts, and the real packed loader all back it.
- **Architecture entropy resistance**: Appends to the contracts hub beside
  capability-authority guidance; no new serializer or ADR. `CONTEXT.md` needs no
  map change (extension files already referenced from the Kernel slice).

---
Captured: 2026-08-12 | Source: Plan 2026-08-12-013 (U2)

## Pattern: Ledger-Derived Evidence Digests Need an Explicit Refresh Protocol

Any evidence bundle that pins a digest derived from the State Ledger (the
readiness `migration_dry_run.digest` is the canonical example) goes stale on
every ledger write: plan activation, `record-execution`, review recording,
and `imm-finish` all change the report and make the committed bundle fail
closed (`evidence_bundle_invalid`). This is correct fail-closed behavior,
not a bug — but it means `candidate` is not a persistent state. Operating
protocol: refresh the bundle (recompute the canonical digest, collect
current observation receipt ids, update `generated_at`, commit) immediately
before any enrollment or promotion verification, and run no ledger-writing
commands between the refresh and the check. Tests that assert live
repository state should follow the observed state (candidate => eligible;
blocked/collecting => fail-closed) instead of hard-coding a transient
status.

**reusability**: high

**next_reuse_scenarios**:

- operating any gate that consumes a ledger-derived digest (readiness, promotion, enroll)
- writing live-repository tests that assert eligibility or routing state
- extending the readiness evidence bundle with new pinned facts

### Evidence

- P2C execution: the bundle went stale three times in one plan (P2C
  activation, Step 1 evidence recording, Step 2 activation), each time
  correctly failing closed; the maintenance protocol is now spec §7.1 of
  `docs/specs/assurance-kernel-v4-p2c-pi-default-routing.spec.md` and the
  live-boundary test follows the observed state.
- `plugins/immune-brain/runtime/kernel/readiness_evidence.ts` +
  `readiness.ts` (digest match check at readiness.ts:248).

### reusability_critique_notes

- **Falsifiability**: a ledger write that does NOT invalidate the digest
  (or a refresh that does not restore candidate) breaks the documented
  protocol and the live-boundary consistency assertions immediately.
- **Evidence trail audit**: three independent stale-bundle incidents in one
  plan with the same root cause; fix and protocol reviewed by the final
  code-review gate (advisory #1) and QA.
- **Architecture entropy resistance**: appends to the contracts hub next to
  the readiness/capability guidance; no new abstraction or ADR.

---
Captured: 2026-08-13 | Source: Plan 2026-08-13-014 (P2C)

## Pattern: Immutable Step Scope Omission Is Repaired by a Replacement Fix Plan

**领域**: Workflow runtime / Plan lifecycle / immutable Scope contracts
**描述**: 当一个激活 Step 的不可变 Scope 遗漏了其 Verification 或实现必然触及的 owner 文件（manifest 断言测试、布局断言测试、共享模块 re-export 的下游）时，不能 in-place 修改 Scope，也不能把 Scope 外文件塞进 evidence。正确路径是：终止当前 Plan（`superseded`，`reason_code: boundary_error`），起草一个替换 fix Plan，把遗漏 owner 显式加入修复 Step 的 Scope，原样保留已关闭的前驱 Step 与未执行的后继 Step，然后 fresh 验证并正常 QA/审查。

**reusability**: high
**next_reuse_scenarios**: [`imm-work record-execution 拒绝 Scope 外 changed files`, `激活 Plan 的 Step Scope 遗漏 manifest/布局断言 owner`, `共享模块抽取改变了扩展目录布局`, `CLI manifest 新增子命令导致精确列表断言失效`]

### 场景

- 步骤实现完成、测试全绿，但 `record-execution` 报 `Changed files outside the active Step Scope`，且缺失文件是步骤变更的直接下游断言（例如新增 CLI 子命令后 manifest 精确列表断言、共享 parser 抽取后扩展 re-export 布局断言）。
- 撤销这些文件会让全量测试失败（步骤 Verification 含 `bun test`），保留则无法记录 evidence → 结构性不可关闭。
- 激活 Plan 禁止 in-place 修改 Scope（immutable semantics）。

### 方案模板

1. **确认结构性缺口**: 用 `git stash` 撤销候选文件验证全量测试确实失败（证明它们不是可选项），再恢复。
2. **终止当前 Plan**: `imm-plan --terminate-current --status superseded --reason-code boundary_error --stage "<step> execution" --invalidated-assumption "<Scope 覆盖了 Verification 所需全部 owner>" --avoidable no --user-confirmed`。
3. **起草替换 fix Plan**: Type: fix；Predecessor 指向被终止 Plan；只替换有缺口的 Step（Scope 增加遗漏 owner 并加入 focused Verification），已关闭前驱 Step 不重复（其行为由 cumulative verification 覆盖），未执行后继 Step 原样保留（依赖用数字序号，如 `- Depends on: 1`）。
4. **fresh 验证**: 不继承前驱执行/QA/审查证据；新 Plan 激活后重跑全部 focused + 全量验证再记录 evidence（replan 语义下 changed_files 为 self-reported，QA 会以 focused 验证为准）。
5. **正常闭环**: 修复 Step QA pass → 后继 Step → final review → finish。

### 验证依据

- 2026-08-12: P2B1 Plan 011 U2 Scope 遗漏 `runtime-stub.ts`/`storage.ts`/`commands/kernel.ts` → 终止（boundary_error）→ fix Plan 012 单步替换。
- 2026-08-13: P3 Plan 015 U2 Scope 遗漏 `tests/kernel-r2a-boundary.test.ts`（imm-kernel 精确 subcommand 列表）与 `tests/pi-canary-discovery-regression.test.ts`（共享 parser 抽取后的扩展布局）→ 终止（boundary_error）→ fix Plan 016 替换 U2 并保留 U3，两次复发确认该模式可复用。
- `plugins/immune-brain/runtime/workspace_scope.ts:assertChangedFilesWithinScope` 是 Scope 硬门禁；`plugins/immune-brain/runtime/commands/work.ts` 的 `record-execution` 用它拒绝 Scope 外文件。
- `docs/plans/2026-08-13-016-fix-assurance-kernel-p3-v3-creation-retirement-scope-plan.md` 与 `docs/plans/2026-08-12-012-fix-assurance-kernel-p2b1-enrollment-scope-plan.md` 是两次完整修复先例。

### reusability_critique_notes

- **Falsifiability**: 若某步骤 Scope 真的覆盖全部 owner，或缺失文件可合法移入其他边界，本模式不适用；只有当撤销文件导致 Verification 失败时才成立。
- **Evidence trail audit**: 两次独立复发（P2B1 012、P3 016）都走同一条 supersede→fix-Plan 路径闭环；016 的 U2/U3 均 QA pass 且 final review 通过。
- **Architecture entropy resistance**: 追加到 Contracts Hub 的 immutable semantics 邻域，不引入新抽象；延续现有「explicit termination archives state」规则，无新 authority。

---
Captured: 2026-08-13 | Source: Plan 2026-08-13-016 (P3 scope repair)

---

## Pattern: Settlement Enumeration for Settlement-Class Intents

**Domain**: Assurance planning contracts / terminal settlement semantics
**Description**: When a TaskIntent touches terminal settlement, cancellation, timeout, race, or authority-lifecycle semantics, review rounds tend to discover sibling paths of the same state machine serially — one finding per round, each forcing a repair successor. The safer contract is: every settlement-class intent embeds an explicit trigger x state x terminal-owner enumeration and lists every same-state-machine path in scope_hint, so one design pass and one review round can audit the complete machine instead of discovering it one finding at a time.

**reusability**: high
**next_reuse_scenarios**: [`writing a TaskIntent for settlement, cancellation, or race semantics`, `revising a planner contract for state-machine work`, `packaging a review prompt that must enumerate terminal paths`, `reviewing whether an intent is execution-ready for settlement-class changes`]

### Reusable template

1. **Classify**: A TaskIntent is settlement-class when its scope touches terminal settlement, cancellation, timeout, race, dispatch failure, or authority lifecycle. Classification goes into the intent goal, not an implicit property.
2. **Trigger sources**: Enumerate every event that can start, interrupt, or settle a job: completion, stop, cancel, timeout, dispatch failure, provider failure, and session shutdown.
3. **State inventory**: Enumerate every job state the change introduces or mutates (pending, reserved, dispatched, settling, terminal) and the transitions between them.
4. **Terminal ownership**: Name the single authority that may settle each transition (host-created branded receipt, validated native terminal status, literal-user confirmation) and state explicitly which local signals (promise resolution or rejection, elapsed time, child acknowledgement) are non-authoritative.
5. **Same-state-machine coverage**: scope_hint must list every code path that owns a transition of the same state machine — not only paths the diff touches — so one review round can audit the whole machine.
6. **Gate**: An intent classified as settlement-class without this enumeration is not execution-ready; return it for enrichment rather than enrolling it.

### Evidence

- `plugins/immune-brain/dist/imm-planner.md` `Settlement-Design Contract` section mandates the enumeration for settlement-class intents; `plugins/immune-brain/skills/imm-planner/SKILL.md` references the requirement from the packaged contract.
- `tests/planner-settlement-contract.test.ts` asserts the requirement text is present in the packaged contract and source skill entry point and that this pattern entry exists in the hub.
- Origin evidence: the phase-aware Assurance retrofit (Pi session `01a0088c`, tasks `2026-08-16-001` through `-005`) ran five sequential repair tasks for one feature; every Review finding was the same semantic class — paths still trusting local handle state instead of host receipts — discovered serially, and each round hit the two-round follow-up cap and required a successor task.

### reusability_critique_notes

- **Falsifiability**: This pattern does not prove that a state machine is correct; it only forces the machine's surface (triggers, states, owners, paths) to be declared before enrollment so review can audit it in one pass. Non-settlement work with no terminal or race semantics is exempt.
- **Evidence trail audit**: The serial-discovery failure was reproduced across five real tasks with review findings and cap stops in each; the contract test now pins the requirement text. It does not prove that every future intent will enumerate correctly — that depends on planner adherence, which the contract and Review neighborhood prompts enforce.
- **Architecture entropy resistance**: Append to the Contracts hub because it crosses planner contracts, intent authorship, review dispatch, and bundle capture boundaries. It adds no new runtime authority, no second state model, and no workflow state; it only requires existing settlement-class intents to declare their machine surface upfront.

---
Captured: 2026-08-16 | Source: session 01a0088c retro + TaskIntent 2026-08-16-006-settlement-design-contract
