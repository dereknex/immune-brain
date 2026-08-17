---
title: plugin version management automation
type: feat
status: planned
date: 2026-05-22
---

# Spec: plugin version management automation

## Objective

Automate Immune-Brain plugin version management so a release owner can bump,
validate, tag, push, and publish the plugin package through one guarded release
flow instead of manually editing each host manifest and running ad hoc git or
marketplace commands.

The automation must treat the plugin package as the release unit. Codex,
Claude Code, and Cursor metadata should stay version-aligned, while generated
or host-specific files keep their existing boundaries.

## Background

Immune-Brain is distributed as a host-native plugin package under
`plugins/immune-brain/`. The three host manifests currently carry the same
version manually:

- `plugins/immune-brain/.codex-plugin/plugin.json`
- `plugins/immune-brain/.claude-plugin/plugin.json`
- `plugins/immune-brain/.cursor-plugin/plugin.json`

`plugins/immune-brain/skills/registry.yaml` uses `version: 1` as a registry
schema version, not the plugin release version. Public release sync copies the
plugin-first tree but does not alter versions.

Manual version edits are fragile because the same value must be updated in
three places and checked before a release tag or public artifact is produced.
Manual release commands are also easy to run out of order: a tag can be created
before validation, pushed before the public artifact is ready, or published to
the wrong marketplace target.

## Release Automation Design

The release flow should be split into explicit phases:

1. **Plan**: Resolve current version, target version, tag name, current branch,
   remote, and marketplace target. This phase is read-only and powers dry-run.
2. **Bump**: Update the three host manifests to the target SemVer.
3. **Validate**: Run local plugin validation and focused version tests.
4. **Tag**: Create the canonical annotated tag `immune-brain-vX.Y.Z` only after
   validation passes.
5. **Push**: Push the current branch and release tag to the configured remote.
6. **Publish**: Build or sync the public artifact, then invoke a marketplace
   adapter with the artifact path, version, tag, and manifest metadata.

`publish` must be adapter-based because this repository currently contains
local marketplace metadata (`.agents/plugins/marketplace.json`) but no concrete
remote marketplace publish API. The first implementation should provide a
`dry-run` adapter and a command adapter. A real marketplace integration can then
be configured without changing the version semantics.

Every mutating phase must have an explicit dry-run equivalent. The full release
command should default to dry-run unless an apply flag is supplied.

## Requirements

- **R1. Single release version command**: Provide a repo-local command that can
  bump the Immune-Brain plugin version across all host manifests in one run.
- **R2. SemVer discipline**: Support `major`, `minor`, `patch`, and explicit
  SemVer values. Reject invalid or decreasing versions unless a force flag is
  explicitly provided.
- **R3. Dry-run visibility**: Support a dry-run mode that reports the current
  version, target version, and files that would change.
- **R4. Manifest consistency check**: Extend plugin checks so mismatched host
  manifest versions fail clearly.
- **R5. Release tag guidance**: Define the canonical tag format as
  `immune-brain-vX.Y.Z` and check that the tag version matches the manifests
  when a tag value is supplied.
- **R6. Public release compatibility**: Keep `scripts/sync-to-public.sh`
  file-copy based. Version automation must happen before sync, not inside the
  public artifact copy path.
- **R7. Documentation truth**: README or release docs must describe the version
  source of truth, bump command, validation command, tag format, and rollback
  behavior.
- **R8. Regression coverage**: Unit tests must cover valid bumps, invalid
  versions, manifest mismatch detection, dry-run behavior, and tag mismatch
  handling.
- **R9. Guarded tag creation**: Provide an automation phase that creates
  annotated tags in the canonical format only when manifest versions are
  aligned and validation passes.
- **R10. Guarded push**: Provide an automation phase that pushes the current
  branch and release tag only after tag creation succeeds. The remote and branch
  must be visible in dry-run output.
- **R11. Marketplace publish adapter**: Provide a publish phase that sends the
  prepared public artifact to a configured marketplace adapter. If no adapter is
  configured, release automation must stop with a clear degraded status instead
  of pretending publish succeeded.
- **R12. Release rollback guidance**: Document rollback separately for three
  cases: pre-tag local bump, pushed tag, and marketplace publish.
- **R13. Idempotency and duplicate handling**: Re-running release automation for
  an existing version must detect existing tags, already-pushed refs, and
  already-published marketplace versions before mutating state.

## Non-goals

- No changelog generator in this slice.
- No GitHub Actions release pipeline in this slice.
- No automatic PR creation.
- No change to `skills/registry.yaml` schema version semantics.
- No version rewrite inside `scripts/sync-to-public.sh`.
- No hard-coded marketplace credential, endpoint, or token.
- No default real publish without explicit adapter configuration.

## Acceptance

- A release owner can run one command to preview a patch bump and one command
  to apply it across all three manifests.
- Plugin validation fails if Codex, Claude Code, and Cursor manifest versions
  diverge.
- A dry-run release shows planned bump, validation, tag, push, artifact, and
  marketplace publish phases before any mutation.
- An applied release can create `immune-brain-vX.Y.Z`, push the branch and tag,
  and call the configured marketplace adapter.
- If marketplace publish is not configured, the flow reports a blocked publish
  phase after successful local preparation rather than marking the release
  complete.
- The release tag format and manifest version relationship are documented.
- Public release sync continues to copy the already-versioned plugin package.
- Focused tests prove the bump and validation behavior without requiring git
  network access or external services.
