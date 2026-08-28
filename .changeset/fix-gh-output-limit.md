---
"immune-brain": patch
---

fix(tracker): avoid gh output limit exceeded by paginating snapshot and raising MAX_GH_OUTPUT

- paginate GitHub Issues snapshot (100/page, up to 100 pages) instead of single --paginate --slurp blob
- raise MAX_GH_OUTPUT 1MiB -> 8MiB to handle 65KB bodies without per-page overflow
