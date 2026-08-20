---
title: "fix: support standard MCP stdio framing"
type: fix
status: proposed
date: 2026-05-22
origin: "User reported that the published immune-brain plugin fails MCP startup for Codex and Claude Code when using standard MCP stdio."
---

# Iteration Plan

## Task
- Summary: Fix the published Immune-Brain plugin MCP runtime so standard MCP
  stdio clients can complete `initialize`.
- Origin: User clarified that Codex and Claude Code both use standard MCP and
  the failure occurs from the published plugin directory.
- Spec: docs/specs/archive/immune-brain-mcp-stdio-framing.spec.md
- Brainstorm manifest: BR-REQ-1, BR-REQ-2, BR-REQ-3, BR-REQ-4, BR-DEC-1, BR-OUT-1
- Research: `CONTEXT.md` defines the plugin-local runtime as
  `plugins/immune-brain/dist/immune_brain_runtime.py`; `.mcp.json` starts
  `python3 ./dist/immune_brain_runtime.py mcp`; existing tests verify plugin
  metadata and plugin-only CLI wrapper behavior but do not cover standard MCP
  `Content-Length` framing; local smoke showed newline-delimited JSON receives
  an initialize result while a framed request is parsed as invalid JSON.
- Decisions:
    - D1: Treat this as a protocol compatibility fix in the MCP stdio adapter.
    - D2: Preserve the existing `.mcp.json` command and all tool names.
    - D3: Add regression coverage at the runtime entrypoint, not only helper
      functions, so the published plugin path is covered.
- Assumptions:
    - Standard MCP clients require `Content-Length` framed stdin/stdout.
    - Backward compatibility for newline-delimited local smoke usage is useful
      only if it does not complicate the standard framed path.
- Scope Mode: One-step fix
- Engineering Closure Check:
  - architecture_surface: `plugins/immune-brain/dist/immune_brain_runtime.py`,
    MCP runtime tests, plugin contract tests
  - dependencies_known: yes; Python standard library is sufficient
  - verification_path: framed MCP handshake unittest plus existing plugin
    contract tests
  - blockers: none
  - replan_condition: if the host requires a non-stdio MCP transport or a
    different plugin manifest command shape

## Brainstorm Manifest
| ID | Item |
|----|------|
| BR-REQ-1 | Parse standard MCP `Content-Length` stdio frames |
| BR-REQ-2 | Return framed JSON-RPC responses for initialize and tool methods |
| BR-REQ-3 | Keep published plugin `.mcp.json` command unchanged |
| BR-REQ-4 | Add automated regression coverage for framed initialize |
| BR-DEC-1 | Fix the MCP protocol adapter only, not workflow command semantics |
| BR-OUT-1 | No host-specific Codex or Claude workaround |

## Brainstorm Trace
| Item | Status | Target | Reason |
| ---- | ---- | ---- | ---- |
| BR-REQ-1 | covered_by_step | U1 | Standard MCP startup depends on inbound frame parsing |
| BR-REQ-2 | covered_by_step | U1 | Clients expect framed JSON-RPC responses |
| BR-REQ-3 | captured_as_decision | D2 | The existing published plugin command remains the entrypoint |
| BR-REQ-4 | covered_by_step | U1 | Regression test proves the observed startup path |
| BR-DEC-1 | captured_as_decision | D1 | The bug is isolated to the transport adapter |
| BR-OUT-1 | out_of_scope | out_of_scope | A protocol-compliant adapter should work across hosts |

## Steps

### Step 1
- Step ID: U1
- Result: Standard MCP clients can initialize the immune-brain runtime
- Verification Type: automated
- Verification: `python3 -m unittest tests.test_immune_brain_mcp_runtime tests.test_skill_contracts`
- Depends on: none
- Scope: `plugins/immune-brain/dist/immune_brain_runtime.py`, `tests/test_immune_brain_mcp_runtime.py`, `tests/test_skill_contracts.py`
- Discovery cache: plugins/immune-brain/dist/immune_brain_runtime.py (MCP stdio adapter); plugins/immune-brain/.mcp.json (published runtime entrypoint); tests/test_skill_contracts.py (existing plugin contract coverage)
- failure_behavior: If framed initialize still fails, stop before changing workflow tools and inspect the exact stdio bytes exchanged with the host.
- Test scenarios: framed initialize returns a framed JSON-RPC result; malformed framed input returns a JSON-RPC parse error without crashing the process; existing plugin metadata and plugin-only copy tests remain valid.
