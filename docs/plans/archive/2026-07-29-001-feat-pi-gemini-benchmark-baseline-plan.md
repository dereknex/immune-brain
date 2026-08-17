---
title: "feat: migrate full benchmark baseline to pi-agent gemini-3.6-flash"
type: feat
status: active
date: 2026-07-29
origin: imm-brainstorm confirmation on building full benchmark test baseline with pi antigravity/gemini-3.6-flash
spec: docs/specs/pi-gemini-benchmark-baseline.spec.md
---

# Iteration Plan

## Task

- Summary: Migrate the primary Immune-Brain benchmark test baseline (`tests/fixtures/immune-brain-benchmark.json`) and behavior eval contract test to target `pi-agent` runner with `antigravity/gemini-3.6-flash`.
- Origin: User requested full benchmark test baseline migration based on pi `antigravity/gemini-3.6-flash` model; framed and confirmed in `imm-brainstorm`.
- Research: `tests/fixtures/immune-brain-benchmark.json` currently specifies `codex-cli` and `gpt-5.6`. `tests/fixtures/imm-brainstorm-behavior-benchmark.json` already uses `pi-agent` and `antigravity/gemini-3.6-flash`. Contract tests in `tests/immune-brain-behavior-eval-contract.test.ts` validate runner model and workspace setup.
- Decisions: D1 Update `tests/fixtures/immune-brain-benchmark.json` in place to ensure a single canonical benchmark baseline; D2 Align `tests/immune-brain-behavior-eval-contract.test.ts` assertions to match `pi-agent` and `antigravity/gemini-3.6-flash`.
- Assumptions: Benchmark verifiers and scenario structure remain identical across runners; no workspace code modifications required.
- Output Language: Spec and Plan prose in English; user-facing replies in Chinese per project instructions; CLI flags, JSON keys, file paths, and canonical terms remain literal.

## Brainstorm Manifest

- BR-REQ-1
- BR-REQ-2
- BR-REQ-3
- BR-DEC-1
- BR-OUT-1
- BR-OUT-2

## Brainstorm Trace

| Manifest ID | Status | Step / Reason |
| --- | --- | --- |
| BR-REQ-1 | covered_by_step | Step 1 |
| BR-REQ-2 | covered_by_step | Step 1 |
| BR-REQ-3 | covered_by_step | Step 2 |
| BR-DEC-1 | captured_as_decision | D1 |
| BR-OUT-1 | out_of_scope | Production runtime model selection is untouched |
| BR-OUT-2 | out_of_scope | Fixture workspace code is untouched |

## Devil's Advocate Audit

- Rollback resilience: Changes are confined to two files (`tests/fixtures/immune-brain-benchmark.json` and `tests/immune-brain-behavior-eval-contract.test.ts`); git rollback is instantaneous if verification fails.
- Verification vanity: Automated tests directly validate JSON fields (`runner.type`, `runner.model`) and fail if the values do not match `pi-agent` and `antigravity/gemini-3.6-flash`.
- Spec dilution detection: All confirmed requirements (`BR-REQ-1` to `BR-REQ-3`) are fully covered across the two steps.

## Steps

### Step 1

- Step ID: U1
- Result: Primary benchmark fixture tests/fixtures/immune-brain-benchmark.json updated to use pi-agent runner with antigravity/gemini-3.6-flash model.
- Verification: `bun -e 'const b = JSON.parse(require("fs").readFileSync("tests/fixtures/immune-brain-benchmark.json")); if (b.runner.type !== "pi-agent" || b.runner.model !== "antigravity/gemini-3.6-flash") throw new Error("Mismatch")'`

### Step 2

- Step ID: U2
- Depends on: U1
- Result: Behavior eval contract assertions in tests/immune-brain-behavior-eval-contract.test.ts updated to pass cleanly for pi-agent with antigravity/gemini-3.6-flash.
- Verification: `bun test tests/immune-brain-behavior-eval-contract.test.ts && bun test tests/brainstorm-decision-probing-contract.test.ts`
