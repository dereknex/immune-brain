# Branch boundary with frozen acceptance

**Status**: candidate decomposition for Round 1, pending the user's single decomposition confirmation before GitHub publication. This document grants no execution authority.
**Initiative name**: Batch unblock (Round 1 of Branch boundary)
**Immutable slug**: `batch-unblock`
**Carrier**: GitHub, selected by root `CLAUDE.md` (`Initiative carrier default: github`).
**Planning baseline**: `7c42f40`; recheck affected paths if HEAD changes before Enrollment.
**Document language**: English; user discussion remains Chinese.
**Design risk**: High — the batch authorization subject changes from the whole TaskIntent to a frozen authority subject, intent revision classification tightens, and the Claude MCP server gains a refusal ahead of the run-entry gate.
**Execution posture**: characterization-first for S3: pin today's revision-only and scope-only drift behavior at the batch seams before changing it.
**Design views**: component interfaces, state transitions.
**Threat model and supported environment**: the adversary is the executing model, which may revise a child's intent mid-batch to make QA pass against weaker acceptance or a different command. The user, the Host process and the local filesystem owner are trusted. A stale MCP server is a fault, not an adversary. Supported: Claude Code with the plugin hooks installed, Pi with the bundled extension, macOS and Linux, Bun 1.4.

## Outcome

The long-term direction: the user types one Parent `imm-run` and confirms one batch gate; children are implemented concurrently on their own branches, settle, integrate through merge-queue semantics and pass final verification, stopping for the user only on a change to a goal, acceptance or verification command, on a design-class rework, or on push, PR and credentials. Authority is the frozen acceptance plus the branch, not the whole intent.

Round 1 (this Initiative) removes the three blockers that stop that direction from running at all: concurrent focused QA no longer times out, a stale MCP server reports itself instead of a misleading `run_entry_required`, and a batch survives a child's scope-only revision while a change to frozen acceptance parks only that child. Round 2 is planned after Round 1 lands (see Round 2 outline).

## Sources

No Brainstorm manifest exists. Decisions were confirmed in the grill session of 2026-10-18 (Q1–Q20′, every recommendation accepted, direction confirmed) and are recorded as Spec-local sources.

| Source | Evidence or decision |
| --- | --- |
| U1 | Q1 C: generic runtime and contract mechanisms; this repository is the first adopter and also fixes its own test isolation. Q3 A: Planner unchanged. |
| U2 | Q2: closure means one Parent entry and one batch gate; stops only for goal/acceptance/command changes, design-class rework, push/PR/credentials. Accepted by a real Initiative run (≥3 children, ≥2 concurrent), with automated tests as each Slice's acceptance. |
| U3 | Direction "branch boundary with frozen acceptance": the authority subject is goal, acceptance and verification command; `scope_hint` and implementation notes are working documents; a change to the subject pauses only that child. |
| U4 | Q18 B: a descriptor's executable, argv (including the test file list) and `cwd` are frozen; `timeout_ms` and environment preparation are run parameters the Executor may change with disclosure. |
| U5 | Q6′ C: this repository adds a wider default per-test timeout and reuses a template Git repository in batch-authority fixtures; per-Slice QA runs focused tests only and the full regression runs once at Parent final verification. |
| U6 | Q16 A: a stale bundle is detected and reported with an explicit recovery action; Lane start checks the loaded plugin build. |
| U7 | Q20′ A: two rounds. Round 1 is test isolation, authority-subject narrowing and the bundle handshake, run on today's serial mechanism; Round 2 is everything else in one Initiative that is also the acceptance run. |
| U8 | Q19 B: the Parent branch returns to main by Git integration preference: `manual` stops with a final report; `auto` fast-forwards when possible. |
| U9 | Q7 A, Q12 A, Q13, Q8 A, Q10 B, Q11 A+C, Q14 A, Q15 C: optimistic concurrency with merge-queue integration, regeneration of derived files after merge, Spec/ADR read-only during execution, worktree isolation, hard no-touch paths, per-child pause on breaking revision, design-class rework defined as needing an acceptance or goal change. |
| E1 | `runtime/kernel/batch_authority.ts:108` `computeBatchPlanDigest` hashes each child's `intent_content_hash` and `intent_revision`; `:361-369` refuses `batch_child_intent_changed` on any byte change. |
| E2 | `runtime/kernel/intent.ts:264` `canonicalIntentHash` covers the whole intent, including `scope_hint`, `revision` and the full descriptor bytes (`timeout_ms`, `environment`). |
| E3 | `runtime/kernel/intent.ts:367` `classifyIntentRevision` treats a descriptor-only change and an added acceptance item as compatible. |
| E4 | `runtime/unattended/batch_preflight.ts:974`, `:993`, `:1001`; `batch_runner.ts:414`, `:499`; `batch_lanes.ts:674-709`, `:784` fail the whole batch with `plan_changed` or `plan_digest mismatch` on any child drift. In the source session 4 of 5 Tasks revised their intent mid-run, each adding same-directory test files only. |
| E5 | `runtime/kernel/spec_binding.ts:31` derives the bound Spec from `docs/specs/*.spec.md` entries in `scope_hint`. |
| E6 | `tests/pi-batch-authority.test.ts:271` and `tests/claude-batch-authority.test.ts:211` run six `git` subprocesses per fixture, about 35 and 48 fixtures; no `bunfig.toml` exists, so Bun's 5000 ms per-test default applies and concurrent runs exceeded it. |
| E7 | `hooks/hooks.json` runs every hook as a fresh `node dist/claude/mcp-server.mjs --hook`, while `.mcp.json` keeps one long-lived server process; after a runtime commit the server ran the old bundle and refused with `run_entry_required` (`runtime/claude/mcp_server.ts:178-192`) until `/mcp` reconnected it. |
| E8 | `runtime/plugin_source_skew.ts` already detects a loaded plugin build that differs from the workspace plugin, but only as a `status` warning (`runtime/assurance/coordinator.ts:410`). |

