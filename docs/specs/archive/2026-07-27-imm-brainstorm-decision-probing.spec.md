---
title: "Imm-brainstorm decision probing and rejected-decision reconsideration"
type: feat
date: 2026-07-27
---

<!-- markdownlint-disable-next-line MD025 -->
# Spec: Imm-Brainstorm Decision Probing

## Task

Improve `imm-brainstorm` so it asks fewer, higher-value clarification questions, uses concrete scenarios only when they distinguish an unresolved boundary, and reopens previously rejected decisions only when recorded reconsideration conditions justify it. Preserve the existing read-only authority, scale-adjusted probe budget, and optional high-pressure role of `imm-preplan-review`.

**Design risk**: Medium — this changes model-facing behavior across the Brainstorm consumer contract, the Compounder producer contract for durable rejected-decision metadata, and a focused cross-model behavior-evaluation surface. It does not change runtime state, command schemas, or implementation authority.

**Diagram decision**: not_required
**Diagram reason**: The change is governed by a compact decision table and ordered prose rules; there is no runtime sequence, data flow, or state machine that a diagram would clarify.

## Origin

The user requested analysis of improvements derived from upstream `grill-me`, accepted the narrowed recommendations, and explicitly invoked `imm-planner`. The accepted direction rejects direct `CONTEXT.md` writes from Brainstorm and rejects duplicating the full serial Grill Mode already owned by `imm-preplan-review`. During U3 rework, the user explicitly replaced the unavailable Codex/OpenAI GPT-5.6 evaluator with Pi `Agent` execution using `antigravity/gemini-3.6-flash`; this latest instruction is the verification authority.

## Technical Design

### Authority and routing invariants

1. `imm-brainstorm` remains read-only. It may record a confirmed vocabulary decision as `BR-DEC-*`, but `imm-planner` remains the owner that writes a new canonical term to `CONTEXT.md`.
2. Full one-question-at-a-time decision-tree grilling remains in `imm-preplan-review` and remains opt-in for high-risk or audit-heavy work.
3. The existing probe budget remains unchanged: lightweight tasks receive at most 1–2 probes and larger tasks at most 3–4.
4. No new Skill, workflow stage, runtime parser, or route is introduced.

### Probe selection

After the existing codebase-first self-resolution pass, Brainstorm selects probes as follows:

1. Add `scenario gap` as a conditional candidate only when one concrete user or domain scenario can distinguish unresolved behavior, ownership, lifecycle, or scope boundaries.
2. A scenario probe replaces a lower-value probe inside the existing budget; it never increases the number of questions and does not force a scenario when framing is already concrete.
3. When the answer to one unresolved probe would materially change which later probes are relevant, ask only that highest-value blocking question in the current turn.
4. When unresolved probes are independent, they may be surfaced together within the existing scale-adjusted budget.
5. Security, migration, concurrency, cross-boundary consistency, or exhaustive engineering edge-case analysis remains a reason to route to `imm-preplan-review`, not to expand Brainstorm into a second Grill Mode.

### Rejected-decision metadata

`imm-compounder` may add this optional frontmatter to a new or touched rejected Learning when closure evidence supports concrete reconsideration triggers:

```yaml
rejected: true
rejection_reason: "No evidence of repeated dispatch drift."
reconsider_if:
  - "The same drift is evidenced in at least three host implementations."
  - "Host-specific adapters can no longer preserve contract parity."
```

`reconsider_if` is always `list<string>`, including a single condition. Each list item is an independently sufficient trigger (OR semantics). If reconsideration requires multiple facts together, Compounder writes them as one complete condition string. Compounder must not invent a condition: omit `reconsider_if` when closure evidence cannot support one.

### Rejected-decision compatibility matrix

| Record state | Brainstorm behavior |
| --- | --- |
| `reconsider_if` exists and available code/docs evidence satisfies no item | Treat the rejection as a current constraint or non-goal; do not ask the user to re-litigate it. |
| `reconsider_if` exists and evidence satisfies at least one item | Reopen the decision and cite the condition plus evidence that changed. |
| `reconsider_if` exists but a material condition cannot be resolved from available evidence | Ask only the concrete missing fact; do not ask a generic “what changed?” question. |
| `reconsider_if` is absent | Preserve the current backwards-compatible “what has changed?” fallback after codebase-first inspection. |
| `rejection_reason` is absent | Inspect an explicit rejection-reason section in the body; if no reason exists, report the metadata gap without inventing a reason or reconsideration condition. |

