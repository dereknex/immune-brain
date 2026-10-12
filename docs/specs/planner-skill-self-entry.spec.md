# Planner and Brainstorm Skill self-entry

**Status**: Candidate; not enrolled.
**Design risk**: High — it relaxes one Host's authority-adjacent gate and changes the entry-credential state machine shared by both Hosts, together with the contract text that describes entry.
**Execution posture**: test-first on the pure admission module and the Claude hook; the existing gate tests are the characterization of today's behaviour.
**Document language**: English, following the Planner document-language default.
**Source**: Direct Planner entry on 2026-10-12 after a grilling session in the same conversation. User-owned decisions are `G1`–`G9`; everything else is repository evidence or a delegated technical choice.
**Relation to earlier work**: partly supersedes the Skill-gate scope of `docs/specs/explicit-phase-entry.spec.md` (its U2 third fix, D4, and the Skill rules of T1). ADR 0019's decision — Enrollment is the first step of a literal-user `imm-run` entry — is unchanged.

## Outcome

On Claude Code, `imm-run` is the only phase Skill the literal user must enter. The model may load `imm-planner` and `imm-brainstorm` itself when the user asks, in natural language, for a Spec, Plan, TaskIntent or requirement clarification. Implementation still starts only from a literal-user `imm-run` entry plus the native Enrollment dialog.

- A model Skill call for `imm-planner` or `imm-brainstorm` is never denied by the phase-entry hook.
- Such a call, made while no Managed claim is active, revokes the session's run entry, so planning something new always needs a fresh `imm-run` entry before Enrollment.
- A model Skill call for `imm-run` is allowed whenever the session's run entry is live, not only in the prompt that recorded it.
- The two Skill descriptions name the request that triggers them instead of requiring an explicit entry.

## User decisions

| ID | Decision | Source |
|---|---|---|
| G1 | The Skill gate is removed for `imm-planner` and `imm-brainstorm`; only `imm-run` stays gated. | User, grilling Q1, 2026-10-12. |
| G2 | The `imm-planner` and `imm-brainstorm` descriptions become request-triggered; `imm-run` and the five standalone Skills keep "explicitly requests". | User, grilling Q2, 2026-10-12. |
| G3 | Trigger breadth is narrow: a natural-language request for a Spec, Plan, TaskIntent or requirement clarification. An ordinary change request does not enter the Planner. Agreed wording: `Use when the user asks for an Immune-Brain Spec, Plan, or TaskIntent for a repository change.` and `Use when the user asks to clarify or explore requirements before Immune-Brain planning.` | User, grilling Q6, 2026-10-12. |
| G4 | A model Skill call for `imm-planner` or `imm-brainstorm` with no active claim revokes the run entry; with an active claim (Enrolled Intent Revision) it does not. | User, grilling Q3, 2026-10-12. |
| G5 | The revocation has no same-prompt exception: `/loop` followed in the same turn by a model Planner entry still revokes. | User, grilling Q7, 2026-10-12. |
| G6 | The `imm-run` Skill gate admits on a live run entry for the session instead of "entry recorded in the latest prompt". | User, grilling Q4, 2026-10-12. |
| G7 | Pi keeps its current behaviour: it cannot observe a model reading a Skill file, so only a literal Planner or Brainstorm entry revokes there. The gap is recorded in the ADR. | User, grilling Q8, 2026-10-12. |
| G8 | A new ADR 0020 records the change and partly supersedes ADR 0019's Skill-gate scope; ADR 0019 and the earlier Spec are not rewritten. | User, grilling Q5, 2026-10-12. |
| G9 | One Managed TaskIntent, one Slice. | User, grilling Q9, 2026-10-12. |

## User scenarios

