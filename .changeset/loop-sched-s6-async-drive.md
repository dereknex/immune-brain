---
"immune-brain": minor
---

Run Loop drives as background jobs that hold their lease until the job record is terminal, per D6 of `docs/specs/loop-agent-scheduling.spec.md`. `.imm/state/loop/jobs/<target>.json` records kind, target, pid, expected output and outcome; a new `E12 job_finished` and `E13 lane_settled` event carry the outcome into the next tick, so `open_pr` opens the pull request without a second approval and the tick returns while the Lane still works. Re-entry of an enrolled, nonterminal task resumes through `drive_dispatcher.ts` instead of enrolling again, a job whose pid is dead with no outcome is `lost`, retried once and then escalated, and the Executor exit record takes `final_commit_sha` and the verification digest from the settled Kernel projection instead of `null`.
