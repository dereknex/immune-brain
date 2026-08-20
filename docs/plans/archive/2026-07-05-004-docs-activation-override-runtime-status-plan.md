---
title: "docs: activation override runtime support status"
type: docs
status: planned
date: 2026-07-05
origin:
  - imm-code-review post-closure finding on activation override docs-vs-runtime gap
  - docs/specs/archive/2026-07-05-activation-override-runtime-status-docs.spec.md
---

# Iteration Plan

## Task

- Summary: Mark `[subagent_activation.lenses]` and `[subagent_activation.subagents]` as documented-but-not-yet-runtime-backed in config and activation policy docs, and sync dist mirrors.
- Spec: `docs/specs/archive/2026-07-05-activation-override-runtime-status-docs.spec.md`
- Origin: A post-closure `imm-code-review` found that docs present `hosts`, `lenses`, and `subagents` override tables as equally supported, but runtime only consumes `hosts` and `default`.
- Scope Mode: New docs-only follow-up slice. No runtime, test, or State Ledger changes.
- Planner research dispatch: solo. The gap is local, docs-only, and supported by direct doc/runtime evidence.

## Output Language

- Human-readable prose: English for Spec and Plan documents.
- Preserved literals: file paths, commands, schema fields, TOML table names, env var names, CLI flags, Skill names, and canonical terms such as `Step`, `Plan`, `Spec`, and `Verification`.

## Research

- `docs/reference/immune-brain-config.md:85,94,105` lists `hosts`, `lenses`, `subagents` without runtime status distinction.
- `docs/reference/automatic-subagent-activation-policy.md:41` declares `activation_overrides: {hosts, lenses, subagents}` as the full contract.
- `plugins/immune-brain/runtime/immune_brain_runtime.ts:462` only reads `hosts[host]` and `default`.
- Plan 003 D5 explicitly deferred `lenses` / `subagents` runtime consumption.
- `scripts/sync-dist-docs.ts` syncs `docs/reference/immune-brain-config.md` and `docs/reference/subagent-dispatch-protocol.md` into dist mirrors; `automatic-subagent-activation-policy.md` is intentionally adapted and maintained by hand.

## Decisions

- D1: Docs-only slice. No runtime, test, or State Ledger changes.
- D2: Mark `default` and `hosts` as runtime-backed; mark `lenses` and `subagents` as documented-but-not-yet-runtime-backed.
- D3: Update both `docs/reference/immune-brain-config.md` and `docs/reference/automatic-subagent-activation-policy.md`.
- D4: Sync dist mirror for `immune-brain-config.md`; hand-update the intentionally-adapted dist `automatic-subagent-activation-policy.md`.
- D5: Do not backfill historical `docs/solutions/*.md` references; they are historical records.

## Assumptions

- Users reading config docs benefit more from an explicit runtime-status note than from silent omission.
- `lenses` / `subagents` tables remain valid TOML and continue to parse; they are simply ignored by runtime.

## Devil's Advocate Audit

### 1. Rollback Resilience

- Risk: docs-only change cannot break runtime. Rollback is confined to doc edits and dist sync.
- Mitigation: revert the doc edits and re-run `bun scripts/sync-dist-docs.ts`.

### 2. Verification Vanity

- Risk: tests might only grep for the new wording without proving docs and runtime stay consistent.
- Mitigation: U1 verification includes `bun scripts/sync-dist-docs.ts --check` and `git diff --check`; the wording itself names the exact runtime line that backs `hosts`/`default`.

### 3. Spec Dilution Detection

- Risk: the Plan could silently expand into implementing `lenses` / `subagents` runtime support.
- Mitigation: D1 explicitly forbids runtime changes; scope is docs status annotation only.

## Steps

### Step 1

- Step ID: U1
- Result: Docs mark activation override runtime support status.
- Verification type: automated
- Verification: `bun test tests/dist-docs-sync-contract.test.ts && bun scripts/sync-dist-docs.ts --check && git diff --check`
- Test scenarios: config docs name `default` and `hosts` as runtime-backed; config docs name `lenses` and `subagents` as not-yet-runtime-backed; `automatic-subagent-activation-policy.md` carries the same distinction; dist mirror docs stay synchronized.
- Discovery cache: docs/reference/immune-brain-config.md (config docs); docs/reference/automatic-subagent-activation-policy.md (activation policy docs); scripts/sync-dist-docs.ts (mirror sync)
- Agent Hint: imm-executor
- Depends on: none
- failure_behavior: If docs and dist mirror diverge, treat the source docs as source of truth and re-run sync before recording evidence.
- security_considerations: None. Docs-only change with no config or runtime output.

## Test Scenarios

- A user reading config docs sees which override tables are runtime-backed.
- A user reading activation policy docs sees the same distinction.
- Dist mirror docs stay synchronized.

## Validation

- Plan validator: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-05-004-docs-activation-override-runtime-status-plan.md --json`
- Do not sync or execute this Plan until the user confirms.

## Next Action

- If the user approves execution, sync this Plan and start U1 through `imm-work`.
