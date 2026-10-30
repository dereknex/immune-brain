# Lane preferences: one local preset, default is the current host config

**Status**: Candidate; no execution authority.
**Task ID**: `lane-preferences-local-preset` (source issue #327).
**Design risk**: Medium — no runtime code changes, but it replaces a documented Parent contract (Lane Preferences directive resolution), removes two documented preference sources and one directive (a breaking compatibility change for existing setups), and adds an exception to the "no agent-local file" principle in the preference reference.
**Design views**: data flow (preset file / request / default → Parent resolution → `start_unattended_batch` arguments and Executor launch flags → display line).
**Document language**: English, following Planner's default document policy.

## Outcome

Lane preferences move out of tracked instruction files into one personal, gitignored file, `.imm/lanes.local.json`, which holds named profiles and an `active` field. With no file, or no `active`, behavior is today's default column. A request may name a profile and overlay fields for one batch. The `Batch final verification` directive is removed; final verification commands come from the request, else the repository's prose, else none. The Parent alone reads the preset; the runner and runtime stay unchanged.

Slice result: one TaskIntent; when it lands, the Parent contract, the preference reference and its packaged mirror, the public READMEs, `IMMUNE.md` and this repository's `AGENTS.md` all describe the preset, no tracked file carries the four lane directives or `Batch final verification`, a new ADR records the exception, and a major changeset states the migration. Remaining gap: creating any maintainer's own preset file is outside this task (#327 Delivery).

## Sources

- **#327** — issue body as updated 2026-10-30 (https://github.com/dereknex/immune-brain/issues/327), sections Design, Batch final verification, Removed, Documentation, Migration, Delivery, Acceptance. Section references below are `#327-<section>`.
- **G** — grilling session 2026-10-30, Q1–Q11, recorded in https://github.com/dereknex/immune-brain/issues/327#issuecomment-6517431178. No upstream `clarify` manifest; scenarios are Spec-local `SCN-*` confirmed in that session.
- Repository evidence:
  - `plugins/immune-brain/dist/drive-batch.md:257-291` — current `#### Lane Preferences`: four-level precedence (request, repo instruction file, user-level file, default) and a five-row directive table including `Batch final verification`; owned source, no `docs/` mirror (`scripts/dist-sync-manifest.ts:209-216`).
  - `plugins/immune-brain/dist/drive-batch.md:314-322,361` — Lane Executor Supervision refers to `Lane Executor Host` directive and Lane Preferences for model and effort.
  - `plugins/immune-brain/skills/drive/SKILL.md:36` — route line "resolve the repository's parallelism, Executor Host, model and effort".
  - `docs/reference/immune-brain-config.md:3-5` — "does not load an agent-local TOML file … preferences belong in the Host's agent instruction files"; `:56-81` Lane Preferences section; mirrored byte-identically to `plugins/immune-brain/dist/docs/reference/immune-brain-config.md` (`scripts/dist-sync-manifest.ts:32`).
  - `AGENTS.md:42-48` (`CLAUDE.md` is a symlink to it) — `Initiative carrier default: github` plus the four lane directives.
  - `IMMUNE.md:44`, `README.md:121,565,628-642`, `README.zh-CN.md:121,570,642-645` — name the four directives.
  - `plugins/immune-brain/runtime/claude/mcp_server.ts:70` — `final_verification` schema already enforces `maxItems: 8`; no runtime change is needed.
  - `tests/role-prompt-bridge.test.ts:383-404` — locks the directive table and asserts no runtime source names the directives.
  - `tests/pi-only-current-contracts.test.ts:73-79` — locks "does not load an\nagent-local TOML file" and the carrier directives.
  - `tests/ceremony-trim-contract.test.ts:32,131` — locks the `Lane Preferences` heading and the `drive-batch.md#lane-preferences` anchor.
  - `tests/dist-docs-sync-contract.test.ts` — mirror byte identity.
  - `docs/adr/0013-optional-parallel-batch-lanes.md` — the lane-mode decision this exception refines.
  - `CHANGELOG.md` 6.0.0 — a breaking user-facing rename shipped as a `major` changeset.

## Threat model and supported environment

The only new input is `.imm/lanes.local.json`, a file the user writes in their own clone and the Parent (an LLM following the contract) reads directly. Trust level: the user's own configuration; no adversary. The cases handled are user mistakes enumerated in D4. Supported: Pi and Claude Code Parents; JSON as defined in D2; the file at the Parent's checkout root only.

## Decisions and technical design

### D1 — One preset file, gitignored (source: #327-Design, G-Q6)

The preset path is `.imm/lanes.local.json` at the Parent's checkout root; `.gitignore` adds that exact line. The Parent reads it directly before the first `start_unattended_batch` call; Lane worktrees, the runner and runtime sources read none of it. No other file carries lane configuration.

### D2 — File shape (source: #327-Design, G-Q5)

Exactly two top-level keys: optional `active` (a profile name) and `profiles` (name → profile). No `contract` field. A profile has four optional fields: `max_parallel` (positive integer; turns lane mode on, passed as `max_parallel`), `executor_host` (`claude-code` or `pi`; every Lane uses it, no fallback to the other Host), `executor_model` (passed as `--model`), `executor_effort` (`--effort` to `claude-code`, `--thinking` to `pi`).

### D3 — Resolution (source: #327-Design, G-Q3, G-Q4)

Data flow, per field:

1. The selected profile is the one the request names, else `active`, else none.
2. A field stated literally in the request wins (`request`); else the selected profile's field (`preset:<profile>`); else the default column (`default`): no `max_parallel` (one Lane at a time), the Parent's own Host type else the other allowlisted Host, the Executor Host's own model and effort.
3. `executor_model` / `executor_effort` from a profile apply only when that same profile names `executor_host`; otherwise they are reported and not applied, and never attached to the default-resolved Host. A request-stated model/effort follows the same rule against a request- or profile-named host.
4. The Parent displays one non-blocking line with each value and its per-field source. On resume the recorded `max_parallel` stands and nothing is passed again (unchanged).

The section keeps its heading `#### Lane Preferences` and anchor.

### D4 — Errors are reported and the batch is not started (source: #327-Design "Errors", G-Q6)

The contract enumerates these cases, each reported with no batch started on guessed or default values: malformed JSON; `active` naming a profile that does not exist; a request naming a profile that does not exist; an unknown key at top level or inside a profile (e.g. `executor_modle`); `max_parallel` that is not a positive integer; `executor_host` outside `pi`/`claude-code`.

### D5 — Removed sources and directives (source: #327-Removed, G-Q1)

Repository and user-level instruction-file lane directives (`Lane max parallel`, `Lane Executor Host`, `Lane Executor model`, `Lane Executor effort`) are no longer read; the four-level precedence list and directive table are deleted. The `Batch final verification` directive is deleted. `Initiative carrier default` and other preferences are unchanged.

### D6 — Final verification commands (source: #327-Batch final verification, G-Q1, G-Q9)

`final_verification` resolves: commands stated literally in the current request; else the full test suite and type-check commands the repository instruction file names in prose; else none, and the completion report says nothing was run. The constraints — plain commands without shell syntax or quoting, at most 8 — are stated on the `final_verification` parameter, independent of source. The Parent never invents a command. Runtime schema is unchanged (`mcp_server.ts:70`).

### D7 — Documentation surfaces (source: #327-Documentation, G-Q2)

- New ADR `docs/adr/0033-lane-preferences-local-preset.md`: lane preferences are the one exception to "preferences live in Host instruction files"; it refines ADR 0013 (lane mode itself unchanged) and records the removed sources.
- `docs/reference/immune-brain-config.md` keeps its opening sentence and adds the exception pointing to the ADR; its Lane Preferences section is rewritten to the preset; the packaged mirror is resynced.
- `drive-batch.md` Lane Preferences and the two Executor Supervision references (`:314-322`, `:361`) name the preset; `skills/drive/SKILL.md:36` route text names the preset.
- `README.md`, `README.zh-CN.md` and `IMMUNE.md` replace the directive examples with the preset.

### D8 — This repository's migration (source: #327-Migration, G-Q7)

`AGENTS.md` deletes its four lane lines and keeps `Initiative carrier default: github`. No preset file is created by this task.

### D9 — Release notes (source: #327-Documentation "CHANGELOG", G-Q10; bump level is a delegated technical choice following the 6.0.0 precedent)

A `major` changeset `.changeset/lane-preferences-local-preset.md` names both removals and the migration: copy old directive values into a profile and set it `active`, or delete them; name final-verification commands in instruction-file prose or in the request.

## User scenarios

| ID | Scenario | Source | Tag | Acceptance |
|---|---|---|---|---|
| SCN-1 | A user with no preset starts a batch and gets one Lane at a time on the Parent's Host with Host defaults | #327-Acceptance, G | automated | AC1 |
| SCN-2 | A user with `active: fast` gets that profile's fields, the rest from the default, and sees per-field sources | #327-Acceptance, G-Q3 | automated | AC1 |
| SCN-3 | A user says "use `cheap`, but max parallel 3" for one batch without editing the file | G-Q3 | automated | AC1 |
| SCN-4 | A user misspells a key or names a missing profile and the batch does not start | G-Q6 | automated | AC1 |
| SCN-5 | A repository that names `bun test` / typecheck in prose gets them as final verification with no directive | G-Q1, G-Q9 | automated | AC2 |
| SCN-6 | A user upgrading reads the changeset and moves their old directives into a profile | G-Q10 | automated | AC5 |

Automated scenarios are verified at the contract seam (the Parent is an LLM following `drive-batch.md`); actual Parent behavior is not executed by these checks.

## Verification and acceptance mapping

| AC | Decisions | Seam | Controls |
|---|---|---|---|
| AC1 | D1–D4 | `tests/role-prompt-bridge.test.ts` (rewrite the Lane Preferences test) | positive: path, keys, fields, per-field sources, overlay; negative: each D4 case named, old directive rows absent; bound: no runtime source names `lanes.local.json` or the directives |
| AC2 | D5, D6 | `tests/role-prompt-bridge.test.ts` | positive: request → prose → none order and the ≤8 / no-shell-syntax constraint; negative: no `Batch final verification:` directive |
| AC3 | D7 | `tests/pi-only-current-contracts.test.ts`, `tests/dist-docs-sync-contract.test.ts`, `tests/ceremony-trim-contract.test.ts` | positive: exception and preset in the reference, mirror identical, anchor kept; negative: reference has no lane directive lines; bound: carrier directives and opening sentence kept |
| AC4 | D1, D5, D8 | `tests/role-prompt-bridge.test.ts` | positive: `.gitignore` line; negative: `AGENTS.md`, `IMMUNE.md`, `README.md`, `README.zh-CN.md` carry no lane directive; bound: `AGENTS.md` keeps `Initiative carrier default: github` |
| AC5 | D7, D9 | `sh -c` file checks | ADR exists and names ADR 0013 and the preset path; changeset is `major` and names the migration |

## Devil's Advocate Audit

- **Rollback resilience**: one commit touching docs, tests, `.gitignore` and a changeset; reverting it restores the directive contract exactly. No runtime or persisted state changes, so a partial implementation cannot corrupt a batch record; the worst partial state is docs disagreeing, which AC1/AC3/AC4 catch.
- **Verification vanity**: contract-text assertions prove the Parent contract states the behavior, not that an LLM Parent obeys it; this is declared in User scenarios. Negative controls fail if the old directive table, the `Batch final verification` row, or README directive examples survive, and the runtime-source bound fails if someone adds a resolver.
- **Spec dilution**: every #327 Acceptance bullet and G-Q1–Q11 maps to D1–D9; G-Q8 (one TaskIntent) and G-Q11 (issue updated) are satisfied by this artifact and the issue edit. Nothing from #327 is deferred except the maintainer's own preset file, which #327-Delivery excludes.
