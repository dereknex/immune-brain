---
"immune-brain": minor
---

Add Lane Preferences. A repository can set `Lane max parallel`, `Lane Executor Host`, `Lane Executor model` and `Lane Executor effort` in its root `AGENTS.md` or `CLAUDE.md`; the Parent resolves them (a literal user instruction wins, then the repository, then the user-level file) and uses them as the `max_parallel` argument and as the Executor Host's `--model` and `--effort`/`--thinking` launch arguments. Without a directive nothing changes: the batch is serial unless asked otherwise and the Executor Host runs on its own defaults. The runner reads none of them. The README and `docs/reference/immune-brain-config.md` document the four directives.
