---
"immune-brain": major
---

Rename the packaged skills to bare verbs (ADR 0031): `imm-brainstorm` → `clarify`, `imm-planner` → `draw-up`, `imm-run` → `drive`, `imm-retro` → `revisit`, `imm-doc-slim` → `slim`, `imm-doc-prune` → `prune-docs`, `imm-test-prune` → `prune-tests`, `imm-pr-fix` → `fix-pr`; `dist/imm-run-batch.md` is now `dist/drive-batch.md`.

Breaking: old names are not aliased and no longer enter a phase, including `imm-loop` in a user alias. Edit your own commands (`.claude/commands`, `~/.claude/commands`) and Pi prompt templates by hand; an alias enters a phase only through a marked mention such as `/drive`, `/immune-brain:drive` or `/skill:drive`. After upgrading, refresh the Claude Code plugin cache and run `/reload` in Pi. Enter runs with `/drive`, `/immune-brain:drive` (Claude Code) or `/skill:drive` (Pi). If you have a skill of your own named `drive`, the bare `/drive` (and on Pi `/skill:drive`) no longer enters a run; use `/immune-brain:drive` on Claude Code.
