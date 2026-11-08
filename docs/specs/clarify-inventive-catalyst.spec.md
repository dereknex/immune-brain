# Clarify inventive catalyst lens and false-compromise check

**Status**: Candidate; planning only.
**Design risk**: Medium — the change rewrites instruction text in two packaged skill contracts (`clarify`, `draw-up`) and one packaged planning reference, which are compiled skill contracts and packaged plugin output. No runtime module, persisted state, Kernel, Port, verdict, or schema changes.
**Output language**: English, following the Planner document-language default.
**Threat model and supported environment**: None beyond the repository's own tooling. Inputs are repository-controlled Markdown read by the existing Bun contract tests on macOS/Linux with UTF-8 paths.

## Outcome

Issue #423, adopted by the user on 2026-11-08. An explicit exhaustive `clarify` interrogation checks the concept against a seventh lens, inventive catalyst, which asks which trade-off the design accepts as inevitable and resolves it with a named pattern from an inlined ten-pattern catalog taken from EGM, each with its secondary cost, or records `No false compromise detected`. The planning quality gate gains a matching advisory false-compromise check for Medium/High risk Specs before finalization, presented under the existing design-option presentation rule, and the `draw-up` contract points at it so the Planner reaches the check.

## Evidence

| ID | Evidence |
| --- | --- |
| E1 | The six lenses live in one sentence of the Explicit exhaustive interrogation section, `plugins/immune-brain/dist/clarify.md:108-114`, ending with "A lens that finds nothing is recorded as checked, not skipped." |
| E2 | `plugins/immune-brain/dist/clarify.md` is its own authoring source (`scripts/dist-sync-manifest.ts:113-119`, `kind: "owned"`); `plugins/immune-brain/skills/clarify/SKILL.md:24` already routes to the section, so routing does not change. |
| E3 | `plugins/immune-brain-antigravity/dist/clarify.md`, `plugins/immune-brain-antigravity/dist/draw-up.md`, and `plugins/immune-brain-antigravity/dist/docs/reference/planning-quality-gate.md` are derived outputs of `scripts/build-antigravity-plugin.ts` (`docs/agents/derived-files.json`, entry `antigravity-plugin-artifact`), currently byte-identical to their sources (`cmp`, HEAD `c4a39942d`). |
| E4 | `docs/reference/planning-quality-gate.md` mirrors to `plugins/immune-brain/dist/docs/reference/planning-quality-gate.md` (`scripts/dist-sync-manifest.ts:40`, `mode: "mirror"`); byte equality is asserted by `tests/dist-docs-sync-contract.test.ts:91-94`, `tests/direct-first-routing-contract.test.ts:75`, and `tests/roadmap-plan-boundary-contract.test.ts:118`. |
| E5 | The design-option presentation rule (`docs/reference/planning-quality-gate.md:24`) presents at most three options, each with mechanism, trade-off, and failure conditions, unordered and without a recommended default. Design-view selection (`:25`) already scopes a check with "for Medium/High risk". |
| E6 | No file in `plugins/immune-brain/` links `planning-quality-gate.md`; the only Planner-facing mention is the summary bullet `plugins/immune-brain/dist/draw-up.md:625` ("**Planning Quality Gate**: For elevated-risk complex work, verify contract surfaces, …"). Without a pointer the new check is not reachable from `draw-up`, so BR-SCN-2 would not be delivered. |
| E7 | EGM `agents/inventive_catalyst.md` at `6a8001e` (`https://github.com/google/elephant-goldfish-model`) inlines ten patterns in order — Segmentation, Extraction, Preliminary Action, Beforehand Cushioning, Inversion, Dynamics, Blessing in Disguise, Intermediary, Self-Service, Cheap Dispensables — each with a Secondary Trade-off; it treats theoretical invariants as immutable bounds and outputs "No false compromise detected" when no genuine contradiction exists. |
| E8 | Existing seams: `tests/exhaustive-decision-tree-contract.test.ts:77-98` isolates the opt-in section with `raw.split("## Explicit exhaustive interrogation\n")`; `tests/technical-design-conformance-contract.test.ts:8-15` reads `PLANNER` and `QUALITY_GATE` with an `expectAll(text, required, forbidden)` helper. No test asserts "six lenses" or any lens phrase (grep over `tests/*.ts`). |
| E9 | Precedent: the six lenses landed as text plus mirror in `2f84c4293`; the most recent instruction-text change shipped a `"immune-brain": patch` changeset (`c4a39942d`, `.changeset/layering-rules.md`). |
| E10 | `plugins/immune-brain/dist/role-prompts/code-review.md` and `plugins/immune-brain/runtime/prompts/code-review.md` hold the Review "Two lenses" and stay untouched. |

