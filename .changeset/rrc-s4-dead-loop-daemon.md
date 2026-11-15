---
"immune-brain": patch
---

Delete loop-daemon and decision-model code that no production path reaches: `clearRepairAttempt`, `dispatchRepair`, `heartbeatLoopLease`, `reclaimExpiredLeases`, `parsePlanDigest`, `capabilityRefusal`, `getCachedDaemonGithubLogin`, `MIN_CLASSIFIER_CONFIDENCE`, `DECISION_CHOICE_MARKER_PREFIX` and `assertApplicationPointId`, together with their now-unreferenced private helpers, types and the test cases that only protected them.
