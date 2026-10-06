# Planner decision provenance, independently verifiable Slices, and agreed test seams

**Status**: Candidate; not enrolled.
**Design risk**: Medium — changes compiled Planner and Reviewer contract text and their generated mirrors across several components, with no runtime, schema, validator, or authority change.
**Execution posture**: test-first on the contract tests (add the failing assertions, then the contract text, then regenerate mirrors).
**Document language**: English, following the Planner document-language default.

## Outcome

Three contract gaps close together, all as contract text guarded by contract tests:

1. A Spec or TaskIntent can no longer carry a user-owned decision that nobody made. Every decision and acceptance names its source, and an unsourced user-owned decision is a defect the Planner removes or returns for clarification.
2. In a multi-TaskIntent Initiative, every Slice states what is verifiable when it alone lands, so a horizontal layer slice is caught at planning time.
3. The test seam for each acceptance is written into the frozen candidate, shown in what Enrollment already presents, and checked by the Reviewer against the delivered tests.

The ideas were evaluated against `mattpocock/skills` (`to-spec`, `to-tickets`, `implement-spec`). Its parallel worktree frontier is explicitly not adopted.

## Brainstorm Trace

| ID | Confirmed item | Design / acceptance |
|---|---|---|
| BR-REQ-1 | Planner main contract gains reverse provenance for every D/AC, for all plans: `BR-*`, repository evidence, or delegated technical choice | D1; AC1 |
| BR-REQ-2 | An unsourced user-owned decision is a defect: remove it or return it to `imm-brainstorm` | D1; AC1 |
| BR-REQ-3 | `docs/reference/planning-quality-gate.md` Brainstorm traceability mirrors the rule in one sentence; `dist/docs/` copy synced | D1; AC1 |
| BR-REQ-4 | In a multi-Slice Initiative each Slice states its independently verifiable result and no acceptance depends on another Slice; wide-refactor exception | D2; AC2 |
| BR-REQ-5 | Seams are explicit entries in the Spec/TaskIntent and appear in what Enrollment already presents | D3; AC3 |
| BR-REQ-6 | Reviewer checks coverage of the agreed seams against frozen content; a gap is a finding | D4; AC4 |
| BR-REQ-7 | Every rule has a `tests/*-contract.test.ts` style assertion and `dist/` is regenerated | AC1–AC4 |
| BR-DEC-1 | Keep "must not … add a mandatory user confirmation"; the existing assertion at `tests/workflow-verification-invariants.test.ts:173` is not changed | D3 invariant I1; AC3 |
| BR-DEC-2 | Provenance does not have to be a `BR-DEC`; Direct Planner entry and delegated technical choices stay legitimate | D1; AC1 |
| BR-DEC-3 | The provenance rule lives in the main contract; the Slice self-check applies only to multi-Slice Initiatives | D1, D2; AC1, AC2 |
| BR-DEC-4 | Use the existing bun contract tests; no `tests/test_skill_contracts.py` | Verification mapping |
| BR-OUT-1 | No parallel frontier, worktree, or integration branch; `batch_runner.ts` and `batch_git.ts` untouched | Out of scope |
| BR-OUT-2 | No separate seam confirmation gate | Out of scope; I1 |
| BR-OUT-3 | No TaskIntent schema or Kernel runtime change | Out of scope; I2 |

## Scope and exclusions

Include: the owned Planner contract `plugins/immune-brain/dist/imm-planner.md` and its loader `plugins/immune-brain/skills/imm-planner/SKILL.md`; `docs/reference/planning-quality-gate.md` and its mirror; the Review role prompt `plugins/immune-brain/runtime/prompts/code-review.md`, its mirror, and the generated `plugins/immune-brain/agents/immune-brain-reviewer.md`; the contract tests named below; one changeset.

Exclude: `plugins/immune-brain/runtime/unattended/*`, the Kernel, `plan_core.ts` and every validator (`imm-plan`, `imm-kernel intent validate`), the TaskIntent and review-finding schemas, the Enrollment gate implementation, `STATIC_REVIEW_RULES`, the QA role prompt, and the Brainstorm contract. `runtime/prompts/code-review.md` is prompt text, not Kernel runtime; editing it is the only change under `runtime/`.

