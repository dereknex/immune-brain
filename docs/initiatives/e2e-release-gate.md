# Initiative: e2e-release-gate

Spec: [docs/specs/e2e-release-gate.spec.md](../specs/e2e-release-gate.spec.md)

Goal: catch Host-boundary, cross-module flow and packaging defects before a release reaches users, through deterministic L1 e2e on every PR, an L2 live smoke evidence gate on promote, and a next/stable release channel.

Execution order: S1 and S2 first; S3-S7 after S2; S8 after S3; S9 after S1, S3, S4 and S6; S10 after S8. Parallelism follows `imm-kernel intent overlap`.

Maintainer-applied repository settings (outside Executor authority): protect `stable` so only promote.yml pushes it; add required reviewers to the `release` environment; mark `e2e` a required check after S8.

## S1: Releases go to npm next; promote moves stable and latest
Tasks:
- e2e-gate-s1-release-channel

## S2: bun run e2e harness runs a real claude against a mock model
Tasks:
- e2e-gate-s2-harness

## S3: J4 install journey passes for all three Hosts
Blocked by: e2e-gate-s2-harness
Tasks:
- e2e-gate-s3-install

## S4: J1 single-task drive journey passes
Blocked by: e2e-gate-s2-harness
Tasks:
- e2e-gate-s4-single-task

## S5: J3 Review receipt journey passes
Blocked by: e2e-gate-s2-harness
Tasks:
- e2e-gate-s5-review

## S6: J2 two-child batch journey passes
Blocked by: e2e-gate-s2-harness
Tasks:
- e2e-gate-s6-batch

## S7: J5 skew journey shows named diagnostics
Blocked by: e2e-gate-s2-harness
Tasks:
- e2e-gate-s7-skew

## S8: CI requires the e2e job and the escape rule
Blocked by: e2e-gate-s3-install
Tasks:
- e2e-gate-s8-ci-gate

## S9: Promote requires live e2e evidence
Blocked by: e2e-gate-s1-release-channel, e2e-gate-s3-install, e2e-gate-s4-single-task, e2e-gate-s6-batch
Tasks:
- e2e-gate-s9-live-evidence

## S10: Weekly Host bump and post-release fix metric
Blocked by: e2e-gate-s8-ci-gate
Tasks:
- e2e-gate-s10-bump-and-metric
