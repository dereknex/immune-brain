---
"immune-brain": minor
---

The paths that force a higher task risk are now declared by the project in a tracked `.imm/risk-floor.json` instead of being compiled into the runtime. The file holds a `material` and a `critical` tier, each with `paths` (raise a task through its scope or its changed paths) and `changed_only` (raise it through changed paths alone). A project with no declaration has no floor, so `docs/specs`, `docs/plans` and paths named like this repository's Kernel no longer raise a task elsewhere. A declaration that is invalid, unreadable or not committed makes every task `critical`, and the declaration's own path is always `critical`. `imm-kernel inspect --json` reports the reason as `risk.floor_invalid`. This repository's declaration carries the former built-in lists unchanged.
