---
"immune-brain": minor
---

Retire the critical user approval gate from Kernel settlement. Fresh QA and any required Review now settle tasks automatically; the former critical-completion confirmation gate is removed, and `request_authorization` is reserved for unresolved user decisions and explicit stop. User authority stays bound to unresolved decisions, explicit stop, breaking Intent revisions, and concrete exception operations rather than risk tier alone.
