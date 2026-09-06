import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ClaudeRuntime,
	diffSnapshotOf,
	ensureClaudeReviewRevision,
} from "../plugins/immune-brain/runtime/claude/kernel_ports";
import { ensureTaskReviewRevision } from "../plugins/immune-brain/.pi-extension/imm-canary-work";
import { projectAssurance } from "../plugins/immune-brain/runtime/kernel/assurance_projection";
import { readTaskRecord } from "../plugins/immune-brain/runtime/kernel/storage";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import { resolveBunRunner } from "../plugins/immune-brain/runtime/assurance/verification";

/**
 * The submit-time Review identity check re-derives the revision and compares
 * `base_head`, `review_commit`, `review_tree` and `manifest_digest` against the
 * reservation. A host adapter that publishes only the commit identity compares a
 * real digest against `undefined`, so every TaskRecord v4 submission failed with
 * "Review revision changed before submission" — an unfalsifiable stop, because
 * the revision it names had not moved at all.
 *
 * These tests run against a real repository and a real TaskRecord rather than a
 * reconstructed port double: a fake `ensureReviewRevision` cannot express the
 * defect, which is exactly why the existing coordinator suites never saw it.
 */

const TASK = "review-revision-identity-task";
const NOW = "2025-01-01T00:00:00.000Z";
const GIT_ENV = {
	...process.env,
	GIT_AUTHOR_NAME: "fixture",
	GIT_AUTHOR_EMAIL: "fixture@example.com",
	GIT_COMMITTER_NAME: "fixture",
	GIT_COMMITTER_EMAIL: "fixture@example.com",
};

// The descriptor is bound to the runner this host actually resolves, because the
// snapshot builder refuses a version it cannot execute. No descriptor is ever
// run here: the fixture settles QA up front so the Loop resumes at Review.
const RUNNER = resolveBunRunner();

const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: TASK,
	goal: "Publish a Review revision whose identity survives submission",
	acceptance: [
		{
			id: "A1",
			assertion: "The published revision identity matches the reserved snapshot",
			verification: JSON.stringify({
				contract: "assurance_kernel/verification_descriptor/v1",
				runner_id: "bun",
				runner_version: RUNNER.version,
				argv: ["test", "src/worked.ts"],
				cwd: ".",
				timeout_ms: 60_000,
				max_output_bytes: 65_536,
			}),
		},
	],
	scope_hint: ["src/worked.ts"],
	risk: "critical",
	revision: 1,
	owner: "user",
} as const;

const INTENT_HASH = canonicalIntentHash(parseTaskIntentV1(INTENT));
const roots: string[] = [];

afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/**
 * A repository parked exactly where the Loop stalls: artifacts frozen, QA
 * settled and fresh, Review the only missing approval.
 */
function makeReviewReadyRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "review-revision-"));
	roots.push(root);
	mkdirSync(join(root, "src"), { recursive: true });
	mkdirSync(join(root, ".imm", "state", "tasks"), { recursive: true });
	execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
	writeFileSync(join(root, "src", "worked.ts"), "export const value = 1;\n");
	execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
	execFileSync("git", ["commit", "-qm", "base"], { cwd: root, stdio: "ignore", env: GIT_ENV });
	const baseHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
	// The task's own work: staged, as a frozen artifact state requires, and absent
	// from the Enrollment base.
	writeFileSync(join(root, "src", "worked.ts"), "export const value = 2;\n");
	execFileSync("git", ["add", "--", "src/worked.ts"], { cwd: root, stdio: "ignore" });

	const write = (diffHash: string) => {
		writeFileSync(
			join(root, ".imm", "state", "tasks", `${TASK}.json`),
			`${JSON.stringify(taskRecord(baseHead, diffHash), null, 2)}\n`,
		);
	};
	// The attestation is fresh only when it carries the current diff hash, which
	// cannot be computed before a record exists to name the base and the scope.
	write(`sha256:${"0".repeat(64)}`);
	const placeholder = readTaskRecord(root, TASK);
	if (!placeholder.record) throw new Error("fixture TaskRecord did not parse");
	write(diffSnapshotOf(root, placeholder.record).diff_hash);

	writeFileSync(
		join(root, ".imm", "state", "workspace.json"),
		`${JSON.stringify({ contract: "assurance_kernel/workspace/v1", current_working: null }, null, 2)}\n`,
	);
	writeFileSync(
		join(root, ".imm", "state", "active-claim.json"),
		`${JSON.stringify({
			contract: "assurance_kernel/backend_claim/v2",
			backend: "kernel",
			task_id: TASK,
			intent_revision: 1,
			intent_content_hash: INTENT_HASH,
			enrollment_event_id: `enroll-${TASK}-${NOW}`,
			lifecycle_status: "active",
			created_at: NOW,
			updated_at: NOW,
		}, null, 2)}\n`,
	);
	return root;
}

