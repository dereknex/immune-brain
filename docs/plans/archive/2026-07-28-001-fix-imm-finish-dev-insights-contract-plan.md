---
title: "fix: make the imm-finish dev-insights contract executable"
type: fix
status: pending
created: 2026-07-28
---

## Summary

Make the TypeScript `imm-finish` command execute its declared closure-summary and opt-in dev-insights contract while preserving authoritative reset, CAS, privacy, and host-local configuration boundaries.

## Task

- Summary: Restore record-aware `imm-finish` behavior without breaking reset-only callers or storing insights in project workflow state.
- Spec: `docs/specs/2026-07-28-imm-finish-dev-insights-contract.spec.md`
- Origin: Direct follow-up from the completed and compounded 2026-07-27 Brainstorm decision-probing Plan. Compounder called `imm-finish "<summary>" "<next steps>"`; the TypeScript runtime ignored both values and only reset the ledger. The prior Plan is closed and intentionally reset, so append is illegal and this Plan is a new slice.
- Scope Mode: Hold Scope. Restore only the already-declared finish/dev-insights behavior plus the closure and privacy guards required to execute it safely.

## Output Language

- Spec prose: English.
- Plan prose: English.
- Preserve CLI literals, environment variables, paths, State Ledger keys, test names, and code identifiers exactly.

## Research

- `plugins/immune-brain/runtime/immune_brain_runtime.ts` currently implements `runFinishCommand(args, root)` as an unconditional CAS-backed idle reset. It ignores `args`; `finishUsage()` exposes no summary, next-steps, or host-selection contract.
- `tests/finish-dehydrate-runtime.test.ts` proves idle/reset/history/snapshot preservation but has no coverage for CLI arguments, closure rejection, duplicate finish, or inbox behavior. `tests/plugin-package-runtime.test.ts` protects help no-mutation and command availability. `tests/imm-follow-up-runtime.test.ts` already exercises stale commit rejection for finish/dehydrate.
- `plugins/immune-brain/runtime/imm_core.ts` owns `readImmuneBrainConfig`, `resolveImmuneBrainLocalRoot`, `resolveImmuneBrainLocalPath`, and the agent-local TOML parser. Its config type does not yet declare `[dev_insights]`.
- `docs/reference/immune-brain-config.md` defines selected agent-local roots and `[dev_insights] enabled` plus optional `inbox_path`. It explicitly forbids guessing ownership or reading the retired global root.
- Historical Python `imm-finish` rejected non-closed iterations, consumed summary and comma-separated next steps, used `IMM_DEV_INSIGHTS` over config, reset state, and then appended a structured user-level Markdown insight best-effort. It also performed dehydrate, memory rotation, and telemetry work that current contracts have split into separate or retired surfaces; those behaviors are not restored here.
- `docs/specs/current-iteration-closure-contract.spec.md` requires `imm-finish` to succeed only for closed iterations and to reject active/replan state. `docs/specs/2026-06-29-004-fix-cross-plan-sync-reset-and-finish-runtime.spec.md` deliberately deferred durable memory/inbox work while establishing the current idle/reset contract. This Plan implements that deferred inbox slice without changing State Ledger schema.
- Root `README.md` already documents `imm-finish "任务总结" "下一步计划"`; `plugins/immune-brain/dist/imm-compounder.md` claims the same call records dev insights. `plugins/immune-brain/README.md` currently describes finish only as state closure, so entrypoint documentation is incomplete.
- Planner ensemble dispatch used the configured fast/mid/strong models with `tool_policy: no tools`. All three agreed on explicit host ownership, no State Ledger insight payload, no-arg compatibility, closure validation, and behavior-level tests. Fast suggested append-before-reset; mid and strong identified ghost-insight risk on stale CAS. Planner decision D8 chooses reset-before-append and explicitly accepts best-effort loss after reset rather than adding an outbox.

## Decisions

