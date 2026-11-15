---
"immune-brain": patch
---

Delete production-unreachable exports from the assurance, batch, tracker and workspace-scope modules — `verifyReviewBundle`, `deleteReviewRef`, `qaEvidenceFreshnessId`, `describeQaFailure`, `replaceBatchRunState`, `assertKernelInvariantsV2`, `assertIsolatedTaskPrerequisites`, `workspaceDiffHash`, `replacementChangedFilesSinceSnapshot`, `changedFilesSinceSnapshot` and `assertCheckCommandsCiteExistingTests` — together with the test cases whose only subject they were. Observable behavior is unchanged.
