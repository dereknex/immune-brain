# User acceptance scenarios in Brainstorm, Spec, review, and Initiative Issues

**Status**: Candidate; not enrolled.
**Design risk**: High — a cross-component package contract: Brainstorm, Planner, Loop, and Reviewer contract text, their generated mirrors, and the GitHub tracker runtime projection. No TaskIntent schema, Kernel validator, or authority change.
**Execution posture**: test-first on the contract and projection tests (add the failing assertions, then the text or runtime change, then regenerate mirrors and the Claude bundle).
**Document language**: English, following the Planner document-language default.
**Source**: Direct Planner entry. Every user-owned decision below was confirmed by the user on 2026-10-10 and is recorded in #186 as `D1`–`D18`.

## Outcome

Planning artifacts state what a user can observe once the work lands, and that statement stays traceable down to acceptance and review:

1. Brainstorm hands off user scenarios as a manifest class of their own.
2. A Spec for work with a user-observable change carries those scenarios and maps each to acceptance, or records why it is walked through by hand.
3. Work without a user-observable change says so with a reason instead of inventing scenarios.
4. Initiative Parent and Child Issues show the scenarios; manual ones are a checklist.
5. The Reviewer checks that delivered tests cover each automated scenario's observable result.
6. The exit summary of a settled Task names the manual scenarios still to be walked through.

