# Iteration Plan: CLI Wrapper Unification for Hub Skill Verification Commands

## Task

- Summary: Replace `python3 .imm/imm-plan.py`, `python3 .imm/imm-work.py`, and `python3 .imm/imm-review.py` in hub skill Verification sections and BASELINE.md with portable CLI wrapper commands, fix the command field in imm-work.py, and reinstall to propagate changes.
- Origin: imm-brainstorm framing; root cause is BASELINE.md Verification guidance hardcoding agent-skills-repo-local paths that do not exist in other projects using the installed CLI.
- Spec: `.imm/specs/cli-wrapper-unification.spec.md`

## Research

- `skills/BASELINE.md:70` — names `python3 .imm/imm-plan.py … --json`, `python3 .imm/imm-work.py`, `python3 .imm/imm-review.py` as the concrete command examples in Verification guidance.
- `skills/imm-planner/SKILL.md:70,82,88` — Rationalizations and Verification use `python3 .imm/imm-plan.py`.
- `skills/imm-work/SKILL.md:77,78` — Verification uses `python3 .imm/imm-work.py status` and `python3 .imm/imm-work.py record-execution`.
- `skills/imm-qa/SKILL.md:70,71` — Verification uses `python3 .imm/imm-work.py status --json` and `python3 .imm/imm-review.py`.
- `skills/imm-executor/SKILL.md:82,84` — Verification uses `python3 .imm/imm-work.py status --json` and `python3 .imm/imm-review.py`.
- `.imm/imm-work.py:314` — `command` field emits `python3 .imm/imm-work.py activate …`.
- `tests/test_skill_contracts.py:817` — asserts `.imm/` still appears in hub skill content (`.imm/memory/` path satisfies this).
- `imm-compounder/SKILL.md` — intentional `python3 .imm/imm-finish.py` fallback tested at `test_skill_contracts.py:114`; excluded from scope.
- Scripts with no CLI wrapper (`imm-telemetry`, `imm-upstream-sync`, `imm-compound-debt`, `imm-dev-insights`) excluded.

## Decisions

- CLI wrapper forms (`imm-plan`, `imm-work`, `imm-review`) are the canonical commands for agents in any project context; the `python3 .imm/` forms are implementation details of the agent-skills repo only.
- `.imm/memory/current_iteration.json` references remain unchanged; they satisfy the `.imm/` substring assertion in `test_skill_contracts.py`.
- Reinstall via `scripts/legacy-installer.sh` is part of the same outcome as the edit; both steps together constitute the closed result.

## Assumptions

- `~/.local/bin/imm-plan`, `imm-work`, `imm-review` are in PATH in other project environments (legacy-installer.sh installs them).
- The CLI wrapper for `imm-review` passes arguments through to `imm-review.py` (confirmed: `imm-plan|imm-work|imm-review|imm-heal|imm-dehydrate|imm-finish` all handled by the launcher).

---

### Step 1

- Step ID: U1
- Result: Hub skill Verification sections use `imm-plan` / `imm-work` / `imm-review` CLI forms instead of project-local `python3 .imm/imm-*.py` paths
- Verification: `rg "python3 \.imm/imm-(plan|work|review)" skills/ --include="*.md"` returns zero matches; `python3 -m unittest tests.test_skill_contracts` exits zero
- Depends on: None

### Step 2

- Step ID: U2
- Result: The `imm-work.py` `command` field emits `imm-work activate …` with all installed skill copies refreshed from the updated sources
- Verification: `grep "imm-work activate" .imm/imm-work.py` shows the updated field; `zsh scripts/legacy-installer.sh --check` passes; `python3 -m unittest tests.test_skill_contracts` exits zero
- Depends on: 1
