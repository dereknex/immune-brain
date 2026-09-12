---
"immune-brain": patch
---

Publish readable GitHub tracker Issues: titles are composed from bounded Planner display names (`[<short_name>] <title>` for the Parent, `[<short_name>] S<n> <title>` for Children) instead of the full goal text, Children carry the repository's `ready-for-agent` and `blocked` labels while the Parent carries none, Issue bodies no longer repeat the title or the opt-in/Lifecycle/Authority stanzas, and a declared `projection.source_issue` renders a Provenance link.
