# Iteration Plan

## Task

- Summary: Establish an opt-in successor-ready planning contract so Roadmap-backed Plans declare one coherent executable slice and one non-authoritative next Phase without changing runtime state.
- Origin: User-confirmed `imm-brainstorm` framing for splitting large initiatives into multiple linear Plans while leaving session lifecycle entirely under user control.
- Spec: `docs/specs/archive/2026-07-28-roadmap-plan-boundary-successor.spec.md`
- Research: The existing Roadmap/Executable Slice contract preserves deferred phases but does not require Plan-level boundary reasoning or static successor identity. `plan_core.ts` already parses arbitrary Task metadata and validates Steps, Brainstorm Trace, Spec design metadata, and Roadmap criteria. A representative 24-hour session used a three-Step Plan whose evidence covered 49 changed files; its audit foundation, read surface, and permission rollout crossed independent authority and review boundaries, and post-Plan review consumed more work than primary implementation. Planner ensemble agreement favored a static, opt-in Phase 1 and deferred State Ledger transitions. The strong advisory required explicit proof that declaration is not approval or activation.
- Decisions: D1 use semantic authority, risk, verification, promotion, review, and rollback boundaries instead of fixed file/token/session limits. D2 keep Step outcome discipline but promote independent boundaries into successor Plans. D3 introduce opt-in `roadmap-slice/v1` Task metadata so legacy Plans remain unchanged. D4 use stable Roadmap Phase IDs rather than future Plan paths for successor candidates. D5 treat successor metadata as non-authoritative static planning data. D6 make Phase 1 contract plus pure validation only. D7 defer State Ledger transitions, user approval persistence, workflow routing, and end-to-end migration to later Plans. D8 preserve user ownership of session continuation.
- Assumptions: Existing Task metadata remains a backwards-compatible extension point. `plugins/immune-brain/dist/imm-planner.md` is the detailed packaged Planner contract, while `docs/reference/planning-quality-gate.md` is canonical for its generated packaged mirror. Stable Phase IDs can use a conservative identifier syntax without introducing global Plan IDs. No open `BR-Q-*` item remains.
- Plan contract: roadmap-slice/v1
- Roadmap source: `docs/specs/archive/2026-07-28-roadmap-plan-boundary-successor.spec.md` Roadmap
- Current phase: P1
- Plan boundary: Static Planner, template, vocabulary, quality-gate, and pure `imm-plan` validation contract for bounded Roadmap slices and one declared successor candidate.
- Boundary rationale: The two Steps share one planning-authority outcome and one rollback boundary: authors first receive a canonical contract, then the pure validator makes that same contract durable. State Ledger, workflow routing, user approval persistence, and host behavior are separate authority and recovery boundaries deferred to successor Plans.
- Scope pressure: Elevated but bounded: packaged Planner guidance, one mirrored quality-gate doc, one Plan template, canonical vocabulary, pure parser validation, and focused tests; no State Ledger or workflow mutation.
- Execution scope: Phase P1 only: successor-ready planning contract.
- Deferred phases: P2 State Ledger transition contract; P3 workflow progression and handoff; P4 compatibility and end-to-end acceptance.
- Successor candidate: P2
- Successor preconditions: Phase P1 acceptance criteria pass; static metadata names and authority boundaries remain stable; no Phase P1 implementation changes `current_iteration.json` schema v2.
- Current-slice warning: This Plan does not implement successor Plan creation, user approval persistence, active Plan switching, workflow routing, session management, or the full Roadmap.
- Brainstorm manifest: BR-REQ-001; BR-REQ-002; BR-REQ-003; BR-REQ-004; BR-REQ-005; BR-DEC-001; BR-DEC-002; BR-DEC-003; BR-OUT-001; BR-OUT-002; BR-OUT-003; BR-DEFER-001

## Output Language

- Human-readable prose: English
- Preserved literals: file paths, commands, schema fields, enum values, JSON keys, Skill names, and `CONTEXT.md` canonical terms such as `Roadmap`, `Phase`, `Plan`, `Step`, `Spec`, `State Ledger`, `Plan boundary`, `Successor candidate`, and `Scope pressure`

## Brainstorm Manifest

