---
"immune-brain": patch
---

Make the packaged contracts Host-neutral about tool identity: drop the stale `freeze_artifacts` step the Kernel already performs inside `advance_assurance`, restate every remaining Pi-only tool spelling as the obligation it stands for, and add a guard test that fails whenever a packaged contract names a tool absent from every Host tool surface.
