---
"immune-brain": minor
---

Inside Herdr the Parent now drives each Lane Executor session through the new
`imm-session` command and the Supervised Session Port (ADR 0038) instead of
spelling `herdr` commands itself. The Herdr adapter keeps the same tabs, focus
rule, dialog handling and event-driven wait, pins Herdr protocol 22, and fails
closed when Herdr is unavailable. Kernel and batch behavior are unchanged.
Antigravity is now a Herdr Executor Host (kind `agy`) alongside Claude Code and
Pi, matching the hosts the Lane configuration already accepts.
`imm-session --provider herdr-core` adds a herdr-core adapter on the `hc` CLI;
the Loop contract does not use it yet.
After the first live run: Herdr sessions are owned by a token in the tab label
(another pane in the Parent's workspace is refused), instructions also reach a
`done` session (the batch runner accepts `session_state: "done"`), `--resume`
restarts an exited Host in the same Herdr tab, and `create --env` passes extra
Host environment.
`imm-session await` takes several handles and returns the first transition with
its handle, so a Pi Parent, which a background command cannot wake, waits for
all its Lanes in the foreground in bounded rounds.
A Pi session now loads one Immune-Brain only: a second copy (an installed Pi
package next to `-e <plugin root>`) registers nothing and shows a notice,
instead of the Executor Host exiting on duplicate tools.
On herdr-core, an Executor Host that reports no status at startup (Claude Code
shows workspace trust that way) keeps its terminal and returns
`entry_submitted: false` with an `attention` text, so the user can answer and
the Parent resumes, instead of failing the session.
The Executor close rule (#426 S1): `start_unattended_batch` accepts
`lane_session_close`, records the close of an integrated child's session in
the batch record's `session_closes`, and `imm-session close` closes that
session only with the accepted record. Lanes and branches are not removed.
Two opt-in Lane settings put work in watched Herdr sessions (#426 S4, S2):
`lanes.review_transport: herdr` runs the authority Review's script through
`imm-session run`, and `lanes.advisory_transport: herdr` runs advisory children
in a session whose marked result `imm-session read --extract advisory` returns.
Findings verification after a CLI Review is now a CLI process (ADR 0039):
`verification_ready` carries `verification_command`, its output bytes are the
bound receipt, `lanes.review_verifier_model` lets the verifier run on a
different model, and with `lanes.review_transport: herdr` it runs in a Herdr tab
(#426 S3).
