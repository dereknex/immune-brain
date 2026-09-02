# Code Quality Guard Contract

**Status**: Candidate
**Task**: `2026-09-02-001-code-quality-guard`
**Planning entry**: Direct `imm-planner` after the user reviewed and refined the proposed Clean Code Guard integration; no Brainstorm artifact.
**Output Language**: English for persisted planning artifacts; user-facing replies follow the repository Output Language Policy.
**Design risk**: Medium - this changes packaged Executor, repair, and Review behavior across internal and standalone role contracts. It does not change runtime authority, schemas, dispatch, or Kernel state, but an over-broad guard could create false-positive rework while an under-specified guard would not prevent known LLM failure modes.
**Diagram decision**: not_required
**Diagram reason**: The change has one static publication path (`canonical reference and role prompts -> generated packaged mirrors -> runtime/public Skill consumption`) and no new state transition, temporal protocol, or data transformation that a diagram would clarify beyond the component contract below.

## 1. Problem

Immune-Brain already requires simplicity, surgical scope, evidence, and role-separated assurance. Its internal mutation and code-review prompts do not explicitly name several high-impact LLM failure modes: fabricated success, swallowed errors, weakened tests, missing trust-boundary validation, invented dependency APIs, speculative production paths, and unauthorized behavior changes.

The omission is a workflow-contract gap, not evidence that the current runtime implementation contains those defects. Importing a complete generic Clean Code or SOLID checklist would be counterproductive: hard line-count, parameter-count, naming blacklist, and abstraction rules can create style-only rework and conflict with KISS/YAGNI. Immune-Brain needs a project-native quality contract that distinguishes correctness invariants from contextual maintainability heuristics.

## 2. Result

Immune-Brain ships one canonical Code Quality Guard reference and applies its high-signal invariants at the roles that can prevent or independently detect implementation defects:

- internal `executor` performs a bounded delivery self-check;
- internal `pr-fix` cannot clear blockers by hiding errors, weakening tests, or widening behavior;
- internal `test-fixer` preserves test intent and returns production defects to the Parent;
- internal `code-review` treats concrete correctness, regression, security, and material maintenance risks as findings while rejecting style-only rework; and
- standalone `imm-pr-fix` loads the packaged reference while preserving its host-native authority boundary.

QA remains evidence-only. Planner, Kernel schemas, assurance obligations, Review verdict shape, public Skill registry, and role dispatch remain unchanged.

## 3. Confirmed Decisions

The preceding user review established these decisions:

1. Create one canonical reference at `docs/reference/code-quality-guard.md` with a generated packaged mirror.
2. Divide the contract into `Correctness Invariants`, `Maintainability Heuristics`, and `Review Decision Policy`.
3. Treat fabricated success, swallowed unexpected errors, weakened tests, missing trust-boundary validation, invented dependency APIs, unauthorized behavior changes, and speculative production paths as high-signal defects.
4. Do not adopt universal function-length, parameter-count, nesting, complexity, boolean-parameter, or identifier blacklist gates.
5. Do not make SOLID patterns mandatory before demonstrated complexity; abstraction remains evidence-driven under KISS/YAGNI.
6. Keep runtime-critical rules concise and explicit in the applicable internal role prompts. Do not expand `role_prompt_bridge.ts` to inject the full reference into every delegation.
7. Do not load the guard into `qa`; QA continues to consume acceptance evidence and Design Conformance only.
8. Do not change Kernel state, attestation schemas, Review verdict schemas, risk routing, or public Skill discovery.
9. Update current README and user documentation as part of the accepted result.
10. Use focused contract tests first. A paid/model-dependent behavior benchmark is deferred until observed false positives or misses justify it.

## 4. Technical Design

### 4.1 Design views

- **Architecture layers: selected.** The canonical reference owns detailed policy; internal role prompts own concise executable instructions; generated packaged mirrors are the shipped bytes; focused tests own drift detection. Dependencies flow from source contracts to packaged contracts, never back from generated files.
- **Component/interface view: selected.** `scripts/dist-sync-manifest.ts` declares the new mirror; `sync-dist-docs.ts` generates it and role-prompt mirrors; `role_prompt_bridge.ts` continues loading packaged role prompts unchanged; the standalone `imm-pr-fix` packaged contract explicitly loads its packaged quality reference.
- **Data-flow view: omitted.** No runtime data structure, validation pipeline, or persisted payload changes. Existing prompt bytes and digests continue through the same bridge.
- **State-transition view: omitted.** TaskRecord lifecycle, artifact state, findings, QA, Review, and settlement transitions are unchanged.
- **Temporal-sequence view: omitted.** Existing Planner, Enrollment, Executor, QA, Review, and repair ordering is unchanged.

