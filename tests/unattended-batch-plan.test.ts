import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import {
	observeGithubInitiative,
	type GhExecution,
	type GhTransport,
	type GithubInitiativeObservation,
} from "../plugins/immune-brain/runtime/github_issue_tracker";
import { stableStringify } from "../plugins/immune-brain/runtime/canonical_json";
import { readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import { projectBatchPlan } from "../plugins/immune-brain/runtime/unattended/batch_plan";

const CONFIRMATION_TIME = "2099-01-01T00:00:00.000Z";

function result(stdout: unknown): GhExecution {
	return {
		exit_code: 0,
		stdout: JSON.stringify(stdout),
		stderr: "",
		timed_out: false,
		output_exceeded: false,
	};
}

class ObservationGh implements GhTransport {
	calls: string[][] = [];

	async run(args: string[]): Promise<GhExecution> {
		this.calls.push(args);
		const endpoint = args.at(-1) ?? "";
		if (endpoint === "repos/{owner}/{repo}") return result({ id: 1, full_name: "example/project" });
		if (endpoint.includes("issues?state=all")) return result([
			{
				id: 100,
				number: 1,
				html_url: "https://github.com/example/project/issues/1",
				title: "Initiative",
				body: "<!-- immune-brain-tracker:v1 -->\n<!-- immune-brain:kind=initiative -->\n<!-- immune-brain:repo-id=1 -->\n<!-- immune-brain:initiative-id=batch -->",
				state: "open",
				state_reason: null,
			},
			{
				id: 200,
				number: 2,
				html_url: "https://github.com/example/project/issues/2",
				title: "Base",
				body: "<!-- immune-brain-tracker:v1 -->\n<!-- immune-brain:kind=task -->\n<!-- immune-brain:repo-id=1 -->\n<!-- immune-brain:initiative-id=batch -->\n<!-- immune-brain:slice-id=S1 -->\n<!-- immune-brain:task-id=base -->",
				state: "open",
				state_reason: null,
			},
			{
				id: 300,
				number: 3,
				html_url: "https://github.com/example/project/issues/3",
				title: "Final",
				body: "<!-- immune-brain-tracker:v1 -->\n<!-- immune-brain:kind=task -->\n<!-- immune-brain:repo-id=1 -->\n<!-- immune-brain:initiative-id=batch -->\n<!-- immune-brain:slice-id=S2 -->\n<!-- immune-brain:task-id=final -->",
				state: "open",
				state_reason: null,
			},
		]);
		if (endpoint.endsWith("/issues/1/sub_issues?per_page=100")) return result([[{ number: 3 }, { number: 2 }]]);
		if (endpoint.endsWith("/issues/2/dependencies/blocked_by?per_page=100")) return result([[]]);
		if (endpoint.endsWith("/issues/3/dependencies/blocked_by?per_page=100")) return result([[{ issue_id: 200 }]]);
		throw new Error(`unexpected gh call: ${args.join(" ")}`);
	}
}

function writeIntent(root: string, taskId: string, risk: "material" | "critical" = "material"): string {
	const path = `docs/plans/${taskId}.intent.json`;
	mkdirSync(join(root, "docs/plans"), { recursive: true });
	writeFileSync(join(root, path), `${JSON.stringify({
		contract: "assurance_kernel/task_intent/v1",
		task_id: taskId,
		goal: `Deliver ${taskId}`,
		acceptance: [{ id: `acc-${taskId}`, assertion: `Deliver ${taskId}`, verification: "{}" }],
		scope_hint: ["tests/**"],
		risk,
		revision: 1,
		owner: "user",
	}, null, 2)}\n`);
	return path;
}

function fixtureRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "imm-batch-plan-"));
	execFileSync("git", ["init", "-q"], { cwd: root });
	mkdirSync(join(root, "docs/plans"), { recursive: true });
	const malformedPath = "docs/plans/malformed.intent.json";
	const invalidPath = "docs/plans/invalid.intent.json";
	writeFileSync(join(root, malformedPath), "{\n");
	writeFileSync(join(root, invalidPath), "{}\n");
	const paths = [
		writeIntent(root, "base"),
		writeIntent(root, "final"),
		writeIntent(root, "critical", "critical"),
		writeIntent(root, "dependent"),
		writeIntent(root, "owned"),
		writeIntent(root, "A-a"),
		writeIntent(root, "B-c"),
		writeIntent(root, "a-b"),
		writeIntent(root, "b-d"),
		malformedPath,
		invalidPath,
	];
	execFileSync("git", ["add", ...paths], { cwd: root });
	const owned = readTaskIntent(root, "owned", "docs/plans/owned.intent.json");
	mkdirSync(join(root, ".imm/state/tasks"), { recursive: true });
	writeFileSync(join(root, ".imm/state/tasks/owned.json"), `${JSON.stringify({
		contract: "assurance_kernel/task_record/v4",
		task_id: "owned",
		intent_snapshot: owned.intent,
		intent_ref: { path: owned.intent_ref.path, content_hash: owned.content_hash },
		lifecycle: "active",
		artifact_state: "active",
		baseline: owned.content_hash,
		git_base_head: "a".repeat(40),
		attestations: [],
		findings: [],
		history: [],
	}, null, 2)}\n`);
	mkdirSync(join(root, ".imm/audit/settled"), { recursive: true });
	writeFileSync(join(root, ".imm/audit/settled/terminal-proof.json"), `${JSON.stringify({
		contract: "assurance_kernel/task_tombstone/v2",
		task_id: "settled",
		lifecycle_status: "terminal",
		terminal_lifecycle: "done",
		terminal_event_id: "complete:settled:2099-01-01T00:00:00.000Z",
		final_record_hash: `sha256:${"b".repeat(64)}`,
		terminalized_at: "2099-01-01T00:00:00.000Z",
	}, null, 2)}\n`);
	return root;
}

