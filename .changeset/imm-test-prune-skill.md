---
"immune-brain": minor
---

Add `imm-test-prune`, an explicitly invoked standalone host-native Skill that audits and prunes redundant, bloated, or orphaned tests through one exact hash-bound manifest. It uses only the target repository's own test, coverage, and static-check commands; subsumption deletions require covered-line superset evidence when coverage is available and stay `UNVERIFIED` otherwise; assertions are never weakened and production source is never changed (#205).