### 4.2 Canonical quality contract

`docs/reference/code-quality-guard.md` is the single detailed policy source. Its packaged mirror is byte-identical and declared as a `mirror` entry.

#### Correctness Invariants

The contract must define:

- **Real implementation**: no production mock, fixture, hard-coded success, placeholder completion, disabled assertion, or weakened test used to manufacture success.
- **Error semantics**: catch only errors that can be recovered, translated, or enriched; do not convert unknown failures into `null`, empty output, or success; preserve the cause when translating.
- **Trust boundaries**: validate user, file, network, deserialized, and cross-process data at the boundary; do not add speculative internal guards that mask a violated invariant.
- **Dependency and API authenticity**: verify new imports and APIs against the repository's installed dependency or standard-library surface; do not add a dependency for small non-specialist logic already served locally or natively.
- **Behavior integrity**: preserve observable behavior during refactoring unless the accepted task authorizes a change; do not mix unrelated fixes or cleanup into the task.
- **Executable relevance**: no current-goal-free config, switch, extension point, dead branch, unused export, commented-out implementation, or duplicated domain rule.

#### Maintainability Heuristics

Naming, function responsibility, nesting, parameter modeling, comments, duplication, and abstraction are contextual investigation signals. None is a finding solely because it crosses a universal numerical threshold or uses a particular generic identifier. A finding requires a concrete affected path and a defensible correctness, regression, security, or material maintenance risk.

#### Review Decision Policy

- `blocking` findings identify concrete correctness, security, error-state, API authenticity, or test-integrity defects.
- `advisory` findings are permitted only when the current change creates a concrete, task-local material maintenance risk worth immediate rework.
- Pure formatting, naming preference, line count, parameter count, design taste, or hypothetical future extensibility produces no finding.
- Because a passing Review carries no findings, low-value suggestions must not be converted into `rework` merely to preserve them.
- Findings identify the affected path and risk; Review does not generate patches or take Executor authority.

### 4.3 Internal role contracts

The canonical internal prompts remain under `plugins/immune-brain/runtime/prompts/`; generated packaged bytes remain under `plugins/immune-brain/dist/role-prompts/`.

- `executor.md` adds a concise pre-handoff implementation integrity check covering the six correctness invariants. It fixes in-scope defects before Verification and reports scope expansion rather than hiding an incomplete result.
- `pr-fix.md` applies the same integrity boundary to blocker repair: no error suppression, test weakening, fake success, or unrelated behavior change to make CI/review appear resolved.
- `test-fixer.md` prohibits deleting or loosening assertions, replacing target behavior with a mock, or changing test intent solely to pass. A production defect is returned to the Parent.
- `code-review.md` applies the correctness invariants and Review Decision Policy to the immutable revision. It reports only evidence-backed task-local risks, keeps style-only concerns out of `rework`, and never emits a patch.
- `qa.md`, `ui-review.md`, advisory roles, and `compounder.md` do not receive Code Quality Guard responsibilities.

The detailed reference is not dynamically injected by `role_prompt_bridge.ts`. Internal prompts must contain enough normative text to execute their role without resolving a repository-relative reference that may not exist in a consumer workspace. Focused tests keep those concise instructions aligned with the canonical policy.

### 4.4 Standalone `imm-pr-fix`

`plugins/immune-brain/dist/imm-pr-fix.md` remains the self-owned packaged contract loaded by `skills/imm-pr-fix/SKILL.md`. It explicitly loads `docs/reference/code-quality-guard.md` relative to the packaged contract and applies the repair-relevant sections. This adds no public Skill, role, dispatcher, or Managed authority.

The standalone Skill and internal `pr-fix` share integrity semantics but retain different authority boundaries: standalone repair is host-native against one PR; internal repair is delegated by Loop within the active task boundary.

### 4.5 Documentation publication

Current guidance that describes execution and Review quality is updated consistently:

- `plugins/immune-brain/README.md` documents the shipped quality contract, applicable roles, and QA exclusion.
- `plugins/immune-brain/USER_GUIDE.md` explains observable behavior for Managed implementation/review and standalone PR repair without exposing internal prompt mechanics as a user action.
- `docs/user_manual.md` records which internal roles apply the guard and that style-only preferences do not force rework.
- `docs/reference/immune-brain-skills-guide.md` records the source/package locations and role boundaries for maintainers.

The generated README role-map block is not manually edited. `sync-dist-docs.ts` may regenerate it, and tests ensure the surrounding authored prose remains intact.

### 4.6 Compatibility, interruption, and rollback

