---
"immune-brain": minor
---

Owner steering and status (Slice `S5` of Spec `loop-leader`). Verified
`@imm-loop focus <text>` and `@imm-loop priority <high|normal|low>` comments
become `owner_hint` leader-journal entries the next briefing carries; an
unverified author or an edited comment is still ignored, and a hint moves no
work item.

The privileged `steer_loop_work_item` Host tool (`{ target, action:
pause|resume|abandon, reason? }`) joins `PRIVILEGED_OPERATIONS` and is registered
on Claude Code, Antigravity and Pi, always under the native confirmation. It
writes one request under `.imm/state/loop/steering/`, which the daemon applies
on its next tick and removes: `pause` sets `WorkItem.paused`, `resume` clears
it, and `abandon` reaches the new terminal `abandoned` state without touching a
running Kernel run. Before any candidate is built — Tier-1/2 dispatch, leader
dispatch and scheduler admission — a paused or abandoned target yields no
candidate and is recorded `skipped` with reason `work_item_paused` or
`work_item_abandoned`; fact transitions are still recorded.

GitHub `@imm-loop pause`, `resume` and `abandon` lose their daemon-wide effect
(`BR-DEC-11` / `D3.4` of Spec `loop-daemon`) and post one `notice` naming the
local action instead. Daemon-wide pause stays local through `imm-loop
pause|resume`, and the Status Issue keeps showing it. `imm-loop status --json`
adds `paused_items[]` and `leader { last_wake_at, wakes_today,
last_proposal_items }`.
