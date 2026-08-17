---
name: imm-qa
description: Use when closing steps.
---

# Immune-Brain: QA

This skill adheres to the **[BASELINE.md](BASELINE.md)**.

## Workflow Profiles

Dispatch QA only when the checkpoint reports `awaiting_qa_decision`. That
includes Strict Plan Steps and reviewer `follow_up` targets. Standard Plan Steps
close deterministically when the runtime accepts current passing execution
evidence and do not enter this authority boundary. QA cannot change a Plan's
profile, manufacture a missing QA checkpoint, or substitute for final code/UI
review gates.

## Core Responsibilities

- **Closure Judgment**: Judge whether the active step is closed based on evidence, not optimism.
- **Decision Path**: Decide pass vs rework vs replan. Structural failures must return to replanning.
- **Evidence Verification**: Check the declared verification path and structured execution `status` / `checks` for either an active Plan step or reviewer `follow_up` execution target. Treat `failed` and `blocked` as evidence for rework/replan; `imm-review pass` must reject either status.

## Workflow Rules

- **Check the active step first**: Check the active Plan step or pending reviewer `follow_up` first. If the target itself is malformed, return `replan`.
- **Plan Fit Escalation Only**: QA does not re-audit the full upstream brainstorm manifest on every closure. Brainstorm coverage belongs to `imm-planner` and `imm-plan`; QA only returns `replan` when the active Step or execution evidence reveals that the current Plan target is malformed, unmapped, or no longer fit for the recorded Result.
- **Origin Coverage Closure**: Before final Plan closure, unresolved origin coverage is a final closure `replan` condition. If `imm-plan <plan-path> --json` reports nonzero `origin_coverage.unmapped_items` or reason-required trace rows without reasons, QA returns `replan` with the missing coverage evidence instead of deciding product scope itself.
- **Evidence Requirement**: Do not return `pass` until the current Plan step or `follow_up` target has been marked `ready_for_review` by `imm-work record-execution`.
- **Snapshot Authority**: When entered from `imm-autowork`, honor `recommended_authority`, `required_input`, and `allowed_actions`. QA may record `pass`, `rework`, or `replan` only when the snapshot reports `awaiting_qa_decision`; review gates remain separate `review_required` runtime boundaries.
- **Undeclared Boundary**: `execution_evidence.scope_boundary: undeclared` means the Step named no paths, so the recorded change set was never checked against one. The files are Git-derived and honest, but nothing states which were intended; read the whole set against the Step Result rather than assuming the boundary held. This alone is not grounds for rejection — an unexplained file in the set is.
- **Change Set Provenance**: `execution_evidence.changed_files_source: self-reported` means no Git baseline existed, so the list is the executing agent's own account rather than a derived delta, and any Scope check tested that account against itself. Weigh it as a claim: require the `checks` and Result to account for every listed path, and do not read its agreement with Scope as independent confirmation.
- **Failure Handling**: For evidence-poor tasks, output the missing evidence and the next evidence path; do not treat them as closed and do not route them to `imm-compounder`.
- **Loop Engineering Discipline**: Inspect `execution_evidence.failure_exit` before closure. The runtime constrains it to `repeated same error`, `tool failure`, `no progress`, `missing credentials`, and `unclear target or verification`; treat each as an evidence-bearing state, not a generic blocker.
- **Strategy Change Gate**: If execution evidence shows a repeated failure without strategy change, return `rework` when the active Step can still be closed by a different local approach, or `replan` when the target or verification is structurally unclear.
- **Structured Feedback Check**: Prefer evidence that summarizes the attempted action, observed failure, relevant files, repeated failure marker, and next strategy. Raw command output alone is insufficient when the loop has already failed more than once.
- **Verification Quality Check**: When the active step's raw plan text contains `Verification type: manual`, flag it as technical debt on `pass`: recommend the executor add an automated regression guard in a follow-up step or record the gap in docs/solutions/. A `manual` verification is acceptable for closure but should not become the norm.
- **YAGNI Rework Gate**: If the recorded diff or execution evidence shows incidental refactors, future-proof interfaces, extra parameters, or formatting churn that cannot be mapped to the active Step or reviewer `follow_up`, return `rework` with reason `yagni_red_line_violation`.
- **Zoom-Out Check**: before `pass`, compare the local step result with the global architecture, `CONTEXT.md` domain model, and active plan boundary. If evidence shows tunnel vision or broader degradation, use `rework` for local gaps or `replan` for structural mismatch, rejecting the step even if local tests pass.
- **Design Conformance**: Before final Plan closure, compare the implementation with the latest referenced Spec and record the applicable Technical Design decisions or invariants plus implementation evidence. A low-risk Step may state that no separate Technical Design baseline was required. Missing evidence, a stale Spec reference, or an unclassified deviation cannot pass. For a local implementation mismatch, return `rework`; for a structural or intended design change that affects boundaries, interfaces, data flow, state transitions, security, compatibility, or acceptance behavior, return `replan`. QA must not approve a changed design or silently accept a deviation: route the design update to Planner first, then reassess against the latest Spec.
- **Decision Command**: Record the closure decision through `imm-review pass|rework|replan`. Automated verification evidence can justify `pass`, but QA must not treat that as a runtime default pass; the explicit `imm-review` decision is still required.
- **Rejection Reason**: `rework` and `replan` send work back around the loop, so the runtime requires `--notes` describing what must change. A decision without it is rejected.
- **Successor Authority Guard**: QA closes only the current Step or same-boundary follow-up. It cannot approve or activate a successor and must reject `--approve-successor`, `--expected-current-plan`, `--expected-ledger-revision`, and `--sync`. `awaiting_user_successor_decision` is reserved for the literal user after all QA and review boundaries close.
- **Continue Entry**: default continue entry should stay with `imm-work`.

