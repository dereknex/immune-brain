---
"immune-brain": minor
---

Retire the top-level `herdr` configuration key (unified-lane-sessions S1, #570): setting it in either file produces one non-blocking `retired_key` warning, is ignored by the resolver, and is omitted from the effective configuration, and `imm-kernel config migrate --write` deletes it while preserving every other key. Add top-level `session_providers`, a non-empty ordered list of distinct registered provider names (`herdr`, `herdr-core`) defaulting to `["herdr"]` with the project file replacing the user file; empty, unknown, test-only (`fake`, `process`), duplicated, or non-array values are blocking `config_invalid` errors. Inside Herdr (`HERDR_ENV=1`) single-task Lane Executors run in interactive Herdr tabs with no configuration gate.
