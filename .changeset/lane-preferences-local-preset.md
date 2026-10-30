---
"immune-brain": major
---

Lane preferences move to a personal, gitignored preset `.imm/lanes.local.json` with named `profiles` and an `active` field; a request may name a profile and overlay single fields for one batch, and a malformed file, unknown profile, unknown key or invalid value stops the batch from starting. **Breaking:** the `Lane max parallel`, `Lane Executor Host`, `Lane Executor model` and `Lane Executor effort` directives in `AGENTS.md`, `CLAUDE.md` or a user-level instruction file are no longer read, and the `Batch final verification` directive is removed. Migration: copy the old directive values into a profile of `.imm/lanes.local.json` (`max_parallel`, `executor_host`, `executor_model`, `executor_effort`), set it as `active`, add the file to `.gitignore`, and delete the old lines; name final-verification commands in the request or as the full test and type-check commands in your instruction file's prose. See ADR 0033.
