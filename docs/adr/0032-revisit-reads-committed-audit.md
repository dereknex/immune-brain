---
status: accepted
---

# revisit reads committed audit

Accepted on 2026-10-30 by the repository owner (#322, "Decisions (Derek, 2026-10-30)" 2, 7, 9 and 11; `docs/specs/revisit-workflow-health.spec.md` D4, D5 and D8). It narrows the earlier rule that the retro never computes record-based metrics, recorded as D2 of [the review-verifier-eval Spec](../specs/review-verifier-eval.spec.md) and now marked superseded in part.

## Context

`revisit` read only Pi session logs. Session logs say what an agent did, not what the Kernel settled: they carry no terminal proof, no QA attestations and no stop events. The committed `.imm/audit/<task>/[run-<id>/]` pairs (`task-record.json` plus `terminal-proof.json`) are the settled record of every merged terminal run, and `readAuditTaskPair` already checks the proof against the record bytes. Review-verifier-eval D2 kept all record-based metrics out of the retro so the retro could stay a log reader with no Kernel dependency.

## Decision

`revisit` may read the committed `.imm/audit/**` of **one named project at HEAD**, through `--audit <project-root>`, and computes **lifecycle and raw review counts only**: per terminal run, lifecycle, schema version, QA and Review attestations, rework events, findings by source and status, revisions, user-authorized rework, stop events and distinct evidence bindings. A field a schema version cannot carry prints `-`, never `0`.

- The reader exports the HEAD tree's `.imm/audit/**` into a temporary directory and parses each pair with the Kernel's `readAuditTaskPair`. It never opens working-tree audit files, `.imm/state/`, SQLite or the authority store.
- A pair that is incomplete, fails the proof check or does not parse is skipped and counted by reason; the report header prints the project root, the HEAD commit, schema counts, skipped counts and the sample-bias line (only merged terminal runs are present).
- Derived review metrics (rounds-to-pass median and p95, shares, the per-acceptance series, per-model breakdowns) stay with the review-verifier-eval tooling. `revisit` computes none of them.
- Snapshot writes (`--out`) and multi-ref reads (`--audit-ref`) are not part of this decision; snapshot writes get their own ADR.

## Consequences

The analyzer now imports Kernel runtime modules, so a read-only analysis depends on the persisted TaskRecord v2/v3/v4 and terminal-proof formats; Bun is the supported runtime. No Kernel, record or writer behavior changes. The boundary in `plugins/immune-brain/dist/revisit.md` moves committed `.imm/audit/` from blocked to allowed through `--audit` only; live `.imm/` state, SQLite and the authority store stay blocked.
