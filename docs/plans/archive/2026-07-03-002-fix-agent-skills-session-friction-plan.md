---
title: "fix: agent-skills session friction repair"
type: fix
status: planned
date: 2026-07-03
origin:
  - docs/specs/2026-07-03-agent-skills-session-friction-repair.spec.md
  - user request: 确保 session 发现的问题都被修复
  - session: /Users/derek/.pi/agent/sessions/--Users-derek-workspaces-refine--/2026-07-03T09-45-25-801Z_019f275e-6629-7db3-adfc-639aba56300a.jsonl
---
# Iteration Plan

## Task

- Summary: 修复 pi session 暴露出的 Immune-Brain workflow 摩擦，让 Plan 校验、execution evidence、QA/review gate、host 工具适配和 executor safety 在 runtime 与 skill 合同中保持一致。
- Spec: docs/specs/2026-07-03-agent-skills-session-friction-repair.spec.md
- Origin: 用户要求基于 pi session 分析 agent-skills 存在的问题，并确保发现的问题都被修复。session 证据显示 MCP fallback、Plan parser、record-execution、QA/review gate、TaskUpdate 工具泄漏、destructive edit 与 untracked 收口都有实际摩擦。
- Research: `CONTEXT.md` 将 workflow runtime、Plan validation and sync、Skill contracts 与 plugin-local runtime 定义为关键架构面。`docs/reference/planning-quality-gate.md` 要求 runtime state、cross-host behavior、reviewer contract 与 rollback-sensitive workflow 改动通过 quality gate。现有 tests 包括 `plan-validation.test.ts`、`plugin-package-runtime.test.ts`、`imm-autowork-continuation-runtime.test.ts`、`imm-loop-review-orchestration-contract.test.ts`、`imm-loop-review-lifecycle-state.test.ts`、`baseline-packaging-contract.test.ts` 与 `host-runtime-cutover.test.ts`，可承载本修复的 focused regression。
- Decisions: D1 Runtime 是 Plan dependency、execution evidence 与 review gate 的唯一机器权威。D2 Skill docs 只能解释 runtime snapshot，不再追加隐藏 gate。D3 `record-execution` 输入统一归一到 `changed_files: string[]` 与 `verification_result: string`。D4 Pi-facing contracts 使用 Pi 当前 task tool `todo`，共享文档只能用 host abstraction。D5 保持 `imm-autowork` checkpoint-only，不新增 default QA pass。D6 修复 active contracts，不重写历史 archive 或 upstream reference。
- Assumptions: Existing State Ledger can store normalized evidence and review pass records without schema migration. MCP server installation can remain external to package install, but active docs must make the boundary obvious. Focused Bun tests are sufficient regression coverage for this slice.
- Scope Mode: Hold Scope
- Planner research dispatch: solo; session analysis, runtime snippets, active skill contracts, current tests, CONTEXT.md and planning quality gate provide enough evidence for this executable slice.

## Output Language

- Chinese prose for human-facing Spec and Plan. Runtime symbols, command names, API fields and file paths stay in English.

## Devil's Advocate Audit

- **Rollback resilience**: Each step changes a bounded contract surface. U1 can be reverted by restoring parser/evidence runtime and its tests. U2 can be reverted by restoring autowork/review gate runtime and loop/QA contracts. U3 and U4 can be reverted by restoring skill/docs text and contract tests. No planned step requires State Ledger migration.
- **Verification vanity**: Verification uses focused Bun tests plus plan validation and negative text assertions. The tests must exercise the exact regressions from the session: `Depends on: U1`, `record-execution --help`, JSON evidence input, review gate snapshot authority, absence of Pi-incompatible `TaskUpdate`, and destructive edit protocol presence. Simple file existence checks are not accepted.
- **Spec dilution detection**: FR-001 through FR-010 from the Spec are mapped into the four steps. No discovered issue is deferred. Historical archive cleanup is explicitly out of scope because the session failures came from active runtime and active contracts.

## Planning Quality Gate

