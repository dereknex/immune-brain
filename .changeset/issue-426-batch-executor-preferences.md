---
"immune-brain": patch
---

A lane batch now fixes its Executor preferences when it starts. The batch records the Executor Host, model and effort the request selected as `executor_preferences`, and every Executor generation runs on them, including the one started after a Lane decision, which before this change ignored the request and used whatever `lanes.active` named. When the preferences name an Executor Host, the active profile is no longer consulted, so its model and effort are no longer reported as `not_applied`.