- D1: Create a new slice. The previous Plan is closed and `intentional_reset`; post-closure append or evidence rewrite is not legal.
- D2: Preserve no-arg `imm-finish` as a reset-only compatibility mode. It never evaluates dev-insights config or writes a user-global file.
- D3: Record-aware mode requires exactly two non-empty positional values plus an explicit coding agent from `--coding-agent` or `IMMUNE_BRAIN_CODING_AGENT`; the flag wins. Do not infer host identity from unrelated environment markers.
- D4: Reuse the existing agent-local TOML parser. `IMM_DEV_INSIGHTS=1|0` overrides the selected config; invalid explicit values fail closed. Do not read `~/.immune-brain/`.
- D5: Validate CLI, closure state, host, config, and inbox path before mutation. Commit the existing idle reset through lock-time CAS before any inbox append.
- D6: Treat inbox append as best-effort after authoritative closure. Append failure emits a non-sensitive warning and does not roll back or fail the reset.
- D7: Reject an already `idle` plus `intentional_reset` iteration. Combined with CAS, this prevents sequential or concurrent duplicate finish records without an outbox or insight receipt in State Ledger.
- D8: Accept the crash gap between reset and append. A guaranteed-delivery outbox would expand persistence and recovery semantics beyond this repair.
- D9: Preserve the historical structured Markdown fields but normalize explicit text to one line, reject NUL/empty/over-4096-character values, and never include implicit conversation, transcript, diff, provider, token, or environment content.
- D10: Configured `inbox_path` remains an explicit user-owned override and may be absolute or `~`-prefixed. Reject relative paths; never derive paths from summary or next steps.
- D11: Do not restore memory rotation, telemetry, implicit dehydrate, retired Python fallbacks, installer behavior, or legacy global-root reads.

## Assumptions

- `appendFileSync` or an equivalent single bounded append is sufficient for a best-effort local Markdown inbox; cross-filesystem guaranteed delivery is outside scope.
- The current lock-time CAS remains the authority for reset concurrency and needs no State Ledger schema migration.
- Existing generated dist documentation remains governed by `scripts/sync-dist-docs.ts`; runtime and active Compounder edits are made only at their canonical source surfaces.
- The host can identify itself to Compounder and pass `--coding-agent`; lack of that identity is a fatal record-aware invocation error rather than permission to guess.
- A warning-only inbox failure is compatible with the opt-in improvement-inbox product contract because project closure is authoritative and primary.

## Requirements Coverage

| Requirement | Status | Step | Evidence |
| --- | --- | --- | --- |
| FIN-REQ-001 | covered_by_step | U1 | CLI parser and focused record-aware invocation tests. |
| FIN-REQ-002 | covered_by_step | U1 | Reset-only compatibility test with zero inbox writes. |
| FIN-REQ-003 | covered_by_step | U1 | Open/replan/review/duplicate/malformed state rejection matrix. |
| FIN-REQ-004 | covered_by_step | U1 | Agent-local config and environment precedence tests. |
| FIN-REQ-005 | covered_by_step | U1 | Enabled temporary-home structured inbox assertion after CAS reset. |
| FIN-REQ-006 | covered_by_step | U1 | Disabled byte-level no-write and injected append-failure tests. |
| FIN-REQ-007 | covered_by_step | U1 | Existing finish, help, package, and stale-CAS regressions. |
| FIN-REQ-008 | covered_by_step | U1 | README/Compounder/config/help parity plus dist sync check. |

## Devil's Advocate Audit

1. **Rollback resilience:** Runtime, config typing, docs, and focused tests can be reverted as one bounded slice without migrating State Ledger data. Tests write only temporary homes. A successfully appended real user-local insight is an audit record and is not deleted during rollback. If execution stops before tests are green, no new runtime path is considered closed.
2. **Verification vanity:** String-presence tests alone would not prove ordering or no-write behavior. U1 uses isolated roots and homes, byte-level ledger/inbox comparisons, injected stale-CAS and append failures, exact structured-record assertions, and CLI exit/output checks. Each intended regression can make the suite fail independently.
3. **Spec dilution detection:** The Plan retains no-arg compatibility, explicit host selection, closure/review gating, disabled no-write behavior, environment precedence, privacy bounds, stale-CAS ordering, and warning-only append failure. Guaranteed delivery, telemetry, memory rotation, and legacy runtime restoration are explicitly rejected rather than silently omitted.

## Planning Quality Gate

- contract_surface: `plugins/immune-brain/runtime/immune_brain_runtime.ts`; `plugins/immune-brain/runtime/imm_core.ts`; `plugins/immune-brain/dist/imm-compounder.md`; root/plugin README; source config reference and generated mirror; focused runtime/config/package tests.
- compatibility: No-arg finish remains available; successful reset retains closed Steps, validated Plan snapshot, `finish_reset`, `idle`, and `intentional_reset`; help stays no-mutation; wrapper forwarding stays unchanged.
- interruption_recovery: Fatal validation and CAS failure occur before inbox writes. After CAS succeeds, inbox append is optional and warning-only. A crash in that gap may lose one optional insight; no recovery state is introduced.
- rollback_path: Revert the bounded runtime/config/docs/tests diff. No project-state migration or user-global cleanup is required.
- verification_strength: Behavior-level temporary-home tests cover positive, disabled, fatal, concurrent, and degraded paths; package/help and dist parity tests cover public surfaces.
- security_review: Explicit arguments only, normalized bounded fields, no text-derived paths, no implicit host guessing, no real-home test writes, and no sensitive argument echo in errors.

