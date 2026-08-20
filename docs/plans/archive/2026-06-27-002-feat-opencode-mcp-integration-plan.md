> Historical note: pre-TypeScript-migration artifact; file paths reference the retired Python runtime/tests.

# Iteration Plan

## Task

- Summary: Implement OpenCode MCP support by adding its cache path to the bootstrap script in `.mcp.json`, updating skill contract tests, and documenting the configuration in `README.md`.
- Origin: `imm-brainstorm` analysis of how to support the OpenCode coding agent without introducing Bun or TypeScript compile-time dependencies.
- Spec: docs/specs/archive/opencode-mcp-integration.spec.md
- Research: [README.md](README.md) contains the developer instructions for installing and running standard MCP servers. `test_skill_contracts.py` contains test coverage for local runtime surfaces and checks `.mcp.json` script arguments.
- Decisions: D1 Do not write custom JS/TS plugins or commands, avoiding Bun/TS compile dependencies. D2 Expose standard stdio MCP instead.
- Assumptions: The python stdio JSON-RPC MCP server is fully compatible with OpenCode's MCP host client.
- Scope Mode: Hold Scope — complete integration in one step.

## Output Language

- Human-readable prose: English for Spec and Plan documents
- Preserved literals: file paths, skill names, command names, configuration keys

## Brainstorm Manifest

| ID | Item |
|----|------|
| BR-REQ-1 | Add search path `.opencode/plugins/cache/` to `.mcp.json` python bootstrap |
| BR-REQ-2 | Update unittest `test_plugin_local_runtime_surfaces_exist` in `test_skill_contracts.py` |
| BR-REQ-3 | Document the `opencode.json` MCP configuration snippet in `README.md` |
| BR-DEC-1 | Do NOT write any native JS/TS plugins for OpenCode |
| BR-OUT-1 | Custom commands/plugins in OpenCode format are out of scope |
| BR-DEFER-1 | Automatic installation of python dependencies via npm is deferred |

## Brainstorm Trace

| ID | Status | Reason / Mapping |
|----|--------|------------------|
| BR-REQ-1 | covered_by_step | Map to Step 1 (U1) |
| BR-REQ-2 | covered_by_step | Map to Step 1 (U1) |
| BR-REQ-3 | covered_by_step | Map to Step 1 (U1) |
| BR-DEC-1 | captured_as_decision | Described in Decisions section |
| BR-OUT-1 | out_of_scope | Out of scope |
| BR-DEFER-1 | deferred | Deferred |

## Devil's Advocate Audit

### 1. Rollback Resilience

- Risk: Modifying `.mcp.json` could cause existing Cursor or Claude Code plugins to fail if python path resolution breaks.
- Mitigation: We are strictly appending a new cache pattern to the `roots` list search in python. The existing patterns for Claude, Codex, and Cursor remain completely untouched and take precedence in search order, so there is zero risk to existing clients. Rollback is a simple `git checkout` of the affected files.

### 2. Verification Vanity

- Risk: Test only checks that files are present and strings match, but the actual command fails to execute in python.
- Mitigation: We execute `PYTHONPATH=.imm python3 -m unittest discover -s tests` which loads the module, compiles the inline script python string, and validates its syntax.

### 3. Spec Dilution Detection

- Risk: The requirement to avoid Bun and new dependencies is violated during execution.
- Mitigation: We explicitly specify D1 and check the change surface to ensure no new files (like `.js`, `.ts`, `package.json`, or node configs) are added.

## Planning Quality Gate

- contract surface: `plugins/immune-brain/.mcp.json` (host bootstrap command), `tests/test_skill_contracts.py` (contract regression surface), `README.md` (user documentation).
- compatibility: Standard MCP clients are unaffected; the change is additive.
- interruption recovery: Small change surface; can be rolled back or completed in one command.
- rollback path: `git checkout plugins/immune-brain/.mcp.json tests/test_skill_contracts.py README.md`
- verification strength: Executing the full unit test suite ensures no syntax errors or package mismatches.
- Brainstorm traceability: Complete coverage in Brainstorm Trace.

## Steps

### Step 1

- Step ID: U1
- Result: OpenCode MCP support implemented
- Scope: `plugins/immune-brain/.mcp.json` (add cache path), `tests/test_skill_contracts.py` (align assertions), `README.md` (add documentation)
- Discovery cache: plugins/immune-brain/.mcp.json (mcp definition); tests/test_skill_contracts.py (skill contract tests); README.md (user guidance)
- Verification: Execute unit tests to verify:
  `PYTHONPATH=.imm python3 -m unittest tests/test_skill_contracts.py`
  Check git status to verify no new dependencies (no js/ts files) are added:
  `git status`
- Verification type: automated
- failure_behavior: Revert edits if tests fail, adjust string parsing.
- security_considerations: None.
- Depends on: none

## Validation

- Plan validator: `python3 .imm/imm-plan.py docs/plans/2026-06-27-002-feat-opencode-mcp-integration-plan.md --json`
- Planned verification: `PYTHONPATH=.imm python3 -m unittest tests/test_skill_contracts.py`
