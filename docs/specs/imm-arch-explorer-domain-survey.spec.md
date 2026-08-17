# Spec: Parallel Domain Survey for imm-arch-explorer

## Objective
Extend `imm-arch-explorer` with a Parallel Domain Survey capability to allow concurrent, read-only exploration of different codebase modules, improving efficiency and context usage when identifying architectural seams.

## Background
Currently, `imm-arch-explorer` operates sequentially. When tasked with finding shallow modules or inconsistent domain boundaries in a large codebase, it must read multiple directories one by one. This exhausts the context window and takes significant time. `imm-brainstorm` and `imm-planner` already have "Research Dispatch" protocols to address similar multi-domain discovery challenges.

## Requirements
1. **Add Research Dispatch Protocol**: Update `skills/imm-arch-explorer/SKILL.md` with a `## Dispatch Protocol` section specifically for "Parallel Domain Survey".
2. **Read-only Enforcement**: Delegated survey subagents must be `generalPurpose` and strictly `readonly: true`.
3. **Budget and Triggers**: Only dispatch when the user requests broad architecture exploration spanning multiple top-level directories or domains.
4. **Subagent Output**: Subagents return bounded structural summaries (affected files, evidence of coupling, missing domain vocabulary) to the explorer host.
5. **Contract Coverage**: Add a test in `tests/test_skill_contracts.py` to verify `imm-arch-explorer` includes the new dispatch rules.

## Design Decisions
- **D1: No Python Runtime Shims**: Unlike `imm-code-review`, this is an ad-hoc research dispatch (similar to brainstorm/planner). It will rely entirely on the LLM's understanding of the `docs/reference/subagent-dispatch-protocol.md` via the Prompt Contract and the Cursor Task tool or Codex `spawn_agent`. No new Python parser or activation plan changes are needed.
- **D2: Re-use generalPurpose**: We will not create a new specific subagent role for "domain mapper". `generalPurpose` with a bounded prompt is sufficient and avoids registry bloat.

## Out of Scope
- Automated implementation of proposed architectural changes.
- Persistent background domain mappers.
- modifications to `imm-plan.py` or `.imm/imm_core/`.