| ID | Mode | Scenario | Acceptance |
|---|---|---|---|
| SCN-1 | automated | Given a Claude Code session with no slash entry, when the user asks in natural language for a Spec and Plan and the model calls the Skill tool for `imm-planner` (or `imm-brainstorm`), then the call is not denied. | PSE-A2 |
| SCN-2 | automated | Given a session with a live run entry and no active claim, when the model enters `imm-planner` and the user then replies "confirm", then `enroll` is refused with `run_entry_required`. | PSE-A2 |
| SCN-3 | automated | Given a session that entered `imm-run`, when a later prompt says "continue S2" and the model calls the Skill tool for `imm-run`, then the call is not denied. | PSE-A2 |
| SCN-4 | automated | Given a session with no run entry, when the model calls the Skill tool for `imm-run`, then the call is denied with `phase_entry_required`. | PSE-A2 |
| SCN-5 | automated | Given a live run entry and an active claim, when the model enters `imm-planner` for an intent revision, then the run entry stays live. | PSE-A2 |
| SCN-6 | manual | In a real Claude Code session with the updated plugin installed, a natural-language request for a Spec loads the Planner with no hook denial. Manual because it depends on live model Skill selection and on the installed plugin cache, neither of which a unit test observes. | — |

## Decision trace

| ID | Decision | Source |
|---|---|---|
| D1 | The revocation is recorded as an ordinary `{ v: 1, entry: "plan" }` line in the session entry log, the same record a literal Planner entry writes. No new record type. | Delegated technical choice. Evidence: `reducePhaseEntryLog` in `plugins/immune-brain/runtime/assurance/phase_entry.ts` rejects any unknown record as unreadable; a second enabled copy of an older plugin (the case `lane_guard.ts` already tolerates) folds this line to the same revoked state. |
| D2 | When the revocation line cannot be appended, the hook drops the session entry log and still lets the Skill call through. | Delegated technical choice. Evidence: `recordPhaseEntryPrompt` in `runtime/claude/lane_guard.ts` already drops the log on a failed append, and a missing log reads as `NO_PHASE_ENTRY`, so the run entry ends absent. |
| D3 | Admission depends only on `run_live`. State fields that no longer feed a decision (`prompt_seq`, `run_prompt_seq`, `plan_prompt_seq`) are removed with their assertions. | Delegated technical choice following G1 and G6. Evidence: outside `phase_entry.ts` they are read only by `tests/phase-entry.test.ts:97,103`. |
| D4 | An active-claim read that fails counts as no claim, so the call revokes. | Delegated technical choice; the existing hook already treats unreadable authority as no claim (`lane_guard.ts`, `phaseEntryGateHookOutput`). |
| D5 | A literal Planner or Brainstorm entry keeps revoking the run entry on both Hosts, with or without an active claim. | Repository evidence: `applyPrompt` in `phase_entry.ts`; out of the confirmed change. |
| D6 | Contract text keeps the phrases "Ordinary host input stays host-native" and "new Managed workflow starts only from explicit", and adds that for the Planner and Brainstorm a natural-language request for that planning or clarification is such an explicit start, while `imm-run` needs a literal-user entry. | Delegated technical choice realizing G3. Evidence: those phrases are asserted by `tests/baseline-packaging-contract.test.ts:49`, `tests/direct-first-routing-contract.test.ts:27` and `tests/skill-dist-consistency.test.ts:86-87`, and the narrow trigger keeps them true. |
| D7 | Brainstorm still never enters `imm-planner` on its own; the Planner is entered on the user's request, by slash command or in natural language. | Delegated technical choice conserving G3: a bare confirmation of a framing is not a request for a Spec. Evidence: `tests/explicit-phase-entry-planner-contract.test.ts:80-82`. |
| D8 | The gate's reason codes and recovery actions are unchanged; `phase_entry_required` now applies to `imm-run` only. | Repository evidence: `PHASE_ENTRY_RECOVERY` in `phase_entry.ts`, cross-Host equality in `tests/dual-host-assurance-conformance.test.ts`. |

## Out of scope

- The `enroll` and `start_unattended_batch` tool gate, the admission hand-off by tool-use id, and the Pi extension runtime.
- Kernel enrollment, the native dialog, QA, Review and completion authority.
- The descriptions of `imm-run`, `imm-pr-fix`, `imm-retro`, `imm-doc-prune`, `imm-doc-slim` and `imm-test-prune` (G2).
- A Pi approximation of the model-entry revocation (G7).
- `docs/adr/0019-explicit-run-entry-owns-enrollment.md`, `docs/specs/explicit-phase-entry.spec.md` and the frozen fixtures under `tests/fixtures/workflow-decision-closure-sources/`.
- Refreshing an installed Claude plugin cache. It is a user step after release and is named in the handoff.

