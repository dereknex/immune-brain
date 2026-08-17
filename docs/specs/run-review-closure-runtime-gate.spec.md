# Spec: Run Review Closure Runtime Gate

**Task ID**: IMM-RUN-002
**Owner**: Planner
**Status**: Proposed

## 1. Goal

Promote the existing `run` completion loop from a contract-only review promise
to a minimal multi-round runtime gate: after `run` advances material changes, it
must not report workflow completion or hand off to `imm-compounder` until every
required review gate has been surfaced and closed, including repeated
review/follow-up rounds.

The immediate failure mode is that a user can finish `run`, then manually run
`imm-code-review`, and still find issues. Most real closures may need more than
one review and repair round. That means the current loop can treat Plan or
`follow_up` execution closure as final closure before code review has had a
chance to block, return same-boundary `follow_up`, and then review the repair
again.

## 2. Background

`docs/specs/run-completion-loop.spec.md` already defines the outer loop:

`imm-autowork -> review -> same-boundary follow_up -> imm-autowork -> review`

That slice deliberately stopped at contract-only guidance. In practice, that is
too weak. The user-facing `run` Skill can say that review is required, but the
machine-readable autowork boundary can still report `finished` or
`follow_up_complete` with `imm-compounder` as the next handoff after material
changes. A host can then mistakenly conclude that the work is complete.

This slice adds a narrow multi-round runtime stop. It does not make `run` an
implementation authority, reviewer, QA authority, generic dispatcher, or
background scheduler.

## 3. Requirements

### R1. Material changes require a review gate before final handoff

- When `imm-autowork` reaches a completion boundary after material code,
  behavior, contract, runtime, or test changes, the run snapshot must stop at a
  review-required boundary with `stop_reason: review_required` instead of
  reporting final completion.
- The next recommended Skill must be `imm-code-review` for material code,
  behavior, contract, runtime, or test changes.
- `run_status` must expose the review gate as machine-readable data, including
  the pending review Skill, `review_changed_files`, and why the gate is
  required.
- The runtime must not mark code review as passed. The review host remains
  responsible for the advisory result.

### R2. UI changes also require the UI review gate

- UI, visual, interaction, accessibility, responsive layout, localization, or
  design-contract changes require `imm-ui-review` before final completion.
- The UI surface is determined from changed paths matching `.css`, `.scss`,
  `.html`, `.tsx`, `.jsx`, paths containing `view`, `component`, `layout`,
  `style`, `theme`, `locale`, `i18n`, or `DESIGN.md`.
- When both code and UI review gates are required, the run snapshot must make
  the pending sequence explicit through `required_review_gates` instead of
  silently picking compounder.

### R3. Same-boundary follow-up re-enters review before completion

- If a review finding becomes same-boundary `follow_up`, `imm-autowork` still
  drives that target through `imm-work`, Executor evidence, and QA closure.
- After the `follow_up` closes, the runtime must re-surface the relevant review
  gate before `imm-compounder` handoff.
- A follow-up closure must not be treated as final workflow closure when its
  changed files require code or UI review.
- The same cycle may happen multiple times:
  `review -> follow_up -> imm-work -> review -> follow_up -> imm-work -> review`.
- `run_status` must make the current review/follow-up round visible enough for a
  host to continue without guessing whether the next boundary is review,
  follow-up execution, replan, blocker, or budget stop.

### R4. Multi-round loop budgets are explicit

- Multi-round repair is expected, but it must remain bounded by explicit review
  round and follow-up round limits.
- The current review round and follow-up round state must be visible to the
  host before it decides whether to continue.
- Hitting a review-round or follow-up-round budget is not success and not
  failure. It is a safe stop with the remaining required review gate and next
  recommended Skill.
- Budget state must be visible in `run_status` so a host can ask the user before
  continuing.

### R5. Stop conditions remain safe and bounded

- A review-required stop is not failure and not QA pass. It is a safe boundary
  that tells the host which reviewer must run next.
- Rework, replan, blocker, malformed `follow_up`, missing credentials, unclear
  verification, repeated same error, and budget stops remain higher-priority
  safe stops.
- If there are no material or UI changes in the current run, the existing
  compounder handoff behavior remains valid.

### R6. No authority expansion

- Do not add planning or execution shell aliases.
- Do not add `imm-autowork-driver`, a generic dispatcher, a background
  scheduler, or runtime default QA pass.
- Do not make `imm-autowork` run advisory review itself.
- Do not change the State Ledger schema for this slice. Any review-gate fields
  added to `run_status` or autowork snapshots must be derived, optional, and
  backwards compatible.

## 4. Acceptance Criteria

- [ ] `imm-autowork` returns a review-required stop instead of
      `finished`/`follow_up_complete` compounder handoff when material changed
      files require `imm-code-review`.
- [ ] UI changed files require `imm-ui-review`, and mixed code/UI changes expose
      an explicit pending review sequence.
- [ ] Completed same-boundary `follow_up` changes re-trigger the relevant review
      gate before compounder handoff.
- [ ] Multiple same-boundary follow-up rounds can repeat the review-required
      boundary without losing the pending review gate, current round counts, or
      budget state.
- [ ] `run_status` includes review status, pending review gate, required review
      gates, review changed files, review/follow-up round state, stop reason,
      and next recommended entry.
- [ ] `plugins/immune-brain/dist/run.md`, `plugins/immune-brain/dist/registry.yaml`,
      and focused contract tests describe the executable review gate, including
      `imm-ui-review` route visibility.
- [ ] Packaged runtime parity remains intact between `.imm/` and
      `plugins/immune-brain/dist/.imm/`.
- [ ] No new `run` shell command, `imm-autowork-driver`, generic dispatcher,
      background scheduler, State Ledger schema migration, or runtime default
      QA pass is introduced.

## 5. Non-goals

- Do not automate the advisory review itself in Python.
- Do not persist a new cross-session review queue.
- Do not make review pass/fail a QA decision.
- Do not replace `imm-code-review` or `imm-ui-review` with activation-plan
  output alone.
- Do not compound automatically from the same runtime stop when a review gate is
  pending.

## 6. Dependencies

- `docs/specs/run-completion-loop.spec.md`
- `docs/specs/autowork-followup-completion.spec.md`
- `docs/specs/review-followup-work-entry-dual-track.spec.md`
- `plugins/immune-brain/dist/run.md`
- `plugins/immune-brain/dist/imm-autowork.md`
- `.imm/imm-autowork.py`
- `plugins/immune-brain/dist/.imm/imm-autowork.py`
- `tests/test_imm_autowork.py`
- `tests/test_skill_contracts.py`
- `docs/solutions/rejected-autowork-driver-default-pass.md`
- `docs/solutions/rejected-shared-registry-generic-dispatcher.md`
