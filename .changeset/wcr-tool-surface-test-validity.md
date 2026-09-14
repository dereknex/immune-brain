---
"immune-brain": patch
---

The packaged-contract tool-surface guard no longer passes silently when a contract names a Tool that no Host registers: a backticked name the contract itself spells as a `Tool`/`Operation` is now a failure when it resolves on zero Host surfaces, not only when it resolves on one. Its pre-change comparison also reads the actual pre-change contract text at test time (`git show aecf5dd^:<path>`) instead of a hardcoded paraphrase, so the case that proves the guard catches the HTN-2 regression cannot drift from what the guard really rejected.
