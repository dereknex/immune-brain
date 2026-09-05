---
"immune-brain": minor
---

Make Initiative carrier resolution host-portable and remove its silent default. Planner now reads the repository and user-level agent instruction files directly instead of assuming the Host injected `AGENTS.md` into context, so a configured carrier is no longer ignored on Hosts that auto-load `CLAUDE.md` or never read `~/.pi/agent/AGENTS.md`. When no valid directive is found, Planner asks and reports which sources it checked rather than silently resolving to `local` or `github`.
