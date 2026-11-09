---
"immune-brain": minor
---

Authority Review can run as a separate CLI process selected by the new `lanes.review_host` profile, behind `IMMUNE_BRAIN_REVIEW_DISPATCH=cli`. The runtime writes one review packet and a POSIX `sh` script, the Parent runs the script in its own shell, and `submit_review` settles the reviewer's output through the existing mediated receipt path. A tree guard over HEAD, the index and tracked content releases any round that changed the reviewed state. The generated `authority-review` skill ships in all three Host packages and stamps the review contract hash, so a reviewer with a different install answers `REVIEW_CONTRACT_MISMATCH` instead of reviewing. The switch defaults to `subagent`, so the in-process reviewer and findings verification are unchanged.
