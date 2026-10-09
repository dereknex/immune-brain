---
"immune-brain": minor
---

The Parent now launches and supervises each Lane's Executor Host in a lane-mode batch; the `lane-steward` role supplies Lanes and starts no Host session. A supervised session is a separate Host process rooted in the Lane, started non-interactively with an `imm-run` entry, whose exit notifies the Parent. Parent Host and Executor Host (`claude-code` or `pi`) are chosen independently, and a Parent Host that cannot offer such a session launches nothing and reports the handoff to the user. The runner, the batch record and the handoff shapes are unchanged (ADR 0013, revised 2026-10-09).
