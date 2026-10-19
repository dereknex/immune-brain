---
"immune-brain": patch
---

The Claude Code MCP server now notices when its own bundle changed on disk after it started. Authority calls (`enroll`, `start_unattended_batch`, `retire_stale_batch`, `advance_assurance`, `submit_review`) then refuse with `plugin_bundle_stale` and ask you to reconnect the immune-brain MCP server, instead of reporting a misleading `run_entry_required`; `status` still answers and carries a warning. In the plugin source repository, a Lane-mode batch start also refuses with `batch_runtime_contract_mismatch` when the loaded plugin build differs from the workspace build. Serial starts are unaffected. See Spec branch-boundary.