- BR-REQ-001: Large initiatives use a Roadmap for full scope and multiple executable Plans for bounded slices.
- BR-REQ-002: Plan boundaries follow business outcome, authority, risk, verification, review, and rollback semantics.
- BR-REQ-003: Plans preserve a durable, recoverable, auditable successor handoff.
- BR-REQ-004: Exactly one Plan is active at a time.
- BR-REQ-005: Planner creates and validates a successor Plan, and the user explicitly approves activation.
- BR-DEC-001: The first version supports linear Plan progression only.
- BR-DEC-002: Session creation, continuation, and closure remain entirely user-controlled.
- BR-DEC-003: File count, tokens, compactions, and follow-up rounds are diagnostic evidence, not workflow gates.
- BR-OUT-001: Do not automatically create or switch sessions.
- BR-OUT-002: Do not force Step or Plan stops from context-budget signals.
- BR-OUT-003: Do not introduce SQLite, a Plan queue, or a generic orchestrator.
- BR-DEFER-001: Branching, merging, parallel Plans, and automatic scheduling are deferred.

## Brainstorm Trace

| Item | Status | Target | Reason |
| --- | --- | --- | --- |
| BR-REQ-001 | partially_covered | U1, U2 | Phase P1 defines and validates bounded Roadmap slice metadata; runtime multi-Plan progression is deferred to P2-P4. |
| BR-REQ-002 | covered_by_step | U1 | Planner, quality gate, vocabulary, and template encode semantic Plan boundary review. |
| BR-REQ-003 | partially_covered | U1, U2 | Phase P1 defines a durable static successor declaration; append-only runtime handoff is deferred to P2-P3. |
| BR-REQ-004 | captured_as_decision | D6 | Phase P1 preserves current single-Plan runtime behavior; enforcement across transitions is deferred to P2. |
| BR-REQ-005 | partially_covered | U2 | Phase P1 validates declaration shape only; Plan creation, persisted user approval, and activation are deferred to P2-P3. |
| BR-DEC-001 | captured_as_decision | D4 | The contract permits zero or one direct successor Phase and excludes DAG semantics. |
| BR-DEC-002 | captured_as_decision | D8 | Session lifecycle is explicitly outside Plan metadata and runtime gates. |
| BR-DEC-003 | captured_as_decision | D1 | Scope-pressure signals require Planner reasoning but never become fixed workflow limits. |
| BR-OUT-001 | out_of_scope | Scope | No session creation or switching behavior is implemented. |
| BR-OUT-002 | out_of_scope | Scope | No context-budget stop policy is added. |
| BR-OUT-003 | out_of_scope | Scope | Existing filesystem-as-brain authority remains unchanged. |
| BR-DEFER-001 | deferred | Roadmap P4 | DAGs, parallel active Plans, and automatic scheduling remain explicit future work with no current promotion criteria. |

## Coverage Matrix

| Roadmap requirement | Phase P1 coverage | Deferred continuation |
| --- | --- | --- |
| R1 Plan-level boundary discipline | U1 fully covers authoring contract | P3 consumes boundary classification during workflow routing |
| R2 Opt-in static Plan contract | U1 documents; U2 validates | P2 consumes stable metadata during transition design |
| R3 Linear successor declaration | U1 documents; U2 validates local shape | P2/P4 add persisted transition and cross-file consistency |
| R4 Compatibility | U2 proves legacy Plans remain valid | P2/P4 cover State Ledger and cross-host compatibility |
| R5 Authority separation | U1 documents; U2 proves validation is pure | P2/P3 implement approval and activation boundaries |
| R6 User-owned session lifecycle | U1 fully documents non-goal | P3/P4 prove host behavior remains session-neutral |
| R7 Successor handoff | U1 defines static input only | P2/P3 implement append-only authority and HANDOFF projection |
| R8 Failure and correction semantics | U1 defines routing principle | P3/P4 implement and test role routing |

## Devil's Advocate Audit

### 1. Rollback Resilience

- U1 changes only planning contracts, a template, canonical vocabulary, one generated mirror, and focused contract tests. These can be reverted as one authoring-contract unit without State Ledger migration.
- U2 is an opt-in pure parser/validator extension. Reverting `plan_core.ts` and its focused tests restores legacy behavior; Plans without `Plan contract: roadmap-slice/v1` never change behavior.
- If execution discovers that Task metadata cannot safely represent the contract, stop and return to Planner. Do not widen U2 into State Ledger or workflow changes.

### 2. Verification Vanity

