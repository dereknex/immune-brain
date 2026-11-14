---
"immune-brain": minor
---

Expose `imm-loop` as a standalone public Skill across Pi, Claude Code, and Antigravity (`plugins/immune-brain/skills/imm-loop/SKILL.md`, `plugins/immune-brain/dist/imm-loop.md`, and Antigravity mirror) so Code Agents operate the repository-local Loop daemon via `<skillDir>/../../bin/imm-loop` and `<skillDir>/../../bin/imm-kernel` without requiring `PATH`, and retire `ADR 0031` (consolidating phase-entry recognition and local-skill shadowing attribution in `ADR 0025`).

Add `imm-loop` `start`, `stop`, and `logs` background daemon lifecycle commands, `package.json` `bin` entries, live daemon state reporting in `imm-loop status` and `imm-kernel inspect`, and `import.meta.url`-relative `pluginRoot`/`pluginDir` resolution in `loop_daemon/{agent_handlers,dispatch}.ts` for external repositories.
