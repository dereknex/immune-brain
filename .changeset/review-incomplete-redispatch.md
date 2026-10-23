---
"immune-brain": patch
---

Treat incomplete Review coverage as a durable execution outcome, not an assurance verdict or finding. Retry the same snapshot once with twice the requested turn budget (up to 96), preserving fresh QA across coordinator restarts, then pause with review_incomplete and one recovery action. Bind both Hosts' observed incomplete receipts and teach the reviewer to report incomplete instead of a coverage finding.
