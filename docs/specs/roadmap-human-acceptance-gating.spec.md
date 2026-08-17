# Spec: Roadmap Human Acceptance Gating

**Task ID**: IMM-ROADMAP-ACCEPT-001
**Owner**: Planner
**Status**: Proposed
**Date**: 2026-06-27

## 1. Goal

When `imm-planner` creates a multi-phase Roadmap, each phase must carry
structured **acceptance criteria** that a developer can verify without reading
implementation code. The acceptance criteria describe observable behavior
("the export button produces a CSV with all visible columns"), not internal
signals ("unit tests pass"). This makes roadmap phases **human-gated**:
a developer can judge phase completion from the criteria alone.

## 2. Background

The Roadmap / Executable Slice contract (IMM-ROADMAP-001, 2026-06-03) already
defines:

- Roadmap separation from executable Plan;
- deferred phase information preservation (goals, decisions, open questions,
  promotion criteria, candidate next Plans);
- acceptance scope discipline (current Plan acceptance proves only the
  executable slice; deferred phases carry draft acceptance notes labeled
  non-executable).

What is **missing** is a formal structure for phase-level acceptance criteria
that is:

1. **Human-verifiable**: a developer can independently confirm the criteria
   without reading implementation code.
2. **Structured**: each phase carries acceptance criteria in a predictable
   format, not free-form prose.
3. **Validatable**: tooling (`imm-plan.py`) can detect missing or malformed
   criteria.
4. **Preserved on promotion**: when a deferred phase is promoted to an
   executable Plan, its acceptance criteria survive and are converted to
   Plan-level executable acceptance criteria.

## 3. Requirements

### R1. Per-Phase Acceptance Criteria Structure

Each Roadmap phase must carry an `acceptance_criteria` field containing one or
more behavior assertions. Each assertion describes **observable behavior** from
a developer's perspective.

Acceptable forms (non-exhaustive):

- `用户可以<动作>并<可观测结果>` (user-facing behavior assertion)
- `当<条件>时，系统应<行为>` (conditional behavior assertion)
- `运行<命令>后，输出包含<预期内容>` (command-verifiable assertion)
- `The <artifact> must <behavior>` (artifact behavior assertion)

Unacceptable (non-behavior) forms that validation should flag:

- `测试通过` / `tests pass` (internal signal, not observable behavior)
- `代码审查通过` / `code review passes` (process signal)
- `所有步骤完成` / `all steps complete` (tautology)

### R2. Acceptance Criteria vs Promotion Criteria Independence

`acceptance_criteria` and `promotion_criteria` are **independent but related**:

- `acceptance_criteria`: "Is this phase done?" — developer-verifiable behavior
  assertions.
- `promotion_criteria`: "Can we start the next phase?" — may include external
  dependencies (API availability, environment readiness, stakeholder approval)
  that go beyond behavior verification.

A phase's `promotion_criteria` **may** include "all acceptance_criteria passed
human review" but is not limited to it.

### R3. Planner Must Produce Acceptance Criteria

When `imm-planner` creates a multi-phase Roadmap (3+ phases), the planner
contract must require per-phase `acceptance_criteria`. Single-phase work and
2-phase splits may omit them.

### R4. Validation: L1 Error, L2 Warning

`imm-plan.py --json` validates Roadmap phases at two levels:

- **L1 (error)**: Each Roadmap phase declared in the Spec **must** have a
  non-empty `acceptance_criteria` field. Missing or empty → validation error.
- **L2 (warning)**: Each criteria entry is pattern-matched against known
  behavioral prefixes. Entries matching known non-behavioral patterns
  ("tests pass", "code review passes") → warning. Entries with no recognizable
  prefix → no warning (ambiguous prose is not machine-judgeable).

L2 is advisory only; it does not block validation.

### R5. Dual-Track Verification Model

Acceptance criteria may use two verification modes:

