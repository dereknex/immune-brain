---
title: "fix: clarify plugin eval budget measurement"
type: fix
status: proposed
date: 2026-06-26
origin: plugin-eval observed usage analysis for immune-brain
---

# Iteration Plan

## Task

- Summary: Turn the Plugin Eval budget and coverage findings for `immune-brain` into documented, reproducible evidence.
- Spec: docs/specs/plugin-eval-budget-measurement-followup.spec.md
- Origin: User asked for a solution based on the Plugin Eval report: score 81/100, `observed-usage-estimate-drift`, `deferred_cost_tokens-budget-high`, and missing coverage artifacts.
- Brainstorm manifest: BR-REQ-001; BR-REQ-002; BR-REQ-003; BR-DEC-001; BR-DEC-002; BR-OUT-001; BR-Q-001; BR-Q-002
- Research: `CONTEXT.md` identifies plugin-local runtime and Skill contracts as the relevant surfaces. The cached Plugin Eval budget code computes plugin active budget from `.codex-plugin/plugin.json` plus skill `SKILL.md` files and counts all other plugin text as deferred. The observed-usage check compares that active estimate with benchmark input tokens, which include task workspace context and runtime-expanded instruction text. Plugin Eval coverage detection recognizes `lcov.info`, `coverage.xml`, `coverage-final.json`, or `coverage-summary.json` under the evaluated plugin target. Local Python currently does not have `coverage.py`, so the coverage path must either use a repo-local generator or an existing dependency-free artifact writer.
- Decisions: D1 Treat the observed/static delta as a measurement interpretation gap first, not as proof that each Skill entry file should be rewritten. D2 Keep the current slice inside the `immune-brain` repo and do not patch the cached Plugin Eval package. D3 Add a reproducible coverage artifact path under `plugins/immune-brain/` instead of only telling evaluators to run coverage manually. D4 Preserve `deferred_cost_tokens` as a monitoring signal because packaged `dist/` and reference text are real material, even if not all of it is active in every session.
- Assumptions: The existing unittest suite is sufficient source data for a generated coverage artifact once a local, dependency-free artifact path exists. Rerunning Plugin Eval after implementation will still show observed/static drift unless Plugin Eval itself changes or benchmark usage is segmented more precisely.
- Scope Mode: Hold Scope
- Planner research dispatch: solo; the task is a bounded documentation, test, and local artifact-generation slice with direct local evidence.

## Output Language

- Human-readable prose: English for new Spec and Plan documents; Chinese for user-facing replies in this workspace
- Preserved literals: file paths, commands, schema fields, enum values, API names, code identifiers, and `CONTEXT.md` canonical terms

## Brainstorm Manifest

| ID | Item |
|----|------|
| BR-REQ-001 | Produce a solution for the 81/100 Plugin Eval report. |
| BR-REQ-002 | Address the static-vs-observed token budget drift. |
| BR-REQ-003 | Address the missing coverage artifact finding. |
| BR-DEC-001 | Do not rewrite compact `SKILL.md` entry files as the first response. |
| BR-DEC-002 | Treat Plugin Eval static active budget as manifest plus `SKILL.md` evidence unless code inspection proves otherwise. |
| BR-OUT-001 | Do not modify the cached Plugin Eval package in this repository slice. |
| BR-Q-001 | Is static budget counting only manifest and `SKILL.md`, or also runtime-expanded `dist/` instructions? |
| BR-Q-002 | Does Plugin Eval coverage scoring require recognized artifacts under the plugin target path? |

## Brainstorm Trace

| Item | Status | Target | Reason |
|------|--------|--------|--------|
| BR-REQ-001 | covered_by_step | U1 | U1 records the evaluation interpretation and maintainable remediation contract. |
| BR-REQ-002 | covered_by_step | U1 | U1 documents the active estimate boundary and observed usage boundary. |
| BR-REQ-003 | covered_by_step | U2 | U2 creates a reproducible recognized coverage artifact path. |
| BR-DEC-001 | captured_as_decision | D1 | Current skill entry files are already compact and should not be churned without evidence. |
| BR-DEC-002 | resolved_as_assumption | U1 | Source inspection of cached Plugin Eval `budget.js` supports this interpretation. |
| BR-OUT-001 | out_of_scope | D2 | This slice changes Immune-Brain evidence and docs only. |
| BR-Q-001 | resolved_as_assumption | U1 | Source inspection shows active plugin estimate excludes runtime-expanded `dist/*.md`. |
| BR-Q-002 | resolved_as_assumption | U2 | Source inspection shows coverage detection scans for recognized artifact filenames under the target. |

## Devil's Advocate Audit

1. **Rollback Resilience**: The planned changes are limited to docs, tests, and a generated or generator-backed coverage artifact path. If the slice fails, revert the new docs/tests/artifact support without migrating runtime state or changing Skill behavior.
2. **Verification Vanity**: A text note alone would not prove the Plugin Eval report improved. U3 must rerun `plugin-eval analyze` with the observed-usage file and report whether the failing and warning checks remain, improve, or need a Plugin Eval-side change.
3. **Spec Dilution Detection**: The user asked for a solution based on the analysis report, not just an explanation. The Plan includes both the budget interpretation fix and the coverage artifact fix, while explicitly deferring cached Plugin Eval changes.

