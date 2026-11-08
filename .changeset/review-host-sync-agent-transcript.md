---
"immune-brain": patch
---

Settle Review from the reviewer's own transcript when the Claude `Agent` tool returns synchronously. A `--print` (`sdk-cli`) Executor used to settle on the tool result, whose text is only the "delivered to you as a message" pointer notice; the receipt now comes from `<dirname(T)>/<basename(T, ".jsonl")>/subagents/agent-<agentId>.jsonl` (or the `SubagentStop` `agent_transcript_path`) read with the async path's `realpath`/`readPrivate` checks and `readAgentTranscriptResult`. `tool_response.content` and `handbackReport` never become a receipt, and an unreadable or empty transcript fails closed with `sync Agent transcript is not readable` / `sync Agent transcript carries no reviewer result`. The Claude verifier receipt binds through the same branch. The async branch and the correlation rules are unchanged; existing `--print` batch records are not migrated.
