> Historical note: pre-TypeScript-migration artifact; file paths reference the retired Python runtime/tests.

# Spec: OpenCode MCP Integration

**Task ID**: IMM-OPENCODE-MCP-001
**Owner**: Planner
**Status**: Proposed
**Date**: 2026-06-27

## 1. Goal
Support OpenCode as a first-class Model Context Protocol (MCP) host alongside Claude Code, Cursor, and Codex, without introducing new tech dependencies (such as Bun, TypeScript compiler, or JS plugins) to the repository.

---

## 2. Target Design

### 2.1 Bootstrap Cache Extension
OpenCode installs plugins locally to project configurations or caches them globally in the user home directory. To let OpenCode locate the `immune-brain` python runtime when loaded via `mcpServers` settings, we expand the inline python bootstrap script in `plugins/immune-brain/.mcp.json`.

We append the glob pattern `'.opencode/plugins/cache/immune-brain/*'` to the roots list builder:
```python
roots += [Path(path) for pattern in (
    '.claude/plugins/cache/immune-brain/immune-brain/*',
    '.codex/plugins/cache/agent-skills/immune-brain/*',
    '.cursor/plugins/cache/*/immune-brain/*',
    '.opencode/plugins/cache/immune-brain/*'
) for path in sorted(glob.glob(str(home / pattern)), reverse=True)]
```

### 2.2 Test Parity
The contract test `test_plugin_local_runtime_surfaces_exist` in `test_skill_contracts.py` performs exact string matching on the bootstrap script arguments. This test must be updated to align with the new path glob pattern.

### 2.3 User Documentation
The [README.md](README.md) will be updated to document the recommended `opencode.json` (or `opencode.jsonc`) config snippet so that users know how to run the `immune-brain` MCP server natively within OpenCode.

---

## 3. Constraints
* **No Bun/TS Build Chain**: Do not write native JavaScript/TypeScript plugins or commands that require Node/Bun packaging/build pipelines.
* **Preserve Parity Tests**: All existing unittest fixtures and plugin package checks must pass.
