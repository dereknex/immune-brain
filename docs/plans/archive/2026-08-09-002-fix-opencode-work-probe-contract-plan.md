# Iteration Plan

## Task

- Summary: Complete the shipped TypeScript work-probe contract by adding the omitted OpenCode tool owners and synchronizing package regression coverage.
- Origin: Strict QA returned `replan` for U2 of `docs/plans/2026-08-09-001-fix-typescript-work-probe-lifecycle-plan.md` because its Result required OpenCode argument translation while its activated immutable Scope omitted the actual tool schema and argv owners.
- Spec: `docs/specs/2026-08-09-opencode-work-probe-contract-repair.spec.md`
- Research: U1 runtime behavior is implemented and independently QA-passed. Pre-edit owner verification found that `plugins/immune-brain/.opencode-plugin/index.ts` registers OpenCode tools and schemas, while `plugins/immune-brain/.opencode-plugin/runtime.ts` maps those tools to TypeScript CLI argv. Neither owner was in the prior U2 Scope; tests import the runtime bridge directly, so docs/tests alone cannot satisfy the accepted host contract. Planner activation returned `cost_scope_mismatch`, and no additional ensemble was dispatched because QA evidence made the corrective boundary concrete.
- Decisions: D1 create a successor Plan and Spec rather than edit the activated predecessor. D2 keep the existing TypeScript CLI as the sole lifecycle validator and Ledger mutation authority. D3 add two OpenCode tools only: `imm_work_continue` and `imm_work_record_probes`. D4 serialize the complete probe result packet through `--results-json` without host-side evidence normalization. D5 synchronize packaged `imm-work` and `imm-executor` prose with the real TypeScript module and CLI names. D6 preserve all U1 runtime semantics and exclude generic dispatch, schema changes, and unrelated adapter refactors.
- Assumptions: The U1 runtime implementation and QA evidence remain valid; the successor executes in the same workspace so final cumulative review can inspect both lifecycle and host-contract changes; additive OpenCode tools are backward compatible; the existing package and loop test harnesses can prove the accepted boundary without provider calls.
- Workflow profile: strict
- Compounder: required
- Scope Mode: New Slice
- Plan boundary: Repair only the host/package contract omitted from the predecessor U2 while preserving the independently closed U1 runtime implementation.
- Boundary rationale: The OpenCode schema, argv bridge, packaged Skill prose, and their tests form one host interface outcome with shared acceptance and rollback. Runtime lifecycle redesign, additional hosts, and generic dispatch remain separate concerns.
- Scope pressure: One cohesive cross-host contract Step spans two OpenCode owners, two packaged Skill documents, and five focused test surfaces. The file count reflects one interface boundary rather than multiple independently closable outcomes.

## Output Language

- Language: English
- Reason: Repository planning artifacts default to English; user-facing progress remains Chinese. File paths, commands, enum values, JSON fields, and code identifiers remain literal.

## Devil's Advocate Audit

1. **Rollback Resilience**: Keep the OpenCode additions and packaged prose as one reversible unit. No persisted schema changes are allowed; removing the additive tools leaves the already-implemented TypeScript CLI directly callable and schema v3 readable.
2. **Verification Vanity**: String assertions alone cannot close this Step. Exact argv tests, package-installed CLI calls, malformed structured input rejection, mixed outcome payloads, and full-loop authority checks must all pass without provider calls.
3. **Spec Dilution Detection**: The Step fails if it only edits docs/tests, exposes `continue` without structured `record-probes`, duplicates runtime validation in OpenCode, restores retired Python names, or implies that child evidence can close execution or review gates.

## Planning Quality Gate

