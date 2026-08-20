# Iteration Plan

## Task

- Summary: Complete the shipped TypeScript work-probe host contract with an isolated verification boundary that is independent of unrelated BASELINE copy drift.
- Origin: Strict QA returned `replan` for U1 of `docs/plans/2026-08-09-002-fix-opencode-work-probe-contract-plan.md`. Test-first execution proved the OpenCode and lifecycle assertions are correctly RED, but the declared full-file Verification also runs an existing BASELINE parity case that fails because `plugins/immune-brain/skills/BASELINE.md` has pre-existing drift outside the Step Scope. The exact Verification was therefore permanently unreachable without an unrelated Scope violation.
- Spec: `docs/specs/archive/2026-08-09-opencode-work-probe-contract-repair.spec.md`
- Research: Independent QA reproduced `35 pass / 6 fail` and isolated the BASELINE parity case as `0 pass / 1 fail`. The five target failures map to missing OpenCode schema/argv and packaged contract implementation. The package-wrapper and loop-authority test-first cases already pass against U1 runtime behavior. `tests/baseline-packaging-contract.test.ts` currently contains the new work-probe assertion from the superseded attempt; execution must move that assertion into a dedicated focused file, preserving the original parity test unchanged.
- Decisions: D1 preserve the accepted host/package design and implementation Scope. D2 move only the newly added work-probe packaging assertion from the broad BASELINE suite into `tests/work-probe-packaging-contract.test.ts`. D3 do not edit any BASELINE copy or weaken its parity assertion. D4 retain test-first changes from the superseded attempt as input context, then make them GREEN through the OpenCode adapter and packaged Skill implementation. D5 keep the TypeScript CLI as the sole lifecycle validator and Ledger writer. D6 verify the known BASELINE drift separately as a reported repository health issue, not as a closure condition for this feature Step.
- Assumptions: The known BASELINE drift predates this lifecycle work and remains out of scope; Bun supports independent test files without shared setup; the U1 runtime implementation and its independent QA pass remain valid; final cumulative code review sees the full uncommitted lifecycle and host-contract delta even though successor activation baselines earlier closed work.
- Workflow profile: strict
- Compounder: required
- Scope Mode: New Slice
- Plan boundary: Repair the OpenCode/package host contract plus its own isolated regression boundary; exclude the unrelated BASELINE copy synchronization task.
- Boundary rationale: The adapter, packaged prose, and focused tests are one reversible host interface outcome. BASELINE copy drift has a different owner, failure cause, and repair path.
- Scope pressure: One cohesive Step touches two OpenCode owners, two shipped Skill documents, four existing behavioral test surfaces, and one dedicated packaging contract test. `tests/baseline-packaging-contract.test.ts` is included only to remove the misplaced assertion added by the superseded attempt.

## Output Language

- Language: English
- Reason: Repository planning artifacts default to English; user-facing progress remains Chinese. File paths, commands, enum values, JSON fields, and code identifiers remain literal.

## Devil's Advocate Audit

1. **Rollback Resilience**: Adapter tools, packaged prose, and focused tests revert as one unit. The existing TypeScript CLI and schema v3 remain intact. Moving the new assertion leaves the original BASELINE suite byte-equivalent except for removal of superseded-attempt lines.
2. **Verification Vanity**: Exact argv, typed schema rejection, package-wrapper process calls, probe outcome variants, and full-loop authority checks must pass. The dedicated packaging test asserts concrete TypeScript module and command names while rejecting the retired Python API.
3. **Spec Dilution Detection**: The Step fails if it suppresses the existing BASELINE parity failure, edits BASELINE copies, leaves the new assertion in the broad suite, exposes only one OpenCode tool, duplicates runtime validation, or permits probe evidence to cross execution/review authority boundaries.

## Planning Quality Gate