- U1 verification must assert specific authority language, required metadata, session neutrality, semantic sizing, generated quality-gate parity, and the explicit absence of automatic activation claims. Text existence alone is insufficient.
- U2 fixtures must cover valid, missing, malformed, terminal, self-successor, missing-preconditions, and legacy Plans. A CLI purity fixture must prove `imm-plan --json` does not create or mutate `.imm/memory/current_iteration.json`.
- Phase P1 must not claim the multi-Plan runtime works. Its verifiable result is limited to static expression, validation, compatibility, and no side effects.

### 3. Spec Dilution Detection

- The current Plan intentionally covers only the planning contract. State Ledger transitions, explicit approval persistence, workflow routing, and end-to-end progression are mapped to P2-P4 rather than silently omitted.
- User-controlled session lifecycle is a binding invariant in the Spec, U1 contract tests, and current-slice non-goals.
- Fixed thresholds and automatic session behavior are explicitly rejected, while scope-pressure evidence remains available to Planner reasoning.

## Planning Quality Gate

- contract surface: `docs/specs/archive/2026-07-28-roadmap-plan-boundary-successor.spec.md`, `plugins/immune-brain/dist/imm-planner.md`, `docs/reference/planning-quality-gate.md`, its generated packaged mirror, `CONTEXT.md`, `.imm/templates/iteration-plan-template.md`, `plugins/immune-brain/runtime/plan_core.ts`, and focused tests.
- compatibility: `roadmap-slice/v1` is opt-in. Existing Plans, Specs, Plan signatures, State Ledger schema v2, HANDOFF files, and closed evidence require no migration or rewrite.
- interruption recovery: U1 closes the human and template contract independently. U2 starts only after U1; if interrupted, legacy Plan validation remains available and no runtime state has changed.
- rollback path: Revert U1 contract files as one unit or U2 parser/tests as one unit. No data migration or ledger repair is required.
- verification strength: Focused contract tests assert wording and generated parity; parser fixtures assert deterministic errors and backwards compatibility; a temp-workspace CLI test proves validate-only purity; this Plan must pass `imm-plan --json` before sync.
- design-depth classification: High risk because this Roadmap eventually changes persisted workflow state, activation authority, recovery, and cross-role behavior. Phase P1 deliberately narrows implementation to static contract and pure validation.
- Technical Design baseline: The referenced Spec is the sole authority for metadata meaning, state separation, compatibility, and deferred runtime behavior.
- Mermaid intent: The Spec diagram distinguishes declaration, Plan validation, user approval, activation, closure, and Roadmap completion.
- Design Conformance: QA must compare U1/U2 evidence against Spec R1-R6 and Technical Design 5.3. Any attempt to write State Ledger or add activation behavior is structural scope drift and requires replan.
- Brainstorm traceability: Every confirmed `BR-*` item is mapped above with explicit partial/deferred reasons.
- roadmap information preservation: P2-P4 retain goals, acceptance criteria, promotion criteria, candidate next Plans, deferred decisions, and non-goals in the Spec.
- acceptance scope discipline: Current verification proves only Phase P1 static contract behavior; no runtime transition acceptance is claimed.

## Steps

### Step 1

- Step ID: U1
- Result: Roadmap-backed Plans expose a bounded successor-ready authoring contract
- Scope: `plugins/immune-brain/dist/imm-planner.md`; `docs/reference/planning-quality-gate.md`; `plugins/immune-brain/dist/docs/reference/planning-quality-gate.md` (generated mirror); `CONTEXT.md`; `.imm/templates/iteration-plan-template.md`; new focused contract test under `tests/`.
- Discovery cache: plugins/immune-brain/dist/imm-planner.md (detailed Planner authority and Roadmap-backed planning rules); docs/reference/planning-quality-gate.md (elevated-risk contract checklist and generated mirror source); CONTEXT.md (canonical Plan/Roadmap/Phase/State Ledger vocabulary); .imm/templates/iteration-plan-template.md (Plan authoring format); scripts/sync-dist-docs.ts (generated quality-gate mirror); docs/plans/2026-06-03-001-feat-roadmap-executable-slice-contract-plan.md (prior contract-first precedent)
- Verification: `bun test tests/roadmap-plan-boundary-contract.test.ts tests/dist-docs-sync-contract.test.ts && bun scripts/sync-dist-docs.ts --check && git diff --check`
- Verification type: automated
- Test scenarios: Covers Plan granularity distinct from Step granularity; Covers semantic authority/risk/verification/rollback boundary rationale; Covers scope-pressure signals as advisory only; Covers zero-or-one non-authoritative successor declaration; Covers session lifecycle remains user-controlled; Covers State Ledger and automatic activation remain deferred; Covers canonical/generated quality-gate parity.
- failure_behavior: If detailed Planner guidance, template fields, and quality-gate terminology cannot converge on one contract without duplicating schema authority, keep the Spec and Planner as semantic authority, reduce CONTEXT.md to stable definitions, and return to Planner before changing parser behavior.
- security_considerations: Successor handoff guidance must not preserve secrets, credentials, raw private payloads, or sensitive session transcripts. Static metadata cannot imply authorization or approval.
- Depends on: none

