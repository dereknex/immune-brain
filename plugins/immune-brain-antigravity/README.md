# Immune-Brain for Antigravity

Independently installable Antigravity plugin for Immune-Brain: public skills, native
read-only role definitions, hooks, the bundled MCP server and the `imm-*` CLI wrappers.
Everything it references resolves inside this directory; install this directory, not
`plugins/immune-brain/` (the Pi and Claude Code root).

## Install

```sh
agy plugin install ./plugins/immune-brain-antigravity
agy plugin validate ./plugins/immune-brain-antigravity --strict
```

The npm package ships this directory as `plugins/immune-brain-antigravity/`. Existing
installs of the former shared-root manifest must be reinstalled from this directory.

## Layout

| Path | Owner |
| --- | --- |
| `.antigravity-plugin/plugin.json`, `mcp_config.json`, `hooks.json`, `README.md` | Maintained here; the manifest version is stamped from the root `package.json` |
| `agents/` | Generated native role definitions: reviewer, review verifier, QA, UI review, advisory reviewer. Read-only tools, no shell |
| `skills/`, `bin/`, `runtime/`, `dist/`, `BASELINE.md` | Generated from `plugins/immune-brain/` |
| `dist/antigravity/mcp-server.mjs` | Generated MCP server and hook bundle |

Do not edit generated paths. Regenerate with `bun scripts/build-antigravity-plugin.ts`;
`bun scripts/build-antigravity-plugin.ts --check` fails on changed, missing or stale
generated files and never writes.

## Known limitation: native reviewer and verifier

The native reviewer and review-verifier definitions are read-only and have no shell tool.
Immutable Git access and review-packet hash verification by those native roles are not
certified: the shared Review prompt expects immutable Git commands and packet hash
checks that a shell-less native role cannot run. This package does not grant shell tools,
copy source into the review packet, or change shared Review authority. The complete
Managed lifecycle (Enrollment, QA, Review, completion) with CLI-backed Review is live-certified
on Antigravity. Package checks verify the read-only restrictions and this disclosure.

### Review CLI residual risk (`review_host: antigravity`)

`review_host: antigravity` remains supported as `guard-only` (port P5). Unlike Claude Code,
`agy --print` has no CLI restriction flags to restrict tools or enforce read-only execution.
The runtime relies on the post-review tree guard comparing HEAD, the index, and tracked
worktree content; untracked files are uncovered by the tree guard. Neither CLI invocation
nor native roles provide preventive read-only isolation, and native Antigravity Review is
not certified.

## Hooks and MCP

Hook commands run from the plugin directory (`node "./dist/antigravity/mcp-server.mjs" --hook`)
and need no `PLUGIN_ROOT`. The MCP server is resolved with `${PLUGIN_ROOT}`.

### Managed native gates

Managed operations requiring literal-user native confirmation return `force_ask` from
`PreToolUse` and write a confirmation grant. Whether a dialog actually surfaces is `agy`'s
decision: the adapter does not inspect `toolPermission` or the `agy` launch flags. Under
`always-proceed`, `--dangerously-skip-permissions`, `--print`, or `-p`, `agy` auto-approves
and the grant is still recorded as a `confirm` reference, so use `request-review` in an
interactive `agy` session when the record must reflect a human answer.

If `~/.gemini/antigravity-cli/settings.json` also has a `permissions.allow` rule covering
the Managed call (for example `mcp(immune-brain_immune-brain/stop)`), `agy` skips the
interactive dialog and the adapter records that standing authorization with the
`allow-rule` reference kind (`antigravity-allow-rule-<hash>`) instead of `confirm`.