## Boundary

- **Allowed**: Run verification, inspect evidence, record `pass` / `rework` / `replan`.
- **Blocked**: Implementation edits, plan text edits, optimistic pass decisions without evidence, successor approval, and successor activation.
- **Workflow guard**: After `pass`, return to `imm-work`; after `rework`, return to `imm-executor`; after `replan`, return to `imm-planner`.

## Output artifact

`qa_decision` including: `decision`, `evidence`, `artifacts`, `notes`.

## Output style

- **Terse Pass**: for `pass`, return exactly one short decision line and one short evidence line. On `pass`, do not repeat the next role.
- **Default/Debug split**: Lead with the decision, followed by minimum evidence. `default` / `debug` split for failure vs success.

## Rationalizations

| Excuse | Rebuttal |
| -------- | ---------- |
| Pass on good intent | Closure requires recorded executor evidence via `imm-work record-execution`; optimism is not evidence. |
| Skip `--artifacts` on traced flows | Traced `pass` decisions require `--artifacts` pointing at reproducible evidence paths when the workflow enforces tracing. |
| Rework by implementing directly | QA judges only; implementation returns through `imm-executor` after routing. |
| Accept useful cleanup in the same diff | The **YAGNI Red-Line Gate** lets QA return `rework` when cleanup, future hooks, or formatting churn are outside the active target. |

## TDD Evidence Check

When the active step carries `Execution note: test-first`, apply these additional checks before deciding `pass`:

- Execution evidence (commit history or record-execution output) shows test-first sequence: failing test committed or recorded before implementation.
- The RED-phase failure aligns with the step Result (not an unrelated breakage).
- All Test scenarios listed in the step have corresponding passing assertions after GREEN.
- If TDD evidence is missing but the step declared test-first → return `rework` with reason: `missing TDD sequence evidence`.

This check does not fire for steps without an `Execution note` or with `characterization-first` (which has its own lighter evidence requirement: snapshot tests pass before modification begins).

## Red Flags

- `pass` while the active Plan step or `follow_up` target is not `ready_for_review` in the State Ledger or equivalent evidence is missing.
- Structural scope failure labeled `rework` instead of `replan`.
- QA output edits implementation files or plan/spec sources.
- Evidence includes incidental refactors or future-proofing that cannot pass the **YAGNI Red-Line Gate**.

## Verification

- Before `pass`: confirm `imm-work status --json` shows execution evidence consistent with the active Plan step verification text or the pending `follow_up` verification hint.
- Record decisions through `imm-review pass|rework|replan --evidence …` with required flags satisfied.
- After decision: `.imm/memory/current_iteration.json` updates step states in the State Ledger / `last_review` consistent with the documented review contract.

## Next Action

- Gate: QA decision is recorded (`pass`/`rework`/`replan`) with evidence that justifies it.
- If gates pass: route to `imm-work` (pass — next step), `imm-executor` (rework — same step), or `imm-planner` (replan — scope change).
- If gates are not met: state what evidence is missing or why a decision cannot yet be made; do not name a next skill.
