# Revisit multi-host session evidence

**Status**: Candidate; no execution authority.
**Task ID**: `revisit-multi-host-session-evidence`.
**Design risk**: Medium — a single Skill script gains two additional transcript readers and an additive change to the `immune-brain/revisit_evidence/v2` machine contract; no Kernel, record, writer, or authority behavior changes.
**Design views**: architecture layers (source discovery → per-host line mapping → one normalized event stream → existing counters and report), data flow (host transcript → normalized `SessionEvent` → counters/report, with no derived metric added).
**Document language**: English.

## Outcome

`revisit`'s session report reads every supported Host — Pi, Claude Code, Antigravity CLI — instead of Pi only, so a Lane or batch that ran on a non-Pi Host is no longer invisible to a workflow-health retro. Counting rules, the report shape and `--audit` are unchanged; the only data-contract change is an additive `host` field on `immune-brain/revisit_evidence/v2` entries.

Slices: one TaskIntent, because discovery, the three readers, the report header and the contract text share one acceptance, one rollback (revert the script and the mirror), and one settlement boundary.

| Slice | Observable when it alone has landed | Remaining gap after it |
|---|---|---|
| `revisit-multi-host-session-evidence` | Running the analyzer on a machine with Claude Code or Antigravity CLI transcripts reports their sessions, findings and rounds next to Pi's, with one `host:` line per scanned tree | Antigravity GUI store (protobuf SQLite), per-host split columns, snapshot/diff |

## Sources

- Upstream Brainstorm manifest (`clarify`, 2026-11-14): `BR-REQ-1`, `BR-REQ-2`, `BR-DEC-1`…`BR-DEC-5`, `BR-OUT-1`, `BR-OUT-2`, `BR-DEFER-1`, `BR-SCN-1`.
- Repository evidence:
  - `plugins/immune-brain/skills/revisit/scripts/review_retro.ts:62` — default root hardcoded to `~/.pi/agent/sessions`; `--root` is the only tree input.
  - `plugins/immune-brain/skills/revisit/scripts/session_evidence.ts:47-52` — `readSession` keys off the Pi header `type:"session"` and `message.role`; nothing else is parsed.
  - `docs/specs/revisit-workflow-health.spec.md` Follow-up — "Claude Code session reader (#322-D5)" is the recorded predecessor gap; Antigravity was never named.
  - `CONTEXT.md:267-268` — the three supported Host adapters: `runtime/claude/`, `runtime/antigravity/`, Pi `.pi-extension/`.
  - Probe (read-only, 2026-11-14): `~/.claude/projects/<slug>/<session>.jsonl` carries `type`, `cwd`, `sessionId`, `timestamp`, `message.content[]` with `tool_use`/`tool_result`; kernel ops appear as `mcp__plugin_immune-brain_immune-brain__<op>`; edit tools are `Edit`/`Write`; review dispatch is `Agent`.
  - Probe (read-only, 2026-11-14): `~/.gemini/antigravity-cli/brain/<id>/.system_generated/logs/transcript_full.jsonl` carries `type` (`USER_INPUT`/`PLANNER_RESPONSE`/`GENERIC`), `created_at`, `tool_calls[]` with `{name, args}`; kernel ops appear as `call_mcp_tool` with `ServerName`/`ToolName`/`Arguments` (203 occurrences of `immune-brain_immune-brain` in the sampled 400 transcripts); the transcript carries no cwd, while `~/.gemini/antigravity-cli/cache/conversation_metadata.json` carries `conversations[<id>].summary.WorkspaceURIs`.
  - Probe (read-only, 2026-11-14): `~/.gemini/antigravity/conversations/*.db` stores `steps.step_payload` as a protobuf blob, not JSON.
  - `plugins/immune-brain/dist/revisit.md` is the authoring source and `skills/revisit/SKILL.md` is a loader whose link anchors must stay resolvable (`tests/skill-dist-consistency.test.ts`).
  - `scripts/build-antigravity-plugin.ts:163` — the whole `skills/` tree is copied into the Antigravity package, so no inventory file needs a manual entry for a changed script.

## Threat model and supported environment

Inputs are the user's own Host transcripts: Pi JSONL under `~/.pi/agent/sessions`, Claude Code JSONL under `~/.claude/projects`, Antigravity CLI JSONL under `~/.gemini/antigravity-cli/brain`. No hostile adversary; handled cases are malformed or truncated lines, missing timestamps, unknown tool names, an absent `conversation_metadata.json`, and a conversation id absent from that metadata. Supported: Bun as the analyzer runtime; macOS and Linux; the transcript schemas observed in the probes above. An input outside them (Antigravity GUI protobuf store, a Host whose transcript shape changed) is out of scope and reported as unknown rather than parsed speculatively.

