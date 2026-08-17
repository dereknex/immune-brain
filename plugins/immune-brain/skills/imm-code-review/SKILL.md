---
name: imm-code-review
description: Use to review material code or behavior changes before completion; review and same-boundary follow-up handoff only, no direct edits.
---

# Immune-Brain: Code Review

Load [`../../dist/imm-code-review.md`](../../dist/imm-code-review.md), then review
the bounded change surface. Return actionable findings with evidence,
verification criteria, repairability, and Next Action. The final passing gate
atomically finishes a Standard Plan when Compounder is not required. Standard
same-boundary follow-ups are capped at two; a third finding routes to diagnostic
review or replanning instead of opening another repair round.

## Activation

Use the dist contract as source of truth. Activation eligibility and
authorization follow the shared review-host and subagent dispatch protocols;
do not invoke a retired activation planner or a missing dispatcher. Keep
`trigger_not_hit`, `explicit_required`, and `host_authorization_required`
distinct.
Direct same-boundary findings emit a `follow_up` handoff to `imm-work`; the
follow_up is not a Plan mutation.

Review cannot approve or activate a successor: reject `--approve-successor`, successor identity, and Ledger revision options. `awaiting_user_successor_decision` remains reserved for the literal user after all current-boundary review gates close.
