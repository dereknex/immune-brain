import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completionDecision } from "../plugins/immune-brain/runtime/kernel/completion";
import { enrollCanaryTask } from "../plugins/immune-brain/runtime/kernel/enrollment";
import { createEnrollmentAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { preparePiCanary } from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import { captureReviewManifest } from "../plugins/immune-brain/runtime/assurance/review_evidence";
import { buildSnapshot } from "../plugins/immune-brain/runtime/assurance/verdict_authority";
import { runDeterministicQa } from "../plugins/immune-brain/runtime/assurance/qa";
import { parseVerificationDescriptor } from "../plugins/immune-brain/runtime/verification_descriptor";
import { taskDeliveryIdentity, taskDiffHash } from "../plugins/immune-brain/runtime/workspace_scope";

function git(root: string, ...args: string[]) {
	return execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@local", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
const now = "2026-10-22T00:00:00.000Z";
function fixture() {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "single-clean-")));
	git(root, "init", "-q", "-b", "main");
	mkdirSync(join(root, "docs/plans"), { recursive: true });
	mkdirSync(join(root, "docs/specs"), { recursive: true });
	writeFileSync(join(root, ".gitignore"), ".imm/state/\nignored.txt\n");
	writeFileSync(join(root, "outside.txt"), "base");
	writeFileSync(join(root, "deleted.txt"), "base");
	writeFileSync(join(root, "docs/specs/task.spec.md"), "# Task\n");
	const verification = JSON.stringify({ contract: "assurance_kernel/verification_descriptor/v2", command: {
		executable: "bun", argv: ["-e", "if(require('node:fs').readFileSync('outside.txt','utf8')!=='delivered')process.exit(1)"], cwd: ".", timeout_ms: 60000, max_output_bytes: 4096 },
		environment: { prepare: null, writable_paths: [] } });
	const intent = { contract: "assurance_kernel/task_intent/v1", task_id: "task", owner: "user", goal: "clean single task",
		acceptance: [{ id: "AC1", assertion: "delivery", verification }], scope_hint: ["estimated.txt", "docs/specs/task.spec.md"], risk: "material", revision: 1 };
	writeFileSync(join(root, "docs/plans/task.intent.json"), JSON.stringify(intent));
	git(root, "add", "-A"); git(root, "commit", "-qm", "base");
	const enroll = () => {
		const preparation = preparePiCanary(root, { task_id: "task", now });
		const binding = { task_id: "task", intent_path: "docs/plans/task.intent.json", intent_revision: 1,
			intent_content_hash: preparation.intent!.content_hash, preparation_digest: preparation.digest, actor_id: "user", confirmation_ref: "confirmed", nonce: "nonce" };
		const registry = createEnrollmentAuthorityRegistry();
		const capability = registry.issue(binding);
		return enrollCanaryTask(root, { ...binding, capability, capability_binding: binding, now }, registry).record;
	};
	return { root, enroll, verification };
}

