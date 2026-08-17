---
name: imm-code-review
description: Use when reviewing code.
---

# Immune-Brain: Code Review

This skill adheres to the **[BASELINE.md](BASELINE.md)**.

## Workflow Profiles

Final review remains mandatory for Standard and Strict Plans and is always bound
to the runtime-provided changed-files signature. For Standard Plans, the last
passing gate atomically applies `imm-finish` when Compounder is optional and no
runtime trigger requires it. When `compounder_requirement.required` is true,
record the gate pass and hand off to Compounder instead. Standard same-boundary
follow-ups are capped at two; if `review_budget_state.budget_stop` is true,
do not open another follow-up and return diagnostic review or replanning as the
Next Action.

## Core Responsibilities

- **Progressive checklists**: For depth-first security, testing, performance, or accessibility reminders, use installed local reference material such as `docs/reference/agent-quality-checklists.md` when available and only load optional checklists when the diff warrants that lens. For **simplification** (reuse, quality, efficiency) when reviewing a branch diff or PR-scoped changeset where functional correctness is already verified, use `docs/reference/code-simplification-checklist.md` if it is present.
- **Structured Triage**: Review code outside a single active step. Triage CI/review feedback into actionable groups.
- **Evidence-Backed Findings**: Produce consistent findings with severity, impact, and proof.
- **Route Determination**: Decide whether issues fit the current repair boundary or require a new follow-up plan; describe that route in plain language so users do not need internal routing codes.
- **Runtime Host**: Serve as the first shared runtime host for explicit reviewer delegation in bounded review scenarios.

## Workflow Rules

- **Trigger Shape**: Use when broad technical review, review follow-up, or CI-style finding triage is actually needed. Do not keep `imm-code-review` as a default workflow stage for tasks that can stay on the mainline.
- **Minimal Execution**: Define review scope, build evidence list, classify findings, and build the `follow_up` handoff with `origin_review`. A same-boundary follow-up means the finding fits the current repair boundary and can be handed to `imm-work` as an execution artifact.
- **Repairability Routing**: The review describes whether each finding fits the current step boundary. Mark a direct repair as a same-boundary follow-up candidate and include same-boundary repair hints for `imm-work`; it does not itself mutate the Plan. If a finding requires different Plan semantics or Scope, route to a new sequential Plan after the current Plan reaches a terminal state.
- **Broad Baseline Layer**: remain the broad technical baseline in subagent-first review scenarios. Conditional advisory lenses join only when triggers are hit. If an advisory lens fails after a bounded retry, continue with `imm-code-review`.
- **Runtime Host Scope**: In runtime-host mode, `imm-code-review` is the first shared host that may explicitly activate bounded advisory lenses through `imm-advisory-reviewer`. Keep the lens set limited to the cataloged code-review lenses (`security`, `api_contract`, `data_integrity`, `reliability`); do not describe this skill as a shared registry or automatic dispatcher.
- **Delegation Gate**: Delegate only when the review subproblem is clearly bounded, non-blocking, the dedicated trigger surface is explicitly hit, and the environment supports reliable subagent activation. Otherwise stay solo and explain the fallback in plain language: boundary too unclear to delegate, no dedicated trigger surface matched, runtime environment unsupported, or dispatch cost exceeds expected benefit.
- **Delegation Packet**: When delegating to specialized advisory lenses, produce a layered delegation packet: one `shared_context_summary` for the full diff/task and one per-lens `focus_delta`. Include `tool_policy: no tools`, `fallback_reasons`, and the expected advisory output. Require every child finding to include `verification_criteria` as observable checks or failing test scenarios. Do not request exact patches from restricted reviewers.
- **Follow-up Routing**: When a finding is a direct same-boundary fix, emit a first-class `follow_up` handoff instead of asking `imm-planner` to modify a Plan. The handoff must include `scope`, `change_goal`, `verification_hint`, and the current checkpoint `changed_files_signature`, plus `origin_review: imm-code-review`; its Next Action points to `imm-work` so execution can continue from the follow-up artifact. Findings that cross the current boundary still require a new follow-up plan.
- **Zoom-Out Check**: before final findings, compare the diff with the global architecture, `CONTEXT.md` domain model, and user-visible workflow. Flag tunnel vision when a local fix contradicts broader ownership, vocabulary, or cross-step behavior.
- **Successor Authority Guard**: Review closes or reopens only the current review boundary. It cannot approve or activate a successor and must reject `--approve-successor`, `--expected-current-plan`, `--expected-ledger-revision`, and `--sync`. `awaiting_user_successor_decision` remains reserved for the literal user after required review gates close.

## Boundary

- **Allowed**: same shared baseline, plus inspect diffs, CI logs, and review threads.
- **Blocked**: same shared baseline, plus implementation/test edits, speculative fixes without evidence, successor approval, and successor activation.
- **Workflow guard**: route concrete fixes to `imm-pr-fix`/`imm-executor` and scope failures to `imm-planner`.

## Shared Dispatch Protocol

Follow the shared [`review-host-dispatch-protocol.md`](docs/reference/review-host-dispatch-protocol.md)
and [`subagent-dispatch-protocol.md`](docs/reference/subagent-dispatch-protocol.md).
Those documents own environment detection, activation policy, authorization,
packet construction, model resolution, retry/fallback, and result synthesis.
Authorization follows
[`subagent-dispatch-protocol.md#authorization-authority`](subagent-dispatch-protocol.md#authorization-authority).

Activation eligibility and authorization follow those shared protocols.
Do not invoke a retired activation planner or a missing dispatcher. Keep
`trigger_not_hit`, `explicit_required`, and `host_authorization_required`
distinct.

`imm-code-review` is the broad technical host. It uses catalog-driven
activation only for `security`, `api_contract`, `data_integrity`, and
`reliability` lenses. Pass the exact activation plan to the runtime packet
builder; do not hand-author packets or infer lenses from prose. A child finding
must include observable `verification_criteria`, and a degraded or solo result
must retain its fallback reason.

## Output artifact

`code_review` including: `result` in plain language (passes, needs fixes, or is blocked), `findings` (severity, summary, proof, `verification_criteria`), `next_actions`, and a `follow_up` handoff for direct same-boundary fixes. The `follow_up` handoff is an independent execution artifact, not a Plan mutation, and includes `scope`, `change_goal`, `verification_hint`, `changed_files_signature`, and `origin_review`.

When review dispatch falls back to solo, the `code_review` output must include `solo_fallback_reason` and `solo_fallback_meaning` so users see both the stable reason code and the plain-language meaning.

Optional dispatch summary (when subagent dispatch occurred): `dispatched_candidates` (list of activated reviewer skills), `dispatched_lenses` (list of activated advisory lenses), `solo_fallback_reason` (stable reason code for downstream metrics, if dispatch fell back), `solo_fallback_meaning` (why dispatch fell back to solo in plain language), `lens_findings_merged` (count of findings merged from advisory lenses), `failed_lenses`, `timed_out_lenses`, and `degraded_dispatch` (true when one or more dispatched lenses failed or timed out while others may have succeeded). This summary supports downstream dispatch metrics in `imm-compounder`.

## Next Action

Next Action: specify next skill, reason, and user confirmation needs. For direct same-boundary `follow_up` repairs, set the next skill to `imm-work` and state that `imm-work` should consume the pending follow-up artifact.

## Output style

Default user-facing shape: `Result -> Highest-signal findings -> Next action`. Surface only findings that materially change the next decision. If the route needs broader work, say directly that it requires a new follow-up plan.
