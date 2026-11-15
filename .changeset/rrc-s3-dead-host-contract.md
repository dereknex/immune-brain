---
"immune-brain": patch
---

Delete Claude host and loop-contract code that no production path reaches: `parsePermissionMode`, `CLAUDE_NATIVE_AGENT_ROLES`, `normalizeArchitectureExplorerOutput` and `normalizeAdvisoryReviewerOutput`, together with their now-unreferenced private helpers, types and the test cases that only protected them.
