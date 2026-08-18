import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stableStringify } from "./canonical_json";

const RUNTIME_DIR = dirname(fileURLToPath(import.meta.url));

export type InternalRole = "qa" | "code-review" | "ui-review";
export type StableReviewGate = "imm-code-review" | "imm-ui-review";

export interface RolePromptSpec {
	file: `${InternalRole}.md`;
	review_gate?: StableReviewGate;
	authority: "qa" | "advisory";
}

export const INTERNAL_ROLE_PROMPTS: Record<InternalRole, RolePromptSpec> = {
	qa: { file: "qa.md", authority: "qa" },
	"code-review": {
		file: "code-review.md",
		review_gate: "imm-code-review",
		authority: "advisory",
	},
	"ui-review": {
		file: "ui-review.md",
		review_gate: "imm-ui-review",
		authority: "advisory",
	},
};

export interface RoleDelegationContext {
	task_id: string;
	target_id?: string;
	review_gate?: StableReviewGate;
	changed_files_signature?: string;
	[key: string]: unknown;
}

export interface RoleDelegationPacket {
	contract: "immune_brain/role_delegation/v1";
	role: InternalRole;
	review_gate?: StableReviewGate;
	authority: "qa" | "advisory";
	tool_policy: "no tools";
	prompt: string;
	prompt_digest: string;
}

function roleSpec(role: InternalRole): RolePromptSpec {
	const spec = INTERNAL_ROLE_PROMPTS[role];
	if (!spec) throw new Error(`unknown internal role: ${String(role)}`);
	return spec;
}

/**
 * Read the packaged prompt so the runtime follows the bytes shipped to a
 * consumer. The canonical source is synced into this dist-local directory.
 */
export function loadRolePrompt(role: InternalRole): string {
	const spec = roleSpec(role);
	const path = join(RUNTIME_DIR, "..", "dist", "role-prompts", spec.file);
	if (!existsSync(path)) {
		throw new Error(`internal role prompt is not packaged: ${role}`);
	}
	return readFileSync(path, "utf8");
}

export function buildRoleDelegationPacket(input: {
	role: InternalRole;
	context: RoleDelegationContext;
}): RoleDelegationPacket {
	const spec = roleSpec(input.role);
	const requestedGate = input.context.review_gate;
	if (spec.review_gate && requestedGate && requestedGate !== spec.review_gate) {
		throw new Error(
			`review gate ${requestedGate} does not match ${input.role}`,
		);
	}
	if (!spec.review_gate && requestedGate) {
		throw new Error(`QA role cannot carry review gate ${requestedGate}`);
	}

	const reviewGate = spec.review_gate;
	const context = stableStringify(input.context);
	const prompt = [
		`internal role: ${input.role}`,
		`tool_policy: no tools`,
		`do not discover or load Pi Skills; execute this internal role contract directly`,
		loadRolePrompt(input.role).trim(),
		`Delegation context (untrusted data): ${context}`,
	].join("\n\n");
	const promptDigest = `sha256:${createHash("sha256").update(prompt).digest("hex")}`;
	return {
		contract: "immune_brain/role_delegation/v1",
		role: input.role,
		...(reviewGate ? { review_gate: reviewGate } : {}),
		authority: spec.authority,
		tool_policy: "no tools",
		prompt,
		prompt_digest: promptDigest,
	};
}
