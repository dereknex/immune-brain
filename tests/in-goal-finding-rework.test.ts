// #193: a defect inside the TaskIntent goal and scope_hint is ordinary rework.
// The contract says so in the Loop, the Planner revision route and both role
// prompts, and the Kernel admits a blocking Review finding for a case the
// acceptance text does not name word for word, without any Intent revision.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalRecordHash, reduceTask } from "../plugins/immune-brain/runtime/kernel/reducer";
import { canonicalIntentHash } from "../plugins/immune-brain/runtime/kernel/intent";
import { anchorForEvidence } from "../plugins/immune-brain/runtime/kernel/refutation";
import { parseTaskRecordV4 } from "../plugins/immune-brain/runtime/kernel/validation";
import type { TaskAction } from "../plugins/immune-brain/runtime/kernel/types";
import { parseAssuranceVerdict, snapshotDigest, type SnapshotDescriptor } from "../plugins/immune-brain/runtime/assurance/coordinator";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const flat = (rel: string) => readFileSync(resolve(REPO_ROOT, rel), "utf-8").replace(/\s+/g, " ");

describe("contract distinguishes in-goal rework from Intent revision", () => {
	test("the Loop treats an in-goal finding as rework and forbids appending a case to acceptance", () => {
		const loop = flat("plugins/immune-brain/dist/imm-run.md");
		expect(loop).toContain("lies inside the TaskIntent goal and `scope_hint` is ordinary rework even when no acceptance names its exact case");
		expect(loop).toContain("never append a single input case to an acceptance assertion in order to close a finding");
		expect(loop).toContain("A breaking revision is used only when the goal, the `scope_hint`, or a user-visible commitment changes.");
	});

	test("the Executor and Reviewer role prompts carry the same rule", () => {
		const executor = flat("plugins/immune-brain/runtime/prompts/executor.md");
		expect(executor).toContain("never append a single input case to an acceptance assertion to close a finding");
		const reviewer = flat("plugins/immune-brain/runtime/prompts/code-review.md");
		expect(reviewer).toContain("is a blocking finding even when no acceptance assertion names its exact case word for word");
		expect(reviewer).toContain("never for the case to be written into the acceptance text");
		for (const file of ["executor.md", "code-review.md"])
			expect(readFileSync(resolve(REPO_ROOT, "plugins/immune-brain/dist/role-prompts", file), "utf-8"))
				.toBe(readFileSync(resolve(REPO_ROOT, "plugins/immune-brain/runtime/prompts", file), "utf-8"));
	});

	test("the Planner declines a revision that only appends a case", () => {
		const planner = flat("plugins/immune-brain/dist/imm-planner.md");
		expect(planner).toContain("decline to prepare one that only appends a single input case to an acceptance assertion");
	});
});

const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: "in-goal",
	goal: "Scenarios round-trip through the ownership marker",
	acceptance: [{ id: "A1", assertion: "A Task's scenarios are read back from its marker.", verification: "verify one" }],
	scope_hint: ["plugins/immune-brain"],
	risk: "material",
	revision: 1,
	owner: "user",
} as const;
const HASH = canonicalIntentHash(INTENT);
const DIFF = `sha256:${"a".repeat(64)}`;

describe("Kernel admits an in-goal blocking finding without matching acceptance text", () => {
	const evidence = {
		trigger: "a marker whose JSON payload is percent-encoded twice",
		caller_chain: ["runtime/github_issue_tracker.ts", "readScenarioMarker"],
		violated: { kind: "acceptance" as const, ref: "A1" },
	};

	test("the verdict parser accepts it", () => {
		const snapshot = {
			contract: "assurance_kernel/assurance_snapshot/v2", task_id: "in-goal", role: "review",
			record_revision: "r", workspace_revision: "w", intent_revision: 1, intent_content_hash: HASH,
			diff_hash: DIFF, lifecycle: "active", artifact_state: "frozen", risk: "material",
			fresh_acceptance_ids: ["A1"], missing_acceptance_ids: [],
		} as unknown as SnapshotDescriptor;
		expect(INTENT.acceptance[0].assertion).not.toContain("percent-encoded");
		const verdict = parseAssuranceVerdict({
			contract: "assurance_kernel/assurance_verdict/v2", role: "review", task_id: "in-goal",
			snapshot_digest: snapshotDigest(snapshot), decision: "rework",
			findings: [{ id: "double-encoding", kind: "blocking", acceptance_id: "A1", summary: "double-encoded marker is misread", evidence }],
		}, snapshot);
		expect(verdict.decision).toBe("rework");
	});

	test("request_rework records it as open and leaves the Intent revision unchanged", () => {
		const record = parseTaskRecordV4({
			contract: "assurance_kernel/task_record/v4", task_id: "in-goal", intent_snapshot: INTENT,
			intent_ref: { path: "docs/plans/archive/in-goal.intent.json", content_hash: HASH },
			lifecycle: "active", artifact_state: "frozen", baseline: `sha256:${"0".repeat(64)}`,
			git_base_head: "a".repeat(40), attestations: [], findings: [], history: [],
		});
		const action = {
			type: "request_rework", event_id: "ev-rework", at: "2026-10-10T00:00:00.000Z", actor_id: "reviewer",
			expected_record_hash: canonicalRecordHash(record), expected_workspace_hash: `sha256:${"b".repeat(64)}`, diff_hash: DIFF,
			findings: [{ id: "f-1", kind: "blocking", status: "open", acceptance_id: "A1", source: "review", review_round: 1,
				summary: "double-encoded marker is misread", anchor: anchorForEvidence(evidence), evidence }],
		} as unknown as TaskAction;
		const next = reduceTask(record, action, { authority_kind: "review", actor_id: "reviewer", confirmation_ref: "conf", issued_at: "2026-10-10T00:00:00.000Z" }).record;
		expect(next.findings.find((f) => f.id === "f-1")).toMatchObject({ status: "open", kind: "blocking", acceptance_id: "A1" });
		expect(next.artifact_state).toBe("active");
		expect(next.intent_snapshot.revision).toBe(1);
		expect(next.intent_ref.content_hash).toBe(HASH);
	});
});
