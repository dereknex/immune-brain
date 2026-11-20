---
"immune-brain": minor
---

The Kernel's built-in hard no-touch set protects only its own worktree authority root `.imm/state`, imported from `kernel/storage_paths.ts` (kernel-owned-no-touch D1-D5): credential-type filename patterns, `.github/workflows`, `.changeset/config.json` and their siblings leave the built-in set, so settlement, batch integration, `policy_auto` Enrollment, Loop guard G3 and repair validation all accept them, while `.imm/state/**` and every path declared in `docs/agents/no-touch.json` keep refusing with `no_touch_path_changed`. Protection is now ownership plus declaration; ADR 0028 Decision 4 is amended in place and the exported `noTouchPaths`/`assertNoTouch`/`readNoTouch`/`readNoTouchAt` signatures are unchanged.
