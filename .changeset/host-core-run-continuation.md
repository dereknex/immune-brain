---
"immune-brain": patch
---

Run continuation session state moves into the host-neutral `host-core` layer: `plugins/immune-brain/runtime/host-core/run_continuation_session.ts` now owns the Claude Code session metadata files, the one-use tool-call correlation, pause, the native-failure counter and binding migration, driven by typed Host events, and the Antigravity Stop rule is a pure function there over the task projection. `claude/run_continuation.ts` keeps only payload parsing, transcript boundary and output rendering, and `antigravity/run_continuation.ts` keeps payload parsing and rendering, so neither adapter keeps a second copy of the automated obligations. Session metadata past the 256 KiB bound now reads as a blank session instead of a verification fault. Behavior is otherwise unchanged; no user-visible change (#414).
