---
"immune-brain": minor
---

Recover inside one `imm-run` entry instead of pausing. Both continuation hooks now allow two native-operation failures per entry before the third pauses the run. A Claude Stop that repeats with no progress after one nudge yields the turn instead of pausing, so a run waiting on background work keeps going. A pause, or an interrupted Pi turn, ends the entry token, so the MCP server itself refuses token-backed calls until a new literal entry. The Loop contract and BASELINE state the retry rules, the native gate kept on `enroll` and batch start, the separately committed deterministic preflight fix, and the stops that remain with the user (ADR 0025).
