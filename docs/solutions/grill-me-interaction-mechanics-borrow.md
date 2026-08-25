---
title: Grill-Me Interaction Mechanics Borrow
reusability: high
key_files:
  - plugins/immune-brain/dist/imm-brainstorm.md
  - plugins/immune-brain/dist/role-prompts/compounder.md
  - plugins/immune-brain/EVALUATION.md
  - tests/brainstorm-decision-probing-contract.test.ts
  - tests/fixtures/imm-brainstorm-behavior-benchmark.json
  - upstreams/mattpocock-skills/skills/productivity/grill-me/SKILL.md
  - docs/specs/2026-07-27-imm-brainstorm-decision-probing.spec.md
  - docs/plans/2026-07-27-001-feat-imm-brainstorm-decision-probing-plan.md
next_reuse_scenarios:
  - Borrowing interaction-discipline patterns from a terse upstream skill without importing the whole skill
  - Hardening framing-stage probes with codebase-first self-resolution
  - Adding recommended-answer + complete-frontier mechanics to Brainstorm
  - Ordering clarification probes when one answer determines whether downstream questions remain relevant
  - Reopening rejected decisions only from recorded evidence-backed conditions
  - Verifying prompt-contract changes with deterministic guards plus bounded model-behavior scenarios
---

## Retirement update

`imm-preplan-review` has been retired. These interaction mechanics now belong to
`imm-brainstorm`: the default mode owns exhaustive current-goal clarification,
and `adversarial` is an explicit analysis lens over the same frontier protocol.
`imm-planner` only supplements a concrete omission, repository conflict, or
invalidated assumption. The sections below preserve the original historical
account and must not be interpreted as current routing authority.

## Pattern: Borrowing terse upstream interaction mechanics into existing skills

**领域**: Agent workflow / framing & grilling interaction discipline / upstream borrow

**描述**: Matt Pocock's `grill-me` skill is a 3-paragraph instruction that condenses four
interaction mechanics: relentless interview, decision-tree walk with dependency resolution,
recommended-answer-per-question, one-question-at-a-time, and codebase-before-human. Immune-Brain
already split the grill surface across `imm-brainstorm` (framing) and `imm-preplan-review`
(opt-in high-pressure gate), but had not absorbed the per-question mechanics. This entry records
the borrow that operationalized two of those mechanics without creating a standalone grill skill
or promoting the preplan gate to a default stage.

## 场景

- An upstream skill is terse but encodes reusable interaction discipline (not executable logic).
- Immune-Brain already has the right skill homes (`imm-brainstorm`, `imm-preplan-review`) but is
  missing the per-question mechanics that make the upstream pattern effective.
- The temptation is to port the whole skill or add a new standalone stage; the right move is to
  strengthen the two existing homes with additive sentences.

## 方案模板

1. **Map mechanics to existing homes, not a new skill.** `grill-me`'s "if a question can be
   answered by exploring the codebase, explore the codebase instead" maps to `imm-brainstorm`'s
   Inline Narrowing Challenge; its "ask one at a time / recommended answer / resolve dependencies
   one-by-one" maps to `imm-preplan-review`'s Relentless Grilling Mode.
2. **Additive single-sentence edits.** Each borrow is one sentence slotted into the existing
   bullet, preserving surrounding voice and the scale-adjusted probe depth (1-2 lightweight,
   3-4 large).
3. **Cover codebase-first broadly.** The self-resolution path lists file inspection, existing
   `docs/solutions/`, and `CONTEXT.md`, so a probe is only surfaced to the user when none of
   those can answer it.
4. **Lock with contract tests, not new test methods.** Extend the nearest existing
   `assertIn`-based test (`test_preplan_review_has_relentless_grilling_mode`,
   `test_brainstorm_has_inline_narrowing_codebase_first`) so the borrow is regression-protected.
5. **Preserve non-goals explicitly.** Do not change probe depth, do not promote preplan to a
   default stage, do not create a new skill. State these as `BR-DEC-*` / `BR-OUT-*` in the
   Brainstorm manifest.

## 验证依据

- `python3 -m unittest tests.test_skill_contracts` runs 169 tests OK after both edits.
- `test_brainstorm_has_inline_narrowing_codebase_first` asserts `codebase cannot answer` and
  `without asking`; `test_preplan_review_has_relentless_grilling_mode` now also asserts
  `Ask one question at a time`, `provide a recommended answer`, and
  `resolving dependencies between decisions one-by-one`.
