# HANDOFF.md Template

Reference template for the `HANDOFF.md` file at project root.

Ownership is split. Everything between the `GENERATED` markers is derived from
the State Ledger and rewritten by the runtime on every `imm-review pass`; edits
there are lost on the next pass. Everything outside the markers is narrative the
runtime cannot derive, and the runtime preserves it untouched. A `HANDOFF.md`
without markers is adopted on the first pass: the block is inserted below the
title and existing content is kept.

## Standard sections

```markdown
# Immune-Brain Handoff

<!-- GENERATED: immune-brain-handoff-state -->
## Current state

- Plan: `<plan path>`
- Summary: <one-line plan summary>

### Completed steps

- <Step ID>: <Result line>

### Active step

- <Step ID>: <Result line>

### Known blockers

- <Step ID>: <failure exit>
<!-- END GENERATED: immune-brain-handoff-state -->

## Decisions this session

<judgement calls a reader would not recover from the Ledger>

## Files in play

<the few files that matter most on reload, highest priority first>
```

## Compaction Handoff section

Appended when compaction is imminent or at each QA pass. Fields match spec R2.

```markdown
## Compaction Handoff

### Active plan
<relative plan path>

### Active step
Step <N> (<Step ID>): <Result line>

### Files in play (compaction priority)
1. <path> — <reason: actively editing / test target / config>
2. <path> — <reason>
(max 5; these are the files the agent should reload first post-compact)

### Uncommitted work
<N> files modified, <M> untracked
Top paths: <path1>, <path2>

### Decisions this session
- <decision 1>
- <decision 2>
(not a substitute for ADR/solutions; temporary session context)

### Next boundary
<imm-work | imm-qa | imm-executor> — <one-line reason>
```

## Successor decision (non-authoritative mirror)

Include this section only when the current Plan declares a non-terminal successor. Copy the values from a fresh runtime checkpoint; do not infer them from filenames or prose.

```markdown
## Successor decision (non-authoritative mirror)

- Current Plan: <canonical relative Plan path>
- Current Phase: <stable Phase ID>
- Closure/review state: <closed and reviewed | unresolved boundary>
- Successor candidate: <stable Phase ID>
- Successor preconditions: <declared preconditions>
- Expected Ledger revision: <opaque lowercase revision>
- Next user decision: <create and validate | explicitly approve a validated successor Plan>
- Deferred scope: <remaining Roadmap scope or explicit reference>
```

This mirror may be stale. The State Ledger plus a fresh validated Plan read remains authoritative, and HANDOFF must never be parsed as transition authority. A placeholder successor path is not executable approval.

## Machine-readable mirror (retired)

A machine-readable mirror of these fields was once specified for `imm-dehydrate`
to store under `logic_state.compaction_handoff` in `.imm/memory/state.json`. That
whole path is retired: the command is gone, `state.json` is deleted, and spec R3
is withdrawn. `HANDOFF.md` is the only place the compaction fields live, which is
why the narrative sections below the generated block matter. The shape below is
kept for historical reference only.

```json
{
  "compaction_handoff": {
    "active_plan": "<relative plan path>",
    "active_step_id": "<Step ID>",
    "active_step_result": "<Result line>",
    "priority_files": ["<path1>", "<path2>"],
    "uncommitted_summary": "<N files modified, M untracked>",
    "session_decisions": ["<decision 1>"],
    "next_boundary": "<skill name>"
  }
}
```

## Notes

- `imm-work` owns HANDOFF.md writes (boundary exception documented in skill)
- `.imm/memory/` is the source of truth; HANDOFF.md is a convenience artifact
- Priority files list is advisory (max 5) and exists only to make Pi session continuation faster
