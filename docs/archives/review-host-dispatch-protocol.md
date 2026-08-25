# Review Host Dispatch Protocol

This is the shared dispatch contract for `imm-code-review` and
`imm-ui-review`. Review Skills select the review surface; this document owns
the repeated lifecycle.

## Shared lifecycle

1. Detect whether Pi can dispatch advisory subagents. If it cannot, run the
   review solo and record `unavailable_environment`.
2. Resolve `[subagent_activation]` and explicit user intent before trigger
   matching. `explicit_solo` is reserved for an explicit no-subagents request.
3. Build a bounded `activation_input` and call the plugin-local activation
   runtime before preparing packets. Candidates are eligibility, not
   authorization.
4. Apply the authorization authority from
   [`subagent-dispatch-protocol.md`](subagent-dispatch-protocol.md), then build
   one layered packet per selected lens or specialist. Every packet carries one
   shared context, one focus delta, `tool_policy: no tools`, an advisory-only
   boundary, and observable `verification_criteria`.
5. Resolve models from lens override, tier mapping, candidate fallback, then
   Pi model inheritance. Dispatch only authorized envelopes and keep non-overlapping
   work parallel.
6. Normalize child results, deduplicate findings, preserve attribution and
   degraded/fallback status, and synthesize the parent-owned review artifact.
7. Retry one failed child once. After the retry, continue with explicit solo
   coverage and record the fallback reason. Never claim delegated review when it
   did not occur.

## Shared boundaries

Review hosts inspect and route findings; they do not edit code, write Plans,
approve successors, mutate workflow state, or close QA. A same-boundary repair
uses a `follow_up` handoff with `scope`, `change_goal`, `verification_hint`,
`changed_files_signature`, and `origin_review`; broader scope returns to
Planner.

## Host deltas

- `imm-code-review` is the broad technical baseline and may activate only the
  cataloged code-review lenses: `security`, `api_contract`, `data_integrity`,
  and `reliability`.
- `imm-ui-review` owns UI checkpoints and may activate bounded accessibility,
  responsive, i18n, visual, design-contract, or UX heuristic specialists. Its
  host checkpoint always runs even when specialist dispatch degrades.
