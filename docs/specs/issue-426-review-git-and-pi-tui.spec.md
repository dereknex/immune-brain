# Close the #426 third-round defects: reviewer git access and Pi Executor outside Herdr

**Status**: Candidate; no execution authority.
**Design risk**: High — it widens the claude-code reviewer's and verifier's
Bash permission allow-list (a trust boundary on untrusted model output) and
changes what the Lane supervision state machine does outside Herdr, in packaged
runtime that ships to three Hosts.
**Design views**: service/component interfaces (reviewer and verifier argv,
`superviseLane` result, batch report), state transitions (batch child and Lane
generation under the new refusal). Architecture layers, data flow and temporal
sequence are omitted: no layer, data path or call order changes.
**Document language**: English for this Spec, following Planner's default
document policy. The two `docs/reports/issue-426-*` files stay in Chinese, the
language they are written in.

## Outcome

After this change a claude-code reviewer and verifier can run the read-only git
commands the model actually emits, so a claude-code Review no longer ends
incomplete for lack of git (F10). A Lane whose Executor is Pi, outside Herdr,
is handed to the user at once with reason `lane_executor_requires_tui` instead
of spawning `pi --print` that can never settle (F9). The #426 report records
F8 as a test configuration error and the validation plan selects the reviewer
the supported way.

## Sources

Upstream Brainstorm manifest of 2026-11-12 (this session): BR-REQ-1..6,
BR-DEC-1..2, BR-OUT-1..3, BR-DEFER-1..2, BR-SCN-1..2. Evidence:
`docs/reports/issue-426-herdr-provider-probe.md` (third round) and
`~/imm-probe/evidence/v3/`.

## Threat model and supported environment

Input: the Bash commands a reviewer or verifier model emits while reading the
review packet. The model output is untrusted; the adversary is a reviewer that
tries to mutate the repository (commit, reset, checkout, push, config) or to
reach arbitrary shell through a git flag. The boundary is the claude CLI's
`--allowedTools` prefix rules under `--permission-mode dontAsk`; the claude CLI
splits compound commands and requires every part to be allowed, which this
design relies on and does not re-implement. Supported: macOS and Linux, claude
CLI 2.1.x prefix-rule semantics, SHA-1 and SHA-256 Git object formats. Pi and
antigravity reviewers follow their own Host configuration (review-cli-stage D9)
and are out of this threat model.

## Discovery evidence

- F10 root cause: the probe-m5 Lane `kernel.sqlite` records two
  `record_review_incomplete` rounds whose reason is "Bash is denied in dont-ask
  mode, so no git command could run", with `inspected_paths: []`.
- Allow-list: `plugins/immune-brain/runtime/assurance/cli_review.ts:49-58`
  (reviewer) and `:96-98` (verifier) allow only `Bash(git show:*)`,
  `git diff`, `git log`, `git cat-file`, `git rev-parse`, `git ls-tree`.
- Local probe on claude 2.1.322 with that allow-list: `git rev-parse HEAD`,
  `git rev-parse HEAD^@`, `git cat-file -p HEAD` and `cd X && git …` run;
  `git -C <path> …`, `git --no-pager log -1`, `git show HEAD | head -3` and
  `git diff … 2>/dev/null` are denied.
