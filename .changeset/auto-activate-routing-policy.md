---
"immune-brain": minor
---

Auto-activate absent managed-task routing policy during explicit imm-planner runs.

- In unowned repositories missing `managed-task-routing-policy.json`, explicit `imm-planner` entry now creates and stages the canonical `kernel_task_intent` routing policy automatically before authoring, removing redundant manual setup prompts.
- Existing invalid, untracked, unreadable, or divergent routing policy files remain fail-closed as `routing_policy_invalid` and are not overwritten.
- Task execution continues to require the native Host Enrollment confirmation gate.
