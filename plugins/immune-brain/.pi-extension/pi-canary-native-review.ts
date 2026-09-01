import { createHash } from "node:crypto";

export interface ReservedAgentParams {
	subagent_type: "Review";
	description: string;
	prompt: string;
	name: "";
	model: "";
	thinking: "";
	inherit_context: false;
	isolated: true;
	isolation: "worktree";
	run_in_background: false;
	max_turns: number;
	resume: "";
	schedule: "";
}

export function reservedAgentDescription(taskId: string, operationId: string): string {
	return `Review ${shortId(taskId)} ${shortId(operationId)}`;
}

export function semanticNeighborhoodReviewPrompt(prompt: string): string {
	if (prompt.includes("assurance_kernel/review_manifest/v5")) {
		return [
			prompt,
			`For every changed_paths entry, inspect the immutable Git objects with git diff and git show against the supplied base_head and review_commit. Verify the review_commit parent and tree before analyzing it; do not read live worktree files or expect source bytes in the manifest.`,
			`Unchanged files are outside mutation authority. Read an unchanged path only when directly required by an acceptance assertion, a changed caller, or the same state machine, and cite the path and reason in the finding. Do not enumerate neighborhood files or explore the repository broadly.`,
		].join("\n");
	}
	return [
		prompt,
		`For every neighborhood_files entry, verify git rev-parse HEAD:<path> equals base_oid, then analyze current_content exclusively from the immutable bundle. path_provenance is authoritative: diff marks task changes and neighborhood marks unchanged same-state-machine context selected only from scope_hint.`,
		`For settlement-class changes, enumerate every terminal, cancellation, timeout, and race path present across dirty_files and neighborhood_files before deciding the verdict; report findings for every affected path. Reference a bundle path at the start of each finding summary (for example, "path/to/file.ts: ...") so verdict v2 can identify neighborhood context without live repository reads.`,
	].join("\n");
}

export function reservedAgentParams(input: {
	taskId: string;
	operationId: string;
	prompt: string;
	max_turns?: number;
}): ReservedAgentParams {
	return {
		subagent_type: "Review",
		description: reservedAgentDescription(input.taskId, input.operationId),
		prompt: semanticNeighborhoodReviewPrompt(input.prompt),
		name: "",
		model: "",
		thinking: "",
		inherit_context: false,
		isolated: true,
		isolation: "worktree",
		run_in_background: false,
		max_turns: input.max_turns ?? 16,
		resume: "",
		schedule: "",
	};
}

export function promptDigest(prompt: string): string {
	return `sha256:${createHash("sha256").update(prompt).digest("hex")}`;
}

function shortId(value: string): string {
	return value.replace(/[^A-Za-z0-9]/g, "").slice(-8) || "review";
}
