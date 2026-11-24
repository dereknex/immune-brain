---
"immune-brain": minor
---

Publish new versions to the npm `next` dist-tag only, add the L1 black-box `e2e` CI gate and
`e2e-escape-rule`, and add a manual `promote` workflow that advances the default channels. A merged
version PR no longer moves npm `latest`. `scripts/release-promote.ts` (run by
`.github/workflows/promote.yml`) fast-forwards the `stable` branch to the `immune-brain-vX` release
commit, tags `immune-brain-vX-stable` and sets npm `latest`, but only for a version whose committed
live evidence (`docs/evidence/e2e-live/<version>.json` with `mode: "live"` from `bun run e2e:live`)
names that commit; `--rollback` restores the previous `-stable` version. The Claude Code marketplace
entry now installs the plugin from the `stable` branch through a `git-subdir` source, and
Antigravity installs from a `stable` checkout. Pi users who want a version before it is promoted
install `immune-brain@next`.
