# Automatic Subagent Activation Policy

This reference defines the structured contract for session-scoped automatic
subagent activation. It is intentionally narrower than a shared runtime
dispatcher: a named host skill reads deterministic trigger rules, builds an
activation plan, then uses the existing dispatch protocol.

## Scope

Allowed:

- Host-bound activation under `imm-code-review` and `imm-ui-review`.
- Deterministic matching against `docs/reference/subagent-trigger-catalog.yaml`.
- Bounded advisory lenses run through `imm-advisory-reviewer`: `security`,
  `api_contract`, `data_integrity`, `reliability`, `ui_a11y`,
  `ui_responsive`, `ui_i18n`, `ux_heuristic`, and `ui_visual`.
- Advisory-only child output synthesized by the parent host.

Blocked:

- Shared runtime registry or automatic fan-out across all reviewers.
- Background queues, cross-session scheduling, or agent-to-agent communication.
- Any advisory lens gaining scope, execution, plan-write, or QA authority.
- LLM-only routing in the first implementation slice.

## Inputs

The activation planner consumes already-available structured context from the
host. It should not inspect files itself, run commands, call tools, or invoke
subagents.

```text
activation_input:
  host: imm-code-review | imm-ui-review
  stage: review | planning_review | work_review | ui_review
  changed_paths: [path, ...]
  task_summary: <short text>
  explicit_solo: true|false
  explicit_subagents: true|false
  activation_mode: auto|explicit_only|disabled
  activation_overrides: {hosts: {<host>: auto|explicit_only|disabled}, lenses: {<lens>: auto|explicit_only|disabled}, subagents: {<id>: auto|explicit_only|disabled}}
  bounded_parallelizable: true|false
  dispatch_available: true|false
```

`changed_paths` and `task_summary` are enough for the first slice. Future
fields can be added only if they remain deterministic inputs to the same
host-bound planner.

`activation_mode` is the resolved Pi-local default for the workflow host call. Pi
reads it from `~/.pi/agent/immune-brain/config.toml` before invoking the pure
planner. `activation_plan.py` must not read user config directly.

`activation_overrides` uses plural map keys (`hosts`, `lenses`, `subagents`) to
mirror `config.toml`. The planner also accepts legacy singular map keys
(`host`, `lens`, `subagent`); a scalar `host` mode is accepted as a host-call
shorthand because the planner invocation always targets one host.

Runtime support status: the TypeScript CLI runtime currently consumes only
`activation_mode` and `hosts[host]`. `lenses` and `subagents` override tables
are documented for forward compatibility and parse correctly, but are not yet
consumed by the activation planner.

## Output

```text
activation_plan:
  host: imm-code-review | imm-ui-review
  candidates: [imm-advisory-reviewer, ...]
  lenses: [security|api_contract|data_integrity|reliability|ui_a11y|ui_responsive|ui_i18n|ux_heuristic|ui_visual, ...]
  candidate_lenses: {<candidate_id>: [<lens>, ...]}
  parallel_allowed: true|false
  rationale_codes: [security_trigger|api_contract_trigger|data_integrity_trigger|reliability_trigger|ui_a11y_trigger|ui_responsive_trigger|ui_i18n_trigger|ux_heuristic_trigger|ui_visual_trigger, ...]
  model_tiers: {<candidate_id>: fast|mid|strong|inherit, ...}
  lens_model_tiers: {<lens>: fast|mid|strong|inherit, ...}
  solo_fallback_reason: none|trigger_not_hit|unclear_boundary|unavailable_environment|cost_scope_mismatch|explicit_required|config_disabled|host_authorization_required|user_requested
```

`lenses` must be stable and ordered. For this slice, the allowed order is
role-specific: `imm-code-review` uses `security`, `api_contract`,
`data_integrity`, then `reliability`; `imm-ui-review` uses `ui_a11y`,
`ui_responsive`, `ui_i18n`, `ux_heuristic`, then `ui_visual`. Role-specific max
parallel limits first select triggered lenses by match strength (`keyword`,
then `specific_path`, then `generic_path`) and then return the selected lenses
in the stable host order. `candidates` is the de-duplicated skill list required
to run those lenses, currently `imm-advisory-reviewer`.

`lens_model_tiers` maps each triggered lens to the semantic tier declared in
the trigger catalog. `model_tiers` maps each candidate to the strongest tier
required by its triggered lenses and exists as a candidate-level fallback. When
`solo_fallback_reason` is not `none`, `candidates` and `lenses` are empty and
the tier maps are `{}`. Human-facing summaries should use the plain-language
meaning, with the code kept only as the stable machine reference.

