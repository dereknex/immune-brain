---
"immune-brain": major
---

Configuration moves to contract v2 (ADR 0041, #564). The user file and a local, unversioned project `.imm/config.json` resolve every key request → project → user → default, with permission keys taking the stricter value. `agents` binds four roles (`executor`, `reviewer`, `planner`, `triage`) to a user profile name, shorthand `host[:model][@effort]` or an object; presets, `active`, `projects.<key>`, `lanes`, per-profile `transport` and `enabled_points` are removed, and a top-level `herdr` switch and `batch.max_parallel` replace them. `start_unattended_batch` takes `agents: { executor?, reviewer? }` instead of the flat `executor_*` / `review_*` parameters; a new batch freezes the resolved profiles, and every Executor handoff carries the frozen profile, so a Lane no longer starts without its model. v1 files are reported as `config_invalid`: convert them with `imm-kernel config migrate [--write]`, which keeps the v1 user file as `config.json.v1`.
