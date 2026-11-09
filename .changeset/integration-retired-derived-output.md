---
"immune-brain": patch
---

Batch integration no longer fails with `pathspec ... did not match` when a Lane
deletes a file declared in `docs/agents/derived-files.json`. The containment
step now stages only the regenerated delta instead of every declared output.
