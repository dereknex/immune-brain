---
"immune-brain": patch
---

The coverage retired with `tests/kernel-r2a-boundary.test.ts` has a named
successor in `tests/kernel-shadow-cli.test.ts`: the unknown-command case now
also exercises the literal `readiness --json` invocation, asserting the same
`invalid_command` refusal with `.imm/state/workspace.json` left uncreated, and
records that the retired top-level token deliberately appends no friction journal
entry while the arbitrary unknown token still does.
