---
"immune-brain": patch
---

The Executor and Loop contracts require Delivery Evidence only when a task is reworked, and the Planner records `Diagram decision` and `Diagram reason` only for a Medium/High Spec that needs a diagram; the Quality Gate reference and the legacy Spec validator accept a Spec that records neither field. The batch, Lane and Herdr sections of `imm-run` move unchanged in wording to `dist/imm-run-batch.md`, and the Claude host package test recognizes it as a companion contract of the `imm-run` Skill. A contract rule audit is added at `docs/reports/contract-rule-audit-r647.md` (#219).