## Decisions and provenance

| ID | Decision | Source |
| --- | --- | --- |
| D1 | In `dist/clarify.md` the sentence "check the concept against six lenses" becomes "seven lenses", and the seventh lens, inventive catalyst, is appended after long-term tech debt and maintenance. The lens stays inside Explicit exhaustive interrogation only. | BR-REQ-1, BR-OUT-3 |
| D2 | The lens asks which trade-off the design accepts as inevitable and inlines the ten E7 pattern names verbatim, in E7 order, on one line, citing EGM `agents/inventive_catalyst.md` at `6a8001e`. | BR-REQ-2, BR-DEC-1 |
| D3 | Every proposed pattern states its secondary cost. | BR-REQ-3 |
| D4 | When no genuine contradiction exists the lens records `No false compromise detected` instead of inventing a transform; this sits beside the existing "recorded as checked, not skipped" rule. | BR-REQ-4 |
| D5 | Theoretical bounds and Immune-Brain authority invariants are system bounds, not contradictions; the lens and the gate check target the user's functional trade-offs only. | BR-REQ-5 |
| D6 | `docs/reference/planning-quality-gate.md` Required Checks gains a **false-compromise check** bullet placed directly after **design-option presentation**. It applies only when the gate applies and the Spec records `**Design risk**: Medium` or `High`, before the Spec is finalized. | BR-REQ-6, BR-DEC-2 |
| D7 | The check repeats the ten pattern names inline rather than pointing at `clarify`, because the Planner does not load `dist/clarify.md`. | BR-REQ-2; delegated technical choice: reachability over single-source text, two lines of duplication. |
| D8 | A detected false compromise is presented under the design-option presentation rule with the current trade-off and each resolving pattern as options; the check is advisory and never a Planner decision. The outcome, including `No false compromise detected`, is recorded in the Spec's Technical Design. | BR-REQ-7, BR-DEC-3 |
| D9 | The `draw-up` Planning Quality Gate bullet (`dist/draw-up.md:625`) gains one sentence pointing a Medium/High risk Spec at the advisory false-compromise check in `docs/reference/planning-quality-gate.md`. | E6; delegated technical choice: reference closure required to deliver BR-SCN-2, adds no new behavior beyond BR-REQ-6. |
| D10 | Contract assertions extend `tests/exhaustive-decision-tree-contract.test.ts` and `tests/technical-design-conformance-contract.test.ts`; no new test file. | BR-REQ-8, BR-DEC-4 |
| D11 | Mirrors are regenerated, never hand-edited: `bun scripts/sync-dist-docs.ts` for the dist reference copy and `bun scripts/build-antigravity-plugin.ts` for the three Antigravity copies. | BR-REQ-8, E3, E4 |
| D12 | Ship `.changeset/clarify-inventive-catalyst.md` with `"immune-brain": patch`, following E9. | BR-DEC-4, E9 |

## Technical Design

**Design views**: service/component interfaces only — the change is the instruction interface between three contract documents and their readers (the Brainstorm model, the Planner model). Architecture layers, data flow, state transitions, and temporal sequence are unaffected: no runtime, state, or ordering changes.

| Component | Input → output | Change |
| --- | --- | --- |
| `dist/clarify.md` › Explicit exhaustive interrogation | Exhaustive interrogation request → `brainstorm_framing` with lens results | Seventh lens (D1–D5) |
| `docs/reference/planning-quality-gate.md` › Required Checks | Medium/High Spec under the gate → Technical Design records the check outcome | New bullet (D5–D8) |
| `dist/draw-up.md` › Planning Rules › Planning Quality Gate | Planner reading its contract → reaches the new check | One pointer sentence (D9) |