function observation(tasks: GithubInitiativeObservation["tasks"]): GithubInitiativeObservation {
	return {
		contract: "immune_brain/github_initiative_observation/v1",
		initiative_id: "batch",
		issue_number: 1,
		tasks,
	};
}

function snapshotFiles(root: string): Record<string, string> {
	const files: Record<string, string> = {};
	const visit = (directory: string) => {
		for (const name of readdirSync(directory).sort()) {
			if (name === ".git") continue;
			const path = join(directory, name);
			if (statSync(path).isDirectory()) visit(path);
			else files[relative(root, path)] = readFileSync(path).toString("base64");
		}
	};
	visit(root);
	return files;
}

const SHUFFLED_TASKS: GithubInitiativeObservation["tasks"] = [
	{ task_id: "final", slice_id: "S7", issue_number: 7, blocked_by: ["settled", "base"] },
	{ task_id: "invalid", slice_id: "S4", issue_number: 4, blocked_by: [] },
	{ task_id: "malformed", slice_id: "S8", issue_number: 8, blocked_by: [] },
	{ task_id: "missing", slice_id: "S9", issue_number: 9, blocked_by: [] },
	{ task_id: "dependent", slice_id: "S6", issue_number: 6, blocked_by: ["critical"] },
	{ task_id: "settled", slice_id: "S1", issue_number: 1, blocked_by: ["critical"] },
	{ task_id: "critical", slice_id: "S5", issue_number: 5, blocked_by: [] },
	{ task_id: "owned", slice_id: "S3", issue_number: 3, blocked_by: [] },
	{ task_id: "base", slice_id: "S2", issue_number: 2, blocked_by: [] },
];

