# Pocock Review Boundary Fixes

## Origin

Code review of pocock-inspired-improvements iteration found three authority/boundary misalignments in skill text.

## Accepted Behaviors

### 1. Brainstorm CONTEXT.md write vs read-only boundary
- Remove lazy-creation language from imm-brainstorm CONTEXT.md Awareness rule. Brainstorm surfaces conflicts and recommends terms but does not write CONTEXT.md itself. The planner or executor creates/updates CONTEXT.md when a term is resolved.

### 2. imm-work HANDOFF.md write vs coordinator boundary
- Add HANDOFF.md to imm-work Boundary Allowed list as an explicit exception for status convenience artifacts (parallel to its existing codex_plan.tasks sync).

### 3. New plan annotations not in imm-plan.py FIELD_RE (documentation-only fix)
- Clarify in planner skill text that `Verification type` and `Prototype` are advisory annotations read from raw plan text by executor/QA, not parsed into runtime state by imm-plan.py. This is the intentional design since the spec declared no Python tooling changes.

## Out of Scope
- Adding Verification type / Prototype to imm-plan.py FIELD_RE (deferred to a future tooling slice if runtime parsing is desired)
