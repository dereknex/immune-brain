---
"immune-brain": minor
---

`revisit --audit <project-root>` reports lifecycle and raw review counts per committed terminal run, read from the project's HEAD Git tree through the Kernel's `readAuditTaskPair`. Its header names the project root, the HEAD commit, schema counts, skipped pairs by reason and the sample bias (only merged terminal runs are present). Per run it shows QA and Review attestations, rework events, findings by source and status, revisions, user-authorized rework, stop events and distinct evidence bindings; a field an older record schema cannot carry prints `-`. Session logs are read alongside only with `--sessions`; `--sample <n>` caps the rows. ADR 0032 records the boundary change, and the analyzer now needs Bun because it imports Kernel runtime modules.
