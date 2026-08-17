# Spec: Pi Gemini Benchmark Baseline Migration

**Task ID**: IMM-BENCHMARK-001  
**Owner**: Planner  
**Status**: Accepted  
**Design risk**: Low  
**Rationale**: Contained configuration update to benchmark test fixture and alignment of contract test assertions to target `pi-agent` with `antigravity/gemini-3.6-flash`.  
**Diagram decision**: not_required  
**Diagram reason**: Configuration format and test contract alignment do not require state transition or sequence diagrams.

## Output Language

- Human-readable prose: English
- Preserved literals: file paths, commands, schema fields, enum values, API names, JSON keys, Skill names, and `CONTEXT.md` canonical terms such as `Plan`, `Step`, `Executor`, `QA`, `State Ledger`, and `Compounder`.

## 1. Goal

Migrate the primary Immune-Brain benchmark baseline (`tests/fixtures/immune-brain-benchmark.json`) to use the `pi-agent` runner and `antigravity/gemini-3.6-flash` model, ensuring consistent benchmark baseline behavior across all Immune-Brain test contracts.

## 2. Problem and Scope

### Current behavior

- `tests/fixtures/immune-brain-benchmark.json` uses runner `codex-cli` and model `gpt-5.6`.
- `tests/immune-brain-behavior-eval-contract.test.ts` asserts `benchmark.runner.model === "gpt-5.6"`.
- In contrast, `tests/fixtures/imm-brainstorm-behavior-benchmark.json` already uses runner `pi-agent` and model `antigravity/gemini-3.6-flash`.

### In scope

- Update `tests/fixtures/immune-brain-benchmark.json` runner configuration to `pi-agent` with model `antigravity/gemini-3.6-flash`, adding `subagentType: "general-purpose"`, `isolation: "worktree"`, `isolated: true`, and `parallel: true`.
- Update `tests/immune-brain-behavior-eval-contract.test.ts` test expectations to verify `runner.type === "pi-agent"` and `runner.model === "antigravity/gemini-3.6-flash"`.
- Verify contract and fixture integrity using `bun test tests/immune-brain-behavior-eval-contract.test.ts` and `bun test tests/brainstorm-decision-probing-contract.test.ts`.

### Out of scope

- Production runtime model selection logic.
- Adding or modifying test fixture workspace files under `tests/fixtures/immune-brain-benchmark-workspace`.

## 3. Key Invariants

1. `tests/fixtures/immune-brain-benchmark.json` runner type MUST be `"pi-agent"`.
2. `tests/fixtures/immune-brain-benchmark.json` model MUST be `"antigravity/gemini-3.6-flash"`.
3. All existing scenarios (`entrypoint-routing`, `multi-skill-follow-up`, `low-risk-direct-path`, `plugin-boundary`) MUST be preserved.
4. All test suites in `tests/` MUST pass cleanly.

## 4. Verification Approach

- Automated verification via `bun test tests/immune-brain-behavior-eval-contract.test.ts` and `bun test tests/brainstorm-decision-probing-contract.test.ts`.
