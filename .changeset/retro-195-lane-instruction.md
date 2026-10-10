---
"immune-brain": patch
---

The coordinator may send one text instruction to an idle Lane session: `start_unattended_batch` takes `lane_instruction`, records it in the batch record and report as `interventions` before it is sent, and refuses it for a blocked or working session or a child no longer running in its Lane. The Herdr Lane Tabs contract keeps a wait armed per live session, tells the user at once when a Lane is blocked or goes idle without settling, and still never answers a dialog or re-prompts a reviewer.