This is an additive prompt and documentation contract. Existing TaskIntents, TaskRecords, review manifests, verdicts, public Skills, package exports, and user workflows require no migration or compatibility layer.

Partial implementation is detectable: source/package mirror tests and the sync checker fail when the canonical reference, manifest declaration, internal prompts, packaged prompts, README, or current docs are incomplete. Runtime behavior remains on the previous prompt bytes until a coherent package is published.

Rollback is one coherent Git revert of the reference, prompt, documentation, manifest, generated mirrors, and focused test changes. No persisted workflow or external state requires recovery. No transitional mechanism or exit plan is introduced.

## 5. Reference Closure Evidence

### Existing decisions and rejected patterns

- `docs/adr/0003-internal-role-prompt-routing.md`: canonical internal prompt bytes live under `runtime/prompts/`, packaged bytes under `dist/role-prompts/`, and no new public role entry is needed.
- `docs/solutions/project-specific-reviewer-contract-slices.md`: a docs-first reviewer contract plus focused regression is preferred over expanding runtime authority; generic quality rules must remain style-neutral.
- `docs/solutions/progressive-disclosure-review-lens.md`: new review dimensions use a thin reference and existing Review authority rather than a new Skill or decision path.
- `docs/solutions/rejected-rigid-patch-generation-in-reviewer-subagents.md`: Review should return risks and verification criteria, not patches; Executor retains implementation authority.

### Runtime and package call chain

- `plugins/immune-brain/runtime/role_prompt_bridge.ts` maps each Internal Role to its source filename and loads the packaged bytes from `dist/role-prompts/`.
- `plugins/immune-brain/runtime/loop_contract.ts` builds Executor context and foreground role dispatch packets from the bridge.
- `plugins/immune-brain/runtime/prompts/{executor,code-review,pr-fix,test-fixer}.md` are the canonical internal mutation/review contracts.
- `plugins/immune-brain/dist/role-prompts/{executor,code-review,pr-fix,test-fixer}.md` are generated runtime inputs.
- `plugins/immune-brain/skills/imm-pr-fix/SKILL.md` loads the self-owned `plugins/immune-brain/dist/imm-pr-fix.md` contract.
- `scripts/dist-sync-manifest.ts` and `scripts/sync-dist-docs.ts` own reference and role-prompt mirror generation plus README role-map regeneration.

### Highest focused behavioral and contract seams

- `tests/role-prompt-bridge.test.ts` proves every internal role uses byte-identical packaged prompts and no public Skill discovery.
- `tests/loop-execution-routing.test.ts` proves Executor and repair prompts reach the correct bounded role dispatch while code review remains a foreground Review role.
- `tests/dist-docs-sync-contract.test.ts` proves every packaged reference is declared and mirror bytes match the canonical source.
- New `tests/code-quality-guard-contract.test.ts` will prove policy classification, applicable/non-applicable roles, style-only non-rework, test-integrity behavior, standalone `imm-pr-fix` loading, and current documentation consistency.

### Current documentation consumers

- `plugins/immune-brain/README.md`
- `plugins/immune-brain/USER_GUIDE.md`
- `docs/user_manual.md`
- `docs/reference/immune-brain-skills-guide.md`

No unresolved sibling owner or generated mirror remains outside the proposed scope.

## 6. Scope

### Canonical policy and generated package

- Add `docs/reference/code-quality-guard.md`.
- Add its generated mirror at `plugins/immune-brain/dist/docs/reference/code-quality-guard.md`.
- Add the mirror declaration to `scripts/dist-sync-manifest.ts`.

### Internal and standalone role contracts

- Update `plugins/immune-brain/runtime/prompts/executor.md`.
- Update `plugins/immune-brain/runtime/prompts/code-review.md`.
- Update `plugins/immune-brain/runtime/prompts/pr-fix.md`.
- Update `plugins/immune-brain/runtime/prompts/test-fixer.md`.
- Regenerate their four `plugins/immune-brain/dist/role-prompts/` mirrors.
- Update `plugins/immune-brain/dist/imm-pr-fix.md` to load the packaged quality reference.

### Current documentation

- Update `plugins/immune-brain/README.md` outside its generated role-map block.
- Update `plugins/immune-brain/USER_GUIDE.md`.
- Update `docs/user_manual.md`.
- Update `docs/reference/immune-brain-skills-guide.md`.

### Focused tests

- Add `tests/code-quality-guard-contract.test.ts`.
- Update `tests/role-prompt-bridge.test.ts` only if needed to assert the dispatched prompt carries the new invariant text.
- Update `tests/loop-execution-routing.test.ts` only if needed to assert role-specific guard behavior at the dispatch boundary.

### Planning artifacts

