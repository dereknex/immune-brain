import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

/**
 * Reviewer transcript fixture for a Claude dispatch that returns synchronously.
 *
 * The recorded session (Issue #425) hands the reviewer's report back through a
 * `SubagentHandback` call and leaves no assistant text block behind, so the
 * fixture is that record and nothing else: a report a test can only observe by
 * reading the transcript, never by relaying tool-result bytes.
 */
export function reviewerHandbackRecord(agentId: string, report: string): string {
	return `${JSON.stringify({
		parentUuid: null,
		isSidechain: true,
		agentId,
		type: "assistant",
		message: {
			role: "assistant",
			content: [{ type: "tool_use", id: "toolu_handback", name: "SubagentHandback", input: { message: report } }],
			stop_reason: null,
		},
	})}\n`;
}

/**
 * Where the runtime looks for a subagent transcript when `SubagentStop` reported
 * no `agent_transcript_path`: derived from the PostToolUse session transcript
 * path `T` and the correlated `agentId`.
 */
export function derivedAgentTranscriptPath(sessionTranscriptPath: string, agentId: string): string {
	return join(dirname(sessionTranscriptPath), basename(sessionTranscriptPath, ".jsonl"), "subagents", `agent-${agentId}.jsonl`);
}

export interface ReviewerTranscripts {
	/** Directory every transcript of this fixture is written under. */
	root: string;
	/** An absolute session transcript path with no reviewer transcript behind it. */
	sessionPath(sessionId?: string): string;
	/** Write the reviewer transcript at the locator derived from the returned session path. */
	sessionTranscriptPath(agentId: string, report: string, sessionId?: string): string;
	/** Write the reviewer transcript where the derived locator never looks. */
	agentTranscriptPath(agentId: string, report: string): string;
	/** Remove every transcript this fixture wrote. */
	cleanup(): void;
}

export function reviewerTranscripts(): ReviewerTranscripts {
	const root = mkdtempSync(join(tmpdir(), "claude-reviewer-transcript-"));
	let seq = 0;
	const write = (path: string, agentId: string, report: string): string => {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, reviewerHandbackRecord(agentId, report), { mode: 0o600 });
		return path;
	};
	const sessionPath = (sessionId = `session-${seq++}`): string => join(root, `${sessionId}.jsonl`);
	return {
		root,
		sessionPath,
		sessionTranscriptPath(agentId, report, sessionId) {
			const session = sessionPath(sessionId);
			write(derivedAgentTranscriptPath(session, agentId), agentId, report);
			return session;
		},
		agentTranscriptPath(agentId, report) {
			return write(join(root, `direct-${seq++}`, `agent-${agentId}.jsonl`), agentId, report);
		},
		cleanup() {
			rmSync(root, { recursive: true, force: true });
		},
	};
}
