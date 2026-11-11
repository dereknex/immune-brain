---
"immune-brain": patch
---

Antigravity `PreToolUse` now builds each `force_ask` confirmation from the same `HostRuntime` path the later MCP call executes, instead of a second batch and task preflight. The preview stops before issuing Batch Authorization or starting a run, and it performs no final verification, tracker write, or critical integration. Single-use grants, digest binding, and refusal after the confirmed workspace changes remain in place.

`preparePiCanary` no longer includes `generated_at` in the owner digest, so a grant written by the Hook process still matches when the MCP server consumes it. Restoring a staged TaskIntent refreshes its Git index stat, so a later projection does not treat the restored sidecar as unstaged. The Antigravity plugin check now rejects generated files that are missing from the derived-files declaration.
