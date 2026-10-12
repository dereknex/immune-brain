---
"immune-brain": minor
---

Deterministic QA commands now run with the environment of the process hosting the Kernel instead of a rebuilt one. The Kernel no longer creates a throwaway home or overrides `HOME`, `TMPDIR` and `XDG_CACHE_HOME`; Git repository-binding variables (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_COMMON_DIR`, `GIT_NAMESPACE`, `GIT_PREFIX`) stay out of the child, and the per-run process token stays in. The Planner contract no longer forbids a download or credential use during preparation. QA still runs in the disposable delivery materialization.
