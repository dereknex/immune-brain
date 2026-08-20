# Iteration Plan

## Task

- Summary: Add explicit standard and strict managed workflow profiles so routine Plans avoid per-Step QA and finish after one final review while high-risk and legacy Plans retain the full lifecycle.
- Origin: The user reported that the current workflow materially slows development, approved the risk-tiered execution redesign, and explicitly rejected batch approval.
- Spec: `docs/specs/archive/2026-08-05-risk-tiered-workflow-execution.spec.md`
- Research: Direct Path already exists outside Plan state; fast-track only compresses interactions and still requires QA; Plan Task fields are already included in immutable signatures and snapshots; Step evidence, scope, and workspace freshness are validated before QA; final review gates are changed-files-signature-bound; finish is currently a separate state mutation; follow-up rounds are append-only but unbounded in runtime.
- Decisions: D1 keep Direct Path outside the Ledger. D2 add explicit `Workflow profile: standard|strict` and default omissions to strict. D3 let standard passing execution evidence produce a runtime-owned Step pass while retaining all evidence, scope, signature, and freshness checks. D4 retain one final independent review for standard Plans. D5 atomically finish an eligible standard Plan with the final review pass. D6 require Compounder for strict Plans and deterministic standard triggers only. D7 cap standard same-boundary follow-ups at two. D8 preserve literal-user successor, termination, and cross-Plan authority. D9 make no Ledger schema change.
- Assumptions: Existing Task fields remain signature-bound; Direct Path classification remains host-owned; `Compounder: optional` is acceptable for routine work because reusable-learning triggers are deterministic and final review remains mandatory.
- Workflow profile: strict
- Compounder: required
- Scope Mode: New Slice
- Plan boundary: Risk-tiered managed execution semantics across Plan validation, runtime Step closure, final review closure, follow-up budget, and synchronized host contracts.
- Boundary rationale: Profile validation, runtime routing, closure behavior, and host guidance must ship together or different hosts could apply different quality gates to the same immutable Plan.
- Scope pressure: High-risk workflow state-machine change across parser, runtime commands, State Ledger helpers, focused tests, and generated skill documentation.

## Output Language

- Language: English
- Reason: Repository planning artifacts default to English; user-facing progress remains Chinese.

## Steps

### Step 1

- Step ID: U1
- Result: Validated Plans expose immutable workflow profiles whose omitted legacy value preserves strict behavior while invalid standard risk or verification combinations fail validation.
- Scope: `plugins/immune-brain/runtime/plan_core.ts`; `.imm/templates/iteration-plan-template.md`; `tests/plan-validation.test.ts`; `tests/fast-track-detection.test.ts`
- Verification: `bun test tests/plan-validation.test.ts tests/fast-track-detection.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-08-05-001-refactor-risk-tiered-workflow-execution-plan.md --json && git diff --check`
- Agent Hint: imm-executor
- Test scenarios: Covers R1 legacy strict default; Covers R1 standard and strict enum validation; Covers R1 direct rejection; Covers R1 standard automated verification requirement; Covers R1 High-risk Spec rejection
- Depends on: none

### Step 2

- Step ID: U2
- Result: Standard Plan lifecycle becomes a profile-bound closure path whose passing evidence reaches one final review before safe finish or bounded escalation.
- Scope: `plugins/immune-brain/runtime/commands/work.ts`; `plugins/immune-brain/runtime/commands/review.ts`; `plugins/immune-brain/runtime/commands/finish.ts`; `plugins/immune-brain/runtime/commands/autowork.ts`; `plugins/immune-brain/runtime/immune_brain_runtime.ts`; `plugins/immune-brain/runtime/state_ledger.ts`; `tests/imm-autowork-continuation-runtime.test.ts`; `tests/imm-loop-review-lifecycle-state.test.ts`; `tests/imm-follow-up-runtime.test.ts`; `tests/finish-dehydrate-runtime.test.ts`
- Verification: `bun test tests/imm-autowork-continuation-runtime.test.ts tests/imm-loop-review-lifecycle-state.test.ts tests/imm-follow-up-runtime.test.ts tests/finish-dehydrate-runtime.test.ts && git diff --check`
- Agent Hint: imm-executor
- Test scenarios: Covers R2 standard auto-close; Covers R2 strict QA preservation; Covers R3 final review preservation; Covers R4 atomic final pass and finish; Covers R5 Compounder triggers; Covers R6 third follow-up rejection and no mutation
- Depends on: 1

### Step 3

- Step ID: U3
- Result: Workflow guidance consistently routes each risk profile while compatibility tests preserve existing strict lifecycle plus successor authority.
- Scope: `plugins/immune-brain/skills/imm-loop/SKILL.md`; `plugins/immune-brain/skills/imm-work/SKILL.md`; `plugins/immune-brain/skills/imm-executor/SKILL.md`; `plugins/immune-brain/skills/imm-qa/SKILL.md`; `plugins/immune-brain/skills/imm-code-review/SKILL.md`; `plugins/immune-brain/skills/imm-compounder/SKILL.md`; `plugins/immune-brain/dist/imm-loop.md`; `plugins/immune-brain/dist/imm-work.md`; `plugins/immune-brain/dist/imm-executor.md`; `plugins/immune-brain/dist/imm-qa.md`; `plugins/immune-brain/dist/imm-code-review.md`; `plugins/immune-brain/dist/imm-compounder.md`; `plugins/immune-brain/BASELINE.md`; `plugins/immune-brain/USER_GUIDE.md`; `docs/user_manual.md`; `tests/baseline-packaging-contract.test.ts`; `tests/imm-loop-review-orchestration-contract.test.ts`; `tests/roadmap-plan-progression-contract.test.ts`; `tests/dist-docs-sync-contract.test.ts`
- Verification: `bun scripts/sync-dist-docs.ts && bun test tests/baseline-packaging-contract.test.ts tests/imm-loop-review-orchestration-contract.test.ts tests/roadmap-plan-progression-contract.test.ts tests/dist-docs-sync-contract.test.ts tests/roadmap-plan-transition-runtime.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-08-05-001-refactor-risk-tiered-workflow-execution-plan.md --json && git diff --check`
- Agent Hint: imm-executor
- Test scenarios: Covers R7 source/dist consistency; Covers strict lifecycle compatibility; Covers Direct Path remains stateless; Covers successor authority remains literal-user-only
- Depends on: 2

## Notes

- User-visible operating model: Direct Path for trivial low-risk work, Standard for routine managed work, Strict for high-risk or legacy work.
- Direct Path is deliberately absent from Plan validation because creating a Plan would defeat its purpose.
- Standard auto-finish does not emit developer insights; explicit record-aware `imm-finish` remains available to strict and Compounder-required closures.
- Rollback: remove profile-specific runtime branches and validation while leaving omitted profiles on strict behavior; no persisted schema migration is needed.
