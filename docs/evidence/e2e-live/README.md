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

`bun run e2e:live` is the maintainer's L2 run (Spec D6). It drives real `claude` and `pi` binaries
against the real Anthropic API (while Lane panes run through the harness's spawning `fake-herdr`,
and the installed `herdr --version` is recorded in `hosts`) with `ANTHROPIC_API_KEY`, so it never
runs in CI; dogfooding inside a real interactive Herdr TUI session on `next` is done alongside it
before promoting. Check out the `immune-brain-v<version>` tag (the run refuses
`release_commit_mismatch` when HEAD differs and `worktree_dirty` when tracked files differ), then:

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

1. **Create and push the `stable` branch before merging the `.claude-plugin/marketplace.json` `git-subdir` change**, pointing at the latest released commit so Claude Code and Antigravity installs do not break on merge:
   ```bash
   git branch stable immune-brain-v9.1.0
   git push origin stable
   ```
2. **Verify `A3` live**: on both `claude.minimum` and the current `claude` CLI, confirm `claude plugin marketplace add dereknex/immune-brain && claude plugin install immune-brain` (and `claude plugin update immune-brain`) resolves `stable`'s `plugin.json` version via the `git-subdir` + `ref: "stable"` source; raise `claude.minimum` in `tests/e2e/hosts.json` and `README.md` if an older version does not support it.
3. **Protect `stable`**: restrict pushes so only the `STABLE_PUSH_TOKEN` actor can push `stable` and `immune-brain-v*-stable` tags. Note that `--rollback` uses `git push --force-with-lease`, so the branch protection / ruleset must allow force-pushes by that actor (or omit force-push blocks for it).
4. **Configure the `release` GitHub Environment**: require at least one reviewer and add secrets `STABLE_PUSH_TOKEN` (repo push + tag write access) and `NPM_TOKEN` (npm automation/granular token with `dist-tag` write permission on `immune-brain`, separate from `release.yml`'s OIDC Trusted Publishing).
5. **Protect `main` with required status checks**: enable branch protection / ruleset on `main` requiring `Typecheck, build and test`, `Host e2e journeys`, and `e2e escape rule`.
