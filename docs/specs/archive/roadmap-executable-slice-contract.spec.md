# Spec: Roadmap and Executable Slice Contract

**Task ID**: IMM-ROADMAP-001
**Owner**: Planner
**Status**: Proposed
**Date**: 2026-06-03

## 1. Goal

Large Immune-Brain tasks need a durable way to preserve the full discussed
roadmap while keeping the active Plan limited to the current executable slice.
The planner contract should make this distinction explicit so users understand
what will ship now, what remains deferred, and how the deferred roadmap can be
promoted into later Plans without losing information.

## 2. Background

Current guidance already says a Plan is made of independently closable outcome
Steps and may cover a larger capability with fewer outcome units. In practice,
large multi-phase work can still become ambiguous when one document mixes:

- a long-term roadmap;
- the current executable slice;
- deferred design content;
- Brainstorm requirements that are only partially covered by the current Plan.

This creates two failure modes:

1. Readers think the current Plan implements the whole roadmap.
2. Deferred discussion content is compressed into labels like "Phase 2 later",
   which loses the decisions, questions, and promotion path needed for the next
   planning round.

## 3. Requirements

### R1. Roadmap versus executable slice rule

`imm-planner` must describe when a large task should be represented as a
roadmap plus a current executable Plan. The rule should prefer a roadmap when
future phases have unresolved permissions, API, data, UI, governance, or
acceptance details.

### R2. Roadmap information preservation

Roadmap Specs must preserve the full discussion payload needed for future
planning:

- phase map;
- accepted decisions;
- current executable scope;
- deferred phase goals;
- preserved deferred discussion content;
- open questions;
- promotion criteria;
- candidate next Plan;
- explicit non-goals.

### R3. Executable Plan scope banner

Plans sourced from a roadmap must state:

- roadmap source;
- execution scope;
- deferred phases;
- that the Plan is not the full roadmap implementation unless every roadmap
  phase is actually covered by Steps and acceptance criteria.

### R4. Coverage matrix and partial coverage

Planner guidance must require a coverage matrix for large roadmap-backed work.
The matrix must separate compound requirements so partial coverage is visible.
The origin trace layer must support a `partially_covered` status so a Plan can
truthfully record that one Step covers part of a Brainstorm item while another
part remains deferred.

### R5. Acceptance criteria scope discipline

Acceptance criteria in the current executable Plan must prove only the current
slice. Deferred phases may include draft acceptance notes, but those notes must
be labeled as non-executable until a later Plan promotes them.

### R6. Template and test coverage

Planning templates and contract tests must make the new convention durable:

- skill contract tests guard the planner and quality-gate wording;
- plan parser tests guard `partially_covered`;
- the iteration Plan template exposes roadmap source, execution scope, and
  roadmap continuation fields.

## 4. Non-goals

- Do not build a new roadmap runtime or multi-Plan execution engine.
- Do not make every small task use roadmap ceremony.
- Do not force physical file renames for existing Specs or Plans.
- Do not make `imm-work` execute deferred phases automatically.
- Do not replace `covered_by_step`, `deferred`, or `out_of_scope`; add partial
  coverage only for compound requirements.

## 5. Acceptance Criteria

- `plugins/immune-brain/dist/imm-planner.md` defines the roadmap versus
  executable slice rule, coverage matrix, partial coverage handling, and
  current-slice banner.
- `docs/reference/planning-quality-gate.md` includes roadmap information
  preservation and acceptance-scope checks for elevated-risk or multi-phase
  plans.
- `CONTEXT.md` or equivalent user-facing reference explains Roadmap as distinct
  from Plan.
- `.imm/imm_core/plan_runtime.py` accepts `partially_covered` in Brainstorm
  Trace rows and requires a reason for it.
- `tests/test_imm_plan.py` covers valid and invalid `partially_covered` rows.
- `tests/test_skill_contracts.py` covers the new planner contract wording.
- `.imm/templates/iteration-plan-template.md` includes optional roadmap source,
  execution scope, deferred phases, and continuation guidance fields.
- `python3 -m unittest tests.test_imm_plan tests.test_skill_contracts` passes.

## 6. Verification Path

Primary verification:

```bash
python3 -m unittest tests.test_imm_plan tests.test_skill_contracts
python3 .imm/imm-plan.py docs/plans/2026-06-03-001-feat-roadmap-executable-slice-contract-plan.md --json
```

Focused manual review:

- confirm roadmap-backed Plans cannot appear to implement deferred phases
  without explicit Steps and acceptance criteria;
- confirm compound Brainstorm items can be mapped as partial instead of being
  overclaimed as covered.