- **contract surface**: `plugins/immune-brain/runtime/imm_core.ts`, `plugins/immune-brain/runtime/immune_brain_runtime.ts`, `plugins/immune-brain/dist/imm-loop.md`, `plugins/immune-brain/dist/imm-work.md`, `plugins/immune-brain/dist/imm-executor.md`, `plugins/immune-brain/dist/imm-qa.md`, `plugins/immune-brain/skills/imm-loop/SKILL.md`, `plugins/immune-brain/skills/imm-work/SKILL.md`, `plugins/immune-brain/skills/imm-executor/SKILL.md`, `plugins/immune-brain/skills/imm-qa/SKILL.md`, `README.md`, `docs/user_manual.md`, and focused tests under `tests/`.
- **compatibility**: Existing numeric `Depends on` remains valid. Existing CLI flag mode remains valid. MCP tools remain compatible while accepting normalized evidence. `imm-autowork` remains checkpoint-only.
- **interruption recovery**: If execution stops midway, rerun the step verification command. Runtime evidence parsing and review snapshots should either remain old behavior or fully normalized behavior, never a partially documented mode.
- **rollback path**: Revert this Spec, this Plan, runtime edits, skill/docs edits, and focused tests for the failed step. No `.imm/memory/` migration rollback is planned.
- **verification strength**: Parser/runtime tests prove behavior. Contract tests prove active docs and skills do not regress. Negative text checks prevent host-tool leakage.
- **acceptance scope discipline**: Current acceptance covers all session-discovered agent-skills issues. It does not claim to repair unrelated upstream docs or refine project working tree state.

## Steps

### Step 1

- Step ID: U1
- Result: Runtime interfaces accept session recovery inputs consistently
- Verification type: automated
- Verification: `bun test tests/plan-validation.test.ts tests/plugin-package-runtime.test.ts tests/imm-autowork-continuation-runtime.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-03-002-fix-agent-skills-session-friction-plan.md --json`
- Execution note: test-first
- Test scenarios: Covers `Depends on: U1` normalization; Covers Chinese Result punctuation without false multi-outcome failure; Covers `record-execution --help`; Covers flags evidence mode; Covers JSON evidence mode; Covers MCP/direct schema accepting string or array changed files.
- Discovery cache: plugins/immune-brain/runtime/imm_core.ts (`parseDependsOn`, `validatePlan`, `validateReadyForReviewEvidence`); plugins/immune-brain/runtime/immune_brain_runtime.ts (`runWorkCommand`, tool schemas, CLI option parsing); tests/plan-validation.test.ts (Plan parser regression); tests/plugin-package-runtime.test.ts (MCP and CLI parity); tests/imm-autowork-continuation-runtime.test.ts (record-execution workflow fixture)
- Agent Hint: imm-executor
- Depends on: none
- failure_behavior: If evidence normalization requires a State Ledger schema migration, stop and replan before writing migration code.
- security_considerations: Evidence input must remain local CLI or MCP data only. Do not execute content from JSON evidence.

### Step 2

- Step ID: U2
- Result: Workflow gates expose one authority source
- Verification type: automated
- Verification: `bun test tests/imm-loop-review-orchestration-contract.test.ts tests/imm-loop-review-lifecycle-state.test.ts tests/imm-loop-completion-gate.test.ts tests/autowork-false-completion.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-03-002-fix-agent-skills-session-friction-plan.md --json`
- Execution note: test-first
- Test scenarios: Covers autowork snapshot exposing `recommended_authority`, `allowed_actions`, `required_input`, `review_status`, `pending_review_gate` and `required_review_gates`; Covers material changed files producing review gate reason; Covers `imm-loop` not directly granting QA pass; Covers `imm-qa` owning QA decision after evidence exists; Covers no runtime default QA pass.
- Discovery cache: plugins/immune-brain/runtime/immune_brain_runtime.ts (`runAutoworkCommand`, `buildAutoworkSnapshot`, review context); plugins/immune-brain/runtime/imm_core.ts (`determineRequiredReviewGates`, review pass signatures); plugins/immune-brain/dist/imm-loop.md (loop authority contract); plugins/immune-brain/dist/imm-qa.md (QA authority contract); tests/imm-loop-review-orchestration-contract.test.ts (review gate contract); tests/imm-loop-review-lifecycle-state.test.ts (review lifecycle state); tests/imm-loop-completion-gate.test.ts (completion gate)
- Agent Hint: imm-executor
- Depends on: 1
- failure_behavior: If runtime and skill disagree on gate ownership, prefer runtime output and update skill text to match it.
- security_considerations: Review gate pass must remain tied to changed-files signature and must not approve unrelated files.

