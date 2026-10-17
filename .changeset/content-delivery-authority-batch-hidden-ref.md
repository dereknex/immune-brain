---
"immune-brain": minor
---

A batch never creates, switches or commits to a user-visible branch. Its progress lives on the hidden ref `refs/imm/batches/<batch_id>`, built with Git plumbing, so your HEAD, branch and index stay untouched; your own commits, amends and branch switches no longer interrupt a running batch. Batch preflight commits nothing, has no side effect when it rejects, and blocks only on dirty paths inside the scope of a child that has not settled. Batches recorded on the legacy `imm/<slug>` branch still resume.
