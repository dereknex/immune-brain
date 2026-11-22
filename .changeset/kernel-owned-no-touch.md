---
"immune-brain": minor
---

The Kernel's hard no-touch set is now exactly its own worktree authority root `.imm/state`, imported from `kernel/storage_paths.ts` (kernel-owned-no-touch D1). Credential-type filename patterns, `.github/workflows`, `.changeset/config.json` and their siblings leave the built-in set, so settlement, batch integration, `policy_auto` Enrollment, Loop guard G3 and repair validation all accept them, while `.imm/state/**` keeps refusing with `no_touch_path_changed`. The repository declaration `docs/agents/no-touch.json` (`immune_brain/no_touch/v1`) is retired: it is no longer read, a leftover file is ordinary content, and `readNoTouch`, `readNoTouchAt`, `parseNoTouch` and `NO_TOUCH_PATH` are removed; `noTouchPaths`/`assertNoTouch` take only the paths. A project that wants stronger Review on CI or credential paths declares them in `.imm/risk-floor.json`. ADR 0028 Decision 4 is amended in place.