Plain-language meanings for `solo_fallback_reason`:

| Code | Meaning |
|------|---------|
| `none` | dispatch can proceed |
| `trigger_not_hit` | no advisory lens trigger matched the current work |
| `unclear_boundary` | the review subproblem is not clean enough to delegate |
| `unavailable_environment` | the runtime cannot reliably launch advisory reviewers |
| `cost_scope_mismatch` | delegation overhead is higher than expected benefit |
| `explicit_required` | configuration requires an explicit subagent request |
| `config_disabled` | configuration disabled subagent dispatch for this scope |
| `host_authorization_required` | triggers matched, but the host requires explicit authorization before spawning subagents |
| `user_requested` | the user explicitly asked to stay solo |

## Global activation modes

All subagent-capable hosts must honor the local `[subagent_activation]` policy
documented in [`immune-brain-config.md`](immune-brain-config.md). The allowed
modes are:

- `auto`: dispatch may proceed when trigger, boundary, environment, and cost
  gates pass.
- `explicit_only`: dispatch may proceed only when the user explicitly requests
  subagents, parallel research, specialist review, party advisory, or an
  equivalent delegated review.
- `disabled`: dispatch must not proceed, even when trigger surfaces match.

Precedence is: explicit user solo, lens or subagent override, host override,
global default, repo default. When `explicit_only` blocks dispatch, return
`solo_fallback_reason: explicit_required`. When `disabled` blocks dispatch,
return `solo_fallback_reason: config_disabled`. These outcomes must not be
reported as `trigger_not_hit`, because the trigger may have matched.

Activation eligibility and host authorization are separate gates. The
activation planner answers whether dispatch is eligible from config, trigger,
boundary, environment, and cost inputs. After a plan returns candidates, apply
[Subagent Dispatch Protocol: Authorization Authority](subagent-dispatch-protocol.md#authorization-authority)
before calling any dispatch primitive. This policy does not duplicate
precedence or user-facing authorization wording.

## Model tiers and user config

- **Catalog (repo):** Each child in `docs/reference/subagent-trigger-catalog.yaml`
  may set `model_tier` to `fast`, `mid`, `strong`, or `inherit`. Omitted field
  defaults to `inherit` (child inherits the host model; no behavior change).
- **User mapping (machine):** Optional tier overrides live in Pi's local
  `~/.pi/agent/immune-brain/config.toml` under `[subagent_models]`.
- **Dispatch:** The host skill resolves tier → configured model id before Phase 4
  invocation. `activation_plan.py` does **not** read `config.toml`; resolution is
  documented in `docs/reference/subagent-dispatch-protocol.md` Phase 4.

## Catalog metadata refs

The catalog may declare `policy_ref` and `spec_ref` (paths relative to the repo
root). Catalog `policy_ref`/`spec_ref` integrity is enforced by build and
package contract tests rather than a runtime command. Default catalog loading
used for normal plan output does not invoke a retired wrapper or dispatcher.

## Split Gate

The policy inherits the split gate from
`docs/specs/workflow-skill-subagent-orchestration.spec.md`:

- Split only when the review subproblem is bounded and non-blocking.
- Stay solo when the user explicitly asks for solo work.
- Stay solo when the environment lacks reliable dispatch support.
- Stay solo when no trigger surface is hit.
- Stay solo when dispatch cost is larger than the review benefit.

## Host Behavior

`imm-code-review` remains the broad technical baseline. It uses the activation
plan only to decide whether to attach specialized advisory reviewers during
Phase 2 trigger matching. The parent host still owns result synthesis, duplicate
removal, conflict handling, retry/fallback accounting, and the final review
artifact.

`imm-ui-review` uses the same host-bound planner for UI-specific advisory
reviewers. It can attach accessibility, responsive-layout, i18n/localization,
UX-heuristic, and visual-polish reviewers while keeping synthesis and final
judgment inside the parent `imm-ui-review` host.

Child reviewers keep their existing boundaries:

- `tool_policy: no tools`
- no code edits
- no plan writes
- no workflow-state mutation
- no QA closure

## Verification

The implementation must include golden tests for at least these cases:

- security-only trigger
- API-contract-only trigger
- data-integrity-only trigger
- reliability-only trigger
- UI accessibility trigger
- UI responsive-layout trigger
- UI i18n/localization trigger
- UI visual-polish trigger
- multi-trigger capped parallel dispatch
- no trigger fallback
- explicit solo fallback

Contract tests should also assert that this policy remains host-bound and does
not introduce a shared registry, background scheduler, or default reviewer gate.
