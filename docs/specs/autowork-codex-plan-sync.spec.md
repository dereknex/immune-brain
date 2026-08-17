# Spec: autowork Codex plan sync

**Task ID**: IMM-WORKFLOW-008
**Owner**: Planner
**Status**: Proposed

## 1. Goal

Make `imm-autowork` return enough display-ready task state for Codex to refresh
the native task panel after an autowork run changes workflow state.

The `.imm/memory/current_iteration.json` State Ledger remains the source of
truth. Codex task display remains read-only.

## 2. Problem

`imm-work status --json` already exposes `codex_plan.tasks`, and the
`imm-autowork` skill contract says Codex should refresh the native task display
after autowork changes state.

In practice, the `imm_autowork` tool returns only a `run_snapshot`. If a run
records execution evidence or closes a Step through QA, the local State Ledger
can be correct while the Codex task panel still shows stale statuses unless the
host remembers to make a separate `imm-work status` call.

This creates the user-visible symptom: work is complete, but task status did
not update.

## 3. Requirements

### R1. Return the final Codex plan snapshot

Every `imm-autowork` snapshot should include the latest `codex_plan` from
`imm-work status` for the final stop boundary.

At minimum, `codex_plan.tasks` must be available to the host.

### R2. Preserve State Ledger authority

The added snapshot data is display-only. It must not become a writable state
source, must not mark Steps completed by itself, and must not change the
existing `imm-review` QA closure path.

### R3. Cover state-changing stop boundaries

The display snapshot must be correct for:

- execution evidence recorded and waiting for QA (`in_review`)
- QA pass that closes a Step (`completed`)
- budget stop after a pass
- true finished handoff to `imm-compounder`
- pending next Step after a completed Step

### R4. Keep packaged and source runtime aligned

The source runtime and packaged plugin runtime must expose the same autowork
snapshot shape.

### R5. Update host-facing contract wording

The `imm-autowork` skill contract should tell Codex to sync from
`run_snapshot.codex_plan.tasks` when present, falling back to `imm-work status`
only when the snapshot is unavailable or stale.

## 4. Acceptance Criteria

- [ ] `imm-autowork.py` snapshots include a `codex_plan` object with `tasks`.
- [ ] After execution evidence is recorded without a QA packet, the returned
      task for the active Step displays `in_review`.
- [ ] After a QA `pass`, the returned task for the closed Step displays
      `completed`.
- [ ] When a later Step remains available, the returned snapshot still shows
      the completed prior Step and pending next Step.
- [ ] Completed Plan handoff snapshots include display-ready task statuses and
      still set `handoff_only: true`.
- [ ] Packaged runtime and MCP adapter tests continue to pass.
- [ ] Skill contract text keeps Codex task sync read-only and does not introduce
      default QA pass behavior.

## 5. Non-goals

- No automatic QA pass.
- No Codex task display to `.imm` reverse sync.
- No new `imm-autowork-driver` skill.
- No new MCP tool.
- No background scheduler or streaming task update protocol.
- No State Ledger migration.

## 6. Compatibility

The `run_snapshot` shape changes additively. Existing fields remain available.
Callers that ignore `codex_plan` should continue to work.

If a host already calls `imm-work status` after autowork, the new snapshot is a
lower-friction equivalent for the final display refresh, not a competing source
of truth.