## Decisions

**D1 — One host layer, three readers, one normalized stream** (source: `BR-REQ-1`, repository evidence `session_evidence.ts:47`). Discovery returns `{host, root, layout}` for each scanned tree; each reader maps its own lines into the existing `SessionEvent` union. `readSession` keeps its current Pi signature so existing callers and tests keep working; the new readers are `readClaudeSession` and `readAntigravitySession`, selected by one dispatcher. Counters, candidate chains, report sections and `--audit` are untouched.

**D2 — Default scope is auto-detected; `--root` means Pin-this-tree** (source: `BR-DEC-2`). With no `--host` and no `--root`, every existing standard root is scanned and the report header prints one `host: <name> <root> sessions=<n>` line per tree. `--host <pi|claude|antigravity>` (repeatable) restricts the scan. `--root <dir>` alone keeps meaning "this Pi tree, nothing else", which is also what the existing fixture tests rely on; `--root` with more than one `--host` value is a usage error. Discovery is a pure exported function of `(args, home)` so the default-scope rule is testable without touching the real home directory.

**D3 — Kernel ops normalize to one vocabulary across Hosts** (source: delegated technical choice, evidence: both probes). Claude `mcp__…__<op>` and Antigravity `call_mcp_tool` with `ServerName` starting `immune-brain` and a `ToolName` in the Kernel op set both normalize to `name: "imm_kernel_canary"`, `op: "<op>"` with the parsed arguments as the event payload, so rework, resumption and registration logic stays identical across Hosts. Antigravity `Arguments` is a Python-repr string; it is parsed by a bounded reader (single quotes, `True`/`False`/`None`) and an unparsable value yields the event with no arguments instead of failing the run. Antigravity's `invoke_subagent` is not counted as a review dispatch; that limitation is recorded in the contract, because the sampled transcripts do not identify a review role reliably.

**D4 — Author attribution per Host** (source: delegated technical choice, evidence: probes). Pi keeps `edit|write|multiedit|apply_patch`; Claude adds `Edit|Write|MultiEdit`; Antigravity adds `edit_file|write_file|replace_file_content|write_to_file`. The `author` field keeps its meaning and ranking stays absent.

**D5 — Antigravity session cwd comes from conversation metadata** (source: `BR-DEC-3`). The cwd is `conversations[<id>].summary.WorkspaceURIs[0]` with a `file://` prefix stripped; a missing metadata file or a missing id yields `unknown`, and `--project`/`--exclude` then simply do not match that session. No second cwd source is invented.

**D6 — The evidence contract stays v2 with an additive field** (source: `BR-DEC-4`). Every `sessions[]` entry and every `events[]` entry gains `host`, and `scope` gains the resolved `hosts` list. No field is removed or renamed, and a report without non-Pi hosts is text-identical to today's apart from its host header.

**D7 — Docs and mirrors follow in the same Slice** (source: `BR-REQ-2`, repository evidence `tests/skill-dist-consistency.test.ts`, `scripts/build-antigravity-plugin.ts:163`). `dist/revisit.md`, its loader, `CONTEXT.md`, `README.md` and the stale `docs/user_manual.md` line name the three Hosts; the Antigravity package mirror is regenerated, never hand-edited.

## Assumptions

- Claude Code tool-result blocks live inside `user` entries, so a user entry that carries only `tool_result` blocks is a tool result, not human input; only text content counts as a user input.
- Antigravity renders tool output in `GENERIC` steps, which carry no call id; a tool result is therefore not joined to its call there, and the report never claims a joined result for that Host.
- One transcript file remains one session on every Host.

## Verification and acceptance