## User scenarios

| ID | Actor | Given | When | Then | Mode | Slice |
| --- | --- | --- | --- | --- | --- | --- |
| SCN-1 | maintainer | several focused test files run at the same time under load | a fixture-heavy test takes longer than 5 s | it passes under the wider default timeout, and an explicit shorter per-test timeout still fails | automated | S1 |
| SCN-2 | Claude user | a run committed a runtime change that regenerated the bundle | the next authority tool call reaches the long-lived MCP server | it is refused as `plugin_bundle_stale` with the reconnect action instead of `run_entry_required` | automated | S2 |
| SCN-3 | user | a running batch | a child adds a same-directory test file to its `scope_hint` | the batch continues with no new entry or gate | automated | S3 |
| SCN-4 | user | a running batch | a child's acceptance or verification command changes | only that child and its dependents stop; independent children finish | automated | S3 |

## Decisions

| ID | Decision | Source |
| --- | --- | --- |
| D1 | This repository's tests run under a default per-test timeout of 30000 ms set once for every `bun test` invocation; an explicit per-test timeout still overrides it. | U5, E6 |
| D2 | `pi-batch-authority` and `claude-batch-authority` create fixtures by copying one template repository initialized once per test process into a fresh `mkdtemp` directory; the template holds no worktrees, and per-fixture plan files are still written per copy. | U5, E6 |
| D3 | The Claude MCP server records the identity of its own bundle file at startup. Before any phase-gated or Kernel-mutating tool, it compares that identity with the file now on disk; a difference refuses with `plugin_bundle_stale` and a `recovery_action` to reconnect the immune-brain MCP server, ahead of `run_entry_required`, before consuming an admission and with no Kernel mutation. `status` still answers and carries the warning. | U6, E7 |
| D4 | A Lane-mode batch start refuses with `batch_runtime_contract_mismatch` when `pluginSourceSkewWarning` reports that the coordinator's loaded plugin build differs from the workspace plugin, because Lane Executors on the same Host load that same build. | U6, E8 |
| D5 | A TaskIntent's authority subject is `contract`, `task_id`, `goal`, `owner`, the bound Spec path, and every acceptance item's `id`, `assertion` and descriptor `command.executable`, `command.argv` and `command.cwd`. `scope_hint` (other than the Spec binding), `revision`, `risk`, `timeout_ms`, `max_output_bytes` and `environment` are outside it. | U3, U4, E2, E5 |
| D6 | `classifyIntentRevision` classifies a change to any descriptor executable, argv or `cwd`, and any added acceptance item, as breaking; a change to only run parameters stays compatible. Every other rule is unchanged. | U4, E3 |
| D7 | Batch plan digest, child enrollment identity, drift checks, reconfirmation, delegated reseal and delivery checks bind the authority subject instead of the whole intent. The single-task TaskRecord, Review and QA snapshots keep binding the full content hash. | U3, E1, E4 |
| D8 | When one child's live authority subject differs from its authorized one, the runner parks that child with `batch_child_authority_changed` and skips its dependents as `skipped_blocked`; other children continue and the batch terminates normally. A plan whose child set, order or dependencies changed still fails as `plan_changed`. | U3, U9, E4 |
| D9 | A batch record without the authority-subject field (written before this change) keeps today's whole-intent comparison; nothing is migrated. | delegated (T2) |
| D10 | ADR 0026 records the direction, amends ADR 0005 (batch binds the authority subject) and ADR 0019's Enrollment identity only for batch children, and names ADR 0018 and ADR 0021 for supersession when Round 2 removes delegated reseal and scope envelopes. | U3, U7 |