describe("D23 clean single-task enrollment and delivery", () => {
	test("AC1: allows only the own intent, bound Spec and ignored environment dirt", () => {
		const fx = fixture();
		try {
			const intentPath = join(fx.root, "docs/plans/task.intent.json");
			writeFileSync(intentPath, readFileSync(intentPath, "utf8") + "\n");
			git(fx.root, "add", "docs/plans/task.intent.json");
			writeFileSync(join(fx.root, "docs/specs/task.spec.md"), "# Updated task\n");
			writeFileSync(join(fx.root, "ignored.txt"), "environment");
			const head = git(fx.root, "rev-parse", "HEAD");
			expect(fx.enroll()).toMatchObject({ lifecycle: "active", git_base_head: head });
		} finally { rmSync(fx.root, { recursive: true, force: true }); }
	});

	for (const path of ["outside.txt", "new.txt", "docs/specs/other.spec.md", "docs/plans/other.intent.json"]) {
		test(`AC1: refuses non-planning dirt ${path}`, () => {
			const fx = fixture();
			try {
				writeFileSync(join(fx.root, path), "dirty");
				expect(() => fx.enroll()).toThrow(`workspace_not_clean: ${path}`);
			} finally { rmSync(fx.root, { recursive: true, force: true }); }
		});
	}

	test("AC2: includes committed and staged work beyond the estimate in identity, QA and Review", async () => {
		const fx = fixture();
		try {
			const record = fx.enroll();
			writeFileSync(join(fx.root, "outside.txt"), "delivered");
			git(fx.root, "add", "outside.txt");
			const stagedHash = taskDeliveryIdentity(fx.root, record).diff_hash;
			git(fx.root, "commit", "-qm", "task work");
			expect(taskDeliveryIdentity(fx.root, record).diff_hash).toBe(stagedHash);
			writeFileSync(join(fx.root, "added.txt"), "new");
			rmSync(join(fx.root, "deleted.txt"));
			git(fx.root, "add", "added.txt", "deleted.txt");
			const identity = taskDeliveryIdentity(fx.root, record);
			expect(identity.changed_paths).toEqual(["added.txt", "deleted.txt", "outside.txt"]);
			expect(identity.diff_hash).not.toBe(stagedHash);
			expect(taskDiffHash(fx.root, record.intent_snapshot.scope_hint, "task")).toBe(identity.diff_hash);
			const manifest = captureReviewManifest(fx.root, { taskId: "task", baseHead: record.git_base_head,
				scopeHint: record.intent_snapshot.scope_hint, expectedDiffHash: identity.diff_hash, intentRevision: 1,
				intentContentHash: record.intent_ref.content_hash, recordRevision: "record", workspaceRevision: "workspace",
				lifecycle: "active", artifactState: "frozen", risk: "material", outcomes: {} });
			expect(manifest.beyond_estimate).toEqual(identity.changed_paths);
			const snapshot = buildSnapshot({ root: fx.root, task_id: "task", role: "qa", record_revision: "record", workspace_revision: "workspace",
				intent_revision: 1, intent_content_hash: record.intent_ref.content_hash, diff_hash: identity.diff_hash,
				lifecycle: "active", artifact_state: "frozen", acceptance: record.intent_snapshot.acceptance,
				fresh_acceptance_ids: [], missing_acceptance_ids: ["AC1"], stale_attestation_ids: [] });
			expect((await runDeterministicQa(snapshot, new Map([["AC1", parseVerificationDescriptor(fx.verification)]]))).decision).toBe("pass");
			const approved = { ...record, artifact_state: "frozen" as const, attestations: (["qa", "review"] as const).map(kind => ({
				id: kind, kind, authority_role: kind === "review" ? "reviewer" as const : "qa" as const, task_revision: 1, intent_content_hash: record.intent_ref.content_hash,
				diff_hash: identity.diff_hash, actor_id: kind, summary: "passed", acceptance_results: kind === "qa" ? [{ acceptance_id: "AC1", status: "passed" as const, summary: "passed" }] : [],
				...(kind === "review" ? { review_revision: { contract: "assurance_kernel/review_revision_identity/v1" as const,
					base_head: manifest.base_head, review_commit: manifest.review_commit, review_tree: manifest.review_tree, manifest_digest: manifest.manifest_digest } } : {}),
			})) };
			expect(completionDecision(record.intent_snapshot, approved, identity.diff_hash, record.intent_ref.content_hash, identity.changed_paths).complete).toBe(true);
			const mutating = parseVerificationDescriptor(fx.verification);
			mutating.command.argv = ["-e", "require('node:fs').writeFileSync('outside.txt','QA drift')"];
			await expect(runDeterministicQa(snapshot, new Map([["AC1", mutating]]))).rejects.toMatchObject({ reason: "protected_input_or_output_drift" });
		} finally { rmSync(fx.root, { recursive: true, force: true }); }
	});
});