## Discovery evidence and reference closure

- `scripts/dist-sync-manifest.ts` `SKILL_OWNED_ENTRIES`: `dist/imm-planner.md` is its own authoring source; `skills/imm-planner/SKILL.md` is a minimal loader. `reference/planning-quality-gate.md` is a `mirror` entry. Role prompts mirror `runtime/prompts/` into `dist/role-prompts/`. All are regenerated and drift-checked by `bun scripts/sync-dist-docs.ts [--check]`.
- `scripts/build-claude-plugin.ts:30` composes `agents/immune-brain-reviewer.md` from `runtime/prompts/code-review.md` plus `STATIC_REVIEW_RULES`; `tests/claude-host-package.test.ts` fails on drift. `dist/claude/mcp-server.mjs` does not embed the role prompt text.
- Existing Planner text this work extends: `Testing Seam Selection` and `Brainstorm Manifest Mapping` (Planning Rules), `TaskIntent decomposition` (Core Responsibilities), the Initiative review table (Initiative Carrier Preference), Red Flags.
- Existing Reviewer text this work extends: `## Invariant and Evidence Coverage` in `code-review.md`. Rework findings already require `violated.kind` of `acceptance` or `security_boundary` with `ref` the acceptance id, so a seam finding needs no new field.
- Test prior art: `tests/workflow-decision-closure.test.ts` (Planner handoff closure, both loaders), `tests/workflow-verification-invariants.test.ts` (Planner verification text, Review prompt and mirror), `tests/technical-design-conformance-contract.test.ts` (Planner and quality gate), `tests/dist-docs-sync-contract.test.ts` (mirror sync), `tests/claude-host-package.test.ts` (generated reviewer definition).

## Technical Design

**Design views**: service/component interfaces (which contract owns each rule and which artifacts are generated from it) and data flow (how a seam travels from Planner to Reviewer). State transitions, temporal sequence, and architecture layers are omitted: no state, ordering, or layering changes.
**Diagram decision**: not_required
**Diagram reason**: the flow is one linear hand-off (Planner writes, Enrollment displays, Reviewer reads) fully described in D3 and D4.

### Invariants

- **I1**: No new user confirmation, gate, or scheduler. The sentence "must not weaken acceptance-specific focused verification descriptors or add a mandatory user confirmation" stays verbatim.
- **I2**: No schema field, validator rule, or Enrollment counting rule. Every new rule is Planner or Reviewer judgment expressed in contract text.
- **I3**: Candidates and historical artifacts written before this change remain valid; absence of a named seam or a provenance note in them is never a defect or a finding.

### D1. Decision provenance (source: BR-REQ-1, BR-REQ-2, BR-REQ-3, BR-DEC-2, BR-DEC-3)

Add a `Decision Provenance` rule to Planning Rules beside `Brainstorm Manifest Mapping`. Every Spec decision and every acceptance names exactly one source: an upstream `BR-*` ID, repository evidence (a concrete path), or a delegated technical choice as already defined by Clarification supplement. The rule applies with or without an upstream manifest. A user-owned decision (goal, user, scope, observable behavior, compatibility preference, risk acceptance, success criterion) with no source is a defect: the Planner removes it or returns that delta for clarification under the existing Clarification supplement routes. Simple TaskIntent-only work satisfies the rule when each acceptance traces to the request text; it adds no table. Add a matching Red Flag, one loader line if the loader lists mandatory constraints for it, and one mirrored sentence in the quality gate's Brainstorm traceability check.

### D2. Independently verifiable Slices (source: BR-REQ-4, BR-DEC-3)

