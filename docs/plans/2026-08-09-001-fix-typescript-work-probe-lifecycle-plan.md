# Iteration Plan

## Task

- Summary: Restore the accepted `parallel_probes` Step lifecycle in the Bun/TypeScript runtime with durable host handoff, structured child evidence, and interruption-safe recovery.
- Origin: Read-only Immune-Brain architecture exploration found that packaged Skills require `active -> probing -> executing`, while the TypeScript runtime has no production entry into `probing`; targeted Git history confirmed that commit `f9b5e8f` retired the working Python path without mapping this contract into the Bun runtime.
- Spec: `docs/specs/2026-08-09-typescript-work-probe-lifecycle-repair.spec.md`
- Research: The accepted `imm-work-parallel-probes-runtime` Spec and `docs/solutions/contracts.md` require deterministic host envelopes, fallback evidence, `child_evidence`, and probe lifecycle transitions. The current runtime already parses and syncs `parallel_probes`, schema v3 admits `probing` and `executing`, and `recordExecution()` accepts those states, but `imm-work continue` only returns status and is classified read-only. The retired Python runtime built provider-free envelopes and persisted fallback evidence; its provider call remained host-bound. No current repository Ledger record is persisted in `probing` or `executing`. The planner ensemble gate classified the repair as high risk but resolved to `single_model_fallback`; three prior read-only Domain Maps supplied runtime, Skill-contract, and verification evidence instead of a duplicate ensemble.
- Decisions: D1 treat the gap as a TypeScript retirement regression, not ceremonial state to delete. D2 retain schema v3 and existing Step states. D3 add one TypeScript work-probe helper for deterministic envelopes and normalized outcomes without provider calls. D4 make `imm-work continue` persist `active -> probing` only when a probe checkpoint must begin or recover. D5 add structured `imm-work record-probes` ingestion with Step identity, Ledger freshness, complete deterministic probe IDs, and atomic `probing -> executing`. D6 make retries deterministic and identical result replay idempotent while rejecting conflicting replay. D7 prevent Steps with unconsumed probes from bypassing the checkpoint through `record-execution`, while preserving no-probe and rework behavior. D8 keep probe children read-only and advisory; only runtime mutation paths write the Ledger. D9 update shipped Skill and host contracts only after the behavior exists. D10 do not port retired Python abstractions that are not required by the accepted contract.
- Assumptions: Schema v3's existing `parallel_probes`, `child_evidence`, state values, history, Ledger version, lock, and atomic commit primitives can represent the repair without migration; repository-external schema v3 Ledgers may contain `probing` or `executing` and must recover conservatively; host runtimes can execute deterministic read-only envelopes and return structured results but the CLI must remain provider-independent.
- Workflow profile: strict
- Compounder: required
- Scope Mode: New Slice
- Plan boundary: Restore the TypeScript work-probe runtime invariant from persisted checkpoint through executor handoff, then synchronize the shipped host contracts and regression surface.
- Boundary rationale: State transitions, structured evidence ingestion, interruption recovery, host routing, and packaged contract truth describe one existing workflow promise. Shipping only a subset would either expose an unreachable state, accept unauthoritative evidence, or leave hosts calling nonexistent APIs.
- Scope pressure: High-risk workflow state repair across one new runtime helper, State Ledger mutation semantics, the `imm-work` command/router, package adapters, shipped Skill contracts, and behavioral tests. The slice excludes generic dispatch, schema migration, command-context refactors, and all unrelated workflow changes.

## Output Language

- Language: English
- Reason: Repository planning artifacts default to English; user-facing progress remains Chinese. File paths, commands, enum values, JSON fields, and code identifiers remain literal.

## Devil's Advocate Audit

1. **Rollback Resilience**: Do not introduce schema v4 or a persisted probe-run object that the current runtime cannot read. Commit `probing` before host dispatch, use existing atomic Ledger writes, and prove that an interrupted schema v3 Step can be inspected and continued after code rollback through the existing sequential execution path.
2. **Verification Vanity**: Pure helper tests and assertions that state names or Skill prose exist do not prove the repair. Separate CLI process tests must observe `active -> probing -> executing`, stable retries, fallback evidence, stale and conflicting result rejection, lost-response recovery, direct execution bypass prevention, and unchanged no-probe/rework behavior.
3. **Spec Dilution Detection**: The Plan fails if it merely edits packaged docs, deletes `probing`, performs provider calls in runtime, or records free-text child claims. Production TypeScript mutation sites, structured ingestion, and host-visible evidence must all exist and agree before contract updates pass.

