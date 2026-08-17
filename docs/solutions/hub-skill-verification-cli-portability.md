---
title: Hub Skill Verification Commands Must Use CLI Wrapper Forms
reusability: high
next_reuse_scenarios:
  - Adding a new CLI wrapper and needing to update skill documentation
  - Writing a new hub skill Verification section from scratch
  - Diagnosing agents warning about missing .imm/*.py in other projects
---

# Pattern: Hub Skill Verification Commands Must Use CLI Wrapper Forms

**领域**: Agent skill documentation / CLI portability  
**描述**: Hub skill Verification sections and BASELINE.md guidance must reference CLI wrapper
commands (`imm-plan`, `imm-work`, `imm-review`) rather than project-local script paths
(`python3 .imm/imm-plan.py`). The CLI layer is the portable interface that works in every
deployment context; the `.imm/` scripts are the implementation detail of the agent-skills
development repo only.

## 问题背景

`imm-init` intentionally blocks copying engine scripts into other projects (Boundary:
"Blocked: runtime engine copies"). Other projects only get the directory structure
(`.imm/memory/`, `.imm/specs/`, etc.), not the Python scripts.

The CLI wrappers (`~/.local/bin/imm-plan`, `imm-work`, `imm-review`, …) proxy to
`~/.immune-brain/runtime/agent-skills/.imm/` — the global runtime installed by
`scripts/install-local.sh`. This is the intended execution path in all non-development
contexts.

`BASELINE.md` Verification guidance previously told hub skill authors to use
`python3 .imm/imm-plan.py … --json` as the "concrete commands grounded in this
repository." This caused all four hub skills to carry `python3 .imm/` forms in their
Verification sections. Agents following those sections in other projects generated:

> 本仓库的计划文件存在，但 `.imm/imm-plan.py` 脚本不在当前 worktree 根目录，这会影响最终校验

The warning appeared most frequently at the `imm-planner` validation gate (where
`imm-plan --json` is the last pre-execution check).

## 经验规则

1. **Verification sections reference the CLI layer, not the script layer.**  
   The correct forms are `imm-plan <path> --json`, `imm-work status --json`,
   `imm-review pass|rework|replan --evidence …`. These work in any project.

2. **BASELINE.md Verification guidance sets the template for future hub skills.**  
   Any change to Verification guidance wording propagates to all future hub skills that
   are authored or maintained. Keep the template CLI-portable.

3. **`.imm/memory/` path references are still valid and expected.**  
   `BASELINE.md` and hub skill Verification sections may still reference
   `.imm/memory/current_iteration.json` as the state source of truth. That path is
   created by `imm-init` in every project. Only the script paths (`.imm/imm-plan.py`,
   `.imm/imm-work.py`, `.imm/imm-review.py`) are absent in other projects.

4. **The `command` field emitted by runtime scripts should also be CLI-portable.**  
   `imm-work.py` `build_next_action` emits a `command` field that agents display and
   copy-paste. That field should use `imm-work activate …`, not
   `python3 .imm/imm-work.py activate …`.

5. **Canary symptom: "`.imm/imm-plan.py` 不在当前 worktree 根目录".**  
   When an agent produces this warning in another project, the fix is in skill Verification
   documentation, not in script deployment. Check BASELINE.md and hub skill Verification
   sections for any remaining `python3 .imm/imm-*.py` forms.

## 验证依据

- `rg "python3 \.imm/imm-(plan|work|review)" skills/` returns zero matches after fix.
- `python3 -m unittest tests.test_skill_contracts` 97 tests pass — the
  `test_hub_skills_include_anatomy_sections_and_repo_commands` assertion on `.imm/`
  is satisfied by `.imm/memory/current_iteration.json` references that remain in place.
- `grep "imm-work activate" .imm/imm-work.py` confirms the runtime command field.
- `zsh scripts/install-local.sh --check` passes after reinstall propagates changes to
  `~/.agents/skills/` and `~/.immune-brain/runtime/agent-skills/.imm/`.

## 相关文档

- `docs/solutions/imm-workspace-pollution-control-pattern.md` — project-level migration of `python3 .imm/imm-*` execution entries
- `docs/solutions/imm-workspace-pollution-migration-path.md` — rollback steps for project-level entries
- `docs/solutions/role-entrypoint-contract-separation.md` — authority role vs CLI continue entry separation

---
*沉淀日期: 2026-05-13 | 来源: `docs/plans/2026-05-13-078-fix-cli-wrapper-unification-plan.md`*