- Review instructions: `plugins/immune-brain/skills/authority-review/SKILL.md:12-13`,
  `plugins/immune-brain/runtime/prompts/code-review.md:8`,
  `plugins/immune-brain/runtime/prompts/review-verifier.md` ("using read-only
  Git commands"); `dist/role-prompts/*` are mirrors synced by
  `scripts/sync-dist-docs.ts` (`scripts/dist-sync-manifest.ts:66-80`). The
  packet carries `review_contract_hash` (`cli_review.ts:304-305`), so a prompt
  edit changes that hash.
- Existing argv tests: `tests/cli-review-dispatch.test.ts:326-345`.
- F9: `executorArguments` (`runtime/unattended/lane_supervisor.ts:22-36`) builds
  `pi --print "/skill:drive <task>"`; Kernel writes from Pi are TUI-only
  (`.pi-extension/imm-canary-work.ts:600-601`, ADR 0027 line 98), reproduced as
  `code=tui_required`. Both runtime supervision entries call `superviseLane`
  (`lane_supervisor.ts:192-230`): `superviseSingle` in
  `runtime/unattended/batch_runner.ts:214-264` and the decision relay in
  `runtime/unattended/lane_decision.ts:148-160`. Interactive (Herdr) mode never
  reaches them (`batch_runner.ts:269`, `lane_decision.ts:141`).
- `chooseExecutor` falls back to the Parent Host (`batch_runner.ts:222`), so a Pi
  Parent outside Herdr with no `executor_host` resolves Pi.
- Contract text: `plugins/immune-brain/dist/drive-batch.md:589-590` (spawns
  `pi --print`), `:373-381` (handoff to the user when no supervised session
  exists). Reason table: `runtime/unattended/batch_reasons.ts:16-66`, pinned by
  `tests/unattended-batch-run.test.ts:806-815`.
- Supervision tests: `tests/lane-supervisor.test.ts`,
  `tests/single-task-lane-batch.test.ts`, `tests/single-task-lane-decision.test.ts`.
- Derived outputs: `plugins/immune-brain/dist/claude/mcp-server.mjs` and the
  antigravity artifact, including `plugins/immune-brain-antigravity/runtime/**`
  and its `dist/role-prompts` (`docs/agents/derived-files.json`).
- F8: `dist/drive-batch.md:284-296`, ADR 0037 lines 41-43,
  `runtime/config/layered_config.ts:178-182`; the third round wrote the review
  keys into project config while an active user profile set `review_host`.
- Validation plan §7: `docs/reports/issue-426-local-validation-plan.md:242-268`.

## Decisions and technical design

### D1 — Reviewer allow-list adds `--no-pager` forms only (source: BR-REQ-1)

The claude-code reviewer and verifier argv allow exactly twelve Bash rules: the
six existing `Bash(git <sub>:*)` rules and the same six subcommands spelled
`Bash(git --no-pager <sub>:*)`. Both argv builders take the list from one
constant so they cannot drift. `--tools Read,Grep,Glob,Bash` and
`--permission-mode dontAsk` stay as they are. `git -C` is not allowed: a prefix
rule cannot bind the subcommand after `-C <path>`, so `Bash(git -C:*)` would
admit `git -C x commit`. Pipes and redirection are not allowed either: allowing
`head` or `2>` widens the boundary to non-git commands for formatting only. The
packet instruction (D2) steers the model away from those forms.

### D2 — Instruct plain cwd git (source: BR-REQ-1)

The `authority-review` skill, the `code-review` role prompt and the
`review-verifier` role prompt each tell the role to run one git command at a
time from the current working directory, without `-C`, pipes or redirection,
and to use `--no-pager` only as the first argument when needed. The
instruction is Host-neutral, so Pi and antigravity reviewers receive it too,
harmlessly. `dist/role-prompts` mirrors are regenerated. The resulting
`review_contract_hash` change is expected; any test that pins the old hash is
updated, not weakened.

### D3 — Mirrors through generation (source: BR-REQ-2)

The antigravity runtime and the Claude bundle are derived outputs; they are
regenerated with `scripts/build-antigravity-plugin.ts` and
`scripts/build-claude-plugin.ts`, never hand-edited.

### D4 — Pi Executor outside Herdr is refused before spawning (source: BR-REQ-3, BR-DEC-2)

`superviseLane` refuses to start a new generation when `choice.host` is `pi`:
it returns `{ state: "unavailable", generation: null, exit: null, reason:
"lane_executor_requires_tui" }` without calling `LaneSupervisor.run`, starting a
process, or writing the generation store. The refusal sits where a new
generation would start, after the existing early return for a Lane that is not
active, awaits the user or has an open user decision, so a Lane the user already
finished through interactive Pi is observed normally. A generation that is
already live from an older runtime is still observed, not refused. The
`claude-code` and `antigravity` paths are unchanged. No fallback to another
Executor Host (BR-DEC-2).

### D5 — Batch report hands the Lane to the user (source: BR-REQ-3)

`lane_executor_requires_tui` joins `BATCH_REASONS` as `blocked` with a recovery
action telling the user to open interactive pi in the Lane, run
`/skill:drive <task_id>`, and call `start_unattended_batch` again when it
finishes. `superviseSingle` on that reason keeps the child as it is (not parked
to `needs_human`), keeps the `executor` handoff with Lane path and `task_id` in
the report, and does not add a `lane_refusals` entry. The decision relay returns
the reason in `lane_relay.lane_supervision` unchanged. This follows the existing
"no supervised session" handoff at `dist/drive-batch.md:373-381`.

State transitions: before, `enrolled` → (two empty generations) →
`needs_human`/`lane_executor_no_progress`. After, `enrolled` stays `enrolled`;
generation store unchanged; the next `start_unattended_batch` re-observes the
Lane projection and either refuses again (still active, no progress) or
advances (Lane run finished in interactive pi).

### D6 — Contract text (source: BR-REQ-3)

`dist/drive-batch.md` "Synchronous runtime supervision outside Herdr" names only
`claude --print` and antigravity as spawned Executors and states that a Pi
Executor outside Herdr is reported with `lane_executor_requires_tui` and handed
off under the no-supervised-session rule.

### D7 — F8 stays; docs record it (source: BR-DEC-1, BR-REQ-4, BR-REQ-5)

No resolver change. The report's F8 rows become "non-defect: test configuration
error" with the ADR 0037 and `layered_config.ts` citations; F9 and F10 rows
record the root cause and the fix; the user's existing uncommitted edits to the
report are kept. Validation plan §7 puts the review keys into an active user
lane profile (`lanes.profiles.<name>` plus `lanes.active`) or the request, not
into `.imm/config.json`.

### False-compromise check

The accepted trade-off is that the reviewer cannot use pipes, redirection or
`-C`, which the model sometimes prefers. Intermediary (a wrapper script exposing
only read-only git) would remove it at the cost of a new shipped executable and
its own argument-parsing attack surface; Preliminary Action (the instruction in
D2) removes most of it at no cost. No false compromise detected: the residual
cost is a retried command, and the boundary stays a pure prefix allow-list.

## User scenarios

- **BR-SCN-1** — Actor: operator. Given: a batch whose `review_host` is
  claude-code. When: the Review stage runs. Then: the review result shows
  non-empty inspected paths and a verdict, not an incomplete review citing
  denied Bash. Mode: `manual` — it needs a live claude model run, which is the
  deferred live re-run (BR-DEFER-1); A1 and A2 cover the argv and instruction
  automatically.
- **BR-SCN-2** — Actor: operator. Given: a Lane with `executor_host` pi, started
  outside Herdr. When: the Lane starts. Then: the operator immediately sees
  reason `lane_executor_requires_tui` with the Lane path and the `drive` command
  to continue in interactive pi, instead of a later `lane_executor_no_progress`.
  Mode: `automated` — A4.

## Acceptance and verification mapping

| ID | Seam | Done looks like |
| --- | --- | --- |
| A1 | `tests/cli-review-dispatch.test.ts` (argv builders) | claude-code reviewer and verifier argv list the twelve rules; no `-C` or non-git rule |
| A2 | `tests/cli-review-dispatch.test.ts`, `scripts/sync-dist-docs.ts --check` | the three instructions name plain cwd git; mirrors in sync |
| A3 | `tests/lane-supervisor.test.ts` (`superviseLane`) | Pi choice returns `lane_executor_requires_tui`, no process |
| A4 | `tests/single-task-lane-batch.test.ts`, `tests/single-task-lane-decision.test.ts`, `tests/unattended-batch-run.test.ts` | batch report carries the reason, handoff and recovery; child not parked |
| A5 | `tests/unattended-contracts.test.ts`, `tests/claude-host-package.test.ts`, `tests/antigravity-host-package.test.ts` | contract text updated; generated outputs match source |
| A6 | grep over the two report files | F8/F9/F10 rows and §7 updated |

## Devil's Advocate Audit

- **Rollback resilience**: the change is code plus docs in one commit; reverting
  it restores the previous allow-list and supervision. No persisted shape
  changes: the new reason is a report value, the batch record is left as it
  was, and the generation store is not written on refusal. A partial
  implementation (allow-list done, supervision not) still leaves every test of
  the untouched half passing, and QA fails the missing acceptance.
- **Verification vanity**: A1 asserts the exact rule set, so adding `git -C` or
  a non-git rule fails it; A2 is textual and does not prove a model obeys, which
  is why BR-SCN-1 stays manual. A3 uses a supervisor double that fails the test
  if `run` is called, and a claude-code control proves the refusal is
  Pi-specific. A4 checks the child state, so parking to `needs_human` fails it.
- **Spec dilution detection**: every BR item maps in the Brainstorm Trace below;
  A1–A6 cover BR-REQ-1..6; nothing confirmed is reduced to a smaller
  deliverable.

## Brainstorm Trace

| BR item | Disposition |
| --- | --- |
| BR-REQ-1 | A1, A2 (D1, D2) |
| BR-REQ-2 | A5 (D3) |
| BR-REQ-3 | A3, A4, A5 (D4, D5, D6) |
| BR-REQ-4 | A6 (D7) |
| BR-REQ-5 | A6 (D7) |
| BR-REQ-6 | A1–A5 seams |
| BR-DEC-1 | D7 decision; no resolver change |
| BR-DEC-2 | D4 decision; no print-mode credential, no host fallback |
| BR-OUT-1 | Out: F1 login prompt not reported as `blocked` (upstream) |
| BR-OUT-2 | Out: `checkout_delivery_overlap` (delivery constraint) |
| BR-OUT-3 | Out: Parent behaviour drift |
| BR-DEFER-1 | Deferred: live S3 and S4-b re-run in Herdr after merge |
| BR-DEFER-2 | Deferred: claude-code and antigravity Executor settlement outside Herdr |
| BR-SCN-1 | manual (live model run, BR-DEFER-1) |
| BR-SCN-2 | automated → A4 |

## Decomposition

One TaskIntent. Only D1 changes a trust boundary; D4 tightens behaviour on an
existing one. The two fixes share the report rows, the release changeset and one
live re-run, and neither needs independent authorization or migration.
