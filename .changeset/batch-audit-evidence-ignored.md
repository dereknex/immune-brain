---
"immune-brain": patch
---

A batch no longer loses a child's terminal audit pair to `.gitignore`. When the repository ignores `.imm/audit/` (for example with a blanket `.imm/` rule), batch preflight now refuses before the native gate with `audit_evidence_ignored`, naming the affected paths and the rule to fix, instead of letting a child run to completion and then parking at integration with `adopted commit lacks terminal audit pair`. The per-child commit applies the same check before any Git write, so a rule added mid-batch is refused with the same reason rather than producing a commit without its evidence.