## Planning Quality Gate

- **contract surface**: `plugins/immune-brain/runtime/work_probes.ts`, `state_ledger.ts`, `commands/work.ts`, `immune_brain_runtime.ts`, `imm_core.ts`, CLI command manifests, packaged `imm-work` and `imm-executor` contracts, OpenCode adapters, and focused runtime/package tests.
- **compatibility**: Keep schema v3, no-probe execution, rework, Standard/Strict closure, follow-ups, and current project migration behavior. Recover repository-external `probing` or `executing` records without inferring evidence from free text. `imm-work status` remains zero-write.
- **interruption recovery**: Persist `probing` before host dispatch; regenerate stable envelopes from immutable Plan data; validate result ingestion against Step identity and Ledger revision; make identical committed replay observable without duplicate evidence; expose committed evidence through status after a lost response.
- **rollback path**: Revert runtime and contract files as one unit. No data migration is required; schema v3 remains readable, and the pre-repair runtime can accept sequential execution evidence from `probing` or `executing` if rollback occurs mid-Step.
- **verification strength**: New helper and separate-process CLI behavior tests, State Ledger transition tests, execution-evidence compatibility tests, package and OpenCode adapter tests, packaged Skill contract assertions, Plan validation, and `git diff --check`.
- **replan condition**: Replan if schema v3 cannot represent deterministic replay without ambiguous state, if host result ingestion requires provider SDK calls in runtime, if current lock/revision primitives cannot reject stale cross-Step results, or if package adapters cannot return the structured envelope and result contract without a broader public API change.
- **advisory interpretation**: Runtime, Skill-contract, and verification Domain Maps agreed that the shipped contract is intentional and the TypeScript ownership boundary is incomplete. The strongest contrary hypothesis, that the states are ceremonial and should be removed, was disproved by the accepted probe Spec, durable solution, retired implementation, and current packaged host instructions.

## Steps

### Step 1

- Step ID: U1
- Result: The TypeScript runtime exposes one interruption-safe `parallel_probes` checkpoint that remains deterministic across separate CLI calls through executor routing.
- Scope: `plugins/immune-brain/runtime/work_probes.ts`; `plugins/immune-brain/runtime/state_ledger.ts`; `plugins/immune-brain/runtime/commands/work.ts`; `plugins/immune-brain/runtime/immune_brain_runtime.ts`; `plugins/immune-brain/runtime/imm_core.ts`; `tests/work-probes-runtime.test.ts`; `tests/runtime-state.test.ts`; `tests/execution-evidence-runtime.test.ts`
- Verification: `bun test tests/work-probes-runtime.test.ts tests/runtime-state.test.ts tests/execution-evidence-runtime.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-08-09-001-fix-typescript-work-probe-lifecycle-plan.md --json && git diff --check`
- Verification type: automated
- Agent Hint: imm-executor
- Test scenarios: Covers no probes; eligible probes; stable envelope IDs; read-only advisory packets; `auto`, `explicit_only`, `disabled`, unavailable host, authorization fallback, dispatch failure, and timeout; committed `active -> probing`; repeated `continue`; complete success and mixed outcomes; missing, duplicate, unknown, stale, and cross-Step results; identical and conflicting replay; lost response recovered through status; `probing -> executing`; unconsumed-probe `record-execution` rejection; existing no-probe, rework, Standard, Strict, and execution-attempt behavior.
- Discovery cache: `plugins/immune-brain/runtime/state_ledger.ts` (schema v3 transitions, child evidence, lock and atomic commit); `plugins/immune-brain/runtime/commands/work.ts` (current read-only continue and record-execution mutation); `plugins/immune-brain/runtime/immune_brain_runtime.ts` (command access and host manifest); `plugins/immune-brain/runtime/advisory_dispatch.ts` (current activation and advisory vocabulary); `docs/specs/imm-work-parallel-probes-runtime.spec.md` (accepted behavior); `docs/solutions/contracts.md` (durable lifecycle rationale); Git parent of `f9b5e8f` retired Python work-probe helper and work driver (behavior evidence, not code to copy wholesale)
- Depends on: none
- failure_behavior: Reject malformed, incomplete, stale, or conflicting probe results before mutation. If host dispatch cannot proceed, persist a classified fallback as advisory child evidence and continue sequentially; never infer success or evidence from missing child output.
- security_considerations: Derive scope and identity from the immutable Step, reject caller-controlled path authority, keep probes read-only and advisory, use Ledger revision plus lock/atomic commit for every mutation, and never let child evidence close execution or QA.