## Steps

### Step 1

- Step ID: U1
- Result: The `imm-finish` closure contract is executable end to end
- Verification type: automated
- Execution note: characterization-first
- Verification: `bun test tests/finish-dehydrate-runtime.test.ts tests/immune-brain-config-runtime.test.ts tests/plugin-package-runtime.test.ts tests/imm-follow-up-runtime.test.ts && bun scripts/sync-dist-docs.ts --check && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-28-001-fix-imm-finish-dev-insights-contract-plan.md --json && git diff --check`
- Test scenarios: Covers no-arg reset-only compatibility with no inbox lookup/write; Covers exact record-aware arguments and explicit flag/env coding-agent precedence; Covers help, unknown/repeated/missing/empty/overlong/NUL/multiline inputs; Covers closed success plus open/replan/pending-review/malformed/already-reset rejection; Covers enabled/disabled config and valid/invalid `IMM_DEV_INSIGHTS` precedence; Covers default and custom agent-local inbox paths without retired-root reads; Covers structured Markdown fields and absence of raw prompt/transcript/diff/provider/token/ledger data; Covers reset CAS before append, stale CAS with no insight, warning-only append failure after reset, and no summary/next-steps persistence in State Ledger; Covers existing history/snapshot/reset/help/wrapper behavior; Covers source/generated documentation parity.
- Discovery cache: plugins/immune-brain/runtime/immune_brain_runtime.ts (runFinishCommand, finishUsage, completion and review checkpoint helpers); plugins/immune-brain/runtime/imm_core.ts (readImmuneBrainConfig, local-root helpers, config type); plugins/immune-brain/runtime/state_ledger.ts (lock-time CAS and review-gate helpers, read-only unless a shared predicate is strictly required); tests/finish-dehydrate-runtime.test.ts (primary finish fixture); tests/immune-brain-config-runtime.test.ts (agent-local config matrix); tests/plugin-package-runtime.test.ts (help and CLI surface); tests/imm-follow-up-runtime.test.ts (stale commit regression); docs/specs/current-iteration-closure-contract.spec.md (inherited closure eligibility); docs/specs/2026-06-29-004-fix-cross-plan-sync-reset-and-finish-runtime.spec.md (inherited reset invariants)
- Scope: `plugins/immune-brain/runtime/immune_brain_runtime.ts`; `plugins/immune-brain/runtime/imm_core.ts`; `tests/finish-dehydrate-runtime.test.ts`; `tests/immune-brain-config-runtime.test.ts`; `tests/plugin-package-runtime.test.ts`; `tests/imm-follow-up-runtime.test.ts` only when an additional finish-specific stale-CAS assertion is needed; `plugins/immune-brain/dist/imm-compounder.md`; `README.md`; `plugins/immune-brain/README.md`; `docs/reference/immune-brain-config.md`; generated packaged config reference via the existing sync tool. `state_ledger.ts` is excluded unless execution proves a shared pure completion predicate is required to prevent autowork/finish drift.
- Agent Hint: imm-executor
- Depends on: none
- Applicable design: Spec `Technical Design` sections 1-6; Decisions D2-D11.
- failure_behavior: If safe insight delivery requires writing before CAS, adding a State Ledger outbox/receipt, inferring host ownership, or making inbox success a closure prerequisite, stop and return to Planner. If existing no-arg callers cannot coexist with strict duplicate-finish rejection, preserve no-arg closed-state reset and replan only the duplicate policy rather than breaking the public command silently.
- security_considerations: Use only temporary homes in tests. Validate and normalize explicit text before serialization, reject unsafe paths before reset, never echo supplied content in failures, create no inbox artifacts while disabled, and do not capture implicit session/model/provider data.

## Validation

- Plan validator: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-28-001-fix-imm-finish-dev-insights-contract-plan.md --json`
- Runtime tests: `bun test tests/finish-dehydrate-runtime.test.ts tests/immune-brain-config-runtime.test.ts tests/plugin-package-runtime.test.ts tests/imm-follow-up-runtime.test.ts`
- Dist parity: `bun scripts/sync-dist-docs.ts --check`
- Whitespace: `git diff --check`

## Completion Gate

- Gate: Spec and Plan pass Markdown diagnostics and `imm-plan --json` with no warnings.
- Gate: Planner sync creates a new one-Step pending slice without carrying closed Steps or the prior review gate.
- If gates pass: continue through `imm-loop`; the first authority is `imm-executor` for U1, followed by independent `imm-qa` and the runtime-required final review gate.
