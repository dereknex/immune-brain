# Changelog

## 8.4.0

### Minor Changes

- [`6cc19fd`](https://github.com/dereknex/immune-brain/commit/6cc19fd6a52a6e2d540c79cc92a48cc8f2cfe358) Thanks [@dereknex](https://github.com/dereknex)! - Expose `imm-loop` as a standalone public Skill across Pi, Claude Code, and Antigravity (`plugins/immune-brain/skills/imm-loop/SKILL.md`, `plugins/immune-brain/dist/imm-loop.md`, and Antigravity mirror) so Code Agents operate the repository-local Loop daemon via `<skillDir>/../../bin/imm-loop` and `<skillDir>/../../bin/imm-kernel` without requiring `PATH`, and retire `ADR 0031` (consolidating phase-entry recognition and local-skill shadowing attribution in `ADR 0025`).

  Add `imm-loop` `start`, `stop`, and `logs` background daemon lifecycle commands, `package.json` `bin` entries, live daemon state reporting in `imm-loop status` and `imm-kernel inspect`, and `import.meta.url`-relative `pluginRoot`/`pluginDir` resolution in `loop_daemon/{agent_handlers,dispatch}.ts` for external repositories.

### Patch Changes

- [#513](https://github.com/dereknex/immune-brain/pull/513) [`0cdfbeb`](https://github.com/dereknex/immune-brain/commit/0cdfbebacc534b977c8d334d60016b8fcead2ee3) Thanks [@dereknex](https://github.com/dereknex)! - Recompute `plan_digest` and record `lane_rebinds` on single-task Lane identity rebinds so resuming a parked single-task batch reads the rebound identity from the record instead of refusing `plan_changed`.

- [#511](https://github.com/dereknex/immune-brain/pull/511) [`46e53b9`](https://github.com/dereknex/immune-brain/commit/46e53b90d2544bcfba99a5d54a1d8e3c0340360d) Thanks [@dereknex](https://github.com/dereknex)! - Derive unique <=32-char backend session names from the folded label plus a 12-hex ownership token slice in the `herdr` and `herdr-core` `SupervisedSessionPort` providers (#502), preserve token identity across exited-Host `herdr` `--resume`, and enforce live duplicate-name guards in `fake-herdr` and `fake-herdr-core`.

## 8.3.1

### Patch Changes

- [`8282079`](https://github.com/dereknex/immune-brain/commit/8282079e1d9473ff4ac49ea1fc2b47ac7222094f) Thanks [@dereknex](https://github.com/dereknex)! - Antigravity Managed native gates no longer refuse based on `toolPermission` or the `agy` ancestor process flags; `PreToolUse` always returns `force_ask` and leaves dialog surfacing to `agy`. `permissions.allow` is still read (best effort) for `allow-rule` provenance.

## 8.3.0

### Minor Changes

- [#505](https://github.com/dereknex/immune-brain/pull/505) [`210c366`](https://github.com/dereknex/immune-brain/commit/210c366b8408f638f3b3a6db42c927fddbc70eff) Thanks [@dereknex](https://github.com/dereknex)! - Support optional top-level `git_integration` (`"manual" | "auto"`) in user configuration (`~/.config/immune-brain/config.json`) with `user -> project -> legacy -> default` precedence and fail-closed diagnostics.

### Patch Changes

- [#504](https://github.com/dereknex/immune-brain/pull/504) [`b113abe`](https://github.com/dereknex/immune-brain/commit/b113abe49a8cd0bbaa78c2019a56a9384080c859) Thanks [@dereknex](https://github.com/dereknex)! - Record Antigravity `permissions.allow` provenance with the `allow-rule` confirmation reference kind (`antigravity-allow-rule-<hash>`) when a standing allow rule covers a Managed call and `agy` skips the interactive dialog, without relaxing existing native-gate refusals.

- [#504](https://github.com/dereknex/immune-brain/pull/504) [`5162ff0`](https://github.com/dereknex/immune-brain/commit/5162ff0fd2e0b7a3954c7756daed0a10cf722963) Thanks [@dereknex](https://github.com/dereknex)! - Resolve Antigravity asynchronous verifier results from `.system_generated/subagents/` and `.system_generated/messages/` across hook payloads when `invoke_subagent` `PostToolUse` carries no result (Spec D7).

- [#504](https://github.com/dereknex/immune-brain/pull/504) [`3981572`](https://github.com/dereknex/immune-brain/commit/398157211574dc309b0233199569ae2b3faefac5) Thanks [@dereknex](https://github.com/dereknex)! - Add Antigravity PreInvocation activeTaskNotice injection, confirm absence of a model-callable Skill tool (D10), and record live certification for Antigravity P1, P3, P4 and P6-P8 while retaining P2 conformance-only (Host auto-approval of force_ask observed), P5 guard-only and P9 unsupported (D11).

- [#504](https://github.com/dereknex/immune-brain/pull/504) [`001309b`](https://github.com/dereknex/immune-brain/commit/001309b79e68e0d01d2095c2c803a387dc3239db) Thanks [@dereknex](https://github.com/dereknex)! - Require `toolPermission` `"request-review"` in `~/.gemini/antigravity-cli/settings.json` and an interactive `agy` ancestor (without `--dangerously-skip-permissions`, `--print`, or `-p`) before Antigravity `PreToolUse` writes a confirmation grant or returns `force_ask`, failing closed with observed cause and remediation when native dialogs cannot surface.

- [#504](https://github.com/dereknex/immune-brain/pull/504) [`c6c2008`](https://github.com/dereknex/immune-brain/commit/c6c2008ca3b4315f43f317e69c555e5d828375de) Thanks [@dereknex](https://github.com/dereknex)! - Move Antigravity phase-entry, admission and native-confirmation cache operations to shared private-file protections with 0700/0600 mode, ownership, regular-file, and O_NOFOLLOW security protections (D3).

- [#504](https://github.com/dereknex/immune-brain/pull/504) [`566abec`](https://github.com/dereknex/immune-brain/commit/566abec76ca496edeb124624c7a67fa159931260) Thanks [@dereknex](https://github.com/dereknex)! - Replace Antigravity simplified Stop continuation with the shared typed-event state machine for tasks and Batch Parents, including three-failure pause, no-progress yield, and seven-Stop same-Host recovery boundary (D7).

- [#504](https://github.com/dereknex/immune-brain/pull/504) [`21e312a`](https://github.com/dereknex/immune-brain/commit/21e312a4c4ca5b4fb2e4849579f6333d3f730118) Thanks [@dereknex](https://github.com/dereknex)! - Declare the P1-P9 Host capability contract and four evidence levels across Claude Code, Antigravity, and Pi, rendered in `docs/reference/host-capability.md` and recorded in ADR 0039 and amended ADR 0038. Capability declarations are documentation and conformance inputs only, never runtime dispatch.

- [#504](https://github.com/dereknex/immune-brain/pull/504) [`5a3d466`](https://github.com/dereknex/immune-brain/commit/5a3d4660fa979e1d10a92e701d5afbe8325130ec) Thanks [@dereknex](https://github.com/dereknex)! - Compose Pi task assurance and unattended batch operations on HostRuntime, retiring duplicate AssuranceProgression and standalone batch execution flows while preserving tool schemas, TUI elicitation, Task Rail, and foreground Agent behavior (tri-host-capability-alignment Slice S4, D5).

- [#504](https://github.com/dereknex/immune-brain/pull/504) [`8116d1c`](https://github.com/dereknex/immune-brain/commit/8116d1cc322b9d168293aff6c9f7700901f0aee7) Thanks [@dereknex](https://github.com/dereknex)! - Align Pi run continuation with shared persistence and events, common failure and boundary limits, selected-parent correlation, and private continuation metadata while retaining in-process entry tokens (tri-host-capability-alignment Slice S5, D6).

- [#504](https://github.com/dereknex/immune-brain/pull/504) [`bbf46ee`](https://github.com/dereknex/immune-brain/commit/bbf46eea786c68b35aa3dad3fc90b86fd9b43526) Thanks [@dereknex](https://github.com/dereknex)! - Bind Pi verification to the shared VerifierObservation state machine over an in-memory typed event log while preserving the exact Pi Agent dispatch envelope, packet marker, and pre-dispatch parameter guard (tri-host-capability-alignment Slice S3, D4).

- [#504](https://github.com/dereknex/immune-brain/pull/504) [`0331df0`](https://github.com/dereknex/immune-brain/commit/0331df000792090861ea139c4d9c844c5f043452) Thanks [@dereknex](https://github.com/dereknex)! - Isolate Pi reviewer CLI execution by disabling ambient extensions, skills, and MCP, explicitly loading only authority-review, and narrowing tools to read, grep, find, ls, and bash. Disclose the residual risk of Pi Bash arguments, Antigravity absence of restriction flags, shell-less native-role immutable-Git limits, and untracked-file tree-guard coverage in ADR 0037, the capability table, and Antigravity documentation without claiming preventive read-only isolation.

## 8.2.0

### Minor Changes

- [#470](https://github.com/dereknex/immune-brain/pull/470) [`22420e6`](https://github.com/dereknex/immune-brain/commit/22420e69287ad767311c88c10893ed42e32d5be8) Thanks [@dereknex](https://github.com/dereknex)! - After the first live run: Herdr sessions are owned by a token in the tab label
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
  The Executor close rule (#426 S1): the batch runner records the close of an
  integrated child's session in the batch record's `session_closes` at the tick
  that integrates it (`lane_session_close` on `start_unattended_batch` returns
  that record), and `imm-session close --batch` closes only a session that record
  lists. Lanes and branches are not removed. Inside Herdr, a herdr-core session opens an
  unfocused Herdr tab running `hc attach` so the user can watch it, and
  `imm-session attach` opens another. A Lane the runtime creates is
  reserved in the batch record first, so a tick stopped between creating and
  binding it is resumed rather than parked.
  Two opt-in Lane settings put work in watched Herdr sessions (#426 S4, S2):
  `lanes.review_transport: herdr` runs the authority Review's script through
  `imm-session run`, and `lanes.advisory_transport: herdr` runs advisory children
  in a session whose marked result `imm-session read --extract advisory` returns.
  Findings verification after a CLI Review is now a CLI process (ADR 0039):
  `verification_ready` carries `verification_command`, its output bytes are the
  bound receipt, `lanes.review_verifier_model` lets the verifier run on a
  different model, and with `lanes.review_transport: herdr` it runs in a Herdr tab
  (#426 S3).

### Patch Changes

- [#480](https://github.com/dereknex/immune-brain/pull/480) [`d446954`](https://github.com/dereknex/immune-brain/commit/d44695451062ca1a8d3c44ed90db8933393d6e88) Thanks [@dereknex](https://github.com/dereknex)! - `restoreStagedIntent` now refreshes the whole Git index with `update-index -q --refresh` instead of `--refresh -- <sidecar>`. The path form exited 1 whenever any other tracked file had an unstaged change, so a failed or cancelled Intent revision, and the Antigravity `approve_breaking_intent_revision` preview, failed in a dirty worktree. The Parent final-verification decision (changed commands, `verify`/`repair`, whether a fresh native gate is needed) is now one function, `nativeParentFinalDecision`, shared by the real Parent entry and the Hook preview. A Hook preview that throws reports its cause on stderr before failing closed. A runtime refuses a second concurrent confirmation preview.

  The Preparation digest no longer includes `generated_at` (8.1.3), so a digest issued by 8.1.2 no longer matches: an enrollment or batch confirmation that was open across the upgrade reports `enrollment preparation digest mismatch` and must be confirmed again.

  Batch Lane delivery indexing (`read-tree` after a Lane commit) now refreshes the index stat data. git before about 2.5x (2.43 on Ubuntu 24.04) `read-tree` writes entries with none, and the task snapshots diff with `diff.autoRefreshIndex=false`, so every tracked file of the Lane read as unstaged and the Parent branch integration parked the child as `batch_integration_conflict: task scope contains unstaged or untracked changes`.

- [#449](https://github.com/dereknex/immune-brain/pull/449) [`8b85e13`](https://github.com/dereknex/immune-brain/commit/8b85e1348ecfdd1497be9beb3c4b3cf6a6bda704) Thanks [@dereknex](https://github.com/dereknex)! - Make the supervised-session admission matrix consistent: the executor role stays admitted on `herdr` for all three Hosts with the sign-in dialog recorded as its one G3 gap (the adapter keeps the entry unsent and returns `attention`), and the measured facts now include the v4 Antigravity and Pi dialog runs.

- [#449](https://github.com/dereknex/immune-brain/pull/449) [`5a67a6c`](https://github.com/dereknex/immune-brain/commit/5a67a6cf029a61d79c1bba20158d1eeee8a26c3e) Thanks [@dereknex](https://github.com/dereknex)! - Antigravity print sessions now put every flag before `--print`. `agy` takes the argument right after `--print` as the prompt, so the Lane Executor (`--dangerously-skip-permissions` first) and any reviewer or verifier with a model exited 2 within seconds and the Lane parked as `lane_executor_no_progress`.

- [#449](https://github.com/dereknex/immune-brain/pull/449) [`e08dd29`](https://github.com/dereknex/immune-brain/commit/e08dd29c2697d5f123da51f238c75cb013bc09c5) Thanks [@dereknex](https://github.com/dereknex)! - A lane batch now fixes its Executor preferences when it starts. The batch records the Executor Host, model and effort the request selected as `executor_preferences`, and every Executor generation runs on them, including the one started after a Lane decision, which before this change ignored the request and used whatever `lanes.active` named. When the preferences name an Executor Host, the active profile is no longer consulted, so its model and effort are no longer reported as `not_applied`.

- [#449](https://github.com/dereknex/immune-brain/pull/449) [`f6d41c0`](https://github.com/dereknex/immune-brain/commit/f6d41c014b2b436c1d7e31412d5d315e06395284) Thanks [@dereknex](https://github.com/dereknex)! - A lane batch now fixes its Review profile when it starts. `start_unattended_batch` takes `review_host`, `review_model` and `review_effort`, the batch records them as `review_profile`, and the native confirmation shows them. A CLI Review in that batch's Lane runs on the recorded profile instead of whatever `lanes.active` names when Review is prepared. Before this change, a drive request that named a Lane profile changed the Executor but not the reviewer.

- [#449](https://github.com/dereknex/immune-brain/pull/449) [`6370f3e`](https://github.com/dereknex/immune-brain/commit/6370f3ede80f9a1c0be8593eb9ffc0efb77a72a5) Thanks [@dereknex](https://github.com/dereknex)! - A headless Lane Executor's breaking intent revision now reaches the Parent (#426 F19). Under `--print` the Host cancels the native gate at once and the Kernel recorded nothing, so the Parent saw no decision and restarted the Executor. The supervisor now marks each headless generation with `IMM_LANE_EXECUTOR=headless`; in that session `approve_breaking_intent_revision` validates the revision, leaves a request bound to the current Lane record and returns `lane_decision_requested` without opening a gate. The Parent's `lane_decision_required` carries `requested.next_intent`, the literal user answers at the Parent's own gate, and the applied decision clears the request. A request older than the current record is ignored.

- [#449](https://github.com/dereknex/immune-brain/pull/449) [`4b822fa`](https://github.com/dereknex/immune-brain/commit/4b822fa5583943f26c25a4f6cd83713c20a33cb1) Thanks [@dereknex](https://github.com/dereknex)! - The draw-up contract now spells out the Local Initiative carrier shape that `drive` parses (`## <slice-id>: <result>` sections with one Task under `Tasks:` and an optional `Blocked by:` line), with an example the test suite parses. A Planner that wrote a Slice table left the batch unprojectable and the Parent rewrote the carrier by hand.

- [#449](https://github.com/dereknex/immune-brain/pull/449) [`4b822fa`](https://github.com/dereknex/immune-brain/commit/4b822fa5583943f26c25a4f6cd83713c20a33cb1) Thanks [@dereknex](https://github.com/dereknex)! - The report a completed Initiative batch returns now carries `session_closes`. When final verification passed, the runtime rebuilt the Parent report from durable facts and left the recorded closes out, so the Parent never learned it could close the Lane Executor tabs and left them open for the user.

- [#449](https://github.com/dereknex/immune-brain/pull/449) [`2118d02`](https://github.com/dereknex/immune-brain/commit/2118d025be052dd7673609378760bfa4850be364) Thanks [@dereknex](https://github.com/dereknex)! - A claude-code reviewer and verifier may now run the read-only git commands a model actually emits: `--allowedTools` carries twelve rules, the six existing `git <sub>` forms plus the same six as `git --no-pager <sub>`, from one shared list. The `authority-review` skill and both role prompts tell the role to run one git command at a time from the current working directory, with no `-C`, pipes or redirection. Outside Herdr a Pi Executor is no longer spawned as `pi --print`, which can never settle: the runtime reports `lane_executor_requires_tui`, keeps the single-task child enrolled with its `executor` handoff, and asks the user to run `/skill:drive <task_id>` in interactive pi in the Lane before calling `start_unattended_batch` again.

- [#449](https://github.com/dereknex/immune-brain/pull/449) [`11aeb53`](https://github.com/dereknex/immune-brain/commit/11aeb5316b18d24c03765de25bee0ba87378087c) Thanks [@dereknex](https://github.com/dereknex)! - A claude-code reviewer and verifier now run with `--settings '{"disableAllHooks":true}'`. A user PreToolUse hook that rewrites shell commands (for example into `rtk git …`) made every `Bash(git …:*)` allow rule miss, so `dontAsk` denied all git reads and the Review ended with no inspected paths. The receipt still comes from the output file; user settings, plugins and the `authority-review` skill still load.

- [#449](https://github.com/dereknex/immune-brain/pull/449) [`177e692`](https://github.com/dereknex/immune-brain/commit/177e692feda1f02ded54cbc24e567d82fe527ac5) Thanks [@dereknex](https://github.com/dereknex)! - A claude-code reviewer now runs with `--plugin-dir` set to the Claude plugin root the Kernel runtime was loaded from. Without it the reviewer loaded the user-installed immune-brain, whose `authority-review` skill pinned an older review contract hash, so every Review was released as `review_contract_mismatch` whenever the Parent ran a different plugin build (for example through `claude --plugin-dir`). The Antigravity copy carries no Claude manifest and keeps the previous argv.

- [#449](https://github.com/dereknex/immune-brain/pull/449) [`88af795`](https://github.com/dereknex/immune-brain/commit/88af795efec08364d9850f7d73aa4c5396a35319) Thanks [@dereknex](https://github.com/dereknex)! - A claude-code verifier now runs with `--add-dir` on its verification packet directory. The packet is written to a temporary directory outside the reviewed tree, and `dontAsk` denied the Read of it, so the verifier answered in prose instead of the verdict JSON. The verify directory is also resolved with `realpath`, as the review directory already was.

## 8.1.3

### Patch Changes

- [#478](https://github.com/dereknex/immune-brain/pull/478) [`ab0ee72`](https://github.com/dereknex/immune-brain/commit/ab0ee72616f8562b70d7b0c3d898449f617f9cb8) Thanks [@dereknex](https://github.com/dereknex)! - Antigravity `PreToolUse` now builds each `force_ask` confirmation from the same `HostRuntime` path the later MCP call executes, instead of a second batch and task preflight. The preview stops before issuing Batch Authorization or starting a run, and it performs no final verification, tracker write, or critical integration. Single-use grants, digest binding, and refusal after the confirmed workspace changes remain in place.

  `preparePiCanary` no longer includes `generated_at` in the owner digest, so a grant written by the Hook process still matches when the MCP server consumes it. Restoring a staged TaskIntent refreshes its Git index stat, so a later projection does not treat the restored sidecar as unstaged. The Antigravity plugin check now rejects generated files that are missing from the derived-files declaration.

## 8.1.2

### Patch Changes

- [#476](https://github.com/dereknex/immune-brain/pull/476) [`536573b`](https://github.com/dereknex/immune-brain/commit/536573bb1a6a080cabd5dfba19553b650b6212a4) Thanks [@dereknex](https://github.com/dereknex)! - Antigravity `start_unattended_batch` and `retire_stale_batch` no longer refuse every call with `run_entry_required: A gated call needs exact Hook session and workspace correlation`. The shared MCP runtime required a Claude-only `.continuation-call` correlation before reading the `PreToolUse` admission, and only skipped that requirement when a test injected an admission port, so the production Antigravity server never reached its admission. The single-use admission, already bound to its call, operation, Hook session, live drive entry and workspace, is now the gated call's correlation on every Host, and the Claude admission names its Hook session. The redundant unversioned-Host check, the unused `true` admission, the duplicated `start_unattended_batch`/`retire_stale_batch` gate and the two Claude-only fields Antigravity's profile carried are removed. A trusted client with an unsupported Host version is now refused for its version before its interaction capability.

  Antigravity's `PreToolUse` now denies a gated call that has no live drive entry, as Claude Code's hook does, instead of opening a `force_ask` confirmation that the server would refuse anyway. `force_ask` remains the native confirmation for an admitted call (ADR 0004, `antigravity-harness` spec §3).

## 8.1.1

### Patch Changes

- [#475](https://github.com/dereknex/immune-brain/pull/475) [`7d760c3`](https://github.com/dereknex/immune-brain/commit/7d760c34ef5a1f42f19fbcbd772fe65ef71331a3) Thanks [@dereknex](https://github.com/dereknex)! - Antigravity privileged operations now confirm through Antigravity's native `PreToolUse` `force_ask` channel instead of server-initiated MCP `elicitation/create`, which Antigravity CLI cancels after ~30 seconds without opening a native prompt (ADR 0004). `antigravityPreToolUseHookAsync` prepares the operation's `NativeConfirmationInput` (batch preflight/retire or task-level `request_authorization`, `approve_breaking_intent_revision` with temporary sidecar staging restored before returning, `stop`, and `repair_authority_state`), persists a step-correlated single-use `.confirm` grant in the private Antigravity cache, and returns `{"decision":"force_ask","reason":"..."}`; `PostToolUse` clears unused grants when the user rejects or cancels, and `ANTIGRAVITY_MCP_PROFILE.requestConfirmation` consumes the matching grant once during `tools/call` while failing closed (`interaction_not_opened` or `workspace_changed`) on unconfirmed calls, replays, or post-confirmation binding drift. Claude Code's MCP `elicitation/create` confirmation channel is unchanged.

- [#472](https://github.com/dereknex/immune-brain/pull/472) [`a6aa54a`](https://github.com/dereknex/immune-brain/commit/a6aa54a8609ce8709489c71b2e15d26506baec98) Thanks [@dereknex](https://github.com/dereknex)! - The claude-code CLI reviewer now reads its own Review packet and evidence directories and runs its allowlisted git commands. `reviewArguments` passes `--add-dir` for the packet directory and the evidence directory, placed before `--max-turns` so the variadic flag never swallows the prompt, and `--settings` with `disableAllHooks: true`, so a user PreToolUse hook that rewrites `git diff` no longer falls outside `--allowedTools` under `dontAsk`, and `BASH_MAX_OUTPUT_LENGTH` of 150000, so a whole reviewed file fits. The packet directory is resolved to its real path. Pi and Antigravity reviewer arguments are unchanged (#447).

- [#473](https://github.com/dereknex/immune-brain/pull/473) [`cac0861`](https://github.com/dereknex/immune-brain/commit/cac086160f5906b76ef41bad67b9eaf539f49d13) Thanks [@dereknex](https://github.com/dereknex)! - Adapter machinery both Hosts share now lives once in the new host-neutral layer `plugins/immune-brain/runtime/host-core/`, which ADR 0038 and the layering reference record under `kernel ← assurance ← host-core ← adapter`. Slice S1 moves the hook event log and its private-file helpers there: the Claude Code and Antigravity adapters keep no copy, so the Antigravity log gains the ownership check, the `0700`/`0600` modes and the `O_NOFOLLOW` open it lacked, and its `sessions()` returns session ids instead of file-name hashes. Antigravity's `--hook` also appends the start event of an allowed `invoke_subagent` / `Subagent` dispatch, which the matching `PostToolUse` already terminated. `tests/runtime-layering-boundary.test.ts` gains a rule refusing a `kernel/` or `assurance/` import of `host-core`. Verifier state machines, runtimes, the MCP runtime and run continuation are unchanged; no user-visible behavior changes (#414).

- [#473](https://github.com/dereknex/immune-brain/pull/473) [`18d5d68`](https://github.com/dereknex/immune-brain/commit/18d5d68ed83b36a42891738b9d70d0b47051bc0f) Thanks [@dereknex](https://github.com/dereknex)! - One host-neutral MCP stdio runtime now serves both Hosts: `plugins/immune-brain/runtime/host-core/mcp_runtime.ts` holds `createMcpRuntime`, `handleJsonRpc` and `serveStdio`, configured by an `McpHostProfile` (serverInfo and contract, trusted client names, the tool-call correlation meta key and its refusal, the elicitation refusals, the probe, the runtime factory, the phase admission, the run-session correlation reader, the hook dispatcher and the bundle path). `claude/mcp_server.ts` and `antigravity/mcp_server.ts` keep only their profile, `--hook` dispatch and entrypoint guard, so the Antigravity adapter no longer imports the Claude one and the host-to-host baseline in `tests/runtime-layering-boundary.test.ts` is empty; the layering reference states that zero baseline. The Antigravity MCP server now composes `AntigravityRuntime` through its profile instead of the Claude runtime wrapper. #429 per-call workspace resolution (`_meta` workspace, then the first `file://` root, then the server's own workspace) is preserved, as are the tool surface, the correlation refusals and every Kernel outcome. No user-visible change (#414 S4).

- [#473](https://github.com/dereknex/immune-brain/pull/473) [`1b022f6`](https://github.com/dereknex/immune-brain/commit/1b022f647c7a0f46ba0d49acbbc48e23756c64be) Thanks [@dereknex](https://github.com/dereknex)! - Run continuation session state moves into the host-neutral `host-core` layer: `plugins/immune-brain/runtime/host-core/run_continuation_session.ts` now owns the Claude Code session metadata files, the one-use tool-call correlation, pause, the native-failure counter and binding migration, driven by typed Host events, and the Antigravity Stop rule is a pure function there over the task projection. `claude/run_continuation.ts` keeps only payload parsing, transcript boundary and output rendering, and `antigravity/run_continuation.ts` keeps payload parsing and rendering, so neither adapter keeps a second copy of the automated obligations. Session metadata past the 256 KiB bound now reads as a blank session instead of a verification fault. Behavior is otherwise unchanged; no user-visible change (#414).

- [#473](https://github.com/dereknex/immune-brain/pull/473) [`748c0a1`](https://github.com/dereknex/immune-brain/commit/748c0a15579bc9de1453e1385bf47110da7020cb) Thanks [@dereknex](https://github.com/dereknex)! - One host-neutral runtime now serves both Hosts: `plugins/immune-brain/runtime/host-core/runtime.ts` holds `HostRuntime`, the body the Claude Code and Antigravity runtimes previously shared by inheritance, and each adapter composes an instance with its own `HostRuntimeProfile` (host id, native confirmation reference, `AssuranceHostPort` and its `observe`, probe, Lane relay factory, Lane parent check). `AntigravityRuntime extends ClaudeRuntime` is gone, so `plugins/immune-brain/runtime/antigravity/kernel_ports.ts` no longer imports the Claude runtime and the host-to-host baseline in `tests/runtime-layering-boundary.test.ts` shrinks to its last edge (`antigravity/mcp_server -> claude/mcp_server`, retired by S4). `NativeAuthorityError` is declared once in `runtime/host-core/interaction.ts`; both adapters re-export or import it, and each runtime composition names its own confirmation reference (`claude-*` for the Claude profile, `antigravity-*` for the Antigravity profile; the Antigravity MCP entrypoint still composes the Claude profile until S4 moves it onto the shared MCP runtime). Public adapter method names, tool behavior and Kernel outcomes are unchanged. Known follow-up outside this Slice's scope: `.imm/risk-floor.json` still floors `runtime/claude/kernel_ports.ts` (now the adapter facade) rather than `runtime/host-core/runtime.ts`. No user-visible change (#414).

- [#473](https://github.com/dereknex/immune-brain/pull/473) [`d920473`](https://github.com/dereknex/immune-brain/commit/d9204739d5ed2a65855cd9bad61806df0da7f09b) Thanks [@dereknex](https://github.com/dereknex)! - Verifier observation now has one state machine in the host-neutral layer: `plugins/immune-brain/runtime/host-core/verifier_observation.ts` binds the `VerificationRequest` directly and both Hosts map their own hook events into its `start` / `result` / `stop` / `session_end` vocabulary. Each adapter keeps only that mapping and its result resolution, so the Claude Code and Antigravity receipts now settle through the same outcomes: a start without its terminal keeps the reservation, a foreign agent, a model that differs from the reservation, a duplicate result and a finished session all refuse it. Antigravity's `PostToolUse` is terminal for its verifier dispatch (BR-SCN-1), so a receipt written by its own `--hook` entry no longer waits for a `SubagentStop` that Host never sends; the Antigravity hook log stores the shared vocabulary directly. `ReviewRequest.prompt` is removed: a Host receives the per-dispatch facts only, and the role contract and static review rules stay generated from the reviewer definition. No user-visible change on the Claude Code Host (#414).

## 8.1.0

### Minor Changes

- [#457](https://github.com/dereknex/immune-brain/pull/457) [`cc567b1`](https://github.com/dereknex/immune-brain/commit/cc567b1c9100630aa4b7d9268f00726e0f4d14df) Thanks [@dereknex](https://github.com/dereknex)! - A project can list where a `routine` risk declaration may stand in `.imm/routine-classes.json`. When a `routine` task's actual diff leaves every listed class, the Kernel raises it to `material`, so it needs Review; nothing is refused and no gate opens. An untrusted list makes every task `critical`, and the file itself is always `critical`. `imm-kernel inspect --json` reports `risk.routine_classes` and `risk.outside_routine_allowlist`, and the Review manifest lists the escaping paths. Without the file nothing changes. ADR 0038 records the decision; this repository pilots a `docs-only` class.

- [#470](https://github.com/dereknex/immune-brain/pull/470) [`22420e6`](https://github.com/dereknex/immune-brain/commit/22420e69287ad767311c88c10893ed42e32d5be8) Thanks [@dereknex](https://github.com/dereknex)! - Inside Herdr the Parent now drives each Lane Executor session through the new
  `imm-session` command and the Supervised Session Port (ADR 0038) instead of
  spelling `herdr` commands itself. The Herdr adapter keeps the same tabs, focus
  rule, dialog handling and event-driven wait, pins Herdr protocol 22, and fails
  closed when Herdr is unavailable. Kernel and batch behavior are unchanged.
  Antigravity is now a Herdr Executor Host (kind `agy`) alongside Claude Code and
  Pi, matching the hosts the Lane configuration already accepts.
  `imm-session --provider herdr-core` adds a herdr-core adapter on the `hc` CLI;
  the Loop contract does not use it yet.

### Patch Changes

- [#470](https://github.com/dereknex/immune-brain/pull/470) [`15445df`](https://github.com/dereknex/immune-brain/commit/15445df942cdceb669d20df61dea2af2bfe361fe) Thanks [@dereknex](https://github.com/dereknex)! - Antigravity native tools work again on v8.0.0. A hook payload that carries
  `lastUserInput` alongside `toolCall` is dispatched as a tool instead of a
  `PreInvocation`, so `PreToolUse`/`PostToolUse` answer correctly and
  `invoke_subagent` completion is observed again.

  The lazy `call_mcp_tool` form is now matched by the canonical `PreToolUse`
  matcher and admitted only when it targets Immune-Brain; other lazy servers stay
  an ordinary allow. A privileged Antigravity batch call no longer needs Claude
  metadata: it is correlated by `antigravity.google/conversation_id` plus the
  `progressToken` step suffix that matches the Hook's `stepIdx`, and consuming
  that admission revalidates the conversation's live entry token and workspace.
  The admitted conversation becomes the runtime Hook session instead of the
  transport connection id. Claude Code keeps its exact
  `claudecode/toolUseId` correlation, and Herdr process supervision is unchanged.

- [#471](https://github.com/dereknex/immune-brain/pull/471) [`b078ade`](https://github.com/dereknex/immune-brain/commit/b078ade02c0716069473ef01609ceba49fab2e57) Thanks [@dereknex](https://github.com/dereknex)! - The packaged `docs/reference/supervised-session-port.md` now matches its source,
  so the installed Claude and Antigravity artifacts carry the measured
  `herdr-core` admission status instead of the pre-measurement text.

## 8.0.0

### Major Changes

- [#440](https://github.com/dereknex/immune-brain/pull/440) [`054262c`](https://github.com/dereknex/immune-brain/commit/054262ca0bc5ca44121b3f6bf440d2bd09b34fe3) Thanks [@dereknex](https://github.com/dereknex)! - Authority Review is CLI-only. The `IMMUNE_BRAIN_REVIEW_DISPATCH` switch is gone,
  along with the subagent Review path it could re-enable: no Host reserves, blocks
  or observes a reviewer `Agent` dispatch any more, the generated
  `immune-brain-reviewer` agent definition is no longer shipped, and a
  `REVIEWER_DISPATCH_RULES` definition no longer exists. `advance_assurance`
  always returns `review_command`, so a project without `lanes.review_host` stops
  with `review_profile_required` instead of falling back to an Agent dispatch.
  Findings verification and `immune-brain-review-verifier` are unchanged.

### Minor Changes

- [#440](https://github.com/dereknex/immune-brain/pull/440) [`e3b45d9`](https://github.com/dereknex/immune-brain/commit/e3b45d980521b7f00056b13eae839ba6df305f8b) Thanks [@dereknex](https://github.com/dereknex)! - Authority Review now runs as a separate CLI process by default. `advance_assurance` returns `review_command` and `review_profile` instead of `agent_params`, and the Parent runs that command in its own shell before `submit_review`; the in-process reviewer stays reachable with `IMMUNE_BRAIN_REVIEW_DISPATCH=subagent` until the next release deletes it. A project without `lanes.review_host` stops Review preparation with `review_profile_required` and one recovery action, retaining its QA settlement. `drive.md`, `drive-batch.md` and the subagent dispatch protocol describe the CLI stage, and ADR 0037 supersedes the primary-Review parts of ADRs 0006, 0017 and 0030.

- [#440](https://github.com/dereknex/immune-brain/pull/440) [`6d1a132`](https://github.com/dereknex/immune-brain/commit/6d1a132b0d830dcfc32afb0b9d431a2b10ce1e57) Thanks [@dereknex](https://github.com/dereknex)! - Authority Review can run as a separate CLI process selected by the new `lanes.review_host` profile, behind `IMMUNE_BRAIN_REVIEW_DISPATCH=cli`. The runtime writes one review packet and a POSIX `sh` script, the Parent runs the script in its own shell, and `submit_review` settles the reviewer's output through the existing mediated receipt path. A tree guard over HEAD, the index and tracked content releases any round that changed the reviewed state. The generated `authority-review` skill ships in all three Host packages and stamps the review contract hash, so a reviewer with a different install answers `REVIEW_CONTRACT_MISMATCH` instead of reviewing. The switch defaults to `subagent`, so the in-process reviewer and findings verification are unchanged.

### Patch Changes

- [#438](https://github.com/dereknex/immune-brain/pull/438) [`85dc48e`](https://github.com/dereknex/immune-brain/commit/85dc48eef5a0e34eab23368cd036204ac2f94b1e) Thanks [@dereknex](https://github.com/dereknex)! - Resolve the active Antigravity workspace per MCP tool call instead of the process `cwd`. `tools/call` `params._meta["antigravity.google/workspace_paths"][0]` wins, then the first `file://` root answered by MCP `roots/list` (cached until re-`initialize` or `notifications/roots/list_changed`), then `options.cwd ?? process.cwd()`, and the resolved path is bound on `ClaudeRuntime` before any tool runs. The Antigravity runtime trusts the `antigravity-client` and `antigravity` client names, `parseSemver` normalizes one optional leading `v`, and `serveStdio` delegates to the shared bidirectional transport so it can issue `roots/list`. Both bundled entrypoints now start only their own server, so `dist/antigravity/mcp-server.mjs` answers once per request.

- [#440](https://github.com/dereknex/immune-brain/pull/440) [`36cfe89`](https://github.com/dereknex/immune-brain/commit/36cfe898835eba6750184b351af02474a679131b) Thanks [@dereknex](https://github.com/dereknex)! - Batch integration no longer fails with `pathspec ... did not match` when a Lane
  deletes a file declared in `docs/agents/derived-files.json`. The containment
  step now stages only the regenerated delta instead of every declared output.

- [#440](https://github.com/dereknex/immune-brain/pull/440) [`a57d355`](https://github.com/dereknex/immune-brain/commit/a57d35543d745884791c397845884788d0615779) Thanks [@dereknex](https://github.com/dereknex)! - Resolve a Review profile in the layered lane configuration. `lanes` accepts `review_host` (`pi`, `claude-code` or `antigravity`), `review_model` and `review_effort` in user Lane profiles and in the project file, with the active-profile → project precedence; the model and effort apply only in the layer that sets `review_host` and otherwise report `not_applied`, as the executor keys do. `chooseReviewer` in `runtime/config/layered_config.ts` returns `{ host, model?, effort? }` or `null`, with no model-distinctness check. No Review dispatch change.

## 7.2.2

### Patch Changes

- [#430](https://github.com/dereknex/immune-brain/pull/430) [`4c49d9b`](https://github.com/dereknex/immune-brain/commit/4c49d9b525ad6fda311a7c78003cf2f629d5bfa1) Thanks [@dereknex](https://github.com/dereknex)! - Exhaustive `clarify` interrogation now checks a seventh lens, inventive catalyst, with an inlined ten-pattern catalog (after EGM `agents/inventive_catalyst.md` at `6a8001e`), a required secondary cost per proposed pattern, and `No false compromise detected` when nothing is found. `docs/reference/planning-quality-gate.md` gains an advisory false-compromise check for Medium/High risk Specs, and the `draw-up` Planning Quality Gate bullet points at it. Instruction text only; no runtime change.

- [#432](https://github.com/dereknex/immune-brain/pull/432) [`1e685ef`](https://github.com/dereknex/immune-brain/commit/1e685ef20f25c2a1d7efaf41299d45d8d311c889) Thanks [@dereknex](https://github.com/dereknex)! - Inject the Host probe at each adapter's composition root instead of dispatching on `parentHost` inside the Claude adapter. `ClaudeRuntimeOptions` and `McpRuntimeOptions` take an optional `probeHost` defaulting to the Claude probe; `AntigravityRuntime` and `createAntigravityMcpRuntime` supply the Antigravity probe. The shared MCP runtime's three authority gates judge the session with that probe and name the actual Host in their refusals while the environment version fallback stays disabled. The Claude adapter no longer imports `runtime/antigravity/capability`, and the host-to-host baseline in `tests/runtime-layering-boundary.test.ts` and `docs/reference/layering-rules.md` shrinks to four edges owned by #414.

- [`c4a3994`](https://github.com/dereknex/immune-brain/commit/c4a39942df693e19df9b5eab67ebe66abdd70d77) Thanks [@dereknex](https://github.com/dereknex)! - Add `docs/reference/layering-rules.md` and ADR 0035 recording the Dependency Rule, Port slicing, mapping convergence and module-documentation norms. The Planner contract now asks each behavior acceptance for an observable done-looks-like beside its agreed seam and requires slicing, dependency direction and an ADR for new layers; the Executor role prompt and drive Execution Loop point at the same reference. Instruction text only; no runtime change.

- [#427](https://github.com/dereknex/immune-brain/pull/427) [`484275a`](https://github.com/dereknex/immune-brain/commit/484275a1e99f2de2fb642714f8e2c4b2b9be5670) Thanks [@dereknex](https://github.com/dereknex)! - Settle Review from the reviewer's own transcript when the Claude `Agent` tool returns synchronously. A `--print` (`sdk-cli`) Executor used to settle on the tool result, whose text is only the "delivered to you as a message" pointer notice; the receipt now comes from `<dirname(T)>/<basename(T, ".jsonl")>/subagents/agent-<agentId>.jsonl` (or the `SubagentStop` `agent_transcript_path`) read with the async path's `realpath`/`readPrivate` checks and `readAgentTranscriptResult`. `tool_response.content` and `handbackReport` never become a receipt, and an unreadable or empty transcript fails closed with `sync Agent transcript is not readable` / `sync Agent transcript carries no reviewer result`. The Claude verifier receipt binds through the same branch. The async branch and the correlation rules are unchanged; existing `--print` batch records are not migrated.

- [#431](https://github.com/dereknex/immune-brain/pull/431) [`ec32ca4`](https://github.com/dereknex/immune-brain/commit/ec32ca4e9e71a5329e55839210f95cd887e5a954) Thanks [@dereknex](https://github.com/dereknex)! - Refuse `drive` on an unborn Git HEAD and retire the Enrollment Git-base initialization and precondition-commit code (ADR 0036, Issue #401). After drive-always-lanes S7 (#396) nothing in production created an empty root commit or staged an Enrollment precondition, so `initializeEnrollmentGitBase`, `commitEnrollmentPreconditions`, `commitUnbornEnrollmentPreconditions` and their helpers are deleted; a Lane stages the TaskIntent and bound Spec and commits nothing. A repository whose HEAD names an absent branch, or whose branch ref is corrupt, is refused by preflight with the unchanged `git_head_unreadable` reason `enrollment requires a committed Git HEAD` and touches no ref, commit or index byte. The test enrollment helper now mirrors the Lane's staging instead of committing.

## 7.2.1

### Patch Changes

- [#421](https://github.com/dereknex/immune-brain/pull/421) [`41cb417`](https://github.com/dereknex/immune-brain/commit/41cb4174aefb8cfa507c962fa3123cfe1dafda6d) Thanks [@dereknex](https://github.com/dereknex)! - Ship Antigravity as an isolated, relocatable plugin at `plugins/immune-brain-antigravity/` with a native `.antigravity-plugin/plugin.json`, five native read-only role definitions, hooks that start without `PLUGIN_ROOT`, and the complete skill, CLI, runtime and role-prompt closure inside the directory. `agy plugin validate --strict` now passes. The shared-root Antigravity manifest, hooks, MCP config and bundle are retired: reinstall Antigravity from `plugins/immune-brain-antigravity/`. Pi and Claude Code roots are unchanged.

- [#421](https://github.com/dereknex/immune-brain/pull/421) [`b254c8c`](https://github.com/dereknex/immune-brain/commit/b254c8c5322399a917912da49094c6a7c8aa70cd) Thanks [@dereknex](https://github.com/dereknex)! - Repair single-task batch finalization. A verified task whose checkout is blocked now persists a readable `needs_human` batch with the real reason and the passing result nested in the final report, instead of failing on the completed-only top-level proof. A failed, timed-out or stale final verification keeps the integration but never delivers or cleans up. A replay reuses only an unchanged validated pass, reconciles an already applied delivery only when its full identity (content and modes, or ref lineage) matches, and parks any changed bytes.

- [#421](https://github.com/dereknex/immune-brain/pull/421) [`73cbad8`](https://github.com/dereknex/immune-brain/commit/73cbad83987a25f7ee232911d08366204b16c305) Thanks [@dereknex](https://github.com/dereknex)! - Make single-task manual checkout delivery succeed per delivered path. A path that already sits in the coordinator checkout with identical index mode and blob, worktree bytes and executable bit (or a delivered deletion already absent) is satisfied and left untouched, so the coordinator can keep the task's own planning sidecar while the same file is part of the delivery. Every other path still blocks on a dirty overlap and is never overwritten; auto mode and whole-delivery replay semantics are unchanged.

- [`297c5c9`](https://github.com/dereknex/immune-brain/commit/297c5c999bb890e71729670bab4bbda11a016354) Thanks [@dereknex](https://github.com/dereknex)! - Run new single-task Lanes inside Herdr in interactive Executor tabs, using the same Parent supervision as Initiative batches. Persist the execution mode across re-entry, preserve existing runtime-supervised tasks, and keep interactive Lanes after delivery when no trusted process exit is available. Parent decision relay no longer starts a background Executor for an interactive Lane. Frozen Lanes waiting on user decisions remain enrolled and expose the decision in their report. An approved interactive stop records the stopped reason immediately and returns the instruction to close the Executor tab.

- [`297c5c9`](https://github.com/dereknex/immune-brain/commit/297c5c999bb890e71729670bab4bbda11a016354) Thanks [@dereknex](https://github.com/dereknex)! - Fix single-task Lane preflight rejecting historical consolidation records as invalid batch state. Skip records with unrelated contracts while retaining fail-closed validation for malformed JSON and invalid or unsupported batch records.

## 7.2.0

### Minor Changes

- [#406](https://github.com/dereknex/immune-brain/pull/406) [`7295299`](https://github.com/dereknex/immune-brain/commit/7295299ea7ef05db585d8e77822dfdb70074ee66) Thanks [@dereknex](https://github.com/dereknex)! - Allow a standalone TaskIntent to start as a single-task Lane batch through the native batch authorization gate.

- [#406](https://github.com/dereknex/immune-brain/pull/406) [`ac1b2e2`](https://github.com/dereknex/immune-brain/commit/ac1b2e25a5f961a0c3748aef3fd619fd81165322) Thanks [@dereknex](https://github.com/dereknex)! - Supervise a standalone Lane's Executor process from the invoking Host, including reattachment, interruption, and generation-bound exit observations.

- [#406](https://github.com/dereknex/immune-brain/pull/406) [`96d350d`](https://github.com/dereknex/immune-brain/commit/96d350d21239dea506ec57904eeb3f5799299305) Thanks [@dereknex](https://github.com/dereknex)! - Return integrated single-task Lane changes to the user's checkout according to the Git integration preference, preserving unrelated edits and parking on conflicts.

- [#406](https://github.com/dereknex/immune-brain/pull/406) [`aa207e2`](https://github.com/dereknex/immune-brain/commit/aa207e280fbe74d4c9ce339a234023f58ec0d53c) Thanks [@dereknex](https://github.com/dereknex)! - Remove a delivered single-task Lane, its `imm-lane/` branch and `imm/<task_id>` only on a runtime-observed normal exit of the current Executor generation and a clean Lane; otherwise retain it and report `batch_lane_retained` with the failed condition.

- [#406](https://github.com/dereknex/immune-brain/pull/406) [`4c28646`](https://github.com/dereknex/immune-brain/commit/4c2864614f3507e89103e0a8cf0568f047be8056) Thanks [@dereknex](https://github.com/dereknex)! - Answer a single-task Lane's literal-user decision (resolve a user decision, authorize rework or review retry, approve a breaking revision, or stop) at the Parent Host's native gate: the runtime applies it to the Lane store, rebinds the batch's approved identity for a breaking revision, and starts the next Executor generation. Initiative batch children keep their behavior.

  Also fix four defects the relay exposed in single-task Lane supervision: the batch report no longer drops `lane_decision_required` when the Executor exits, Pi mutations no longer fail layout checks once a Lane Executor has run (`.imm/state/lane-supervisors/` is a recognised state path), a Parent poll retries a transient `Kernel recovery projection changed` instead of aborting, and an Executor exit between two calls is recorded as handled so the next call starts generation N+1.

- [#406](https://github.com/dereknex/immune-brain/pull/406) [`3838e09`](https://github.com/dereknex/immune-brain/commit/3838e09703761484065433479dfb8cd2c183a244) Thanks [@dereknex](https://github.com/dereknex)! - Retire in-place Enrollment: the Claude Code `enroll` MCP tool and the Pi `imm_canary_enrollment` tool are deleted with their native-gate code and run-entry admission, so every new single-task `drive` entry runs in a Lane. A TaskRecord enrolled in place earlier still advances to terminal through the loop tools.

## 7.1.0

### Minor Changes

- [#368](https://github.com/dereknex/immune-brain/pull/368) [`bfc2338`](https://github.com/dereknex/immune-brain/commit/bfc23384fb7d7e6fd954d71d9c521d9978b88eab) Thanks [@dereknex](https://github.com/dereknex)! - Resolve decision model profiles and egress through layered configuration, with legacy source warnings.

- [#368](https://github.com/dereknex/immune-brain/pull/368) [`bfc2338`](https://github.com/dereknex/immune-brain/commit/bfc23384fb7d7e6fd954d71d9c521d9978b88eab) Thanks [@dereknex](https://github.com/dereknex)! - Resolve Git integration and Initiative carrier preferences from layered configuration, with deprecated instruction-file fallbacks.

- [#368](https://github.com/dereknex/immune-brain/pull/368) [`5829cff`](https://github.com/dereknex/immune-brain/commit/5829cff7f5b666748b4f5cbb033b16a1376740c2) Thanks [@dereknex](https://github.com/dereknex)! - Resolve Lane preferences and batch verification through layered configuration.

- [#368](https://github.com/dereknex/immune-brain/pull/368) [`b74711c`](https://github.com/dereknex/immune-brain/commit/b74711cd8ff3a6291023807b54d74537a2c1a447) Thanks [@dereknex](https://github.com/dereknex)! - Add layered user and project configuration with a read-only resolver and status diagnostics.

- [#337](https://github.com/dereknex/immune-brain/pull/337) [`de7e939`](https://github.com/dereknex/immune-brain/commit/de7e9390225a2be39927381b60123f915b0eaceb) Thanks [@dereknex](https://github.com/dereknex)! - Group revisit candidate chains by kind and key in the `revisit_evidence/v2` document, cap the text report at five groups per kind, split `error_resume` from `user_resume` with locating fields, and list only sessions with activity.

- [#335](https://github.com/dereknex/immune-brain/pull/335) [`abbe38a`](https://github.com/dereknex/immune-brain/commit/abbe38a899c6be0e6ea3826844c795260597fccb) Thanks [@dereknex](https://github.com/dereknex)! - Emit pointed revisit session evidence and reproducible windows, with candidate chains and unverified markers.

- [#335](https://github.com/dereknex/immune-brain/pull/335) [`431ad3e`](https://github.com/dereknex/immune-brain/commit/431ad3e37b10fca27b036e7b416049992ea193a5) Thanks [@dereknex](https://github.com/dereknex)! - Make `revisit` diagnose workflow friction through evidence-chain verification and a focused recommendation.

- [#358](https://github.com/dereknex/immune-brain/pull/358) [`f5ca495`](https://github.com/dereknex/immune-brain/commit/f5ca4950b9ebc6614341f54415f9ec843fde1ad4) Thanks [@dereknex](https://github.com/dereknex)! - A Review rework result now names a generalize-or-refute obligation when the same acceptance draws a blocking finding in two consecutive rounds. The result gains an optional `convergence` array of `{acceptance_id, streak, obligation: "generalize_or_refute"}`, computed from the committed record with `acceptanceRepeatSeries`; a null acceptance never appears, and the key is absent otherwise. The Executor guidance and the drive rework step pass it on. The rework round budget, `replan_required` parking, verdict bytes and Review independence are unchanged.

### Patch Changes

- [#346](https://github.com/dereknex/immune-brain/pull/346) [`82853d6`](https://github.com/dereknex/immune-brain/commit/82853d63d598c35ebf291de3929e241f72c83f43) Thanks [@dereknex](https://github.com/dereknex)! - Preserve complete historical Slice entries during Initiative amendments, including multiline prerequisite annotations. Reject ambiguous entry boundaries before remote mutations.

- [#375](https://github.com/dereknex/immune-brain/pull/375) [`7b5e982`](https://github.com/dereknex/immune-brain/commit/7b5e9825dcd7b5b556b781723eeccf23c3eb14c1) Thanks [@dereknex](https://github.com/dereknex)! - Park fully duplicated Lane changes with a distinct reason while continuing to integrate partial overlaps.

- [`d1d9278`](https://github.com/dereknex/immune-brain/commit/d1d9278ede0d87a4d19d3a51cfc0c87e9a449ed0) Thanks [@dereknex](https://github.com/dereknex)! - Integrate a Lane commit that merges cleanly onto the batch head when an integrated sibling changed other hunks of the same file, instead of parking it as `batch_integration_conflict`. A candidate whose tree differs from the reproducible merge is still refused.

- [#368](https://github.com/dereknex/immune-brain/pull/368) [`fcffb25`](https://github.com/dereknex/immune-brain/commit/fcffb250c6ca00cb3038a789d1be1549713e3a68) Thanks [@dereknex](https://github.com/dereknex)! - Document the layered configuration: the user file, the tracked `.imm/config.json`, precedence, `imm-kernel config --json` and the deprecated legacy sources.

- [#375](https://github.com/dereknex/immune-brain/pull/375) [`76f000e`](https://github.com/dereknex/immune-brain/commit/76f000e1fe0e95a35fef5864aed3f9ac7bf3b6a2) Thanks [@dereknex](https://github.com/dereknex)! - Regenerate declared derived outputs when integrating Lane changes that touch their sources or outputs.

- [#378](https://github.com/dereknex/immune-brain/pull/378) [`226aa9a`](https://github.com/dereknex/immune-brain/commit/226aa9a5b1a4cda5397d1f1d892f062ba69aff06) Thanks [@dereknex](https://github.com/dereknex)! - Show the selected Initiative carrier and its source before planning questions, including the replacement details for legacy configuration.

- [#376](https://github.com/dereknex/immune-brain/pull/376) [`76f0ddc`](https://github.com/dereknex/immune-brain/commit/76f0ddc9b52cba8e67a648f09c700d9a6cb7aef4) Thanks [@dereknex](https://github.com/dereknex)! - Deprecated and ignored legacy config warnings now name each replacement key with its layer and file, including both targets for `.imm/decision-bindings.json`, and draw-up uses a `legacy:AGENTS.md` or `legacy:CLAUDE.md` Initiative carrier with its deprecation warning instead of skipping it.

- [#338](https://github.com/dereknex/immune-brain/pull/338) [`e2f467a`](https://github.com/dereknex/immune-brain/commit/e2f467a1d2c5e5f64438fb1dcec5a3cb6dae6e44) Thanks [@dereknex](https://github.com/dereknex)! - Document the `revisit_evidence/v2` `events[]` fields, route intervention and gate questions through `events[]` and pointed lines instead of raw session scans, and require every rerun to reuse the recorded window and scope.

- [#329](https://github.com/dereknex/immune-brain/pull/329) [`efef21c`](https://github.com/dereknex/immune-brain/commit/efef21c8927168e22138ef0aad7af4711a638a32) Thanks [@dereknex](https://github.com/dereknex)! - `revisit` session finding totals now count a `submit_review` that omits its verdict: the analyzer applies the observed Review receipt (the verdict JSON in the latest Review `Agent` toolResult), as the Kernel does, and each submit consumes that receipt so findings are not counted twice. Previously these findings, the common case, were missing from blocking and advisory totals.

## 7.0.0

### Major Changes

- [`b4fc3db`](https://github.com/dereknex/immune-brain/commit/b4fc3dbbb7155144d46fd4d9ce56d9c1acf7aa10) Thanks [@dereknex](https://github.com/dereknex)! - Lane preferences move to a personal, gitignored preset `.imm/lanes.local.json` with named `profiles` and an `active` field; a request may name a profile and overlay single fields for one batch, and a malformed file, unknown profile, unknown key or invalid value stops the batch from starting. **Breaking:** the `Lane max parallel`, `Lane Executor Host`, `Lane Executor model` and `Lane Executor effort` directives in `AGENTS.md`, `CLAUDE.md` or a user-level instruction file are no longer read, and the `Batch final verification` directive is removed. Migration: copy the old directive values into a profile of `.imm/lanes.local.json` (`max_parallel`, `executor_host`, `executor_model`, `executor_effort`), set it as `active`, add the file to `.gitignore`, and delete the old lines; name final-verification commands in the request or as the full test and type-check commands in your instruction file's prose. See ADR 0033.

### Minor Changes

- [#328](https://github.com/dereknex/immune-brain/pull/328) [`e48941a`](https://github.com/dereknex/immune-brain/commit/e48941a82419c07b8a91675025145c3f33b7a0b6) Thanks [@dereknex](https://github.com/dereknex)! - `revisit` becomes a workflow-health retro over pi session logs. The model-load ranking retired: the ranking table, the review quality-and-score table and the project × author table (`rev/100ed`, `avgSc`, `pass%`) are gone, and rounds/task and finding totals no longer carry a model key. Timestamps are parsed to epoch milliseconds (ISO with any offset, or numeric) with a skipped-line count in the header, `--exclude <substr>` (repeatable) filters sessions beside `--project`, and `--top` is removed. The session reader still records the last editor model as an `author` field on review and finding events.

- [#328](https://github.com/dereknex/immune-brain/pull/328) [`ace0094`](https://github.com/dereknex/immune-brain/commit/ace00943d10b595a6aa6286b10a895415419927c) Thanks [@dereknex](https://github.com/dereknex)! - `revisit --audit <project-root>` reports lifecycle and raw review counts per committed terminal run, read from the project's HEAD Git tree through the Kernel's `readAuditTaskPair`. Its header names the project root, the HEAD commit, schema counts, skipped pairs by reason and the sample bias (only merged terminal runs are present). Per run it shows QA and Review attestations, rework events, findings by source and status, revisions, user-authorized rework, stop events and distinct evidence bindings; a field an older record schema cannot carry prints `-`. Session logs are read alongside only with `--sessions`; `--sample <n>` caps the rows. ADR 0032 records the boundary change, and the analyzer now needs Bun because it imports Kernel runtime modules.

- [#328](https://github.com/dereknex/immune-brain/pull/328) [`87f7f62`](https://github.com/dereknex/immune-brain/commit/87f7f6228434af84a11e2b666dca0a69419f581c) Thanks [@dereknex](https://github.com/dereknex)! - `revisit --audit` adds a Candidate improvements evidence section over in-window review findings: repeat groups (the same normalized summary in at least two distinct runs, with run count, finding count and up to three `run-path#finding-id` pointers), infrastructure jitter (a missing or cleaned-up reviewer agent or an empty verdict, kept out of the content rework count) and, for every run with three or more review rework events, one line per round with that round's finding acceptance ids and repeats marked. The analyzer suggests no improvement level or disposition. The `revisit` contract now carries the follow-through method (per-task aggregation, cross-boundary trace, one smallest improvement, the fix ladder architecture > types > lint > test > docs, and the report-only rule), and the project-local `workflow-evidence-retro` Skill is retired.

### Patch Changes

- [`d03982c`](https://github.com/dereknex/immune-brain/commit/d03982c95a7027897ffd98cfc640a61b43503d95) Thanks [@dereknex](https://github.com/dereknex)! - Use the published Parent Slice plan to verify isolated GitHub Slice prerequisites.

- [`f3208bc`](https://github.com/dereknex/immune-brain/commit/f3208bc774f0e6376e1be6217d7a9dda0f3d4cd4) Thanks [@dereknex](https://github.com/dereknex)! - Reject TaskRecord v4 Review rework history whose revision does not match the Enrollment base.

## 6.0.0

### Major Changes

- [`068f969`](https://github.com/dereknex/immune-brain/commit/068f9697cc52038186d3e233d17452d7d0bd55fd) Thanks [@dereknex](https://github.com/dereknex)! - Rename the packaged skills to bare verbs (ADR 0031): `imm-brainstorm` → `clarify`, `imm-planner` → `draw-up`, `imm-run` → `drive`, `imm-retro` → `revisit`, `imm-doc-slim` → `slim`, `imm-doc-prune` → `prune-docs`, `imm-test-prune` → `prune-tests`, `imm-pr-fix` → `fix-pr`; `dist/imm-run-batch.md` is now `dist/drive-batch.md`.

  Breaking: old names are not aliased and no longer enter a phase, including `imm-loop` in a user alias. Edit your own commands (`.claude/commands`, `~/.claude/commands`) and Pi prompt templates by hand; an alias enters a phase only through a marked mention such as `/drive`, `/immune-brain:drive` or `/skill:drive`. After upgrading, refresh the Claude Code plugin cache and run `/reload` in Pi. Enter runs with `/drive`, `/immune-brain:drive` (Claude Code) or `/skill:drive` (Pi). If you have a skill of your own named `drive`, the bare `/drive` (and on Pi `/skill:drive`) no longer enters a run; use `/immune-brain:drive` on Claude Code.

### Patch Changes

- [#314](https://github.com/dereknex/immune-brain/pull/314) [`3f4b506`](https://github.com/dereknex/immune-brain/commit/3f4b5061712fe172c7f67e70397fa5c5a5752078) Thanks [@dereknex](https://github.com/dereknex)! - Retire the batch redo re-issue path that no runtime caller used after Lanes became retained: a durable redo grant is still restored and still bounds a parked child, but nothing can spend one while Lane recreation is disallowed.

- [#312](https://github.com/dereknex/immune-brain/pull/312) [`8f75d4b`](https://github.com/dereknex/immune-brain/commit/8f75d4bd31576b9639af2b6c0f34bf17b55a413d) Thanks [@dereknex](https://github.com/dereknex)! - Require validated batch provenance before reusing a same-tip Parent branch, reject unbound Lane collisions, and revalidate recorded Lane identities on resume. Preserve orphaned resources after interrupted creation rather than automatically adopting them.

- [#313](https://github.com/dereknex/immune-brain/pull/313) [`8fbd5f9`](https://github.com/dereknex/immune-brain/commit/8fbd5f9e66b86148e2ae0570cc38359f2e58d895) Thanks [@dereknex](https://github.com/dereknex)! - Keep runtime-created batch Lanes when no Host reports a trusted Executor exit: an integrated Lane retains its directory, branch and ignored files with a `batch_lane_retained` notice that survives completed reports, and conflict redo, granted redo, parked revival and missing-path recovery park the child without deleting or recreating the Lane or spending a redo grant.

- [#307](https://github.com/dereknex/immune-brain/pull/307) [`6626254`](https://github.com/dereknex/immune-brain/commit/66262549793ed8db7531ff018cc96c9dc17a6ca3) Thanks [@dereknex](https://github.com/dereknex)! - Block marker-targeted Review dispatches with the wrong reviewer type or Pi Agent parameters before execution. Release unbound Review reservations with fresh-review recovery instead of waiting indefinitely, without poisoning an already-bound reviewer.

- [#307](https://github.com/dereknex/immune-brain/pull/307) [`2f45bf7`](https://github.com/dereknex/immune-brain/commit/2f45bf7e1964bbd3f61e9d9b949ce16f6515a3f4) Thanks [@dereknex](https://github.com/dereknex)! - Dispatch Review through a four-line packet handle on Pi and Claude. Keep the full reviewer instructions in an operation-named evidence packet, removed with its reservation, without changing the evidence manifest.

- [#307](https://github.com/dereknex/immune-brain/pull/307) [`ebea34b`](https://github.com/dereknex/immune-brain/commit/ebea34b981202dd996f5c9ca2806697a9e64ed40) Thanks [@dereknex](https://github.com/dereknex)! - Verify Review packet bytes at dispatch and submission on both Hosts, blocking altered handles or packets and releasing invalid reservations without settling their verdicts.

## 5.6.0

### Minor Changes

- [`712ad99`](https://github.com/dereknex/immune-brain/commit/712ad9961b8c4de8da7d0918e944c0b3a9e7594b) Thanks [@dereknex](https://github.com/dereknex)! - A batch authorization now binds each child's frozen acceptance instead of its whole TaskIntent: contract, task id, goal, owner, bound Spec path, and every acceptance item's id, assertion and verification command (executable, argv, cwd). A scope-only or revision-only intent revision no longer fails a running batch with `plan_changed` or refuses its child with `batch_child_intent_changed`. When a child's frozen acceptance changes after confirmation, only that child is parked with `batch_child_authority_changed`, its dependents are skipped, and independent children finish; a change to the child set, order or dependencies still fails as `plan_changed`. `revise_intent` now treats a changed verification command or an added acceptance item as breaking, so it needs breaking-revision approval. Batch records written before this release keep whole-intent comparison. See ADR 0026 and Spec branch-boundary.

- [`dc817ca`](https://github.com/dereknex/immune-brain/commit/dc817caed5c6af9c2dd9b15da53153f6ba3a40c7) - Run new Lane batches on a Parent branch without modifying the coordinator checkout. Create child worktrees at the Parent tip, remove clean integrated Lanes, retain and report dirty Lanes, and run final verification in a disposable detached worktree. Retire lane_offers for new batches while preserving existing hidden-ref and legacy branch runs.

- [`e6aef09`](https://github.com/dereknex/immune-brain/commit/e6aef095625e2fab85e5b1e3298d8efa2e45445c) - Report Parent-batch child acceptance and QA results, beyond-estimate files, risk changes, redo counts and parked reasons. Keep manual delivery on the Parent branch; under auto, fast-forward the coordinator only after passing final verification and clean-tree ancestry checks, reporting blocked returns without overwriting local work.

- [`60d1541`](https://github.com/dereknex/immune-brain/commit/60d15411b6408e79b5006de40a5df8e3e4f38821) - Treat Lane child scope hints as estimates: review and integrate the entire child branch delivery, disclose files beyond the estimate, and schedule overlapping estimates concurrently while preserving declared dependencies.

- [#261](https://github.com/dereknex/immune-brain/pull/261) [`298a06a`](https://github.com/dereknex/immune-brain/commit/298a06a904a91f79a939cc564746d0e50c85a5f3) Thanks [@dereknex](https://github.com/dereknex)! - A batch never creates, switches or commits to a user-visible branch. Its progress lives on the hidden ref `refs/imm/batches/<batch_id>`, built with Git plumbing, so your HEAD, branch and index stay untouched; your own commits, amends and branch switches no longer interrupt a running batch. Batch preflight commits nothing, has no side effect when it rejects, and blocks only on dirty paths inside the scope of a child that has not settled. Batches recorded on the legacy `imm/<slug>` branch still resume.

- [#261](https://github.com/dereknex/immune-brain/pull/261) [`298a06a`](https://github.com/dereknex/immune-brain/commit/298a06a904a91f79a939cc564746d0e50c85a5f3) Thanks [@dereknex](https://github.com/dereknex)! - Add the `Git integration: manual|auto` preference, read from the tracked root `AGENTS.md` or `CLAUDE.md` (ADR 0024, superseding ADR 0023). The default `manual` writes no runtime commit outside batches: Enrollment stages its TaskIntent and Spec instead of committing them, unborn-HEAD in-scope changes are claimed as task work, and storage-layout migration leaves its diff in the working tree with the affected paths listed. `auto` keeps the precondition commits and, when a task settles done, commits exactly its settled scoped paths as `imm(<task-id>): settled delivery`. An invalid value behaves as `manual` with an `invalid_git_integration` status warning, and both Hosts' status Tools report the resolved mode as `git_integration`. The confirmed empty root commit for an unborn HEAD is unchanged.

- [#261](https://github.com/dereknex/immune-brain/pull/261) [`298a06a`](https://github.com/dereknex/immune-brain/commit/298a06a904a91f79a939cc564746d0e50c85a5f3) Thanks [@dereknex](https://github.com/dereknex)! - Settled delivery no longer depends on Git state. A Slice settled done with an unchanged TaskIntent counts as delivered whether its bytes are committed by the user, staged, or left in the working tree; the native Parent has no integrate action, gate, or runtime commit, and prerequisite checks follow settlement. Native Parent final verification binds the scoped content identity instead of a clean tree and HEAD, so equal content survives any user commit, amend, or stash. The `delivery_consolidation` parameter, module, and receipts are retired on both Hosts. Read-only `status` reports out-of-scope staged paths as warnings, and the Claude completion result states the settled content hash and that the user may commit however they prefer.

- [`4657a76`](https://github.com/dereknex/immune-brain/commit/4657a7691e923ce0207a10c5816f07a64e7fa0e1) Thanks [@dereknex](https://github.com/dereknex)! - Recover inside one `imm-run` entry instead of pausing. Both continuation hooks now allow two native-operation failures per entry before the third pauses the run. A Claude Stop that repeats with no progress after one nudge yields the turn instead of pausing, so a run waiting on background work keeps going. A pause, or an interrupted Pi turn, ends the entry token, so the MCP server itself refuses token-backed calls until a new literal entry. The Loop contract and BASELINE state the retry rules, the native gate kept on `enroll` and batch start, the separately committed deterministic preflight fix, and the stops that remain with the user (ADR 0025).

- [`00fbe8e`](https://github.com/dereknex/immune-brain/commit/00fbe8eac9911c2983c8de8df8864a709c83f9d7) Thanks [@dereknex](https://github.com/dereknex)! - Unattended batches now run critical children like any other child instead of leaving them out, and a Parent with only critical work left no longer falls back to native Parent delivery. Children whose scopes overlap now run one after another in Slice order, even without a declared dependency: a later overlapping child starts only after the earlier one is done, and if the earlier one is frozen the later one is skipped as blocked instead of leaving the batch stuck in `running`. `max_parallel` of 1 now starts the serial runner, the same as leaving it out; 0, negative or non-integer values are still rejected. See ADR 0025 and the run-entry decision hosting Spec (D5, D7, D8).

- [`235058d`](https://github.com/dereknex/immune-brain/commit/235058d983dd9547457740b54a98f44d1388f6cc) Thanks [@dereknex](https://github.com/dereknex)! - On Claude Code, typing `imm-run` now covers the whole run after one confirmation. Enrollment and unattended batch start still open their confirmation dialog once, and a confirmed batch start returns a manifest of each child's task id, risk, scope and verification commands. The literal entry also mints a session- and workspace-bound entry token, so a later stale batch retirement in the same run no longer asks again or needs a second `imm-run`. The token lasts until the run ends, with no time limit; it is dropped at session end and refused from another workspace, another session or after the run pauses at the Stop boundary. Breaking intent revisions, rework exits and Lane delegation still ask you, and push or PR creation are unchanged. See ADR 0025.

- [`6825b11`](https://github.com/dereknex/immune-brain/commit/6825b11440c4388e3c4ca3053992fa1bc3ee18c6) Thanks [@dereknex](https://github.com/dereknex)! - Pi now matches Claude Code for `imm-run` entry. A literal `imm-run` input (never extension-sourced input) mints a session- and workspace-bound entry token. Enrollment and unattended batch start still open their confirmation dialog once, and a confirmed batch start returns the same manifest of each child's task id, Slice, risk, scope and verification commands. A later stale batch retirement in the same run opens no dialog and records an entry-token confirmation reference bound to the retired plan digest. The token ends at session shutdown, when the run pauses or settles, and is refused from another session or workspace. Rework exits and breaking intent revisions still ask you. See ADR 0025.

### Patch Changes

- [#263](https://github.com/dereknex/immune-brain/pull/263) [`ab8999f`](https://github.com/dereknex/immune-brain/commit/ab8999f2f1c17d41bf71bda0ebcdd632893d24f8) Thanks [@dereknex](https://github.com/dereknex)! - A batch no longer loses a child's terminal audit pair to `.gitignore`. When the repository ignores `.imm/audit/` (for example with a blanket `.imm/` rule), batch preflight now refuses before the native gate with `audit_evidence_ignored`, naming the affected paths and the rule to fix, instead of letting a child run to completion and then parking at integration with `adopted commit lacks terminal audit pair`. The per-child commit applies the same check before any Git write, so a rule added mid-batch is refused with the same reason rather than producing a commit without its evidence.

- [`dc0ffea`](https://github.com/dereknex/immune-brain/commit/dc0ffea6812c6f9b5bf99314c3e612964aefb2ce) Thanks [@dereknex](https://github.com/dereknex)! - Require final verification commands for new Pi and Claude unattended batches, preserve existing-batch resume, and explicitly report when final verification was not run.

- [#300](https://github.com/dereknex/immune-brain/pull/300) [`dac0e38`](https://github.com/dereknex/immune-brain/commit/dac0e38c72fb9b221b82af27da9a4b761aefdac6) Thanks [@dereknex](https://github.com/dereknex)! - Refuse newer batch record contracts with the loaded runtime path instead of skipping them. Report the Claude MCP startup bundle path and SHA-256 prefix in status, and document contract bumps for persisted meaning changes.

- [`f7b0982`](https://github.com/dereknex/immune-brain/commit/f7b0982ec6eec9e9f7f30a452d44586d656c74ff) - The Claude Code MCP server now notices when its own bundle changed on disk after it started. Authority calls (`enroll`, `start_unattended_batch`, `retire_stale_batch`, `advance_assurance`, `submit_review`) then refuse with `plugin_bundle_stale` and ask you to reconnect the immune-brain MCP server, instead of reporting a misleading `run_entry_required`; `status` still answers and carries a warning. In the plugin source repository, a Lane-mode batch start also refuses with `batch_runtime_contract_mismatch` when the loaded plugin build differs from the workspace build. Serial starts are unaffected. See Spec branch-boundary.

- [`927dc70`](https://github.com/dereknex/immune-brain/commit/927dc703a8ce2b6197391e4a8d74ce8fdc72187f) - Add bounded child redo slot grants under the original Batch Authorization, validate the recorded terminal Lane run and unchanged TaskIntent before spending a grant, recreate clean Lanes with empty Authority Stores, and restore redo spend alongside child consumption when a Lane batch resumes.

- [`a05e941`](https://github.com/dereknex/immune-brain/commit/a05e941e9319aa0d76aa5cfba1cc8ecb98ea7a64) - Remove delegated in-Lane intent revisions and batch resealing from Pi, Claude and the runtime, while preserving legacy v2 record reading and retirement. Treat scope-only intent revisions as compatible when the bound Spec path is unchanged, disclose files beyond the estimate, and supersede the same-directory scope rule with ADR 0028.

- [`65ac904`](https://github.com/dereknex/immune-brain/commit/65ac904987614de4803ac9cad7b46980e7a41f24) - Regenerate declared derived outputs when merge queue conflicts contain only those outputs, and include declared checks in final verification.

- [`dbc93e2`](https://github.com/dereknex/immune-brain/commit/dbc93e28e5052ed764dda87814f2330dc74bb660) - Raise projected risk from actual changed paths and require Review when the no-touch declaration changes. Refuse hard no-touch paths and repository additions during intent validation, single-task delivery and batch integration without advancing the Parent branch.

- [`00d7e5d`](https://github.com/dereknex/immune-brain/commit/00d7e5d721e2585a6663fb74228de812ef819f9e) - Integrate Parent-branch children in Kernel settlement order and rerun each child's frozen acceptance on its rebuilt commit. Textual conflicts and failing merged acceptance restart the child in a fresh Lane at the Parent tip under the original authorization, with at most two automatic redos. Persist redo recovery across interruptions and report exhausted children while independent children continue.

- [`c05258f`](https://github.com/dereknex/immune-brain/commit/c05258fd799367d16b0a9f56c1fbebf5b363b605) Thanks [@dereknex](https://github.com/dereknex)! - Repair the branch-boundary-r2 regressions. Claude and Pi now refuse a single-task Enrollment with `workspace_not_clean` before opening the native gate when the workspace has dirt outside the TaskIntent and its bound Spec, so the user never confirms an Enrollment the Kernel then refuses (Spec branch-boundary-r2 D23). Both hosts also refuse `approve_breaking_intent_revision` before the gate when the proposed revision is not breaking, since a scope-only change is compatible (D20). Under branch delivery another task's unstaged planning draft no longer blocks this task's snapshot. The Loop contract again routes a goal, bound Spec or decomposition change to Planner's Enrolled Intent Revision route. Tests outdated by D18–D23 now assert the new behavior and cite the decision.

- [`262fa10`](https://github.com/dereknex/immune-brain/commit/262fa102ca8551dc2ef10ebe8972c0e4f1ec54c7) - Run every new unattended batch through runtime-created Lanes, defaulting omitted `max_parallel` to 1. Remove the serial runner and plan reconfirmation path. Keep v1 records readable and explicitly retireable, but refuse their execution with `batch_record_shape_retired` and the retirement recovery action. Align Pi and Claude confirmation text, packaged runtime, documentation and live Lane regression coverage.

- [`79973ca`](https://github.com/dereknex/immune-brain/commit/79973ca221d3bf04566988f70d67e70bc774d42b) - Require a clean workspace for single-task Enrollment, apart from its TaskIntent and bound Spec. Attribute the full delivery to the Enrollment HEAD and disclose files beyond the scope estimate in Review evidence.

- [#261](https://github.com/dereknex/immune-brain/pull/261) [`298a06a`](https://github.com/dereknex/immune-brain/commit/298a06a904a91f79a939cc564746d0e50c85a5f3) Thanks [@dereknex](https://github.com/dereknex)! - Nudge the Stop continuation hook at most once per unchanged progress digest on both Hosts and then pause. The Claude block reason now says that waiting on an action only the user can perform is a valid stop and must not repeat the request.

- [`226fdb5`](https://github.com/dereknex/immune-brain/commit/226fdb5145122e1a5d008a01fea7ef505e9600c4) Thanks [@dereknex](https://github.com/dereknex)! - Order implicit scope-overlap dependencies topologically along the declared blocked_by edges, with Slice order only breaking ties, so a plan whose Slice numbering disagrees with its dependencies no longer projects a cycle and is accepted by batch authorization.

- [`9a00b1f`](https://github.com/dereknex/immune-brain/commit/9a00b1f68ef91eefc3c94d92063b3e91f431a0e8) Thanks [@dereknex](https://github.com/dereknex)! - The Lane batch integration recheck materializes its candidate beside the Lanes, so acceptance descriptors resolve the repository's installed dependencies (`node_modules`, `.bin`) as they did in the Lane instead of failing with `command not found` or a missing module and spending a redo. A redo that recreates a Lane first pins its unintegrated commit at `refs/imm/retained/<slug>/<task_id>/<commit>`, so settled work is never left unreachable.

- [`490c64a`](https://github.com/dereknex/immune-brain/commit/490c64a1cde62eafff66c73586a92bd27ae8f85e) Thanks [@dereknex](https://github.com/dereknex)! - Recheck Lane child authority after commit and before integration, including parked-batch resume. Keep children with changed authority parked without moving the Parent branch tip.

- [`ffa9c57`](https://github.com/dereknex/immune-brain/commit/ffa9c57478b9566b08872cd3453c714150814ac1) Thanks [@dereknex](https://github.com/dereknex)! - Clarify Lane plugin skew as expected and non-blocking, and guide freshly enrolled Executors to implement before advancing assurance.

- [`334305f`](https://github.com/dereknex/immune-brain/commit/334305f57da37c758db5c4364fa0a35bec5849ae) Thanks [@dereknex](https://github.com/dereknex)! - Lane batches in the plugin source repository pause admission and redo with `runtime_reload_required` after a child integrates a change to the generated MCP bundle, so no new Lane runs a stale runtime. A fresh literal-user resume admits the child, recording `runtime_skew_acknowledged` on the child and in the final report when the loaded build still differs.

- [`226fdb5`](https://github.com/dereknex/immune-brain/commit/226fdb5145122e1a5d008a01fea7ef505e9600c4) Thanks [@dereknex](https://github.com/dereknex)! - A running Lane batch on the Parent branch no longer re-integrates a critical task settled before the batch, commit and lookup treat refs/heads/imm/<slug> as a progress ref, and retire_stale_batch reads a Lane child's run from its own Lane store, so a stopped Lane child no longer blocks disposition.

- [`17e4574`](https://github.com/dereknex/immune-brain/commit/17e4574695e3a3993784cedeed1fc176e4c03f11) - Resume parked Lane batches without retiring them: fresh confirmation can revive stopped or unreadable/lost runtime-owned Lanes at the Parent tip using a bounded redo grant, while unresolved children remain parked and independent children continue.

- [`f461d01`](https://github.com/dereknex/immune-brain/commit/f461d01c15e7f5ba0a665f2f97b725be77d3e03d) Thanks [@dereknex](https://github.com/dereknex)! - Block Pi Review Agent dispatches before execution when their description or prompt differs from the pending reservation, preserving the reservation for a verbatim retry and refusing duplicate dispatches.

- [`226fdb5`](https://github.com/dereknex/immune-brain/commit/226fdb5145122e1a5d008a01fea7ef505e9600c4) Thanks [@dereknex](https://github.com/dereknex)! - Classify a Review as heavy when the change touches 12 or more paths, scale the heavy turn budget with the changed path count, and harden imm-pr-diag PR diagnosis for the pr-fix workflow.

- [`226fdb5`](https://github.com/dereknex/immune-brain/commit/226fdb5145122e1a5d008a01fea7ef505e9600c4) Thanks [@dereknex](https://github.com/dereknex)! - On review round 3 and later, the delta Review prompt states that paths outside delta_paths are attested by carry-forward from the prior reviewed commit and that an unread or truncated read is never a blocking finding, so wide changes no longer fail Review on coverage alone.

- [`3889fd3`](https://github.com/dereknex/immune-brain/commit/3889fd30a3a98701abd323f3f1b897970926a2fd) - Treat incomplete Review coverage as a durable execution outcome, not an assurance verdict or finding. Retry the same snapshot once with twice the requested turn budget (up to 96), preserving fresh QA across coordinator restarts, then pause with review_incomplete and one recovery action. Bind both Hosts' observed incomplete receipts and teach the reviewer to report incomplete instead of a coverage finding.

- [`e77561a`](https://github.com/dereknex/immune-brain/commit/e77561a64217b1e423575ad0a8aa78d80a13bd95) - Refuse TaskIntent candidates above 15 counted scope paths unless scope_size_reason explains the exception, and require deletion-heavy retirement to be planned as a separate Slice.

- [`ed62c37`](https://github.com/dereknex/immune-brain/commit/ed62c37908fc5bdcbbf89a53d379b77795db8135) - Use slice IDs in Child Issue titles and close re-delivered stopped Children as completed while preserving manually closed nonterminal Issues.

## 5.5.1

### Patch Changes

- [#252](https://github.com/dereknex/immune-brain/pull/252) [`01392f1`](https://github.com/dereknex/immune-brain/commit/01392f19c279aae23135df9126691d1557b27175) Thanks [@dereknex](https://github.com/dereknex)! - Allow native Parent finalization to explicitly consolidate settled original and repair runs under a freshly assured final TaskIntent. Bind native confirmation, scope-bounded commit recovery and whole-plan completion to the reviewed composed bytes and preserved source proofs.

- [#252](https://github.com/dereknex/immune-brain/pull/252) [`01392f1`](https://github.com/dereknex/immune-brain/commit/01392f19c279aae23135df9126691d1557b27175) Thanks [@dereknex](https://github.com/dereknex)! - Distinguish unreadable Lane projections from lost runs, retain safe task/run context, and preserve existing fresh-authorization recovery. Include bounded escaped path and index-flag details in scope commit refusals without retaining raw exceptions or file contents.

- [#252](https://github.com/dereknex/immune-brain/pull/252) [`01392f1`](https://github.com/dereknex/immune-brain/commit/01392f19c279aae23135df9126691d1557b27175) Thanks [@dereknex](https://github.com/dereknex)! - Require a fresh native Parent confirmation before a newly settled repair is integrated, so an ungated direct integration is refused without side effects and the recorded final commands run only after the accepted integration. Original delivery and audit evidence stay unchanged.

- [#252](https://github.com/dereknex/immune-brain/pull/252) [`01392f1`](https://github.com/dereknex/immune-brain/commit/01392f19c279aae23135df9126691d1557b27175) Thanks [@dereknex](https://github.com/dereknex)! - Clarify Executor exit-preserving checks, requested business red/green and generated-output completeness. Keep Parent recovery bound to host instructions and original Lane identity, distinguish provider interruption from Review budget exhaustion, and inspect existing attestation advisories. Add shell and reservation protocol controls without new execution machinery.

- [#252](https://github.com/dereknex/immune-brain/pull/252) [`01392f1`](https://github.com/dereknex/immune-brain/commit/01392f19c279aae23135df9126691d1557b27175) Thanks [@dereknex](https://github.com/dereknex)! - Preserve the original measured sources for historical whole-plan host evidence, so later workflow changes do not invalidate or rewrite previous captures. Keep current-source integration checks and actual development-host validation separate from historical evidence. Project validated terminal Lane records from their settled evidence instead of rebinding their QA to the coordinator checkout path; retain live identity checks for active tasks and independent integrated-delivery checks.

- [#252](https://github.com/dereknex/immune-brain/pull/252) [`01392f1`](https://github.com/dereknex/immune-brain/commit/01392f19c279aae23135df9126691d1557b27175) Thanks [@dereknex](https://github.com/dereknex)! - Isolate Claude package build and smoke tests in disposable copies so tests cannot rewrite real package inputs or conceal generated-output drift.

- [#252](https://github.com/dereknex/immune-brain/pull/252) [`01392f1`](https://github.com/dereknex/immune-brain/commit/01392f19c279aae23135df9126691d1557b27175) Thanks [@dereknex](https://github.com/dereknex)! - Allow a delivered-only Parent to resume native integration and final verification after its stale batch has been retired. Require native confirmation for each new delivery integration even when final commands are absent or other critical tasks remain unsettled. Preserve retired batch evidence, without changing active or effective completed batch routing.

## 5.5.0

### Minor Changes

- [`e0ca9da`](https://github.com/dereknex/immune-brain/commit/e0ca9dac3deaf096165bff7360f1a068ffa06fa6) Thanks [@dereknex](https://github.com/dereknex)! - Continue explicitly bound Pi and Claude runs through implementation, assurance and bounded repair. Parent entries select the complete plan with dependency/scope scheduling and same-Host serial fallback; Child entries stay isolated. Preserve critical and repair native gates, integrated delivery proof and final verification before Parent completion.

- [#245](https://github.com/dereknex/immune-brain/pull/245) [`c0954ab`](https://github.com/dereknex/immune-brain/commit/c0954ab1093d0d1fd3f56289bd9cb7369fb26ea0) Thanks [@dereknex](https://github.com/dereknex)! - Converge Review rework instead of letting it run to the budget. A Review rework verdict now carries only blocking findings, each naming a concrete input and an observable wrong result and staying inside the declared threat model; advisory notes are archived on pass and kept out of Executor work. From the third Review round a new blocking finding is admitted only when it touches the latest rework delta or crosses a security, data-loss or authority boundary, using a durably persisted per-round review revision. When the rework budget is exhausted the Host now asks one literal-user question with three exits: grant 1 to 5 more rounds, accept the remaining Review findings as residual risk with a reason, or replan. Deterministic QA always runs the project-declared baseline read from the Enrollment base tree and discloses a check that fails identically at `base_head` instead of blocking on it. Planner Specs declare their threat model and supported environment and write acceptance as enumerated negative cases with focused verification descriptors.

## 5.4.0

### Minor Changes

- [`8d6cf26`](https://github.com/dereknex/immune-brain/commit/8d6cf264ebc7ab62d35e419368b513d13cd5c4ee) Thanks [@dereknex](https://github.com/dereknex)! - An enrolled task can now add a concrete sibling file to its scope without a native confirmation: `classifyIntentRevision` treats a scope that keeps every previous entry and adds only concrete files beside an existing concrete file as `compatible`, unless it touches a risk-floor path (Kernel, assurance, Claude Host authority, Pi extension), `docs/specs` or `docs/plans`. Both Hosts refuse that route when an added or anchoring entry is a directory in the worktree; list concrete files or widen with a glob entry, which is breaking. A revision is now judged against its next scope, so a worktree that already holds the added files no longer blocks it, while a changed path outside both scopes still refuses before any gate. The Review prompt names every path added this way, derived from Kernel history with no new TaskRecord field. Lane delegation still refuses a widening that is not compatible. ADR 0021 records the rule (#217).

- [`f379663`](https://github.com/dereknex/immune-brain/commit/f3796632bc38396779ede3418ee92e010fb23090) Thanks [@dereknex](https://github.com/dereknex)! - A session whose latest phase entry is a plan entry can no longer edit files inside the scope of a Managed task that is active in the workspace: both Hosts refuse the file-edit tool call with `revision_owner_required` and one recovery action (return the proposal to the executing session). The guard covers file-edit tools only, not shell commands, and leaves planning sidecars under `docs/plans` and `docs/specs`, paths outside the scope, runs without an active claim, and an unreadable entry store alone. `PhaseEntryState` now reports a latest plan entry without changing its run-entry transitions. The Planner and Loop contracts state that the Loop owner prepares scope and acceptance revisions in the executing session (#218).

- [#234](https://github.com/dereknex/immune-brain/pull/234) [`7abda47`](https://github.com/dereknex/immune-brain/commit/7abda47b05ba18f137912726edf0ecdf8fd4380b) Thanks [@dereknex](https://github.com/dereknex)! - Deterministic QA no longer interprets the `#!` line of a command. The entry file found through the absolute-entry `PATH` (or inside the project for `./file`) is identity-pinned and executed directly, and the operating system resolves any interpreter, so a tool reached through a version-manager shim, or one using `env -S`, now runs instead of being refused. `FrozenCommand` carries the entry only, and the execution digest drops its `interpreter` member. The Planner contract names `executable: "sh"` with `argv: ["-c", "<line>"]` as the way to write a compound command.

- [#234](https://github.com/dereknex/immune-brain/pull/234) [`7abda47`](https://github.com/dereknex/immune-brain/commit/7abda47b05ba18f137912726edf0ecdf8fd4380b) Thanks [@dereknex](https://github.com/dereknex)! - The staging area is inspected when a snapshot is frozen, not before. The `status` Tool on both Hosts now returns the task projection while the scope holds unstaged or untracked paths and lists them in a `warnings` entry; `advance_assurance` and every other freeze still refuse them, and an in-scope path with a skip-worktree or assume-unchanged flag still refuses both. The Enrollment gate lists in-scope paths that are already staged, modified or untracked, and confirming it claims exactly those paths as task work instead of requiring a clean scope; an in-scope path dirtied after the gate text was built refuses the Enrollment. A scope revision made only of previous entries is now compatible and needs no confirmation.

- [#234](https://github.com/dereknex/immune-brain/pull/234) [`7abda47`](https://github.com/dereknex/immune-brain/commit/7abda47b05ba18f137912726edf0ecdf8fd4380b) Thanks [@dereknex](https://github.com/dereknex)! - The paths that force a higher task risk are now declared by the project in a tracked `.imm/risk-floor.json` instead of being compiled into the runtime. The file holds a `material` and a `critical` tier, each with `paths` (raise a task through its scope or its changed paths) and `changed_only` (raise it through changed paths alone). A project with no declaration has no floor, so `docs/specs`, `docs/plans` and paths named like this repository's Kernel no longer raise a task elsewhere. A declaration that is invalid, unreadable or not committed makes every task `critical`, and the declaration's own path is always `critical`. `imm-kernel inspect --json` reports the reason as `risk.floor_invalid`. This repository's declaration carries the former built-in lists unchanged.

- [#234](https://github.com/dereknex/immune-brain/pull/234) [`7abda47`](https://github.com/dereknex/immune-brain/commit/7abda47b05ba18f137912726edf0ecdf8fd4380b) Thanks [@dereknex](https://github.com/dereknex)! - Claude hook observation events now write to the event log only while the workspace has an active task or batch. Prompt phase entry and tool guards keep their existing behavior.

- [#235](https://github.com/dereknex/immune-brain/pull/235) [`9aed031`](https://github.com/dereknex/immune-brain/commit/9aed03133e9841d778ef75114bc2a3bdfdf772cc) Thanks [@dereknex](https://github.com/dereknex)! - Only `imm-run` refuses an action at phase entry. A model Skill call for `imm-planner` or `imm-brainstorm` on Claude Code no longer revokes the session's run entry: it writes nothing to the phase-entry store, so an Enrollment later in the same session opens its native confirmation without a fresh `/imm-run`. A plan entry the user types still revokes the run entry. The revision-owner guard is removed on both Hosts: a file edit inside the active task's scope is no longer denied from a plan-entry session, and the reason code `revision_owner_required` no longer exists. `enroll`, `start_unattended_batch` and the `imm-run` Skill still require a live literal run entry. ADR 0022 records the decision and supersedes the revocation rule of ADR 0020 (#230).

- [#235](https://github.com/dereknex/immune-brain/pull/235) [`9aed031`](https://github.com/dereknex/immune-brain/commit/9aed03133e9841d778ef75114bc2a3bdfdf772cc) Thanks [@dereknex](https://github.com/dereknex)! - Enrollment no longer asks the user to commit by hand. Before the Enrollment binding is prepared, when a dirty file inside the task `scope_hint` or an untracked TaskIntent would fail Enrollment, the Host silently commits those paths together with the task's own TaskIntent and the Spec its binding names, as one commit with the subject `chore(imm): commit Enrollment preconditions for <task-id>`, on Claude Code and Pi. The native confirmation binds the resulting HEAD. A TaskIntent that is only staged over a clean scope makes no commit, and dirty paths outside the set are neither committed nor blocking. The commit uses an explicit literal path list and runs Git hooks normally; a refused commit fails Enrollment with Git's message. With an unborn HEAD the empty root commit still comes first, and a TaskIntent or owner changed while the following commit runs is refused. An Enrollment that an existing owner would refuse commits nothing. If Enrollment is declined, cancelled or fails after the commit, the result names the commit that remains. The Kernel still refuses a dirty scope that reaches it directly, and that refusal no longer tells the user to commit. ADR 0023 records the decision and the accepted risk that unfinished work inside the scope is committed without being shown first (#231).

### Patch Changes

- [`c265a26`](https://github.com/dereknex/immune-brain/commit/c265a26e242c59eaab58bbb21c4cd835cdd92728) Thanks [@dereknex](https://github.com/dereknex)! - A failed QA `prepare` stage (timeout, nonzero exit or output limit) now returns `prepare_observation` in the `advance_assurance` Tool result on both Hosts: the fixed execution conditions (isolated delivery, no worktree `node_modules`), the declared timeout, and a stderr tail of at most 2048 bytes taken from the end with control characters other than newline and tab removed. The failure text also states that a reproduction in the live worktree is not equivalent. A failing check stage still returns no output text, and the tail is never part of `QaCheckDiagnostic`, batch failure facts or the stored TaskRecord. The Loop contract states the stage-specific rule in place of the blanket no-output sentence (#216).

- [`747bb04`](https://github.com/dereknex/immune-brain/commit/747bb04028f885f6e2a6d424a4abae0bb246b8dd) Thanks [@dereknex](https://github.com/dereknex)! - The Executor and Loop contracts require Delivery Evidence only when a task is reworked, and the Planner records `Diagram decision` and `Diagram reason` only for a Medium/High Spec that needs a diagram; the Quality Gate reference and the legacy Spec validator accept a Spec that records neither field. The batch, Lane and Herdr sections of `imm-run` move unchanged in wording to `dist/imm-run-batch.md`, and the Claude host package test recognizes it as a companion contract of the `imm-run` Skill. A contract rule audit is added at `docs/reports/contract-rule-audit-r647.md` (#219).

- [#234](https://github.com/dereknex/immune-brain/pull/234) [`7abda47`](https://github.com/dereknex/immune-brain/commit/7abda47b05ba18f137912726edf0ecdf8fd4380b) Thanks [@dereknex](https://github.com/dereknex)! - Reject in-scope files with combined assume-unchanged and skip-worktree index flags when capturing a managed task snapshot.

- [#234](https://github.com/dereknex/immune-brain/pull/234) [`7abda47`](https://github.com/dereknex/immune-brain/commit/7abda47b05ba18f137912726edf0ecdf8fd4380b) Thanks [@dereknex](https://github.com/dereknex)! - Deterministic QA for a task now runs `prepare` and every check in the task's own working directory instead of a disposable copy, so a dependency already installed there is used as is. Before the first command and after each one, the tracked content inside the task's scope must equal the frozen snapshot; a difference fails as `protected_input_or_output_drift`, and the differing paths come back as `prepare_observation.drift_paths` in the direct Tool result only. Content outside the scope, and untracked or ignored files, are not compared. `environment.writable_paths` is still parsed and no longer restricts writes. The Lane batch integration recheck keeps the isolated copy, because its merge candidate is never checked out.

- [#234](https://github.com/dereknex/immune-brain/pull/234) [`7abda47`](https://github.com/dereknex/immune-brain/commit/7abda47b05ba18f137912726edf0ecdf8fd4380b) Thanks [@dereknex](https://github.com/dereknex)! - Deterministic QA commands now run with the environment of the process hosting the Kernel instead of a rebuilt one. The Kernel no longer creates a throwaway home or overrides `HOME`, `TMPDIR` and `XDG_CACHE_HOME`; Git repository-binding variables (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_COMMON_DIR`, `GIT_NAMESPACE`, `GIT_PREFIX`) stay out of the child, and the per-run process token stays in. The Planner contract no longer forbids a download or credential use during preparation. QA still runs in the disposable delivery materialization.

- [#235](https://github.com/dereknex/immune-brain/pull/235) [`9aed031`](https://github.com/dereknex/immune-brain/commit/9aed03133e9841d778ef75114bc2a3bdfdf772cc) Thanks [@dereknex](https://github.com/dereknex)! - Commit workflow files and enrollable child-scope changes before a fresh batch binds its HEAD. Preserve and report remaining out-of-scope changes, keep resume-time checks unchanged, and report a precondition commit that remains after a failed or declined start.

- [#235](https://github.com/dereknex/immune-brain/pull/235) [`9aed031`](https://github.com/dereknex/immune-brain/commit/9aed03133e9841d778ef75114bc2a3bdfdf772cc) Thanks [@dereknex](https://github.com/dereknex)! - `retire_stale_batch` no longer dead-ends on a child the batch record still holds mid-flight after its Kernel run ended outside the batch. A child blocks the disposition only while the Kernel store has no terminal run for it, the confirmation shows each child's Kernel lifecycle, and the retired record keeps every child state untouched.

## 5.3.0

### Minor Changes

- [`209f158`](https://github.com/dereknex/immune-brain/commit/209f15802cebde17b7162daf45ad5b35330666fd) Thanks [@dereknex](https://github.com/dereknex)! - On Claude Code the model can now load `imm-planner` and `imm-brainstorm` itself when the user asks for a Spec, Plan, TaskIntent or requirement clarification; the phase-entry hook no longer denies those Skill calls. A call made while no Managed claim is active records a plan entry, which ends the session's run entry, so Enrollment needs a fresh `imm-run` entry; with an active claim (an Enrolled Intent Revision) the run entry stays live. If that plan entry cannot be written the session log is dropped, so the run entry still ends. `imm-run` is the only phase Skill the literal user must enter, and its Skill call is allowed whenever the run entry is live, not only in the prompt that recorded it. `enroll`, `start_unattended_batch` and the native dialog still need a live run entry. The session phase-entry state shrinks to `run_live`: the per-prompt sequence counters and the active-claim input to admission are gone.

  The `imm-planner` and `imm-brainstorm` Skill descriptions become request-triggered; `imm-run` and the standalone Skills keep "explicitly requests". Pi cannot observe a model reading a Skill file, so it keeps revoking only on a literal Planner or Brainstorm entry; a model-entered Planner after an earlier `imm-run` entry leaves the run entry live there, an accepted gap recorded in ADR 0020. An installed Claude plugin cache keeps the stricter gate until it is refreshed, which fails closed.

## 5.2.0

### Minor Changes

- [#210](https://github.com/dereknex/immune-brain/pull/210) [`ccd7e56`](https://github.com/dereknex/immune-brain/commit/ccd7e5699ed5ac0c676f354f862e3370070abc15) Thanks [@dereknex](https://github.com/dereknex)! - Planner and Brainstorm now always stop after candidate validation; native Enrollment is the first step of an explicit `imm-run` entry (ADR 0019).

- [#210](https://github.com/dereknex/immune-brain/pull/210) [`ccd7e56`](https://github.com/dereknex/immune-brain/commit/ccd7e5699ed5ac0c676f354f862e3370070abc15) Thanks [@dereknex](https://github.com/dereknex)! - Claude Code now refuses `enroll` and `start_unattended_batch` with `run_entry_required` unless the user entered `imm-run` in the session, and refuses a model Skill call for `imm-planner`, `imm-brainstorm` or `imm-run` with `phase_entry_required` unless the user's latest prompt entered that phase (ADR 0019).

- [#210](https://github.com/dereknex/immune-brain/pull/210) [`ccd7e56`](https://github.com/dereknex/immune-brain/commit/ccd7e5699ed5ac0c676f354f862e3370070abc15) Thanks [@dereknex](https://github.com/dereknex)! - Pi now refuses `imm_canary_enrollment` and `start_unattended_batch` with `run_entry_required` before the authority dialog unless the user entered `imm-run` in the session; a later planner or brainstorm entry revokes it. Both Hosts return the same reason code and recovery action (ADR 0019).

- [#213](https://github.com/dereknex/immune-brain/pull/213) [`4834b00`](https://github.com/dereknex/immune-brain/commit/4834b008cba0b057ef10f5508949b42cc700553f) Thanks [@dereknex](https://github.com/dereknex)! - Add `imm-test-prune`, an explicitly invoked standalone host-native Skill that audits and prunes redundant, bloated, or orphaned tests through one exact hash-bound manifest. It uses only the target repository's own test, coverage, and static-check commands; subsumption deletions require covered-line superset evidence when coverage is available and stay `UNVERIFIED` otherwise; assertions are never weakened and production source is never changed (#205).

### Patch Changes

- [#210](https://github.com/dereknex/immune-brain/pull/210) [`ccd7e56`](https://github.com/dereknex/immune-brain/commit/ccd7e5699ed5ac0c676f354f862e3370070abc15) Thanks [@dereknex](https://github.com/dereknex)! - Harden the phase entry gate: a prompt the Claude store cannot record drops the earlier entry, and a store read or admission write that throws denies instead of letting a phase Skill through; an admission written by a repeated hook run for the same call is accepted once instead of refusing every Enrollment; a symlinked command alias or Pi prompt template is bounded by its target's size, not the link's.

- [#213](https://github.com/dereknex/immune-brain/pull/213) [`4834b00`](https://github.com/dereknex/immune-brain/commit/4834b008cba0b057ef10f5508949b42cc700553f) Thanks [@dereknex](https://github.com/dereknex)! - Executor now pins each added test to one acceptance invariant or finding at its public seam, reuses existing tests before adding new ones, and retires tests for behavior a change retires; Code Review treats test-suite growth as advisory only, while weakened or missing acceptance tests stay blocking (#205).

## 5.1.2

### Patch Changes

- [#202](https://github.com/dereknex/immune-brain/pull/202) [`b1ce812`](https://github.com/dereknex/immune-brain/commit/b1ce81230614dc8ce0c6c906aaa205fb45c8a55e) Thanks [@dereknex](https://github.com/dereknex)! - Deterministic QA no longer fails intermittently with `protected_input_or_output_drift` on newer Git. The delivery workspace's Git commands now run with `maintenance.auto=false`, so `git fetch` no longer leaves a detached `git maintenance run --auto` that removes `.git/objects/maintenance.lock` after the workspace seal was taken.

- [#203](https://github.com/dereknex/immune-brain/pull/203) [`5fcbf74`](https://github.com/dereknex/immune-brain/commit/5fcbf74686a702047901328f16890b040405075c) Thanks [@dereknex](https://github.com/dereknex)! - The Loop, Planner and Executor/Reviewer role prompts state that a defect inside the TaskIntent goal and `scope_hint` is ordinary rework: fix the code and pin the case in a test, never append a single input case to acceptance text to close a finding. A breaking Intent revision is reserved for a changed goal, scope or user-visible commitment; the acceptance length limit is unchanged.

- [#203](https://github.com/dereknex/immune-brain/pull/203) [`5fcbf74`](https://github.com/dereknex/immune-brain/commit/5fcbf74686a702047901328f16890b040405075c) Thanks [@dereknex](https://github.com/dereknex)! - ADR 0018: a lane batch's native confirmation can also delegate, opt-in and off by default, the approval of a Lane child's breaking Intent revisions that stay inside that child's authorized TaskIntent. The coordinator submits such a revision as `lane_revision`; the runtime applies it in the Lane as an audited delegated approval (`batch-coordinator`, `delegated-batch:<batch_id>@<time>`) or refuses it so the Executor falls back to the user's own gate. When the delegated revision is integrated, the batch reseals `plan_digest` and records both digests, so later children continue without retiring the batch; any other Intent change still fails closed.

- [#203](https://github.com/dereknex/immune-brain/pull/203) [`5fcbf74`](https://github.com/dereknex/immune-brain/commit/5fcbf74686a702047901328f16890b040405075c) Thanks [@dereknex](https://github.com/dereknex)! - The coordinator may send one text instruction to an idle Lane session: `start_unattended_batch` takes `lane_instruction`, records it in the batch record and report as `interventions` before it is sent, and refuses it for a blocked or working session or a child no longer running in its Lane. The Herdr Lane Tabs contract keeps a wait armed per live session, tells the user at once when a Lane is blocked or goes idle without settling, and still never answers a dialog or re-prompts a reviewer.

- [#203](https://github.com/dereknex/immune-brain/pull/203) [`5fcbf74`](https://github.com/dereknex/immune-brain/commit/5fcbf74686a702047901328f16890b040405075c) Thanks [@dereknex](https://github.com/dereknex)! - In lane mode, a child that reaches its QA failure limit no longer parks at once: the report hands it to the coordinator (`role: "coordinator", action: "correct"`), which sends one design-level correction to a new Lane session as `lane_instruction` kind `correction`. The runner counts at most two corrections per child and parks a third exhaustion as `batch_correction_limit_reached` while independent siblings continue. Single tasks and serial batches are unchanged.

- [#203](https://github.com/dereknex/immune-brain/pull/203) [`5fcbf74`](https://github.com/dereknex/immune-brain/commit/5fcbf74686a702047901328f16890b040405075c) Thanks [@dereknex](https://github.com/dereknex)! - In a lane-mode batch, settling a child inside its Lane no longer closes its Child Issue. The coordinator closes it once, after integrating that child's commit onto the batch branch, and retries a failed close on the next tick; a lost or parked child keeps its Issue open. Serial batches and single tasks are unchanged.

- [#203](https://github.com/dereknex/immune-brain/pull/203) [`5fcbf74`](https://github.com/dereknex/immune-brain/commit/5fcbf74686a702047901328f16890b040405075c) Thanks [@dereknex](https://github.com/dereknex)! - A new lane-mode batch compares the Kernel contract identifiers of the coordinator runtime with those of the runtime a Lane Executor loads (shipped as `runtime/kernel/runtime_contracts.json`) and refuses with `batch_runtime_contract_mismatch`, naming both sources, before any Lane is provisioned. A Lane whose state exists in a contract the coordinator cannot read now parks as `batch_lane_contract_mismatch` with the original parse error instead of `batch_lane_lost`.

- [#203](https://github.com/dereknex/immune-brain/pull/203) [`5fcbf74`](https://github.com/dereknex/immune-brain/commit/5fcbf74686a702047901328f16890b040405075c) Thanks [@dereknex](https://github.com/dereknex)! - Inside a batch Lane, the Pi extension and a new Claude Code `PreToolUse` hook refuse file edits and writes whose target is outside the Lane (shell commands are not intercepted). Re-entering a lane batch with a dirty coordinator checkout restores the leaked files only when every one is provably a Lane's bytes, backing them up reversibly and recording the backup in the batch report; otherwise nothing is touched. The dirty-tree refusal no longer suggests `git add`.

- [#203](https://github.com/dereknex/immune-brain/pull/203) [`5fcbf74`](https://github.com/dereknex/immune-brain/commit/5fcbf74686a702047901328f16890b040405075c) Thanks [@dereknex](https://github.com/dereknex)! - `imm-kernel intent overlap` compares the `scope_hint` of an Initiative's TaskIntents by machine and reports each shared entry pair plus the Batch Plan's start waves; the Planner uses it instead of a hand-written "verified". A lane batch can record the project's final verification commands (`final_verification`, shown at confirmation) and runs them on the batch branch once every child is integrated, writing exit status and timing into the completion report. Both Hosts announce an active Managed task on ordinary input without resuming it.

- [#191](https://github.com/dereknex/immune-brain/pull/191) [`7ff869a`](https://github.com/dereknex/immune-brain/commit/7ff869ac3cd2035cc50f0b98ab8e50c87aa0c7df) Thanks [@dereknex](https://github.com/dereknex)! - Brainstorm hands off a confirmed user scenario as a `BR-SCN-*` manifest item, the Planner requires a Spec to carry and map those scenarios or to record `no user-visible change` with a reason, and the imm-run exit summary names the manual scenarios still pending walkthrough. Contract text only; nothing becomes a gate.

- [#191](https://github.com/dereknex/immune-brain/pull/191) [`7ff869a`](https://github.com/dereknex/immune-brain/commit/7ff869ac3cd2035cc50f0b98ab8e50c87aa0c7df) Thanks [@dereknex](https://github.com/dereknex)! - `imm-tracker publish-initiative` accepts optional per-Task user scenarios, renders them on the Child and a derived listing on the Parent, and rejects the whole batch before any remote write when a scenario is malformed or names an acceptance ID its TaskIntent lacks. A publication without scenarios is unchanged.

- [#191](https://github.com/dereknex/immune-brain/pull/191) [`7ff869a`](https://github.com/dereknex/immune-brain/commit/7ff869ac3cd2035cc50f0b98ab8e50c87aa0c7df) Thanks [@dereknex](https://github.com/dereknex)! - The Reviewer prompt checks that the delivered tests at an acceptance's agreed seam assert the `Then` of every `automated` user scenario the referenced Spec maps to that acceptance, and reports a scenario whose observable result is asserted nowhere as an `acceptance` finding. Manual scenarios and acceptances with no mapped scenario are unchanged, and no finding kind or verdict branch is added.

## 5.1.1

### Patch Changes

- [#184](https://github.com/dereknex/immune-brain/pull/184) [`ed3e6b3`](https://github.com/dereknex/immune-brain/commit/ed3e6b3b7ea364dddca97dae7778f374a16e40b4) Thanks [@dereknex](https://github.com/dereknex)! - Make the reviewer's own result bytes the primary Review submission channel: `submit_review` now applies the host-observed receipt when the verdict is omitted (both hosts), the Pi extension records the reserved reviewer's `Agent` result bytes for receipt-bound submission, and the v4 review attestation binds an optional `reviewer_verdict_sha256` so audit can prove the persisted verdict equals what the reviewer produced. Recovery on a fingerprint mismatch now names the no-verdict resubmission first.

- [`6580e18`](https://github.com/dereknex/immune-brain/commit/6580e18dc511f263610f3db4c3a9f4bf2560fd2d) Thanks [@dereknex](https://github.com/dereknex)! - Align the retired file-store residue classification between `inspectStorageLayout` and the mutation guard: an empty `.imm/state/tasks` directory and an ownerless `.imm/state/workspace.json` (`current_working: null`) no longer fail every Kernel mutation closed in a worktree with a valid SQLite store, while any other residue — non-empty task directories, malformed or unknown workspace content, symlinks and unreadable paths — is now rejected consistently by both the inspection and the locked-mutation guard.

- [`66b7ac5`](https://github.com/dereknex/immune-brain/commit/66b7ac5b4f8ed4a524c6d59617bbeeb5dbc9950e) Thanks [@dereknex](https://github.com/dereknex)! - Resume a resolved parked Lane under fresh Batch Authorization bound to its recorded Kernel run. Preserve safe release handoffs on store rejection, isolate archive durability checks from live SQLite, and clarify Review coverage and plan-drift recovery boundaries.

- [`382cdfc`](https://github.com/dereknex/immune-brain/commit/382cdfc7b6a357a8b0d590d6966d10d58ae19515) Thanks [@dereknex](https://github.com/dereknex)! - Add `retire_stale_batch`: one literal-user disposition that retires a batch record the plan moved past, preserving its children, commits, lane bindings, and report while granting no handoff and no approval. A mid-flight child, a record that moved during the gate, and a non-interactive Host are refused with zero writes.

## 5.1.0

### Minor Changes

- [#175](https://github.com/dereknex/immune-brain/pull/175) [`b2fb6cd`](https://github.com/dereknex/immune-brain/commit/b2fb6cdc47d9a9870976a04182bcd82ac7eb821e) Thanks [@dereknex](https://github.com/dereknex)! - A Parent that runs inside Herdr now holds each Lane's Executor Host in its own Herdr tab, without asking: it creates a tab in its own workspace rooted in the Lane, starts the allowlisted Host there, submits the `imm-run` entry, and waits on the agent's state as a background command. A tab stopped at a workspace-trust, sign-in or permission dialog is reported to the user and never answered by the Parent; the Parent closes no tab, and the user closes them. Outside Herdr the earlier behavior is unchanged. The lane-mode `executor` handoff now also carries `lane_path`. The runtime and the `lane-steward` role still name no workspace tool (ADR 0013, revised 2026-10-09).

- [#175](https://github.com/dereknex/immune-brain/pull/175) [`b2fb6cd`](https://github.com/dereknex/immune-brain/commit/b2fb6cdc47d9a9870976a04182bcd82ac7eb821e) Thanks [@dereknex](https://github.com/dereknex)! - The Parent now launches and supervises each Lane's Executor Host in a lane-mode batch; the `lane-steward` role supplies Lanes and starts no Host session. A supervised session is a separate Host process rooted in the Lane, started non-interactively with an `imm-run` entry, whose exit notifies the Parent. Parent Host and Executor Host (`claude-code` or `pi`) are chosen independently, and a Parent Host that cannot offer such a session launches nothing and reports the handoff to the user. The runner, the batch record and the handoff shapes are unchanged (ADR 0013, revised 2026-10-09).

- [#175](https://github.com/dereknex/immune-brain/pull/175) [`b2fb6cd`](https://github.com/dereknex/immune-brain/commit/b2fb6cdc47d9a9870976a04182bcd82ac7eb821e) Thanks [@dereknex](https://github.com/dereknex)! - Add Lane Preferences. A repository can set `Lane max parallel`, `Lane Executor Host`, `Lane Executor model` and `Lane Executor effort` in its root `AGENTS.md` or `CLAUDE.md`; the Parent resolves them (a literal user instruction wins, then the repository, then the user-level file) and uses them as the `max_parallel` argument and as the Executor Host's `--model` and `--effort`/`--thinking` launch arguments. Without a directive nothing changes: the batch is serial unless asked otherwise and the Executor Host runs on its own defaults. The runner reads none of them. The README and `docs/reference/immune-brain-config.md` document the four directives.

- [#175](https://github.com/dereknex/immune-brain/pull/175) [`b2fb6cd`](https://github.com/dereknex/immune-brain/commit/b2fb6cdc47d9a9870976a04182bcd82ac7eb821e) Thanks [@dereknex](https://github.com/dereknex)! - `start_unattended_batch` now reads a Local Initiative. When `docs/initiatives/<slug>.md` exists, both Hosts project the batch plan from that file with no GitHub operation; every other slug is still read from its GitHub Parent Issue. Each `## <slice-id>: <result>` section names exactly one Task under `Tasks:` and may add one `Blocked by: <task-id>, <task-id>` line. A Slice with no Task or several, a dependency outside the Initiative, or a symlinked carrier refuses the plan before any confirmation. The plan digest is the same as for a GitHub Initiative with the same Tasks and dependencies.

- [#175](https://github.com/dereknex/immune-brain/pull/175) [`b2fb6cd`](https://github.com/dereknex/immune-brain/commit/b2fb6cdc47d9a9870976a04182bcd82ac7eb821e) Thanks [@dereknex](https://github.com/dereknex)! - Report parallel start groups in the unattended Batch Plan and add the pure scheduling function behind them (`parallel-batch-lanes` S1). The new `runtime/unattended/batch_schedule.ts` returns the startable children for a batch: a pending child starts when every dependency is done, its scope is provably disjoint from every in-flight child, and the in-flight count stays below `max_parallel`. Identical, prefix-nested, wildcard and unprovable scopes are treated as overlapping and serialize, and with a limit of 1 the choice is exactly the serial runner's. `projectBatchPlan` additively reports `parallel_groups` (start waves) and `scope_conflicts` (children held back by an overlapping sibling); `plan_digest` and every existing plan field are unchanged. No tool parameter and no persisted-state change, so serial batches behave as before.

- [#175](https://github.com/dereknex/immune-brain/pull/175) [`b2fb6cd`](https://github.com/dereknex/immune-brain/commit/b2fb6cdc47d9a9870976a04182bcd82ac7eb821e) Thanks [@dereknex](https://github.com/dereknex)! - Add opt-in lane mode to the unattended batch (`parallel-batch-lanes` S2). `start_unattended_batch` on both Hosts accepts an optional `max_parallel` and `lane_offers` beside `initiative_slug`. With `max_parallel` 1 the runner writes `batch_run_state` v2, admits an offered, already-existing Git worktree only when it shares the repository, is not the coordinator, is on `imm-lane/<slug>/<task-id>` at the named base, is clean and unoccupied, enrolls the child into it, commits the settled delivery on the lane branch, and fast-forwards the batch branch only to a candidate whose changed paths and per-path content equal the lane commit. `max_parallel` above 1 is refused (`batch_parallel_unsupported`), a resume with a different value is refused (`batch_parallel_mismatch`), and the runner still never creates, switches or deletes a worktree. Without `max_parallel` the serial batch is unchanged (v1 state, same report). ADR 0013 is accepted and the living contracts describe the opt-in.

- [#175](https://github.com/dereknex/immune-brain/pull/175) [`b2fb6cd`](https://github.com/dereknex/immune-brain/commit/b2fb6cdc47d9a9870976a04182bcd82ac7eb821e) Thanks [@dereknex](https://github.com/dereknex)! - Guard lane-mode integration with a descriptor rerun (`parallel-batch-lanes` S3). Before the batch branch moves, the runner reruns the deterministic QA descriptors of the child and of every sibling integrated since the lane base against the candidate commit's tree, without checking it out and without recording any Kernel attestation or finding; the batch branch fast-forwards only after they pass. A failed rerun (`batch_integration_check_failed`), a plumbing conflict or an identity mismatch (`batch_integration_conflict`) leaves the batch branch and working tree unmoved, parks the child as `needs_human`, skips its dependents and keeps the Lane and its branch, while a disjoint committed sibling still integrates. Also fixes resume adoption after an interruption between the fast-forward and the state write: the integrated-commit lookup mis-split Git trailers and never matched, so a resumed tick could have committed the child twice.

- [#175](https://github.com/dereknex/immune-brain/pull/175) [`b2fb6cd`](https://github.com/dereknex/immune-brain/commit/b2fb6cdc47d9a9870976a04182bcd82ac7eb821e) Thanks [@dereknex](https://github.com/dereknex)! - Run several Lanes at once (`parallel-batch-lanes` S4). With `max_parallel` above 1 the lane-mode batch keeps up to that many scope-disjoint children in flight, reports one `provision` or `executor` handoff per child in `handoffs[]`, and integrates settled children serially. A child whose scope overlaps an in-flight Lane waits; a parked, lost (`batch_lane_lost`) or QA-exhausted child ends only itself and its dependents while disjoint siblings keep moving; `qa_failure_limit` counts each child separately. `batch_parallel_unsupported` no longer occurs. A batch without `max_parallel` stays the serial v1 run.

- [#175](https://github.com/dereknex/immune-brain/pull/175) [`b2fb6cd`](https://github.com/dereknex/immune-brain/commit/b2fb6cdc47d9a9870976a04182bcd82ac7eb821e) Thanks [@dereknex](https://github.com/dereknex)! - Add the `lane-steward` internal role and Lane release (`parallel-batch-lanes` S5). The role supplies a Lane on the named branch at the named base, starts one allowlisted Executor Host (`claude-code` or `pi`) there, and reports "cannot supply" instead of improvising. After a child is integrated, its Lane is clean and its audit pair is reachable from the batch branch, the lane-mode report carries a release handoff; a later tick that observes the Lane path gone records the child `released`. The runner still never creates, switches or removes a worktree, and no new public skill is added.

### Patch Changes

- [#175](https://github.com/dereknex/immune-brain/pull/175) [`b2fb6cd`](https://github.com/dereknex/immune-brain/commit/b2fb6cdc47d9a9870976a04182bcd82ac7eb821e) Thanks [@dereknex](https://github.com/dereknex)! - Lane-mode agents now only create. The Parent closes no Herdr tab and stops no Executor Host session, and neither it nor the `lane-steward` removes a Lane: a `release` handoff is reported to the user, who closes the tab and removes the Lane. The runner is unchanged and still records a child `released` once it observes the Lane path gone.

- [#175](https://github.com/dereknex/immune-brain/pull/175) [`b2fb6cd`](https://github.com/dereknex/immune-brain/commit/b2fb6cdc47d9a9870976a04182bcd82ac7eb821e) Thanks [@dereknex](https://github.com/dereknex)! - Make `scripts/verify-batch-completion.ts` verify a completed lane-mode batch (`batch_run_state/v2`) instead of failing `read_failed`. It reads the lane report (`handoffs[]`), checks the batch-branch commits in integration order against their trailer, subject, single-parent lineage, audit pair and scope, and reports a self-contradicting v2 record as `state_report_mismatch`. Serial (v1) verification is unchanged.

- [#175](https://github.com/dereknex/immune-brain/pull/175) [`b2fb6cd`](https://github.com/dereknex/immune-brain/commit/b2fb6cdc47d9a9870976a04182bcd82ac7eb821e) Thanks [@dereknex](https://github.com/dereknex)! - Make lane-mode readers and guidance accurate. A kernel store-condition rejection of a persisted lane batch now reports its persisted lane children and `handoffs[]` instead of an empty serial plan, the resume plan marks `integrated` and `released` lane children `already_settled` instead of `enrollable`, and the lane report names provision guidance only when a handoff has action `provision`. The lane `needs_human` wording now says the lane batch has stopped, its Lane is kept, and continuing needs a new Batch Authorization; the runner behavior is unchanged. Serial (v1) reports are unchanged.

- [#175](https://github.com/dereknex/immune-brain/pull/175) [`b2fb6cd`](https://github.com/dereknex/immune-brain/commit/b2fb6cdc47d9a9870976a04182bcd82ac7eb821e) Thanks [@dereknex](https://github.com/dereknex)! - Align the two Hosts on the lane-mode tool input. A `start_unattended_batch` call with `lane_offers` and no `max_parallel` now resumes the recorded lane batch with its recorded `max_parallel` on Claude Code and Pi, and is refused before any gate when there is no recorded active lane batch. The Pi `max_parallel` schema now refuses a non-integer or sub-1 value at the schema, as Claude Code does, and the Pi loop surface accepts the `lane-supply` route target.

## 5.0.0

### Major Changes

- [`f8c69e1`](https://github.com/dereknex/immune-brain/commit/f8c69e112634c8a5be2323dd88384becbf52ff49) Thanks [@dereknex](https://github.com/dereknex)! - **BREAKING:** rename three public Skills so the suffix names the job (#163). There is no alias layer and no deprecation window: the old names stop resolving on upgrade.

  | Old                      | New            |
  | ------------------------ | -------------- |
  | `imm-loop`               | `imm-run`      |
  | `imm-agent-doc-maintain` | `imm-doc-slim` |
  | `imm-review-retro`       | `imm-retro`    |

  Update every invocation (`/immune-brain:imm-run`, `/skill:imm-run`, and the equivalents for the other two) and any personal command or prompt alias that forwards to the old names. `imm-brainstorm`, `imm-planner`, `imm-doc-prune` and `imm-pr-fix` are unchanged.

  The Skill directories, the packaged contracts under `dist/`, both registries (`name`, `path`, `next_actions`, plus the `Doc Slim` and `Retro` titles) and the dist sync manifest move with the names. The Loop routing contract's `entry` value in `runtime/loop_contract.ts` is now `"imm-run"`, and the Kernel and Pi Enrollment routing hints name `imm-run`. Internal identifiers without the `imm-` Skill prefix keep their names (`loop_contract.ts`, the `imm_loop_action` Tool, `review_retro.ts`), and historical records (archived docs, Plans, Specs, reports, `.imm/` audit records, the changelog) are not rewritten.

### Minor Changes

- [`057f647`](https://github.com/dereknex/immune-brain/commit/057f647636b026261117cb92bc62f9d54cc5ce3b) Thanks [@dereknex](https://github.com/dereknex)! - Ship generated native agent definitions for the read-only roles on the Claude Host.

  - The Claude plugin build now also writes `immune-brain-qa`, `immune-brain-ui-review` and `immune-brain-advisory-reviewer`, each body generated from the matching `runtime/prompts/` role prompt the Pi Host dispatches, under fixed frontmatter whose tool allowlist is exactly `Read, Grep, Glob`. These roles declare `no tools` in `INTERNAL_ROLE_PROMPTS`; a native definition cannot express an empty allowlist without inheriting every tool, so read-only-without-shell is the strictest expressible boundary. `--check` fails when a committed definition differs from a fresh generate.
  - `runtime/claude/role_agents.ts` maps exactly those three roles to their plugin agent types, and `arch-explorer` to the Host's own `Explore` agent with no shipped definition, so a second definition cannot fork a boundary the Host owns.
  - The packaged Loop and Planner contracts and the dispatch protocol, with its packaged mirror identical to its source, state that on the Claude Host a read-only role is dispatched through the `Agent` tool by its plugin agent type, that architecture exploration uses the Host's `Explore` agent, and that the agent definition rather than prompt text bounds the role's tools. They state that on Pi the agent configuration belongs to the user and the boundary remains prompt text.
  - `loopRoleSubagentFor`, the Pi dispatch envelope and the reviewer definition are unchanged.

- [`bbaa947`](https://github.com/dereknex/immune-brain/commit/bbaa947323f53168f64bb8bf2634ce68196d0868) Thanks [@dereknex](https://github.com/dereknex)! - Send the Claude reviewer only the parameters its `Agent` tool accepts, and pin the read-only tool boundary of its native definition.

  - The Claude Review dispatch envelope is now exactly `{ name, prompt }`; the receiver-less `max_turns` and `run_in_background` are gone, so a Parent copying the envelope unchanged no longer passes two parameters the Host rejects. `ReviewRequest.maxTurns` stays on the shared type because the Pi port forwards it natively.
  - A package test reads the shipped reviewer frontmatter and requires the allowlist to be exactly `Read, Grep, Glob, Bash`, so `Agent`, `Edit`, `Write` and `NotebookEdit` stay natively denied, and rejects the `hooks`, `mcpServers` and `permissionMode` keys that a plugin agent ignores and would otherwise read as enforced.
  - Reservation binding, hook observation, settlement and every blocked Review result with its reason, release decision and `recovery_action` are unchanged.

- [`1e5043e`](https://github.com/dereknex/immune-brain/commit/1e5043ec3c0c04cb857ab00fcb393a20f666e47e) Thanks [@dereknex](https://github.com/dereknex)! - Assurance snapshot capture, Review-revision proof, capability minting and verdict application now live in one host-neutral module, `runtime/assurance/verdict_authority.ts`. The coordinator constructs that authority itself, so both hosts supply only their `AssuranceHostPort`, a confirmation-reference source (`claude:<actor>` / `pi-confirm-<16 hex>`) and an optional rework-parked notice; `AssuranceCoordinatorPorts` no longer carries per-host `buildAssurance`, `ensureReviewRevision` or `applyVerdict`. The Claude adapter thereby adopts the stricter checks the Pi adapter already enforced: capture validates record revision, intent revision and intent content hash together, refuses a v4 record without `git_base_head`, and verdict application re-verifies the whole snapshot before any capability is minted. Hook ordering is now identical on both hosts — `beforeCommit` → mint → commit → `afterCommit`, with the first hook error rethrown while the committed transition stands.

- [`fa759e3`](https://github.com/dereknex/immune-brain/commit/fa759e3129e8353530c8337bad1d0dd9fda23604) Thanks [@dereknex](https://github.com/dereknex)! - Require a named source for every planned decision and an agreed test seam for every acceptance.

  - The Planner contract gains `Decision Provenance`: every Spec decision and every acceptance names exactly one source — an upstream `BR-*` ID, repository evidence with a concrete path, or a delegated technical choice — with or without a Brainstorm manifest. A user-owned decision with no source is a defect that is removed or returned for clarification. Direct Planner entry and delegated technical choices stay legitimate sources, so this adds no `BR-DEC`-only rule.
  - `TaskIntent decomposition` now requires each Slice of a multi-TaskIntent Initiative to state what is verifiable when that Slice alone has landed, and forbids an acceptance that needs another unfinished Slice's work. A Slice with no such statement is a horizontal layer slice and is re-cut; a wide mechanical refactor may still be batched behind one final integrate-and-verify Slice. Both rules stay Planner judgment, not a schema field or an Enrollment counting rule.
  - `Testing Seam Selection` records the agreed seam of each acceptance in the candidate — the Spec's verification mapping for complex work, the acceptance assertion for simple work — and presents it through the surfaces Enrollment already shows. No confirmation is added: seam selection still must not weaken focused descriptors or create a mandatory user confirmation. Replacing a seam remains an acceptance change under Enrolled Intent Revision.
  - The `code-review` role prompt checks delivered tests against each named agreed seam. A missing or silently replaced seam is a finding with `violated.kind: "acceptance"` and the acceptance id as `ref`; an acceptance naming no seam produces no finding, so historical candidates stay valid.
  - `docs/reference/planning-quality-gate.md` mirrors the provenance and Slice rules; its packaged copy, the role-prompt mirror, and `agents/immune-brain-reviewer.md` are regenerated.

  Contract text and generated mirrors only: no runtime, schema, validator, or gate changed.

- [`7783446`](https://github.com/dereknex/immune-brain/commit/778344687d617089016e153e24dff9c6e65d98b3) Thanks [@dereknex](https://github.com/dereknex)! - Retire the Pi extension's `runtime-stub` layer: the Pi enroll, work and unattended-batch Tools import the host-neutral runtime statically, so the same Kernel code now has one import shape across both Hosts. The stub's adapter-owned logic moved unchanged into the Pi adapters — `readTaskIntentForRecord` (record-aware sidecar resolution), `markGithubTaskTerminal`, the shared session progression accessors and `projectAssuranceForTask` now live in `imm-canary-work.ts`, and `readSettledTaskRecord` moves to `imm-unattended-batch.ts` (currently caller-free; the settled-run Slice makes it Run-aware). The mirrored `LITERAL_USER_ACTOR_ID` constant and hand-copied structural types are gone in favor of the real runtime exports. `tests/pi-canary-package-boundary.test.ts` now proves the boundary through the import graph (no dynamic runtime import under `.pi-extension`, every static runtime import resolves, and the Pi Enrollment adapter reaches Kernel prepare only through `runtime/assurance/enrollment`) with a negative control, instead of pinning stub source text.

- [`856ef49`](https://github.com/dereknex/immune-brain/commit/856ef4994b299afd5a0015354145e16901844035) Thanks [@dereknex](https://github.com/dereknex)! - Tell a blocked Claude `submit_review` how to recover on the same Host, and stop claiming every Host runs reviewer Agents in the foreground.

  - A blocked Claude Review result carries one `recovery_action`: a released reservation starts a fresh reviewer through `advance_assurance`; a reservation still waiting asks for the same reviewer's verdict; a mismatched parent verdict must be resubmitted exactly.
  - Continuing a finished reviewer is rejected as a duplicate `SubagentStop`, and the Loop contract plus the reviewer definition forbid re-prompting one, including through SendMessage.
  - The packaged Loop contract states that a Claude `Agent` call returns an asynchronous launch receipt, which is normal, and that the reserved prompt is dispatched unchanged.

- [`e8c8784`](https://github.com/dereknex/immune-brain/commit/e8c878405ad04c64bfed61e9f9e288925d5d2076) Thanks [@dereknex](https://github.com/dereknex)! - Require a Review pass verdict to claim every path of the reviewed change set.

  - For the review role only, `parseAssuranceVerdict` now requires `approval.inspected_paths`: an array of unique repository-relative path strings. A pass is rejected as `verdict_invalid` when the field is absent, is not an array of strings, duplicates a path, lists a path outside the reviewed change set, or omits any path of it; deleted paths are part of the required set and an empty change set is claimed as an empty array.
  - The rejection names the offending paths, keeps the reservation, and follows the existing single-correction path, so the fix is a corrected verdict rather than a re-dispatched reviewer.
  - The list is checked at the coordinator and removed before settlement: the Kernel approval and TaskRecord are unchanged, so no schema, persisted record or replay path changes, and the contract id stays `assurance_kernel/assurance_verdict/v2`.
  - Rework verdicts and QA-role verdicts still reject the field as unknown. The reviewer prompt, the packaged reviewer definition and the Loop contract state that a path may be listed only after its diff was read.

  This converts silent partial Review coverage into an explicit false statement in the verdict. The check proves the reviewer claimed every path, not that it read it; that limit is accepted under BR-DEC-3.

- [`c7aafba`](https://github.com/dereknex/immune-brain/commit/c7aafba2b6b51719bba321ab22084c9dd90ba877) Thanks [@dereknex](https://github.com/dereknex)! - Bind a Claude reviewer start only to a byte-identical reserved prompt.

  - The reservation marker stops being an acceptance path. `bindsStart` and the `Agent` `PostToolUse` now compare a present prompt against the reservation's own `dispatchPrompt`, so a dispatch that keeps the matching `operation_id` and `task_id` marker but appends context, truncates, or rewrites the body does not bind, cannot settle, and yields a blocked `submit_review` with the retained-reservation `recovery_action`.
  - A start carrying no prompt still binds through the identifiers the hook supplies, because that evidence is not Parent-authored text.
  - The packaged Loop contract states that any edit to the reserved prompt forfeits the reservation and that the same envelope must be dispatched unchanged.

  Sessions that append context to the reviewer prompt stop settling. That is the intent: context belongs in the Kernel-assembled prompt. The generated Claude bundle matches the runtime source.

- [`97f1763`](https://github.com/dereknex/immune-brain/commit/97f1763d9799ab5603170737f3205ff0d92b9e30) Thanks [@dereknex](https://github.com/dereknex)! - Generate the packaged Claude reviewer definition and stop sending its static rules twice.

  - `STATIC_REVIEW_RULES` and `REVIEWER_DISPATCH_RULES` are now exported from the role prompt bridge as the single source for the sentences every Review dispatch carries: the read-only rule, the final-turn single JSON verdict rule, the finding provenance rule, the `inspected_paths` statement, and the BR-REQ-3 dispatch rules.
  - `scripts/build-claude-plugin.ts` writes `plugins/immune-brain/agents/immune-brain-reviewer.md` from the `code-review` role prompt plus those rules under fixed frontmatter, and `--check` now fails when the committed definition differs from a fresh generate, so a hand-edit cannot drift from the instructions a dispatched reviewer is meant to carry.
  - `ReviewRequest` carries a second projection, `snapshotPrompt`: the per-dispatch facts alone. The coordinator builds the complete prompt as the role contract, the static rules and those facts, so `buildReviewPrompt` keeps every instruction and fact it carried before for the Pi Host, while the Claude envelope prompt is the reservation marker followed by `snapshotPrompt` — it no longer repeats instructions the reviewer definition already holds.
  - The one resulting change to the Pi prompt is formatting: the `inspected_paths` sentence now backticks the identifier, because the shared sentence has to satisfy both dispatch shapes.
  - Binding, settlement, blocked results with their reason, release decision and `recovery_action`, and the Pi dispatch parameters are unchanged.

- [`45223ae`](https://github.com/dereknex/immune-brain/commit/45223ae982b74d999ce7916998de039bc814cf3b) Thanks [@dereknex](https://github.com/dereknex)! - Add the Run-exact settled-Run read behind the Authority Store: `readSettledRunEvidence` returns a Task's settled Run with its identity-validated record, its proof, its raw bytes, and whether its audit pair has been exported, and never answers from live state. `readSettledTaskEvidence` layers that read over the legacy flat layout, so pre-store terminals keep resolving without ever projecting another worktree's run. The run-blind `readAuditTaskPair` terminals in `assurance_projection.ts`, the batch preflight/commit/reconfirmation paths and the Pi `readSettledTaskRecord` now bind to this worktree's own run, so a re-enrolled Task reads its current Run's evidence and an earlier Run's exported pair is never returned. Batch children reconfirm their audit paths through `storage_paths.ts` instead of `.imm/` literals, the `enroll-<task>-<created_at>` convention is defined once (`enrollmentEventIdFor`), and the forwarding `readTaskRecord` export is gone — callers use `readTaskRecordRaw`. No schema change; the bundle is regenerated from these sources.

- [`80dc66f`](https://github.com/dereknex/immune-brain/commit/80dc66fcf3038415c785646d21806578be26ed3e) Thanks [@dereknex](https://github.com/dereknex)! - Give unattended batch runs one production child Kernel port (`deepen-authority-seams` D5). A new `runtime/unattended/batch_kernel_port.ts` owns `enrollTask` (through the single Enrollment entry), `projectTask`, `ownsTaskClaim` and `validateBatchAuthorization`; a Host supplies only its own `advanceTask` progression seam. The Pi and Claude adapters both call this shared port instead of each building its own, so Enrollment, projection, resume-ownership re-verification and batch authorization validation cannot drift between Hosts. Git operations leave `BatchRunnerKernelPort` entirely: the runner resolves `BatchRunnerGitPort` once (the injected port, or `createDefaultBatchGitPort` when a Host supplies none) instead of a three-level fallback over optional port members.

- [`80d6e3c`](https://github.com/dereknex/immune-brain/commit/80d6e3c44b8b700038cbb8c45ff31d37234eeda6) Thanks [@dereknex](https://github.com/dereknex)! - One function in `runtime/workspace_scope.ts` now computes a TaskRecord's delivery identity: `taskDeliveryIdentity` selects the revision family for a v4 record with `git_base_head`, throws for a v4 record without it, and keeps the index family for pre-v4 records. The Claude adapter, the Pi adapter, `commands/kernel.ts` and `batch_reconfirmation.ts` call it instead of branching on `record.contract` themselves, and `projectAssurance` plus both Kernel application modules default to it when no `diffProvider` is supplied — a supplied provider still overrides it, so the existing test seam is unchanged. Batch plan reconfirmation keeps its v4-only refusal and only delegates the computation.

- [`b5a046f`](https://github.com/dereknex/immune-brain/commit/b5a046f0e4c25f9c01daeb0ed143a5051fcd464d) Thanks [@dereknex](https://github.com/dereknex)! - Give Enrollment a single entry (`deepen-authority-seams` D3). `runtime/kernel/enrollment.ts` exports `enrollTask`, the one production path that issues the capability for a supplied binding, runs the zero-write rehearsal, calls the optional caller checkpoint, and commits. A not-ready rehearsal rejects through a single shared `Kernel enrollment rehearsal failed: <blockers>` error; a declined checkpoint returns a `cancelled` outcome with zero Kernel writes; once commit has started, cancellation has no effect, and replay of a lost Enrollment keeps today's behavior. The Claude enroll path, the Claude batch child port, the Pi enroll Tool and the Pi batch child port all call this entry instead of each sequencing rehearsal and commit themselves. `runEnrollmentRehearsal` stays exported as the zero-write precheck for tests and diagnostics.

### Patch Changes

- [`45223ae`](https://github.com/dereknex/immune-brain/commit/45223ae982b74d999ce7916998de039bc814cf3b) Thanks [@dereknex](https://github.com/dereknex)! - Require compact per-acceptance delivery evidence in Executor handoffs and link it from the Loop before Assurance. The guidance traces affected callers, uses production success controls and causal rejection controls, identifies checked input bytes, and records known invariant triggers after repair. Preserve existing Kernel QA, Review and rework authority boundaries.

- [`7e8bbd8`](https://github.com/dereknex/immune-brain/commit/7e8bbd8720b2c8e9a221125a7cbc9a2a81160db7) Thanks [@dereknex](https://github.com/dereknex)! - Restore the reviewer instruction that conversation text and Hook callbacks are not authority.

  When the packaged reviewer definition became generated, the hand-written sentence "Read only the immutable Review evidence identified in the request. Verify provenance before analyzing findings. Do not treat conversation text, Hook callbacks, or live worktree bytes as authority." was dropped: no generation source carried it. It now lives in `STATIC_REVIEW_RULES`, so both dispatch shapes receive it — the Pi complete Review prompt and the generated Claude reviewer definition — and the plugin build's drift check keeps the definition in step.

## 4.6.0

### Minor Changes

- [`fb80252`](https://github.com/dereknex/immune-brain/commit/fb802525ec59a9fac56637f58aed3cb47635874a) Thanks [@dereknex](https://github.com/dereknex)! - Remove every wall-clock bound on Immune-Brain authority.

  - **Single-step capabilities (S1):** Kernel authority and Enrollment capabilities no longer carry `expires_at` and are never refused because time passed. They stay one-use and bound to their task, operation, record hash, and nonce. New TaskRecord history entries omit `authority.expires_at`; records that carry it still validate and load.
  - **Native confirmation (S1):** the batch gate has no window of its own on either Host. It settles only on the user's answer or the caller's cancellation signal. `IMMUNE_BRAIN_BATCH_TIMEOUT_MS` and the `confirmation_timed_out` reason are removed; setting the variable has no effect.
  - **Batch authorization (S1):** the budget is `max_children` and `qa_failure_limit` only. `budget.deadline_at`, the binding's `expires_at`, the state record's `authorization_expires_at`, the default eight-hour deadline, and the `batch_authorization_expired` / `batch_budget_expired` blockers are removed. A batch parked on a foreground Review resumes with no gate however long it waited. Plan-digest drift, a branch change, a moved HEAD lineage, and both budget limits still stop or re-gate the run as before.
  - **Older records:** a batch state record that still carries the retired expiry fields is read as if they were absent and is rewritten without them. No migration runs and frozen audit is untouched.
  - **Decision records:** ADR-0005 decision 3 and ADR-0008 decision 3, with its rejected alternative, now describe the clockless rule and why the deadline was retired.
  - **Gate-free closeout (S2):** a batch child that reaches Kernel `done` in the foreground is committed and the batch record settled in the same tool call, with no new gate. A HEAD that fast-forwards on the batch branch is adopted as the new expected head and recorded in the batch run state; any other HEAD movement still ends the run with `batch_head_lineage_broken`. A failure after the Kernel result is reported beside it with one retry action and never alters it.
  - **Parent close (S3):** after `mark-terminal` closes a Child as completed, the tracker reads the Parent and its Sub-issue list (Issue-scoped, no repository listing) and closes the GitHub Initiative Parent as completed exactly once when every Slice Child is completed. An open, stopped or parked Child keeps it open; an already closed Parent and a rerun write nothing. A failed Parent read or close is reported as tracker observation, retried by the same `mark-terminal`, and never changes the Kernel result. The Parent body, the Planner contract and `docs/agents/issue-tracker.md` state the new rule; the tracker result contract and Issue markers are unchanged.

- [`f72f2e8`](https://github.com/dereknex/immune-brain/commit/f72f2e89aea6069e7103a95f0a421a52f5d5dfeb) Thanks [@dereknex](https://github.com/dereknex)! - Publish GitHub Initiatives with a direct create-then-relate write flow.

  - **Direct write flow (S1):** `imm-tracker publish-initiative` reads the repository identity, the Issue listing, and the label listing once at start, then creates each absent Issue in dependency order, attaches each Child as a native Sub-issue, and writes one `blocked_by` relation per dependency edge. Issue numbers come from the create responses; no repository listing, attachment confirmation, dependency confirmation, ownership confirmation, or closing topology pass follows a write. The number of repository-wide reads is constant in the number of Children, so a large Initiative no longer grows its call count or its runtime with the batch.
  - **Start-only deduplication:** a rerun of the same approved batch adopts whatever the start listing already carries and writes only the missing relations, so a partial run, a lost create response, or a repeated complete batch never creates a duplicate Issue and never repeats a completed write. Concurrent edits made during a run are no longer detected within that run; they surface as drift at the start of the next run.
  - **No whole-operation deadline:** the 120-second publication budget and its expiry refusal are removed. One publication call is a finite step sequence that stops at its first failed call, each call keeps its own 20-second timeout, and the caller's cancellation signal still stops the run at the next call. A failure is reported as uncertain with its confirmed steps, pending steps, and exactly one recovery action — rerun the same approved batch.
  - **Amendment uses the same flow (S2):** an `amendment` input verifies every bound Issue against its approved baseline once, from the start listing plus Issue-scoped relation reads, then edits the Parent at most once, edits each approved pending brief at most once, creates newly added pending Children as in ordinary publication, and converges each pending Child's `blocked_by` set from the start read. Historical Children receive zero writes. No read follows a write, so baseline drift that appears after the start listing is not detected in that run; it surfaces at the start of the next run. Omitted membership, start drift, and stopped historical prerequisites still fail closed before any write. A Parent edit that already succeeded is reported as confirmed even when a later Child or relation call fails.
  - **Generator consistency:** this changeset also regenerates `plugins/immune-brain/dist/claude/mcp-server.mjs`. The previous commit (`aa8b5b8`) added `QA_MAX_IDENTICAL_FAILURES` to `runtime/assurance/coordinator.ts` and to the bundle, but the following tracker commit re-checked out an older bundle while keeping the newer runtime source, leaving the checked-in bundle inconsistent with its own sources. The regenerated bundle restores that consistency; no Kernel behavior is changed by this task.
  - **Unchanged surfaces:** local preflight, Issue body and marker format, `mark-terminal`, `observeGithubInitiative`, the tracker result contract, Kernel authority, and Enrollment are untouched.

### Patch Changes

- [`ca0f7ec`](https://github.com/dereknex/immune-brain/commit/ca0f7ec0b3e1e5dd419fe0a8b251952922389a9c) Thanks [@dereknex](https://github.com/dereknex)! - Limit repeated identical QA failures and add opt-in stage timings to `advance_assurance`.

  - **QA retry limit:** after two consecutive QA failures on the same snapshot (record revision, intent hash, diff hash) the coordinator returns `blocked` instead of rerunning the descriptors. A changed snapshot, a QA success, or a new session resets the count; host cancellation neither counts nor resets it.
  - **Stage timings:** with `IMM_ASSURANCE_TIMINGS=1` (or the `reportTimings` port) advance results carry `timings: { total_ms, stage_ms }` per progress stage. Off by default, so existing result contracts are unchanged.

## 4.5.0

### Minor Changes

- [#134](https://github.com/dereknex/immune-brain/pull/134) [`0567223`](https://github.com/dereknex/immune-brain/commit/0567223c0ef09793dd598627d2a5f4b53cfa49e1) Thanks [@dereknex](https://github.com/dereknex)! - Close the `workflow-decision-closure` Initiative (S1–S7): preserve the complete approved outcome through handoff, bound side effects and authority recovery, tie acceptance to observable invariants, make canonical Intent authoring discoverable, bound repository discovery, and record truthful observed behavior evidence.

  - **Outcome conservation through handoff (S1):** Planner and Brainstorm keep every upstream decision and required phase mapped exactly once, including clear zero-question requests and staged implementation; a plan that conserves only part of the confirmed outcome fails the completeness check instead of passing.
  - **Exact effect and outbound authorization (S2):** staging recovery, research and provider calls stay inside the existing operation/target/impact grants. A new outbound channel or provider is an authorization delta, and documentation, mock, real-channel and model-quality evidence stay distinct rather than merging into one verified claim.
  - **Authority-fact resume (S3):** Loop resumes from the Kernel task/run projection, not from a compaction summary, HANDOFF prose or Issue state. Authoritative, validated, published, enrolled and completed remain distinct, and a summary that contradicts receipts is corrected rather than replayed.
  - **Invariant-based acceptance and executable prerequisites (S4):** verification binds to observable seams with positive, negative and bound controls. Zero matched checks, skipped required checks, absent dependencies and a missing simulator fail instead of passing, and automated geometry evidence stays separate from human motion-quality judgment.
  - **Discoverable Intent authoring and bounded publication (S5):** `imm-kernel intent --help` states the canonical destination/stdin contract and strict v2 descriptor shape before a caller fails a call. GitHub publication recovers from confirmed partial writes within a whole-operation deadline: exact ownership/topology readback before any replay, idempotent reuse of the approved manifest, no duplicate Issues and no Enrollment before complete readback.
  - **Bounded discovery and partial-result recovery (S6):** internal roles keep read-only, bounded tool authority; discovery expands only along proved callers and stops on its stated criterion, truncated material is read in bounded pages when still required, and an interrupted step inspects already-applied edits and retries only the unfinished part.
  - **Observed behavior evidence (S7):** a focused offline verifier (`scripts/benchmark_eval.ts`) checks a sanitized ten-scenario cohort without ever calling a provider, failing closed on missing, duplicate, undisclosed or contract-only outcomes, on a pass whose recorded criteria do not cover its `successChecklist`, on an unmet criterion that is not the scenario's own, and on fingerprint or provenance drift. Live observation is disclosed honestly, including recorded failures.

  Task execution continues to require the native Host Enrollment confirmation gate, and no real commit, GitHub write or Enrollment is performed as scenario evidence.

## 4.4.1

### Patch Changes

- [`75bcf7d`](https://github.com/dereknex/immune-brain/commit/75bcf7d099ef134705caf8f32c82038f3d1d7ec7) Thanks [@dereknex](https://github.com/dereknex)! - Fix unattended batch execution and recovery across Pi and Claude hosts:

  - Renew expired parked authorization with a fresh budget while preserving progress and QA failure counters.
  - Return enrolled children to the foreground Executor before QA/Review, and continue serial children under the same grant.
  - Derive precise recovery actions from fresh Kernel obligations and findings, retaining safe check diagnostics without persisting raw verifier output.
  - Preserve authority-read retry budgets, legal path reconciliation actions, and fresh QA when Review preparation fails.

## 4.4.0

### Minor Changes

- Expose `revise_intent` in the Claude MCP tool surface and `ClaudeRuntime` to allow compatible TaskIntent revisions to be submitted and persisted directly, restoring the sidecar file and Git index on failure.

## 4.3.0

### Minor Changes

- [`50b1b7d`](https://github.com/dereknex/immune-brain/commit/50b1b7d85d1c4b83e583a1cb382ae9eff1bc2530) Thanks [@dereknex](https://github.com/dereknex)! - Allow Pi and Claude Enrollment in Git repositories with an unborn HEAD. The existing native confirmation includes creating an empty initial commit without staging project files or modifying Git configuration. Revalidate Git and workspace ownership around initialization, and expose the required initialization in TaskIntent validation.

## 4.2.0

### Minor Changes

- [#114](https://github.com/dereknex/immune-brain/pull/114) [`82aab3c`](https://github.com/dereknex/immune-brain/commit/82aab3cec921b5a60635f940c06a75f29c7b84ab) Thanks [@dereknex](https://github.com/dereknex)! - Auto-activate absent managed-task routing policy during explicit imm-planner runs.

  - In unowned repositories missing `managed-task-routing-policy.json`, explicit `imm-planner` entry now creates and stages the canonical `kernel_task_intent` routing policy automatically before authoring, removing redundant manual setup prompts.
  - Existing invalid, untracked, unreadable, or divergent routing policy files remain fail-closed as `routing_policy_invalid` and are not overwritten.
  - Task execution continues to require the native Host Enrollment confirmation gate.

## 4.1.0

### Minor Changes

- [#112](https://github.com/dereknex/immune-brain/pull/112) [`4350bd8`](https://github.com/dereknex/immune-brain/commit/4350bd81940f97c54bea1db65e7372a306f28e0e) Thanks [@dereknex](https://github.com/dereknex)! - Add user-configurable interaction language for host-native UX and internal role dispatches.

  - Host-native UI text (Task Rail sentences, authority dialog titles and actions, enrollment progress summaries) follows the new `IMM_UX_LANGUAGE` environment variable (for example `zh`); state enums, operation ids, domain field labels, agent-facing Tool result reasons, and diagnostic notifications stay literal English.
  - Internal role dispatches (`dispatch_role` and routed role contexts) accept `interaction_language` in the delegation context, so QA/Review/Explorer roles report findings and summaries in the user's language while keeping machine contracts literal; omitting it keeps prompt bytes and English role output unchanged.
  - Document the language boundaries in BASELINE.md and the dispatch contract in dist/imm-loop.md, and align AGENTS.md reply-language rules with explicit user language instructions.

## 4.0.1

### Patch Changes

- [#110](https://github.com/dereknex/immune-brain/pull/110) [`62a451b`](https://github.com/dereknex/immune-brain/commit/62a451beefb3c53605d145a6f76872b751539388) Thanks [@dereknex](https://github.com/dereknex)! - Codify rework root-cause lessons: require generalization arguments or contract-boundary refutations on repeated rework, require state-machine consumer enumeration before planning, record authority uniqueness key principles in ADR-0012, and aggregate review rounds per task in workflow-evidence-retro.

## 4.0.0

### Major Changes

- [#109](https://github.com/dereknex/immune-brain/pull/109) [`5f9da27`](https://github.com/dereknex/immune-brain/commit/5f9da279a28ff5953cf68a5a94f98df18fc9d2cb) Thanks [@dereknex](https://github.com/dereknex)! - Close the TaskRecord v3 drain window and delete the drained v4 CLI surface.

  The live `TaskRecord` contract is v4 only: `parseTaskRecord` and every entry
  point that mutates authority now reject a v2/v3 record, and the frozen parsers
  for those contracts moved to `kernel/legacy_task_record.ts`, where the audit and
  storage-layout readers reach them as a fallback. Settled pre-v4 evidence under
  `.imm/audit/` stays exactly as it was written — it is read through those frozen
  parsers rather than rewritten (see `docs/adr/0011-frozen-readers-for-pre-v4-terminal-evidence.md`), so no existing workspace needs a new migration step.

  The eight commands marked "Retired after v4 storage retirement" (`imm-work`,
  `imm-review`, `imm-autowork`, `imm-heal`, `imm-migrate`, `imm-finish`,
  `imm-check-child-output`, `imm-retire-stale-wrapper`) are gone: their `bin/`
  wrappers and the runtime's per-command `drain_required` / `v3_storage_retired`
  wall are deleted, a retired name now returns the generic
  `Unknown Immune-Brain v4 command` response, and `list-commands --json` no longer
  publishes a `retired` list. The retired _option_ wall on `imm-plan --sync` and
  friends is unchanged.

- [`60d310d`](https://github.com/dereknex/immune-brain/commit/60d310d587dbe8bc8c4983f5410ca59e6587942f) Thanks [@dereknex](https://github.com/dereknex)! - Replace the multi-file JSON authority store with one SQLite database per
  worktree (`.imm/state/kernel.sqlite`), and remove the retired file store, its
  byte-CAS journals, the duplicate claim/tombstone/relocation writers and the
  manual repair instructions that existed to reconcile them.

  Enrollment, freeze, QA, Review, settlement and audit export now run as Kernel
  transactions over that store; Git keeps sole ownership of code identity and
  terminal audit evidence stays tracked under `.imm/audit/<task-id>/`.

  Behavior that becomes simpler or stricter in the same release:

  - A simple TaskIntent no longer needs a Spec, and freeze, rework and stop bind
    artifacts in place instead of relocating them into `archive/`.
  - Delivery scope is an authorization envelope: new helpers and tests inside an
    approved directory need no revision, while staged work outside the envelope
    is rejected and each task's own dirt is preserved.
  - Deterministic QA runs every descriptor in a disposable materialization of the
    frozen tree with isolated Git metadata, so a descriptor can no longer observe
    or contaminate the live worktree.
  - Ordinary Review rework returns straight to execution. Only a recurring
    security boundary, or five effective rework rounds, pauses a task for a user
    decision, and a passing Review may carry non-blocking advisories that settle
    the task with the notes recorded on the attestation.

  The legacy audit projection stays read-only and is scheduled for removal in the
  next major release; migration of an existing workspace is explicit, claimless
  and validated against a temporary database before publication.

- [`ea5c6b6`](https://github.com/dereknex/immune-brain/commit/ea5c6b69b8f96da121d33876f885179f7283dfcb) Thanks [@dereknex](https://github.com/dereknex)! - Replace Bun-specific QA execution with project-owned preparation and verification commands for arbitrary toolchains.

  Deterministic QA now proves that every project process is gone before a result settles, and the declared 60-minute aggregate budget covers preparation and checks together.

### Patch Changes

- [`47fefda`](https://github.com/dereknex/immune-brain/commit/47fefda339def7e850113679f812bf79e81c4d79) Thanks [@dereknex](https://github.com/dereknex)! - Bind a Batch Authorization's expiry to the budget deadline the literal user confirmed instead of a fixed ten-minute window. A batch parked on a foreground Review inside its confirmed budget no longer lapses and demands a second native gate, while the fail-closed expiry, deadline, clock, and renewal checks are unchanged on both Hosts.

- [`b2a8e0a`](https://github.com/dereknex/immune-brain/commit/b2a8e0a89e660b3243262d920ca400058ec3afe9) Thanks [@dereknex](https://github.com/dereknex)! - Resume an authorized unattended batch without a second native gate. Pi and Claude Code reuse an intact, still-binding Batch Authorization — unexpired, same plan digest, batch branch, and HEAD lineage, batch still running — and open a fresh confirmation, named with the reason, whenever any of those no longer binds.

- [`dcf03db`](https://github.com/dereknex/immune-brain/commit/dcf03db733c62c0358651b00b6fbe8f14c8f396a) Thanks [@dereknex](https://github.com/dereknex)! - Start a new confirmed batch from the current Initiative plan after the previous run settles, with a fresh run identity and current HEAD binding. Reuse the existing batch branch only when its settled lineage is intact, retaining prior run evidence.

  Strengthen contract tool-name checks and exercise successful and resumed Host batch paths in the Git safety guards.

- [`aecf5dd`](https://github.com/dereknex/immune-brain/commit/aecf5ddab3b608dbf06023ef9f87662e45812667) Thanks [@dereknex](https://github.com/dereknex)! - Make the packaged contracts Host-neutral about tool identity: drop the stale `freeze_artifacts` step the Kernel already performs inside `advance_assurance`, restate every remaining Pi-only tool spelling as the obligation it stands for, and add a guard test that fails whenever a packaged contract names a tool absent from every Host tool surface.

- [`978fe57`](https://github.com/dereknex/immune-brain/commit/978fe57211c10f237251ed0070d64d998d4f71f0) Thanks [@dereknex](https://github.com/dereknex)! - Fix project-owned verification process discovery on Linux: the token search reads procfs instead of invoking `ps` with BSD modifiers, so deterministic QA can prove and complete process cleanup on Linux hosts.

  Descendants are attributed by session membership rather than by uid, so a command that drops its privileges while staying in the verification session is still cleaned up, and unrelated system processes with unreadable information can no longer fail every check on an ordinary Linux host.

- [`9bb43e3`](https://github.com/dereknex/immune-brain/commit/9bb43e34ca64abdc1aa326a509921681a5df2b12) Thanks [@dereknex](https://github.com/dereknex)! - Exclude a batch Child at planning time when its TaskIntent cannot name its bound Spec pair, instead of offering it for confirmation and having enrollment refuse it later. The batch plan reuses the same shared `spec_binding` predicate enrollment uses and reports a stable reason that names every path the intent must add; critical-child exclusion, dependency order, skipping, and the plan digest are unchanged.

- [`09c461a`](https://github.com/dereknex/immune-brain/commit/09c461ada89a6e35f2ce1e7b0a921f5fa4b973fa) Thanks [@dereknex](https://github.com/dereknex)! - Give the Claude Code Host the post-settlement GitHub tracker projection the Pi Host already performs, so an opted-in terminal projection no longer depends on which Host settled the task. The step lives in the shared coordinator (`projectTerminalTrackerState`) and both Hosts call it: it derives the projection input only for a fresh claimless done/stopped task with its exact terminal tombstone, forwards to the tracker, and reports a tracker failure as `tracker` beside the authoritative result instead of turning it into evidence, a Loop blocker, or a reason to repeat the settling Kernel mutation. Enrollment still performs no projection.

- [`70c3adc`](https://github.com/dereknex/immune-brain/commit/70c3adc469a7b7fe7862defd89dd6829b35681e9) Thanks [@dereknex](https://github.com/dereknex)! - Record one literal-user actor identity instead of two. A survey of the 122 settled records under `.imm/audit/` counted `literal-user` 220 times across 54 records against `user` 4 times in three Claude-Host-era records, so `literal-user` (which the Kernel's own batch validation already named in its error text) is the converged spelling: both Hosts now mint it for a batch or enrollment authorization, and the Kernel canonicalizes the actor where the audit identity is written, so a Host that still supplies the historical spelling is recorded as the literal user.

  Nothing is rewritten in place: the reader accepts both spellings, so a settled record or a batch capability issued under the old spelling keeps validating and stays byte-identical, and the batch authorization projection stays faithful to the state it read. The extension's mirrored constant is pinned to the Kernel's by a conformance assertion.

- [`9d61307`](https://github.com/dereknex/immune-brain/commit/9d61307a4e7249327e8d293a137c58b9d2c73dee) Thanks [@dereknex](https://github.com/dereknex)! - Converge three Host divergences onto the safer branch. Restoring a staged TaskIntent is now one shared, verifying implementation, so a restore that leaves the bytes or the index inconsistent fails closed on both Hosts instead of only on Pi. The bounded native-confirmation deadline is shared too: an unanswered confirmation ends on the same `IMMUNE_BRAIN_BATCH_TIMEOUT_MS` setting with the same default, and reports a stable timeout reason rather than a cancellation. Claude now imports the shared authorization-operation derivation instead of re-deriving it inline, so the mapping from Kernel readiness cannot drift between Hosts.

- [`ed64724`](https://github.com/dereknex/immune-brain/commit/ed64724ab7cd69a933d76df02be6765a0b7c7b01) Thanks [@dereknex](https://github.com/dereknex)! - Make the Spec binding an enrollment precondition instead of a freeze surprise. A new shared `runtime/kernel/spec_binding.ts` owns the "one scope-bound active Spec and its archive path" predicate; enrollment and its zero-write rehearsal now refuse an intent whose `scope_hint` cannot name that pair, naming every path the intent must add, while freeze-time enforcement is retained unchanged because enrollment cannot observe post-implementation scope drift.

- [`b284e65`](https://github.com/dereknex/immune-brain/commit/b284e653f4df2a5f2422b0097bb03d51c389dde7) Thanks [@dereknex](https://github.com/dereknex)! - Reduce `runtime/plan_core.ts` to the validator surface production reaches — `PlanValidationError` and `projectPlanValidation` — with the compiler deciding which bodies were genuinely unreachable, and remove the two orphans in `runtime/v4_runtime.ts` (the unused `READ_ONLY_V3_COMMANDS` set and `retiredResponse`'s unused `command` and `args` parameters). Plan validation behavior, the `imm-plan` projection, and the v3 retirement messages are unchanged; the plan-signature helpers, which no production caller reached, are gone.

- [`6ea8283`](https://github.com/dereknex/immune-brain/commit/6ea82832decddf847c420a643e5310b847287c46) Thanks [@dereknex](https://github.com/dereknex)! - Remove the retired authority-observation island — observation, automatic observations, legacy state mapping, readiness, readiness evidence, and authority commit receipts — together with the tests whose only subject was that code, and narrow the published `files` list to match. The TaskRecord v3 read path, the `imm-kernel audit --legacy` reader, and the storage-layout migration stay.

- [`059786f`](https://github.com/dereknex/immune-brain/commit/059786fa462b253f84981901c1e0515824fd12a3) Thanks [@dereknex](https://github.com/dereknex)! - Move the batch preflight both Host adapters duplicated into one shared projection (`runtime/unattended/batch_preflight.ts`): claim ownership, branch availability, working-tree cleanliness against the authorized child scope, reconstructed recovery children, plan digest, and base HEAD are now decided once below the Host boundary, and the post-confirmation drift check re-runs the same implementations. Each adapter keeps only its confirmation transport, failure envelope, and non-interactive refusal. `findExistingActiveBatch` now filters terminal states and has a single implementation, so a settled batch is no longer treated as active — while the settled record's identity still drives the runner's idempotent terminal replay instead of a parallel run.

- [`482b132`](https://github.com/dereknex/immune-brain/commit/482b1321bd49ca32e8bd00713f8f9805254280c5) Thanks [@dereknex](https://github.com/dereknex)! - Make one frozen table (`runtime/unattended/batch_reasons.ts`) the only producer of batch-gate reason and recovery prose on both Hosts, so the same condition reads identically by construction instead of because two copies still agree. Every migrated message keeps its exact text and recovery action; only a Host's own transport form (a returned envelope versus a thrown native error) stays with that Host. The dual-host parity assertions that compared the two adapters' reason strings are retired and restated as the property that can still fail: no adapter may carry a copy of the table's prose again.

- [`3635893`](https://github.com/dereknex/immune-brain/commit/36358931becdc469daa379535093982170a80b02) Thanks [@dereknex](https://github.com/dereknex)! - ADR-0008 now matches the batch runtime it describes and is settled. Its
  reuse/expiry decision is attributed to the shared implementation that owns it —
  `projectBatchPreflight`, `authorizeBatch`, and `projectBatchDrift` in
  `runtime/unattended/batch_preflight.ts`, with the blocker names it reuses nothing
  for — instead of the pre-extraction claim, and the record states the shipped
  decision (status `accepted`) with the persisted-capability and widened-window
  options kept as rejected alternatives.

- [`5b2b9e4`](https://github.com/dereknex/immune-brain/commit/5b2b9e4870f125acbdae1b159875d2a5d0afa098) Thanks [@dereknex](https://github.com/dereknex)! - A settled Initiative is no longer treated as a resume: `projectBatchPreflight` and `projectBatchDrift` now derive `is_resuming` once from the active batch record, so a fresh batch over a settled record issues the default 8h budget instead of inheriting an expired deadline from the old run (which made authorization impossible), while the settled record's children still replay from their own states instead of every child being reconstructed as `already_settled`.

- [`6c66311`](https://github.com/dereknex/immune-brain/commit/6c6631157ed70f7afeb278fec4961c87ed015710) Thanks [@dereknex](https://github.com/dereknex)! - Both Host adapters now call one shared authorization flow (`authorizeBatch` in `runtime/unattended/batch_preflight.ts`) after the shared preflight: the ADR-0005 reuse/expiry decision, the literal-user gate, the post-gate claim/drift cascade, and the `BatchAuthorizationBinding` construction live below the Host boundary. The Pi and Claude adapters keep only their own gate transport, confirmation reference, and failure-envelope shape, so a batch decision can no longer drift between the two Hosts.

- [`9180330`](https://github.com/dereknex/immune-brain/commit/9180330144529e7f34048cf721e1433f84a9ac1f) Thanks [@dereknex](https://github.com/dereknex)! - The non-interactive refusal in the Pi batch entry point lives in one helper the
  registered tool surface and the batch entry point both call, so the refusal text
  and its recovery hint cannot drift between them. The comment that described
  `isOwnBatchClaim` while sitting above an unrelated interface moves to the
  function's own definition in `runtime/unattended/batch_preflight.ts`, where it
  also records the evidence it checks and why `confirmation_time` is deliberately
  not part of it.

- [`fe9b2fe`](https://github.com/dereknex/immune-brain/commit/fe9b2fe5ced50188d7cc2c9e12f1bbe3403268c5) Thanks [@dereknex](https://github.com/dereknex)! - Two suites now prove behavior by running it. The batch-plan Spec-binding refusal
  is driven through `enrollCanaryTask` itself — for a child with no Spec path, one
  with a single declared half, and one whose two halves never pair — and asserted
  on the refusal the enrollment path returns, with no TaskRecord or claim written.
  The dual-host conformance scenarios that proved adapter routing by matching
  adapter source text now drive the real entry points: a cancelled breaking
  revision against a git that lies about `update-index` must surface the shared
  restore failure on both Hosts, and `request_authorization` on each Host must
  answer with the shared authorization derivation.

- [`3b7c31f`](https://github.com/dereknex/immune-brain/commit/3b7c31fb2d03ff2843189953b55c3c4ee458a178) Thanks [@dereknex](https://github.com/dereknex)! - ADR-0006 and ADR-0007 record the decisions they were drafted around instead of
  an open options list: the Review handoff stays a foreground obligation of the
  literal user's Host session and the runtime never dispatches or receipts a
  reviewer, and a parked child keeps its claim with no second record introduced.
  Both records carry `status: accepted`, and their unimplemented options move to
  rejected alternatives with the reasons that keep them rejected.

- [`5605ba6`](https://github.com/dereknex/immune-brain/commit/5605ba6c6d5725d165d7ab96ed39c87ec5d8140b) Thanks [@dereknex](https://github.com/dereknex)! - ADR-0009 records the accepted decision that the three settled Slices frozen on
  bun `1.3.14` — `wc-host-neutral-contract-tool-names`, `wc-behavioral-guardrails`,
  and `wc-batch-resume-single-gate` — permanently lose their frozen re-verification
  path once the host runner moved to `1.4.2`, which
  `runtime/assurance/verification.ts`'s `assertRunnerCompatible` now refuses. Their
  `1.3.14` descriptors stay as historical evidence, and protection for shipped
  Slices is `main`'s standing test suite rather than a re-openable frozen artifact.

- [`d5db962`](https://github.com/dereknex/immune-brain/commit/d5db962312f9283f17cde4066df35611e4fcce5f) Thanks [@dereknex](https://github.com/dereknex)! - The Claude Host pays for the post-settlement GitHub tracker projection only when
  the call actually settled its task. `withTerminalTracker` reads the Kernel
  identity the shared step needs through `settledKernelResult`, which admits the
  coordinator's `completed`/`stopped` outcomes and a committed `done`/`stopped`
  lifecycle, so an advance, review submission, or privileged mutation that leaves
  the task active no longer spends a full projection read on a tracker step that
  could not have marked anything.

- [`8ad09cb`](https://github.com/dereknex/immune-brain/commit/8ad09cba2ffac0fdf2f735694c42f463a5e8cc36) Thanks [@dereknex](https://github.com/dereknex)! - The Spec-binding refusal now names what the TaskIntent still has to add, and the
  Claude bundle is regenerated with it. `inspectSpecBinding`'s binding_missing
  fallback is reachable for the scope_hint shapes that declare Spec halves which
  never pair, and it returns those concrete unpaired paths instead of an empty
  `missing` and a generic message; the genuinely-empty case keeps its generic
  message because it has no path to name, and a complete pair carrying an unpaired
  half stays `binding_incomplete`. `batch_plan.ts` renders the paths of every
  refusal that carries them through one branch, so its unreachable
  `SPEC_BINDING_REASONS.binding_incomplete` entry is gone.

- [`146dd14`](https://github.com/dereknex/immune-brain/commit/146dd1442b3cd2c259d57fa7002f28ee4f1daf1b) Thanks [@dereknex](https://github.com/dereknex)! - The coverage retired with `tests/kernel-r2a-boundary.test.ts` has a named
  successor in `tests/kernel-shadow-cli.test.ts`: the unknown-command case now
  also exercises the literal `readiness --json` invocation, asserting the same
  `invalid_command` refusal with `.imm/state/workspace.json` left uncreated, and
  records that the retired top-level token deliberately appends no friction journal
  entry while the arbitrary unknown token still does.

- [`ab02218`](https://github.com/dereknex/immune-brain/commit/ab02218469926f49cdd4a2b6dee4e4580849d805) Thanks [@dereknex](https://github.com/dereknex)! - `noUnusedLocals` is enabled, so an unused import or local now fails
  `bun run typecheck` instead of surviving review, and the unused symbols it
  surfaced are gone: the orphaned imports S9/S13 left behind in the Claude port and
  both Pi extension entries, plus the pre-existing unused imports, constants, and
  locals in the rest of the runtime and scripts. Two removals keep the effect they
  had — the Claude enrollment call and the Kernel authority consume still run as
  statements — and the checked-in Claude bundle is regenerated.

- [`0f034bc`](https://github.com/dereknex/immune-brain/commit/0f034bca7b0be806a1e5b23503ca59620aa9cb0a) Thanks [@dereknex](https://github.com/dereknex)! - The superseded source-text guards are retired now that the behavioral guards cover the same regressions across both Host adapters. The batch worktree/push prohibition no longer scans runner sources for the words: a second behavioral leg drives the Pi and Claude batch entry points against a recording `git` and asserts neither adapter emits a mutating, `worktree`, or `push` vector, alongside the existing runtime leg. The v3-island suite drops its test-file-path coverage table in favour of the production import closure, and its retirement scans now cover `plugins/immune-brain/.pi-extension/` as well as `runtime/claude/`, asserted explicitly so neither adapter can fall out of scope.

- [`760d3ee`](https://github.com/dereknex/immune-brain/commit/760d3ee73abc05b947a406295e6c296dab44eada) Thanks [@dereknex](https://github.com/dereknex)! - The Claude Host's post-settlement GitHub tracker projection no longer runs inside the `authorize` try/catch that owns Kernel-mutation rollback: a projection failure that happens after `app.execute` has already committed can no longer restore the staged intent or rethrow an error a caller could read as "the mutation did not happen" and retry. The committed result is returned unchanged, with the tracker failure reported beside it as a retryable observation failure.

- [`be260b2`](https://github.com/dereknex/immune-brain/commit/be260b203a294dc58c62bb5e494ec76d215840d2) Thanks [@dereknex](https://github.com/dereknex)! - The packaged-contract tool-surface guard no longer passes silently when a contract names a Tool that no Host registers: a backticked name the contract itself spells as a `Tool`/`Operation` is now a failure when it resolves on zero Host surfaces, not only when it resolves on one. Its pre-change comparison also reads the actual pre-change contract text at test time (`git show aecf5dd^:<path>`) instead of a hardcoded paraphrase, so the case that proves the guard catches the HTN-2 regression cannot drift from what the guard really rejected.

## 3.6.9

### Patch Changes

- [`6e3f370`](https://github.com/dereknex/immune-brain/commit/6e3f3705971326d90c9149f9bd6d0287dbe87810) Thanks [@dereknex](https://github.com/dereknex)! - Publish readable GitHub tracker Issues: titles are composed from bounded Planner display names (`[<short_name>] <title>` for the Parent, `[<short_name>] S<n> <title>` for Children) instead of the full goal text, Children carry the repository's `ready-for-agent` and `blocked` labels while the Parent carries none, Issue bodies no longer repeat the title or the opt-in/Lifecycle/Authority stanzas, and a declared `projection.source_issue` renders a Provenance link.

- [`bc1b6f9`](https://github.com/dereknex/immune-brain/commit/bc1b6f90785871b7d585d329a501d94713943e5c) Thanks [@dereknex](https://github.com/dereknex)! - Add the public `imm-review-retro` Skill: rank models by the code review their own edits triggered and report basic project usage from pi session logs. Standalone host-native entry; no Managed Path or Kernel authority change.

## 3.6.8

### Patch Changes

- [`699ac64`](https://github.com/dereknex/immune-brain/commit/699ac64c4edee410f6b2e235680bb4382191da3f) Thanks [@dereknex](https://github.com/dereknex)! - Register the unattended batch tool in the Pi host extension manifest and document tracker issue slug extraction. The extension entry manifest (`plugins/immune-brain/.pi-extension/package.json`) now lists `./imm-unattended-batch.ts`, allowing Pi to discover and load `start_unattended_batch` for executing multi-task Initiatives after native confirmation. Also clarifies resolving an Initiative tracker issue to its `initiative_slug` in `dist/imm-loop.md`.

- [`923c0a9`](https://github.com/dereknex/immune-brain/commit/923c0a9463c52a533bbd04e10d80a8cf35f6abd5) Thanks [@dereknex](https://github.com/dereknex)! - Enhance the unified interaction UI with pipeline milestone progress, single-key authority decisions, and structured summary formatting. The Task Rail and task overview overlay now display pipeline milestone progress (`[1.Plan] ─ [2.Exec] ─ [3.QA] ─ [4.Review]`) across all lifecycle states. Authority dialogs highlight structured summary fields (Risk, Goal, Acceptance) and support single-key decisions (`y` to confirm/authorize, `n` to cancel/decline). Tool row results render micro-execution facts when present, terminal settlement outputs a clear Final Settlement summary card, and long file paths intelligently preserve the trailing filename during terminal width truncation.

## 3.6.7

### Patch Changes

- [#61](https://github.com/dereknex/immune-brain/pull/61) [`3a8070a`](https://github.com/dereknex/immune-brain/commit/3a8070a39f4629176a992956bb2f7fe3d8e960c6) Thanks [@dereknex](https://github.com/dereknex)! - Implement the Claude Code native Host confirmation gate for unattended batch runs (`start_unattended_batch`), fail-closed on non-interactive sessions with plan digest binding, zero writes on decline/cancel, and full lineage verification.

- [#61](https://github.com/dereknex/immune-brain/pull/61) [`df0c411`](https://github.com/dereknex/immune-brain/commit/df0c411555d4bd160b41f5f65c7fcecc7999fdd7) Thanks [@dereknex](https://github.com/dereknex)! - Add the Pi Host gate for unattended initiative batch runs and prove dual-host parity: the Pi extension now presents the Kernel-derived batch confirmation through its native TUI, issues the same Batch Authorization through the shared registry and `startBatch` driver, and a shared conformance test asserts both Hosts accept and refuse the identical batch identically.

- [#61](https://github.com/dereknex/immune-brain/pull/61) [`3905728`](https://github.com/dereknex/immune-brain/commit/39057280fc26449a2d2d6101c5aacf25a4b76cd5) Thanks [@dereknex](https://github.com/dereknex)! - Document unattended batch runs as a declared capability and repair the regressions that surfaced with them: `imm-loop`'s contract now names the `start_unattended_batch` opt-in and its limits, `IMMUNE.md`/`CONTEXT.md` carry the Batch Authorization, batch plan, plan digest, HEAD lineage and batch branch vocabulary plus the sole batch-state owners, ADR 0005 records the reopened decision, and per-host session isolation, the Pi Enrollment boundary, post-freeze intent resolution, the settled-child resume scope and the checked-in Claude bundle are back in line.

- [#62](https://github.com/dereknex/immune-brain/pull/62) [`a686673`](https://github.com/dereknex/immune-brain/commit/a68667385ec6c9322cd7eb5e6a3a341d327d91ec) Thanks [@dereknex](https://github.com/dereknex)! - Carry refuted Review findings as derived state with executable counterevidence: a Review rework finding now carries the reviewer's evidence and a Kernel-derived anchor, the new `refute_finding` operation is reachable from both Hosts and binds only a fresh passing QA attestation covering the finding's own acceptance, a re-submitted claim inherits the still-live refutation for its anchor instead of reopening as bare blocking work, and the refutation loses force — without rewriting stored state — as soon as its evidence goes stale for the current revision, intent hash or diff. The TaskRecord parse and append-only update invariants fail closed on anchor/evidence pairs that do not match, counterevidence no QA attestation backs, refuted user-decision or replan findings, and transitions that rewrite finding fields they do not own.

- [`e75c5e8`](https://github.com/dereknex/immune-brain/commit/e75c5e859e7464d5042d4c269ebc2c04e02e3cbe) Thanks [@dereknex](https://github.com/dereknex)! - Reduce Immune-Brain interference with unrelated Skills by removing Managed workflow explanations from the repository agent instructions.

## 3.6.6

### Patch Changes

- [`b1d8696`](https://github.com/dereknex/immune-brain/commit/b1d8696501fd7e97e5ce38132f43256a71cd6b65) Thanks [@dereknex](https://github.com/dereknex)! - Unattended batch runs: Git branch preflight and scope-bounded child commits

  Batch preflight now requires a clean tree (including untracked files and dirty
  submodules), a committed HEAD, a verified top-level repository root, and the
  absence of `imm/<initiative-slug>` before any state is written. Child commits
  are created only after Kernel settlement, staged strictly within the child's
  TaskIntent scope plus its audit directory, verified against branch/HEAD
  lineage and the committed tree delta, and backed by durable commit evidence so
  crash recovery can distinguish its own commits from forged external ones.
  Also fixes the bun runner resolution under mise/asdf shims.

## 3.6.5

### Patch Changes

- [#52](https://github.com/dereknex/immune-brain/pull/52) [`439658a`](https://github.com/dereknex/immune-brain/commit/439658abaaa1064fd570977a1c9d457a1f2054bf) Thanks [@dereknex](https://github.com/dereknex)! - Carry the assurance fixes found while running the first real batch

  Driving an enrolled batch through both Hosts surfaced five boundaries that
  stopped a task with no way forward:

  - A user can now authorize rework continuation directly, without escalating a
    routine rework to the reviewer.
  - A malformed Review receipt is recovered from durable evidence instead of
    pinning the task in a state no operation can leave.
  - The Claude Host exposes `resolve_finding`, so a closed finding on that Host no
    longer requires switching to Pi.
  - Published GitHub Issues carry their own public acceptance summary instead of
    the canonical TaskIntent assertion prose. The projected text stays within
    1–500 characters, and the input limit now accepts a summary that matches a
    canonical assertion length rather than rejecting the whole batch.

- [#52](https://github.com/dereknex/immune-brain/pull/52) [`439658a`](https://github.com/dereknex/immune-brain/commit/439658abaaa1064fd570977a1c9d457a1f2054bf) Thanks [@dereknex](https://github.com/dereknex)! - Stop a Managed task from Pi with one native confirmation

  Kernel already settled tasks on `stop`, but the Pi extension exposed no user
  reachable entry, so a task holding the workspace claim could not be released
  without editing `.imm` state by hand.

  `imm_kernel_canary` accepts `action: {op: request_stop}` for an eligible
  `active` or `frozen` task, including one waiting on Review or a replan gate.
  The Host opens one native confirmation, builds the stop authority itself, and
  the Kernel performs the existing stop settlement: terminal TaskRecord,
  terminal proof, archived planning artifacts and a released claim. Unrelated
  and implementation files are preserved.

  Cancelling, timing out, aborting, or closing the session before the commit
  mutates nothing, and a stop preparation failure releases the invocation so the
  same session can retry. Concurrent Assurance work and a snapshot that moved
  under the request are rejected rather than overwritten; a confirmed stop
  invalidates outstanding Review resources so a late verdict cannot rewrite
  terminal evidence. A delivery failure after the commit is reported separately
  and does not undo the stop.

- [#52](https://github.com/dereknex/immune-brain/pull/52) [`439658a`](https://github.com/dereknex/immune-brain/commit/439658abaaa1064fd570977a1c9d457a1f2054bf) Thanks [@dereknex](https://github.com/dereknex)! - Run one confirmed Initiative batch serially and resume it after a crash

  A confirmed batch plan had no executor that could survive an interruption: a
  child could be enrolled, settled and committed at three separate points, and
  restarting the run re-derived none of them.

  `startBatch` and `resumeBatch` now drive one eligible child at a time through
  enroll → advance → commit, and a resumed run adopts whatever the previous
  process had already persisted. Recovery shares the dependency-aware child
  selection rule with the normal loop instead of re-implementing it, so a
  reverse-ordered plan resumes identically to a forward-ordered one.

  Renewed authorization no longer loses the consumption history of children that
  were already committed. Before the next enrollment the driver verifies each
  committed child against the batch commit ledger, so a stale or fabricated
  `committed` flag cannot report a completed batch, and HEAD lineage stays
  enforced for the first enrollment of a fresh authorization.

  Persistence derives its path from a validated `batch_id` at every entrypoint,
  so a caller cannot escape `.imm/state/batches/`, and the replan gate keeps
  QA rework and Review rework on separate counters.

## 3.6.4

### Patch Changes

- [#39](https://github.com/dereknex/immune-brain/pull/39) [`5a14619`](https://github.com/dereknex/immune-brain/commit/5a14619ad8e2b383c5c99646d46b689e554c837b) Thanks [@dereknex](https://github.com/dereknex)! - Publish the full Review revision identity from the Claude Host

  `submitReview` re-derives the Review revision and compares `base_head`,
  `review_commit`, `review_tree` and `manifest_digest` against the reservation. The
  Claude Host adapter returned only the commit identity, so the last comparison put
  a real digest against `undefined` and every TaskRecord v4 submission stopped with
  `review_preparation_failed: Review revision changed before submission` — an
  unfalsifiable failure, because the revision it named had not moved. No Review
  could settle on that Host.

  The adapter now recomputes the manifest and republishes the same four fields the
  Review snapshot binds, using the outcomes of the settled QA attestation. The Pi
  adapter already recomputed the manifest but drew its outcomes from a preflight
  stand-in, which matched the settled attestation only because deterministic QA
  happens to write that exact summary; it now reads the attestation too, so both
  hosts agree by construction rather than by coincidence.

  Adds `tests/review-revision-identity-conformance.test.ts`, which drives a real
  repository and a real TaskRecord through `advance` and `submitReview`. A port
  double cannot express this defect, which is why the existing coordinator suites
  never saw it.

- [#40](https://github.com/dereknex/immune-brain/pull/40) [`934115b`](https://github.com/dereknex/immune-brain/commit/934115b9c3fb4cdce100321d8930209faa413297) Thanks [@dereknex](https://github.com/dereknex)! - Typecheck the repository and gate every pull request

  Four host-adapter defects reached published plugins in a row. The systemic cause
  was not any one of them: this repository had never been type checked, and no
  check ran before a merge.

  There was no `tsconfig.json`, no `tsc` invocation anywhere, and TypeScript was
  not even a dependency. Turning the compiler on reported 59 errors in the runtime
  and script sources, 17 of them (36%) in `runtime/claude/kernel_ports.ts` and
  `runtime/claude/review_host.ts` — the two files that produced three of the four
  escapes. The compiler was already pointing at the shipped defect family:
  `'{ review_revision?: … }' is not assignable to 'TaskApprovalV2'` and
  `Property 'git_base_head' does not exist on type 'TaskRecord'`.

  All 59 are fixed, none by widening to `any`. The substantive ones:

  - The Claude approval literal was untyped, so `kind` widened to `string` and
    every check on `review_revision` — the exact field family that shipped broken
    four times — was disabled. It is now a declared `TaskApprovalV2`.
  - Reading `git_base_head` off a `TaskRecord` union tested the contract string
    into a plain boolean, which does not narrow. Adds `isTaskRecordV4`, and both
    host adapters now prove the field is present before binding a revision.
  - `runtime/claude/review_host.ts` matched a reservation on `sessionId` and
    `agentId`, which `PendingReview` never declared; every check was inert and the
    function had no callers. Removed.
  - `commitEnrollmentLocked` was declared as returning a v2 record while returning
    a v4 one, and `JournalReasonCode` was missing the 13 codes the Kernel CLI
    actually emits.
  - A `TaskTombstone` could be written with `terminal_lifecycle: "active"`, which
    its own contract forbids; settlement now refuses a nonterminal record.
  - `failCanaryTool` could not report `review_preparation_failed`, a declared
    `ToolFailureV1` state and a documented Loop recovery path.
  - `notifyOnce` was called through a coordinator port that supplies no UI.

  Closes the type-level hole behind the last escape: `ReviewRevision.manifest_digest`
  was optional, so a host returning the bare commit identity still satisfied
  `ensureReviewRevision`. The bare identity is now a separate
  `ReviewRevisionCommit`, and omitting the digest fails the build instead of every
  v4 submission at runtime. Deletes the unused `ensureReviewRevision` export that
  defined the loose shape.

  Makes the production port wiring reachable from tests. `ClaudeRuntime.kernelPorts()`
  returns the object the coordinator actually runs on, and its `ports` option now
  layers overrides on top of it rather than replacing it wholesale; the Pi ports
  move out of an anonymous default export into
  `createPiAssuranceProgressionPorts`. Every escaped defect lived in these two
  objects, and neither was constructible from a test.

  Adds `.github/workflows/ci.yml` on `pull_request`, running typecheck, the
  plugin build and doc sync checks, versioning validation and `bun test`. Adds
  `bun run typecheck` and wires it into `verify:release`.

## 3.6.3

### Patch Changes

- [#37](https://github.com/dereknex/immune-brain/pull/37) [`89254ef`](https://github.com/dereknex/immune-brain/commit/89254ef60b07c3996624dc1b64831f406d931314) Thanks [@dereknex](https://github.com/dereknex)! - Settle Claude Host Review from the async Agent transcript

  The Claude Code Host reconstructed the Review receipt from the `Agent` tool's
  `PostToolUse` result, assuming that result was the reviewer's verdict. This
  Claude Code build runs every `Agent` call asynchronously — `run_in_background:
false` is not honoured and there is no synchronous mode — so the result is a
  launch receipt (`{"isAsync":true,"status":"async_launched",…}`) and never the
  verdict. No Review could be consumed on that Host.

  `inspectReview` now recognises the launch receipt, cross-checks the `agentId`
  against the `SubagentStart`/`SubagentStop` pair it already observed, and reads
  the reviewer's terminal message from the transcript the receipt names, matching
  the writing `agentId` per record. There is no fallback to Parent-supplied bytes:
  an unreadable or silent transcript fails closed, because an optional weaker path
  is one the Parent could force.

  A stale `SessionEnd` no longer discards live evidence. A resumed session reuses
  its id and hook log, so an end recorded for the previous run could sit ahead of
  the current run's events; draining cleared the whole log and stopped there. It
  now advances surviving reservations past the end — keeping pre-end events
  unusable — and reclaims the log only when nothing followed. `prepareReview`
  also drains before taking its cursors.

  Adds `tests/claude-review-host-async-agent.test.ts`, whose fixtures are recorded
  from Claude Code 2.1.261 rather than reconstructed from the documented shapes.

## 3.6.2

### Patch Changes

- [#35](https://github.com/dereknex/immune-brain/pull/35) [`0464612`](https://github.com/dereknex/immune-brain/commit/04646126c0ae3cbdf63663fb3f6b20240a74fdfc) Thanks [@dereknex](https://github.com/dereknex)! - Resolve packaged internal role prompts from the shipped bundle layout

  `loadRolePrompt` walked one directory up from the module that contains it and
  looked for `dist/role-prompts/`. That is correct from source, where the module
  sits in `runtime/` beside `dist/`, but the Claude Code Host loads the bundle at
  `dist/claude/mcp-server.mjs`, where the same walk computes a `dist/dist/` that
  never exists. Every internal role prompt therefore failed to load on the Claude
  Host, blocking Review delegation. The resolver now searches both layouts.

## 3.6.1

### Patch Changes

- [#33](https://github.com/dereknex/immune-brain/pull/33) [`2657d08`](https://github.com/dereknex/immune-brain/commit/2657d082052c7000d28b66eb51dcb671c3691489) Thanks [@dereknex](https://github.com/dereknex)! - Resolve the TaskIntent sidecar through the TaskRecord on the Claude Code Host.

  `freeze_artifacts` relocates `docs/plans/<task-id>.intent.json` into
  `docs/plans/archive/`, but the Claude adapter read every intent at the pre-freeze
  default path. Any Managed task therefore failed QA settlement with a raw `ENOENT`
  once its artifacts were frozen, which no test covered because every settled task
  in this repository had run on Pi.

  - `runtime/claude/kernel_ports.ts` now reads through `intent_ref.path` at all five
    call sites, matching the Pi adapter.
  - `runtime/kernel/intent.ts` resolves a path-less read to the sidecar that exists —
    active first, archive as the post-freeze fallback — and reports a missing sidecar
    as a stable contract failure instead of a raw filesystem error.
  - `runtime/assurance/coordinator.ts` proves a rejected ordinary mutation wrote
    nothing by re-reading the record revision, so a Kernel precondition rejection is
    reported as a deterministic failure rather than `settlement_unknown`, which the
    Loop would otherwise retry forever.
  - `dist/imm-loop.md` carries the Initiative carrier gate it actually performs, so a
    failed `publish-initiative` batch can no longer be cleared by re-entering the Loop.

## 3.6.0

### Minor Changes

- [`35a46f7`](https://github.com/dereknex/immune-brain/commit/35a46f7541ec413f51032a6d4f18b0d9ba831e24) Thanks [@dereknex](https://github.com/dereknex)! - Make Initiative carrier resolution host-portable and remove its silent default. Planner now reads the repository and user-level agent instruction files directly instead of assuming the Host injected `AGENTS.md` into context, so a configured carrier is no longer ignored on Hosts that auto-load `CLAUDE.md` or never read `~/.pi/agent/AGENTS.md`. When no valid directive is found, Planner asks and reports which sources it checked rather than silently resolving to `local` or `github`.

## 3.5.0

### Minor Changes

- [`75842d3`](https://github.com/dereknex/immune-brain/commit/75842d36c6c9cff625e29140cd512a6417e7344c) Thanks [@dereknex](https://github.com/dereknex)! - Deepen Task Rail acceptance-progress row with granular lifecycle phases and introduce the read-only `/imm-tasks` command and modal overview.

## 3.4.0

### Minor Changes

- [`6d7d645`](https://github.com/dereknex/immune-brain/commit/6d7d6457a03ff25bdbe82b36d2139c149527d952) Thanks [@dereknex](https://github.com/dereknex)! - Replace Claude permission-Hook authorization with digest-bound server-initiated MCP elicitation, make Managed authority guidance Host-neutral, and raise the verified Claude Code minimum to 2.1.236.

## 3.3.0

### Minor Changes

- [`e5e41ac`](https://github.com/dereknex/immune-brain/commit/e5e41ac9b43d2b367d3c88918d101eba3ee74a11) Thanks [@dereknex](https://github.com/dereknex)! - Retire the critical user approval gate from Kernel settlement. Fresh QA and any required Review now settle tasks automatically; the former critical-completion confirmation gate is removed, and `request_authorization` is reserved for unresolved user decisions and explicit stop. User authority stays bound to unresolved decisions, explicit stop, breaking Intent revisions, and concrete exception operations rather than risk tier alone.

## 3.2.2

### Patch Changes

- [`af66a62`](https://github.com/dereknex/immune-brain/commit/af66a62df426d84b2f51cbd2a9ae7216050a04e3) Thanks [@dereknex](https://github.com/dereknex)! - Slim public skill entry points to minimal canonical-contract loaders: imm-planner, imm-loop, and imm-agent-doc-maintain SKILL.md files no longer duplicate contract prose and instead identify and load their dist/ packaged contracts; contract tests and the dist sync manifest enforce the loader shape.

## 3.2.1

### Patch Changes

- [`f031290`](https://github.com/dereknex/immune-brain/commit/f031290002748d23b414e73ff063a3a0a1471b49) Thanks [@dereknex](https://github.com/dereknex)! - Use Changesets as the only version bump and publish entrypoint while retaining manifest synchronization and validation for the Claude Code plugin.

## 3.2.0

### Minor Changes

- [`32d6538`](https://github.com/dereknex/immune-brain/commit/32d6538330d794385f1294c2565b3edfc9e2a1c0) Thanks [@dereknex](https://github.com/dereknex)! - Replace incremental GitHub Initiative Issue creation with one complete publication batch.

  Planner now presents the full Parent/Child decomposition, granularity, dependencies, and execution order for one user decision before any remote mutation. After approval, `imm-tracker publish-initiative --stdin --json` validates every tracked TaskIntent and the complete dependency graph, idempotently publishes and verifies all native Issue relationships, links each Child to its Parent, and returns the recommended first Issue, stable order, and parallel groups.

  The former `create-initiative` and `upsert-task` CLI entrypoints are removed. Existing terminal Issue projection remains unchanged.

- [`dc76728`](https://github.com/dereknex/immune-brain/commit/dc767286cace89bc111b0984a1af0fdfd73c72d) Thanks [@dereknex](https://github.com/dereknex)! - Add `imm-agent-doc-maintain` as the sixth public standalone maintenance skill for agent-facing documentation upkeep.

## 3.0.1

### Patch Changes

- [`f0b99a0`](https://github.com/dereknex/immune-brain/commit/f0b99a0a2f1d4577f9e219aa023e6cb61e8fe8fc) Thanks [@dereknex](https://github.com/dereknex)! - Normalize JSON-string Tool action arguments before schema validation.

  `hyper/qwen3.8-flash` can emit the object-valued `action` argument of
  `imm_loop_action` and `imm_kernel_canary` as a JSON string
  (`action: "{\"op\":\"status\"}"`), which the strict TypeBox schemas previously
  rejected with repeated pre-execution failures. These Tools now recover exactly
  that observed shape through Pi's `prepareArguments` pre-validation hook: only a
  top-level `action` string that parses to a non-null, non-array object is
  recovered; native object input, invalid JSON, arrays, `null`, primitives, and
  all other malformed input still fail the unchanged strict schemas.

## 2.8.3

### Patch Changes

- [`61ccc29`](https://github.com/dereknex/immune-brain/commit/61ccc29c175edc29af7c485f795c8c33e4be8c1f) Thanks [@dereknex](https://github.com/dereknex)! - fix(tracker): avoid gh output limit exceeded by paginating snapshot and raising MAX_GH_OUTPUT

  - paginate GitHub Issues snapshot (100/page, up to 100 pages) instead of single --paginate --slurp blob
  - raise MAX_GH_OUTPUT 1MiB -> 8MiB to handle 65KB bodies without per-page overflow

## 2.2.0

### Removed

- The temporary Canary Slash Commands are removed from the Pi extension and npm package. Enrollment, assurance, authorization, interruption recovery, and successor state transitions no longer have command fallbacks or replacement aliases.

### Changed

- Repository mutation requests now enter Managed Path from natural language automatically. `imm-brainstorm`, `imm-planner`, and `imm-loop` remain the public workflow Skills.
- Enrollment and assurance continue through the foreground `imm_canary_enrollment` and `imm_kernel_canary` Tools with native TUI authorization and persistent Kernel `next_action` results.
