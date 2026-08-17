---
title: "refactor: make Immune-Brain runtime CLI-only"
type: refactor
status: planned
date: 2026-07-03
origin:
  - user-requested CLI-only planning validation
  - docs/specs/2026-07-03-cli-only-runtime.spec.md
---

# Iteration Plan

## Task

- Summary: Remove the Immune-Brain MCP integration surface and make plugin-local CLI wrappers plus structured CLI discovery the only supported runtime integration path.
- Spec: docs/specs/2026-07-03-cli-only-runtime.spec.md
- Origin: The user asked whether MCP can be removed and then explicitly requested comparison and planning without considering historical decisions or breaking-change concerns. A worktree validation spike proved that core CLI commands still run after removing MCP server files and MCP JSON-RPC handling.
- Research: `CONTEXT.md` defines the runtime architecture around `.imm/imm_core/`, State Ledger, Plan, Step, Skill, QA, and plugin-local runtime surfaces. `plugins/immune-brain/runtime/immune_brain_runtime.ts` currently has a direct `cli <command>` entry and `runImmCommand(...)` dispatch for `imm-plan`, `imm-work`, `imm-review`, `imm-heal`, `imm-autowork`, `imm-activation-plan`, `imm-finish`, and `imm-dehydrate`. `plugins/immune-brain/bin/imm-*` wrappers already delegate to the TypeScript runtime in `cli` mode. The worktree spike removed `plugins/immune-brain/.mcp.json`, `plugins/immune-brain/runtime/mcp-launcher.ts`, MCP server handling, and `list-tools`; CLI status, plan validation, activation plan, heal, wrapper tests, and autowork tests still passed. Full `bun test` then reported 82 pass and 9 fail, with failures concentrated in MCP and `list-tools` contract tests. `docs/reference/planning-quality-gate.md` applies because this changes cross-host packaged plugin contracts.
- Decisions: D1 Treat CLI wrappers as the only host-facing runtime integration path. D2 Remove MCP server config, launcher, stdio JSON-RPC handling, `tools/list`, `tools/call`, and MCP tool-to-command adapter code. D3 Add or preserve a CLI-native JSON command manifest such as `list-commands --json` so agent hosts retain structured discovery without MCP. D4 Keep State Ledger, Plan validation, QA, review, Compounder, and workflow authority boundaries unchanged. D5 Rewrite current tests, docs, Skill contracts, and package templates to describe CLI-only integration.
- Assumptions: The target runtime environment has Bun available because existing plugin wrappers already depend on Bun. CLI-only hosts can invoke plugin-local wrapper paths without requiring global PATH installation. MCP references in clearly historical archived solutions may remain if they do not instruct active behavior.
- Scope Mode: New Slice
- Planner research dispatch: solo; existing runtime code, worktree spike evidence, current test failures, `CONTEXT.md`, and planning-quality-gate guidance are sufficient to decompose the executable slice.

## Output Language

- Human-readable prose: English
- Preserved literals: file paths, commands, schema fields, enum values, API names, JSON keys, Skill names, and `CONTEXT.md` canonical terms such as `Plan`, `Step`, `Skill`, `QA`, `State Ledger`, and `Compounder`.

## Devil's Advocate Audit

1. **Rollback Resilience**: The rollback path is coherent if runtime removal, CLI manifest, tests, docs, and this Spec/Plan are reverted together. No State Ledger schema or user project state migration is planned, so a failed slice can be rolled back by restoring the plugin runtime and contract files without editing `.imm/memory/` state.
2. **Verification Vanity**: Passing only CLI smoke commands would be vanity because it would miss stale host contracts. Verification must fail if MCP launcher files remain active, if runtime still advertises `mcp`, if tests still exercise `tools/list` or `tools/call`, or if active docs still instruct MCP setup. The final verification therefore combines CLI runtime tests, full Bun tests, plan validation, and negative text checks for active MCP instructions.
3. **Spec Dilution Detection**: The plan does not silently narrow the request into merely adding CLI fallback. It explicitly removes MCP server integration and replaces MCP discovery with CLI-native structured discovery while preserving the workflow runtime boundaries that are unrelated to the transport layer.

## Planning Quality Gate

- **contract surface**: `plugins/immune-brain/runtime/immune_brain_runtime.ts`, `plugins/immune-brain/bin/imm-*`, `plugins/immune-brain/.mcp.json`, `plugins/immune-brain/runtime/mcp-launcher.ts`, `README.md`, `CONTEXT.md`, `IMMUNE.md`, active Skill files under `skills/` and `plugins/immune-brain/dist/`, package or release templates, and runtime tests under `tests/`.
- **compatibility**: This slice intentionally does not preserve MCP compatibility. Existing State Ledger files, Plans, and workflow command semantics remain compatible because the CLI command handlers and file-backed state model are preserved.
- **interruption recovery**: If execution stops after runtime removal but before docs or tests are migrated, the worktree may be temporarily inconsistent. The next `imm-work` run should resume with the failing test list and complete the contract migration before closure.
- **rollback path**: Revert the new Spec and Plan, restore `.mcp.json`, restore `runtime/mcp-launcher.ts`, restore MCP blocks in `immune_brain_runtime.ts`, and revert related tests/docs/contracts as one slice.
- **verification strength**: Prefer executable Bun tests, direct CLI smoke commands, plan validation, and automated negative checks over manual reading. The command manifest must be tested as a JSON artifact, not only documented.
- **Brainstorm traceability**: No formal `Brainstorm manifest` was supplied. The user-confirmed scope is captured in `Origin`, `Decisions`, and the Spec requirements.

