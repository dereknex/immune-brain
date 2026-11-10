---
"immune-brain": minor
---

A project can list where a `routine` risk declaration may stand in `.imm/routine-classes.json`. When a `routine` task's actual diff leaves every listed class, the Kernel raises it to `material`, so it needs Review; nothing is refused and no gate opens. An untrusted list makes every task `critical`, and the file itself is always `critical`. `imm-kernel inspect --json` reports `risk.routine_classes` and `risk.outside_routine_allowlist`, and the Review manifest lists the escaping paths. Without the file nothing changes. ADR 0038 records the decision; this repository pilots a `docs-only` class.
