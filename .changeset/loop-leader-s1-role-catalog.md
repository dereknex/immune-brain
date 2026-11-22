---
"immune-brain": minor
---

Add the project loop role catalog (`loop.roles` in `.imm/config.json`, Slice
`S1` of Spec `loop-leader`): each role binds one closed base (`leader`,
`clarify`, `plan`, `execute`, `repair`, `analyze`) with a Host, model, effort, an
advisory `when`, an advisory `instructions` file and `turn_budget` /
`timeout_s` / `max_parallel` limits. `imm-kernel config --json` lists the
resolved catalog under `loop.value.roles` and reports one diagnostic per refused
role (`role_base_unknown`, `role_name_invalid`, `role_host_unknown`,
`role_limit_out_of_range`, `role_instructions_outside_repo`,
`role_instructions_missing`, `leader_role_duplicate`); a refused role is excluded
without stopping the daemon, and with no `loop.roles` every base keeps a built-in
`claude-code` role at 40 turns / 900 s / 1 slot.

The Loop's `clarify`, `plan` and `repair` sessions now take Host, model, effort,
turn budget and timeout from that catalog and append a role's instructions as
advisory prompt text. `agents.planner` and `agents.executor` no longer choose
those sessions: each affected role reports one `deprecated_config_source`
warning naming the ignored binding and `loop.roles`. `agents.executor` still
selects the Lane Executor's Host, `agents.triage` still runs Loop judging, and a
missing Host binary now fails the session as `role_host_unavailable` instead of
falling back to another Host.

Migration: move any `agents.planner` binding for `clarify`/`plan` and the Host
`repair` should use into `loop.roles` in `.imm/config.json`.