- `docs/specs/code-quality-guard.spec.md` and its frozen archive path.
- Canonical TaskIntent `docs/plans/2026-09-02-001-code-quality-guard.intent.json`, authored by Kernel tooling.

## 7. Out of Scope

- Changes to `role_prompt_bridge.ts`, `loop_contract.ts`, Kernel, TaskIntent, TaskRecord, attestation, finding, Review verdict, Tool, or package schemas.
- Changes to QA, UI Review, Planner, advisory, architecture exploration, or Compounder responsibilities.
- A new public Skill, internal role, registry entry, review gate, risk tier, linter, dependency, CI job, or mandatory static-analysis tool.
- Automatic review for routine-risk tasks beyond existing risk obligations.
- Universal hard thresholds for lines, parameters, nesting, complexity, boolean arguments, or identifier names.
- Paid or model-dependent quality behavior benchmarks in this TaskIntent.
- Auditing or refactoring existing Immune-Brain runtime implementation for these failure modes; this task changes enforcement contracts, not unrelated source code.

## 8. Acceptance and Verification

1. **Canonical guard and role applicability**: `tests/code-quality-guard-contract.test.ts` proves the three policy layers, six correctness invariants, contextual heuristics, Review decision thresholds, applicable roles, explicit QA/non-applicable-role exclusion, standalone `imm-pr-fix` reference loading, and synchronized README/current documentation wording.
2. **Internal dispatch behavior**: `tests/role-prompt-bridge.test.ts` and `tests/loop-execution-routing.test.ts` prove the applicable guard instructions are present in the actual packaged prompts delivered to Executor, repair, and Review while role authority, tool policy, foreground dispatch, and stable gate identifiers remain unchanged.
3. **Reference/package ownership**: `tests/dist-docs-sync-contract.test.ts` proves the new reference is manifest-declared and byte-identical in `docs/` and `dist/docs/`.
4. **Generated consistency**: `bun scripts/sync-dist-docs.ts --check` proves the reference, role prompts, packaged declarations, and generated README role-map bytes have no drift.

These seams can fail on the intended regressions: missing or contradictory policy text, guard leakage into QA, style-only rework permission, test weakening, absent standalone loading, undeclared packaged references, stale role-prompt mirrors, and README/package generation drift. They do not claim to prove model behavior; that remains an optional future benchmark triggered by observed misses.

## 9. Devil's Advocate Audit

| Challenge | Evidence | Resolution |
| --- | --- | --- |
| A generic Clean Code checklist may create noisy Review findings. | Hard thresholds and naming blacklists do not prove an observable defect, and Review `pass` cannot carry suggestions. | Split correctness invariants from heuristics and prohibit style-only `rework` explicitly. |
| One reference document may be invisible to internal roles in consumer repositories. | Internal role prompts are loaded as packaged bytes; repository-relative docs may not exist in the consumer workspace. | Keep sufficient normative rules directly in each applicable role prompt; use the reference as the detailed canonical maintainer contract, not a dynamic runtime dependency. |
| Repeating concise rules across prompts may drift. | Role prompts have distinct responsibilities, and generated mirrors already have exact-byte tests. | Add one focused contract test that maps canonical invariants to each applicable prompt and asserts exclusions. Do not add a generic injection framework. |
| The guard could blur Review and QA authority. | QA has no source tools and owns deterministic acceptance evidence, while Review owns immutable source correctness. | Leave QA unchanged and mechanically assert the guard does not appear in its prompt. |
| Updating README and multiple guides could become documentation churn. | The user explicitly required documentation and README synchronization; these are the current files that describe the affected roles. | Update only the four current consumers identified by reference closure and test their shared claims. |
| A model benchmark could provide stronger proof. | Paid behavior benchmarks are nondeterministic and should follow observed prompt-performance risk, not block a static contract publication. | Ship deterministic contract tests now; add a focused benchmark only after a concrete false positive or miss. |
| Multiple TaskIntents may isolate docs from prompt changes. | The policy, role instructions, packaged mirrors, tests, and documentation publish one contract and share one rollback/review boundary. | Retain one material TaskIntent with one coherent acceptance set. |

No blocking concern remains, and the audit does not change a confirmed user decision.

## 10. Delivery and Recovery

Implement as one coherent TaskIntent. Start with the focused contract test and canonical reference, update role contracts and current documentation, run the generator, then execute the focused acceptance descriptors. Do not manually edit generated role-prompt or reference mirrors.

If interrupted, leave the diff inspectable. The mirror and focused contract tests identify incomplete publication; rerunning the generator is idempotent. Rollback is a normal Git revert of the task-owned paths. No migration, compatibility bridge, temporary flag, or cleanup milestone is required.