## Planning Quality Gate

- contract surface: `plugins/immune-brain/` evaluation docs or README guidance, focused tests, and the plugin-local coverage artifact path.
- compatibility: No runtime schema, State Ledger, MCP surface, or Skill invocation behavior changes are required.
- interruption recovery: If execution stops after U1, rerun the focused tests to confirm the budget note. If execution stops after U2, rerun the artifact command and Plugin Eval coverage detection.
- rollback path: Revert this Spec, this Plan, any budget-note docs/tests, and any coverage artifact generation support added by U2.
- verification strength: Use focused tests for durable wording, direct artifact existence checks, plan validation, and a final observed-usage Plugin Eval rerun.
- Brainstorm traceability: Every brainstorm item is mapped in `Brainstorm Trace`.

## Steps

### Step 1

- Step ID: U1
- Result: Plugin Eval budget interpretation contract is recorded
- Verification type: automated
- Verification: `python3 -m unittest tests.test_skill_contracts && python3 .imm/imm-plan.py docs/plans/2026-06-26-001-fix-plugin-eval-budget-measurement-plan.md --json`
- Execution note: test-first
- Test scenarios: Covers static active budget scope; Covers observed benchmark usage scope; Covers deferred budget remains a real monitoring signal; Covers no instruction to rewrite all compact `SKILL.md` files.
- Discovery cache: plugins/immune-brain/.codex-plugin/plugin.json (plugin manifest budget source); plugins/immune-brain/skills (compact Skill entry files); plugins/immune-brain/dist (runtime-expanded instruction source); tests/test_skill_contracts.py (contract regression tests); docs/specs/plugin-eval-budget-measurement-followup.spec.md (accepted behavior)
- Agent Hint: imm-executor
- Depends on: none
- failure_behavior: If the only way to reduce the failing check is to modify Plugin Eval scoring, stop and replan a separate upstream/tooling slice instead of misrepresenting the plugin budget.
- security_considerations: Do not include benchmark transcript content, prompts, or local user paths beyond repository-relative paths in the documentation.

### Step 2

- Step ID: U2
- Result: Plugin Eval coverage artifact path is reproducible
- Verification type: automated
- Verification: `test -f plugins/immune-brain/coverage.xml && python3 -m unittest tests.test_immune_brain_plugin_package && python3 .imm/imm-plan.py docs/plans/2026-06-26-001-fix-plugin-eval-budget-measurement-plan.md --json`
- Execution note: test-first
- Test scenarios: Covers recognized `coverage.xml` under the plugin target; Covers artifact generation without network access; Covers package tests still pass.
- Discovery cache: plugins/immune-brain/tests (plugin-local tests); tests/test_immune_brain_plugin_package.py (packaging and parity tests); plugins/immune-brain/coverage.xml (Plugin Eval recognized coverage artifact)
- Agent Hint: imm-executor
- Depends on: 1
- failure_behavior: If dependency-free coverage generation is not viable, record the blocker and replan whether to vendor a minimal coverage writer or accept an external `coverage.py` prerequisite.
- security_considerations: The artifact must not include absolute local paths or sensitive environment data.

### Step 3

- Step ID: U3
- Result: Plugin Eval follow-up outcome is recorded
- Verification type: automated
- Verification: `node /Users/derek/.codex/plugins/cache/openai-curated-remote/plugin-eval/0.1.2/scripts/plugin-eval.js analyze plugins/immune-brain --format markdown --observed-usage plugins/immune-brain/.plugin-eval/benchmark-usage.jsonl`
- Test scenarios: Covers final score comparison; Covers whether `coverage-artifacts-unavailable` is gone; Covers whether `observed-usage-estimate-drift` remains and needs a Plugin Eval-side follow-up; Covers whether `deferred_cost_tokens-budget-high` remains as monitoring signal.
- Discovery cache: plugins/immune-brain/.plugin-eval/benchmark-usage.jsonl (observed usage samples); plugins/immune-brain/.plugin-eval/benchmark.json (benchmark scenarios); /Users/derek/.codex/plugins/cache/openai-curated-remote/plugin-eval/0.1.2/scripts/plugin-eval.js (local evaluator command)
- Agent Hint: imm-executor
- Depends on: 2
- failure_behavior: If the local cached Plugin Eval CLI path is unavailable, rerun through the installed `plugin-eval` command if present and record the command substitution in execution evidence.
- security_considerations: Do not publish raw benchmark logs; summarize score and check deltas only.

## Validation

- Plan validator: `python3 .imm/imm-plan.py docs/plans/2026-06-26-001-fix-plugin-eval-budget-measurement-plan.md --json`
- Runtime sync: MCP `imm_plan_validate(sync=true)`

## Notes

- This Plan intentionally fixes the Immune-Brain-side evidence and coverage gaps first. It does not promise to eliminate `observed-usage-estimate-drift` without Plugin Eval scoring changes.
- After validation and runtime sync, continue through `imm-work` before executor edits.
