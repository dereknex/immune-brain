---
"immune-brain": minor
---

Add user-configurable interaction language for host-native UX and internal role dispatches.

- Host-native UI text (Task Rail sentences, authority dialog titles and actions, enrollment progress summaries) follows the new `IMM_UX_LANGUAGE` environment variable (for example `zh`); state enums, operation ids, domain field labels, agent-facing Tool result reasons, and diagnostic notifications stay literal English.
- Internal role dispatches (`dispatch_role` and routed role contexts) accept `interaction_language` in the delegation context, so QA/Review/Explorer roles report findings and summaries in the user's language while keeping machine contracts literal; omitting it keeps prompt bytes and English role output unchanged.
- Document the language boundaries in BASELINE.md and the dispatch contract in dist/imm-loop.md, and align AGENTS.md reply-language rules with explicit user language instructions.