Intended lens wording (Executor may tighten; required phrases are the acceptance anchors): "… and long-term tech debt and maintenance (…), and inventive catalyst (which trade-off does the design accept as inevitable; propose a pattern from the inlined catalog — Segmentation, Extraction, Preliminary Action, Beforehand Cushioning, Inversion, Dynamics, Blessing in Disguise, Intermediary, Self-Service, Cheap Dispensables, after EGM `agents/inventive_catalyst.md` at `6a8001e` — that removes it, and state each proposed pattern's secondary cost). Theoretical bounds and Immune-Brain authority invariants are system bounds, not contradictions. When no genuine contradiction exists, record `No false compromise detected` instead of inventing a transform."

Intended gate bullet: "- **false-compromise check**: only for a Medium/High risk Spec, before it is finalized, ask which trade-off the design accepts as inevitable and whether a proven pattern — Segmentation, … Cheap Dispensables — removes it; each proposed pattern states its secondary cost. Present a detected false compromise under the design-option presentation rule, with the current trade-off and each resolving pattern as options; the check is advisory and never a Planner decision. Theoretical bounds and Immune-Brain authority invariants are not contradictions. Record the outcome in the Spec's Technical Design, writing `No false compromise detected` when no genuine contradiction exists instead of inventing a transform."

- Errors: a missing phrase, a stale mirror, or the lens leaking into Default clarification fails the contract tests; a stale Antigravity copy fails `build-antigravity-plugin.ts --check`.
- Compatibility: additive text. Existing Specs gain no defect; a Spec authored before this change is not required to record the check.
- Invariants: (I1) the lens appears only in the opt-in section; (I2) the reference and its dist copy are byte-identical; (I3) Antigravity copies match their sources; (I4) the Review prompts carry no false-compromise text.

**False-compromise check (this Spec)**: No false compromise detected. The one apparent trade-off — keeping the catalog single-sourced versus making it reachable from the Planner — is removed by inlining the ten names in both places (D7) at a secondary cost of two duplicated lines guarded by AC1 and AC2.

## Devil's Advocate Audit

- **Rollback resilience**: every change is text in tracked files plus test cases. A partial implementation fails a contract assertion (missing lens phrase, missing gate bullet, missing pointer) or a mirror equality check; reverting the delivering commit restores all contracts with no state to migrate.
- **Verification vanity**: textual presence proves the contracts carry the instruction, not that a model obeys it (draw-up Environment and prerequisite discipline). The acceptances claim only the former, which is why BR-SCN-1 and BR-SCN-2 are tagged `manual`. The negative controls catch the regressions this change can cause: the lens leaking into Default clarification, the "six lenses" phrase surviving, the check reaching Review prompts, and mirror drift.
- **Spec dilution**: every `BR-*` item maps below. D9 adds a pointer the issue's 落点 did not list; it is required to deliver BR-SCN-2, not a scope widening. BR-OUT items are guarded by negative assertions where a file exists to assert against.

## User scenarios

| ID | Scenario | Mapping |
| --- | --- | --- |
| BR-SCN-1 | Actor: user. Given: the user explicitly requests exhaustive interrogation in `clarify`. When: the framing closes. Then: the user sees the inventive catalyst lens reported, either as named catalog patterns each with a secondary cost, or as "No false compromise detected". | manual: the Then is model output in a live session; a contract test observes only the instruction text (AC1). |
| BR-SCN-2 | Actor: user. Given: `draw-up` finalizes a Medium/High risk Spec that triggers the planning quality gate. When: the user opens the Spec. Then: its Technical Design either lists at most three unordered options with mechanism, trade-off, and failure conditions for a detected false compromise, or states "No false compromise detected". | manual: the Then is a model-authored Spec; a contract test observes only the gate bullet and the Planner pointer (AC2). This Spec's own Technical Design is a first instance. |

## Acceptance and verification mapping