- **Observable** (`verification_mode: observable`): A developer visually or
  interactively confirms the behavior (e.g., "the settings page shows a dark
  mode toggle").
- **Verifiable** (`verification_mode: verifiable`): A developer runs a named
  command and inspects output (e.g., "`python3 -m pytest tests/test_export.py`
  passes with 0 failures").

Both modes satisfy "human-verifiable" because the verification is still a
human judgment call on observable output. The mode annotation is optional;
omission defaults to `observable`.

### R6. Acceptance Criteria Survive Phase Promotion

When a deferred Roadmap phase is promoted to an executable Plan, its
`acceptance_criteria` must be **preserved** and converted to Plan-level
executable acceptance criteria. The planner contract must define this
promotion mapping.

### R7. Document Convention (No Runtime Integration)

Human signoff on acceptance criteria uses **document convention only**:
developers confirm phase completion through external channels (PR comment,
chat, face-to-face). No new State Ledger status, workflow gate, or MCP tool
is added for human acceptance tracking.

## 4. Non-Goals

- Do not add runtime workflow states (`awaiting_human_acceptance`,
  `human_accepted`) to the State Ledger.
- Do not add a new MCP tool for human acceptance signoff.
- Do not change `imm-work` or `imm-autowork` behavior.
- Do not enforce acceptance criteria on single-phase or 2-phase work.
- Do not add LLM-based semantic validation (L3); only structure-level
  validation (L1/L2).
- Do not change the existing `promotion_criteria` field semantics beyond
  clarifying its independence from `acceptance_criteria`.

## 5. Four-Phase Roadmap

### Phase 1: Define Acceptance Criteria Contract

**Goal**: Formal structure for phase-level acceptance criteria is defined,
concept relationships are clarified, and at least one example Roadmap
validates the format.

**acceptance_criteria**:
- Spec document exists at `docs/specs/roadmap-human-acceptance-gating.spec.md`
  and clearly defines `acceptance_criteria` format, relationship to
  `promotion_criteria`, L1/L2 validation boundaries, and dual-track
  verification modes
- `CONTEXT.md` includes `acceptance_criteria` and `promotion_criteria` as
  canonical terms with distinct definitions
- At least one example Roadmap document (in `docs/brainstorms/`) uses the
  new format with 2+ phases, each carrying structured `acceptance_criteria`
- A developer can read the Spec and example Roadmap and independently judge
  whether the format is clear, fillable, and verifiable

**promotion_criteria**:
- Spec passes human review (format clarity, concept correctness)
- Example Roadmap passes human review (format usability confirmed)
- Phase 2 Planner integration scope is stable (no new unknowns block it)

**deferred**:
- Exact template file line numbers to modify (deferred to Phase 2 discovery)
- Whether L2 pattern matching regex should be configurable (deferred to Phase 3)

---

### Phase 2: Integrate Planner Output

**Goal**: `imm-planner` produces Roadmaps with structured `acceptance_criteria`
per phase. Planning quality gate includes acceptance criteria completeness
check. Plan template gains phase acceptance criteria field.

**acceptance_criteria**:
- `imm-planner` skill contract (source `skills/imm-planner/SKILL.md` and
  dist `plugins/immune-brain/dist/imm-planner.md`) includes a rule requiring
  per-phase `acceptance_criteria` for multi-phase Roadmaps
- `docs/reference/planning-quality-gate.md` includes a checklist item:
  "acceptance criteria completeness — each Roadmap phase carries non-empty
  structured acceptance criteria"
- `.imm/templates/iteration-plan-template.md` includes an optional
  `acceptance_criteria` field in the deferred phase section
- Contract tests in `tests/test_skill_contracts.py` assert the planner
  acceptance criteria rule
- Running `python3 -m unittest tests.test_skill_contracts` passes

**promotion_criteria**:
- Planner produces acceptance criteria for a sample multi-phase task
- Contract tests pass
- Human confirms acceptance criteria in sample output are behavior assertions,
  not internal signals

**deferred**:
- Whether the planner should auto-suggest acceptance criteria or only enforce
  the field (deferred to Phase 2 discovery)

---

### Phase 3: Validate Acceptance Completeness

**Goal**: `imm-plan.py --json` validates Roadmap phases for acceptance criteria
completeness. L1 errors on missing/empty criteria; L2 warnings on recognizable
non-behavioral patterns.

**acceptance_criteria**:
- `imm-plan.py --json` on a Spec containing a Roadmap reports:
  - L1 error for each phase missing a non-empty `acceptance_criteria` field
  - L2 warning for each criteria entry matching known non-behavioral patterns
    ("tests pass", "code review passes", "all steps complete")
  - No false positives on well-formed behavioral criteria
- `.imm/imm_core/plan_runtime.py` contains the L1/L2 validation logic
- `tests/test_imm_plan.py` includes test methods covering:
  - Phase with valid acceptance criteria → no error/warning
  - Phase missing acceptance criteria → L1 error
  - Phase with empty acceptance criteria → L1 error
  - Phase with non-behavioral criteria → L2 warning
  - Phase with mixed valid/invalid criteria → correct per-entry L2 behavior
- `tests/test_skill_contracts.py` includes a contract test locking the
  validation behavior
- Plugin dist parity test covers the updated `plan_runtime.py`

**promotion_criteria**:
- All tests pass: `python3 -m unittest tests.test_imm_plan tests.test_skill_contracts`
- Human runs `imm-plan --json` against a Roadmap with missing criteria →
  sees L1 error
- Human runs `imm-plan --json` against a Roadmap with non-behavioral criteria →
  sees L2 warning
- Human runs `imm-plan --json` against a well-formed Roadmap → no noise

**deferred**:
- Whether L2 patterns should be configurable per project (deferred to
  post-Phase 3 discussion)

---

### Phase 4: Preserve Acceptance on Phase Promotion

**Goal**: When a deferred Roadmap phase is promoted to an executable Plan, its
`acceptance_criteria` are preserved and converted to Plan-level executable
acceptance criteria. Planner contract defines the promotion mapping.

**acceptance_criteria**:
- `imm-planner` skill contract (source + dist) defines the promotion rule:
  "When a deferred phase is promoted to an executable Plan, copy its
  `acceptance_criteria` into the Plan's acceptance criteria section. Prefix
  each with the original phase name for traceability. The criteria are now
  executable — they must be proven by the Plan's Steps."
- `.imm/templates/iteration-plan-template.md` includes a
  `promoted_acceptance_criteria` field or annotation in the acceptance section
- Contract tests in `tests/test_skill_contracts.py` assert the promotion
  preservation rule
- A developer promotes a sample deferred phase → confirms all acceptance
  criteria appear in the new Plan and are correctly prefixed

**promotion_criteria**:
- Contract tests pass
- Human verifies a sample promotion preserves all acceptance criteria
- Pattern extracted by `imm-compounder` into `docs/solutions/`

**deferred**:
- Whether `imm-plan.py` should auto-detect promotion and validate criteria
  preservation (deferred — may become a follow-up Plan)

---

## 6. Acceptance Criteria (Overall Feature)

- `docs/specs/roadmap-human-acceptance-gating.spec.md` defines the full
  contract including the 4-phase roadmap
- Phase 1 has a validated executable Plan under `docs/plans/`
- Each subsequent Phase has its own executable Plan when promoted from
  deferred status
- `imm-planner` produces Roadmaps with structured per-phase
  `acceptance_criteria`
- `imm-plan.py --json` validates acceptance criteria completeness (L1/L2)
- Deferred phase promotion preserves acceptance criteria
- No runtime/State Ledger/MCP surface changes were introduced
- All contract tests pass

## 7. Verification Path

Phase 1 verification:

```bash
# Human review: read Spec + example Roadmap, confirm format is clear and usable
```

Phase 2 verification:

```bash
python3 -m unittest tests.test_skill_contracts
```

Phase 3 verification:

```bash
python3 -m unittest tests.test_imm_plan tests.test_skill_contracts
python3 .imm/imm-plan.py <roadmap-spec> --json
```

Phase 4 verification:

```bash
python3 -m unittest tests.test_skill_contracts
# Human: promote a deferred phase, check acceptance criteria survive
```
