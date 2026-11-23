# Release evidence

`<version>.json` here is the evidence `scripts/release-promote.ts` checks before it moves the
`stable` branch and npm `latest` to that version. Contract: `immune_brain/e2e_release_evidence/v1`
(Spec `docs/specs/e2e-release-gate.spec.md`, D6).

## Release flow

1. Merging the "chore: version packages" PR publishes the version to npm `next` and tags
   `immune-brain-v<version>` on the release commit. `latest` and `stable` do not move.
2. Dogfood the version from `next`, then commit `docs/evidence/e2e-live/<version>.json` to `main`.
3. Run the **Promote** workflow (`workflow_dispatch`, environment `release`) with the version.
   Rollback: run it with `rollback` checked; each run steps back one `-stable` release.

```bash
bun scripts/release-promote.ts 9.2.0        # promote
bun scripts/release-promote.ts --rollback   # previous -stable version
```

## Checklist evidence

```json
{
  "contract": "immune_brain/e2e_release_evidence/v1",
  "version": "9.2.0",
  "commit": "<40-hex commit that the immune-brain-v9.2.0 tag points at>",
  "mode": "checklist",
  "hosts": {},
  "journeys": [],
  "checklist": [
    { "item": "dogfooded on npm next", "checked": true },
    { "item": "Claude Code marketplace install checked", "checked": true }
  ]
}
```

Promote refuses, before any write, with a named code: `invalid_version`, `evidence_missing`,
`evidence_invalid`, `evidence_commit_mismatch`, `evidence_version_mismatch`,
`evidence_mode_unsupported` (only `checklist` is accepted until live evidence lands),
`checklist_unchecked` (also an empty checklist), `release_tag_missing`,
`stable_not_fast_forward`, `stable_tag_conflict`, `npm_version_missing`. Rollback refuses with
`stable_branch_missing` or `no_previous_stable_tag`. A rerun performs only the missing writes.

## One-time maintainer setup (repository settings, outside the code)

- Create the `stable` branch at the latest released commit before the first promote, so no
  installed version regresses.
- Protect `stable`; the only allowed pusher is the token in the `STABLE_PUSH_TOKEN` secret.
- Environment `release` with a required reviewer; secrets `STABLE_PUSH_TOKEN` and `NPM_TOKEN`.
- Check once, on the minimum supported `claude` and the current one, that
  `claude plugin marketplace add dereknex/immune-brain && claude plugin install immune-brain`
  resolves the `stable` `plugin.json` version through the `git-subdir` + `ref` source (Spec
  assumption `A3`); raise the documented minimum in `README.md` if it does not.