## Steps

### Step 1

- Step ID: U1
- Result: Runtime exposes a tested CLI-only integration surface.
- Verification type: automated
- Verification: `bun test tests/wrapper-retirement.test.ts tests/autowork-false-completion.test.ts tests/plugin-package-runtime.test.ts tests/activation-plan-runtime-surface.test.ts tests/host-runtime-cutover.test.ts && plugins/immune-brain/bin/imm-work status --json && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-03-002-refactor-cli-only-runtime-plan.md --json && plugins/immune-brain/bin/imm-activation-plan && plugins/immune-brain/bin/imm-heal && echo cli-only-runtime-smoke-passed`
- Execution note: characterization-first
- Test scenarios: Covers plugin-local wrappers for status, plan validation, activation plan, heal, autowork, finish, and dehydrate; Covers runtime usage no longer advertising `mcp`; Covers deleted `.mcp.json` and `mcp-launcher.ts`; Covers removal or rewrite of MCP initialize, `tools/list`, and `tools/call` tests; Covers CLI-native command manifest JSON discovery.
- Discovery cache: plugins/immune-brain/runtime/immune_brain_runtime.ts (`cli` mode and `runImmCommand` dispatch); plugins/immune-brain/bin/imm-plan (wrapper form); plugins/immune-brain/bin/imm-work (wrapper form); plugins/immune-brain/bin/imm-activation-plan (wrapper form); tests/plugin-package-runtime.test.ts (runtime parity surface); tests/activation-plan-runtime-surface.test.ts (activation runtime surface); tests/host-runtime-cutover.test.ts (host entrypoint surface); tests/wrapper-retirement.test.ts (wrapper behavior); docs/specs/2026-07-03-cli-only-runtime.spec.md (accepted CLI-only behavior)
- Agent Hint: imm-executor
- Depends on: none
- failure_behavior: If any CLI command requires MCP code to pass, stop and replan around the missing CLI command contract instead of keeping a hidden MCP dependency.
- security_considerations: Removing MCP should reduce protocol exposure but must not expand shell command authority; wrappers should continue to invoke only known `IMM_COMMANDS`.

### Step 2

- Step ID: U2
- Result: Active contracts describe CLI-only Immune-Brain integration.
- Verification type: automated
- Verification: `bun test && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-03-002-refactor-cli-only-runtime-plan.md --json && python3 -c "from pathlib import Path; active=[Path('README.md'),Path('CONTEXT.md'),Path('IMMUNE.md')]+list(Path('skills').glob('imm-*/SKILL.md'))+list(Path('plugins/immune-brain/dist').glob('imm-*.md'))+list(Path('plugins/immune-brain/skills').glob('imm-*/SKILL.md')); banned=['plugins/immune-brain/.mcp.json','mcp-launcher.ts','tools/list','tools/call','MCP-first','mcpServers']; violations=[]; [violations.append(f'{p}: active MCP instruction remains: {needle}') for p in active if p.exists() for needle in banned if needle in p.read_text(errors='ignore')]; [violations.append(str(p)+' still exists') for p in [Path('plugins/immune-brain/.mcp.json'),Path('plugins/immune-brain/runtime/mcp-launcher.ts')] if p.exists()]; import sys; sys.exit('\\n'.join(violations)) if violations else print('active CLI-only contract checks passed')"`
- Execution note: characterization-first
- Test scenarios: Covers README and architecture docs no longer instructing MCP setup; Covers Skill contracts no longer requiring MCP-first fallback; Covers package or release templates no longer shipping `.mcp.json`; Covers full test suite after MCP-specific tests are rewritten or retired; Covers Spec and Plan validation after active contract migration.
- Discovery cache: README.md (host integration docs); CONTEXT.md (Architecture Map); IMMUNE.md (system constitution runtime surface); skills/imm-code-review/SKILL.md (activation fallback contract); plugins/immune-brain/dist/imm-code-review.md (packaged activation fallback contract); docs/reference/automatic-subagent-activation-policy.md (activation path docs); public-release/templates/README.md (release-facing setup docs); tests/code-review-activation-contract.test.ts (contract wording regression); tests/python-reference-boundary.test.ts (runtime metadata boundary)
- Agent Hint: imm-executor
- Depends on: 1
- failure_behavior: If full contract migration exposes a non-CLI-capable host requirement, record that host as out of scope for CLI-only and keep the runtime slice blocked until the user confirms whether to drop or redesign that host integration.
- security_considerations: Documentation must not encourage arbitrary shell snippets; prefer plugin-local wrapper paths and known command names.

## Validation

- Plan validator: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-03-002-refactor-cli-only-runtime-plan.md --json`
- Runtime sync: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-03-002-refactor-cli-only-runtime-plan.md --sync`

## Notes

- This Plan intentionally ignores historical MCP-preservation decisions because the user explicitly scoped the planning exercise that way.
- The current validation worktree may still contain the earlier uncommitted MCP-removal spike. Executor should either continue from that spike or reset it before applying the Plan, but must record which path was used as execution evidence.
- `list-commands --json` is included to keep CLI-only usable by agent hosts without retaining MCP protocol code.
