# Maintenance Surface Ownership

## Context

Architecture exploration identified visible duplication across planning history,
host manifests, packaged documentation, and Skill contracts. Repository evidence
shows that these surfaces serve different consumers and failure modes. Removing
them solely because their content overlaps would weaken compatibility or release
verification.

## Decision

1. Planning artifact lifecycle (archival vs active) is governed by `docs/reference/planning-artifact-retention.md`, which defines terminality signals (S1 filename substring ∨ S2 citation over `docs/plans/archive/`), move-only archival with byte-preserving `R` rename, link rewrite, and named exemptions. Non-terminal artifacts remain durable at their existing paths by default.
2. Root `package.json` is the sole Pi package and version manifest. Non-Pi code-agent consumers were retired after their adapter directories, install routes, and release contracts ceased to be supported; `scripts/plugin_versioning.ts` now validates and mutates only this authority.
3. Repository docs remain authoring sources for classified packaged references. Checked-in `plugins/immune-brain/dist/` remains self-contained package output, verified by `scripts/sync-dist-docs.ts --check` and the dist sync contract tests.
4. `plugins/immune-brain/skills/*/SKILL.md` remains the host-discoverable entry surface. `plugins/immune-brain/dist/*.md` remains the detailed packaged instruction surface.
5. Current workflow guidance belongs in `docs/solutions/`. Legacy documentation paths may remain as compatibility pointers when current or historical links depend on them.

## Rejected Alternatives

- A common manifest schema or adapter generator: the supported product has one Pi package authority, so a generator would recreate consumers that no longer exist.
- Untracked build-only `dist/` output or symlinks: installed plugins cannot depend on repository source paths or upstream submodules.
- A generator for thin `SKILL.md` entry files: it would add machinery without removing a distinct consumer or contract.
- Bulk archival of completed Plans and Specs on completion alone (without terminality signals): completion without S1/S2 signals or sidecar terminality does not prove a path has no current consumer; current practice archives only when `S1 ∨ S2` or sidecar terminality holds and no protected exemption applies.

## Consequences

- Literal duplication remains only where distinct active consumers require it, notably Pi Skill entry shims versus packaged `dist` instructions.
- Maintenance checks stay executable through existing version, dist, registry, and package-runtime tests.
- Simplification work must identify a redundant consumer or broken ownership rule before introducing a migration.
- The repository gains an explicit retention gate instead of relying on file count or age as deletion criteria.
- Archival layout (349 Plans / 236 specs as of this slice) is enforced by `tests/planning-artifact-archival.test.ts` and `tests/retention-policy-consistency.test.ts`; retention policy and ADR 0002 jointly govern future moves and agree on one policy.
