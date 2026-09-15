---
"immune-brain": patch
---

`noUnusedLocals` is enabled, so an unused import or local now fails
`bun run typecheck` instead of surviving review, and the unused symbols it
surfaced are gone: the orphaned imports S9/S13 left behind in the Claude port and
both Pi extension entries, plus the pre-existing unused imports, constants, and
locals in the rest of the runtime and scripts. Two removals keep the effect they
had — the Claude enrollment call and the Kernel authority consume still run as
statements — and the checked-in Claude bundle is regenerated.
