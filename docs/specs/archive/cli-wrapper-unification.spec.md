# Spec: CLI Wrapper Unification for Hub Skill Verification Commands

## Summary

Hub skill Verification sections and `BASELINE.md` hardcode `python3 .imm/imm-plan.py`,
`python3 .imm/imm-work.py`, and `python3 .imm/imm-review.py`. These paths only exist in
the `agent-skills` repo itself. Other projects initialized via `imm-init` intentionally
receive no engine scripts (`.imm/imm-*.py`), relying on the installed CLI wrappers
(`imm-plan`, `imm-work`, `imm-review`, …). When an agent follows the Verification section
in another project's context it warns that `.imm/imm-plan.py` is missing — most
frequently at the `imm-planner` validation gate.

## Goal

Replace all `python3 .imm/imm-plan.py`, `python3 .imm/imm-work.py`, and
`python3 .imm/imm-review.py` references in agent-facing skill files with the portable CLI
wrapper forms (`imm-plan`, `imm-work`, `imm-review`). Also fix the `command` field emitted
by `imm-work.py` so the suggested activation command is CLI-portable.

## Scope

### In scope

- `skills/BASELINE.md` — Verification guidance wording (line 70)
- `skills/imm-planner/SKILL.md` — Rationalizations and Verification sections
- `skills/imm-work/SKILL.md` — Verification section
- `skills/imm-qa/SKILL.md` — Verification section
- `skills/imm-executor/SKILL.md` — Verification section
- `.imm/imm-work.py` — `command` field in `build_next_action`
- Reinstall via `scripts/legacy-installer.sh` to propagate changes to `plugin skill registry/`
  and `~/.immune-brain/runtime/agent-skills/.imm/`

### Out of scope

- Historical plan files under `docs/plans/` (closed, archival)
- `docs/solutions/` entries (evidence logs, not agent runtime reads)
- `.imm/specs/` files (closed specs, not agent runtime reads)
- Scripts with no installed CLI wrapper: `imm-telemetry`, `imm-upstream-sync`,
  `imm-compound-debt`, `imm-dev-insights`
- `imm-compounder/SKILL.md` compatibility fallback (`python3 .imm/imm-finish.py`)
  which is intentional and tested

## Requirements

R1. `rg "python3 .imm/imm-(plan|work|review)" skills/` returns zero matches.

R2. `BASELINE.md` Verification guidance names `imm-plan`, `imm-work`, `imm-review` as
the concrete command examples.

R3. `imm-work.py` `command` field uses `imm-work activate` form so agents in other
projects receive a working activation command.

R4. `python3 -m unittest tests.test_skill_contracts` exits zero after all changes.

R5. `zsh scripts/legacy-installer.sh --check` passes after reinstall.

## Acceptance checklist

- [ ] R1: `rg "python3 \.imm/imm-(plan|work|review)" skills/ --include="*.md"` returns zero matches
- [ ] R2: `BASELINE.md` contains `imm-plan … --json` in the Verification guidance line
- [ ] R3: `python3 .imm/imm-work.py continue` JSON shows `imm-work activate` in `command` field (testable with a mock/existing plan state)
- [ ] R4: `python3 -m unittest tests.test_skill_contracts` exits zero
- [ ] R5: `zsh scripts/legacy-installer.sh --check` passes
