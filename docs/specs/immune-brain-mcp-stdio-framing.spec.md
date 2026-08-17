# Spec: immune-brain MCP stdio framing

**Task ID**: IMM-MCP-STDIO-001
**Owner**: Planner
**Status**: Proposed

## 1. Goal

Immune-Brain's published plugin runtime must complete the MCP `initialize`
handshake with standard stdio MCP clients used by Codex and Claude Code.

The target user experience is:

- Enable or install the published `immune-brain` plugin.
- Let the host start `python3 ./dist/immune_brain_runtime.py mcp`.
- Receive a valid MCP initialize response instead of
  `connection closed: initialize response`.

## 2. Problem

`plugins/immune-brain/dist/immune_brain_runtime.py` currently reads stdin as
newline-delimited JSON. Standard MCP stdio clients frame messages with
`Content-Length` headers followed by a JSON body. When a framed initialize
request reaches the runtime, the header line is parsed as JSON and the client
does not receive a valid initialize response.

## 3. Requirements

### R1. Standard MCP stdio framing

The runtime must parse inbound `Content-Length` frames and read the exact JSON
body length before dispatching a JSON-RPC message.

### R2. Framed JSON-RPC responses

The runtime must write JSON-RPC responses as MCP stdio frames:
`Content-Length: <byte-count>\r\n\r\n<body>`.

### R3. Published plugin path remains valid

The existing `.mcp.json` command surface remains:
`python3 ./dist/immune_brain_runtime.py mcp`.

### R4. Tool behavior remains unchanged

The fix must not change tool names, tool schemas, command mapping, or workflow
state behavior.

### R5. Regression coverage

Automated tests must cover a framed `initialize` request against the plugin
runtime entrypoint.

## 4. Non-goals

- No new MCP tool names.
- No changes to Plan, State Ledger, QA, or workflow command semantics.
- No host-specific workaround for Codex or Claude Code.
- No global installer or shell wrapper changes.

## 5. Acceptance Criteria

- [ ] A standard framed MCP `initialize` request receives a framed JSON-RPC
      response with `protocolVersion`, `serverInfo`, and `capabilities`.
- [ ] Existing `tools/list` and `tools/call` behavior remains available through
      the same runtime entrypoint.
- [ ] Existing plugin metadata validation still passes.
- [ ] The fix works from a plugin-only copy, not only from the source checkout.

## 6. Verification Paths

### V1. Framed handshake smoke test

Run a unittest that starts `plugins/immune-brain/dist/immune_brain_runtime.py
mcp`, sends a `Content-Length` framed `initialize` request, and asserts the
framed response body is valid JSON-RPC.

### V2. Plugin metadata and copy compatibility

Run the existing plugin contract tests to verify `.mcp.json`, bin wrappers, and
plugin-only copy behavior remain valid.
