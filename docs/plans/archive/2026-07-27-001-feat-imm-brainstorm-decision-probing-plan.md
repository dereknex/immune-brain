---
title: "feat: harden imm-brainstorm decision probing"
type: feat
status: proposed
date: 2026-07-27
origin: user-confirmed follow-up to upstream grill-me comparison and imm-brainstorm improvement analysis
spec: docs/specs/2026-07-27-imm-brainstorm-decision-probing.spec.md
---

# Iteration Plan

## Task

- Summary: Improve `imm-brainstorm` with dependency-aware question ordering, conditional budget-neutral scenario probes, and evidence-backed reconsideration of rejected decisions, while preserving Brainstorm read-only authority and Preplan ownership of full Grill Mode.
- Spec: `docs/specs/2026-07-27-imm-brainstorm-decision-probing.spec.md`
- Origin: The user accepted the narrowed recommendations from the `grill-me` comparison and invoked `imm-planner`. This is a follow-up to `docs/specs/grill-me-brainstorm-preplan-harden.spec.md`, not a replacement for its codebase-first and Preplan serial-question decisions.
- Brainstorm manifest: BR-REQ-001; BR-REQ-002; BR-REQ-003; BR-REQ-004; BR-DEC-001; BR-DEC-002; BR-DEC-003; BR-OUT-001; BR-OUT-002; BR-OUT-003
- Scope Mode: Selective Expansion. Add only the producer metadata needed for rejected-decision reconsideration, the consumer prompt rules, focused deterministic contracts, and a separate Pi behavior benchmark.
- Planner research dispatch: two readonly advisory probes under host-authorized `auto` policy. One reviewed Brainstorm interaction/evaluation boundaries; one reviewed rejected-decision metadata compatibility. No child wrote files or owned Plan decisions.

## Output Language

- Human-readable Spec and Plan prose: English.
- User-facing replies: Chinese per project instructions.
- Preserved literals: `Brainstorm`, `Plan`, `Spec`, `Step`, `Compounder`, `Preplan`, `CONTEXT.md`, `reconsider_if`, `rejection_reason`, `BR-*`, file paths, commands, JSON keys, and code identifiers.

## Research

- `plugins/immune-brain/dist/imm-brainstorm.md` already enforces codebase-first self-resolution, a 1–2 / 3–4 probe budget, read-only framing, confirmation-before-planner, and a generic rejected-decision “what changed?” fallback.
- `plugins/immune-brain/dist/imm-preplan-review.md` already owns full serial one-question-at-a-time Grill Mode with a recommended answer. Duplicating it in Brainstorm would blur routing and increase ordinary-task latency.
- `plugins/immune-brain/dist/imm-planner.md` owns new canonical `CONTEXT.md` terms and has explicit root-file write authority; Brainstorm should hand off vocabulary as `BR-DEC-*` rather than write it.
- `plugins/immune-brain/dist/imm-compounder.md` records `rejected: true` and `rejection_reason` but has no reconsideration-trigger contract. Existing rejected Learning files vary: some have structured reasons, some only body text, and some lack both.
- No runtime parser currently consumes rejected-decision frontmatter. A prompt-level optional field is sufficient and avoids a schema/parser expansion.
- Advisory agreement: use `reconsider_if: list<string>` with independently sufficient items; preserve missing-field fallback; do not bulk backfill; do not modify the existing four-scenario benchmark because it does not exercise Brainstorm narrowing.
- `plugins/immune-brain/EVALUATION.md` requires prompt behavior changes to be measured against unnecessary questions, tool loops, input tokens, latency, and cost availability. Static text assertions cannot prove model compliance, so revised U3 runs a separate focused Pi Agent benchmark.

## Decisions

- D1: Keep Brainstorm read-only. Confirmed terminology travels as `BR-DEC-*`; Planner remains the `CONTEXT.md` writer.
- D2: Keep full serial decision-tree grilling exclusively in opt-in `imm-preplan-review`.
- D3: Add dependency-aware ordering only when one answer changes downstream questions; independent gaps may still be batched inside the existing budget.
- D4: Add `scenario gap` only for behavior, ownership, lifecycle, or scope ambiguity; it replaces a lower-value probe and never raises the probe count.
- D5: Standardize optional `reconsider_if` as YAML `list<string>` with OR semantics. Compound conditions are one string; string/list dual shape is forbidden.
- D6: Compounder writes `reconsider_if` only from closure evidence. Brainstorm consumes it through the Spec compatibility matrix and never invents a reason or trigger.
- D7: Preserve all legacy rejected Learning files without migration or a runtime parser. Bulk backfill is a separate evidence-driven cleanup, not part of this feature.
- D8: Keep deterministic contract tests and model behavior evidence separate. Run the focused benchmark through Pi `Agent` with `antigravity/gemini-3.6-flash` rather than changing the existing four-scenario baseline.