## Discovery evidence and reference closure

- Admission and state: `plugins/immune-brain/runtime/assurance/phase_entry.ts` (`admitPhaseOperation`, `applyPrompt`, `reducePhaseEntryLog`, `PhaseEntryState`).
- Claude hook: `plugins/immune-brain/runtime/claude/lane_guard.ts` (`phaseEntryGateHookOutput`, `recordPhaseEntryPrompt`, `gatedOperation`), dispatched from `runtime/claude/mcp_server.ts:757`. The Skill branch today only decides; it writes nothing.
- Bundle: `plugins/immune-brain/dist/claude/mcp-server.mjs`, built by `scripts/build-claude-plugin.ts` and checked by `tests/claude-host-package.test.ts`.
- Hook manifest: `plugins/immune-brain/hooks/hooks.json`. The `Skill` matcher stays; only its description sentence changes.
- Descriptions: `plugins/immune-brain/skills/imm-planner/SKILL.md:3`, `skills/imm-brainstorm/SKILL.md:3`, and the packaged frontmatter `dist/imm-planner.md:3`, `dist/imm-brainstorm.md:3`, which `tests/skill-dist-consistency.test.ts:100` requires to be equal. Line 82 of that test requires every description to start with "Use when the user explicitly requests".
- Entry wording: `dist/imm-planner.md` Managed Request Routing ("entered explicitly by the user", "does not invoke this Skill through natural-language routing") and Core Responsibilities "Simplicity"; `skills/imm-planner/SKILL.md:9` and `skills/imm-brainstorm/SKILL.md:9` ("Explicit entry only"); BASELINE "Workflow Activation" in `plugins/immune-brain/BASELINE.md` and its byte-identical copies `skills/BASELINE.md` and `dist/BASELINE.md` (`scripts/dist-sync-manifest.ts`, `tests/dist-docs-sync-contract.test.ts`); `plugins/immune-brain/README.md:32-35`.
- Tests asserting that wording: `tests/direct-first-routing-contract.test.ts:27,62,64`, `tests/baseline-packaging-contract.test.ts:49`, `tests/skill-dist-consistency.test.ts:82-87`, `tests/explicit-phase-entry-planner-contract.test.ts`.
- Gate tests: `tests/phase-entry.test.ts` (pure module), `tests/claude-phase-entry-skill-gate.test.ts` (Skill hook), `tests/claude-phase-entry-gate.test.ts` (tool gate).
- Shared-module consumers that must stay green: `.pi-extension/imm-canary-work.ts:344-345` (`applyPrompt`, `NO_PHASE_ENTRY`), `tests/pi-phase-entry-gate.test.ts`, `tests/dual-host-assurance-conformance.test.ts`.
- Vocabulary: `CONTEXT.md:48` cites ADR 0019 for the Enrollment gate; that sentence stays true and needs no edit.
- Release: a `.changeset/*.md` entry, format as in `.changeset/explicit-phase-entry-s2-claude-gate.md` at commit `ccd7e56`.

## Technical Design

