---
"immune-brain": minor
---

Send the Claude reviewer only the parameters its `Agent` tool accepts, and pin the read-only tool boundary of its native definition.

- The Claude Review dispatch envelope is now exactly `{ name, prompt }`; the receiver-less `max_turns` and `run_in_background` are gone, so a Parent copying the envelope unchanged no longer passes two parameters the Host rejects. `ReviewRequest.maxTurns` stays on the shared type because the Pi port forwards it natively.
- A package test reads the shipped reviewer frontmatter and requires the allowlist to be exactly `Read, Grep, Glob, Bash`, so `Agent`, `Edit`, `Write` and `NotebookEdit` stay natively denied, and rejects the `hooks`, `mcpServers` and `permissionMode` keys that a plugin agent ignores and would otherwise read as enforced.
- Reservation binding, hook observation, settlement and every blocked Review result with its reason, release decision and `recovery_action` are unchanged.