## Assumptions

- `plugins/immune-brain/dist/*.md` is the active detailed packaged Skill contract surface; the compact `skills/*/SKILL.md` entries need no change because they only load the dist contract and their authority summary remains accurate.
- Pi can launch `general-purpose` Agent children with the exact model override `antigravity/gemini-3.6-flash`, isolated worktrees, and self-contained prompts.
- Pi Agent completion metadata exposes duration, tool-use count, and reported token usage. Provider billing cost is not exposed and must be recorded as `unavailable_by_host`.
- The user's latest instruction explicitly authorizes this Pi/model substitution and supersedes the earlier Codex/OpenAI paid-run gate.

## Brainstorm Manifest

| ID | Item |
| --- | --- |
| BR-REQ-001 | Ask only the highest-value blocking question when its answer changes downstream probes. |
| BR-REQ-002 | Add a conditional concrete scenario probe that replaces a lower-value probe without increasing the existing budget. |
| BR-REQ-003 | Reconsider rejected decisions through optional evidence-backed conditions with precise compatibility fallbacks. |
| BR-REQ-004 | Verify both static contract preservation and actual model behavior, including unnecessary-question, tool-use, token, latency, and cost-availability signals. |
| BR-DEC-001 | Brainstorm remains read-only; Planner owns `CONTEXT.md` writes. |
| BR-DEC-002 | Full serial Grill Mode remains in opt-in `imm-preplan-review`. |
| BR-DEC-003 | Existing 1–2 / 3–4 probe limits and workflow routing remain unchanged. |
| BR-OUT-001 | No direct `CONTEXT.md` update from Brainstorm. |
| BR-OUT-002 | No new Skill, duplicate Grill Mode, or default Preplan stage. |
| BR-OUT-003 | No runtime parser or bulk backfill of historical rejected Learning files. |

## Brainstorm Trace

| Item | Status | Target | Reason |
| --- | --- | --- | --- |
| BR-REQ-001 | covered_by_step | U2 | U2 adds dependent-probe ordering and focused static/model scenarios. |
| BR-REQ-002 | covered_by_step | U2 | U2 adds conditional budget-neutral `scenario gap` behavior and tests. |
| BR-REQ-003 | covered_by_step | U1, U2 | U1 defines evidence-backed producer metadata; U2 defines the consumer compatibility matrix. |
| BR-REQ-004 | covered_by_step | U1, U2, U3 | U1/U2 provide deterministic regression guards; revised U3 records Pi Agent scenario evidence and host-available metrics. |
| BR-DEC-001 | captured_as_decision | D1 | The Spec authority invariant and U2 test preserve Planner-owned `CONTEXT.md` writes. |
| BR-DEC-002 | captured_as_decision | D2 | `imm-preplan-review` remains unchanged and retains full Grill Mode. |
| BR-DEC-003 | captured_as_decision | D3, D4 | Probe counts and routing are preserved while selection quality changes. |
| BR-OUT-001 | out_of_scope | D1 | Direct Brainstorm writes would violate the current role boundary. |
| BR-OUT-002 | out_of_scope | D2 | Existing Preplan behavior already owns this interaction mode. |
| BR-OUT-003 | out_of_scope | D7 | Optional metadata and backwards-compatible fallback make migration/parser work unnecessary. |

## Devil's Advocate Audit

- Rollback resilience: U1 and U2 are additive declarative contracts plus focused tests/fixtures. Reverting U2 leaves the optional producer field harmless to the old consumer; reverting U1 and U2 restores the prior generic fallback. Revised U3 uses isolated read-only Pi children and writes only State Ledger evidence; interruption cannot mutate the parent workspace.
- Verification vanity: Text assertions can fail when clauses disappear but cannot prove model behavior. U3 therefore exercises dependent, independent, scenario, clear-frame, and rejected-decision cases with `antigravity/gemini-3.6-flash`. The parent must collect all five outputs and record scenario outcome, question count, tool uses, reported tokens, duration, and explicit cost availability; a green Bun suite alone cannot close U3.
- Spec dilution detection: The Plan preserves all accepted improvements while explicitly excluding direct `CONTEXT.md` writes, duplicate Grill Mode, probe-count expansion, runtime parsing, and bulk backfill. Each `BR-*` item maps to a decision or executable Step; no open `BR-Q-*` remains.

