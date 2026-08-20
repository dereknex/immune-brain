---
title: Pro-workflow compaction handoff integration
reusability: high
next_reuse_scenarios:
  - Adding a new upstream reference repo with host-specific behavior differences
  - Surviving context compaction without losing active Plan and Step
  - Extending HANDOFF.md with machine-readable mirrors in state.json
  - Hardening imm-dehydrate CLI overlays for optional JSON logic_state
key_files:
  - docs/reference/upstream-pro-workflow-borrow-map.md
  - docs/reference/compaction-handoff-hosts.md
  - docs/reference/HANDOFF-template.md
  - docs/specs/archive/pro-workflow-compaction-handoff.spec.md
  - skills/imm-work/SKILL.md
  - .imm/imm-dehydrate.py
  - upstreams/pro-workflow
---

# Pro-workflow compaction handoff integration

## Reusable premise

When borrowing session-survival patterns from upstream agent packs (for example
[rohitg00/pro-workflow](https://github.com/rohitg00/pro-workflow)), adapt them
as **dual-write continuity** rather than a second memory authority:

1. **Human layer**: `HANDOFF.md` **Compaction Handoff** section (written by
   `imm-work` after QA pass or before compaction).
2. **Machine layer**: `logic_state.compaction_handoff` in `.imm/memory/state.json`
   via `imm-dehydrate --logic-state <file.json>` so `--rehydrate` prints active
   plan, step, priority files, and next boundary.

`.imm/memory/` remains source of truth; `HANDOFF.md` is a convenience artifact
per existing boundary exception.

## Evidence

- Plan `docs/plans/2026-05-19-003-feat-pro-workflow-compaction-handoff-plan.md`
  closed U1–U4 with QA pass on recorded evidence.
- Submodule `upstreams/pro-workflow` registered; borrow-map documents P0/P1/P2/P3
  tiers and explicit non-goals (no SQLite authority, no hook bundling, no
  orchestrator replacement).
- `docs/reference/compaction-handoff-hosts.md` documents Codex, Claude Code, and
  Cursor rituals; Claude hooks stay user-installed reference only.
- `imm-work` **Compaction Handoff** workflow rule links template and host guide;
  `tests/test_skill_contracts.py::test_work_has_compaction_handoff_rule` locks
  contract text.
- `imm-dehydrate` round-trips `compaction_handoff`; `load_logic_state_file`
  raises `ValueError` with path on malformed JSON (code-review follow-up);
  `tests/test_workflow_loop.py` covers missing, malformed, and valid paths.

## Integration checklist (next upstream slice)

1. Submodule under `upstreams/<name>` plus README enumeration.
2. `docs/reference/upstream-<name>-borrow-map.md` with P0/P1/P2/P3 and non-goals.
3. Map each write surface to an Immune-Brain role before implementation (see
   `docs/solutions/upstream-pattern-integration-boundary-discipline.md`).
4. Prefer reference docs and skill rules over vendoring host hooks into the repo.
5. Contract-test skill phrases that encode the new workflow rule.

## Compaction priority files

Pro-workflow documents Claude Code post-compact restore limits (~5 files, ~50K
token budget). The HANDOFF template caps **Files in play (compaction priority)**
at five paths so agents reload the highest-signal files first after compaction.

## Next reuse scenarios

- Before manual or automatic compaction, run dehydrate plus verify HANDOFF
  Compaction Handoff section is populated.
- When evaluating pro-workflow P1 items (hooks, bug-capture), keep hooks
  user-level and route features through existing `imm-*` roles.
- When adding `--logic-state` consumers, test file-load error paths explicitly.
