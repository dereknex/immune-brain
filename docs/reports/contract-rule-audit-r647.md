# Contract rule audit (r647)

**Status**: Report only. Slice S4 of `docs/specs/ceremony-trim-r647.spec.md` (decision U5). No rule is removed, reworded or relaxed by this report; the three contract changes of S4 are the only contract edits in that Slice.
**Date**: 2026-10-12
**Source revision**: git base `f379663` plus the S4 working tree.

## Purpose

After the r647 retro, the question was which normative rules in the Loop, Planner and Executor contracts do work, and which are text that no mechanism checks. This report lists each rule with the point that enforces it, so a later change can trim by evidence instead of by feel. It recommends nothing for removal.

## Scope

| Contract | Sections audited |
|---|---|
| `plugins/immune-brain/dist/imm-run.md` | Execution Loop, Decisions and Recovery |
| `plugins/immune-brain/dist/imm-planner.md` | Candidate Authoring (with its Initiative Carrier Preference and Verification Descriptor Discipline subsections), Enrolled Intent Revision, Core Responsibilities |
| `plugins/immune-brain/runtime/prompts/executor.md` | the whole prompt |

Not audited: Kernel Canary Routing and Authority, Review and Learning, Observable Output, Failure Output, the batch contract `dist/imm-run-batch.md`, and the remaining Planner sections. They are outside the S4 reference closure.

## Method

- A rule is one normative sentence or one sentence cluster that a reader can break independently. A compound bullet is split only where its parts have different enforcement.
- The enforcement point was found by searching `runtime/`, `.pi-extension/`, `hooks/`, `scripts/` and `tests/` for the rule's stable identifiers: error codes, field names, tool names and constants. This report claims that the named point exists and addresses the rule. It does not claim the guard is complete against every trigger of the rule.
- The class column holds the strongest mechanical enforcement found, in this order. A rule enforced by two classes is listed under the stronger one and names both points.

| Class | Meaning |
|---|---|
| **K** | Kernel or Assurance runtime: reducer, projection, Enrollment, QA, Review reservation. Refuses or invalidates state. |
| **H** | Host hook, tool surface or native gate: Claude `PreToolUse`, Pi `tool_call`, MCP tool table, native confirmation. |
| **C** | Runtime command or tracker: `imm-kernel`, `imm-tracker`, batch runner. Validates its input or output. |
| **T** | Test that pins the contract wording or a derived invariant. A regression in the text fails the test; a violation of the rule at run time does not. |
| **N** | None found. The rule is guidance for the model and is reviewed, not enforced. |

## Findings in brief

