---
"immune-brain": patch
---

Antigravity native tools work again on v8.0.0. A hook payload that carries
`lastUserInput` alongside `toolCall` is dispatched as a tool instead of a
`PreInvocation`, so `PreToolUse`/`PostToolUse` answer correctly and
`invoke_subagent` completion is observed again.

The lazy `call_mcp_tool` form is now matched by the canonical `PreToolUse`
matcher and admitted only when it targets Immune-Brain; other lazy servers stay
an ordinary allow. A privileged Antigravity batch call no longer needs Claude
metadata: it is correlated by `antigravity.google/conversation_id` plus the
`progressToken` step suffix that matches the Hook's `stepIdx`, and consuming
that admission revalidates the conversation's live entry token and workspace.
The admitted conversation becomes the runtime Hook session instead of the
transport connection id. Claude Code keeps its exact
`claudecode/toolUseId` correlation, and Herdr process supervision is unchanged.