Nothing here is a gate: no confirmation is added, and settlement, Issue closure, and unattended batches behave as today (#186 D3, D7).

## User scenarios

This Spec uses the format it introduces (#186 D18). IDs are Spec-local because entry was direct (#186 D16).

| ID | Mode | Actor | Given | When | Then |
|---|---|---|---|---|---|
| SCN-1 | manual — a deterministic test can assert contract text, not that a model follows it | Developer framing a feature in `imm-brainstorm` | The feature changes something a user can observe and framing is confirmed | Brainstorm emits its handoff manifest | The manifest lists `BR-SCN-*` items, each with Actor, Given, When, Then |
| SCN-2 | manual — same reason as SCN-1 | Developer running `imm-planner` on that feature | A manifest with `BR-SCN-*` items, or a direct request whose scenarios were confirmed in clarification | The Planner presents the candidate | The Spec has a `User scenarios` section; every scenario is tagged `automated` with an acceptance ID or `manual` with a reason; the Initiative review table shows each Slice's scenarios |
| SCN-3 | manual — same reason as SCN-1 | Developer planning a pure refactor | The change has no user-observable behavior | The Planner presents the candidate | The candidate states `no user-visible change` with a reason, has no scenario section, and the review table shows the exemption |
| SCN-4 | manual — same reason as SCN-1 | Developer whose Task just settled through `imm-run` | The bound Spec lists manual scenarios owned by that Slice | The Loop prints its exit summary | The summary names those scenario IDs as pending walkthrough and the Task is still reported complete |
| SCN-5 | automated → `US-S2-A1` | Developer opening a published Child Issue | The Initiative was published with scenarios | They read the Child and its Parent | The Child shows `## User scenarios` with its own scenarios, manual ones as unchecked boxes; the Parent lists every scenario with its owning Slice |
| SCN-6 | automated → `US-S2-A1` | Developer publishing an Initiative for exempt work | No Task supplies scenarios | Publication completes | Parent and Child bodies are byte-identical to what the tracker renders today; no `User scenarios` heading appears |
| SCN-7 | automated → `US-S2-A2` | Developer publishing an Initiative | A scenario names an acceptance ID that the Task's TaskIntent does not have | They run `imm-tracker publish-initiative` | The command fails naming the Task and the unknown ID, and no Issue was created or edited |
| SCN-8 | automated → `US-S2-A1` | Developer who ticked a manual scenario box on a Child Issue | The Task then reaches a terminal `done` | The tracker projects the terminal state | The Child closes as completed and the tick is still there |
| SCN-9 | manual — same reason as SCN-1 | Developer reading a Review result | The Spec maps an automated scenario to an acceptance, and the delivered tests never assert that scenario's `Then` | Review completes | The verdict carries a finding of kind `acceptance` referencing that acceptance ID |

## Decision trace

Every user-owned decision maps to one design element. `D<n>` refers to #186.

| Source | Confirmed decision | Design / acceptance |
|---|---|---|
| D1 | Scenario fields `Actor / Given / When / Then`, tagged `automated` or `manual`; `Then` is directly observable | T1; `US-S1-A1`, `US-S1-A2` |
| D2 | Motivation: passing assertions with wrong behavior; no post-merge walkthrough list | Outcome |
| D3 | Traceability constraint, not a gate; no added confirmation | I1; `US-S1-A2` |
| D4 | Brainstorm `BR-SCN-*` is the source, the Spec carries, Issues project; no TaskIntent schema or Kernel change | T1, T2, T4; I2 |
| D5 | Only work with a user-observable change; otherwise `no user-visible change` with a reason | T3; `US-S1-A2` |
| D6 | Forward-only, no backfill | I3; Out of scope |
| D7 | Manual scenarios: Child checkbox list and pending-walkthrough line in the exit summary; never keeps an Issue open | T4, T6; `US-S2-A1`, `US-S1-A3` |
| D8 | One-way mapping; `automated` needs ≥1 acceptance; `manual` may map to none and states why | T2; `US-S1-A2`, `US-S2-A2` |
| D9 | A scenario belongs to the Slice that first makes it observable; Parent lists all | T2, T4; `US-S1-A2`, `US-S2-A1` |
| D10 | Optional `## User scenarios` on Parent and Child, omitted when empty | T4; `US-S2-A1` |
| D11 | Contract owns source and mapping; tracker checks referenced acceptance IDs and fails closed before any write | T2, T5; `US-S2-A2` |
| D12 | Exemption decided by the Planner, shown in the existing review table | T3; `US-S1-A2` |
| D13 | Reviewer checks automated-scenario coverage at the mapped seam; gap is an `acceptance` finding; no new kind | T7; `US-S3-A1` |
| D14 | Scenario text is English | T1 |
| D15 | One Initiative, three Slices | Delivery |
| D16 | `BR-SCN-<n>` upstream; Spec-local `SCN-<n>` on direct entry | T1; `US-S1-A1`, `US-S1-A2` |
| D17 | S2 and S3 blocked by S1 only, parallel when no generated mirror is shared | Delivery; discovery evidence |
| D18 | This Spec is written in the new format | User scenarios |

## Out of scope

- TaskIntent schema, Kernel validator, Enrollment, QA, or settlement behavior (D4, D3).
- A new Reviewer finding kind, verdict branch, or state (D13).
- Backfilling existing Specs, TaskIntents, or published Issues (D6).
- The Local Markdown Initiative carrier: its file format is unchanged; scenarios for a Local Initiative live in the Spec only (delegated technical choice — D10 names GitHub Issues only).
- `plugins/immune-brain/runtime/plan_core.ts` `BR_ITEM_RE`: it validates archived prose Plans only and stays as is (repository evidence: `plan_core.ts:33`, `:910`).

## Discovery evidence and reference closure

- **No scenario concept exists today.** `git grep` for `BR-SCN`, `SCN-`, `User scenarios` over `plugins/`, `docs/reference/`, `tests/` returns nothing. Brainstorm manifest classes are `BR-REQ/DEC/OUT/DEFER/Q` (`plugins/immune-brain/dist/imm-brainstorm.md:98`, `:122`).
- **Brainstorm contract**: canonical `plugins/immune-brain/dist/imm-brainstorm.md`; compact entry `plugins/immune-brain/skills/imm-brainstorm/SKILL.md`. Guarded by `tests/brainstorm-decision-probing-contract.test.ts` and `tests/skill-dist-consistency.test.ts` (asserts the manifest classes at `:193`).
- **Historical evidence binding.** `tests/fixtures/workflow-decision-closure-evidence.json` binds `plugins/immune-brain/dist/imm-brainstorm.md` by SHA-256. `tests/workflow-behavior-evidence.test.ts` re-hashes bound sources and substitutes a preserved copy only for the Planner (`measuredSource`, `tests/fixtures/workflow-decision-closure-sources/imm-planner.md`). Editing the Brainstorm contract therefore breaks that suite unless S1 preserves the measured Brainstorm bytes the same way. The measured digest is never refreshed.
- **Planner contract**: `plugins/immune-brain/dist/imm-planner.md` (Planning Rules, Core Responsibilities, Output artifact, Initiative Carrier Preference review table), compact entry `plugins/immune-brain/skills/imm-planner/SKILL.md`, quality gate `docs/reference/planning-quality-gate.md` mirrored byte-identically to `plugins/immune-brain/dist/docs/reference/planning-quality-gate.md` (`scripts/dist-sync-manifest.ts`). Guarded by `tests/technical-design-conformance-contract.test.ts`, `tests/workflow-decision-closure.test.ts`, `tests/dist-docs-sync-contract.test.ts`.
- **Exit summary**: `plugins/immune-brain/dist/imm-run.md` `## Observable Output` holds the fixed summary block; `tests/workflow-authoritative-recovery.test.ts` is the only test that reads `Stop reason`.
- **Tracker**: `plugins/immune-brain/runtime/github_issue_tracker.ts` — `InitiativePublicationInput` (`:65`), `TaskProjection` (`:161`), Parent body template (`:976`), `childBody` (`:1041`), public acceptance ID check against the canonical TaskIntent (`:2891`–`:2903`). It is inlined into `plugins/immune-brain/dist/claude/mcp-server.mjs`. Guarded by `tests/github-issue-projection-contract.test.ts` and `tests/github-initiative-recovery.test.ts`. The input contract is described in `plugins/immune-brain/dist/imm-planner.md` (Initiative Carrier Preference) and `docs/agents/issue-tracker.md`; `tests/carrier-enrollment-gate-contract.test.ts` reads that Planner text.
- **Ticking a box is safe after publication.** `mark-terminal` appends its suffix to the body it reads (`github_issue_tracker.ts:1388`) and does not compare against a rendered body, and an amendment binds historical Children to their observed bytes. A rerun of the original publication against an edited pending Child fails as content drift exactly as any other manual edit does today; that strict default is kept.
- **Reviewer**: source `plugins/immune-brain/runtime/prompts/code-review.md` (agreed-seam rule at `:49`), mirror `plugins/immune-brain/dist/role-prompts/code-review.md`, generated `plugins/immune-brain/agents/immune-brain-reviewer.md` (`scripts/build-claude-plugin.ts:30`–`:31`). Guarded by `tests/workflow-verification-invariants.test.ts` and `tests/claude-host-package.test.ts`.
- **S2 and S3 share no generated artifact.** The review prompt is not inlined in `mcp-server.mjs` (no match for its agreed-seam sentence in the bundle); S3 regenerates only the reviewer definition and the role-prompt mirror, S2 only the bundle. Their source and test paths are disjoint, so D17's parallel condition holds.

## Technical Design

**Design views**: service/component interfaces (which contract or runtime owns each rule and what it accepts) and data flow (how a scenario travels from Brainstorm to an Issue and to Review). State transitions and temporal sequence are omitted because no state, phase, or ordering is added; architecture layers are omitted because ownership stays where it is.
**Diagram decision**: not_required
**Diagram reason**: the flow is one linear hand-off — Brainstorm manifest, Spec, tracker input, Issue body, with the Reviewer and the Loop reading the Spec — and T1–T7 state each hop.

### Invariants

- **I1 — no gate.** No contract sentence makes a scenario a precondition of Enrollment, QA, Review pass, settlement, or Issue closure. The Planner sentence "must not weaken acceptance-specific focused verification descriptors or add a mandatory user confirmation" stays. (D3)
- **I2 — no authority change.** TaskIntent schema, Kernel validation, and TaskRecord are untouched; scenarios never appear in a TaskIntent field. (D4)
- **I3 — absent means unchanged.** A publication with no scenarios renders Parent and Child bodies byte-identical to today's, so exempt work, existing Initiatives, and their amendments see no drift. (D6, D10)
- **I4 — the tracker stays an observer.** Scenario text is public projection only; it never widens TaskIntent scope and is never read back as authority.

### T1. Scenario shape and Brainstorm source (source: D1, D4, D14, D16)

The Brainstorm handoff manifest gains `BR-SCN-<n>` for a confirmed user scenario, beside the existing classes. A scenario has exactly `Actor`, `Given`, `When`, `Then`, written in English. `Then` states a result the actor observes directly — command output, a file, an Issue or UI state — and never an internal state or a test file name. Brainstorm records scenarios only for framing that changes user-observable behavior; it does not invent one for internal work.

### T2. Spec carriage and mapping (source: D4, D8, D9, D11, D16)

Planner rule, in Planning Rules beside Brainstorm Manifest Mapping:

- A Spec for work with a user-observable change has a `User scenarios` section. Each scenario keeps its upstream `BR-SCN-<n>` ID; on direct entry the Planner confirms scenarios during clarification and records Spec-local `SCN-<n>` sourced to that confirmation. A scenario with no source is the same defect as any unsourced user-owned decision.
- Each scenario is tagged `automated` with at least one acceptance ID, or `manual` with the reason it cannot be automated. A `manual` scenario may name no acceptance. The mapping is one-way: an acceptance need not serve a scenario.
- In a multi-TaskIntent Initiative a scenario belongs to exactly one Slice — the one that first makes it observable — and an `automated` scenario maps only to that Slice's acceptance.
- `BR-SCN-*` items are covered by the existing handoff completeness check like every other `BR-*` item.

`docs/reference/planning-quality-gate.md` mirrors the rule in its Brainstorm traceability check; the packaged mirror stays byte-identical.

### T3. Exemption (source: D5, D12)

When work has no user-observable change the Planner records `no user-visible change` with a one-line reason — in the Spec for complex work, on the TaskIntent goal for simple work — and writes no scenario section. The Initiative review table gains scenario IDs, or the exemption and its reason, per Slice. This uses the existing single review question and adds none.

### T4. Issue projection (source: D4, D7, D9, D10)

Delegated technical choice for the input shape: each entry of `InitiativePublicationInput.tasks` accepts an optional `scenarios` array:

```json
{ "id": "SCN-5", "actor": "...", "given": "...", "when": "...", "then": "...",
  "mode": "automated", "acceptance": ["US-S2-A1"] }
{ "id": "SCN-4", "actor": "...", "given": "...", "when": "...", "then": "...",
  "mode": "manual", "manual_reason": "..." }
```

Scenarios are supplied once, on their owning Task. The Parent listing is derived from the Tasks, so Parent and Child cannot disagree.

- **Child**: `## User scenarios` after `## Acceptance criteria`. One list item per scenario with its ID, mode, mapped acceptance IDs, and the four fields. A `manual` item is a `- [ ]` task-list item and shows its reason; an `automated` item is a plain bullet. Every list marker starts its line, so no metadata comment precedes it and GitHub still renders both forms. The same marker block that carries `slice-id` and `task-id` also carries one `<!-- immune-brain:scenarios=<percent-encoded JSON> -->` per Task holding all of its scenarios verbatim; that marker is the only source an amendment reads historical scenarios from, and the visible section is never parsed.
- **Parent**: `## User scenarios` after `## Testing strategy`. One plain bullet per scenario with its ID, owning Slice ID, mode, and its `When`/`Then`. No checkboxes.
- When no Task supplies scenarios neither heading is rendered (I3). A Child whose own list is empty renders no heading even when siblings have scenarios.
- Amendment: scenarios on a bound pending Child are part of its approved brief and update it like any other brief change; historical Children are never rewritten.
- Terminal projection is unchanged: a ticked or unticked box never affects `mark-terminal`, Child closure, or Parent closure.

### T5. Tracker validation (source: D8, D11)

Before any remote write, in the same pass that checks public acceptance IDs, the tracker rejects the whole batch when a scenario: lacks a field; has an `id` not matching `BR-SCN-<n>` or `SCN-<n>`; repeats an `id` within the Initiative; is `automated` with no acceptance ID; names an acceptance ID absent from its Task's canonical TaskIntent; or is `manual` without `manual_reason`. Text fields obey the existing public-projection text rules and bounds. Failure is the tracker's existing structured failure with zero mutations. The tracker does not judge whether a scenario is well written or whether an exemption is justified; that stays with the Planner contract.

The Planner contract's Initiative Carrier Preference section and `docs/agents/issue-tracker.md` describe the `scenarios` input in the Slice that makes the tracker accept it.

### T6. Exit summary (source: D7)

`imm-run` Observable Output: when the bound Spec lists `manual` scenarios owned by the settled Task's Slice, the exit summary adds one line naming those scenario IDs as pending manual walkthrough. The line is informational; it changes no stop reason, obligation, or completion fact, and is absent when there are none.

### T7. Reviewer coverage (source: D13)

`code-review.md`, beside the agreed-seam rule: when the Spec referenced by an acceptance maps an `automated` scenario to it, the Reviewer checks that the delivered tests at that acceptance's agreed seam assert the scenario's `Then`. A scenario whose observable result is asserted nowhere is a finding with violated kind `acceptance` and the acceptance ID as ref. A `manual` scenario and an acceptance with no mapped scenario produce no such finding.

### Alternatives rejected

- **Scenario field on TaskIntent** — needs a Kernel schema and historical-intent compatibility change for content that grants no authority (D4).
- **Reuse `Testing strategy` / `Desired behavior` free text** — no structure for the tracker or Reviewer to check.
- **Manual scenarios as a settlement gate** — contradicts I1 and makes unattended batches and terminal projection non-deterministic (D3).
- **Separate Parent scenario input** — two sources that can drift; derived listing is sufficient.

### Compatibility, interruption, rollback

Every Slice is additive. S1 is contract text: reverting it restores prior Planner behavior and leaves any Spec that already has a scenario section as harmless prose. S2 adds an optional input; without it output is byte-identical (I3), so reverting S2 only stops new scenario sections from rendering and leaves published Issues intact. S3 adds one Reviewer check that fires only when a Spec maps an automated scenario. A partially landed Initiative is coherent at each step: after S1 alone, scenarios exist in Specs and are not yet shown on Issues or checked in Review.

## Verification and acceptance mapping

Agreed seams; each TaskIntent carries the runnable descriptor.

| Acceptance | Seam | Controls |
|---|---|---|
| S1 `US-S1-A1` Brainstorm scenario class | `tests/brainstorm-decision-probing-contract.test.ts`; `tests/skill-dist-consistency.test.ts`; `tests/workflow-behavior-evidence.test.ts` | Positive: contract names `BR-SCN-*` with the four fields and the observable-`Then` rule. Negative: contract says internal work gets no invented scenario. Bound: the historical evidence suite still verifies against preserved measured Brainstorm bytes, and the measured digest in the evidence file is unchanged. |
| S1 `US-S1-A2` Planner carriage, mapping, exemption | `tests/technical-design-conformance-contract.test.ts`; `tests/workflow-decision-closure.test.ts`; `tests/dist-docs-sync-contract.test.ts` | Positive: section, tagging, one-way mapping, owning Slice, direct-entry `SCN-<n>`, review-table column. Negative: unsourced scenario is a defect; `no user-visible change` requires a reason. Bound: the "must not … add a mandatory user confirmation" sentence and its existing assertion are unchanged; quality-gate mirror in sync. |
| S1 `US-S1-A3` Exit summary line | `tests/workflow-authoritative-recovery.test.ts` | Positive: contract adds the pending-walkthrough line for manual scenarios. Negative: the line is informational and changes no completion fact. Bound: absent when the Slice owns no manual scenario; the existing summary fields are unchanged. |
| S2 `US-S2-A1` Projection | `tests/github-issue-projection-contract.test.ts`; `tests/github-initiative-recovery.test.ts` | Positive: Child and Parent sections with the stated content and position; manual as `- [ ]`. Negative: a Child with no scenarios has no heading though a sibling has one. Bound: no scenarios anywhere gives byte-identical bodies; `mark-terminal` on a Child with a ticked box closes it and keeps the tick; an amendment leaves a historical Child's bytes untouched. Closes SCN-5, SCN-6, SCN-8. |
| S2 `US-S2-A2` Validation | `tests/github-issue-projection-contract.test.ts` | Positive: a valid mixed set publishes. Negative: each T5 rejection — unknown acceptance ID, automated with none, manual without reason, bad or duplicate ID, missing field — fails with zero remote calls that mutate. Bound: a manual scenario with no acceptance is accepted. Closes SCN-7. |
| S2 `US-S2-A3` Input contract text | `tests/carrier-enrollment-gate-contract.test.ts` | Positive: Planner contract and `docs/agents/issue-tracker.md` describe `scenarios`, its two modes, and omission. Negative: text states scenarios never widen TaskIntent scope or authority. Bound: existing carrier-gate assertions unchanged. |
| S3 `US-S3-A1` Reviewer coverage | `tests/workflow-verification-invariants.test.ts`; `tests/claude-host-package.test.ts` | Positive: prompt states the coverage check and the finding shape. Negative: manual scenarios and unmapped acceptances produce no finding. Bound: mirror and generated reviewer definition match their source; the existing agreed-seam rule text is unchanged. |

Provenance: `bun` comes from the QA host; code and tests from the tracked delivery; tracker tests use the existing in-process `gh` fake and temporary repositories. No `environment.prepare`, no writable paths, no network. Regenerating `dist/claude/mcp-server.mjs`, prompt mirrors, and the dist docs mirror, plus `bun run typecheck`, are Executor regression work, not acceptance.

## Devil's Advocate Audit

- **Rollback resilience.** Each Slice reverts independently (see Compatibility). The riskiest partial state is S2 landing a section format that later needs to change: published Children freeze it. Mitigation is ordering — S1 lands first and this Spec already exercises the format on nine scenarios — and I3, which keeps every Initiative without scenarios untouched.
- **Verification vanity.** S1 and S3 acceptances assert contract text, which proves the rule is stated and not that a model follows it. That limit is declared rather than hidden: SCN-1–4 and SCN-9 are `manual` for exactly this reason. S2 is the only Slice with behavior a deterministic test can prove, and its controls include the byte-identical bound and zero-mutation negatives so a rendering change cannot pass by happy path alone.
- **Spec dilution.** All eighteen confirmed decisions map in the Decision trace, none to "deferred". The one narrowing — the Local carrier is not extended — is outside what D10 confirmed and is listed under Out of scope with its reason.
- **Ceremony risk.** Scenarios could decay into template filler. T1's observable-`Then` rule, T3's exemption, and the Reviewer check in T7 are the countermeasures; if scenarios written for the next few real Initiatives are not useful, S1 is the single place to tighten or remove the rule.

## Delivery boundary

One Initiative, three TaskIntents (D15). S1 owns every contract sentence that does not depend on the tracker. S2 owns the tracker runtime, its bundle, and the input-contract text. S3 owns the Reviewer prompt and its generated copies. S2 and S3 are each blocked by S1 only (D17). This candidate authorizes nothing until native Enrollment.
