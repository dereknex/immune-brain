# Spec: Direct Pi Package Release Surface

**Task ID**: `2026-08-14-002-retire-public-release-sync-surface`
**Owner**: user
**Status**: Proposed
**Design risk**: High

The change retires a repository-level release generator and moves the release
artifact contract to the root Pi package manifest. It crosses release tooling,
package allowlists, active documentation, and regression tests. An incomplete
retirement would leave release commands pointing at a directory that is no
longer generated or would silently publish development-only files.

**Diagram decision**: not_required
**Diagram reason**: Ownership moves in one direction from the deleted sync
script and templates to the existing root `package.json`; there is no runtime
sequence, state machine, or concurrent flow that a diagram would clarify.

## 1. Problem Frame

The repository now has one Pi package and one root package manifest, but it
still carries an older public-repository materialization path:

- `scripts/sync-to-public.sh` copies a curated tree into a sibling directory;
- `public-release/templates/` replaces root documentation in that tree;
- `README.md` describes the sync script as part of release behavior;
- `tests/pi-only-release-contract.test.ts` executes the script and treats its
  generated tree as the package artifact;
- `tests/pi-only-current-contracts.test.ts` treats release templates as active
  product contracts;
- `scripts/plugin_release.ts` defaults `artifact_path` to an
  `immune-brain-public` sibling even though it does not create that directory.

The user has chosen to retain deletion of the sync script and all four release
templates. The deletion cannot close by itself because active release contracts
still require those files.

## 2. Intended Behavior

The root workspace is the only package source. `package.json` remains the sole
version authority and its `files`, `exports`, and `pi` fields define the
publishable Pi package surface.

Release preparation and adapter invocation use these rules:

1. `scripts/plugin_release.ts` validates the root manifest and passes the repo
   root as the default `artifact_path` to a configured publish adapter.
2. `--artifact-path` remains an explicit caller override for adapters that
   intentionally consume another already-existing artifact. The release tool
   does not generate, copy, or synchronize that path.
3. A release invocation without a configured adapter remains fail-closed with
   `publish.status: blocked`; retiring the copied tree does not create an
   implicit publisher.
4. Tests inspect the package manifest and a package-manager dry-run/file list
   rather than constructing a second public repository tree.
5. Active README and test contracts no longer name
   `scripts/sync-to-public.sh`, `public-release/templates/`, or the sibling
   `immune-brain-public` directory.
6. Historical Plans, Specs, archives, and solution records may retain those
   names as historical evidence. They are not production instructions.

## 3. Technical Design

### 3.1 Package ownership

`package.json` is the only release boundary. The retirement must not introduce
another allowlist, copied artifact directory, generated README, or release
manifest. Package-boundary assertions derive expected files from the manifest
and fail if retired host adapters or development-only trees enter the package.

### 3.2 Release adapter contract

`plugin_release.ts` continues to own version validation, tag/push planning, and
external adapter invocation. Its default adapter payload changes from a sibling
public-tree path to the canonical repository root. The existing
`--artifact-path` option remains a direct override and must be reflected
literally in dry-run output. No fallback probes for the retired directory are
allowed.

### 3.3 Documentation and tests

The active root README describes direct Pi package release and validation.
`tests/pi-only-release-contract.test.ts` is rewritten around manifest and direct
package artifact invariants. `tests/pi-only-current-contracts.test.ts` removes
retired templates from its current-contract set. Focused release tests must
prove both default-root and explicit-override adapter payloads.

Historical documents are not bulk-rewritten. Broken active source links in
current docs are in scope only where a current test or user instruction relies
on them; archival references remain untouched.

## 4. Invariants

- Pi remains the only supported code-agent host.
- Root `package.json` remains the sole package and version authority.
- Release tooling does not recreate `public-release/` or invoke the retired
  sync script.
- Default release adapter payload points to the canonical repo root.
- Explicit `--artifact-path` is honored without mutation or generation.
- Missing adapter configuration remains a fail-closed blocked publish phase.
- Package `private` metadata remains unchanged; this task does not enable npm
  publication.