| AC | Seam | Done looks like | Controls |
| --- | --- | --- | --- |
| AC1 | `tests/exhaustive-decision-tree-contract.test.ts`, new case over the Explicit exhaustive interrogation section of `plugins/immune-brain/dist/clarify.md` and `plugins/immune-brain-antigravity/dist/clarify.md` | A maintainer opening either clarify contract finds seven lenses ending with inventive catalyst and its catalog. | Positive: the section contains "seven lenses", "inventive catalyst", all ten pattern names, "secondary cost", "No false compromise detected", "authority invariants", and "6a8001e". Negative: neither file contains "six lenses"; the Default clarification section does not contain "inventive catalyst". Bound: the Antigravity copy equals the source byte for byte. |
| AC2 | `tests/technical-design-conformance-contract.test.ts`, new case over `QUALITY_GATE`, its two packaged copies, `PLANNER`, and the Antigravity `draw-up.md` | A maintainer opening the gate finds the false-compromise check after design-option presentation, and the Planner contract points to it. | Positive: the gate contains "**false-compromise check**", "Medium/High risk Spec", "design-option presentation rule", "advisory", "never a Planner decision", "secondary cost", "No false compromise detected", "authority invariants", and all ten pattern names; the check bullet follows the design-option presentation bullet; `PLANNER` contains "false-compromise check" and "docs/reference/planning-quality-gate.md". Negative: `plugins/immune-brain/dist/role-prompts/code-review.md` and `plugins/immune-brain/runtime/prompts/code-review.md` do not contain "false compromise" or "false-compromise". Bound: `plugins/immune-brain/dist/docs/reference/planning-quality-gate.md`, `plugins/immune-brain-antigravity/dist/docs/reference/planning-quality-gate.md`, and `plugins/immune-brain-antigravity/dist/draw-up.md` equal their sources byte for byte. |
| AC3 | Existing mirror and contract tests: `tests/dist-docs-sync-contract.test.ts`, `tests/direct-first-routing-contract.test.ts`, `tests/roadmap-plan-boundary-contract.test.ts`, `tests/brainstorm-decision-probing-contract.test.ts`, `tests/draw-up-kernel-intent-contract.test.ts` | Existing clarify, draw-up, and gate contracts still hold after the edits. | Positive: all pass unchanged. Negative: a stale dist reference copy fails the existing byte-equality assertions (E4). |

Final local checks for the Executor, not acceptance: `bun scripts/sync-dist-docs.ts --check`, `bun scripts/build-antigravity-plugin.ts --check`, `bun test tests/antigravity-host-package.test.ts`.

## Brainstorm Trace

| Item | Mapping |
| --- | --- |
| BR-REQ-1 | D1; AC1 |
| BR-REQ-2 | D2, D7; AC1, AC2 |
| BR-REQ-3 | D3; AC1, AC2 |
| BR-REQ-4 | D4; AC1, AC2 |
| BR-REQ-5 | D5; AC1, AC2 |
| BR-REQ-6 | D6, D9; AC2 |
| BR-REQ-7 | D8; AC2 |
| BR-REQ-8 | D10, D11; AC1, AC2, AC3 |
| BR-DEC-1 | D2; AC1 |
| BR-DEC-2 | D6; AC2 |
| BR-DEC-3 | D8; AC2 |
| BR-DEC-4 | D10, D12; AC1, AC2 |
| BR-OUT-1 | Out: Review prompts unchanged; AC2 negative control. |
| BR-OUT-2 | Out: no `imm-plan` validator field; no runtime or `bin/` path in scope. |
| BR-OUT-3 | Out: Default clarification, `roundtable`, and `adversarial` unchanged; AC1 negative control on Default clarification. |
| BR-OUT-4 | Out: no IFR and no Blocker/Major/Nit severity; the intended wording in Technical Design carries neither. |
| BR-OUT-5 | Out: no subagent dispatch; `dist/clarify.md` Research Dispatch and `dist/registry.yaml` unchanged. |
| BR-SCN-1 | manual; instruction text covered by AC1. |
| BR-SCN-2 | manual; instruction text and Planner reachability covered by AC2. |

## Rollback

Revert the delivering commit. The lens, the gate bullet, the Planner pointer, their mirrors, the test cases, and the changeset disappear together. No runtime or persisted state is involved.