- Devil's Advocate Audit (in plan) covered rollback resilience (revert 3 files), verification
  vanity (tests fail if text regresses), and spec dilution (no requirement silently narrowed).

## Debate & Evidence Critique

- **Falsifiability**: The lesson would be false if the borrowed sentences changed behavior
  unobservably. Mitigated by contract tests that fail on regression. It would be too local if
  only one skill benefited; the borrow spans two skills, raising reusability.
- **Evidence trail**: spec + plan + two dist diffs + test assertions + green suite. No
  runtime/State-Ledger/MCP surface touched (both skills are read-only declarative instruction
  files), so evidence is text-contract-level, which matches the change class.
- **Architecture entropy resistance**: No new skill or workflow stage added; both edits are
  additive sentences inside existing bullets. The `grill-me -> brainstorm + preplan-review`
  mapping already existed in `mattpocock-skills-contrast.md`; this entry operationalizes it
  rather than introducing a parallel narrative. ADR not warranted: the decision is easily
  reversible and not surprising in context.

## Pattern Update: Decision probing without importing full Grill Mode

The follow-up decision-probing iteration extends the same boundary-first borrow instead of
adding a new skill or copying `grill-me` wholesale:

1. **Order probes by dependency.** After codebase-first self-resolution, ask only the current
   blocking question when its answer determines whether downstream probes remain relevant.
   Independent gaps may still be grouped within the existing 1-2 / 3-4 scale-adjusted budget.
2. **Spend, do not expand, the probe budget.** A concrete scenario is useful only when it
   distinguishes an unresolved behavior, ownership, lifecycle, or scope boundary. It replaces a
   lower-value generic probe and is omitted when the frame is already concrete.
3. **Split rejected-decision ownership.** Compounder may write optional
   `reconsider_if: list<string>` only when closure evidence supports each independently sufficient
   trigger. Brainstorm consumes that metadata: unmet conditions remain constraints, met conditions
   justify reopening, and legacy records without the field keep the codebase-first `what changed?`
   fallback. Brainstorm does not invent either the rejection reason or a restart condition.
4. **Keep high-pressure mechanics in Preplan.** Security, migration, concurrency, audit, and
   cross-boundary consistency still route to `imm-preplan-review`; dependency ordering inside
   Brainstorm is not a second serial Grill Mode.
5. **Separate contract evidence from behavior evidence.** Deterministic tests lock authority,
   budget, metadata compatibility, and scenario selection. A focused isolated model benchmark then
   checks observable responses without modifying the repository. When the host lacks a metric such
   as provider billing cost, record `unavailable_by_host` instead of estimating it.

### Verification Evidence

- `bun test tests/brainstorm-decision-probing-contract.test.ts
  tests/immune-brain-behavior-eval-contract.test.ts`: 10 passed, 0 failed, 71 expectations.
- Five isolated `antigravity/gemini-3.6-flash` fixture scenarios passed: dependent single question,
  independent two-question budget, budget-neutral scenario boundary, clear-frame confirmation, and
  unmet rejected-decision conditions. Children made no repository edits; aggregate host-reported
  metrics were 21 tool uses, about 100.3k tokens, and a roughly 69-second parallel critical path.
- U1-U3 received independent QA passes; the exact-signature `imm-code-review` gate passed after
  Plan validation and `git diff --check` completed cleanly.

### Debate & Evidence Critique Update

- **What the evidence proves:** The deterministic suite proves the packaged text/data contracts.
  The five behavior samples prove only that the named model followed those contracts on the
  committed fixtures; they do not establish cross-model compliance, general prompt quality, or a
  cost/performance advantage.
- **Falsifiability:** The extension is falsified if a dependent case asks downstream questions
  early, a scenario increases the configured probe budget, an unmet rejection condition triggers
  generic re-litigation, or a legacy rejected record stops receiving its compatibility fallback.
- **Alternatives rejected:** A standalone Grill Mode would duplicate Preplan authority. A separate
  provider-substitution Learning would over-generalize one host/model run. A new ADR is unnecessary
  because these declarative prompt contracts are reversible and do not change runtime architecture.

## Architecture Map Sync

No `CONTEXT.md` `## Architecture Map` update needed: the change hardens existing skill
instruction text, adds optional prompt-consumed metadata, and introduces a focused test fixture;
it does not add a navigation surface, runtime path, or ownership boundary.

---
> 沉淀日期: 2026-06-27 | 更新: 2026-07-28 | 来源: grill-me hardening U1/U2 + decision-probing U1-U3 闭环
