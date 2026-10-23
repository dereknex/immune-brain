---
"immune-brain": patch
---

Repair the branch-boundary-r2 regressions. Claude and Pi now refuse a single-task Enrollment with `workspace_not_clean` before opening the native gate when the workspace has dirt outside the TaskIntent and its bound Spec, so the user never confirms an Enrollment the Kernel then refuses (Spec branch-boundary-r2 D23). Both hosts also refuse `approve_breaking_intent_revision` before the gate when the proposed revision is not breaking, since a scope-only change is compatible (D20). Under branch delivery another task's unstaged planning draft no longer blocks this task's snapshot. The Loop contract again routes a goal, bound Spec or decomposition change to Planner's Enrolled Intent Revision route. Tests outdated by D18–D23 now assert the new behavior and cite the decision.
