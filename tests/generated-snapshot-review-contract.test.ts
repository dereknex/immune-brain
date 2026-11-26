import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildReviewPrompt, type SnapshotDescriptor } from "../plugins/immune-brain/runtime/assurance/coordinator";
import { STATIC_REVIEW_RULES } from "../plugins/immune-brain/runtime/role_prompt_bridge";
import { REVIEW_GIT_ALLOWED_TOOLS } from "../plugins/immune-brain/runtime/assurance/cli_review";
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
	review_revision: {
		contract: "assurance_kernel/review_revision_identity/v2",
		base_head: "0".repeat(40),
		review_commit: "1".repeat(40),
	},
	root,
};

describe("generated snapshot Review coverage contract", () => {
	test("both Hosts receive the same narrowly scoped, fail-closed proof rules", () => {
		const pi = buildReviewPrompt(snapshot, { beyond_estimate: [], outside_routine_allowlist: [], outcomes: {} });
		const claude = read("plugins/immune-brain/skills/authority-review/SKILL.md");
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

	test("deletion and derived-output proofs are fail-closed and reach both Hosts", () => {
		const pi = buildReviewPrompt(snapshot, { beyond_estimate: [], outside_routine_allowlist: [], outcomes: {} });
		const claude = read("plugins/immune-brain/skills/authority-review/SKILL.md");
		const proof = role.slice(role.indexOf("### Whole-file deletion and declared derived-bundle proof"), role.indexOf("A required check that is skipped"));
		for (const prompt of [pi, claude]) {
			expect(prompt).toContain(proof);
			expect(prompt).toContain("or its whole-file deletion or declared derived-bundle proof was completed");
		}
		const flat = proof.replace(/\s+/g, " ");
		for (const guard of [
			"They cover no other path",
			"git --no-pager diff --raw --no-renames <base_head> <review_commit>",
			"status `D`, an all-zero new OID",
			"`100644` or `100755`",
			"git --no-pager ls-tree -r <review_commit>",
			"bound Spec, read from the brief or from `<review_commit>`, authorizes the removal",
			"`.imm/risk-floor.json`",
			"An unnamed floor path stays ineligible",
			"git --no-pager show <base_head>:<path>",
			"git --no-pager grep -n -F -e <identifier> <review_commit>",
			"no dangling import, registration or live caller",
			"It is not deleted",
			"<review_commit>:docs/agents/derived-files.json",
			"immune_brain/derived_files/v1",
			"explicit `sources[]`, `generate` and `check`",
			"git --no-pager diff <base_head> <review_commit> -- <source_paths>",
			"`check` command passed on this snapshot",
			"does not establish this is not enough; read the full diff",
			"retired identifiers the acceptance prohibits",
			"`whole-file deletion proof` and/or `declared derived-bundle proof` in `approval.summary`",
			"read the full diff or return `incomplete`",
		]) expect(flat).toContain(guard);
	});

	test("the new proof instructs only commands the reviewer allowlist admits", () => {
		const proof = role.slice(role.indexOf("### Whole-file deletion and declared derived-bundle proof"), role.indexOf("A required check that is skipped"));
		const allowed = REVIEW_GIT_ALLOWED_TOOLS.map((rule) => rule.slice("Bash(".length, -":*)".length));
		const commands = [...proof.matchAll(/`(git\s[^`]*)`/g)].map((match) => match[1].replace(/\s+/g, " "));
		expect(commands.length).toBeGreaterThan(0);
		for (const command of commands) {
			expect(allowed.some((prefix) => command === prefix || command.startsWith(`${prefix} `))).toBe(true);
			expect(command.replace(/<[a-z_]+>/g, "")).not.toMatch(/[|<>]| -C /);
		}
		expect(proof).not.toMatch(/\b(bun|node)\b| -C |\|/);
	});

	test("the retired metrics intent is cited by bare historical name only", () => {
		const spec = read("docs/specs/revisit-workflow-health.spec.md");
		expect(spec).not.toContain("docs/plans/review-verifier-eval-s1-metrics.intent.json");
		expect(spec).toContain("`review-verifier-eval-s1-metrics.intent.json` (retired under ADR 0043) — RVE-S1");
	});

	test("packaged roles and Loop coverage point to the canonical proof", () => {
		expect(read("plugins/immune-brain/dist/role-prompts/code-review.md").trim()).toBe(role);
		expect(reviewerDefinitionDrift(root)).toBeNull();
		expect(read("plugins/immune-brain/dist/drive.md")).toContain("role-prompts/code-review.md#generated-snapshot-proof");
		expect(read("plugins/immune-brain/dist/drive.md")).toContain("role-prompts/code-review.md#whole-file-deletion-and-declared-derived-bundle-proof");
	});
});