### Step 2

- Step ID: U2
- Result: Every shipped host surface enforces the restored TypeScript probe lifecycle as one package contract protected against runtime-retirement regressions.
- Scope: `plugins/immune-brain/dist/imm-work.md`; `plugins/immune-brain/dist/imm-executor.md`; `plugins/immune-brain/skills/imm-work/SKILL.md`; `plugins/immune-brain/skills/imm-executor/SKILL.md`; `tests/baseline-packaging-contract.test.ts`; `tests/plugin-package-runtime.test.ts`; `tests/opencode-cli-adapter.test.ts`; `plugins/immune-brain/tests/opencode-runtime.test.ts`; `tests/imm-loop-completion-gate.test.ts`
- Verification: `bun test tests/work-probes-runtime.test.ts tests/runtime-state.test.ts tests/execution-evidence-runtime.test.ts tests/baseline-packaging-contract.test.ts tests/plugin-package-runtime.test.ts tests/opencode-cli-adapter.test.ts plugins/immune-brain/tests/opencode-runtime.test.ts tests/imm-loop-completion-gate.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-08-09-001-fix-typescript-work-probe-lifecycle-plan.md --json && git diff --check`
- Verification type: automated plus diagnostics
- Agent Hint: imm-executor
- Test scenarios: Covers CLI help and JSON command shape; package-installed `continue` and `record-probes`; OpenCode argument translation; loader-visible Skill boundary; exact runtime module and command names in packaged contracts; fallback and child-evidence handoff language; absence of provider calls in tests; full-loop behavior still requiring execution evidence and the configured QA/review authority after probe evidence.
- Discovery cache: `plugins/immune-brain/dist/imm-work.md` (shipped probe owner contract); `plugins/immune-brain/dist/imm-executor.md` (child-evidence consumer contract); `plugins/immune-brain/skills/imm-work/SKILL.md` and `imm-executor/SKILL.md` (host discovery shims); `tests/plugin-package-runtime.test.ts` (packaged CLI boundary); `tests/opencode-cli-adapter.test.ts` and `plugins/immune-brain/tests/opencode-runtime.test.ts` (host argv and tool schema); `scripts/dist-sync-manifest.ts` (confirms packaged Skill contracts are not generated by docs sync)
- Depends on: U1
- failure_behavior: If a host cannot represent structured probe results, stop and replan the public command boundary; do not restore free-text evidence, host-specific runtime imports, or a documentation-only fallback.
- security_considerations: Package and adapter tests must prove host inputs reach the same strict runtime validator, and Skill prose must not grant probe children execution, QA, Plan mutation, or scope-expansion authority.

## Validation

- Validate without sync: `plugins/immune-brain/bin/imm-plan docs/plans/2026-08-09-001-fix-typescript-work-probe-lifecycle-plan.md --json`.
- Sync is intentionally blocked until `docs/plans/2026-08-05-001-refactor-risk-tiered-workflow-execution-plan.md` reaches a terminal state through `imm-finish` or explicit user-confirmed termination. Its Steps and final code review are closed, but the current Ledger has `plan_terminal: null`.
- After the current Plan is terminal, sync this Plan with `plugins/immune-brain/bin/imm-plan docs/plans/2026-08-09-001-fix-typescript-work-probe-lifecycle-plan.md --sync --json`, then use the runtime-reported continuation entry.