## Planning Quality Gate

- contract surface: `plugins/immune-brain/dist/imm-brainstorm.md`, `plugins/immune-brain/dist/imm-compounder.md`, focused Bun tests, one benchmark-workspace rejected-decision fixture, one focused Brainstorm benchmark config, and `plugins/immune-brain/EVALUATION.md` benchmark guidance if a new command must be documented.
- compatibility: Existing Skill routing, probe budgets, `CONTEXT.md` ownership, Preplan behavior, rejected Learning files, State Ledger schema, and the four-scenario general benchmark remain compatible. Missing metadata uses explicit fallbacks.
- interruption recovery: U1 and U2 remain closed. U3 launches all five Pi children in one batch; completed outputs are collected before judgment, and only a tool/transport-failed child may receive one bounded retry.
- rollback path: Revert U1's Compounder/test/fixture changes or U2's Brainstorm changes independently. Revised U3 has no parent-workspace implementation edit beyond benchmark contract alignment and State Ledger evidence.
- verification strength: Bun tests guard deterministic text/data contracts; five isolated Pi Agent scenarios guard model behavior. Plan validation and `git diff --check` guard artifact structure.
- design-depth classification: Medium because two Skill contracts form a producer/consumer behavior pair and compatibility matters, but no runtime schema, security surface, or persisted-state migration changes.
- Technical Design baseline: `docs/specs/2026-07-27-imm-brainstorm-decision-probing.spec.md` is the single authority for selection order, metadata shape, compatibility behavior, and evaluation boundaries. Steps reference D1–D8 and the Spec rather than redefining them.
- Mermaid intent: not required; the Spec decision table is the clearest representation.
- Design Conformance: Final QA must compare the implementation with the Spec authority/routing invariants, probe-selection rules, metadata shape, and compatibility matrix. Structural deviation routes to replan.
- Brainstorm traceability: all ten declared `BR-*` items are mapped above; there are no unresolved questions.

## Steps

### Step 1

- Step ID: U1
- Result: Compounder-produced rejected-decision Learnings support an optional evidence-backed reconsider_if list with backwards-compatible legacy records
- Verification type: automated
- Verification: `bun test tests/brainstorm-decision-probing-contract.test.ts && git diff --check`
- Test scenarios: Covers `reconsider_if` documented as `list<string>` even for one item; Covers list items having OR semantics and compound prerequisites staying in one string; Covers Compounder omitting unsupported triggers instead of inventing them; Covers a canonical rejected-decision fixture with structured reason and reconsideration conditions; Covers no requirement to migrate existing rejected Learning files.
- Discovery cache: plugins/immune-brain/dist/imm-compounder.md (rejected Learning producer contract); docs/solutions/rejected-pro-workflow-sqlite-wiki-authority.md (structured rejection sample); docs/solutions/rejected-post-closure-ledger-rewrite.md (missing structured reason compatibility sample); docs/solutions/rejected-origin-coverage-authority-expansion.md (legacy rejected frontmatter sample)
- Scope: `plugins/immune-brain/dist/imm-compounder.md`, new `tests/brainstorm-decision-probing-contract.test.ts`, and one small rejected-decision fixture under `tests/fixtures/immune-brain-benchmark-workspace/docs/solutions/`.
- Agent Hint: imm-executor
- Depends on: none
- Applicable design: Spec `Rejected-decision metadata`; D5–D7.
- failure_behavior: If a deterministic consumer already requires another field shape, stop and replan compatibility rather than adding string/list dual parsing. If no evidence-backed reconsideration condition exists for the fixture, use a synthetic benchmark fixture, not a rewritten historical Learning.
- security_considerations: Fixture conditions must use repository-relative, non-sensitive examples and must not include local paths or private conversation evidence.

### Step 2

