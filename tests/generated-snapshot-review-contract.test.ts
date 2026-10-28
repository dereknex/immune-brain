import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildReviewPrompt, type SnapshotDescriptor } from "../plugins/immune-brain/runtime/assurance/coordinator";
import { STATIC_REVIEW_RULES } from "../plugins/immune-brain/runtime/role_prompt_bridge";
import { reviewerDefinitionDrift } from "../scripts/build-claude-plugin";

const root = resolve(import.meta.dir, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const role = read("plugins/immune-brain/runtime/prompts/code-review.md").trim();

const snapshot: SnapshotDescriptor = {
	contract: "assurance_kernel/assurance_snapshot/v2",
	task_id: "generated-snapshot",
	role: "review",
	record_revision: "record-1",
	workspace_revision: "workspace-1",
	intent_revision: 1,
	intent_content_hash: "sha256:intent",
	diff_hash: "sha256:diff",
	lifecycle: "active",
	artifact_state: "frozen",
	risk: "material",
	fresh_acceptance_ids: ["A1"],
	missing_acceptance_ids: [],
	stale_attestation_ids: [],
	acceptance: [{ id: "A1", assertion: "migration preserves the schema", verification: "{}" }],
	dirty_files: ["migrations/meta/0001_snapshot.json"],
	review_bundle_digest: "sha256:bundle",
	root,
};

describe("generated snapshot Review coverage contract", () => {
	test("both Hosts receive the same narrowly scoped, fail-closed proof rules", () => {
		const pi = buildReviewPrompt(snapshot);
		const claude = read("plugins/immune-brain/agents/immune-brain-reviewer.md");
		for (const prompt of [pi, claude]) {
			expect(prompt).toContain(role);
			for (const rule of STATIC_REVIEW_RULES) expect(prompt).toContain(rule);
			expect(prompt).toContain("or the code-review role's generated snapshot proof was completed");
		}
	});

	test("the exception requires immutable provenance and exhaustive, lossless differences", () => {
		for (const guard of [
			"newly added Drizzle",
			"does not cover modified/deleted snapshots",
			"SQL migrations, schema source, or legacy bundles",
			"same blob OID",
			"new `prevId` equals predecessor",
			"matching `version` and `dialect`",
			"rejecting duplicate keys, non-finite",
			"lossy numeric conversion",
			"type-sensitive equality",
			"array order, unknown fields, IDs, additions and deletions are retained",
			"full before/after values",
			"programmatic equality",
			"Parent-provided summary do not establish coverage",
			"Read the comparison program and its complete output",
			"delivered SQL migration and schema source",
			"name the snapshot proof in `approval.summary`",
			"read the full diff or return `incomplete`",
		]) expect(role).toContain(guard);
	});

	test("packaged roles and Loop coverage point to the canonical proof", () => {
		expect(read("plugins/immune-brain/dist/role-prompts/code-review.md").trim()).toBe(role);
		expect(reviewerDefinitionDrift(root)).toBeNull();
		expect(read("plugins/immune-brain/dist/drive.md")).toContain("role-prompts/code-review.md#generated-snapshot-proof");
	});
});
