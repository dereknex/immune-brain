---
"immune-brain": patch
---

A claude-code verifier now runs with `--add-dir` on its verification packet directory. The packet is written to a temporary directory outside the reviewed tree, and `dontAsk` denied the Read of it, so the verifier answered in prose instead of the verdict JSON. The verify directory is also resolved with `realpath`, as the review directory already was.
