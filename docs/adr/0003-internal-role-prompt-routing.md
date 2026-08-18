---
status: accepted
---

# Internal Role Prompt Routing

Architecture exploration, bounded advisory review, and post-closure Learning capture use internal role prompts dispatched through the existing Parent/Loop bridge. Brainstorm and Planner may select read-only `arch-explorer` or `advisory-reviewer` roles; Loop may dispatch `compounder` only when closed Step evidence proves a reusable Learning. This preserves coordinator authority and removes the need for separate public Skill entry points while public shims remain only through the Issue #9 migration milestone.

## Consequences

- Canonical prompt bytes live under `plugins/immune-brain/runtime/prompts/` and the packaged copies under `plugins/immune-brain/dist/role-prompts/`.
- Architecture exploration remains advisory and cannot write Plans, Specs, workflow state, or QA decisions.
- Compounder remains post-closure and evidence-backed; routine work without reusable evidence terminates without creating a Learning.
- ADR-0001's standalone public architecture-explorer entry point is superseded by this internal routing decision.