### Step 3

- Step ID: U3
- Result: Host contracts prevent session tool drift
- Verification type: automated
- Verification: `bun test tests/baseline-packaging-contract.test.ts tests/host-runtime-cutover.test.ts tests/plugin-package-runtime.test.ts && ! rg -n "TaskUpdate|TaskCreate" plugins/immune-brain/dist plugins/immune-brain/skills README.md docs/user_manual.md && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-03-002-fix-agent-skills-session-friction-plan.md --json`
- Execution note: characterization-first
- Test scenarios: Covers Pi-facing contracts using `todo` or host-neutral task wording; Covers MCP install boundary and CLI fallback text in README and user manual; Covers no active Pi contract recommending `TaskUpdate` or `TaskCreate`; Covers plugin runtime parity after schema changes.
- Discovery cache: README.md (Pi MCP setup and fallback docs); docs/user_manual.md (workflow usage docs); plugins/immune-brain/dist/registry.yaml (skill route text); plugins/immune-brain/skills/registry.yaml (source registry); tests/baseline-packaging-contract.test.ts (packaging contract); tests/host-runtime-cutover.test.ts (host runtime contract); tests/plugin-package-runtime.test.ts (MCP tool schema parity)
- Agent Hint: imm-executor
- Depends on: 2
- failure_behavior: If upstream references still mention Task tools, keep them only under `upstreams/` and exclude them from active Pi-facing assertions.
- security_considerations: MCP setup docs must not imply package install writes user global MCP config silently.

### Step 4

- Step ID: U4
- Result: Executor contracts block unsafe edit patterns
- Verification type: automated
- Verification: `bun test tests/baseline-packaging-contract.test.ts tests/imm-loop-review-orchestration-contract.test.ts tests/host-runtime-cutover.test.ts && python3 -c "from pathlib import Path; import sys; checks=[('plugins/immune-brain/dist/imm-work.md','destructive edit protocol'),('plugins/immune-brain/dist/imm-executor.md','destructive edit protocol'),('plugins/immune-brain/dist/imm-loop.md','untracked')]; missing=[f'{p}:{s}' for p,s in checks if s not in Path(p).read_text()]; sys.exit('\n'.join(missing)) if missing else print('executor safety contract checks passed')" && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-03-002-fix-agent-skills-session-friction-plan.md --json`
- Execution note: characterization-first
- Test scenarios: Covers destructive edit protocol in work and executor contracts; Covers post-edit local verification guidance; Covers session closeout reporting tracked and untracked files; Covers `.pi/tasks` treated as host temporary state unless explicitly requested.
- Discovery cache: plugins/immune-brain/dist/imm-work.md (work execution contract); plugins/immune-brain/dist/imm-executor.md (executor contract); plugins/immune-brain/dist/imm-loop.md (loop closeout contract); plugins/immune-brain/skills/imm-work/SKILL.md (source work skill); plugins/immune-brain/skills/imm-executor/SKILL.md (source executor skill); tests/baseline-packaging-contract.test.ts (dist/source packaging contract); tests/host-runtime-cutover.test.ts (active host contract)
- Agent Hint: imm-executor
- Depends on: 3
- failure_behavior: If safety text conflicts with host edit tool instructions, keep the stricter exact-replacement requirement and document the exception explicitly.
- security_considerations: Destructive edit rules must not encourage broad rewrites or unreviewed deletion of generated state.

## Validation

- Plan validator: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-03-002-fix-agent-skills-session-friction-plan.md --json`
- Runtime sync: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-03-002-fix-agent-skills-session-friction-plan.md --sync`

## Notes

- This Plan intentionally fixes active runtime and active contracts only. Historical upstream references are not acceptance targets.
- Step 4 is separate because destructive edit and closeout behavior are skill-contract safety guarantees rather than runtime parser behavior.
