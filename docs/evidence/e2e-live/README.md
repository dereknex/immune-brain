# Release evidence

`<version>.json` here is the evidence `scripts/release-promote.ts` checks before it moves the
`stable` branch and npm `latest` to that version. Contract: `immune_brain/e2e_release_evidence/v1`
(Spec `docs/specs/e2e-release-gate.spec.md`, D6).

## Release flow

1. Merging the "chore: version packages" PR publishes the version to npm `next` and tags
   `immune-brain-v<version>` on the release commit. `latest` and `stable` do not move.
2. Dogfood the version from `next`, run `bun run e2e:live` on the release tag, then commit `docs/evidence/e2e-live/<version>.json` to `main`.
3. Run the **Promote** workflow (`workflow_dispatch`, environment `release`) with the version.
   Rollback: run it with `rollback` checked; each run steps back one `-stable` release.

```bash
bun scripts/release-promote.ts 9.2.0        # promote
bun scripts/release-promote.ts --rollback   # previous -stable version
```

## Live evidence

`bun run e2e:live` is the maintainer's L2 run (Spec D6). It needs the maintainer's `claude`, `pi` and
`herdr` logins, `ANTHROPIC_API_KEY` and a macOS Herdr session, so it never runs in CI. Check out the
`immune-brain-v<version>` tag (the run refuses `release_commit_mismatch` when HEAD differs and
`worktree_dirty` when tracked files differ), then:

```bash
bun run e2e:live [--version 9.2.0] [--out-dir docs/evidence/e2e-live]
```

It runs J1 and J2 on `claude` and `pi` and J4 on `claude`, `pi` and `antigravity` (install only), one retry
per journey, within a 30-minute budget. The journeys record their cassettes through the recorder
(`E2E_RECORD=1`) against the low-cost model tier `claude-haiku-5-5` (override with `E2E_LIVE_MODEL`).
A pattern that selects no test counts as a failed attempt, so a Host the journey file does not cover
yet fails visibly instead of passing empty. The file is written even when a journey fails; commit it
(and the re-recorded cassettes) only when every journey passed. Exit code: 0 all passed, 1 a journey
failed, 2 refused before running.

```json
{
  "contract": "immune_brain/e2e_release_evidence/v1",
  "version": "9.2.0",
  "commit": "<40-hex commit that the immune-brain-v9.2.0 tag points at>",
  "mode": "live",
  "hosts": { "claude": "2.1.330", "pi": "1.5.2", "herdr": "0.9.5" },
  "journeys": [
    { "id": "J1", "host": "claude", "result": "pass", "attempts": [ { "result": "pass", "duration_ms": 41200, "log_sha256": "<hex>" } ] }
  ],
  "checklist": []
}
```

A journey with two failed attempts has `result: "fail"` and both attempts. `result` must follow from
`attempts` (1 to 2 entries; a pass is the last attempt passing).

## What promote accepts

Promote accepts only `mode: "live"` evidence with `hosts.claude`, `hosts.pi` and `hosts.herdr`, and a
passing result for every required pair: `J1`/`J2` on `claude` and `pi`, `J4` on `claude`, `pi` and
`antigravity`. Checklist-mode evidence is refused, however complete. Promote refuses, before any
write, with a named code: `invalid_version`, `evidence_missing`, `evidence_invalid` (also malformed
journeys or missing Host versions), `evidence_commit_mismatch`, `evidence_version_mismatch`,
`evidence_mode_unsupported` (checklist or unknown mode), `live_journey_missing`, `live_journey_failed`,
`release_tag_missing`, `stable_not_fast_forward`, `stable_tag_conflict`, `npm_version_missing`.
Rollback refuses with `stable_branch_missing` or `no_previous_stable_tag`. A rerun performs only the
missing writes.

## One-time maintainer setup (repository settings, outside the code)

- Create the `stable` branch at the latest released commit before the first promote, so no
  installed version regresses.
- Protect `stable`; the only allowed pusher is the token in the `STABLE_PUSH_TOKEN` secret.
- Environment `release` with a required reviewer; secrets `STABLE_PUSH_TOKEN` and `NPM_TOKEN`.
- Check once, on the minimum supported `claude` and the current one, that
  `claude plugin marketplace add dereknex/immune-brain && claude plugin install immune-brain`
  resolves the `stable` `plugin.json` version through the `git-subdir` + `ref` source (Spec
  assumption `A3`); raise the documented minimum in `README.md` if it does not.