- Step ID: U2
- Result: Brainstorm decision probing conforms to the Spec selection policy within existing authority/routing/probe-budget invariants
- Verification type: automated
- Verification: `bun test tests/brainstorm-decision-probing-contract.test.ts tests/immune-brain-behavior-eval-contract.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-27-001-feat-imm-brainstorm-decision-probing-plan.md --json && git diff --check`
- Test scenarios: Covers dependent gaps yielding only the highest-value blocker in the current turn; Covers independent gaps remaining batchable within 1–2 / 3–4 limits; Covers a concrete scenario replacing a lower-value probe only for behavior/ownership/lifecycle/scope ambiguity; Covers a clear frame not forcing a scenario; Covers every rejected-decision compatibility branch and no invented reason/condition; Covers Brainstorm read-only and Planner/Preplan authority clauses remaining intact; Covers the focused benchmark config being separate from the unchanged four-scenario baseline.
- Discovery cache: plugins/immune-brain/dist/imm-brainstorm.md (consumer and probe-selection contract); plugins/immune-brain/dist/imm-preplan-review.md (unchanged full Grill Mode boundary); plugins/immune-brain/EVALUATION.md (behavior metrics and one-group migration policy); tests/immune-brain-behavior-eval-contract.test.ts (benchmark config contract); tests/fixtures/immune-brain-benchmark.json (unchanged general baseline)
- Scope: `plugins/immune-brain/dist/imm-brainstorm.md`, `tests/brainstorm-decision-probing-contract.test.ts`, new `tests/fixtures/imm-brainstorm-behavior-benchmark.json`, and only the minimum benchmark guidance/fixture adjustments needed to make the focused config portable. Do not modify `imm-preplan-review` or the existing general benchmark scenarios.
- Agent Hint: imm-executor
- Depends on: 1
- Applicable design: Spec `Authority and routing invariants`, `Probe selection`, and `Rejected-decision compatibility matrix`; D1–D4, D6–D8.
- failure_behavior: If the new wording requires raising the probe budget, forcing scenarios, writing `CONTEXT.md`, or duplicating Preplan Grill Mode to satisfy tests, stop and replan instead of weakening the invariants. If the benchmark cannot stay separate and portable, keep the deterministic contract changes but return to Planner before altering the general baseline.
- security_considerations: Benchmark prompts and fixtures must contain only synthetic repository data. Do not embed user conversation history, credentials, or absolute local paths in committed fixtures.

### Step 3

- Step ID: U3
- Result: Pi Gemini evidence validates the Brainstorm decision-probing policy against scope/authority invariants
- Verification type: hitl
- Verification: Launch the five scenarios from `tests/fixtures/imm-brainstorm-behavior-benchmark.json` in one Pi parallel `Agent` batch using `subagent_type: general-purpose`, `model: antigravity/gemini-3.6-flash`, `isolation: worktree`, `isolated: true`, and self-contained prompts that load `plugins/immune-brain/skills/imm-brainstorm/SKILL.md` plus `plugins/immune-brain/dist/imm-brainstorm.md`. Collect all children, evaluate each final response against its `successChecklist`, verify no child edits, and record per-scenario output, question count, tool uses, reported tokens, duration, plus `cost: unavailable_by_host`.
- Test scenarios: Covers one blocking question for dependent probes; Covers independent probes staying within budget; Covers a scenario probe replacing rather than adding a question and no forced scenario for a clear frame; Covers an unmet `reconsider_if` condition becoming a constraint without generic re-litigation; Covers no repository writes, Planner route, or Preplan route before the relevant confirmation/risk gate.
- Discovery cache: tests/fixtures/imm-brainstorm-behavior-benchmark.json (five Pi scenarios and success checklists); plugins/immune-brain/EVALUATION.md (available metrics and cost fallback); plugins/immune-brain/dist/imm-brainstorm.md (evaluated policy); Agent completion metadata (duration, tool uses, reported tokens)
- Scope: Read-only Pi evaluation plus benchmark contract alignment in `tests/fixtures/imm-brainstorm-behavior-benchmark.json`, `tests/brainstorm-decision-probing-contract.test.ts`, `plugins/immune-brain/EVALUATION.md`, this Plan, and its Spec. U1/U2 behavior implementation remains unchanged.
- Agent Hint: imm-executor
- Depends on: 2
- Applicable design: Spec `Verification design`; D8.
- failure_behavior: A valid unfavorable scenario result fails U3 and returns to Planner without prompt tuning. Retry at most once only when a child has a tool/transport failure, wrong model, stale identity, or malformed output. Missing billing data is recorded as `unavailable_by_host`, not treated as a scenario failure or estimated.
- security_considerations: Children receive only synthetic fixture data and repository Skill contracts. Do not include user conversation history, credentials, provider metadata, or private paths in child prompts; do not commit child transcripts.

## Validation

- Plan validator: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-27-001-feat-imm-brainstorm-decision-probing-plan.md --json`
- Runtime sync: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-27-001-feat-imm-brainstorm-decision-probing-plan.md --sync`

## Next Action

- Gate: Revised Plan passes `imm-plan --json` without warnings and `--sync` preserves U1/U2 as closed while reactivating only U3.
- If gates pass: resume `imm-loop` at U3 and run the authorized Pi `antigravity/gemini-3.6-flash` benchmark.