Delegated technical choices:

| ID | Choice | Reason |
| --- | --- | --- |
| T1 | `risk` is outside the authority subject. | Raising risk only strengthens Review; lowering it is already breaking and needs the user's approval. |
| T2 | Legacy batch records keep whole-intent comparison. | No batch is active at the planning baseline; a reader-side fallback avoids a migration. |
| T3 | The bundle identity is the SHA-256 of the server's own module file, re-read only after a cheap size and mtime check changes. | The bundle is the only build proxy that moves during development (E8). |
| T4 | Pi's stale extension is out of Round 1. | The observed failure was Claude's long-lived server; Pi reloads its extension per session. |

## Technical Design

### Component interfaces

- `runtime/kernel/intent.ts`: new `intentAuthoritySubject(intent)` and `intentAuthorityHash(intent)`; `classifyIntentRevision` gains the D6 rules. Callers: batch modules only, plus classification through `reducer.ts`.
- `runtime/unattended/types.ts` and `batch_state.ts`: each batch child record gains `intent_authority_hash`; readers fall back per D9.
- `runtime/kernel/batch_authority.ts`, `runtime/unattended/{batch_plan,batch_preflight,batch_runner,batch_lanes,batch_reconfirmation,batch_delegation,batch_git,batch_disposition}.ts`: bind and compare the authority hash; the runner and Lane tick compare per child (D8).
- `runtime/claude/mcp_server.ts`: bundle identity at startup and a staleness check ahead of `requireRunEntry`; new reason code `plugin_bundle_stale` with its `recovery_action` in `runtime/claude/interaction.ts`.
- `runtime/unattended/batch_lanes.ts` `laneRuntimeContractRefusal`: also refuses on a loaded-plugin skew (D4).
- `bunfig.toml` with a test preload, and `tests/helpers/git-template.ts`.

### State transitions

A batch child: `pending → enrolled → done` as today. New: at each tick, `pending | enrolled` with a changed authority hash → `parked` (`batch_child_authority_changed`); its dependents → `skipped_blocked`. A scope-only revision causes no transition. The batch reaches its terminal state from the remaining children; only a change to the child set, order or dependencies still ends it as `plan_changed`.

## Devil's Advocate Audit

- **Rollback resilience**: each Slice is one bounded commit. Reverting S3 restores whole-intent binding; batch records written by S3 carry an extra field that the old reader ignores. Reverting S2 removes one refusal ahead of the run-entry gate. S1 touches tests and test config only.
- **Verification vanity**: S3 pins each excluded field (scope, revision, timeout, environment) and each included field (goal, assertion, argv, cwd, executable, added acceptance, Spec path) at the hash seam, and pins the batch-level outcome in both runners and Lanes, so a hash that silently ignores argv would fail. S2 pins precedence over `run_entry_required` and that no admission is consumed. S1 pins both the wider default and that an explicit shorter timeout still fails.
- **Spec dilution**: Round 1 does not deliver concurrency, merge-queue integration or branch-based runs; they stay in Round 2 and the Parent records the gap. Frozen acceptance is tightened, not relaxed (D6).

