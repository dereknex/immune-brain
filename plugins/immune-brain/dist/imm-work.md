---
name: imm-work
description: Use when continuing plans.
---

# Immune-Brain: Current Step Driver

This skill adheres to the **[BASELINE.md](BASELINE.md)**.

## Workflow Profiles

- Read `workflow_profile`, `compounder_requirement`, and `review_budget_state`
  from the runtime checkpoint; never reclassify the active Plan in host prose.
- Standard Plan Steps close when `imm-work record-execution` accepts passing
  evidence. Route directly to the next Step or final review instead of
  dispatching per-Step QA.
- Strict Plan Steps and all reviewer `follow_up` targets retain independent QA.
  Plans without a profile are Strict for compatibility.
- The final Standard review gate atomically finishes only when Compounder is not
  required. A `complete` checkpoint means report the explicit Compounder
  handoff. Standard follow-ups stop before a third round.

## Core Responsibilities

- **Current Step Coordination**: Act as the default entry point after a plan is validated. Drive only the active step to its next boundary (execution, QA, rework, or completion).
- **Dual-Track Execution**: Accept either a validated Plan step or a pending `follow_up` handoff from a reviewer as the current execution target.
- **Lifecycle Automation**: Internally decide whether to apply executor semantics, QA semantics, or planner routing.
- **Authority Guard**: Implementation only happens within the active step and only after activation.
- **Composable Mainline Entry**: Serve as the default post-plan continue entry in the composable workflow mainline; do not expand into full-plan ceremony or replace planner/executor/qa authority.

## Decision Tree

1. If a validated Plan step is active, drive that step to its next boundary.
2. If no active Plan step exists, identify/activate the next unfinished Plan step when available.
3. If no Plan step is currently executable but a pending reviewer `follow_up` handoff exists, consume that handoff as the execution target and route to `imm-executor` with its `scope`, `change_goal`, and `verification_hint`.
4. If execution evidence already exists for a Strict Plan step or any `follow_up`, collect closure through `imm-qa`. A Standard Plan step with accepted passing evidence is already closed by the runtime; follow the fresh checkpoint instead.
5. If every Step and required review is closed but the Plan is not finished, honor `compounder_requirement`: return the explicit `imm-compounder` handoff only when required. Standard optional Plans normally finish atomically with the final gate pass. After `imm-finish`, a contracted terminal Roadmap slice or a legacy Plan without successor metadata stops at `terminal_plan_complete`, while a non-terminal slice stops at `awaiting_user_successor_decision` with `recommended_authority: user`.
6. If no current Plan lifecycle remains and no successor decision is pending, route to `imm-planner`.
7. If scope mismatch or dependency conflict is found, route to `imm-planner`.

## Workflow Rules

