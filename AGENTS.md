# Agent Instructions

## Tool Usage Policy
- `context-mode` is active.
- Follow the tool usage hierarchy:
  `ctx_batch_execute` > `ctx_execute` > `ctx_execute_file` > `ctx_search`

## Rules
- Read/edit files → `ctx_execute_file`
- Multi-command research → `ctx_batch_execute`
- Web pages → `ctx_fetch_and_index` then `ctx_search`
- Index docs → `ctx_index`
- Stats → `ctx_stats`
- Doctor → `ctx_doctor`
- Upgrade → `ctx_upgrade`
- Purge → `ctx_purge`