1. Counts are in the [summary table](#summary).
2. Rules classed **N** are mostly posture and judgment rules (decomposition, clarity, tracing before authoring) that cannot be checked mechanically. A few are procedural and could be: they are listed in [Rules with no enforcement point](#rules-with-no-enforcement-point).
3. One inconsistency was found that is not a rule gap: the legacy Spec validator disagreed with the S4 Planner wording. It was resolved after the S4 review. See [Resolved inconsistency](#resolved-inconsistency).

## Execution Loop (`dist/imm-run.md`)

| ID | Rule | Class | Enforcement point |
|---|---|---|---|
| L1 | Implement only the enrolled acceptance within the `scope_hint` envelope. | K | `runtime/workspace_scope.ts`, `runtime/assurance/coordinator.ts` (`outside the authorization envelope`); Pi `.pi-extension/imm-canary-work.ts` |
| L2 | A new helper or test inside an approved directory or glob needs no revision. | K | `runtime/workspace_scope.ts` `pathMatchesScope` prefix and glob rules; `tests/scope-revision-envelope.test.ts` |
| L3 | Stage only the exact task-owned paths needed for delivery before `advance_assurance`. | K | `runtime/workspace_scope.ts` (`task scope contains unstaged or untracked changes`) refuses the projection until staged. Which paths are *owned* is judged by the Executor: N for that half. |
| L4 | Never stage a whole file that mixes user changes with task changes; stop with an ownership conflict. | N | No detector found. |
| L5 | Staging grants no commit or push authority. | K | The Kernel exposes no commit or push operation; `runtime/unattended/batch_git.ts` commits only under a batch capability. |
| L6 | Complete the Delivery Evidence table for rework only. | T | `tests/ceremony-trim-contract.test.ts` |
| L7 | Executor checks are diagnostic evidence, not a QA or Review approval. | K | Approvals come only from the Kernel: `runtime/kernel/completion.ts` (`missing_approval_kinds`); Executor evidence is never an attestation. |
| L8 | Call `advance_assurance` in the foreground and consume its direct terminal result. | N | Not enforced. On the Claude Host the call completes through a task notification; the rule is a posture. |
| L9 | The Kernel freezes the artifacts itself before QA, binding Git content identity in place. | K | `runtime/assurance/coordinator.ts`; `artifact_state: frozen` in the projection. |
| L10 | QA runs all descriptors in a disposable delivery materialization, never against live worktree source. | K | `runtime/assurance/qa.ts`, `runtime/assurance/coordinator.ts`; `tests/managed-task-snapshot-isolation.test.ts` |
| L11 | Do not dispatch a separate per-Step QA Agent. | N | No detector found; no such dispatch path exists in the runtime. |
| L12 | On `review_ready`, invoke the returned `agent_params` as one exact foreground Agent call. | K | `runtime/assurance/coordinator.ts` (`reserved foreground Agent was not observed`); `runtime/claude/review_host.ts`; `.pi-extension/pi-canary-assurance-progression.ts` |
| L13 | Do not replace the snapshot-bound reviewer with a generic role dispatch. | K | Same reservation: only the reserved Agent invocation is accepted. |
| L14 | The Parent cannot issue its own QA or Review pass. | K | `runtime/kernel/assurance_projection.ts` (`independence_violations`), `runtime/kernel/completion.ts` |
| L15 | Fresh QA suffices for routine work; material and critical work additionally require fresh independent Review. | K | `runtime/kernel/completion.ts`, `runtime/kernel/assurance_projection.ts` (`missing_approval_kinds`) |
| L16 | Normal completion needs no second user confirmation. | N | Absence of a gate; nothing to enforce. |
| L17 | For rework, submit the verdict first, then edit; staging while frozen invalidates the snapshot. | K | Snapshot digest binding and `stale_attestation_ids`: `runtime/kernel/assurance_projection.ts`, `runtime/assurance/coordinator.ts`. The *order* (verdict before edit) is not checked. |
| L18 | Resolve findings only after fixing and verifying their cause. | K | `runtime/kernel/reducer.ts:308` `resolve_finding` (refuses user-decision and replan boundaries); closing a finding still needs fresh QA to settle. "After verifying the cause" is the `resolve_finding` tool description only (`runtime/claude/mcp_server.ts:36`). |
| L19 | On the second rework of one acceptance id or anchor, generalize to the shared guard or `refute_finding` bound to fresh QA evidence. | K | `refute_finding` half: `runtime/kernel/reducer.ts:346-393`, `runtime/kernel/refutation.ts` (fresh passing QA covering the acceptance id). The generalize-or-refute *choice* is wording only: `tests/rework-root-cause-contract.test.ts`. |
| L20 | A defect inside the goal and `scope_hint` is ordinary rework, never a reason to revise the Intent. | T | `tests/rework-root-cause-contract.test.ts`; the Kernel classifier would accept such a revision if proposed. |
| L21 | Never append a single input case to an acceptance assertion. | T | `tests/rework-root-cause-contract.test.ts`. The Kernel bounds an assertion at 2000 characters (`runtime/kernel/intent.ts:196-201`) but does not detect a case list. |
| L22 | An unresolved decision pauses only dependent execution; on `awaiting_user` invoke `request_authorization`. | H | `request_authorization` tool surface: `runtime/claude/mcp_server.ts`, `runtime/claude/interaction.ts`, `.pi-extension/pi-canary-interaction.ts` |
| L23 | Use the returned projection; read `status` only after interruption or ambiguity; never repeat a mutation to re-observe it. | K | Compare-and-set on record revision rejects a stale repeat. Read minimization is N. |
| L24 | Do not poll or create detached jobs. | N | No detector found. |

## Decisions and Recovery (`dist/imm-run.md`)

| ID | Rule | Class | Enforcement point |
|---|---|---|---|
| D1 | Resume from authority facts bound from the Kernel projection, not prose. | K | `status` projection fails closed on invalid or contradictory facts (`runtime/kernel/assurance_projection.ts`); a UserPromptSubmit hook reports the active task and obligation instead of resuming it. |
| D2 | Treat a compaction heading or summary that conflicts with the projection as prose and correct it. | N | Judgment rule. |
| D3 | Authored, validated, published, enrolled, assured and completed are distinct stages; Issue state is not Enrollment or completion. | K | Enrollment only through `enroll` with a validated candidate (`runtime/kernel/enrollment.ts`); the tracker imports no Issue state (`runtime/github_issue_tracker.ts`). |
| D4 | A falsely claimed later-Slice enrollment is a summary defect; do not replay a mutation to match prose. | N | Judgment rule. |
| D5 | Scope expansion returns to Planner's Enrolled Intent Revision route; collect all known gaps in one request; do not edit outside scope while waiting. | K | Envelope refusal: `runtime/workspace_scope.ts`. Collecting gaps in one request is N. |
| D6 | A same-directory concrete-file addition is submitted by the Loop owner with `revise_intent`, classifies `compatible` and applies without a native gate. | K | `runtime/kernel/intent.ts` (`sameDirectoryScopeAdditions`, risk-floor exclusion), `runtime/kernel/reducer.ts`; `tests/kernel-intent-v2.test.ts`, `tests/scope-revision-envelope.test.ts` |
| D7 | A glob, removed entry, new directory or floor path is breaking; a bare directory entry is refused before submission. | K | Classifier above; directory refusal in `runtime/claude/kernel_ports.ts` and `.pi-extension/imm-canary-work.ts` (`assertScopeAdditionsAreFiles`). A directory that does not exist yet is accepted (ADR 0021 residual). |
| D8 | The envelope check for a revision is judged against the next scope. | K | `runtime/claude/kernel_ports.ts`, `.pi-extension/imm-canary-work.ts`, `runtime/assurance/coordinator.ts`; `tests/scope-revision-envelope.test.ts`, `tests/breaking-intent-revision-gate.test.ts` |
| D9 | Revision ownership: a file edit inside the active scope from a session whose latest entry is a plan entry is refused with `revision_owner_required`. | H | `runtime/assurance/revision_owner.ts`, `runtime/claude/lane_guard.ts` (`PreToolUse`), `.pi-extension/imm-canary-work.ts` (`tool_call`); `tests/revision-owner-guard.test.ts`. File-edit tools only. |
| D10 | Effects are separate grants; a stage-only recovery grants no commit, push or publication. | K | No commit or push operation outside batch capability (see L5). |
| D11 | Check the existing channel and data scope before a new outbound research call. | N | Judgment rule. |
| D12 | Text instructions are contracts, not a bash sandbox; the Kernel gates are the boundary. | N | Statement of design, not a rule to enforce. |
| D13 | In a Lane with delegated revisions, an acceptance-only or narrowing revision goes to the Parent as `lane_revision`; widening, risk, goal or Spec is never delegated. | K | `runtime/unattended/batch_delegation.ts` (`delegatedRevisionRefusal`, `DELEGATED_ACTOR_ID`), `runtime/unattended/batch_state.ts:615` (`delegated-batch:` confirmation ref), `runtime/unattended/batch_lanes.ts` (`batch_delegation_refused`); `tests/batch-delegation-gate.test.ts` |
| D14 | Invoke `approve_breaking_intent_revision` with the complete next intent; the native gate is the single user decision; do not pre-confirm in chat. | H | Native gate: `.pi-extension/imm-canary-work.ts`, `runtime/claude/kernel_ports.ts`; reducer refuses unless the classifier returns breaking (`runtime/kernel/reducer.ts`). Pre-confirmation in chat is N. |
| D15 | A breaking revision is used only when goal, scope or a user-visible commitment changes. | K | Classifier decides `compatible` vs `breaking`; goal/risk/acceptance changes are breaking (`runtime/kernel/intent.ts`). Whether a revision is *warranted* is N. |
| D16 | The acceptance length limit is never worked around by shortening words. | N | The limit exists (2000 characters, `runtime/kernel/intent.ts:196-201`); the anti-workaround clause is wording only. |
| D17 | On a concrete unresolved decision, invoke `request_authorization`. | H | See L22. |
| D18 | On an explicit user stop, invoke the Kernel stop operation; one native confirmation; cancellation is not termination. | H | `runtime/claude/kernel_ports.ts` (`stop`), `.pi-extension/imm-canary-work.ts`; `tests/kernel-canary-terminal-transaction.test.ts` |
| D19 | Never clear claims manually or force-kill QA; wait for a busy invocation. | N | No busy-invocation check found for stop. |
| D20 | Invoke `repair_authority_state` for a proven stale claim; the Kernel removes only the redundant claim. | K | `runtime/kernel/assurance_projection.ts`, `runtime/claude/kernel_ports.ts`, `.pi-extension/imm-canary-enroll.ts` |
| D21 | A Managed native authority failure stays fail-closed with one same-Host recovery action. | K | Stable reason and `recovery_action` in Kernel and Host errors (`runtime/kernel/assurance_projection.ts`, `.pi-extension/pi-canary-tool-failure.ts`). "Never recommend another Host" is N. |
| D22 | After interruption, read a fresh projection and run only the pending obligation; own-claim technical rework goes to the foreground Executor. | K | `next_obligation` and `recovery` in the projection; `runtime/assurance/coordinator.ts`. |
| D23 | `review_preparation_failed` keeps the batch running and retains fresh QA. | K | `runtime/assurance/coordinator.ts`, `runtime/unattended/batch_lanes.ts`, `runtime/unattended/batch_runner.ts`; `tests/review-revision-identity-conformance.test.ts` |
| D24 | Dispose each identified finding by `resolve_finding` or evidence-bound `refute_finding`; local green cannot settle. | K | `runtime/kernel/reducer.ts:308,346`; completion requires fresh QA (`runtime/kernel/completion.ts`). |
| D25 | Environment failure is not an assertion finding; QA diagnostic metadata is capped at 16 KiB and carries no stdout, stderr, argv or environment values. | K | `runtime/assurance/qa.ts:124`, `runtime/assurance/coordinator.ts:262` (`execution_metadata_limit_exceeded`); `tests/shared-deterministic-qa.test.ts` |
| D26 | A failed `prepare` stage adds `prepare_observation` to the direct Tool result only; a failing `check` returns no output text; never persisted. | K | `runtime/assurance/coordinator.ts`, `.pi-extension/pi-canary-tool-failure.ts`; `tests/qa-prepare-diagnostics.test.ts`, `tests/dual-host-assurance-conformance.test.ts` |
| D27 | A frozen child with `run_qa` pending returns to Parent; batch re-entry does not blindly retry an unchanged failure. | C | Batch state machine: `runtime/unattended/batch_runner.ts`, `runtime/unattended/batch_lanes.ts` (located by name, not traced rule by rule). |
| D28 | A committed QA result is honored; an interrupted precommit run produces no approval; do not rerun QA because Review was interrupted. | K | `runtime/assurance/coordinator.ts` QA freshness and attestation binding. |
| D29 | Malformed or stale reviewer output is not a verdict; do not fabricate a pass or blindly redispatch. | K | Reservation validation in `runtime/assurance/coordinator.ts`, `runtime/claude/review_host.ts`. |
| D30 | Missing tools, credentials, invalid projections or repeated unchanged failures stop with a concrete cause. | N | Judgment rule; invalid projections do fail closed (D1). |

## Candidate Authoring (`dist/imm-planner.md`)

| ID | Rule | Class | Enforcement point |
|---|---|---|---|
| C1 | Trace each expected behavior from entry point through callers, mirrors and state-machine owners before authoring. | T | `tests/imm-planner-kernel-intent-contract.test.ts` pins the wording. The trace itself is N. |
| C2 | Include the generated Claude bundle and the release changeset when the runtime change requires them. | T | `tests/claude-host-package.test.ts` (bundle matches source); the changeset is checked only by release tooling, not by Enrollment. |
| C3 | Do not author while a referenced sibling is unresolved. | N | Judgment rule. |
| C4 | Default ordinary scope to the smallest coherent module directory, naming concrete files. | N | Planner judgment. The Kernel side that makes it cheap is D6. |
| C5 | Keep Kernel, authority, migration, secret and security scope exact to proven files. | K | `RISK_FLOOR_SCOPE_PREFIXES` raise risk and force breaking revisions (`runtime/kernel/intent.ts`). The floor lists Kernel, assurance, Claude Host authority and Pi extension prefixes, not migration, secret or security paths. |
| C6 | The Planner never writes `docs/plans/<task-id>.intent.json` directly and never overwrites an existing TaskIntent. | C | `imm-kernel intent author` creates with `O_CREAT|O_EXCL` and refuses an existing destination (`runtime/commands/kernel.ts:787-794`). A direct Write by the Planner is N. |
| C7 | Author through `imm-kernel intent author`, then validate with `intent validate`. | C | `runtime/commands/kernel.ts`; `tests/kernel-intent-authoring.test.ts`, `tests/kernel-intent-validation.test.ts` |
| C8 | Revisions of an enrolled intent go through Kernel `revise_intent`, not a Planner overwrite. | K | Reducer revision CAS; Host revision preparation restores the staged sidecar on failure (`tests/scope-revision-envelope.test.ts`). |
| C9 | After authoring, stage only the exact Planner-produced Spec and TaskIntent paths. | N | No detector found. |
| C10 | Before authoring a state-machine field or verdict branch, enumerate every consumer and version gate. | N | Judgment rule. |
| C11 | Resolve the Initiative carrier in a fixed order; never default silently; ask when no valid directive is found. | T | `tests/plugin-package-runtime.test.ts`, `tests/pi-only-current-contracts.test.ts`, `tests/exhaustive-decision-tree-contract.test.ts` pin the wording. Resolution is Planner behavior: N. |
| C12 | Confirm the named Initiative, slug and complete decomposition before the first remote mutation. | C | `imm-tracker publish-initiative` takes the confirmed slug and full set as one input (`runtime/github_issue_tracker.ts`); that the user actually confirmed is N. |
| C13 | Present one review table and perform zero GitHub mutations before approval. | N | No detector found. |
| C14 | Author, stage and validate every TaskIntent with `valid: true` and `enrollment_ready: true`. | C | `runtime/v4_runtime.ts`, `runtime/commands/kernel.ts`; `tests/kernel-intent-authoring.test.ts` |
| C15 | Compare scopes with `imm-kernel intent overlap`; never write "disjoint" by hand. | C | `runtime/commands/kernel.ts:869` (command); `runtime/unattended/batch_schedule.ts` (same projection). Not writing "disjoint" by hand is N. |
| C16 | Submit the approved set once through `imm-tracker publish-initiative`; every Parent Slice has one Child. | C | `runtime/github_issue_tracker.ts` validates the dependency graph and membership before any remote write. |
| C17 | Parent projection requires `short_name`, `title`, `problem`, `result`, `design`; Child requires `title` and acceptance summaries of 1-500 characters. | C | `runtime/github_issue_tracker.ts` input validation; `tests/github-issue-projection-contract.test.ts` |
| C18 | Public acceptance IDs match every canonical TaskIntent acceptance ID exactly once; canonical assertion prose is never copied to GitHub. | C | `runtime/github_issue_tracker.ts` rereads each TaskIntent for identity, risk and acceptance IDs. |
| C19 | Scenario IDs are `BR-SCN-<n>` or `SCN-<n>`; automated scenarios map to acceptance IDs; manual ones carry `manual_reason`; whole batch rejected before any write. | C | `runtime/github_issue_tracker.ts:12` (`SCENARIO_ID_PATTERN`) and `:1092`; `tests/github-initiative-recovery.test.ts` |
| C20 | Issue titles are composed from display names and fail closed above 80 characters; never truncated. | C | `runtime/github_issue_tracker.ts:19,375` (`MAX_TITLE_LENGTH`) |
| C21 | Children carry `ready-for-agent`, blocked ones also `blocked`, the Parent neither; the tracker never creates labels. | C | `runtime/github_issue_tracker.ts`; `tests/github-issue-projection-contract.test.ts` |
| C22 | Deduplication is start-only; a rerun adopts what the start listing carries and never repeats a completed write. | C | `runtime/github_issue_tracker.ts`; `tests/github-initiative-recovery.test.ts` |
| C23 | A local `docs/initiatives/<slug>.md` makes publication fail with a carrier conflict; Local mode performs zero GitHub operations. | C | `runtime/github_issue_tracker.ts:981`; `runtime/local_initiative.ts` |
| C24 | Report exactly one carrier outcome: `tracker_associated`, `awaiting_user_initiative_confirmation` or `tracker_projection_failed`. | C | Tracker result statuses (`runtime/github_issue_tracker.ts`). That the Planner reports one of them is N. |
| C25 | Tracker output is observation, never authority; do not store Issue identity in TaskIntent or TaskRecord. | K | TaskIntent and TaskRecord schemas carry no Issue field (`runtime/kernel/intent.ts`, `runtime/kernel/types.ts`). |
| C26 | The Planner never closes the Parent; `mark-terminal` closes it when every Slice Child is closed as completed. | C | `runtime/github_issue_tracker.ts:1546,1573` |
| C27 | Amendment of a published Initiative binds observed baselines and fails closed on drift or omitted membership. | C | `runtime/github_issue_tracker.ts` amendment path; `tests/github-initiative-recovery.test.ts` |
| C28 | A descriptor uses `assurance_kernel/verification_descriptor/v2`; v1 is historical-only and needs an Intent revision before execution. | K | `runtime/verification_descriptor.ts:96-97` (`verification_contract_migration_required`) |
| C29 | Declare only needed `writable_paths`; use the smallest `timeout_ms` and `max_output_bytes`. | C | Bounds in `runtime/verification_descriptor.ts` (`max_writable_paths: 32`, `max_timeout_ms`, `max_output_bytes`). Choosing the *smallest* is N. |
| C30 | Never hide package installation in an acceptance command; never use the full suite, a build or network access as acceptance. | N | No descriptor lint found. |
| C31 | A dependency found only in the Planner's live worktree is not delivery provenance. | K | QA runs in a disposable delivery without worktree `node_modules`; `tests/managed-task-snapshot-isolation.test.ts` |
| C32 | `valid` and `enrollment_ready` are structural readiness only; only completed QA proves a descriptor passed. | K | Attestation requires a QA run (`runtime/assurance/qa.ts`). |
| C33 | Acceptance-to-invariant mapping with positive, negative and bound controls. | N | Judgment rule. |
| C34 | Zero matched checks and skipped required checks are failures. | K | Only through the runner exit code (`runtime/assurance/qa.ts:133,146`): a runner that exits 0 on zero tests passes. Wording pinned by `tests/workflow-verification-invariants.test.ts`. |
| C35 | Preparation must not hide a download, credential use or production write. | N | `prepare` runs isolated with a fresh home and cache (D26), but no content check exists. |

## Enrolled Intent Revision (`dist/imm-planner.md`)

| ID | Rule | Class | Enforcement point |
|---|---|---|---|
| R1 | Prepare the complete proposed revision without replacing the active owner or overwriting enrolled sidecars. | K | Reducer revision CAS; Host restores the staged sidecar on failure (`.pi-extension/imm-canary-work.ts`, `runtime/claude/kernel_ports.ts`). |
| R2 | Do not invoke the new-intent author command or request a second Enrollment for a revision. | C | `intent author` refuses an existing destination (C6); a second Enrollment of an enrolled task fails (`runtime/kernel/enrollment.ts:187`, `task record already exists`). |
| R3 | A same-directory file addition is not a Planner request. | K | See D6. |
| R4 | Return the proposal to the Loop owner for `revise_intent` or `approve_breaking_intent_revision`. | H | See D9, D14. |
| R5 | The native gate is the single user decision; preparation does not authorize expanded execution. | H | Native gate; envelope refusal for paths outside the applied scope. |
| R6 | Revision ownership: Planner sessions return scope and acceptance proposals to the executing session. | H | See D9 (file-edit tools only; the shell is not covered). |
| R7 | Warranted only when goal, `scope_hint` or a user-visible commitment changes. | K | Classifier (see D15). The "warranted" judgment is N. |
| R8 | Decline to prepare a revision that only appends a single input case. | T | `tests/rework-root-cause-contract.test.ts` |

## Core Responsibilities (`dist/imm-planner.md`)

| ID | Rule | Class | Enforcement point |
|---|---|---|---|
| P1 | Decomposition: one or more TaskIntents; a Spec only for complex work. | N | Planner judgment. |
| P2 | Outcome Conservation: the plan conserves the complete confirmed outcome; a reduction returns to `imm-brainstorm`. | N | `tests/technical-design-conformance-contract.test.ts` pins part of the wording; the rule itself is judgment. |
| P3 | Outcome Focus: one independently verifiable outcome per TaskIntent. | N | Judgment rule. |
| P4 | Planning granularity: file count and tokens are evidence, not gates. | N | Statement of design. |
| P5 | `imm-plan` is a read-only validator for archived Plans; create no new Roadmap, Phase or successor Plan. | C | Only the retained kernel surface is reachable (`runtime/v4_runtime.ts:175-216`). |
| P6 | Risk-Triggered Exploration: probe only unknowns that change scope, design or verification. | N | Judgment rule. |
| P7 | Simplicity: the user's request for a Spec, Plan or TaskIntent starts this phase; other host input stays host-native. | H | Phase-entry gate and skill self-entry (`runtime/assurance/phase_entry.ts`); `tests/phase-entry.test.ts`. |
| P8 | Design-Depth Classification: Low, Medium or High risk; every Spec records `Design risk` with a rationale. | C | Legacy validator `runtime/plan_core.ts:679-681` (archived Plans only). Not read by Kernel or Assurance. `tests/plan-validation.test.ts` |
| P9 | Design-view selection: record `Design views`; no empty sections. | T | `tests/technical-design-conformance-contract.test.ts` |
| P10 | The Spec is the single Technical Design baseline; acceptance does not copy design prose. | T | `tests/technical-design-conformance-contract.test.ts` |
| P11 | TaskIntent decomposition: split by trust invariant or state-machine owner; each Initiative Slice states an observable result. | N | Judgment rule; the Initiative review table's `result` column carries the statement (C17). |
| P12 | Mermaid: only a Medium or High Spec whose design requires a diagram records `Diagram decision: required` and a non-empty `Diagram reason` and has a Mermaid block. | T | `tests/technical-design-conformance-contract.test.ts`. The legacy validator accepts the diagram-free form (see [Resolved inconsistency](#resolved-inconsistency)). |
| P13 | Verification: every acceptance has a focused descriptor that can fail on the regression; zero-match and skipped checks fail. | K | Descriptor required per acceptance (`runtime/kernel/intent.ts`); QA exit code (C34). "Can fail on the regression" is N. |
| P14 | Executable Scope: `scope_hint` is the mutation envelope; a complex task binds at most one active Spec by content identity. | K | Envelope (L1); Spec binding at freeze (`runtime/assurance/coordinator.ts`). |
| P15 | Devil's Advocate Audit for Medium and High risk. | T | `tests/technical-design-conformance-contract.test.ts` |
| P16 | Execution posture: record `test-first` or `characterization-first` when justified. | T | `tests/imm-planner-kernel-intent-contract.test.ts` |

## Executor prompt (`runtime/prompts/executor.md`)

| ID | Rule | Class | Enforcement point |
|---|---|---|---|
| E1 | Implement exactly the enrolled acceptance within the `scope_hint` envelope. | K | See L1. |
| E2 | Keep every edit inside the envelope; do not stage unrelated user files. | K | Envelope for paths (L1); unrelated staged files make the projection fail closed (`runtime/workspace_scope.ts`). |
| E3 | Do not discover or load a Pi Skill. | N | No detector found. |
| E4 | On a batch `handoff.role=executor`, implement only the named child and return after staging and diagnostics. | C | `runtime/unattended/batch_lanes.ts`, `runtime/unattended/batch_runner.ts`; `tests/unattended-contracts.test.ts` |
| E5 | Run the permitted diagnostic checks and stage task-owned changes before handoff. | K | Staging is checked (L3); running checks is N. |
| E6 | On rework, return the Delivery Evidence table; preserve failed and blocked attempts. | T | `tests/ceremony-trim-contract.test.ts`, `tests/role-prompt-bridge.test.ts` |
| E7 | The Loop runtime action only constructs the dispatch envelope; it stores no evidence. | K | Read-only dispatch construction; evidence enters only through Kernel operations. |
| E8 | Do not perform QA, review, plan mutation, successor approval, Compounder work or authority writes. | K | Independence and capability rules: `runtime/kernel/assurance_projection.ts`, `privileged` flag in the MCP tool table (`runtime/claude/mcp_server.ts:36`). |
| E9 | A same-directory addition: submit `revise_intent` with the complete next intent and continue. | K | See D6. |
| E10 | Beyond that (glob, new directory, removed entry, floor path, `docs/specs`, `docs/plans`), stop and return an `imm-planner` route. | K | Classifier returns breaking; the revision cannot apply without the native gate (D14). |
| E11 | Trace the real entry through state owner, write, serialization, reload and consumer; include both Hosts and recovery branches. | N | Judgment rule. |
| E12 | Use the real producer for the success control; derive rejection controls from a successful state. | N | Judgment rule; reviewed by Review. |
| E13 | Name whether each check consumed worktree or delivery bytes; on QA failure reproduce under delivery conditions. | N | S1 makes the conditions visible in the Tool result (D26); reproducing is N. |
| E14 | For rework, name the violated invariant, all known trigger classes and controls in Finding coverage. | T | `tests/ceremony-trim-contract.test.ts` |
| E15 | A defect inside goal and scope is ordinary rework; route to `imm-planner` only when goal, scope or commitment must change. | T | `tests/rework-root-cause-contract.test.ts` |
| E16 | Code Quality Guard: no mock or hard-coded success, no swallowed errors, no invented dependencies, no unauthorized behavior change. | N | Reviewed by independent Review; no mechanical check. |
| E17 | Keep the suite lean: search existing tests before adding; delete tests of retired behavior and name them. | N | `scripts/test-size-report.ts` reports size; nothing refuses a duplicate. |
| E18 | Autonomously repair ordinary local check failures within scope; stop for anything beyond the enrolled TaskIntent. | N | Judgment rule. |
| E19 | An unavailable or failing required check is an explicit blocker; never present failed verification as completion. | K | Completion needs fresh QA attestation (`runtime/kernel/completion.ts`). |

## Summary

Counts are taken from the class column of the section tables above. 132 rules in total.

| Section | K | H | C | T | N | Total |
|---|---|---|---|---|---|---|
| Execution Loop | 15 | 1 | 0 | 3 | 5 | 24 |
| Decisions and Recovery | 18 | 4 | 1 | 0 | 7 | 30 |
| Candidate Authoring | 7 | 0 | 17 | 3 | 8 | 35 |
| Enrolled Intent Revision | 3 | 3 | 1 | 1 | 0 | 8 |
| Core Responsibilities | 2 | 1 | 2 | 5 | 6 | 16 |
| Executor prompt | 8 | 0 | 1 | 3 | 7 | 19 |
| **Total** | **53** | **9** | **22** | **15** | **33** | **132** |

A quarter of the rules (33 of 132) have no enforcement point found, and another 15 are pinned only as wording. Of the 33, 24 are judgment or posture rules that no mechanism could check; the other 9 are procedural and appear in the next table.

## Rules with no enforcement point

These are the rules classed **N** that are procedural rather than judgment, so a mechanism could check them. This report does not recommend adding one; it records where the contract asks for something nothing observes.

| ID | Rule | What a check would need |
|---|---|---|
| L4 | Never stage a whole file that mixes user and task changes. | Hunk-level ownership of staged content. |
| L8 | Call `advance_assurance` in the foreground. | Host knowledge of how the Tool was invoked. |
| L24 | Do not poll or create detached jobs. | Host tool-call history. |
| C9 | Stage only the exact Planner-produced paths. | A staging diff against the Planner's output list. |
| C13 | Zero GitHub mutations before the review table is approved. | A recorded approval before the first tracker write. |
| C30 | No package installation, full suite, build or network in an acceptance command. | A descriptor lint over `command` and `prepare`. |
| D19 | Wait for a busy invocation before stop. | A busy flag on the claim. |
| E3 | Do not load a Pi Skill. | Host skill-load events. |
| E17 | Search existing tests before adding one. | A duplicate-setup detector. |

## Resolved inconsistency

Before this change, `runtime/plan_core.ts` (`validateSpecDesign`) treated a Spec that records any of `Design risk`, `Diagram decision` or `Diagram reason` as design-bearing, and then errored unless `Diagram decision` was `required` or `not_required` and a `Diagram reason` was present. The S4 Planner wording (rule P12, decision D10) tells the Planner to record neither diagram field when no diagram is needed, while still recording `Design risk`. A Spec written to the new wording and referenced by an archived prose Plan therefore failed that validator with two errors.

- **Reach**: the validator runs only from `runtime/v4_runtime.ts` for archived Plans (`projectPlanValidation`). No Kernel, Enrollment or Assurance path reads the field.
- **Resolution**: after the S4 Review, the validator was relaxed on the user's direct instruction (outside Managed). Diagram fields are optional; once either is recorded the pair must be complete, a `required` decision still needs Mermaid, and the explicit older `not_required` form still validates. This supersedes D10's "validator unchanged" and the S4 acceptance clause "runtime/plan_core.ts is unchanged" (the S4 Task itself settled with that file untouched).
- **Tests**: `tests/plan-validation.test.ts` pins the diagram-free form as accepted and an orphaned `Diagram reason` as rejected.
- **Review-1 sibling**: `docs/reference/planning-quality-gate.md` and its dist mirror carried the same older Mermaid sentence; both now match the Planner contract, and `tests/technical-design-conformance-contract.test.ts` pins the new text.

## Observations

- Most **K** rules are enforced at the seam where a result is *accepted*, not where an action is *taken*: the Kernel refuses a delivery, a verdict or a completion, but cannot prevent a model from editing, staging or choosing a route. Rules about *ordering* inside a turn (L17, L19 choice, D14 pre-confirmation) are therefore the weakest class even when a Kernel refusal backs the result.
- The **T** class protects wording from silent drift. It is the right owner for contract text that a later Slice moves or trims (as S4 did for the batch sections), but it adds no run-time protection.
- The Planner sections of **C** that cover the tracker are almost entirely **C**: the tracker validates its input before any remote write. That is the strongest block of mechanical enforcement outside the Kernel, and it is also the block with the most prose.