## Slices and acceptance mapping

| Slice | Task | Result when landed alone | Acceptance seams | Risk | Blocked by |
| --- | --- | --- | --- | --- | --- |
| S1 | `test-timeout-isolation` | Focused test files pass under concurrent load; batch-authority fixtures spawn one `git init` per process instead of per test | `tests/test-runtime-config.test.ts` (new), `tests/git-template.test.ts` (new), `tests/pi-batch-authority.test.ts`, `tests/claude-batch-authority.test.ts` | routine | — |
| S2 | `plugin-bundle-staleness` | A stale MCP server reports `plugin_bundle_stale` with a reconnect action; a skewed Lane start is refused | `tests/claude-bundle-staleness.test.ts` (new), `tests/claude-phase-entry-gate.test.ts`, `tests/unattended-batch-lanes.test.ts` | material | S1 |
| S3 | `batch-authority-subject` | A batch survives scope-only revisions and parks only a child whose frozen acceptance changed | `tests/kernel-intent-v2.test.ts`, `tests/kernel-batch-authority.test.ts`, `tests/unattended-batch-run.test.ts`, `tests/unattended-batch-lanes.test.ts`, `tests/batch-plan-reconfirmation.test.ts`, `tests/batch-delegation-gate.test.ts`, `tests/pi-batch-authority.test.ts`, `tests/claude-batch-authority.test.ts` | critical | S2 |

## Round 2 outline (not part of this Initiative)

One Initiative, also the U2 acceptance run: Parent branch and merge-queue integration (first, serial); serial runner removed (serial is Lane `max_parallel` 1); derived files regenerated after merge with `--check`; hard no-touch paths; risk from the actual diff; single-task mode on a task branch from a clean workspace; remaining scope envelope, delegated revision and reseal removed (supersedes ADR 0018 and 0021); final report and return to main by Git integration preference; carried-over items: Pi stall yield, final-verification confirmation reference, tighter `claude-run-continuation` third-failure assertion, `start_unattended_batch` handler end-to-end test, and the stale first sentence of Issue #264.

## Discovery evidence

- Authority hash consumers: `runtime/kernel/batch_authority.ts:108,185,361`; `runtime/unattended/batch_plan.ts:176-232`; `batch_preflight.ts:360,470-523,551,924,974,993,1001`; `batch_runner.ts:414,494-499`; `batch_lanes.ts:512-552,674-709,784,969`; `batch_reconfirmation.ts:118-155,196`; `batch_delegation.ts:74,108,133,155`; `batch_git.ts:871-875,947,1058`; `batch_disposition.ts:214`; `batch_state.ts:187-189,646-660,791-792`; `types.ts:17-18,48-49`.
- Revision classification: `runtime/kernel/intent.ts:367`, called from `runtime/kernel/reducer.ts:492-507`.
- Run-entry refusal and admissions: `runtime/claude/mcp_server.ts:170-192,352`; `runtime/claude/lane_guard.ts:94-100,234`; `runtime/claude/interaction.ts:23,40-42`.
- Generated bundle: `scripts/build-claude-plugin.ts` regenerates `plugins/immune-brain/dist/claude/mcp-server.mjs`; every runtime Slice includes it and a changeset.
- Test fixtures and timeouts: `tests/pi-batch-authority.test.ts:271,296`; `tests/claude-batch-authority.test.ts:211,222`; existing `setDefaultTimeout` in `tests/v4-runtime-launchers.test.ts:52` and `tests/pi-canary-work-extension.test.ts:8`; timing assertions that rely on internal timeouts only (`tests/task-record-durability.test.ts:462`, `tests/batch-retro-201.test.ts:83`).

## Out of scope

Round 2 items above; Planner changes; Pi extension staleness (T4); push, PR and release.