**Design views**: state transitions (the run entry) and service/component interfaces (the Skill hook's decision and its one new write). Temporal sequence, data flow and architecture layers are unchanged from the earlier Spec: the hook, store and tool handler keep their order and ownership.
**Diagram decision**: not_required
**Diagram reason**: the change is two rules on one boolean; the transition table below states them completely.

### Invariants

- I1 (unchanged): no native Enrollment or batch-start dialog opens in a session without a live run entry.
- I2 (revised): only literal user input creates a run entry. Model output, tool results, hook context and extension-injected input never do. A run entry is revoked by a literal Planner or Brainstorm entry or, on Claude Code, by a model Skill call for `imm-planner` or `imm-brainstorm` made with no active claim.
- I3 (unchanged for what is still gated): an unreadable store, a missing hook observation or a missing admission refuses `enroll`, `start_unattended_batch` and the `imm-run` Skill.
- I4 (unchanged): the gate adds no authority.
- I5 (unchanged): batch-internal enrollment and `reuseOnly` continuation do not consult the gate.
- I6 (new): the phase-entry hook never denies a Skill call for `imm-planner` or `imm-brainstorm`, whatever the store state.

### T1. Admission (source: G1, G6, D3)

`admitPhaseOperation`:

- tool `enroll`, `start_unattended_batch`: allowed only when `run_live` (unchanged).
- Skill `imm-run`: allowed only when `run_live`; otherwise `phase_entry_required` with the existing recovery action. A null (unreadable) state refuses.
- Skill `imm-planner`, `imm-brainstorm`: always allowed, including for a null state.

`PhaseEntryState` reduces to the run flag. The log line format and `reducePhaseEntryLog`'s rejection of malformed lines are unchanged.

### T2. Run-entry transitions (source: G4, G5, D1, D5)

| Event | Active claim | Run entry after |
|---|---|---|
| Literal `imm-run` entry | any | live |
| Literal Planner or Brainstorm entry | any | absent |
| Other literal prompt | any | unchanged |
| Model Skill call for `imm-planner` or `imm-brainstorm` (Claude Code) | none, or unreadable | absent |
| Model Skill call for `imm-planner` or `imm-brainstorm` (Claude Code) | active | unchanged |
| Model Skill call for `imm-run` or any other Skill | any | unchanged |

There is no same-prompt exception (G5). Recovery from an absent run entry is always a literal `imm-run` entry.

### T3. Claude Skill hook (source: G4, D2, D4)

In `phaseEntryGateHookOutput`, for a `PreToolUse` Skill payload:

- `imm-run`: deny when T1 refuses; otherwise answer null.
- `imm-planner`, `imm-brainstorm`: when no claim is active, append one plan line to the session entry log through the same private helpers `recordPhaseEntryPrompt` uses; on a failed append drop the log. Answer null in every case.
- Idempotency: the hook may run more than once for one call; a repeated plan line folds to the same state.
- Interruption: the line is written before the Skill loads, so a Skill call the user then declines still leaves the run entry revoked. That errs toward one extra `imm-run` entry and never toward an unrequested Enrollment.

The `hooks.json` description sentence changes from "a phase Skill" to the `imm-run` Skill; matchers are unchanged.

### T4. Contract text and descriptions (source: G2, G3, D6, D7, G8)

- The two descriptions take the wording in G3, identically in the loader and the packaged frontmatter.
- Planner Managed Request Routing, the Planner and Brainstorm loaders and BASELINE Workflow Activation (three copies) state: the Planner and Brainstorm start on the user's request for that planning or clarification, by slash command or in natural language; a request that asks for neither stays host-native; `imm-run` starts only from a literal-user entry; a model-entered Planner outside an enrolled task ends the session's run entry.
- `plugins/immune-brain/README.md` states the same split.
- `docs/adr/0020-*.md` records G1–G7, names the Pi gap (G7) and states that it supersedes only the Skill-gate scope of ADR 0019.

### Alternatives rejected

- Keep the gate and relax it to "plan entry anywhere in the session": still blocks the natural-language request the user wants to work (G1).
- No revocation on model entry: after one `imm-run` entry, a model-planned task could be enrolled on a bare "confirm", the path ADR 0019 closed (G4).
- A same-prompt exception to the revocation: restores "plan and execute in one request" (G5).
- A dedicated revoke record: an older enabled plugin copy would read the whole log as unreadable (D1).
- Request-triggered descriptions for all eight Skills: the standalone Skills delete or rewrite project content (G2).

### Compatibility, interruption, rollback

- Compatibility: a session that planned through a model-entered Planner after an earlier `imm-run` entry now needs a fresh `imm-run` entry. Sessions that never entered `imm-run` see only the removed denial.
- An installed Claude plugin cache keeps the old gate until it is refreshed; the old gate is stricter, so a stale cache fails closed.
- Pi runtime behaviour is unchanged; Pi reads the same two descriptions.
- Rollback: one commit. Reverting restores the stricter gate and the old wording together, so text and gate never disagree.

## Verification and acceptance mapping

| Acceptance | Agreed seam | Controls |
|---|---|---|
| PSE-A1 admission and state on the pure module (T1, T2) | `tests/phase-entry.test.ts` | positive: Planner and Brainstorm Skills admitted for a fresh, a live and a null state; `imm-run` Skill admitted on a live run entry after later prompts. negative: `imm-run` Skill refused with `phase_entry_required` for no entry, a revoked entry and a null state. bound: `enroll` and `start_unattended_batch` rules unchanged; a plan line revokes and a later run line restores; a malformed log line is unreadable. |
| PSE-A2 Claude Skill hook (T3; SCN-1 to SCN-5) | `tests/claude-phase-entry-skill-gate.test.ts`, hook output for `PreToolUse` payloads against a real temporary store | positive: model Planner and Brainstorm calls answer null with no entry; `imm-run` answers null after a run entry and a later plain prompt. negative: after a model Planner or Brainstorm call with no claim, `enroll` is denied with `run_entry_required`; `imm-run` with no entry is denied with `phase_entry_required`. bound: with an active claim the run entry stays live and `enroll` is admitted; a failed revocation append drops the log and `enroll` is denied; a repeated hook run leaves the same state; every other Skill and tool is untouched. |
| PSE-A3 descriptions and contract text (T4) | `tests/skill-dist-consistency.test.ts`, `tests/direct-first-routing-contract.test.ts`, `tests/baseline-packaging-contract.test.ts`, `tests/dist-docs-sync-contract.test.ts`, `tests/explicit-phase-entry-planner-contract.test.ts` | positive: the two descriptions equal the G3 wording in loader and packaged frontmatter; routing text names the natural-language request and the literal `imm-run` entry. negative: the two descriptions no longer start with "Use when the user explicitly requests"; the Planner routing text no longer says natural-language input never invokes it. bound: the six other descriptions still start with it; BASELINE copies stay byte-identical; the Planner still never routes to Enrollment. |
| PSE-A4 packaged bundle and shared-module consumers | `tests/claude-host-package.test.ts`, `tests/claude-phase-entry-gate.test.ts`, `tests/pi-phase-entry-gate.test.ts`, `tests/dual-host-assurance-conformance.test.ts` | positive: the bundle is rebuilt from source and `hooks.json` still routes the Skill and both tools. bound: the tool gate, the Pi gate and cross-Host reason equality pass unchanged. |

Test maintenance: assertions in `tests/claude-phase-entry-skill-gate.test.ts` and `tests/phase-entry.test.ts` that protect the retired rules ("denied unless the latest prompt entered that phase", the prompt-sequence fields) are rewritten to the new rule or removed with the field they protected. No test file is deleted.

## Devil's Advocate Audit

- **Rollback resilience**: a single commit carries gate, text, bundle and tests. A partial implementation that changes the descriptions without the gate leaves model calls denied exactly as today; one that removes the gate without the revocation is the unsafe state, which is why PSE-A2's negative control asserts the `enroll` refusal after a model Planner call rather than the absence of a denial.
- **Verification vanity**: PSE-A2 drives the real hook function against a real store and checks the downstream `enroll` decision, so a revocation that is computed but never written fails. PSE-A3 is text evidence only and proves wording, not model behaviour; live Skill selection is SCN-6, manual, and the stale-cache case is named in the handoff instead of being claimed as verified.
- **Spec dilution**: G1–G9 each map to T1–T4 and to an acceptance. The one place the user's "others can be triggered automatically" is narrower than its literal reading is G2/G3 (two Skills, narrow trigger), and both were chosen by the user in the grilling. G7 leaves Pi without model-entry revocation; it is stated in the ADR and is not counted as delivered.

## Delivery boundary

One TaskIntent, `planner-skill-self-entry`, one Slice. Result when it lands: on Claude Code the model can enter the Planner and Brainstorm on request, doing so outside an enrolled task ends the run entry, and `imm-run` reloads within a live session. Remaining gap: Pi model-entry revocation (G7, accepted) and the manual check SCN-6.