- Package artifact checks reject retired host adapters, internal Plans/Specs,
  and repository-only operational files.
- No Kernel, TaskIntent, or runtime authority behavior changes.

## 5. Failure Behavior

- Missing or malformed root package metadata fails release validation.
- Package-manager artifact inspection failure fails the release contract test;
  it does not fall back to the retired sync path.
- A configured adapter receives an exact artifact path. Adapter failure remains
  a release failure.
- Any active reference to the deleted sync/templates fails focused stale-surface
  assertions.

## 6. Compatibility, Interruption Recovery, Rollback, and Exit

This is a direct retirement, not a compatibility transition. No shim, alias,
dual-write, or temporary copied artifact is introduced. Existing external
adapters that pass `--artifact-path` retain that exact behavior; callers that
relied on the implicit sibling public tree must move to the canonical root
package workspace. There is no persisted data or runtime-state migration.

If execution stops midway, the workspace may temporarily have deleted files
while active tests or docs still reference them. That state is intentionally
fail-loud: focused release tests remain red, no release artifact is generated,
and the next execution resumes from the actual Git delta until all active
callers are migrated. It must not restore a partial compatibility script or
silently skip the failing contracts.

Rollback is a Git revert that restores the script, templates, README wording,
release adapter default, and their tests as one coherent surface. The
retirement is complete when no active release entrypoint or test depends on the
deleted files; there is no temporary mechanism requiring a later cleanup owner.

### 6.1 Plan Boundary and Scope Pressure

The deletion, adapter default, README wording, and focused tests share one
release-contract and rollback boundary: splitting them would leave either dead
active references or an adapter pointing at an artifact no owner generates.
The expected breadth is two tooling/document domains plus focused tests, with
no Kernel/runtime changes and no real publish side effects. Historical bulk
rewrites are excluded because they do not participate in the active release
contract.

## 7. Verification

1. Focused direct-package contract tests prove manifest allowlisting with
   `npm pack --dry-run --json --ignore-scripts`, retired surface absence,
   default-root adapter payload, and explicit override behavior.
2. Current Pi-only documentation contract tests pass without opening deleted
   templates.
3. Focused release tests prove that missing adapter configuration still yields
   a blocked publish phase and never probes the retired sibling tree.
4. `bun scripts/plugin_versioning.ts validate` confirms root manifest authority.
5. Full `bun test` passes against the final workspace.
6. `git diff --check` passes and the actual diff stays within the declared
   release/docs/test scope.

## 8. Scope

Expected implementation paths:

- `scripts/sync-to-public.sh` (delete)
- `public-release/templates/` (delete four tracked templates)
- `scripts/plugin_release.ts`
- `README.md`
- `tests/pi-only-release-contract.test.ts`
- `tests/pi-only-current-contracts.test.ts`
- `package.json` only if direct package artifact verification requires a
  manifest correction
- this Spec and its TaskIntent

Out of scope:

- changing package version, `private` metadata, or publishing a real release;
- invoking release verification with `--apply`, creating tags, or pushing Git
  refs;
- changing Kernel/runtime authority;
- rewriting historical Plans, Specs, archives, or solution evidence;
- creating a replacement public repository generator.

## 9. Devil's Advocate Audit

**Rollback resilience**: The change is one ownership transfer. A single Git
revert can restore the script, templates, release adapter default, README, and
focused tests. No external repository is modified by implementation or
verification.

**Verification vanity**: Existence scans alone are insufficient. Tests must
execute release dry-run/adapter behavior and inspect the direct package file
boundary, so a stale default path, ignored override, or leaked development file
causes a failure.

**Spec dilution detection**: The task does not narrow the user's decision to
merely deleting five files. It includes every active caller and test required
to make those deletions a valid release-contract retirement, while explicitly
excluding historical bulk rewrites and real publishing.