function taskRecord(baseHead: string, diffHash: string): Record<string, unknown> {
	return {
		contract: "assurance_kernel/task_record/v4",
		task_id: TASK,
		intent_snapshot: INTENT,
		intent_ref: { path: `docs/plans/archive/${TASK}.intent.json`, content_hash: INTENT_HASH },
		lifecycle: "active",
		artifact_state: "frozen",
		baseline: `sha256:${"3".repeat(64)}`,
		git_base_head: baseHead,
		attestations: [
			{
				id: "ap-qa",
				kind: "qa",
				authority_role: "qa",
				task_revision: 1,
				intent_content_hash: INTENT_HASH,
				diff_hash: diffHash,
				actor_id: "deterministic-qa",
				summary: "host-attested QA: all 1 fixed verification descriptor(s) passed",
				// Deliberately not the summary a preflight stand-in would synthesise.
				// The digest an adapter republishes has to come from the settled
				// attestation itself, or the comparison only holds while the two
				// happen to produce the same words.
				acceptance_results: [
					{ acceptance_id: "A1", status: "passed", summary: "1/1 fixed verification descriptor passed" },
				],
			},
		],
		findings: [],
		history: [],
	};
}

describe("Review revision identity conformance", () => {
	test("the fixture parks the Loop on the Review obligation", async () => {
		const root = makeReviewReadyRoot();
		const projection = await projectAssurance(root, TASK, diffSnapshotOf);
		expect(projection.error).toBeNull();
		expect(projection.projection.next_obligation).toBe("run_review");
		expect(projection.projection.fresh_approval_kinds).toEqual(["qa"]);
		expect(projection.projection.missing_approval_kinds).toEqual(["review"]);
	});

	test("the Claude adapter publishes the manifest digest, not only the commit", async () => {
		const root = makeReviewReadyRoot();
		const projection = await projectAssurance(root, TASK, diffSnapshotOf);
		const revision = await ensureClaudeReviewRevision(root, TASK, projection);
		expect(revision).not.toBeNull();
		expect(revision?.manifest_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
	});

	test("the published identity is the one the Review reservation binds", async () => {
		const root = makeReviewReadyRoot();
		const runtime = new ClaudeRuntime({ cwd: root, interactive: false });
		const advanced = await runtime.coordinator.advance(TASK, { cwd: root });
		expect(advanced.state).toBe("review_ready");
		const bound = (advanced as { review_bundle_digest: string }).review_bundle_digest;
		const projection = await projectAssurance(root, TASK, diffSnapshotOf);
		const revision = await ensureClaudeReviewRevision(root, TASK, projection);
		// `review_bundle_digest` is the reserved manifest digest verbatim, so an
		// adapter that agrees with it here also agrees inside submitReview.
		expect(revision?.manifest_digest).toBe(bound);
	});

	test("an unchanged revision survives submission", async () => {
		const root = makeReviewReadyRoot();
		const runtime = new ClaudeRuntime({ cwd: root, interactive: false });
		const advanced = await runtime.coordinator.advance(TASK, { cwd: root });
		expect(advanced.state).toBe("review_ready");
		// A verdict bound to the wrong snapshot stops at verdict validation, which
		// is strictly after the revision identity check this test is about. That
		// keeps the assertion on the identity gate without minting real authority.
		const result = await runtime.coordinator.submitReview(TASK, { cwd: root }, {
			contract: "assurance_kernel/assurance_verdict/v2",
			role: "review",
			task_id: TASK,
			snapshot_digest: `sha256:${"9".repeat(64)}`,
			decision: "pass",
			approval: { kind: "review", authority_role: "reviewer", summary: "n/a" },
		});
		expect(result.state).not.toBe("review_preparation_failed");
		expect(JSON.stringify(result)).not.toContain("Review revision changed before submission");
	});

	test("both host adapters publish one identical identity", async () => {
		const root = makeReviewReadyRoot();
		const projection = await projectAssurance(root, TASK, diffSnapshotOf);
		const claude = await ensureClaudeReviewRevision(root, TASK, projection);
		const pi = await ensureTaskReviewRevision(root, TASK, projection);
		expect(claude).toEqual(pi);
	});
});
