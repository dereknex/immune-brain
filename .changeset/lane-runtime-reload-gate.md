---
"immune-brain": patch
---

Lane batches in the plugin source repository pause admission and redo with `runtime_reload_required` after a child integrates a change to the generated MCP bundle, so no new Lane runs a stale runtime. A fresh literal-user resume admits the child, recording `runtime_skew_acknowledged` on the child and in the final report when the loaded build still differs.
