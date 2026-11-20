---
"immune-brain": minor
---

Refuse a Lane batch only on runtime contract identifiers (Spec lane-runtime-contract-check D1-D4): `laneRuntimeContractRefusal` no longer refuses on `pluginSourceSkewWarning`, so a loaded plugin build that differs byte-wise from the workspace plugin stays the non-blocking `loaded_plugin_differs_from_workspace` status warning; a claude-code Lane Executor gets `--plugin-dir <runtimeClaudePluginDir()>` in its argv so it loads the coordinator's own plugin; and `batch_runtime_contract_mismatch` becomes its own batch reason with a same-Host recovery action, leaving `batch_run_rejected` unchanged.