Existing rejected Learning files require no migration. Bulk backfill is outside this slice.

### Verification design

1. A focused Bun contract test reads `imm-brainstorm` and `imm-compounder` packaged contracts and guards the producer/consumer rules, compatibility branches, authority boundary, probe budget, and no-invention rule.
2. One benchmark-workspace rejected-decision fixture demonstrates the canonical `reconsider_if: list<string>` shape without backfilling historical docs.
3. A separate focused Brainstorm benchmark config covers dependent probes, independent probes, conditional scenario use, and an unmet reconsideration condition. It does not modify the existing four-scenario plugin baseline.
4. The focused behavior benchmark runs in Pi through five isolated, read-only `Agent` children using `model: antigravity/gemini-3.6-flash`. All five launch in one parallel batch with self-contained prompts that load the packaged `imm-brainstorm` contract and inspect only the benchmark fixture.
5. The parent collects every child before judgment and records scenario pass/fail, final response, narrowing-question count, tool-use count, reported token usage, and duration. Pi Agent does not expose provider billing cost; record `cost: unavailable_by_host` rather than estimating or claiming parity with Plugin Eval.
6. A child that edits files, uses the wrong model, cannot read the fixture/Skill contract, returns malformed output, or misses a success criterion fails its scenario. One bounded retry is allowed only for a tool/transport failure, never to tune the prompt after observing an unfavorable valid result.

## Requirements

1. Dependency-aware ordering asks only the highest-value blocking question when its answer changes downstream probes.
2. Independent probes remain allowed within the existing 1–2 / 3–4 budget.
3. `scenario gap` is conditional, boundary-focused, and budget-neutral.
4. `reconsider_if` uses optional evidence-backed `list<string>` frontmatter with OR semantics.
5. Brainstorm follows the compatibility matrix and never invents rejection reasons or reconsideration conditions.
6. Brainstorm stays read-only, Planner retains `CONTEXT.md` write authority, and Preplan retains full Grill Mode.
7. Static contract tests and a focused behavior benchmark cover the promised behavior at their appropriate evidence levels.

## Non-goals

- Letting `imm-brainstorm` create or update `CONTEXT.md`.
- Adding full serial Grill Mode to `imm-brainstorm` or changing `imm-preplan-review`.
- Increasing probe counts or forcing scenario questions on every task.
- Adding a runtime YAML parser, deterministic rejected-decision scanner, or new metadata schema service.
- Bulk backfilling all existing `rejected: true` documents.
- Changing the existing four-scenario general plugin benchmark.
- Claiming a provider billing cost that Pi Agent does not expose.
- Committing benchmark transcripts or generated reports.

## Compatibility and recovery

- Existing rejected-decision documents remain valid. Missing `reconsider_if` uses the current generic fallback; missing structured reason may use an explicit body section.
- If work stops after the Compounder producer contract is updated, the old Brainstorm consumer continues to function because the field is optional.
- If work stops after the Brainstorm contract and static tests are updated, the focused Pi benchmark can be rerun later without changing repository state.
- A Pi benchmark interruption preserves completed child outputs as execution evidence only after collection; missing children are rerun at most once for tool/transport failure.
- Each implementation step is git-recoverable independently. Reverting the two Skill contract edits and their focused tests/fixtures restores prior behavior; no State Ledger or persisted runtime migration is required.

## Success criteria

1. Focused Bun tests fail if the optional field shape, OR semantics, compatibility matrix, no-invention rule, authority boundary, dependency-aware ordering, conditional scenario rule, or probe budget is removed.
2. Existing `imm-preplan-review` serial Grill Mode and Brainstorm read-only/confirmation routing remain unchanged.
3. The focused Pi benchmark using `antigravity/gemini-3.6-flash` shows: one blocking question for dependent probes; independent questions stay within budget; a scenario probe replaces rather than adds a question; a clear frame does not force a scenario; and an unmet `reconsider_if` condition is treated as a constraint without re-litigation.
4. Every scenario records final output, question count, tool uses, reported tokens, duration, and explicit `cost: unavailable_by_host`; all five children remain read-only and use the requested model.
5. Existing rejected Learning files require no migration and no runtime parser is introduced.
6. Plan validation, focused tests, and `git diff --check` pass; no benchmark transcript or generated report is committed.