- **Preamble**: For multi-step or tool-heavy tasks, emit a short visible user update acknowledging the request and naming the first step before entering execution. Keep it to one or two sentences.
- **Stop-Check**: After each execution round, evaluate: "Does the active step now have sufficient verifiable evidence to close?" If yes, route to `imm-qa` instead of continuing. Do not iterate beyond what is needed to close the current step.
- **Continue Entry**: The default continue entry should remain `imm-work`. Treat `imm-executor` and `imm-qa` as authority roles, not as the default user-facing continue entrypoints.
- **Routing Contract**: `imm-work` is the current-step driver after plan/spec work is closed. It should route to the next safe boundary, not reintroduce earlier framing/planning stages unless state actually requires them.
- **Follow-up Track**: A pending `follow_up` from `imm-code-review` or `imm-ui-review` is a lightweight execution artifact, not a Plan mutation. When consuming a reviewer handoff, pass its checkpoint `changed_files_signature` to `imm-work follow-up-open --changed-files-signature`; this is mandatory when reopening an already-passed origin gate and optional for the backwards-compatible pending-gate path. Do not call `append_to_plan` or rewrite `docs/plans/*.md` for direct same-boundary follow-up repairs.
- **Rework Scope Constraint**: In `rework_needed`, route execution only toward satisfying the specific finding verification criteria recorded by QA or reviewer `follow_up` `verification_criteria`. Do not expand rework into adjacent cleanup, broad redesign, or unrelated quality fixes; if the criteria cannot be satisfied inside the active step boundary, route to `imm-planner`.
- **Failure Exit Routing**: When recorded execution evidence or a reviewer `follow_up` carries a failure exit, it lives in the evidence `failure_exit` field, which the runtime constrains to `repeated same error`, `tool failure`, `no progress`, `missing credentials`, or `unclear target or verification`; do not relabel failure exits as generic blockers; route recorded failure exits to `imm-qa` before any rework loop so QA keeps `pass` / `rework` / `replan` authority. After QA returns `rework`, route QA `rework` with strategy change back to `imm-executor` when the active Step boundary still holds, and route unclear target or verification to `imm-planner`.
- **Evidence Boundary**: `imm-work record-execution` derives `changed_files` from the Git workspace when available, rejects paths outside the active Step or follow-up `Scope`, and preserves every failed, blocked, and passed attempt. Executor claims are descriptive fallback only when Git is unavailable.
- **Plan Immutability**: Once any Step is activated, the synced Plan contract is immutable. Replan creates a new sequential Plan; it never appends to or rewrites the active Plan.
- **Strict Plan Sequence**: Exactly one Plan is current. Another Plan may be synced only after `imm-finish` or after the user explicitly terminates the current Plan as `cancelled` or `superseded`. A terminated Plan cannot be resumed.
- **One Step at a Time**: `continue only the current active step`.
- **Adaptive Cache-First Route**: Before broad search or probe dispatch, read the active Step `discovery_cache`, `CONTEXT.md` `## Architecture Map`, and relevant `docs/solutions/` `key_files`; then use targeted search only for missing evidence.
- **Subagents**: Use bounded subagent assistance only after the Cost-Based Subagent Gate in `docs/reference/subagent-dispatch-protocol.md` says the active Step is multi-domain, high-risk, explicitly delegated, or has concrete `parallel_probes`. Fall back to solo when boundaries are unclear. Resolve conflicts via `security > performance > compatibility > readability`; if that still does not produce a safe boundary, route back to `imm-planner`.
- **Global Activation Policy**: Before dispatching `parallel_probes`, honor `[subagent_activation]` from `~/.immune-brain/config.toml` or the host-provided equivalent. Valid modes are `auto`, `explicit_only`, and `disabled`. If config requires an explicit subagent request and none exists, record `explicit_required`; if config disables probe dispatch, record `config_disabled`.
- **Authorization**: Treat activation/probe plans as eligibility only, then apply [Subagent Dispatch Protocol: Authorization Authority](docs/reference/subagent-dispatch-protocol.md#authorization-authority). If authorization is absent, record `host_authorization_required` and continue solo.
- **Probe Dispatch**: When the active Step carries `parallel_probes`, call `imm-work continue` with the resolved host activation inputs. The TypeScript runtime in `plugins/immune-brain/runtime/work_probes.ts` persists `active -> probing` and returns deterministic, advisory-only host envelopes with stable probe IDs and `expected_ledger_revision`; it does not call an AI provider. Dispatch those envelopes through the host when permitted, normalize each host outcome into `success`, `failed`, `timed_out`, or classified `fallback`, then submit the complete packet through `imm-work record-probes --results-json`. The runtime exclusively validates Step identity, Ledger revision, result completeness, fallback consistency, and replay safety before persisting `probing -> executing` plus State Ledger `child_evidence`. If host dispatch is unavailable or unauthorized, submit the runtime-classified fallback packet and continue with sequential inline investigation. Do not reimplement these decisions in host prose or adapters.
- **Child Evidence Boundary**: State Ledger `child_evidence` is advisory input for the executor and, when scheduled, QA. It cannot close a Step, cannot issue `pass`, and cannot rewrite the Plan. Standard Step closure is a separate deterministic runtime transition based on current passing execution evidence; child evidence never triggers it.
- **Fast-Track**: The runtime decides eligibility and reports it as checkpoint `fast_track`; do not re-derive it from step counts. Fast-track compresses eligible interactions but does not select the quality profile. Strict retains QA closure; Standard uses deterministic passing-evidence closure. Neither mode bypasses evidence recording or final required review gates.
- **HANDOFF.md Update**: The runtime rewrites the `GENERATED` region of `HANDOFF.md` on every QA pass with plan name, completed steps, active step, and known blockers, creating the file when absent. Do not hand-write that region; it is overwritten. Own the sections outside it — session decisions and priority files — because the runtime cannot derive them and preserves whatever it finds there. Write failures are non-fatal and never reverse a recorded pass, so treat a missing refresh as a stale artifact rather than a workflow error. `.imm/memory/` remains the source of truth, and the successor section must never be parsed as transition authority.
- **Successor Decision Stop**: At `awaiting_user_successor_decision`, expose the read-only candidate, preconditions, and expected Ledger revision, then stop. `imm-work` must not dispatch Planner, Compounder, transition, or a new Pi session/subagent, and it cannot construct an executable successor path. Only a literal user may invoke `--approve-successor`.
- **Terminated Plans**: A literal user may terminate an irrecoverably blocked current Plan. Cancellation uses `imm-plan --terminate-current --status cancelled --reason <reason> --user-confirmed`. Superseding requires complete observability: `imm-plan --terminate-current --status superseded --reason <reason> --reason-code <code> --stage <stage> --invalidated-assumption <assumption> --avoidable <yes|no> --user-confirmed`. This archives the full current execution state. The next goal uses a new Plan path; there is no suspend, resume, repair insertion, queue, or parallel Plan execution.
- **Compaction Handoff**: When the user signals imminent compaction (or at each QA pass), populate the **Compaction Handoff** section of `HANDOFF.md` per [`docs/reference/HANDOFF-template.md`](docs/reference/HANDOFF-template.md): active plan path, active Step ID plus Result, up to 5 priority files for post-compact reload, uncommitted work summary, session decisions, and next boundary skill. `HANDOFF.md` is the only place these fields survive today: the specified `logic_state.compaction_handoff` mirror is not implemented in the TypeScript runtime. Pi and Magic Context handle session compaction; Immune-Brain ships no host-specific compaction hooks.
- **Small Tasks**: `imm-work` handles a small task only after the BASELINE Workflow Activation gate selects the managed lifecycle. Do not retrofit Direct Path work into a Plan or State Ledger.
- **destructive edit protocol**: When coordinating executor edits that delete or replace code, require exact-region replacement rather than anchor-only insertion. After the edit, verify the edited region and run focused symbol searches before recording evidence.
- **No Same-Plan Appends**: After activation, do not append repair Steps or revise Plan semantics. Preserve the immutable execution record, obtain explicit user termination when needed, and create a new sequential Plan.

## Boundary

- **Allowed**: Validate plans, activate one step, consume a pending `follow_up` handoff as the execution target, inspect workflow state, surface executor or QA evidence, update `HANDOFF.md` as a status convenience artifact, and report tracked plus untracked working-tree files at stop points.
- **Blocked**: Plan rewrites, direct coordinator-owned implementation edits, QA decisions without evidence, successor approval, and successor activation.
- **Workflow guard**: a `validated plan` and an `active step`, or a pending `follow_up` handoff, is required. Continue only the current execution target; use `imm-executor` for edits and `imm-qa` for closure.

## Output artifact

- **Onboarding**: Provide `work_status.recommended_entry`, `work_status.progress_summary`, and `work_status.resume_block` to make it obvious which entry to use, where the current step stands, and what boundary comes next.
- **Working-tree closeout**: At user-visible stop points, summarize tracked and untracked files. Treat `.pi/tasks/*.json` as host temporary state by default unless the active Step explicitly asks to persist it.
- **Follow-up Consumption**: When the source is a pending `follow_up`, preserve `scope`, `change_goal`, `verification_hint`, `changed_files_signature`, and `origin_review` in the execution context and evidence handoff.
- **Pi Status**: Keep Pi's visible task/status surface aligned with the authoritative State Ledger projection; do not create a second workflow state store.

## Output style

User-facing output should default to `Conclusion -> Evidence -> Next step`, treating the structured workflow state above as the internal artifact.

## Rationalizations

| Excuse | Rebuttal |
| -------- | ---------- |
| Skip `activate` and edit anyway | Executor edits require a validated plan plus an activated step from `imm-work activate`; otherwise route to `imm-planner` or activate first. |
| Drive multiple steps in one turn | Only one step active at a time (single-active policy); advance after QA `pass` and next activation. |
| Merge planner or QA duties into this entry | `imm-work` coordinates; it does not rewrite plans (`imm-planner`) or issue `pass` (`imm-qa`). |

## Red Flags

- Implementation edits appear without a recorded `activate` for the current plan step.
- User-facing `pass` or scope shrink happens inside `imm-work` semantics instead of through `imm-review` / `imm-planner`.
- State Ledger step states or plan files change without a planner-owned path when scope drifted.

## Verification

- `imm-work status` (or `--json`) shows the expected validated plan path and either a coherent active step in the State Ledger or an explicit next activation target.
- When handing off after executor work: `imm-work record-execution` was used, the runtime-derived Git paths fit the target `Scope`, and the active step can reach `ready_for_review` state.
- `.imm/memory/current_iteration.json` reflects the same plan signature and execution-contract signature as the synced Plan for the active iteration.

## Next Action

- Gate: A validated Plan active step or pending `follow_up` execution target exists with a clear verification path.
- If gates pass: route to `imm-executor` (if step needs implementation) or `imm-qa` (if execution evidence exists).
- If gates are not met: state what is missing (no plan → suggest `imm-planner`; no activatable step → explain why); do not name an executor or QA target.

## Kernel Canary Routing

When the runtime Kernel projection reports an active or draining backend claim,
the owned task is a Kernel canary. Route it to `imm-canary-work` (the Pi
lifecycle extension: `imm_kernel_canary` tool plus `/imm-canary-assure` and
`/imm-canary-authorize` TUI commands). `imm-work` must never mutate or mirror a
Kernel-owned task through v3 Plan/Step state, and must never issue a v3 managed
mutation while a workspace-active claim exists (the canonical v3 call site fails
closed). After fresh executor evidence, call `imm_kernel_canary`
`advance_assurance`; consume the direct foreground QA result, then explicitly
invoke the foreground Agent and `submit_review`. A terminal task leaves
only an immutable task tombstone and no
workspace claim: it is never reactivated, and it never blocks ordinary v3
routing for a different task. The Kernel projection is advisory; every Kernel
mutation re-enters Kernel store-lock validation.

## References

- Load `imm-executor`, `imm-qa`, `imm-planner`, `imm-code-review`.