describe("unattended batch plan projection", () => {
	it("observes a published Initiative through read-only native topology", async () => {
		const gh = new ObservationGh();
		const observed = await observeGithubInitiative("/tmp/project", "batch", gh);

		expect(observed).toEqual(observation([
			{ task_id: "base", slice_id: "S1", issue_number: 2, blocked_by: [] },
			{ task_id: "final", slice_id: "S2", issue_number: 3, blocked_by: ["base"] },
		]));
		expect(gh.calls).toHaveLength(5);
		expect(gh.calls.some((args) => args[0] === "issue" || args.includes("-F"))).toBe(false);
	});

	it("projects deterministic dependency closure, classifications, digest, and defaults without writes", async () => {
		const root = fixtureRoot();
		try {
			const before = snapshotFiles(root);
			let firstReads = 0;
			const first = await projectBatchPlan(root, "batch", { confirmation_time: CONFIRMATION_TIME }, async () => {
				firstReads += 1;
				return observation(SHUFFLED_TASKS);
			});
			let secondReads = 0;
			const second = await projectBatchPlan(root, "batch", { confirmation_time: CONFIRMATION_TIME }, async () => {
				secondReads += 1;
				return observation([...SHUFFLED_TASKS].reverse());
			});

			expect(JSON.stringify(first)).toBe(JSON.stringify(second));
			expect(firstReads).toBe(1);
			expect(secondReads).toBe(1);
			expect(first.tracker_observation).toEqual(observation(SHUFFLED_TASKS.map((task) => ({
				...task,
				blocked_by: [...task.blocked_by].sort(),
			})).sort((left, right) => left.task_id < right.task_id ? -1 : left.task_id > right.task_id ? 1 : 0)));
			expect(snapshotFiles(root)).toEqual(before);
			expect(Object.fromEntries(first.children.map((child) => [child.task_id, child.status]))).toEqual({
				base: "enrollable",
				critical: "needs_human",
				invalid: "needs_human",
				malformed: "needs_human",
				missing: "needs_human",
				owned: "already_owned",
				settled: "already_settled",
				dependent: "blocked",
				final: "enrollable",
			});
			expect(first.children.find((child) => child.task_id === "final")?.blocked_by).toEqual(["base", "critical", "settled"]);
			expect(first.enrollable.map((child) => child.task_id)).toEqual(["base", "final"]);
			expect(first.enrollable[1].blocked_by).toEqual(["base"]);
			const expectedDigest = `sha256:${createHash("sha256").update(stableStringify(first.enrollable)).digest("hex")}`;
			expect(first.plan_digest).toBe(expectedDigest);
			expect(first.budget).toEqual({
				max_children: 2,
				deadline_at: "2099-01-01T08:00:00.000Z",
				qa_failure_limit: 2,
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("validates budget overrides and propagates one tracker read failure", async () => {
		const root = fixtureRoot();
		const twoTasks = observation([
			{ task_id: "base", slice_id: "S1", issue_number: 1, blocked_by: [] },
			{ task_id: "final", slice_id: "S2", issue_number: 2, blocked_by: ["base"] },
		]);
		try {
			const overridden = await projectBatchPlan(root, "batch", {
				confirmation_time: CONFIRMATION_TIME,
				budget: { max_children: 1, deadline_at: "2099-01-01T02:00:00.000Z", qa_failure_limit: 3 },
			}, async () => twoTasks);
			expect(overridden.budget).toEqual({
				max_children: 1,
				deadline_at: "2099-01-01T02:00:00.000Z",
				qa_failure_limit: 3,
			});
			const mixedCase = await projectBatchPlan(root, "batch", { confirmation_time: CONFIRMATION_TIME }, async () => observation([
				{ task_id: "b-d", slice_id: "S4", issue_number: 4, blocked_by: [] },
				{ task_id: "a-b", slice_id: "S3", issue_number: 3, blocked_by: [] },
				{ task_id: "B-c", slice_id: "S2", issue_number: 2, blocked_by: [] },
				{ task_id: "A-a", slice_id: "S1", issue_number: 1, blocked_by: [] },
			]));
			expect(mixedCase.enrollable.map((child) => child.task_id)).toEqual(["A-a", "B-c", "a-b", "b-d"]);
			for (const [budget, message] of [
				[{ max_children: 0 }, "max_children"],
				[{ max_children: 3 }, "exceeds"],
				[{ qa_failure_limit: 0 }, "qa_failure_limit"],
				[{ deadline_at: CONFIRMATION_TIME }, "later"],
				[{ deadline_at: "January 1, 2099" }, "ISO timestamp"],
				[{ deadline_at: "2099-01-01T02:00:00+02:00" }, "ISO timestamp"],
			] as const) {
				await expect(projectBatchPlan(root, "batch", { confirmation_time: CONFIRMATION_TIME, budget }, async () => twoTasks))
					.rejects.toThrow(message);
			}
			await expect(projectBatchPlan(root, "batch", { confirmation_time: CONFIRMATION_TIME }, async () => observation([
				{ task_id: "base", slice_id: "S1", issue_number: 1, blocked_by: ["final"] },
				{ task_id: "final", slice_id: "S2", issue_number: 2, blocked_by: ["base"] },
			]))).rejects.toThrow("acyclic");
			let reads = 0;
			await expect(projectBatchPlan(root, "batch", { confirmation_time: CONFIRMATION_TIME }, async () => {
				reads += 1;
				throw new Error("tracker unavailable");
			})).rejects.toThrow("tracker unavailable");
			expect(reads).toBe(1);

			const basePath = join(root, "docs/plans/base.intent.json");
			rmSync(basePath);
			symlinkSync(join(root, "docs/plans/final.intent.json"), basePath);
			await expect(projectBatchPlan(root, "batch", { confirmation_time: CONFIRMATION_TIME }, async () => twoTasks)).rejects.toThrow("symlink");

			await expect(projectBatchPlan(root, "batch", { confirmation_time: CONFIRMATION_TIME }, async () => observation([
				{ task_id: "critical", slice_id: "S1", issue_number: 1, blocked_by: [] },
			]))).rejects.toThrow("no enrollable children");
			await expect(projectBatchPlan(root, "batch", { confirmation_time: CONFIRMATION_TIME }, async () => observation([
				{ task_id: "settled", slice_id: "S1", issue_number: 1, blocked_by: [] },
			]))).rejects.toThrow("no enrollable children");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