- **contract surface**: OpenCode tool schema and argv bridge; TypeScript `continue`/`record-probes` CLI already delivered by U1; packaged `imm-work`/`imm-executor`; package, adapter, and loop tests.
- **compatibility**: Additive OpenCode tools preserve existing tool names and inputs. Schema v3, no-probe behavior, rework, Standard/Strict profiles, and current package CLI commands remain unchanged.
- **interruption recovery**: OpenCode passes Step identity and `expected_ledger_revision` unchanged; the TypeScript runtime owns CAS, replay, and recovery. The adapter stores no shadow state.
- **rollback path**: Revert the two OpenCode tool mappings, synchronized Skill prose, and tests together. No migration or Ledger rewrite is required.
- **verification strength**: Exact argv/schema assertions, package-local process tests, packaged Skill contract checks, lifecycle authority regression tests, the U1 suite, Plan validation, and whitespace checks.
- **replan condition**: Replan if OpenCode cannot carry the structured payload without a breaking public plugin API change, or if satisfying the package contract requires changing U1 state semantics.
- **advisory interpretation**: Independent QA established a boundary error, not an execution defect. The successor expands Scope only to the proven implementation owners and keeps the accepted lifecycle unchanged.

## Steps

### Step 1

- Step ID: U1
- Result: The shipped TypeScript work-probe host contract is executable through OpenCode while preserving runtime validation plus downstream review authority.
- Scope: `plugins/immune-brain/.opencode-plugin/index.ts`; `plugins/immune-brain/.opencode-plugin/runtime.ts`; `plugins/immune-brain/dist/imm-work.md`; `plugins/immune-brain/dist/imm-executor.md`; `tests/baseline-packaging-contract.test.ts`; `tests/plugin-package-runtime.test.ts`; `tests/opencode-cli-adapter.test.ts`; `plugins/immune-brain/tests/opencode-runtime.test.ts`; `tests/imm-loop-completion-gate.test.ts`
- Verification: `bun test tests/work-probes-runtime.test.ts tests/runtime-state.test.ts tests/execution-evidence-runtime.test.ts tests/baseline-packaging-contract.test.ts tests/plugin-package-runtime.test.ts tests/opencode-cli-adapter.test.ts plugins/immune-brain/tests/opencode-runtime.test.ts tests/imm-loop-completion-gate.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-08-09-002-fix-opencode-work-probe-contract-plan.md --json && git diff --check`
- Verification type: automated plus diagnostics
- Agent Hint: imm-executor
- Test scenarios: Covers OpenCode tool registration and onboarding; exact `continue` argv for activation and dispatch flags; exact structured `record-probes` argv; required field rejection; success, dispatch failure, timeout, and classified fallback packets; package-installed separate-process CLI calls; TypeScript module and command names in shipped prose; absence of retired Python APIs and provider calls; child evidence remaining advisory through execution, Strict QA, final review, Compounder, and finish gates.
- Discovery cache: `plugins/immune-brain/.opencode-plugin/index.ts` (tool schemas and session onboarding); `plugins/immune-brain/.opencode-plugin/runtime.ts` (tool-to-CLI argv owner); `plugins/immune-brain/dist/imm-work.md` (probe coordinator contract); `plugins/immune-brain/dist/imm-executor.md` (child-evidence consumer contract); `tests/opencode-cli-adapter.test.ts` and `plugins/immune-brain/tests/opencode-runtime.test.ts` (adapter contract); `tests/plugin-package-runtime.test.ts` (package-local CLI boundary)
- Depends on: none
- failure_behavior: Reject missing structured fields before dispatch and defer all Step identity, freshness, completeness, scope, and replay judgments to the TypeScript runtime. Unsupported host dispatch uses the runtime's classified fallback packet through the same ingestion command.
- security_considerations: Keep OpenCode translation-only, preserve immutable Plan-derived scope and probe identity, pass Ledger revision unchanged, introduce no free-text compatibility path, make no provider calls, and never grant child evidence execution, QA, review, Plan mutation, or scope-expansion authority.

## Validation

- Validate without sync: `plugins/immune-brain/bin/imm-plan docs/plans/2026-08-09-002-fix-opencode-work-probe-contract-plan.md --json`.
- Do not sync while `docs/plans/2026-08-09-001-fix-typescript-work-probe-lifecycle-plan.md` remains current in `replanning`. Only a literal user may supersede it with the required observability fields.
- Required termination classification: `reason_code=boundary_error`, `stage=execution`, `invalidated_assumption=U2 Scope covered the OpenCode implementation owners`, `avoidable=yes`.
- After explicit user-confirmed supersede, sync this Plan and continue through `imm-loop`.
