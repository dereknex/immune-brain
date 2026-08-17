# Iteration Plan: Claude Code Install Support

## Task

- Summary: Add native Claude Code installation support to the existing legacy-installer.sh script
- Origin: imm-brainstorm
- Spec: `.imm/specs/claude-code-install.spec.md`

## Research

- `legacy-installer.sh` currently targets `plugin skill registry/` (Cursor/Codex) with a managed copy approach using `.imm-install-source` marker files.
- `~/.claude/skills/` already has skills installed from this repo (via a previous manual run), with the same marker file format — confirming the copy mechanism works for the target.
- Skills reference `docs/reference/` via relative paths from `skills/*/SKILL.md`, which the AI reads as text guidance; no reference files needed at `~/.claude/docs/reference/`.
- CLI wrappers at `~/.local/bin/` (`imm-plan`, `imm-work`, etc.) are already shared between agents and do not need reinstallation.

## Decisions

- D1: Add `--claude` flag to `legacy-installer.sh` that sets a separate target variable for `~/.claude/skills/`, reusing the existing copy-install functions for skills only.
- D2: The `--claude` install path skips CLI wrappers, CLI runtime, and reference artifacts.
- D3: `--check --claude` and `--uninstall --claude` operate on the `~/.claude/skills/` target separately.
- D4: `--claude` can combine with `--enable-dev-insights` (dev insights are agent-independent).
- D5: Use `--claude` as an orthogonal flag (like `--enable-dev-insights`), not a mode that replaces `--copy`.

## Assumptions

- `~/.claude/skills/` exists or can be created; no pre-existing permissions issues.
- The managed copy marker format (`.imm-install-source` with `family=agent-skills`) is sufficient to identify repo-owned skills in `~/.claude/skills/` for uninstall.

## Brainstorm Manifest

| ID | Item | Status |
|---|---|---|
| BR-REQ-1 | `--claude` flag, target: `~/.claude/skills/` | covered_by_step |
| BR-REQ-2 | `--check --claude` verification | covered_by_step |
| BR-REQ-3 | `--uninstall --claude` cleanup | covered_by_step |
| BR-REQ-4 | `mise.toml` tasks | covered_by_step |
| BR-REQ-5 | README documentation update | covered_by_step |
| BR-DEC-1 | Add `--claude` to existing `legacy-installer.sh` | captured_as_decision |
| BR-DEC-2 | Target `~/.claude/skills/` | captured_as_decision |
| BR-DEC-3 | Skills only, no CLI/runtime/reference | captured_as_decision |

---

### Step 1

- Step ID: U1
- Result: Claude Code installation support is operational via `--claude` flag
- Verification: `zsh scripts/legacy-installer.sh --claude` installs skills to `~/.claude/skills/` and `zsh scripts/legacy-installer.sh --check --claude` reports `✅` for all skills; `mise run install-claude` also works; README documents the new commands
- Verification type: manual (execute install, check, and uninstall commands)
- Depends on: None

#### U1 Details

Implementation tasks within U1:
1. Modify `scripts/legacy-installer.sh` to add `--claude` flag
   - Add `CLAUDE_TARGET_DIR="${HOME}/.claude/skills"` variable
   - Parse `--claude` flag in the argument loop
   - In install phase: when `--claude` is set, install skills to `CLAUDE_TARGET_DIR` (skip CLI/runtime/reference)
   - In check phase: when `--claude` is set, check `CLAUDE_TARGET_DIR` skills
   - In uninstall phase: when `--claude` is set, uninstall from `CLAUDE_TARGET_DIR`
   - Reuse existing `is_managed_skill_copy`, `write_skill_copy_marker`, `skill_copy_marker_path`, and `prepare_skill_target_for_install` functions
   - Skip BASELINE.md handling (currently sourced from `SOURCE_SKILLS_DIR/BASELINE.md`, check if it exists for Claude target too)
   - Ensure `--claude --uninstall` only removes marker-owned directories
2. Update `mise.toml` with tasks:
   - `install-claude` → `zsh scripts/legacy-installer.sh --claude`
   - `check-claude-install` → `zsh scripts/legacy-installer.sh --check --claude`
   - `uninstall-claude` → `zsh scripts/legacy-installer.sh --uninstall --claude`
3. Update `README.md`:
   - Add "Install to Claude Code" section after "安装到本地 Codex"
   - Document `mise run install-claude`, `mise run check-claude-install`, `mise run uninstall-claude`
   - Note that CLI wrappers at `~/.local/bin/` are shared

#### U1 Evidence

- `scripts/legacy-installer.sh --help` shows `--claude` in the option list
- `grep -n "CLAUDE_TARGET_DIR" scripts/legacy-installer.sh` returns line
- `grep -n "claude" mise.toml` returns 3 task definitions
- `grep -n "Claude Code" README.md` returns matches in new section
- After install: `cat ~/.claude/skills/imm-brainstorm/.imm-install-source` confirms managed copy marker
