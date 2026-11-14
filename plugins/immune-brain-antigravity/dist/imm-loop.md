---
name: imm-loop
description: Use when the user explicitly requests starting, stopping, inspecting, or managing the Immune-Brain Loop daemon.
---

# Immune-Brain: Loop Daemon

## Authority Boundary

The Immune-Brain Loop daemon (ADR 0039) is a headless, repository-scoped
background composition root (`runtime/loop_daemon/`) that observes GitHub
Issues, pull requests, and CI state, schedules bounded planning or repair
sessions in isolated worktrees, and advances approved work across sessions.

Operating `imm-loop` through this Skill controls the daemon lifecycle only:

- It mints no interactive `drive` Run token and alters no active foreground
  workspace claim, TaskIntent, or TaskRecord directly.
- Daemon execution authority comes strictly from tracked repository policy
  (`.imm/config.json` `loop` block, `.imm/risk-floor.json`), `policy_auto` for
  verified `routine` tasks (disallowed when running in same-UID `degraded`
  posture), and verified unedited GitHub `tracker_approval` comments
  (`/approve <digest>`).
- Orchestration state under `.imm/state/loop/` (`daemon.lock`, `state.json`,
  `daemon.log`, `events.jsonl`, `decisions.jsonl`, `dispatches.jsonl`, `leases/`)
  is rebuildable operational state, never Kernel authority.
- Human-only merge boundary stands: the daemon never merges pull requests.

## Workflow

### 1. Resolve wrappers

Host plugin loaders for Pi, Claude Code, and Antigravity do not place
`package.json` `bin/` entries onto the ambient shell `PATH`. Always resolve the
canonical wrappers relative to the declared `skills/imm-loop/SKILL.md` file:

- Daemon CLI: `../../bin/imm-loop`
- Kernel CLI: `../../bin/imm-kernel`

Verify both resolved executables exist (or fall back only to verified
`<pluginRoot>/bin/imm-loop` and `<pluginRoot>/bin/imm-kernel` if running in a
source checkout). Execute them with the working directory (`cwd`) set to the
target Git repository root. Do not hardcode repository-local paths inside user
repositories when invoking an installed plugin.

### 2. Inspect and observe

Read-only inspection and dry-run evaluation require no confirmation and leave
`.imm/state/loop/` and GitHub untouched:

- `<imm-loop> status --json`: returns `daemon_running`, `lock` (`pid`,
  `started_at`, `host_token`), `mode`, `paused`, `pause_reason`,
  `active_leases`, `stats` (`ticks_total`, `events_observed_total`,
  `last_tick_at`), `watermarks`, and `log_path`.
- `<imm-loop> logs --lines <N> --json` (default `--lines 50`): reads the tail of
  `.imm/state/loop/daemon.log` (`{ exists, log_path, lines }`).
- `<imm-kernel> inspect --json`: returns Kernel layout, active claim/assurance
  projection, and the read-only `loop` daemon snapshot (`assurance_kernel/inspect/v1`).
- `<imm-loop> tick --dry-run --json`: evaluates current GitHub/repo state and
  judgement ladder with zero GitHub, lock, or branch mutations.

### 3. Preflight and start

Before starting the daemon with `<imm-loop> start --json`:

1. **Check existing process**: run `<imm-loop> status --json`. If
   `daemon_running` is `true`, report the active `lock.pid`, `mode`,
   `lock.started_at`, and `log_path` without starting a second daemon.
2. **Inspect project configuration**: run `<imm-kernel> config --json` and read
   `loop` (`valid`, `value.mode`, `value.interval_seconds`,
   `value.max_concurrent`, `value.auto_enroll_max_risk`, `value.allowed_actors`).
   - If `loop.valid` is `false`, report the `diagnostics` error instead of
     starting.
   - If `loop.value.mode` is `"off"` (or unset, which defaults to `"off"`),
     `<imm-loop> start` refuses with `Error: loop.mode is off` (unless
     `--dry-run` is explicitly intended). Explain the tracked `.imm/config.json`
     `loop` policy fields needed (`mode`: `"observe" | "assist" | "autonomous"`,
     `interval_seconds`, `max_concurrent`, `auto_enroll_max_risk`,
     `allowed_actors`, `allowed_associations`, `budget`) and ask the user before
     editing tracked `.imm/config.json`.
3. **Verify runtime preconditions**: confirm GitHub authentication is readable
   (`GH_TOKEN`, `GITHUB_TOKEN`, or `gh auth status`). If the authenticated
   GitHub login matches an entry in `loop.allowed_actors`, `imm-loop start`
   refuses to start (`daemon GitHub identity ... is in loop.allowed_actors`);
   report that identity collision instead of bypassing it.
4. **Launch detached daemon**: run `<imm-loop> start --json` (adding
   `--interval <sec>` or `--dry-run` only when requested).
   - Do not wrap `<imm-loop> start` in `nohup ... &` or hold an open PTY task:
     `start` spawns a detached `stdio: "ignore"` background `run` child,
     ignores `SIGHUP`, waits up to 10s for lock acquisition, and exits cleanly
     with JSON (`status: "started" | "already_running"`, `daemon_running`, `pid`,
     `interval_seconds`, `dry_run`, `lock`, `log_path`).
   - If `start` exits non-zero, surface its `stderr` (which includes recent
     `daemon.log` lines on early exit) directly.

### 4. Control and recovery

Execute lifecycle controls when requested by the user:

- **Stop**: `<imm-loop> stop [--timeout <sec>] [--force] --json` sends `SIGTERM`
  to the locked daemon PID, waits cleanly until exit, cleans the lock, and
  returns `{ status: "stopped" | "already_stopped" | "killed", daemon_running: false, pid }`.
  Never pass `--force` (`SIGKILL`) on first attempt unless explicitly asked, and
  never manually delete `daemon.lock` while its PID is alive.
- **Pause / Resume**: `<imm-loop> pause [--reason <text>]` and `<imm-loop> resume`
  toggle `paused` in `.imm/state/loop/state.json` without stopping the process.
- **Retire stuck lease**: `<imm-loop> retire-lease <target-id>` clears an
  orphaned dispatch lease in `.imm/state/loop/` after verifying via `status`
  and `logs` that no active session owns it.
- **Rebuild cache**: `<imm-loop> rebuild --json` reconstructs `.imm/state/loop/`
  watermarks and active leases from GitHub markers and repository state if local
  state was deleted or corrupted.

## Output

Lead with the daemon state (`running` / `stopped`, `pid`, `mode`, `paused`), then
summarize relevant config/identity findings, active lease count, `last_tick_at`,
`log_path` (or recent error/log lines on failure), and one concrete next action
if preflight blocked startup.