Extend `TaskIntent decomposition` and the quality gate's entry of the same name. For a multi-TaskIntent Initiative only: each Slice states what is observable and verifiable when that Slice alone has landed, and no acceptance may require another unfinished Slice's work to pass. A Slice with no such result is a horizontal layer slice and is re-cut. Exception: a wide mechanical refactor whose blast radius prevents any green vertical slice may be batched, with the rationale recorded and the batches blocking one final integrate-and-verify Slice. The Initiative review table's existing `result` column carries the statement. Per I2 this stays Planner judgment.

### D3. Agreed seams (source: BR-REQ-5, BR-DEC-1)

Extend `Testing Seam Selection`, keeping its existing sentences. For each acceptance the candidate records the agreed seam: the existing or new test file and the observable boundary it exercises. Complex work records it in the Spec's verification and acceptance mapping; simple work names it in the acceptance assertion. Because the seam is part of the candidate, the native Enrollment gate, and the Initiative review table when one exists, present it without any added confirmation (I1). Tests the Executor adds exercise the agreed seams; replacing a seam is an acceptance change and follows Enrolled Intent Revision.

### D4. Reviewer seam coverage (source: BR-REQ-6)

Extend `## Invariant and Evidence Coverage` in `code-review.md`. When an acceptance assertion, or the Spec it references, names an agreed seam, the Reviewer checks that the delivered tests exercise that acceptance at that seam. A missing seam, or a seam silently replaced by a different one, is a finding with `violated.kind: "acceptance"` and `ref` the acceptance id. When no seam is named, its absence is not a finding (I3). Regenerate the mirror and the Claude reviewer definition.

### Compatibility, interruption, rollback

Text-only; no persisted state changes shape. If execution stops midway, `bun scripts/sync-dist-docs.ts --check` and `bun scripts/build-claude-plugin.ts --check` report any source/mirror drift and rerunning the generators repairs it. Rollback is reverting the change set as one unit.

## Verification and acceptance mapping

| Acceptance | Agreed seam (existing test files, extended) | Required regression behavior |
|---|---|---|
| AC1 | `tests/workflow-decision-closure.test.ts`, `tests/technical-design-conformance-contract.test.ts`, `tests/dist-docs-sync-contract.test.ts` | Planner contract carries the three sources and the defect rule; it still permits Direct Planner entry and delegated technical choices (negative control: the text does not require a `BR-DEC` source); quality gate sentence present and mirror in sync |
| AC2 | `tests/technical-design-conformance-contract.test.ts`, `tests/dist-docs-sync-contract.test.ts` | Planner and quality gate carry the independently-verifiable rule scoped to multi-TaskIntent Initiatives, the wide-refactor exception, and still say it is not a schema field or Enrollment counting rule |
| AC3 | `tests/workflow-verification-invariants.test.ts` | Planner records an agreed seam per acceptance in the Spec or assertion; the existing no-mandatory-confirmation assertion passes unchanged |
| AC4 | `tests/workflow-verification-invariants.test.ts`, `tests/claude-host-package.test.ts` | Review prompt and its mirror carry the seam-coverage rule and the no-seam-named negative; the generated reviewer definition matches its source |

Outside the acceptance descriptors: `bun scripts/sync-dist-docs.ts --check`, `bun scripts/build-claude-plugin.ts --check`, `bun run typecheck`, and one full `bun test` before completion, because compiled skill contracts are read by many contract tests.

## Devil's Advocate Audit

- **Rollback resilience**: no state or schema is touched; a partial run leaves only detectable mirror drift, repaired by the generators or by reverting.
- **Verification vanity**: string-presence assertions prove the contract says the rule, not that a model obeys it. Each acceptance therefore pairs the positive assertion with a negative or bound one (provenance does not demand `BR-DEC`; seams add no confirmation; an unnamed seam is not a finding) so a careless over-strict wording fails.
- **Spec dilution**: every `BR-*` item is mapped above. The work must not grow into a provenance validator in `plan_core.ts`, a seam schema field, a new gate, or parallel execution; those are excluded by I1, I2, and BR-OUT-1..3.

## Delivery boundary

One Spec and one TaskIntent settle together: the four acceptances share one risk treatment, rollback unit, and authority, and each is a text rule with its own focused check. This candidate authorizes nothing until native Enrollment.