Agreed seams: `tests/review-retro-analyzer.test.ts` extended in place (observable boundary: the analyzer's text report and its exported readers), plus the existing contract seams `tests/skill-dist-consistency.test.ts` and `scripts/build-antigravity-plugin.ts --check`. New fixtures: `tests/fixtures/review-retro-claude/`, `tests/fixtures/review-retro-antigravity/`.

| ID | Assertion | Done looks like | Scenario |
|---|---|---|---|
| AC1 | `resolveHosts({hosts: [], root: ""}, fakeHome)` over a fake home containing all three standard trees returns Pi, Claude and Antigravity with their roots; an empty fake home returns an empty list; `--host claude --root <dir>` resolves exactly one entry. | A maintainer sees which trees a run will scan before it scans them. | `BR-SCN-1` |
| AC2 | Reading the Claude fixture yields one registration for its task, its blocking finding, one edit author and one review dispatch; a `tool_use` name outside the known Kernel ops and edit tools contributes no registration or finding and throws nothing. | A Claude Code session's rounds and findings appear in the report. | `BR-SCN-1` |
| AC3 | Reading the Antigravity fixture yields one registration from `call_mcp_tool`/`immune-brain…`, the task id from `Arguments`, and the session cwd from `WorkspaceURIs[0]` with `file://` stripped; an unparsable `Arguments` yields the event without arguments; a conversation id absent from the metadata yields cwd `unknown` and a counted session. | An Antigravity CLI session appears with its rounds and cwd. | `BR-SCN-1` |
| AC4 | `--root <dir>` alone prints exactly one `host: pi` line and scans no other tree; `--root` with two `--host` values exits non-zero with the usage string; `--host claude` on a missing root prints zero sessions without throwing. | Existing Pi-only invocations keep their meaning. | — |
| AC5 | `--json` still emits `immune_brain/revisit_evidence/v2`; every `sessions[]` and `events[]` entry carries a non-empty `host`, and `scope.hosts` lists the resolved trees. | A downstream consumer can filter by host without a contract bump. | — |
| AC6 | `dist/revisit.md` names the three Hosts, the `--root`-means-Pi rule and the two Antigravity limitations; loader anchors still resolve and the regenerated package mirror matches its source. | A user reading the Skill contract learns which Hosts are covered and which are not. | — |

Acceptance is exercised by focused files only: `bun test tests/review-retro-analyzer.test.ts`, `sh -c "bun test tests/skill-dist-consistency.test.ts && bun scripts/build-antigravity-plugin.ts --check"`.

Enumerated negative cases: unknown tool name (AC2), unparsable `Arguments` (AC3), missing metadata file and missing conversation id (AC3), `--root` with multiple hosts (AC4), missing host root directory (AC4).

## User scenarios

- `BR-SCN-1` — **Actor**: a user who has run Immune-Brain on Pi and on Claude Code on the same machine. **Given**: `~/.claude/projects` holds a session that called `submit_review`. **When**: the user runs `bun plugins/immune-brain/skills/revisit/scripts/review_retro.ts 30`. **Then**: the report prints a `host:` line for both trees and includes that Claude session's registration and finding in the same totals. Tagged `automated`, mapped to AC1–AC3.

## Brainstorm Trace

| Item | Mapping |
|---|---|
| `BR-REQ-1` | D1, AC1–AC3 |
| `BR-REQ-2` | D6, D7, AC5, AC6 |
| `BR-DEC-1` | `BR-OUT-1`, threat model; Antigravity GUI excluded |
| `BR-DEC-2` | D2, AC1, AC4 |
| `BR-DEC-3` | D5, AC3 |
| `BR-DEC-4` | D6, AC5 |
| `BR-DEC-5` | D1 (one merged report, one file = one session) |
| `BR-OUT-1` | Out: Antigravity GUI protobuf store, `.imm/` and authority-store reads unchanged |
| `BR-OUT-2` | Out: model ranking, derived review metrics, snapshot/week-over-week diff |
| `BR-DEFER-1` | Deferred: per-host split columns in the report |
| `BR-SCN-1` | User scenarios, AC1–AC3 |

## Devil's Advocate Audit

- **Rollback resilience**: the change is one script module plus one report header. Reverting `session_evidence.ts`, `review_retro.ts` and the contract text restores the Pi-only behavior; the additive JSON field is the only machine-visible residue and a reverted reader simply stops emitting it, so no consumer migration is needed. A partially implemented Slice that adds a reader but not discovery leaves the default behavior Pi-only, which is today's behavior and not a broken state.
- **Verification vanity**: AC1 exercises the pure discovery function rather than the real home directory, so it cannot pass vacuously on a machine without the other Hosts; AC4 pins the backward-compatible `--root` path, which is what the existing suite already depends on; AC2 and AC3 include an unknown-name and an unparsable-arguments case so a reader that "passes everything through" fails. No descriptor runs a whole suite or a build.
- **Spec dilution detection**: the confirmed outcome is "all three Hosts in the session report". Narrowing it to "Pi plus Claude, Antigravity deferred" would be a conservation failure; the excluded item is only the Antigravity GUI store, which `BR-DEC-1` excluded before planning and which the probe shows is protobuf rather than JSON.

## Out of scope

- Antigravity GUI (SQLite protobuf) transcripts.
- Per-host split columns, measurement of derived review metrics, snapshot/diff (`revisit` S4 follow-up).
- Anything touching `.imm/`, Kernel state, authority, or the `--audit` path.
