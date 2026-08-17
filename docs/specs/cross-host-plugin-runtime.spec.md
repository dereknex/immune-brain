# Spec: cross-host plugin runtime

**Task ID**: IMM-PLUGIN-RUNTIME-001
**Owner**: Planner
**Status**: Proposed

## 1. Goal

Immune-Brain must support Codex, Claude Code, and Cursor through host-native
plugin surfaces while preserving one canonical Skill source and removing the
legacy `legacy-installer.sh` managed-copy installer after parity is proven.

The target user experience is:

- Install or enable the Immune-Brain plugin in the host.
- Invoke `imm-planner`, `imm-loop`, or role-specific Immune-Brain Skills from that host.
- Let plugin-local runtime tools perform plan validation, workflow status,
  work transitions, review transitions, heal checks, and dehydration.
- Avoid requiring global `imm-*` shell commands or `plugin skill registry` copies.

## 2. Requirements

### R1. One canonical Skill tree

`plugins/immune-brain/skills/` is the canonical Skill source for all hosts.
The root `skills` symlink may remain for repository development compatibility,
but release and host integration must treat the plugin tree as the source.

No implementation may create separate Codex, Claude Code, or Cursor copies of
the same Skill content.

### R2. Host-native plugin adapters

The plugin must expose host metadata and activation surfaces for all three
targets:

- Codex: `.codex-plugin/plugin.json`, repo or user marketplace metadata, and
  `.mcp.json` for runtime tools.
- Claude Code: `.claude-plugin/plugin.json`, marketplace metadata, and `bin/`
  wrappers when a host-supported bare command is useful.
- Cursor: Cursor-facing plugin metadata when the supported local format is
  verified, with MCP as the required baseline runtime integration.

Cursor support must not rely on undocumented `bin` behavior. If Cursor plugin
skill discovery is not locally verifiable, Cursor support is still acceptable
through MCP plus documented Skill usage constraints.

### R3. Plugin-local runtime tools

Runtime capabilities currently exposed by `imm-*` shell wrappers must be
available without a global installer. The durable interface is host-local:

- Codex and Cursor use MCP tools backed by plugin-shipped scripts.
- Claude Code may use plugin `bin/` wrappers and may also use MCP when shared
  behavior is cheaper to maintain.

The runtime must be self-contained inside the plugin or public artifact. It
must not depend on source checkout paths outside the plugin package after
installation.

### R4. Legacy installer removal

`scripts/legacy-installer.sh` and `scripts/legacy-cli-launcher` may be removed only
after replacement behavior is covered by host-specific smoke tests and docs.

Before removal, any remaining responsibility must be assigned elsewhere:

- Skill discovery -> plugin manifests and marketplaces.
- Runtime commands -> MCP tools or Claude `bin/`.
- Health check -> `imm-heal` via MCP or host-local wrapper.
- Dev insights setup -> explicit setup Skill or runtime tool, not default
  installation side effect.
- Public release sync -> plugin-first file copy.

### R5. Public release is plugin-first

The public release sync must output a plugin-first artifact:

- includes `plugins/immune-brain/` with host manifests, Skills, runtime tools,
  MCP config, and allowed assets;
- includes marketplace metadata required for local testing or project-scoped
  installation;
- excludes internal memory, plans, brainstorms, solutions, upstream submodules,
  and private handoff files;
- no longer treats root `skills/`, `scripts/legacy-installer.sh`, or
  `scripts/legacy-cli-launcher` as the primary install content.

### R6. Documentation prevents double registration

README and public templates must explain that users should not install the same
Immune-Brain Skills through both host-native plugins and legacy
`plugin skill registry` copies.

Docs must clearly distinguish:

- Skill names and authority roles;
- host-local runtime tools;
- deprecated global shell wrappers, if any are temporarily retained.

## 3. Non-goals

- No PyPI or global package publication for `imm_core`.
- No three-way duplication of Skill content.
- No generic cross-host installer that reimplements host plugin managers.
- No guarantee that Codex or Cursor provide Claude-style `bin` PATH behavior.
- No automatic migration or deletion of unknown user-managed files outside the
  repository during this slice.

## 4. Acceptance Criteria

- [ ] Codex, Claude Code, and Cursor host adapters exist or documented Cursor
      fallback is backed by MCP smoke validation.
- [ ] Plugin-local runtime tools cover the current default workflow operations
      without requiring `legacy-installer.sh`.
- [ ] Public release sync outputs plugin-first content and excludes the old
      installer as primary install material.
- [ ] Documentation shows host-specific installation and runtime usage.
- [ ] Tests or smoke scripts prove there is no remaining required reference to
      `scripts/legacy-installer.sh` before it is removed.

## 5. Verification Paths

### V1. Manifest and metadata validation

Run JSON validation over all host manifests and marketplace files, then assert
declared Skill and MCP paths exist.

### V2. Runtime tool smoke validation

Invoke host-neutral runtime tools against a temporary project and verify status,
plan validation, heal, and review-facing commands report deterministic output.

### V3. Public artifact validation

Run `scripts/sync-to-public.sh --output-dir /tmp/test-public-plugin --force`
and assert the artifact contains plugin-first surfaces while excluded internal
paths are absent.

### V4. Legacy removal validation

Run focused tests and grep checks proving user docs, public templates, and
runtime paths no longer require `legacy-installer.sh`.
