---
"immune-brain": minor
---

Deterministic QA no longer interprets the `#!` line of a command. The entry file found through the absolute-entry `PATH` (or inside the project for `./file`) is identity-pinned and executed directly, and the operating system resolves any interpreter, so a tool reached through a version-manager shim, or one using `env -S`, now runs instead of being refused. `FrozenCommand` carries the entry only, and the execution digest drops its `interpreter` member. The Planner contract names `executable: "sh"` with `argv: ["-c", "<line>"]` as the way to write a compound command.