### Step 2

- Step ID: U2
- Result: imm-plan validates roadmap-slice/v1 metadata without changing legacy Plan behavior
- Scope: `plugins/immune-brain/runtime/plan_core.ts`; `tests/plan-validation.test.ts`.
- Discovery cache: plugins/immune-brain/runtime/plan_core.ts (Task metadata parsing, normalization, Plan signature, and validation warnings/errors); tests/plan-validation.test.ts (valid, malformed, legacy, CLI JSON, and Spec design fixtures); plugins/immune-brain/runtime/immune_brain_runtime.ts#runPlanCommand (validate-only versus explicit --sync boundary, read-only unless a discovered contract mismatch requires replan)
- Verification: `bun test tests/plan-validation.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-28-002-feat-roadmap-plan-boundary-successor-phase1-plan.md --json && git diff --check`
- Verification type: automated
- Execution note: test-first
- Test scenarios: Covers complete `roadmap-slice/v1` metadata parses and survives normalized JSON; Covers missing required opt-in field; Covers malformed current Phase ID; Covers terminal successor `none`; Covers successor equal to current Phase; Covers non-terminal successor missing preconditions; Covers unknown Plan contract version; Covers legacy Plan without Plan contract remains valid; Covers free-text next/follow-up/handoff is not interpreted; Covers validate-only CLI creates no State Ledger and changes no runtime state.
- failure_behavior: If validation requires resolving Roadmap membership, successor files, approval, cycles, or State Ledger state, stop at local static shape validation and return to Planner; those semantics belong to P2 or P4.
- security_considerations: Parser input is untrusted Markdown. Keep validation pure, bounded, path-neutral, and free of filesystem traversal beyond the existing referenced Spec behavior; never treat metadata as authorization.
- Depends on: 1

## Validation

- Plan validator: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-28-002-feat-roadmap-plan-boundary-successor-phase1-plan.md --json`
- Contract verification: `bun test tests/roadmap-plan-boundary-contract.test.ts tests/dist-docs-sync-contract.test.ts`
- Parser verification: `bun test tests/plan-validation.test.ts`
- Generated-doc verification: `bun scripts/sync-dist-docs.ts --check`
- Repository hygiene: `git diff --check`
- Full planned verification: `bun test tests/roadmap-plan-boundary-contract.test.ts tests/plan-validation.test.ts tests/dist-docs-sync-contract.test.ts && bun scripts/sync-dist-docs.ts --check && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-28-002-feat-roadmap-plan-boundary-successor-phase1-plan.md --json && git diff --check`

## Roadmap Continuation

- Preserved deferred content: P2 owns append-only State Ledger transition identity, explicit user approval persistence, atomic switch, stale-writer rejection, idempotency, and closed-evidence preservation. P3 owns Planner/Work/Loop/QA/review routing plus HANDOFF projection and session-neutral continuation. P4 owns legacy compatibility, cross-host behavior, recovery scenarios, and two-Plan end-to-end acceptance.
- Open questions: None block P1. P2 must decide approval persistence shape, Plan run identity, atomic transition command, and schema compatibility through its own high-risk planning gate.
- Promotion criteria: U1 and U2 close with QA and required review; Phase P1 acceptance criteria pass; metadata names remain stable; no implementation changed `current_iteration.json` schema v2 or runtime activation behavior.
- Candidate next Plan: Phase P2 State Ledger transition contract, to be created and validated by Planner only after explicit user direction.
- Explicit non-goals: State Ledger successor fields, user approval persistence, active Plan switching, workflow routing, HANDOFF writes, session automation, historical migration, DAGs, parallel Plans, and automatic scheduling.

## Notes

- This is not the full Roadmap implementation Plan.
- A successor candidate is a static Roadmap Phase reference, not a Plan file, approval, queue entry, or activation instruction.
- The user decides whether later work continues in this session or another session.
