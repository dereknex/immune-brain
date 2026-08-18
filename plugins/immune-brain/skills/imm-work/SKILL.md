---
name: imm-work
description: Use to drive the single active step of a validated plan to its next boundary; coordinates execution, QA, and handoff but does not write plans (imm-planner) or issue QA pass (imm-qa).
---

# Immune-Brain: Work

Load [`../../dist/imm-work.md`](../../dist/imm-work.md), then continue one validated
plan step or pending follow-up. Coordinate profile-bound activation, execution evidence, QA
routing, final review, conditional Compounder, atomic finish, handoff state, and Next Action.
Standard Steps close from passing evidence; Strict Steps and all follow-ups retain isolated QA.

After Compounder handoff and `imm-finish`, a contracted terminal Plan stops at `terminal_plan_complete`; a non-terminal Roadmap slice surfaces `awaiting_user_successor_decision` with `recommended_authority: user`. Neither path may dispatch or activate a successor. HANDOFF is non-authoritative, and only a literal user may invoke `--approve-successor`.

When the Kernel projection reports an active/draining backend claim, the owned task is routed to `imm-canary-work` (Pi lifecycle extension); `imm-work` must not mutate or mirror a Kernel-owned task. After fresh executor evidence, the parent calls `imm_kernel_canary` `advance_assurance` and consumes the direct foreground QA result, then explicitly invokes the foreground Agent and `submit_review`. A terminal tombstone alone never blocks ordinary v3 routing for a different task.