- **contract surface**: OpenCode tool schemas and argv bridge; packaged `imm-work`/`imm-executor`; package-wrapper, adapter, lifecycle-gate, and dedicated packaging contract tests.
- **compatibility**: The tools are additive. Existing OpenCode names, State Ledger schema v3, no-probe execution, rework, workflow profiles, and package CLI commands remain unchanged.
- **interruption recovery**: OpenCode forwards Step identity and Ledger revision; the TypeScript runtime retains all checkpoint, CAS, replay, and recovery authority.
- **rollback path**: Revert the additive tools, packaged prose, and focused tests. No migration or Ledger rewrite is needed.
- **verification strength**: U1 runtime regression suite plus exact adapter argv, typed schema tests, package-local separate-process calls, lifecycle authority gates, isolated packaged prose assertions, Plan validation, and whitespace diagnostics.
- **replan condition**: Replan only if OpenCode cannot carry the structured packet without a breaking API change, or if implementation requires altering U1 state semantics.
- **known external diagnostic**: The existing `keeps dist/BASELINE.md in sync with the source copies` case remains a repository health failure until a separate task owns all BASELINE copies. It must not be skipped or weakened globally.

## Steps

### Step 1

- Step ID: U1
- Result: The shipped TypeScript work-probe host contract is executable through OpenCode while preserving runtime validation plus downstream review authority.
- Scope: `plugins/immune-brain/.opencode-plugin/index.ts`; `plugins/immune-brain/.opencode-plugin/runtime.ts`; `plugins/immune-brain/dist/imm-work.md`; `plugins/immune-brain/dist/imm-executor.md`; `tests/baseline-packaging-contract.test.ts`; `tests/work-probe-packaging-contract.test.ts`; `tests/plugin-package-runtime.test.ts`; `tests/opencode-cli-adapter.test.ts`; `plugins/immune-brain/tests/opencode-runtime.test.ts`; `tests/imm-loop-completion-gate.test.ts`
- Verification: `bun test tests/work-probes-runtime.test.ts tests/runtime-state.test.ts tests/execution-evidence-runtime.test.ts tests/work-probe-packaging-contract.test.ts tests/plugin-package-runtime.test.ts tests/opencode-cli-adapter.test.ts plugins/immune-brain/tests/opencode-runtime.test.ts tests/imm-loop-completion-gate.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-08-09-003-fix-opencode-work-probe-contract-verification-plan.md --json && git diff --check`
- Verification type: automated plus diagnostics
- Agent Hint: imm-executor
- Test scenarios: Covers removal of the superseded-attempt assertion from the broad BASELINE suite; isolated TypeScript packaged contract checks; OpenCode tool registration and onboarding; exact `continue` argv for activation and dispatch flags; exact structured `record-probes` argv; required field and caller-supplied scope rejection; success, dispatch failure, timeout, and classified fallback packets; package-installed separate-process CLI calls; child evidence remaining advisory through execution, Strict QA, final review, Compounder, and finish gates.
- Discovery cache: `tests/baseline-packaging-contract.test.ts` (remove only the superseded-attempt work-probe test); `tests/work-probe-packaging-contract.test.ts` (new isolated package contract owner); `plugins/immune-brain/.opencode-plugin/index.ts` (tool schemas and onboarding); `plugins/immune-brain/.opencode-plugin/runtime.ts` (argv translation); `plugins/immune-brain/dist/imm-work.md` and `plugins/immune-brain/dist/imm-executor.md` (shipped contract); `tests/opencode-cli-adapter.test.ts`, `plugins/immune-brain/tests/opencode-runtime.test.ts`, `tests/plugin-package-runtime.test.ts`, and `tests/imm-loop-completion-gate.test.ts` (test-first RED evidence)
- Depends on: none
- failure_behavior: Reject malformed OpenCode inputs before dispatch; defer lifecycle identity, freshness, completeness, replay, and Scope decisions to the TypeScript runtime. Keep the known BASELINE drift visible as an external diagnostic without allowing it to alter feature closure.
- security_considerations: OpenCode remains translation-only; Plan-derived probe scope and identity are immutable; expected Ledger revision crosses unchanged; no provider calls or free-text compatibility path are added; child evidence cannot grant execution, QA, review, Plan mutation, or scope-expansion authority.

## Validation

- Validate without sync: `plugins/immune-brain/bin/imm-plan docs/plans/2026-08-09-003-fix-opencode-work-probe-contract-verification-plan.md --json`.
- Do not sync while `docs/plans/2026-08-09-002-fix-opencode-work-probe-contract-plan.md` remains current in `replanning`. Only a literal user may supersede it with complete observability.
- Required termination classification: `reason_code=boundary_error`, `stage=verification`, `invalidated_assumption=The full baseline-packaging test file was a clean executable verification surface for this Step`, `avoidable=yes`.
- After explicit user-confirmed supersede, sync this Plan and continue through `imm-loop`.
