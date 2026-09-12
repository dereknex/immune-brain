import { describe, expect, it } from "bun:test";
import type { GhExecution, GhTransport } from "../plugins/immune-brain/runtime/github_issue_tracker.ts";
import {
	createGhTransport,
	redactGithubDiagnostic,
	runGithubInitiativePublication,
	runGithubTrackerCli,
	runGithubTrackerOperation,
} from "../plugins/immune-brain/runtime/github_issue_tracker.ts";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TS_RUNTIME = resolve(
	REPO_ROOT,
	"plugins/immune-brain/runtime/v4_runtime.ts",
);
const FINISH_WRAPPER = resolve(
	REPO_ROOT,
	"plugins/immune-brain/bin/imm-finish",
);
const IMM_WORK_WRAPPER = resolve(
	REPO_ROOT,
	"plugins/immune-brain/bin/imm-work",
);
const IMM_KERNEL_WRAPPER = resolve(
	REPO_ROOT,
	"plugins/immune-brain/bin/imm-kernel",
);
const IMM_TRACKER_WRAPPER = resolve(
	REPO_ROOT,
	"plugins/immune-brain/bin/imm-tracker",
);

const PLAN = `---
title: "plugin runtime review gate fixture"
type: feat
status: proposed
date: 2026-07-02
---

# Iteration Plan

## Task

- Summary: Plugin runtime review gate fixture

## Output Language

- Human-readable prose: English

## Steps

### Step 1

- Step ID: U1
- Result: Fixture outcome
- Verification: \`true\`
- Depends on: none
`;

const PROBE_PLAN = `---
title: "plugin runtime probe fixture"
type: feat
status: proposed
date: 2026-08-09
---

# Iteration Plan

## Task

- Summary: Plugin runtime probe fixture
- Workflow profile: strict

## Output Language

- Human-readable prose: English

## Steps

### Step 1

- Step ID: U1
- Result: Probe evidence reaches the executor
- Scope: \`plugins/immune-brain/runtime\`
- Verification: \`true\`
- Parallel probes: [{"scope":"plugins/immune-brain/runtime","output":"runtime map","readonly":true}]
- Depends on: none
`;

const PACKAGE_ROADMAP_PATH = "docs/specs/package-roadmap.md";
const PACKAGE_ROADMAP = `# Package Progress Roadmap

## Roadmap

### Phase P1: Package runtime

- acceptance_criteria: Package wrapper exposes the runtime projection.
- promotion_criteria: Package smoke verification passes.

### Phase P2: Host rollout

- acceptance_criteria: Hosts consume the package projection.
- promotion_criteria: Host verification passes.
`;

const PACKAGE_ROADMAP_PLAN = `---
title: "plugin progress projection fixture"
type: feat
status: proposed
date: 2026-08-11
---

# Iteration Plan

## Task

- Summary: Plugin progress projection fixture
- Workflow profile: strict
- Compounder: required
- Plan contract: roadmap-slice/v1
- Roadmap source: \`${PACKAGE_ROADMAP_PATH}\` Roadmap
- Current phase: P1
- Plan boundary: Package runtime projection
- Boundary rationale: Keep host rollout deferred.
- Scope pressure: low
- Successor candidate: P2
- Successor preconditions: Package smoke verification passes.
- Current-slice warning: This Plan is not the full Roadmap.

## Output Language

- Human-readable prose: English

## Steps

### Step 1

- Step ID: U1
- Result: Package projection is observable
- Verification: \`true\`
- Depends on: none
`;

function withIsolatedRoot<T>(fn: (root: string) => T, plan = PLAN): T {
	const root = mkdtempSync(join(tmpdir(), "imm-plugin-runtime-"));
	mkdirSync(join(root, ".imm", "memory"), { recursive: true });
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	writeFileSync(join(root, "docs", "plans", "plan.md"), plan);
	try {
		return fn(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

async function withIsolatedRootAsync<T>(fn: (root: string) => Promise<T>): Promise<T> {
	const root = mkdtempSync(join(tmpdir(), "imm-plugin-runtime-"));
	mkdirSync(join(root, ".imm", "memory"), { recursive: true });
	try {
		return await fn(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function passedEvidence(
	changedFiles: string | string[],
	summary: string,
	command = "bun test fixture",
) {
	return {
		changed_files: changedFiles,
		status: "passed",
		checks: [
			{
				kind: "command",
				command,
				status: "passed",
				exit_code: 0,
				summary,
			},
		],
	};
}

function cli(root: string, args: string[]) {
	return spawnSync("bun", [TS_RUNTIME, "cli", ...args], {
		encoding: "utf-8",
		cwd: root,
	});
}

function immWork(root: string, args: string[]) {
	return spawnSync(IMM_WORK_WRAPPER, args, {
		encoding: "utf-8",
		cwd: root,
	});
}

function immKernel(root: string, args: string[]) {
	return spawnSync(IMM_KERNEL_WRAPPER, args, {
		encoding: "utf-8",
		cwd: root,
	});
}

type FakeIssue = {
	id: number;
	number: number;
	html_url: string;
	title: string;
	body: string | null;
	state: "open" | "closed";
	state_reason: string | null;
	labels?: string[];
	blockedBy?: number[];
};

class FakeGh implements GhTransport {
	issues: FakeIssue[] = [];
	repositoryLabels = ["ready-for-agent", "blocked"];
	subIssues = new Map<number, number[]>();
	mutations = 0;
	loseNextCreateResponse = false;
	detachBlockerAfterDependencyMutation = false;
	mutateChildAfterDependencyMutation = false;
	dropNextSubIssueMutation = false;
	afterIssueCreate?: (issueNumber: number, cwd: string) => void;

	async run(args: string[], options: { cwd?: string; stdin?: string } = {}): Promise<GhExecution> {
		const ok = (stdout = ""): GhExecution => ({ exit_code: 0, stdout, stderr: "", timed_out: false, output_exceeded: false });
		if (args[0] === "label" && args[1] === "list")
			return ok(JSON.stringify(this.repositoryLabels.map((name) => ({ name }))));
		if (args[0] === "api" && args[1] === "repos/{owner}/{repo}")
			return ok(JSON.stringify({ id: 4242, full_name: "example/project" }));
		if (args[0] === "api") {
			const endpoint = args.at(-1) as string;
			if (endpoint.includes("/issues?state=all")) {
				if (args.includes("--paginate") && args.includes("--slurp"))
					return ok(JSON.stringify([this.issues]));
				const pageMatch = endpoint.match(/[?&]page=(\d+)/);
				const page = pageMatch ? Number(pageMatch[1]) : 1;
				const perPage = 100;
				const slice = this.issues.slice((page - 1) * perPage, page * perPage);
				return ok(JSON.stringify(slice));
			}
			const dependencyList = endpoint.match(/issues\/(\d+)\/dependencies\/blocked_by/);
			if (dependencyList && args.includes("--paginate")) {
				const child = this.issues.find((issue) => issue.number === Number(dependencyList[1]));
				const blockers = child ? [...(child as any).blockedBy ?? []] : [];
				return ok(JSON.stringify(blockers.length ? blockers.map((id: number) => [{ issue_id: id }]) : [[]]));
			}
			if (dependencyList && args.includes("--method") && args.includes("DELETE")) {
				this.mutations += 1;
				const dependencyDelete = endpoint.match(/issues\/(\d+)\/dependencies\/blocked_by\/(\d+)$/);
				if (!dependencyDelete) return { ...ok(), exit_code: 1, stderr: "bad request: DELETE requires the blocked issue id as a path segment" };
				const child = this.issues.find((issue) => issue.number === Number(dependencyDelete[1]));
				if (!child) return { ...ok(), exit_code: 1, stderr: "not found" };
				const blocker = Number(dependencyDelete[2]);
				const current = ((child as any).blockedBy ??= []) as number[];
				const index = current.indexOf(blocker);
				if (index !== -1) current.splice(index, 1);
				return ok();
			}
				if (dependencyList) {
					this.mutations += 1;
					const child = this.issues.find((issue) => issue.number === Number(dependencyList[1]));
					if (!child) return { ...ok(), exit_code: 1, stderr: "not found" };
					const blocker = Number(args.find((value) => value.startsWith("issue_id="))!.split("=")[1]);
					const current = ((child as any).blockedBy ??= []) as number[];
					if (!current.includes(blocker)) current.push(blocker);
					if (this.detachBlockerAfterDependencyMutation) {
						this.detachBlockerAfterDependencyMutation = false;
						const blockerNumber = this.issues.find((issue) => issue.id === blocker)?.number;
						if (blockerNumber !== undefined) {
							for (const [parent, children] of this.subIssues)
								this.subIssues.set(parent, children.filter((number) => number !== blockerNumber));
						}
					}
					if (this.mutateChildAfterDependencyMutation) {
						this.mutateChildAfterDependencyMutation = false;
						child.body += "\nconcurrent edit";
					}
					return ok();
				}
				const subIssueList = endpoint.match(/issues\/(\d+)\/sub_issues/);
			if (subIssueList && !args.some((flag) => flag === "-F" || flag === "-f")) {
				const numbers = this.subIssues.get(Number(subIssueList[1])) ?? [];
				const pages = Array.from({ length: Math.ceil(numbers.length / 100) }, (_, index) => numbers.slice(index * 100, (index + 1) * 100).map((number) => ({ number })));
				return ok(JSON.stringify(args.includes("--slurp") ? pages : (pages[0] ?? [])));
			}
			if (subIssueList) {
				this.mutations += 1;
				const parent = Number(subIssueList[1]);
				const childId = Number(args.find((value) => value.startsWith("sub_issue_id="))!.split("=")[1]);
				const child = this.issues.find((issue) => issue.id === childId);
				if (!child) return { ...ok(), exit_code: 1, stderr: "unknown sub_issue_id" };
				if (this.dropNextSubIssueMutation) {
					this.dropNextSubIssueMutation = false;
					return ok();
				}
				const existingParent = [...this.subIssues.entries()].find(([, children]) => children.includes(child.number));
				if (existingParent && existingParent[0] !== parent)
					return { ...ok(), exit_code: 1, stderr: `HTTP 422: Issue #${child.number} already has a parent (#${existingParent[0]})` };
				const current = this.subIssues.get(parent) ?? [];
				if (!current.includes(child.number)) current.push(child.number);
				this.subIssues.set(parent, current);
				return ok();
			}
		}
		if (args[0] === "issue" && args[1] === "create") {
			this.mutations += 1;
			if (Buffer.byteLength(options.stdin ?? "", "utf8") > 65_536)
				return { exit_code: 1, stdout: "", stderr: "body too long", timed_out: false, output_exceeded: false };
			const number = this.issues.length + 1;
			this.issues.push({
				id: number + 1000,
				number,
				html_url: `https://github.com/example/project/issues/${number}`,
				title: args[args.indexOf("--title") + 1],
				body: options.stdin ?? "",
				state: "open",
				state_reason: null,
				labels: args.flatMap((value, index) => (value === "--label" ? [args[index + 1]] : [])),
			});
			this.afterIssueCreate?.(number, options.cwd ?? "");
			if (this.loseNextCreateResponse) {
				this.loseNextCreateResponse = false;
				return { exit_code: 1, stdout: "", stderr: "gho_secret timeout", timed_out: true, output_exceeded: false };
			}
			return ok(this.issues.at(-1)?.html_url);
		}
		if (args[0] === "issue" && args[1] === "edit") {
			this.mutations += 1;
			if (Buffer.byteLength(options.stdin ?? "", "utf8") > 65_536)
				return { exit_code: 1, stdout: "", stderr: "body too long", timed_out: false, output_exceeded: false };
			const issue = this.issues.find((candidate) => candidate.number === Number(args[2]));
			if (!issue) return { ...ok(), exit_code: 1, stderr: "not found" };
			const titleIndex = args.indexOf("--title");
			if (titleIndex !== -1 && args[titleIndex + 1] !== undefined) issue.title = args[titleIndex + 1];
			if (options.stdin !== undefined) issue.body = options.stdin;
			for (let index = 0; index < args.length; index += 1) {
				if (args[index] === "--add-label" && !(issue.labels ??= []).includes(args[index + 1])) issue.labels.push(args[index + 1]);
				if (args[index] === "--remove-label") issue.labels = (issue.labels ?? []).filter((label) => label !== args[index + 1]);
			}
			return ok();
		}
		if (args[0] === "issue" && args[1] === "close") {
			this.mutations += 1;
			const issue = this.issues.find((candidate) => candidate.number === Number(args[2]));
			if (!issue) return { ...ok(), exit_code: 1, stderr: "not found" };
			issue.state = "closed";
			issue.state_reason = args.at(-1) === "not planned" ? "not_planned" : "completed";
			return ok();
		}
		return { ...ok(), exit_code: 1, stderr: `unexpected fake gh call: ${args.join(" ")}` };
	}
}

const INITIATIVE = {
	op: "create-initiative" as const,
	initiative_id: "tracking-v1",
	goal: "Track a large delivery",
	projection: { short_name: "tracking", title: "Track a large delivery" },
	slices: [{ id: "S1", goal: "Ship the first bounded Task" }],
};

const TRACKED_TASK = {
	op: "upsert-task" as const,
	initiative_id: "tracking-v1",
	task_id: "2026-08-22-001-task",
	slice_id: "S1",
	goal: "Ship the first bounded Task",
	risk: "material" as const,
	acceptance: [{ id: "acc-task", summary: "The bounded Task is verified" }],
	projection: { short_name: "tracking", title: "Ship the first bounded Task", slice_ordinal: 1 },
};
const BLOCKER_TASK = {
	...TRACKED_TASK,
	task_id: "blocker-task",
	projection: { short_name: "tracking", title: "Publish the prerequisite contract", slice_ordinal: 1 },
};
const AGENT_READY_TASK = {
	...TRACKED_TASK,
	task_id: "agent-ready-task",
	projection: {
		short_name: "tracking",
		title: "Publish an Agent-ready Task",
		slice_ordinal: 1,
		result: "Publish an Agent-ready Task",
		current_behavior: "The projection is sparse.",
		desired_behavior: "The projection is self-contained.",
		key_interfaces: ["TaskIntent", "GitHub Issue API"],
		verification: "bun test tests/plugin-package-runtime.test.ts",
		blocked_by: ["blocker-task"],
		out_of_scope: ["GitHub authority"],
		agent_handoff: "Implement the bounded result only.",
	},
};

function writeTrackedIntent(
	root: string,
	taskId: string,
	goal: string,
	risk: "routine" | "material" | "critical" = "material",
	assertions: string[] = [`${goal} is verified`],
) {
	const intentPath = `docs/plans/${taskId}.intent.json`;
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	writeFileSync(join(root, intentPath), `${JSON.stringify({
		contract: "assurance_kernel/task_intent/v1",
		task_id: taskId,
		goal,
		acceptance: assertions.map((assertion, index) => ({
			id: assertions.length === 1 ? `acc-${taskId}` : `acc-${taskId}-${index + 1}`,
			assertion,
			verification: "{}",
		})),
		scope_hint: ["tests/**"],
		risk,
		revision: 1,
		owner: "user",
	}, null, 2)}\n`);
	return intentPath;
}

function initializeTrackedIntents(root: string, tasks: Array<{
	task_id: string;
	goal: string;
	risk?: "routine" | "material" | "critical";
	assertions?: string[];
}>) {
	spawnSync("git", ["init", "-q"], { cwd: root });
	const paths = tasks.map((task) => writeTrackedIntent(root, task.task_id, task.goal, task.risk, task.assertions));
	spawnSync("git", ["add", ...paths], { cwd: root });
	return paths;
}

function publicAcceptance(taskId: string, count = 1, summary = "Deliver the bounded acceptance result") {
	return Array.from({ length: count }, (_, index) => ({
		id: count === 1 ? `acc-${taskId}` : `acc-${taskId}-${index + 1}`,
		summary,
	}));
}

async function withPublishedParent(fn: (root: string, gh: FakeGh) => Promise<void>) {
	await withIsolatedRootAsync(async (root) => {
		const gh = new FakeGh();
		expect((await runGithubTrackerOperation(root, INITIATIVE, gh)).status).toBe("created");
		await fn(root, gh);
	});
}

describe("plugin package runtime cutover parity", () => {
	it("list-commands exposes the CLI command manifest", () => {
		const ts = spawnSync("bun", [TS_RUNTIME, "list-commands", "--json"], {
			encoding: "utf-8",
			cwd: REPO_ROOT,
		});
		expect(ts.status).toBe(0);
		const commands = JSON.parse(ts.stdout).commands;
		const names = commands.map((command: any) => command.name).sort();
		expect(names).toEqual(["imm-kernel", "imm-plan", "imm-tracker"]);
		const retired = JSON.parse(ts.stdout).retired as string[];
		expect(retired).toContain("imm-work");
		expect(retired).toContain("imm-review");
		expect(retired).toContain("imm-migrate");
		expect(retired).toContain("imm-finish");
		const kernel = commands.find(
			(command: any) => command.name === "imm-kernel",
		);
		expect(kernel.description).toContain("Kernel");
		expect(kernel.examples).toEqual([
			"imm-kernel intent author docs/plans/<task-id>.intent.json --stdin --json",
			"imm-kernel intent validate docs/plans/<task-id>.intent.json --json",
			"imm-kernel status --json",
			"imm-kernel inspect --json",
			"imm-kernel audit --legacy",
		]);
		expect(JSON.stringify(commands)).not.toContain("tools/list");
		expect(JSON.stringify(commands)).not.toContain("tools/call");
		const tracker = commands.find((command: any) => command.name === "imm-tracker");
		expect(tracker.description).toContain("Never grants or consumes Kernel authority");
		expect(tracker.examples).toEqual([
			"imm-tracker publish-initiative --stdin --json",
		]);
	});

	it("ships canonical Planner and Loop tracker authority contracts", () => {
		const plannerPacked = readFileSync(join(REPO_ROOT, "plugins/immune-brain/dist/imm-planner.md"), "utf8");
		const loopPacked = readFileSync(join(REPO_ROOT, "plugins/immune-brain/dist/imm-loop.md"), "utf8");
		const carrierSection = (contract: string) => {
			const section = contract.match(
				/### Initiative Carrier Preference\n\n[\s\S]*?(?=\n### Verification Descriptor Discipline)/,
			)?.[0];
			expect(section).toBeDefined();
			return section!
				.replace(
					/Resolve `(?:\.\.\/){1,2}bin\/imm-tracker` from this (?:Skill location|packaged contract)/,
					"Resolve `<imm-tracker>`",
				)
				.replace(/\s+/g, " ")
				.trim();
		};
		const packedCarrier = carrierSection(plannerPacked);
		for (const contract of [packedCarrier]) {
			expect(contract).toContain("Initiative carrier default: local");
			expect(contract).toContain("Initiative carrier default: github");
			expect(contract).toContain("A repository directive overrides the user-level directive");
			expect(contract).toContain("There is no silent carrier default");
			expect(contract).toContain(
				"Never resolve to `local` or `github` because a source was absent or unreadable",
			);
			expect(contract).toContain("standing opt-in for GitHub projection");
			expect(contract).toContain(
				"the literal user must still confirm the named Initiative, its immutable slug, and the complete Parent/Child decomposition before the first remote mutation",
			);
			expect(contract).toContain(
				"A prior bulk approval cannot confirm a name, slug, Child, or dependency that had not yet been shown",
			);
			expect(contract).toContain(
				"After approval, author, stage, and validate every TaskIntent in the decomposition with `valid: true` and `enrollment_ready: true`",
			);
			expect(contract).toContain(
				"GitHub carrier outcome must be exactly one of: `tracker_associated` after the complete batch returns `created`, `updated`, or `already_current`",
			);
			expect(contract).toContain(
				"A candidate Initiative or partial Issue set recorded only in the Spec or final summary is neither user confirmation nor a completed carrier outcome",
			);
			expect(contract).not.toContain("and the slug is confirmed");
			expect(contract).not.toContain("awaiting_user_slug_confirmation");
			expect(contract).toContain("public `acceptance` entries with `id` and a 1-500 character `summary`");
			expect(contract).toContain("IDs must match every canonical TaskIntent acceptance ID exactly once");
			expect(contract).toContain("Canonical assertion prose is authority evidence and must never be copied");
			expect(contract).toContain("ordinary TaskIntents remain tracked by Kernel TaskRecords");
			expect(contract).toContain("display one non-blocking line");
			expect(contract).toContain("publish-initiative --stdin --json");
			expect(contract).toContain("complete Parent/Child decomposition");
			expect(contract).toContain("granularity");
			expect(contract).toContain("execution recommendation");
			expect(contract).not.toContain("create-initiative --stdin --json");
			expect(contract).not.toContain("upsert-task --initiative-id");
			expect(contract).toContain("Tracker output is observation, never authority");
			expect(contract).toContain("blocks `tracker_associated` and every Enrollment or execution handoff");
			expect(contract).not.toContain("upsert-initiative");
			expect(contract).not.toContain("mark-active");
		}
		for (const contract of [loopPacked]) {
			expect(contract).toContain("fresh claimless");
			expect(contract).toContain("completed");
			expect(contract).toContain("not planned");
			expect(contract).toMatch(/never (use it|treat (it|them)) as evidence/);
			expect(contract).not.toContain("Enrollment projects `active`");
		}
		expect(existsSync(join(REPO_ROOT, "plugins/immune-brain/runtime/github_issue_tracker.ts"))).toBe(true);
		expect(existsSync(IMM_TRACKER_WRAPPER)).toBe(true);
	});

	it("cli imm-plan validates the current migration plan and returns matching summary", () => {
		const planPath =
			"docs/plans/archive/2026-07-30-002-refactor-legacy-project-migration-plan.md";
		const ts = spawnSync(
			"bun",
			[TS_RUNTIME, "cli", "imm-plan", planPath, "--json"],
			{
				encoding: "utf-8",
				cwd: REPO_ROOT,
			},
		);
		// v4 runtime: genuine read-only validation of the explicit Plan.
		expect(ts.status).toBe(0);
		const tsJson = JSON.parse(ts.stdout);
		expect(tsJson.summary).toContain("legacy projects");
		expect(tsJson.steps).toHaveLength(3);
		expect(tsJson.origin_coverage.complete).toBe(true);
		expect(tsJson.contract).toBeUndefined();
	});

	it("cli imm-work status is retired after v4 storage retirement", () => {
		const ts = spawnSync(
			"bun",
			[TS_RUNTIME, "cli", "imm-work", "status", "--json"],
			{
				encoding: "utf-8",
				cwd: REPO_ROOT,
			},
		);
		expect(ts.status).toBe(1);
		expect(ts.stderr).toMatch(/v3_storage_retired|drain_required/);
	});

	it("executes the read-only legacy audit through isolated package fixtures", () => {
		withIsolatedRoot((root) => {
			const statePath = join(root, ".imm", "memory", "current_iteration.json");
			const planPath = join(root, "docs", "plans", "plan.md");
			writeFileSync(
				statePath,
				`${JSON.stringify(
					{ schema_version: 3, plan_path: "docs/plans/plan.md", runtime_status: "idle", active_step: null, steps: {} },
					null,
					2,
				)}\n`,
			);
			const before = readFileSync(statePath, "utf8");
			const projected = immKernel(root, ["audit", "--legacy"]);
			expect(projected.status).toBe(0);
			const body = JSON.parse(projected.stdout);
			expect(body.contract).toBe("assurance_kernel/legacy_audit/v1");
			expect(body.read_only).toBe(true);
			expect(body.writes_performed).toBe(false);
			expect(readFileSync(statePath, "utf8")).toBe(before);
		}, PACKAGE_ROADMAP_PLAN);
	});

	it("routes imm-kernel through the canonical read-only package surface", () => {
		withIsolatedRoot((root) => {
			writeFileSync(
				join(root, ".imm", "memory", "current_iteration.json"),
				`${JSON.stringify({ schema_version: 3, plan_path: "docs/plans/plan.md", runtime_status: "idle", active_step: null, steps: {} }, null, 2)}\n`,
			);
			const statePath = join(root, ".imm", "memory", "current_iteration.json");
			const beforeState = readFileSync(statePath, "utf8");

			const status = immKernel(root, ["status", "--json"]);
			expect(status.status).toBe(0);
			expect(JSON.parse(status.stdout)).toMatchObject({
				contract: "assurance_kernel/status/v1",
				// Pre-migration fixture: the owner-free legacy layout is
				// reported as migration_required; status never projects it
				// as current authority.
				layout: { layout: "migration_required" },
			});

			const audit = immKernel(root, ["audit", "--legacy"]);
			expect(audit.status).toBe(0);
			expect(JSON.parse(audit.stdout)).toMatchObject({
				contract: "assurance_kernel/legacy_audit/v1",
				read_only: true,
			});

			const retired = immKernel(root, ["journal", "--json"]);
			expect(retired.status).toBe(2);
			expect(retired.stderr).toContain("invalid_kernel_command");

			const invalid = immKernel(root, ["unknown", "--json"]);
			expect(invalid.status).toBe(2);
			expect(invalid.stderr).toContain("invalid_kernel_command");
			expect(readFileSync(statePath, "utf8")).toBe(beforeState);
			expect(existsSync(join(root, ".imm/state"))).toBe(false);
			expect(existsSync(join(root, ".imm/state/workspace.json"))).toBe(false);
		});
	});

	it("prints retired wall for imm-work record-execution", () => {
		withIsolatedRoot((root) => {
			const help = cli(root, ["imm-work", "record-execution", "--help"]);
			expect(help.status).toBe(1);
			expect(help.stderr).toMatch(/v3_storage_retired|drain_required/);
		});
	});

	it("executes work-probe handoff is retired after v4 storage retirement", () => {
		withIsolatedRoot((root) => {
			expect(
				cli(root, ["imm-work", "activate", "docs/plans/plan.md", "1"])
					.status,
			).toBe(1);
			const continued = immWork(root, [
				"continue",
				"--dispatch-available",
				"--authorized",
			]);
			expect(continued.status).toBe(1);
			expect(continued.stderr).toMatch(/v3_storage_retired|drain_required/);
		});
	});

	it("rejects removed legacy execution evidence flags", () => {
		withIsolatedRoot((root) => {
			const retired = cli(root, [
				"imm-work",
				"record-execution",
				"--evidence-json={\"checks\":[]}",
			]);
			expect(retired.status).toBe(1);
			expect(retired.stderr).toMatch(/v3_storage_retired|drain_required/);
		});
	});

	it("cli imm-heal is retired after v4 storage retirement", () => {
		withIsolatedRoot((root) => {
			const heal = cli(root, ["imm-heal"]);
			expect(heal.status).toBe(1);
			expect(heal.stderr).toMatch(/v3_storage_retired|drain_required/);
		});
	});

	it("v3 mutating commands are retired (evidence/review/finish)", () => {
		withIsolatedRoot((root) => {
			for (const cmd of [
				["imm-work", "record-execution"],
				["imm-review", "pass", "--evidence=fixture"],
				["imm-finish", "summary", "next"],
			]) {
				const r = cli(root, cmd);
				expect(r.status).toBe(1);
				expect(r.stderr).toMatch(/v3_storage_retired|drain_required/);
			}
		});
	});

	it("creates the Parent once, refuses carrier conflicts, and never rewrites it", async () => {
		await withIsolatedRootAsync(async (root) => {
			const gh = new FakeGh();
			gh.loseNextCreateResponse = true;
			const requested = {
				...INITIATIVE,
				goal: "Track a large delivery for gho_supersecret",
				projection: { short_name: "tracking", title: "Track a large delivery for gho_supersecret" },
			};
			const initiative = await runGithubTrackerOperation(root, requested, gh);
			expect(initiative).toMatchObject({ status: "created", association_found: true, issue_number: 1 });
			expect(initiative.message).not.toContain("gho_secret");
			expect(gh.issues[0].title).toBe("[tracking] Track a large delivery for [REDACTED_GITHUB_TOKEN]");
			expect(gh.issues[0].body).toContain("[REDACTED_GITHUB_TOKEN]");
			expect(gh.issues[0].body).toContain("<!-- immune-brain:slice-id=S1 -->");
			expect(gh.issues[0].body).toContain("## How to use this Issue");
			expect(gh.issues[0].body).toContain("Outbound visibility only");
			expect(gh.issues[0].body).toContain("the tracker never changes or closes it automatically");
			expect(gh.issues[0].body).toContain("**S1**: Ship the first bounded Task");

			expect(await runGithubTrackerOperation(root, requested, gh)).toMatchObject({ status: "already_current" });
			const originalTitle = gh.issues[0].title;
			gh.issues[0].title = "manually changed title";
			const beforeTitleDrift = gh.mutations;
			expect(await runGithubTrackerOperation(root, requested, gh)).toMatchObject({ status: "permanent_failure" });
			expect(gh.mutations).toBe(beforeTitleDrift);
			gh.issues[0].title = originalTitle;

			const before = gh.mutations;
			const refused = await runGithubTrackerOperation(root, { ...INITIATIVE, goal: "Changed after creation" }, gh);
			expect(refused).toMatchObject({ status: "permanent_failure", association_found: true });
			expect(gh.mutations).toBe(before);

			mkdirSync(join(root, "docs", "initiatives"), { recursive: true });
			writeFileSync(join(root, "docs", "initiatives", `${INITIATIVE.initiative_id}.md`), "# Local source\n");
			const conflict = await runGithubTrackerOperation(root, INITIATIVE, gh);
			expect(conflict.status).toBe("permanent_failure");
			expect(conflict.message).toContain("carrier conflict");
			expect(gh.mutations).toBe(before);
		});
	});

	it("accepts legal GitHub Issues with null body and rejects non-null malformed body before mutation", async () => {
		await withIsolatedRootAsync(async (root) => {
			const gh = new FakeGh();
			gh.issues.push({
				id: 9001,
				number: 472,
				html_url: "https://github.com/example/project/issues/472",
				title: "Issue with null body",
				body: null,
				state: "open",
				state_reason: null,
			});

			const created = await runGithubTrackerOperation(root, INITIATIVE, gh);
			expect(created).toMatchObject({ status: "created", association_found: true, issue_number: 2 });
			expect(gh.mutations).toBe(1);

			const beforeMalformed = gh.mutations;
			gh.issues.push({
				id: 9002,
				number: 473,
				html_url: "https://github.com/example/project/issues/473",
				title: "Issue with non-string non-null body",
				body: 12345 as any,
				state: "open",
				state_reason: null,
			});

			const malformed = await runGithubTrackerOperation(root, INITIATIVE, gh);
			expect(malformed).toMatchObject({ status: "permanent_failure", association_found: false });
			expect(malformed.message).toContain("malformed Issue");
			expect(gh.mutations).toBe(beforeMalformed);
		});
	});

	it("publishes one neutral open Child per Task and converges the native Sub-issue relation idempotently", async () => {
		await withIsolatedRootAsync(async (root) => {
			const gh = new FakeGh();
			const missingParent = await runGithubTrackerOperation(root, TRACKED_TASK, gh);
			expect(missingParent.status).toBe("permanent_failure");
			expect((await runGithubTrackerOperation(root, INITIATIVE, gh)).status).toBe("created");

			const beforeMutations = gh.mutations;
			const pristineParentBody = gh.issues[0].body;
			gh.issues[0].body = pristineParentBody.replace(
				"## Slices",
				"## Slices\n- [ ] <!-- immune-brain:slice-id=S1 --> `S1`: duplicated entry",
			);
			const duplicateSlice = await runGithubTrackerOperation(root, TRACKED_TASK, gh);
			expect(duplicateSlice.status).toBe("ambiguous_remote_state");
			expect(gh.mutations).toBe(beforeMutations);
			gh.issues[0].body = pristineParentBody.replace("<!-- immune-brain:slice-id=S1 -->", "");
			const missingSlice = await runGithubTrackerOperation(root, TRACKED_TASK, gh);
			expect(missingSlice.status).toBe("ambiguous_remote_state");
			expect(gh.mutations).toBe(beforeMutations);
			gh.issues[0].body = pristineParentBody;

			const published = await runGithubTrackerOperation(root, TRACKED_TASK, gh);
			expect(published).toMatchObject({ status: "created", association_found: true, issue_number: 2 });
			expect(gh.issues[1].state).toBe("open");
			expect(gh.subIssues.get(1)).toEqual([2]);
			expect(gh.issues[1].body).toContain("<!-- immune-brain:initiative-id=tracking-v1 -->");
			expect(gh.issues[1].body).toContain("<!-- immune-brain:slice-id=S1 -->");
			expect(gh.issues[1].body).toContain("| Initiative | `tracking-v1` |");
			expect(gh.issues[1].body).toContain("Outbound visibility only");
			expect(gh.issues[1].body).toContain("only a claimless terminal projection closes it");
			expect(gh.issues[1].body).not.toContain("tracker-state");
			expect(gh.issues[1].body).not.toContain(".intent.json");

			expect(await runGithubTrackerOperation(root, TRACKED_TASK, gh)).toMatchObject({ status: "already_current" });
			gh.issues[1].blockedBy = [9999];
			const beforeUnexpectedEdge = gh.mutations;
			expect(await runGithubTrackerOperation(root, TRACKED_TASK, gh)).toMatchObject({ status: "ambiguous_remote_state" });
			expect(gh.mutations).toBe(beforeUnexpectedEdge);
			gh.issues[1].blockedBy = [];

			gh.subIssues.delete(1);
			expect(await runGithubTrackerOperation(root, TRACKED_TASK, gh)).toMatchObject({ status: "updated" });
			expect(gh.subIssues.get(1)).toEqual([2]);

			gh.subIssues.delete(1);
			gh.subIssues.set(999, [2]);
			const foreign = await runGithubTrackerOperation(root, TRACKED_TASK, gh);
			expect(foreign.status).toBe("permanent_failure");
			expect(foreign.message).toContain("already has a parent");
			expect(gh.subIssues.has(1)).toBe(false);
			gh.subIssues.set(1, [2]);

			const wrongSlice = await runGithubTrackerOperation(root, { ...TRACKED_TASK, slice_id: "S2" }, gh);
			expect(wrongSlice.status).toBe("ambiguous_remote_state");
			expect(existsSync(join(root, ".imm/state"))).toBe(false);
		});
	});

	it("renders result-oriented Agent Briefs without IB prefixes", async () => {
		await withPublishedParent(async (root, gh) => {
			expect((await runGithubTrackerOperation(root, BLOCKER_TASK, gh)).status).toBe("created");
			const published = await runGithubTrackerOperation(root, AGENT_READY_TASK, gh);
			expect(published).toMatchObject({ status: "created", issue_number: 3 });
			const child = gh.issues.find((issue) => issue.number === 3)!;
			expect(child.title).toBe("[tracking] S1 Publish an Agent-ready Task");
			expect(child.title).not.toContain("agent-ready-task");
			expect(child.title).not.toContain("IB:");
			expect(child.body).toContain("## Parent");
			expect(child.body).toContain("[#1](https://github.com/example/project/issues/1)");
			expect(child.body).toContain("## Current behavior");
			expect(child.body).not.toContain("## What to build");
			expect(child.body).toContain("## Desired behavior");
			expect(child.body).toContain("## Key interfaces");
			expect(child.body).toContain("## Blocked by");
			expect(child.body).toContain("`blocker-task`");
			expect(child.body).toContain("## Agent handoff");
			expect(child.body).toContain("Outbound visibility only");
			expect(child.body).not.toContain("[IB:");
			expect(child.body).not.toContain(".intent.json");
			const originalChildTitle = child.title;
			child.title = "manually changed Child title";
			const beforeChildTitleDrift = gh.mutations;
			expect(await runGithubTrackerOperation(root, AGENT_READY_TASK, gh)).toMatchObject({ status: "permanent_failure" });
			expect(gh.mutations).toBe(beforeChildTitleDrift);
			child.title = originalChildTitle;
			expect(gh.subIssues.get(1)).toEqual([2, 3]);
			expect(child.blockedBy ?? []).toEqual([1002]);
		});
	});

	it("publishes a complete Initiative batch and returns a deterministic execution recommendation", async () => {
		await withIsolatedRootAsync(async (root) => {
			const gh = new FakeGh();
			const tasks = [
				{ task_id: "foundation-task", goal: "Establish the shared contract", slice_id: "foundation" },
				{ task_id: "api-task", goal: "Expose the API", slice_id: "api", blocked_by: ["foundation-task"] },
				{ task_id: "docs-task", goal: "Document the contract", slice_id: "docs", blocked_by: ["foundation-task"] },
			];
			const paths = initializeTrackedIntents(root, tasks);
			const input = {
				initiative_id: "complete-batch",
				goal: "Ship one complete Initiative",
				projection: {
					short_name: "tracking",
					title: "Track a large delivery",
					problem: "Incremental ticket publication hides the full decomposition.",
					result: "The complete delivery is reviewable before publication.",
					design: "The foundation contract lands first; API and documentation then proceed independently.",
					decisions: ["Publish the complete issue graph in one batch."],
				},
				tasks: tasks.map((task, index) => ({
					slice_id: task.slice_id,
					intent: paths[index],
					acceptance: publicAcceptance(task.task_id),
					projection: { title: task.goal, result: task.goal, blocked_by: task.blocked_by },
				})),
			};

			const published = await runGithubInitiativePublication(root, input, gh);
			expect(published).toMatchObject({
				status: "created",
				initiative: { issue_number: 1 },
				execution: {
					recommended_first_task_id: "foundation-task",
					recommended_first_issue_number: 2,
					order: ["foundation-task", "api-task", "docs-task"],
					issue_order: [2, 3, 4],
					parallel_groups: [["foundation-task"], ["api-task", "docs-task"]],
					parallel_issue_groups: [[2], [3, 4]],
				},
			});
			expect(published.tasks.map((task) => task.issue_number)).toEqual([2, 3, 4]);
			expect(gh.subIssues.get(1)).toEqual([2, 3, 4]);
			expect(gh.issues[0].body).toContain("## Initiative design");
			expect(gh.issues[1].body).toContain("[#1](https://github.com/example/project/issues/1)");
			expect(gh.issues[2].blockedBy).toEqual([1002]);
			expect(gh.issues[3].blockedBy).toEqual([1002]);

			const retried = await runGithubInitiativePublication(root, input, gh);
			expect(retried.status).toBe("already_current");
		});
	});

	it("publishes explicit public acceptance without canonical assertion disclosure", async () => {
		await withIsolatedRootAsync(async (root) => {
			const gh = new FakeGh();
			const assertion = `${"x".repeat(600)} docs/plans/private.intent.json`;
			const paths = initializeTrackedIntents(root, [
				{ task_id: "long-acceptance", goal: "Publish long acceptance", assertions: [assertion] },
				{ task_id: "normal-acceptance", goal: "Publish normal acceptance" },
			]);
			const summary = "Deliver the long acceptance result";
			const published = await runGithubInitiativePublication(root, {
				initiative_id: "long-acceptance-batch",
				goal: "Publish safe acceptance summaries",
				projection: {
					short_name: "tracking",
					title: "Track a large delivery",
					problem: "Canonical assertions can contain internal authority context.",
					result: "Publish only explicit public acceptance summaries.",
					design: "Canonical IDs bind public summaries without exposing assertion prose.",
				},
				tasks: [
					{ slice_id: "long", intent: paths[0], acceptance: publicAcceptance("long-acceptance", 1, summary), projection: { title: "Long acceptance" } },
					{ slice_id: "normal", intent: paths[1], acceptance: publicAcceptance("normal-acceptance"), projection: { title: "Normal acceptance" } },
				],
			}, gh);

			expect(published.status).toBe("created");
			const body = gh.issues.find((issue) => issue.title === "[tracking] S1 Long acceptance")?.body ?? "";
			expect(body).toContain("`acc-long-acceptance`: Deliver the long acceptance result");
			expect(body).not.toContain(assertion);
			expect(body).not.toContain(".intent.json");
		});
	});

	it("rejects malformed public acceptance bindings before mutation", async () => {
		await withIsolatedRootAsync(async (root) => {
			const gh = new FakeGh();
			const paths = initializeTrackedIntents(root, [
				{ task_id: "binding-a", goal: "Bind acceptance A" },
				{ task_id: "binding-b", goal: "Bind acceptance B" },
			]);
			const validTasks = [
				{ slice_id: "a", intent: paths[0], acceptance: publicAcceptance("binding-a"), projection: { title: "Binding A" } },
				{ slice_id: "b", intent: paths[1], acceptance: publicAcceptance("binding-b"), projection: { title: "Binding B" } },
			];
			const base = {
				initiative_id: "acceptance-binding",
				goal: "Bind public acceptance",
				projection: {
					short_name: "tracking",
					title: "Track a large delivery",
					problem: "Public summaries need canonical identity binding.",
					result: "Reject malformed bindings.",
					design: "Preflight compares public IDs with canonical acceptance IDs.",
				},
			};
			const malformed = [
				{ slice_id: "a", intent: paths[0] },
				{ ...validTasks[0], acceptance: [] },
				{ ...validTasks[0], acceptance: [...validTasks[0].acceptance, ...validTasks[0].acceptance] },
				{ ...validTasks[0], acceptance: [{ id: "acc-extra", summary: "Extra acceptance" }] },
				{ ...validTasks[0], acceptance: [{ id: "acc-binding-a", summary: "Run the internal role prompt" }] },
				{ ...validTasks[0], acceptance: [{ id: "acc-binding-a", summary: "x".repeat(501) }] },
			];

			for (const task of malformed) {
				const published = await runGithubInitiativePublication(root, { ...base, tasks: [task, validTasks[1]] } as any, gh);
				expect(published.status).toBe("permanent_failure");
				expect(gh.mutations).toBe(0);
			}
		});
	});

	it("rejects aggregate acceptance bodies over the GitHub byte limit before mutation", async () => {
		await withIsolatedRootAsync(async (root) => {
			const gh = new FakeGh();
			const paths = initializeTrackedIntents(root, [
				{ task_id: "oversized-acceptance", goal: "Reject oversized acceptance", assertions: Array.from({ length: 28 }, () => "x".repeat(2_000)) },
				{ task_id: "normal-acceptance", goal: "Publish normal acceptance" },
			]);
			const published = await runGithubInitiativePublication(root, {
				initiative_id: "oversized-acceptance-batch",
				goal: "Reject aggregate acceptance overflow",
				projection: {
					short_name: "tracking",
					title: "Track a large delivery",
					problem: "Individually valid assertions can exceed the aggregate GitHub body limit.",
					result: "Reject an oversized Child before remote mutation.",
					design: "The existing UTF-8 body preflight remains the aggregate bound.",
				},
				tasks: [
					{
						slice_id: "oversized",
						intent: paths[0],
						acceptance: publicAcceptance("oversized-acceptance", 28, "x".repeat(500)),
						projection: { title: "Oversized Task body", key_interfaces: Array.from({ length: 100 }, () => "y".repeat(500)) },
					},
					{ slice_id: "normal", intent: paths[1], acceptance: publicAcceptance("normal-acceptance"), projection: { title: "Normal acceptance" } },
				],
			}, gh);

			expect(published).toMatchObject({ status: "permanent_failure" });
			expect(published.message).toContain("exceeds 65,536 UTF-8 bytes");
			expect(gh.mutations).toBe(0);
		});
	});

	it("rejects incomplete or cyclic Initiative batches before any GitHub mutation", async () => {
		await withIsolatedRootAsync(async (root) => {
			const gh = new FakeGh();
			const paths = initializeTrackedIntents(root, [
				{ task_id: "task-a", goal: "Ship A" },
				{ task_id: "task-b", goal: "Ship B" },
			]);
			const base = {
				initiative_id: "invalid-batch",
				goal: "Reject invalid batches",
				projection: {
					short_name: "tracking",
					title: "Track a large delivery",
					problem: "An invalid graph must not reach GitHub.",
					result: "Reject invalid batches",
					design: "A and B must not form a cycle.",
				},
				tasks: [
					{ slice_id: "a", intent: paths[0], acceptance: publicAcceptance("task-a"), projection: { title: "Ship cycle A", blocked_by: ["task-b"] } },
					{ slice_id: "b", intent: paths[1], acceptance: publicAcceptance("task-b"), projection: { title: "Ship cycle B", blocked_by: ["task-a"] } },
				],
			};
			expect(await runGithubInitiativePublication(root, base, gh)).toMatchObject({ status: "permanent_failure" });
			expect(gh.mutations).toBe(0);
			expect(await runGithubInitiativePublication(root, { ...base, tasks: base.tasks.slice(0, 1) }, gh)).toMatchObject({ status: "permanent_failure" });
			expect(gh.mutations).toBe(0);
		});
	});

	it("resumes a partially published Initiative batch without duplicate Issues", async () => {
		await withIsolatedRootAsync(async (root) => {
			const gh = new FakeGh();
			const paths = initializeTrackedIntents(root, [
				{ task_id: "retry-a", goal: "Ship retry A" },
				{ task_id: "retry-b", goal: "Ship retry B" },
			]);
			const input = {
				initiative_id: "retry-batch",
				goal: "Resume one publication batch",
				projection: {
					short_name: "tracking",
					title: "Track a large delivery",
					problem: "A failed relation may leave a partial remote batch.",
					result: "Resume one publication batch",
					design: "Retry A precedes retry B.",
				},
				tasks: [
					{ slice_id: "a", intent: paths[0], acceptance: publicAcceptance("retry-a"), projection: { title: "Ship retry A", result: "Ship retry A" } },
					{ slice_id: "b", intent: paths[1], acceptance: publicAcceptance("retry-b"), projection: { title: "Ship retry B", result: "Ship retry B", blocked_by: ["retry-a"] } },
				],
			};
			gh.dropNextSubIssueMutation = true;
			const partial = await runGithubInitiativePublication(root, input, gh);
			expect(partial).toMatchObject({ status: "retryable_failure", initiative: { issue_number: 1 } });
			expect(gh.issues).toHaveLength(2);

			const resumed = await runGithubInitiativePublication(root, input, gh);
			expect(resumed.status).toBe("updated");
			expect(gh.issues).toHaveLength(3);
			expect(gh.subIssues.get(1)).toEqual([2, 3]);
		});
	});

	it("fails closed when an early Child drifts before final topology verification", async () => {
		await withIsolatedRootAsync(async (root) => {
			const gh = new FakeGh();
			const paths = initializeTrackedIntents(root, [
				{ task_id: "issue-drift-a", goal: "Ship issue drift A" },
				{ task_id: "issue-drift-b", goal: "Ship issue drift B" },
			]);
			gh.afterIssueCreate = (issueNumber) => {
				if (issueNumber === 3) gh.issues[1].body += "\nconcurrent edit";
			};
			const published = await runGithubInitiativePublication(root, {
				initiative_id: "issue-drift",
				goal: "Detect Issue drift",
				projection: {
					short_name: "tracking",
					title: "Track a large delivery",
					problem: "An early Child can drift during a long publication.",
					result: "Detect Issue drift",
					design: "Both Children must remain exact and open.",
				},
				tasks: [
					{ slice_id: "a", intent: paths[0], acceptance: publicAcceptance("issue-drift-a"), projection: { title: "Issue drift A" } },
					{ slice_id: "b", intent: paths[1], acceptance: publicAcceptance("issue-drift-b"), projection: { title: "Issue drift B" } },
				],
			}, gh);
			expect(published).toMatchObject({ status: "ambiguous_remote_state" });
			expect(published.message).toContain("content changed during Initiative publication");
			expect(published.execution).toBeUndefined();
		});
	});

	it("fails closed when a TaskIntent changes during publication", async () => {
		await withIsolatedRootAsync(async (root) => {
			const gh = new FakeGh();
			const paths = initializeTrackedIntents(root, [
				{ task_id: "intent-drift-a", goal: "Ship intent drift A" },
				{ task_id: "intent-drift-b", goal: "Ship intent drift B" },
			]);
			gh.afterIssueCreate = (issueNumber, cwd) => {
				if (issueNumber !== 2) return;
				const path = join(cwd, paths[1]);
				writeFileSync(path, readFileSync(path, "utf8").replaceAll("Ship intent drift B", "Ship changed intent B"));
			};
			const published = await runGithubInitiativePublication(root, {
				initiative_id: "intent-drift",
				goal: "Detect TaskIntent drift",
				projection: {
					short_name: "tracking",
					title: "Track a large delivery",
					problem: "TaskIntent can change during a long publication.",
					result: "Detect TaskIntent drift",
					design: "Every remote write remains bound to the reviewed intent hashes.",
				},
				tasks: [
					{ slice_id: "a", intent: paths[0], acceptance: publicAcceptance("intent-drift-a"), projection: { title: "Intent drift A" } },
					{ slice_id: "b", intent: paths[1], acceptance: publicAcceptance("intent-drift-b"), projection: { title: "Intent drift B" } },
				],
			}, gh);
			expect(published).toMatchObject({ status: "ambiguous_remote_state" });
			expect(published.message).toContain("TaskIntent intent-drift-b changed");
			expect(gh.issues).toHaveLength(2);
			expect(published.execution).toBeUndefined();
		});
	});

	it("exposes only the complete batch publication command through the tracker CLI", async () => {
		await withIsolatedRootAsync(async (root) => {
			const gh = new FakeGh();
			const paths = initializeTrackedIntents(root, [
				{ task_id: "cli-a", goal: "Ship CLI A" },
				{ task_id: "cli-b", goal: "Ship CLI B" },
			]);
			const input = {
				initiative_id: "cli-batch",
				goal: "Publish through one CLI call",
				projection: {
					short_name: "tracking",
					title: "Track a large delivery",
					problem: "The CLI needs one complete publication input.",
					result: "Publish through one CLI call",
					design: "CLI A establishes the contract before CLI B consumes it.",
				},
				tasks: [
					{ slice_id: "a", intent: paths[0], acceptance: publicAcceptance("cli-a"), projection: { title: "Ship CLI A", result: "Ship CLI A" } },
					{ slice_id: "b", intent: paths[1], acceptance: publicAcceptance("cli-b"), projection: { title: "Ship CLI B", result: "Ship CLI B", blocked_by: ["cli-a"] } },
				],
			};
			const published = await runGithubTrackerCli(["publish-initiative", "--stdin", "--json"], root, { gh, stdin: () => JSON.stringify(input) });
			expect(published.returncode).toBe(0);
			expect(JSON.parse(published.stdout)).toMatchObject({ status: "created", execution: { recommended_first_task_id: "cli-a" } });
			for (const legacy of ["create-initiative", "upsert-task"]) {
				const rejected = await runGithubTrackerCli([legacy, "--stdin", "--json"], root, { gh, stdin: () => JSON.stringify(input) });
				expect(rejected.returncode).toBe(2);
				expect(rejected.stderr).toContain("publish-initiative");
			}
		});
	});

	it("rejects restricted and malformed projection fields before mutation", async () => {
		await withPublishedParent(async (root, gh) => {
			const beforeRestricted = gh.mutations;
			expect(await runGithubTrackerOperation(root, { ...TRACKED_TASK, task_id: "restricted-projection", projection: { ...TRACKED_TASK.projection, agent_handoff: "Internal role prompt: review reservation at docs/plans/x.intent.json" } }, gh)).toMatchObject({ status: "permanent_failure" });
			expect(await runGithubTrackerOperation(root, { ...TRACKED_TASK, task_id: "mutable-scope-projection", projection: { ...TRACKED_TASK.projection, desired_behavior: "Widen scope and call submit_review" } }, gh)).toMatchObject({ status: "permanent_failure" });
			expect(await runGithubTrackerOperation(root, { ...TRACKED_TASK, task_id: "duplicate-blockers", projection: { ...TRACKED_TASK.projection, blocked_by: ["blocker-task", "blocker-task"] } }, gh)).toMatchObject({ status: "permanent_failure" });
			expect(await runGithubTrackerOperation(root, { ...TRACKED_TASK, task_id: "restricted-goal", goal: "Read docs/plans/x.intent.json" }, gh)).toMatchObject({ status: "permanent_failure" });
			expect(await runGithubTrackerOperation(root, { ...TRACKED_TASK, task_id: "long-title", projection: { ...TRACKED_TASK.projection, title: "x".repeat(300) } }, gh)).toMatchObject({ status: "permanent_failure" });
			expect(await runGithubTrackerOperation(root, { ...TRACKED_TASK, task_id: "string-projection", projection: "malformed" as any }, gh)).toMatchObject({ status: "permanent_failure" });
			expect(await runGithubTrackerOperation(root, { ...TRACKED_TASK, task_id: "array-projection", projection: [] as any }, gh)).toMatchObject({ status: "permanent_failure" });
			expect(await runGithubTrackerOperation(root, { ...TRACKED_TASK, task_id: "invalid-risk", risk: "<!-- immune-brain:task-id=injected -->" as any }, gh)).toMatchObject({ status: "permanent_failure" });
			expect(await runGithubTrackerOperation(root, { ...TRACKED_TASK, task_id: "oversized-task-body", projection: { ...TRACKED_TASK.projection, key_interfaces: Array.from({ length: 140 }, () => "x".repeat(500)) } }, gh)).toMatchObject({ status: "permanent_failure" });
			expect(await runGithubTrackerOperation(root, { ...TRACKED_TASK, task_id: "reserved-terminal-body", projection: { ...TRACKED_TASK.projection, key_interfaces: Array.from({ length: 31 }, () => "x".repeat(2000)) } }, gh)).toMatchObject({ status: "permanent_failure" });
			expect(await runGithubTrackerOperation(root, { ...INITIATIVE, initiative_id: "oversized-parent-body", projection: { short_name: "tracking", title: "Oversized parent body", decisions: Array.from({ length: 140 }, () => "x".repeat(500)) } }, gh)).toMatchObject({ status: "permanent_failure" });
			expect(await runGithubTrackerOperation(root, { ...TRACKED_TASK, task_id: "restricted-acceptance", acceptance: [{ id: "acc", summary: "Run the internal role prompt" }] }, gh)).toMatchObject({ status: "permanent_failure" });
			expect(await runGithubTrackerOperation(root, { ...TRACKED_TASK, task_id: "long-acceptance-summary", acceptance: [{ id: "acc", summary: "x".repeat(501) }] }, gh)).toMatchObject({ status: "permanent_failure" });
			for (const [index, restricted] of ["role_prompt_bridge", "review-gate", "tool policies", "model reservations", "prompt digests", "scope authorities", "kernel_runtime_states", "runtime-states", "mutable scopes", "widen_scopes", "QA-settlements"].entries()) {
				expect(await runGithubTrackerOperation(root, { ...TRACKED_TASK, task_id: `restricted-variant-${index}`, projection: { ...TRACKED_TASK.projection, agent_handoff: restricted } }, gh)).toMatchObject({ status: "permanent_failure" });
			}
			expect(await runGithubTrackerOperation(root, { ...INITIATIVE, initiative_id: "restricted-initiative-goal", goal: "Expose the review reservation" }, gh)).toMatchObject({ status: "permanent_failure" });
			expect(await runGithubTrackerOperation(root, { ...INITIATIVE, initiative_id: "restricted-slice-goal", slices: [{ id: "S1", goal: "Expose the runtime state" }] }, gh)).toMatchObject({ status: "permanent_failure" });
			expect(await runGithubTrackerOperation(root, { ...INITIATIVE, initiative_id: "restricted-slice", slices: [{ id: "S1", goal: "Ship", result: "Expose the internal tool policy" }] }, gh)).toMatchObject({ status: "permanent_failure" });
			expect(await runGithubTrackerOperation(root, { ...INITIATIVE, initiative_id: "restricted-slice-blocker", slices: [{ id: "S1", goal: "Ship", blocked_by: ["review-gate"] }] }, gh)).toMatchObject({ status: "permanent_failure" });
			expect(gh.mutations).toBe(beforeRestricted);
		});
	});

	it("converges native blocked_by edges without duplicating them", async () => {
		await withPublishedParent(async (root, gh) => {
			expect((await runGithubTrackerOperation(root, BLOCKER_TASK, gh)).status).toBe("created");
			const retryTarget = { ...TRACKED_TASK, task_id: "partial-retry-target", projection: { ...TRACKED_TASK.projection, blocked_by: ["blocker-task", "second-blocker"] } };
			expect((await runGithubTrackerOperation(root, { ...TRACKED_TASK, task_id: "second-blocker", projection: { ...TRACKED_TASK.projection, result: "Publish the second prerequisite" } }, gh)).status).toBe("created");
			expect((await runGithubTrackerOperation(root, retryTarget, gh)).status).toBe("created");
			const retryChild = gh.issues.find((issue) => issue.body.includes("partial-retry-target"))!;
			retryChild.blockedBy = [1002];
			const beforeRetry = gh.mutations;
			expect(await runGithubTrackerOperation(root, retryTarget, gh)).toMatchObject({ status: "updated" });
			expect(gh.mutations - beforeRetry).toBe(1);
			expect(retryChild.blockedBy).toEqual([1002, 1003]);
			const beforeChangedBrief = gh.mutations;
			expect(await runGithubTrackerOperation(root, { ...retryTarget, projection: { ...TRACKED_TASK.projection, blocked_by: ["blocker-task"] } }, gh)).toMatchObject({ status: "permanent_failure" });
			expect(gh.mutations).toBe(beforeChangedBrief);
			retryChild.blockedBy.push(9999);
			const beforeExtraEdge = gh.mutations;
			expect(await runGithubTrackerOperation(root, retryTarget, gh)).toMatchObject({ status: "ambiguous_remote_state" });
			expect(gh.mutations).toBe(beforeExtraEdge);
		});
	});

	it("fails closed on paged, raced, and missing blocker relations", async () => {
		await withPublishedParent(async (root, gh) => {
			expect((await runGithubTrackerOperation(root, BLOCKER_TASK, gh)).status).toBe("created");
			expect((await runGithubTrackerOperation(root, AGENT_READY_TASK, gh)).status).toBe("created");
			const blockerBody = gh.issues[1].body;
			gh.issues[1].body = `${blockerBody}\n<!-- immune-brain:task-id=other-task -->`;
			const beforeAmbiguousBlocker = gh.mutations;
			expect(await runGithubTrackerOperation(root, AGENT_READY_TASK, gh)).toMatchObject({ status: "ambiguous_remote_state" });
			expect(gh.mutations).toBe(beforeAmbiguousBlocker);
			gh.issues[1].body = blockerBody;
			const pagedAttachments = [...Array.from({ length: 100 }, (_, index) => 10_000 + index), 2, 3];
			gh.subIssues.set(1, pagedAttachments);
			expect(await runGithubTrackerOperation(root, AGENT_READY_TASK, gh)).toMatchObject({ status: "already_current" });
			const attached = [2, 3];
			gh.subIssues.set(1, attached);
			gh.subIssues.set(1, attached.filter((number) => number !== 2));
			const beforeDetached = gh.mutations;
			expect(await runGithubTrackerOperation(root, { ...TRACKED_TASK, task_id: "detached-blocker-target", projection: { ...TRACKED_TASK.projection, blocked_by: ["blocker-task"] } }, gh)).toMatchObject({ status: "ambiguous_remote_state" });
			expect(gh.mutations).toBe(beforeDetached);
			gh.subIssues.set(1, attached);
			gh.detachBlockerAfterDependencyMutation = true;
			expect(await runGithubTrackerOperation(root, { ...TRACKED_TASK, task_id: "raced-blocker-target", projection: { ...TRACKED_TASK.projection, blocked_by: ["blocker-task"] } }, gh)).toMatchObject({ status: "ambiguous_remote_state" });
			gh.subIssues.set(1, attached);
			gh.mutateChildAfterDependencyMutation = true;
			expect(await runGithubTrackerOperation(root, { ...TRACKED_TASK, task_id: "raced-child-target", projection: { ...TRACKED_TASK.projection, blocked_by: ["blocker-task"] } }, gh)).toMatchObject({ status: "ambiguous_remote_state" });
			gh.subIssues.set(1, attached);
			gh.dropNextSubIssueMutation = true;
			const nonConverging = { ...TRACKED_TASK, task_id: "non-converging-sub-issue" };
			expect(await runGithubTrackerOperation(root, nonConverging, gh)).toMatchObject({ status: "retryable_failure" });
			expect(await runGithubTrackerOperation(root, nonConverging, gh)).toMatchObject({ status: "updated" });
			const before = gh.mutations;
			const missing = await runGithubTrackerOperation(root, { ...AGENT_READY_TASK, task_id: "missing-blocker-target", projection: { ...AGENT_READY_TASK.projection, blocked_by: ["not-published"] } }, gh);
			expect(missing.status).toBe("permanent_failure");
			expect(gh.mutations).toBe(before);
		});
	});

	it("publishes only complete batches of canonical Git-tracked TaskIntents through the CLI", async () => {
		await withIsolatedRootAsync(async (root) => {
			const gh = new FakeGh();
			const tracked = initializeTrackedIntents(root, [
				{ task_id: "tracked-a", goal: "Ship tracked A" },
				{ task_id: "tracked-b", goal: "Ship tracked B" },
			]);
			const untracked = writeTrackedIntent(root, "untracked-task", "Ship untracked work");
			const base = {
				initiative_id: "tracked-batch",
				goal: "Publish only canonical tracked work",
				projection: {
					short_name: "tracking",
					title: "Track a large delivery",
					problem: "Untracked intent files must never be projected.",
					result: "Publish only canonical tracked work",
					design: "Tracked A precedes tracked B.",
				},
			};
			const rejected = await runGithubTrackerCli(
				["publish-initiative", "--stdin", "--json"],
				root,
				{
					gh,
					stdin: () => JSON.stringify({ ...base, tasks: [
						{ slice_id: "a", intent: tracked[0], acceptance: publicAcceptance("tracked-a"), projection: { title: "Tracked A" } },
						{ slice_id: "untracked", intent: untracked, acceptance: publicAcceptance("untracked-task"), projection: { title: "Untracked work" } },
					] }),
				},
			);
			expect(rejected.returncode).toBe(1);
			expect(JSON.parse(rejected.stdout).message).toContain("not Git-tracked");
			expect(gh.mutations).toBe(0);

			const published = await runGithubTrackerCli(
				["publish-initiative", "--stdin", "--json"],
				root,
				{
					gh,
					stdin: () => JSON.stringify({ ...base, tasks: [
						{ slice_id: "a", intent: tracked[0], acceptance: publicAcceptance("tracked-a"), projection: { title: "Tracked A" } },
						{ slice_id: "b", intent: tracked[1], acceptance: publicAcceptance("tracked-b"), projection: { title: "Tracked B", blocked_by: ["tracked-a"] } },
					] }),
				},
			);
			expect(published.returncode).toBe(0);
			expect(JSON.parse(published.stdout)).toMatchObject({ status: "created", execution: { recommended_first_task_id: "tracked-a" } });
		});
	});

	it("closes a Child only from an exact terminal event and preserves manual ambiguity", async () => {
		await withIsolatedRootAsync(async (root) => {
			const gh = new FakeGh();
			expect((await runGithubTrackerOperation(root, INITIATIVE, gh)).status).toBe("created");
			expect((await runGithubTrackerOperation(root, TRACKED_TASK, gh)).status).toBe("created");
			const event = "complete:2026-08-22-001-task:2099-01-01T02:00:00.000Z";
			const terminalOp = { op: "mark-terminal" as const, task_id: TRACKED_TASK.task_id, phase: "done" as const, terminal_event_id: event };

			expect(await runGithubTrackerOperation(root, { ...terminalOp, task_id: "unpublished-task" }, gh)).toMatchObject({ status: "already_current" });

			gh.issues[1].state = "closed";
			gh.issues[1].state_reason = "completed";
			const before = gh.mutations;
			const manual = await runGithubTrackerOperation(root, terminalOp, gh);
			expect(manual.status).toBe("ambiguous_remote_state");
			expect(gh.mutations).toBe(before);
			gh.issues[1].state = "open";
			gh.issues[1].state_reason = null;

			const childBody = gh.issues[1].body;
			gh.issues[1].body = childBody.replace("<!-- immune-brain:slice-id=S1 -->", "<!-- immune-brain:slice-id=S2 -->");
			const beforeWrongSlice = gh.mutations;
			expect(await runGithubTrackerOperation(root, terminalOp, gh)).toMatchObject({ status: "ambiguous_remote_state" });
			expect(gh.mutations).toBe(beforeWrongSlice);
			gh.issues[1].body = childBody;

			gh.subIssues.delete(1);
			gh.subIssues.set(999, [2]);
			const beforeWrongParent = gh.mutations;
			expect(await runGithubTrackerOperation(root, terminalOp, gh)).toMatchObject({ status: "ambiguous_remote_state" });
			expect(gh.mutations).toBe(beforeWrongParent);
			gh.subIssues.delete(999);
			gh.subIssues.set(1, [2]);

			expect(await runGithubTrackerOperation(root, terminalOp, gh)).toMatchObject({ status: "updated" });
			expect(gh.issues[1]).toMatchObject({ state: "closed", state_reason: "completed" });
			expect(gh.issues[1].body).toContain(`<!-- immune-brain:terminal-event=${event} -->`);

			expect(await runGithubTrackerOperation(root, terminalOp, gh)).toMatchObject({ status: "already_current" });
			expect(await runGithubTrackerOperation(root, { ...terminalOp, terminal_event_id: "complete:other:1" }, gh)).toMatchObject({ status: "ambiguous_remote_state" });
			expect(await runGithubTrackerOperation(root, { ...terminalOp, phase: "stopped" }, gh)).toMatchObject({ status: "ambiguous_remote_state" });

			gh.issues[1].state = "open";
			gh.issues[1].state_reason = null;
			expect(await runGithubTrackerOperation(root, terminalOp, gh)).toMatchObject({ status: "updated" });
			expect(gh.issues[1]).toMatchObject({ state: "closed", state_reason: "completed" });

			expect((await runGithubTrackerOperation(root, { ...TRACKED_TASK, task_id: "near-limit-task" }, gh)).status).toBe("created");
			const near = gh.issues.find((issue) => issue.body.includes("near-limit-task"))!;
			const maxEvent = "e".repeat(500);
			const suffix = `\n\n<!-- immune-brain:terminal-event=${maxEvent} -->\nTerminal event: \`${maxEvent}\`\n`;
			near.body += "x".repeat(65_536 - Buffer.byteLength(suffix, "utf8") - Buffer.byteLength(near.body, "utf8"));
			expect(await runGithubTrackerOperation(root, { op: "mark-terminal", task_id: "near-limit-task", phase: "done", terminal_event_id: maxEvent }, gh)).toMatchObject({ status: "updated" });

			expect((await runGithubTrackerOperation(root, { ...TRACKED_TASK, task_id: "over-limit-task" }, gh)).status).toBe("created");
			const over = gh.issues.find((issue) => issue.body.includes("over-limit-task"))!;
			over.body += "x".repeat(65_536 - Buffer.byteLength(over.body, "utf8"));
			const beforeOver = gh.mutations;
			expect(await runGithubTrackerOperation(root, { op: "mark-terminal", task_id: "over-limit-task", phase: "done", terminal_event_id: maxEvent }, gh)).toMatchObject({ status: "permanent_failure" });
			expect(gh.mutations).toBe(beforeOver);
		});
	});

	it("fails closed on duplicate identities without mutating", async () => {
		await withIsolatedRootAsync(async (root) => {
			const gh = new FakeGh();
			expect((await runGithubTrackerOperation(root, INITIATIVE, gh)).status).toBe("created");
			gh.issues.push({ ...gh.issues[0], number: 2, html_url: "https://github.com/example/project/issues/2" });
			const before = gh.mutations;
			expect(await runGithubTrackerOperation(root, INITIATIVE, gh)).toMatchObject({ status: "ambiguous_remote_state" });
			expect(gh.mutations).toBe(before);
			gh.issues.pop();
			gh.issues[0].body = gh.issues[0].body.replace("<!-- immune-brain-tracker:v1 -->", "damaged body");
			const damaged = await runGithubTrackerOperation(root, TRACKED_TASK, gh);
			expect(damaged.status).toBe("ambiguous_remote_state");
			expect(gh.mutations).toBe(before);
		});
	});

	it("returns a closed result when gh cannot spawn", async () => {
		const result = await runGithubTrackerOperation(
			process.cwd(),
			INITIATIVE,
			createGhTransport("/definitely/missing/gh"),
		);
		expect(result).toMatchObject({
			status: "permanent_failure",
			association_found: false,
		});
		expect(result.message).toMatch(/ENOENT|no such file/i);
	});

	it("redacts credentials and routes the shipped tracker wrapper", () => {
		expect(redactGithubDiagnostic("token=abc gho_supersecret Bearer raw")).toBe(
			"credential=[REDACTED] [REDACTED_GITHUB_TOKEN] Bearer [REDACTED]",
		);
		const invalid = spawnSync(IMM_TRACKER_WRAPPER, ["--json"], { encoding: "utf8", cwd: REPO_ROOT });
		expect(invalid.status).toBe(2);
		expect(invalid.stderr).toContain("invalid_tracker_command");
	});

});

describe("initiative amendment publication", () => {
	interface PublishedState {
		parent: typeof gh.issues[number];
		child: (typeof gh.issues)[number];
	}

	/** Publish a two-Task Initiative, then close one Child terminally to serve as history. */
	async function withAmendmentBase(
		fn: (root: string, gh: FakeGh, base: { parentIssue: any; pending: any; historical: any; paths: string[] }) => Promise<void>,
	) {
		await withIsolatedRootAsync(async (root) => {
			const gh = new FakeGh();
			const tasks = [
				{ task_id: "amend-done", goal: "Deliver the completed prerequisite", slice_id: "done" },
				{ task_id: "amend-live", goal: "Deliver the pending work", slice_id: "live", blocked_by: ["amend-done"] },
			];
			const paths = initializeTrackedIntents(root, tasks);
			const input = {
				initiative_id: "amend-init",
			goal: "Ship the amendable Initiative",
			projection: {
					short_name: "tracking",
					title: "Track a large delivery",
					problem: "Planning evolves after publication.",
					result: "Ship the amendable Initiative",
					design: "One slice completes, one slice continues.",
			},
				tasks: tasks.map((task, index) => ({
					slice_id: task.slice_id,
					intent: paths[index],
					acceptance: publicAcceptance(task.task_id),
					projection: { title: task.goal, result: task.goal, blocked_by: task.blocked_by },
				})),
			};
			const published = await runGithubInitiativePublication(root, input, gh);
			expect(published.status).toBe("created");
			const historical = gh.issues.find((issue) => issue.body.includes("task-id=amend-done"))!;
			const terminal = await runGithubTrackerOperation(root, {
				op: "mark-terminal",
				initiative_id: "amend-init",
				task_id: "amend-done",
				slice_id: "done",
				phase: "done",
				terminal_event_id: "evt-amend-done",
			} as any, gh);
			expect(terminal.status).toBe("updated");
			const parentIssue = gh.issues.find((issue) => issue.body.includes("kind=initiative"))!;
			const pending = gh.issues.find((issue) => issue.body.includes("task-id=amend-live"))!;
			await fn(root, gh, { parentIssue, pending, historical, paths });
		});
	}

	const amendedGoal = (goal: string, task_id: string) => {
		const intentPath = `docs/plans/${task_id}.intent.json`;
		return { intent: intentPath };
	};

	/** Amend the pending Child's projection to a new result while keeping its TaskIntent. */
	function amendmentInput(
		paths: string[],
		parentIssue: any,
		pending: any,
		historical: any,
		overrides: { pendingResult?: string; blockedBy?: string[]; newTask?: { task_id: string; goal: string; intent: string } } = {},
	) {
		const pendingResult = overrides.pendingResult ?? pending.title;
		const tasks: any[] = [{
			slice_id: "live",
			intent: paths[1],
			acceptance: publicAcceptance("amend-live"),
			projection: {
				title: overrides.pendingResult ?? "Deliver the amended pending work",
				result: overrides.pendingResult ?? "Deliver the amended pending work",
				blocked_by: overrides.blockedBy ?? ["amend-done"],
			},
			binding: { issue_number: pending.number, title: pending.title, body: pending.body, state: "open" },
		}];
		if (overrides.newTask) {
			tasks.push({
				slice_id: "new",
				intent: overrides.newTask.intent,
				acceptance: publicAcceptance(overrides.newTask.task_id),
				projection: { title: overrides.newTask.goal, result: overrides.newTask.goal },
			});
		}
		return {
			initiative_id: "amend-init",
			goal: "Ship the amended Initiative result",
			projection: {
				short_name: "tracking",
				title: "Track a large delivery",
				problem: "Planning evolves after publication.",
				result: "Ship the amended Initiative result",
				design: "The pending frontier is amended with approved content.",
			},
			tasks,
			amendment: {
				parent: { issue_number: parentIssue.number, title: parentIssue.title, body: parentIssue.body, state: "open" },
				tasks: [{ task_id: "amend-live", binding: { issue_number: pending.number, title: pending.title, body: pending.body, state: "open" } }],
				historical: [{ task_id: "amend-done", binding: { issue_number: historical.number, title: historical.title, body: historical.body, state: "closed" } }],
			},
		};
	}

	it("rejects changed briefs without amendment input (strict default)", async () => {
		await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
			const before = gh.mutations;
			const strictInput = JSON.parse(JSON.stringify(amendmentInput(paths, parentIssue, pending, historical, { pendingResult: "Different result" })));
			delete strictInput.amendment;
			strictInput.tasks[0].projection.blocked_by = [];
			strictInput.tasks.push({
				slice_id: "done",
				intent: paths[0],
				acceptance: publicAcceptance("amend-done"),
				projection: { title: "Deliver the completed prerequisite", result: "Deliver the completed prerequisite", blocked_by: [] },
			});
			const strict = await runGithubInitiativePublication(root, strictInput as any, gh);
			expect(strict.status).toBe("permanent_failure");
			expect(gh.mutations).toBe(before);
		});
	});

	it("amends approved pending content and preserves historical bytes and relations", async () => {
		await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
			const historicalBytes = historical.body;
			const historicalTitle = historical.title;
			const amended = await runGithubInitiativePublication(
				root,
				amendmentInput(paths, parentIssue, pending, historical, { pendingResult: "Deliver the amended pending work", blockedBy: [] }),
				gh,
			);
			expect(amended.status).toBe("updated");
			expect(pending.title).toContain("Deliver the amended pending work");
			expect(pending.blockedBy ?? []).toEqual([]);
			expect(historical.body).toBe(historicalBytes);
			expect(historical.title).toBe(historicalTitle);
			expect(historical.state).toBe("closed");
			expect(gh.subIssues.get(parentIssue.number)).toContain(historical.number);
			const repeated = await runGithubInitiativePublication(
				root,
				amendmentInput(paths, parentIssue, gh.issues.find((issue) => issue.body.includes("task-id=amend-live"))!, historical, { blockedBy: [] }),
				gh,
			);
			expect(repeated.status).toBe("already_current");
		});
	});

	it("fails closed on baseline drift, omitted membership, and stopped prerequisites", async () => {
		await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
			const baseline = amendmentInput(paths, parentIssue, pending, historical);
			const driftInput = JSON.parse(JSON.stringify(baseline));
			driftInput.amendment.parent.body += " user edit";
			const before = gh.mutations;
			expect((await runGithubInitiativePublication(root, driftInput, gh)).status).toBe("ambiguous_remote_state");
			expect(gh.mutations).toBe(before);

			const omittedInput = JSON.parse(JSON.stringify(baseline));
			omittedInput.amendment.historical = [];
			expect((await runGithubInitiativePublication(root, omittedInput, gh)).status).toBe("ambiguous_remote_state");
			expect(gh.mutations).toBe(before);

			const foreign = JSON.parse(JSON.stringify(baseline));
			foreign.amendment.historical[0].binding.issue_number = 999;
			expect((await runGithubInitiativePublication(root, foreign, gh)).status).toBe("ambiguous_remote_state");
			expect(gh.mutations).toBe(before);

			const stopped = await runGithubTrackerOperation(root, {
				op: "mark-terminal",
				initiative_id: "amend-init",
				task_id: "amend-live",
				slice_id: "live",
				phase: "stopped",
				terminal_event_id: "evt-amend-live",
			} as any, gh);
			expect(stopped.status).toBe("updated");
			expect((await runGithubInitiativePublication(root, baseline, gh)).status).toBe("ambiguous_remote_state");
		});
	});
		it("fails closed with a structured result instead of a thrown error when binding Slice markers are malformed (round-7 review-3)", async () => {
			await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
				// Strip the slice-id marker from a historical binding body: approvedAmendmentContent
				// throws on the malformed binding, and the caller must convert it into a
				// structured permanent_failure publication result, not an escaping exception.
				const input = amendmentInput(paths, parentIssue, pending, historical, {
					pendingResult: "Deliver the amended pending work",
					blockedBy: ["amend-done"],
				});
				input.amendment.historical[0].binding.body = input.amendment.historical[0].binding.body
					.replace(/<!-- immune-brain:slice-id=done -->/g, "");
				const before = gh.mutations;
				const failure = await runGithubInitiativePublication(root, JSON.parse(JSON.stringify(input)), gh);
				expect(failure.status).toBe("permanent_failure");
				expect(failure.message).toContain("historical amendment binding must carry a slice-id marker");
				expect(gh.mutations).toBe(before);
			});
		});

		it("preserves a terminal suffix that lands between the snapshot and the content-write revalidation (round-9 review-1)", async () => {
			await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
				// Intercept the content-write revalidation re-read: after the earlier
				// snapshot, a concurrent publisher applies the approved content AND a
				// terminal projection appends evidence. The write must preserve that
				// newly observed suffix, never overwrite it with stale snapshot bytes.
				const before = gh.mutations;
				const originalRun = gh.run.bind(gh);
				let suffixInjected = false;
				gh.run = async (args: string[], opts: any) => {
					// Detect the pre-write revalidation snapshot (list --json --state all
					// listing all issues) and inject the suffix once.
					if (!suffixInjected && args[0] === "api" && args[1]?.startsWith("repos/") && args[1]?.includes("/issues?")) {
						// First list call is the initial snapshot; only inject on a later one.
						if ((gh as any).__listCalls === undefined) (gh as any).__listCalls = 0;
						(gh as any).__listCalls += 1;
						if ((gh as any).__listCalls >= 3) {
							const live = gh.issues.find((issue) => issue.body.includes("task-id=amend-live"))!;
							live.body = `${live.body.trimEnd()}\n\n<!-- immune-brain:terminal-event=evt-raced -->\nTerminal event: \`evt-raced\`\n`;
							suffixInjected = true;
						}
					}
					return originalRun(args, opts);
				};
				const amended = await runGithubInitiativePublication(
					root,
					amendmentInput(paths, parentIssue, pending, historical, { pendingResult: "Deliver the amended pending work", blockedBy: [] }),
					gh,
				);
				delete (gh as any).__listCalls;
				expect(amended.status).not.toBe("permanent_failure");
				const live = gh.issues.find((issue) => issue.body.includes("task-id=amend-live"))!;
				// The raced suffix must survive whatever the amendment wrote.
				expect(live.body).toContain("terminal-event=evt-raced");
				expect(gh.mutations).toBeGreaterThan(before);
			});
		});

		it("fails closed before dependency writes when a duplicate Task Issue appears before the pre-write revalidation (round-9 review-2)", async () => {
			await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
				let mutationsAtInjection = 0;
				const originalRun = gh.run.bind(gh);
				let injected = false;
				gh.run = async (args: string[], opts: any) => {
					if (!injected && args[0] === "api" && args[1]?.startsWith("repos/") && args[1]?.includes("/issues?")) {
						if ((gh as any).__listCalls === undefined) (gh as any).__listCalls = 0;
						(gh as any).__listCalls += 1;
						if ((gh as any).__listCalls >= 3) {
							// Duplicate the pending Child under a different Issue number after
							// the initial snapshot but before any Child/dependency write: the
							// repository-wide taskLookup in the pre-write revalidation must
							// reject the ambiguity with zero writes after the injection.
							const dup = { ...pending, number: pending.number + 60, id: pending.id + 60 };
							dup.html_url = `https://github.com/example/project/issues/${dup.number}`;
							gh.issues.push(dup);
							injected = true;
							mutationsAtInjection = gh.mutations;
						}
					}
					return originalRun(args, opts);
				};
				const input = amendmentInput(paths, parentIssue, pending, historical, { pendingResult: "Deliver the amended pending work", blockedBy: [] });
				const rejected = await runGithubInitiativePublication(root, input, gh);
				delete (gh as any).__listCalls;
				expect(rejected.status).toBe("ambiguous_remote_state");
				expect(gh.mutations).toBe(mutationsAtInjection);
			});
		});

		it("converges dependencies on a terminal-suffixed Child and retries the original input (round-8 review-1)", async () => {
			await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
				// Apply the amendment (with no dependencies), then simulate a failed terminal
				// close: the terminal suffix lands but the Issue stays open.
				const applied = await runGithubInitiativePublication(
					root,
					amendmentInput(paths, parentIssue, pending, historical, { pendingResult: "Deliver the amended pending work", blockedBy: [] }),
					gh,
				);
				expect(applied.status).toBe("updated");
				const live = gh.issues.find((issue) => issue.body.includes("task-id=amend-live"))!;
				live.body = `${live.body.trimEnd()}\n\n<!-- immune-brain:terminal-event=evt-half-closed -->\nTerminal event: \`evt-half-closed\`\n`;
				// Re-run with a dependency edge that must be added: the dependency write's
				// pre-write revalidation must accept the terminal-suffixed approved-final
				// content and converge the edge instead of failing closed.
				const withEdge = amendmentInput(paths, parentIssue, live, historical, { pendingResult: "Deliver the amended pending work", blockedBy: ["amend-done"] });
				const converged = await runGithubInitiativePublication(root, JSON.parse(JSON.stringify(withEdge)), gh);
				expect(converged.status).toBe("updated");
				const retryOriginal = amendmentInput(paths, parentIssue, pending, historical, { pendingResult: "Deliver the amended pending work", blockedBy: [] });
				// The remote Child still carries the suffix; the baseline binding bytes are
				// the pre-amendment remote — rebuild the binding from the suffixed live body.
				retryOriginal.amendment.tasks[0].binding = { issue_number: live.number, title: live.title, body: live.body, state: "open" };
				const retry = await runGithubInitiativePublication(root, retryOriginal, gh);
				// The live Child still carries the converge-added edge, so the no-edge input
				// converges again (removes it) — accepted, not rejected as drift.
				expect(retry.status).toBe("updated");
				expect(live.blockedBy ?? []).toEqual([]);
				// A final retry converges the edge back and then reports current on a
				// subsequent identical run — the suffixed Child never blocks convergence.
				const finalRetry = amendmentInput(paths, parentIssue, live, historical, { pendingResult: "Deliver the amended pending work", blockedBy: ["amend-done"] });
				finalRetry.amendment.tasks[0].binding = { issue_number: live.number, title: live.title, body: live.body, state: "open" };
				expect((await runGithubInitiativePublication(root, finalRetry, gh)).status).toBe("updated");
				expect(live.blockedBy ?? []).toEqual([historical.id]); // FakeGh stores blockedBy as internal issue id
				const settled = amendmentInput(paths, parentIssue, live, historical, { pendingResult: "Deliver the amended pending work", blockedBy: ["amend-done"] });
				expect((await runGithubInitiativePublication(root, settled, gh)).status).toBe("already_current");
			});
		});

		it("rejects a historical Child with missing repo-id ownership markers (round-8 review-2)", async () => {
			await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
				// Strip the repo-id marker from the historical Child: taskLookup must fail
				// closed even though the binding number/content still match.
				historical.body = historical.body.replace(/<!-- immune-brain:repo-id=[0-9]+ -->\n/, "");
				const before = gh.mutations;
				const input = amendmentInput(paths, parentIssue, pending, historical, { pendingResult: "Deliver the amended pending work" });
				const rejected = await runGithubInitiativePublication(root, input, gh);
				expect(rejected.status).toBe("ambiguous_remote_state");
				expect(gh.mutations).toBe(before);
			});
		});

		it("rejects a duplicate historical task-id in another Initiative before writes (round-8 review-2)", async () => {
			await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
				// A second Issue carrying the same task-id marker makes the repo-wide
				// taskLookup ambiguous: the amendment must fail closed before any write.
				const duplicate = { ...historical, number: historical.number + 50, id: historical.id + 50 };
				duplicate.html_url = `https://github.com/example/project/issues/${duplicate.number}`;
				gh.issues.push(duplicate);
				const before = gh.mutations;
				const input = amendmentInput(paths, parentIssue, pending, historical, { pendingResult: "Deliver the amended pending work" });
				const rejected = await runGithubInitiativePublication(root, input, gh);
				expect(rejected.status).toBe("ambiguous_remote_state");
				expect(gh.mutations).toBe(before);
			});
		});

		it("fails closed when the Parent is concurrently edited before a pending Child dependency write (round-18 review-1)", async () => {
		await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
			const input = amendmentInput(paths, parentIssue, pending, historical, {
				pendingResult: "Deliver the amended pending work",
				blockedBy: [],
			});
			// After the Parent rewrite lands, a concurrent edit keeps ownership and
			// Slice markers intact: the immediate pre-write revalidation must reject
			// the drift before any Child edit, attachment, or dependency mutation.
			const originalRun = gh.run.bind(gh);
			let parentEdited = false;
			gh.run = async (args: string[], options: any) => {
				if (!parentEdited && args[0] === "api" && args.some((arg: string) => String(arg).includes("/issues?state=all")) && !args.includes("--paginate")) {
					// Concurrent edit lands between the Parent write and the pending
					// Child pre-write revalidation, keeping every marker intact.
					parentEdited = true;
					parentIssue.body += "\nconcurrent edit";
				}
				return originalRun(args, options);
			};
			const drift = await runGithubInitiativePublication(root, JSON.parse(JSON.stringify(input)), gh);
			expect(drift.status).toBe("ambiguous_remote_state");
			expect(drift.message).toContain("Parent changed since the approved amendment");
		});
	});

	it("rejects reserved parser sentinel terminal event ids at the validation boundary (round-20 review-1)", async () => {
		await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
			// mark-terminal with an id equal to a parser sentinel ("multiple" /
			// "malformed") is rejected before any remote read or write, so no
			// published marker can ever collide with parser failure reporting.
			for (const sentinel of ["multiple", "malformed"]) {
				const rejected = await runGithubTrackerOperation(root, {
					op: "mark-terminal",
					initiative_id: "amend-init",
					task_id: "amend-live",
					slice_id: "live",
					phase: "done",
					terminal_event_id: sentinel,
				} as any, gh);
				expect(rejected.status).toBe("permanent_failure");
				expect(rejected.message).toContain("reserved parser sentinel");
			}
			const before = gh.mutations;
			void before;
			expect(gh.issues.find((issue) => issue.body.includes("task-id=amend-live"))!.body).not.toContain("terminal-event=");
		});
	});

	it("resumes the original approved batch after a failed close with a normal terminal event id (round-20 review-1)", async () => {
		await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
			// A failed terminal close leaves the pending Child open carrying a valid
			// terminal suffix over the old approved-final content. The amendment
			// publication with the original input must converge on retry.
			const failed = await runGithubTrackerOperation(root, {
				op: "mark-terminal",
				initiative_id: "amend-init",
				task_id: "amend-live",
				slice_id: "live",
				phase: "done",
				terminal_event_id: "evt-failed-close",
			} as any, gh);
			expect(failed.status).toBe("updated");
			// Simulate the failed-close state: the close mutation is lost, leaving the
			// Child open with a validated terminal suffix over approved-final content.
			const closedChild = gh.issues.find((issue) => issue.body.includes("task-id=amend-live"))!;
			closedChild.state = "open";
			closedChild.state_reason = null;
			expect(closedChild.body).toContain("terminal-event=evt-failed-close");
			const input = amendmentInput(paths, parentIssue, pending, historical, {
				pendingResult: "Deliver the amended pending work",
				blockedBy: [],
			});
			const amendment = await runGithubInitiativePublication(root, JSON.parse(JSON.stringify(input)), gh);
			expect(amendment.status).toBe("updated");
			const amended = gh.issues.find((issue) => issue.body.includes("task-id=amend-live"))!;
			expect(amended.body).toContain("Deliver the amended pending work");
			// The validated terminal suffix is terminal evidence, preserved by the retry.
			expect(amended.body).toContain("terminal-event=evt-failed-close");
		});
	});

	it("fails closed when a terminal suffix is injected on the Parent before final verification (round-21 review-1)", async () => {
		await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
			const input = amendmentInput(paths, parentIssue, pending, historical, {
				pendingResult: "Deliver the amended pending work",
				blockedBy: [],
			});
			// Parents have no terminal-suffix lifecycle: a canonical suffix appended
			// after the last Child verification but before the final snapshot is
			// real content drift, rejected by byte-exact comparison with no
			// execution output.
			const originalRun = gh.run.bind(gh);
			let dependencyWriteSeen = false;
			let injected = false;
			gh.run = async (args: string[], options: any) => {
				if (args[0] === "api" && args.includes("--method") && args.includes("DELETE"))
					dependencyWriteSeen = true;
				if (args[0] === "api" && args.some((arg) => String(arg).includes("/issues?state=all")) && !args.includes("--paginate")) {
					// Inject after the last dependency write but before the final
					// verification snapshot: the suffix must be rejected by
					// byte-exact comparison of the Parent body.
					if (dependencyWriteSeen && !injected) {
						injected = true;
						parentIssue.body += `\n\n<!-- immune-brain:terminal-event=evt-ghost -->\nTerminal event: \`evt-ghost\`\n`;
					}
				}
				return originalRun(args, options);
			};
			const drift = await runGithubInitiativePublication(root, JSON.parse(JSON.stringify(input)), gh);
			expect(drift.status).toBe("ambiguous_remote_state");
			expect(drift.message).toContain("Initiative Parent content changed during Initiative publication");
			expect((drift as any).execution).toBeUndefined();
		});
	});

	it("fails closed with zero mutations when the Parent is edited after its update and before the Child snapshot (round-19 review-1)", async () => {
		await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
			const input = amendmentInput(paths, parentIssue, pending, historical, {
				pendingResult: "Deliver the amended pending work",
				blockedBy: [],
			});
			// The concurrent edit lands strictly after the Parent update write and
			// before runAmendmentTaskOperation takes its Child snapshot: the fixed
			// approved Parent bytes stay the only accepted expectation, so the
			// pending Child write fails closed with zero further tracker mutations.
			const originalRun = gh.run.bind(gh);
			let parentWriteObserved = false;
			let snapshotsSinceParentWrite = 0;
			const before = gh.mutations;
			gh.run = async (args: string[], options: any) => {
				if (!parentWriteObserved && args[0] === "issue" && args[1] === "edit" && String(args[2]) === String(parentIssue.number))
					parentWriteObserved = true;
				// Skip the Parent's own post-write confirmation snapshot; inject on the
				// next snapshot, which is runAmendmentTaskOperation's Child read.
				if (parentWriteObserved && args[0] === "api" && args.some((arg: string) => String(arg).includes("/issues?state=all")) && !args.includes("--paginate")) {
					snapshotsSinceParentWrite += 1;
					if (snapshotsSinceParentWrite === 2)
						parentIssue.body += "\nconcurrent edit";
				}
				return originalRun(args, options);
			};
			const drift = await runGithubInitiativePublication(root, JSON.parse(JSON.stringify(input)), gh);
			expect(drift.status).toBe("ambiguous_remote_state");
			expect(drift.message).toContain("Parent changed since the approved amendment content");
			// Only the Parent edit ran; the Child edit/attachment/dependency writes never fired.
			expect(gh.mutations).toBe(before + 1);
		});
	});

	it("fails closed when an undeclared closed Child becomes observable after preflight (round-18 review-2)", async () => {
		await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
			const input = amendmentInput(paths, parentIssue, pending, historical, {
				pendingResult: "Deliver the amended pending work",
				blockedBy: [],
			});
			// An undeclared closed Task with this Initiative's markers appears after
			// the amendment writes complete: final verification must repeat the
			// complete membership classification and fail the publication.
			const originalRun = gh.run.bind(gh);
			let writesCompleted = 0;
			let injected = false;
			gh.run = async (args: string[], options: any) => {
				if (args[0] === "issue" && (args[1] === "edit" || args[1] === "create")) {
					writesCompleted += 1;
				}
				// Inject on the final verification snapshot (after Parent and Child writes complete)
				if (!injected && writesCompleted >= 2 && args[0] === "api" && args.some((arg) => String(arg).includes("/issues?state=all")) && !args.includes("--paginate")) {
					injected = true;
					const intruder: any = JSON.parse(JSON.stringify(historical));
					intruder.number = 5555;
					intruder.body = intruder.body.replaceAll("task-id=amend-done", "task-id=amend-ghost");
					intruder.body = intruder.body.replaceAll("slice-id=done", "slice-id=ghost");
					intruder.state = "closed";
					gh.issues.push(intruder);
				}
				return originalRun(args, options);
			};
			const drift = await runGithubInitiativePublication(root, JSON.parse(JSON.stringify(input)), gh);
			expect(injected).toBe(true);
			expect(drift.status).toBe("ambiguous_remote_state");
			expect(drift.message).toContain("amend-ghost");
		});
	});

	it("fails closed in topology preflight with zero mutations when a bound pending Child baseline carries multiple terminal markers (round-20 review-1)", async () => {
		await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
			// Inject multiple terminal markers into the bound pending Child's baseline
			pending.body = `${pending.body.trimEnd()}\n\n<!-- immune-brain:terminal-event=evt-1 -->\n<!-- immune-brain:terminal-event=evt-2 -->\n`;
			const input = amendmentInput(paths, parentIssue, pending, historical, {
				pendingResult: "Deliver the amended pending work",
				blockedBy: [],
			});
			const before = gh.mutations;
			const rejected = await runGithubInitiativePublication(root, input, gh);
			expect(rejected.status).toBe("ambiguous_remote_state");
			expect(rejected.message).toContain("has multiple terminal markers");
			// Assert zero mutations were performed
			expect(gh.mutations).toBe(before);
		});
	});

	it("fails closed before create when the Parent is closed or edited between snapshot and pre-create re-read (round-8 review-3)", async () => {
			await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
				initializeTrackedIntents(root, [{ task_id: "amend-new", goal: "Deliver the new pending work", slice_id: "new" }]);
				const input = amendmentInput(paths, parentIssue, pending, historical, {
					pendingResult: "Deliver the amended pending work",
					blockedBy: ["amend-done"],
					newTask: { task_id: "amend-new", goal: "Deliver the new pending work", intent: "docs/plans/amend-new.intent.json" },
				});
				input.amendment.tasks.push({ task_id: "amend-new" });
				// Close the Parent right after the initial snapshot lands (before the
				// pre-create re-read): the create must never be issued.
				parentIssue.state = "closed";
				parentIssue.state_reason = "completed";
				const before = gh.mutations;
				const rejected = await runGithubInitiativePublication(root, input, gh);
				expect(rejected.status).toBe("ambiguous_remote_state");
				expect(gh.mutations).toBe(before);
				expect(gh.issues.some((issue) => issue.body.includes("task-id=amend-new"))).toBe(false);
			});
		});

		it("fails closed when the Parent drifts after the task snapshot but before the pre-create re-read (round-17 review-1a)", async () => {
		await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
			initializeTrackedIntents(root, [{ task_id: "amend-new", goal: "Deliver the new pending work", slice_id: "new" }]);
			const input = amendmentInput(paths, parentIssue, pending, historical, {
				pendingResult: "Deliver the amended pending work",
				blockedBy: ["amend-done"],
				newTask: { task_id: "amend-new", goal: "Deliver the new pending work", intent: "docs/plans/amend-new.intent.json" },
			});
			input.amendment.tasks.push({ task_id: "amend-new" });
			// Inject a concurrent Parent edit exactly between the initial task snapshot
			// (topology preflight) and the pre-create re-read: the create must be
			// refused with zero mutations — this is the race the pre-create guard exists for.
			const originalRun = gh.run.bind(gh);
			// The drift must land after the Parent amendment write has converged and
			// after the unbound Child's task snapshot, on the pre-create re-read that
			// immediately precedes the create call. Pin the injection to the snapshot
			// right before the create (phase-asserted when the create fires): the
			// re-read then refuses with the pre-create guard, the create never runs,
			// and the only mutation is the Parent's own amendment edit.
			let parentEditConfirmed = 0;
			let snapshotsAfterParentEdit = 0;
			let injected = false;
			gh.run = async (args: string[], options: any) => {
				if (args[0] === "issue" && args[1] === "edit" && String(args[2]) === String(parentIssue.number)) {
					parentEditConfirmed = gh.mutations + 1;
					return originalRun(args, options);
				}
				if (args[0] === "issue" && args[1] === "create") {
					if (!injected)
						throw new Error("Parent drift was not injected on the pre-create re-read; snapshot indexing drifted");
				}
				if (!injected && gh.mutations > parentEditConfirmed && args[0] === "api" && args.some((arg) => String(arg).includes("/issues?state=all")) && !args.includes("--paginate")) {
					snapshotsAfterParentEdit += 1;
					// Snapshot 1 after the Parent edit is the Parent's own post-write
					// confirm (must see the clean approved bytes); every later snapshot
					// belongs to the Child phases, and the pre-create re-read is the
					// last one before create. Inject from the third Child-phase snapshot
					// on: the create hook proves the pre-create re-read carried the drift.
					if (snapshotsAfterParentEdit >= 3) {
						injected = true;
						parentIssue.body += "\nconcurrent edit";
					}
				}
				return originalRun(args, options);
			};
			const before = gh.mutations;
			const rejected = await runGithubInitiativePublication(root, JSON.parse(JSON.stringify(input)), gh);
						expect(rejected.status).toBe("ambiguous_remote_state");
			expect(rejected.message).toContain("amendment Parent content changed before creating a new Child");
			// The Parent's own amendment edit plus the bound pending Child's amendment
			// edit are the only writes; no Child create ever runs.
			expect(gh.mutations).toBe(before + 2);
			expect(gh.issues.some((issue) => issue.body.includes("task-id=amend-new"))).toBe(false);
		});
	});

	it("resumes an exact concurrent unbound Child creation injected between task snapshot and pre-create re-read (round-17 review-1b)", async () => {
		await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
			initializeTrackedIntents(root, [{ task_id: "amend-new", goal: "Deliver the new pending work", slice_id: "new" }]);
			const input = amendmentInput(paths, parentIssue, pending, historical, {
				pendingResult: "Deliver the amended pending work",
				blockedBy: ["amend-done"],
				newTask: { task_id: "amend-new", goal: "Deliver the new pending work", intent: "docs/plans/amend-new.intent.json" },
			});
			input.amendment.tasks.push({ task_id: "amend-new" });
			// First pass: derive the exact approved-final Issue for the new Child.
			const created = await runGithubInitiativePublication(root, JSON.parse(JSON.stringify(input)), gh);
			expect(created.status).toBe("updated");
			const approved = gh.issues.find((issue) => issue.body.includes("task-id=amend-new"))!;
			gh.issues = gh.issues.filter((issue) => issue.number !== approved.number);
			gh.subIssues.set(parentIssue.number, (gh.subIssues.get(parentIssue.number) ?? []).filter((number) => number !== approved.number));
			// Second pass: a concurrent writer creates the exact approved-final Child
			// between the task snapshot and the pre-create re-read. The tracker must
			// resume it (no duplicate create, exact convergence) rather than create.
			const originalRun = gh.run.bind(gh);
			let snapshotsSeen = 0;
			let injected = false;
			gh.run = async (args: string[], options: any) => {
				if (!injected && args[0] === "api" && args.some((arg) => String(arg).includes("/issues?state=all")) && !args.includes("--paginate")) {
					snapshotsSeen += 1;
					if (snapshotsSeen >= 2) {
						injected = true;
						gh.issues.push(JSON.parse(JSON.stringify(approved)));
						gh.subIssues.set(parentIssue.number, [...(gh.subIssues.get(parentIssue.number) ?? []), approved.number]);
					}
				}
				return originalRun(args, options);
			};
			const before = gh.mutations;
			const resume = await runGithubInitiativePublication(root, JSON.parse(JSON.stringify(input)), gh);
			expect(resume.status).toBe("already_current");
			expect(gh.mutations).toBe(before);
			const duplicates = gh.issues.filter((issue) => issue.body.includes("task-id=amend-new"));
			expect(duplicates.length).toBe(1);
			expect(duplicates[0].title).toBe(approved.title);
			expect(duplicates[0].body).toBe(approved.body);
		});
	});

	it("fails closed when Parent markers and approved bytes are transferred to a replacement Issue before revalidation (round-19 review-1)", async () => {
		await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
			initializeTrackedIntents(root, [{ task_id: "amend-new", goal: "Deliver new work" }]);
			const input = amendmentInput(
				paths,
				parentIssue,
				pending,
				historical,
				{ pendingResult: "Deliver pending work", blockedBy: [] },
				{ newTasks: [{ taskId: "amend-new", goal: "Deliver new work", blockedBy: [] }] },
			);

			// Pre-create a replacement Issue that will steal Parent identity and approved bytes.
			const replacementIssue = {
				id: 9999,
				number: 99,
				title: "placeholder",
				body: "placeholder",
				state: "open" as const,
				state_reason: null,
				html_url: "https://github.com/example/repo/issues/99",
			};
			gh.issues.push(replacementIssue);

			const originalRun = gh.run.bind(gh);
			let parentEditConfirmed = 0;
			let snapshotsAfterParentEdit = 0;
			let transferred = false;
			gh.run = async (args: string[], options: any) => {
				if (args[0] === "issue" && args[1] === "edit" && String(args[2]) === String(parentIssue.number)) {
					parentEditConfirmed = gh.mutations + 1;
					return originalRun(args, options);
				}
				if (args[0] === "issue" && args[1] === "create") {
					if (!transferred)
						throw new Error("Parent identity transfer did not occur before create");
				}
				if (!transferred && gh.mutations > parentEditConfirmed && args[0] === "api" && args.some((arg) => String(arg).includes("/issues?state=all")) && !args.includes("--paginate")) {
					snapshotsAfterParentEdit += 1;
					// Transfer Parent markers and approved bytes to the replacement Issue
					// right before the new Child's pre-create revalidation.
					if (snapshotsAfterParentEdit >= 3) {
						transferred = true;
						replacementIssue.title = parentIssue.title;
						replacementIssue.body = parentIssue.body;
						// Strip initiative marker from original parent
						parentIssue.body = parentIssue.body.replace(/<!-- immune-brain:initiative-id=[^ ]+ -->/g, "");
					}
				}
				return originalRun(args, options);
			};

			const before = gh.mutations;
			const rejected = await runGithubInitiativePublication(root, JSON.parse(JSON.stringify(input)), gh);
						expect(rejected.status).toBe("ambiguous_remote_state");
			expect(rejected.message).toContain("not the bound Parent Issue #1");
			// Assert zero subsequent Child or relation writes (mutations should be exactly Parent edit + bound child edit).
			expect(gh.mutations).toBe(before + 2);
			expect(gh.issues.some((issue) => issue.body.includes("task-id=amend-new"))).toBe(false);
		});
	});

	it("resumes a bound pending Child that carries a terminal suffix from a failed terminal close (round-7 review-2)", async () => {
			await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
				// Apply the amendment so the Child carries the approved final content.
				const applied = await runGithubInitiativePublication(
					root,
					amendmentInput(paths, parentIssue, pending, historical, { pendingResult: "Deliver the amended pending work", blockedBy: [] }),
					gh,
				);
				expect(applied.status).toBe("updated");
				const live = gh.issues.find((issue) => issue.body.includes("task-id=amend-live"))!;
				// Simulate a failed terminal close: the terminal suffix lands but the Issue stays open.
				live.body = `${live.body.trimEnd()}\n\n<!-- immune-brain:terminal-event=evt-half-closed -->\nTerminal event: \`evt-half-closed\`\n`;
								const retry = amendmentInput(paths, parentIssue, live, historical, { pendingResult: "Deliver the amended pending work", blockedBy: [] });
				const resumed = await runGithubInitiativePublication(root, JSON.parse(JSON.stringify(retry)), gh);
				expect(resumed.status).toBe("already_current");
			});
		});

it("rejects pending bindings whose issue_number does not match the observable Issue", async () => {
		await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
			const input = amendmentInput(paths, parentIssue, pending, historical);
			input.amendment.tasks[0].binding.issue_number = 999;
			const before = gh.mutations;
			expect((await runGithubInitiativePublication(root, input, gh)).status).toBe("ambiguous_remote_state");
			expect(gh.mutations).toBe(before);
		});
	});

	it("accepts the approved-final Parent content on retry and converges dependencies when content is already final", async () => {
		await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
			// First amendment applies the approved content with cleared dependencies.
			const amended = await runGithubInitiativePublication(
				root,
				amendmentInput(paths, parentIssue, pending, historical, { pendingResult: "Deliver the amended pending work", blockedBy: [] }),
				gh,
			);
			expect(amended.status).toBe("updated");

			// Original (pre-amend) Parent bytes now diverge from remote, but remote equals approved-final → accepted.
			const live = gh.issues.find((issue) => issue.body.includes("task-id=amend-live"))!;
			const retryOriginal = amendmentInput(paths, parentIssue, live, historical, { blockedBy: [] });
			const retry = await runGithubInitiativePublication(root, retryOriginal, gh);
			expect(retry.status).toBe("already_current");

			// Remote Parent already carries approved-final bytes while binding holds approved-final bytes too.
			const finalBinding = JSON.parse(JSON.stringify(retryOriginal));
			const liveParent = gh.issues.find((issue) => issue.body.includes("initiative-id=amend-init"))!;
			finalBinding.amendment.parent = { issue_number: liveParent.number, title: liveParent.title, body: liveParent.body, state: "open" };
			finalBinding.tasks[0].binding = { issue_number: live.number, title: live.title, body: live.body, state: "open" };
			expect((await runGithubInitiativePublication(root, finalBinding, gh)).status).toBe("already_current");
		});
	});

	it("converges pending dependencies when the pending content already matches the approved final bytes", async () => {
		await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
			// Apply the amendment once, then re-add a dependency edge remotely (simulating partial-write resume).
			const amended = await runGithubInitiativePublication(
				root,
				amendmentInput(paths, parentIssue, pending, historical, { pendingResult: "Deliver the amended pending work", blockedBy: [] }),
				gh,
			);
			expect(amended.status).toBe("updated");
			const live = gh.issues.find((issue) => issue.body.includes("task-id=amend-live"))!;

			// Manually re-add the historical blocker edge so the content is final but dependencies diverge.
			(live as any).blockedBy = [historical.number];
			const resume = await runGithubInitiativePublication(
				root,
				amendmentInput(paths, parentIssue, live, historical, { pendingResult: "Deliver the amended pending work", blockedBy: [] }),
				gh,
			);
			expect(resume.status).toBe("already_current");
			expect((live as any).blockedBy ?? []).toEqual([]);
		});
	});

	it("creates an unbound new Child through the creation path and leaves existing bindings untouched", async () => {
		await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
			initializeTrackedIntents(root, [{ task_id: "amend-new", goal: "Deliver the new pending work", slice_id: "new" }]);
			const input = amendmentInput(paths, parentIssue, pending, historical, {
				pendingResult: "Deliver the amended pending work",
				blockedBy: ["amend-done"],
				newTask: { task_id: "amend-new", goal: "Deliver the new pending work", intent: "docs/plans/amend-new.intent.json" },
			});
			input.amendment.tasks.push({ task_id: "amend-new" });
			const before = gh.mutations;
			const created = await runGithubInitiativePublication(root, JSON.parse(JSON.stringify(input)), gh);
			expect(created.status).toBe("updated");
			expect(gh.mutations).toBeGreaterThan(before);
			const newLive = gh.issues.find(
				(issue) => issue.body.includes("task-id=amend-new") && issue.body.includes("Deliver the new pending work"),
			)!;
			expect(newLive).toBeDefined();
			// The bound pending Child is amended as usual.
			const amended = gh.issues.find(
				(issue) => issue.body.includes("task-id=amend-live") && issue.body.includes("Deliver the amended pending work"),
			)!;
			expect(amended).toBeDefined();
			expect((amended as any).blockedBy ?? []).toEqual([historical.id]);
			// Historical Child bytes are preserved.
			expect(gh.issues.find((issue) => issue.number === historical.number)!.body).toBe(historical.body);
		});
	});

	it("stops dependency mutations and fails closed when the pending Child drifts before a dependency write", async () => {
		await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
			const input = amendmentInput(paths, parentIssue, pending, historical, {
				pendingResult: "Deliver the amended pending work",
				blockedBy: [],
			});
			// Content starts divergent so updatePendingChild reaches convergePendingDependencies after an edit.
			// Attach a foreign blocker edge that must be removed, then detach the Child between mutations.
			(pending as any).blockedBy = [historical.number, 987];
			let firstRemoval = true;
			const originalRun = gh.run.bind(gh);
			gh.run = async (args: string[], options: any) => {
				const outcome = await originalRun(args, options);
				if (firstRemoval && args.includes("DELETE")) {
					firstRemoval = false;
				// Simulate the Child being closed remotely right after the first DELETE lands.
				const child = gh.issues.find((issue) => issue.number === pending.number);
				if (child) (child as any).state = "closed";
			}
				return outcome;
			};
			const drift = await runGithubInitiativePublication(root, JSON.parse(JSON.stringify(input)), gh);
			expect(drift.status).toBe("ambiguous_remote_state");
		});
	});

	it("fails closed when a historical Child's blocked_by relations change during the amendment", async () => {
		await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
			const input = amendmentInput(paths, parentIssue, pending, historical, {
				pendingResult: "Deliver the amended pending work",
				blockedBy: [],
			});
			// Snapshot will be taken with this edge; mutate it after the pending update so final verification fails.
			(historical as any).blockedBy = [42];
			const originalRun = gh.run.bind(gh);
			let removedEdge = false;
			gh.run = async (args: string[], options: any) => {
				const outcome = await originalRun(args, options);
				if (!removedEdge && args.includes("issue") && args.includes("edit")) {
					removedEdge = true;
				(historical as any).blockedBy = [43];
			}
			return outcome;
			};
			const drift = await runGithubInitiativePublication(root, JSON.parse(JSON.stringify(input)), gh);
			expect(drift.status).toBe("ambiguous_remote_state");
		});
	});

	it("fails closed when a bound pending Child is replaced by a different Issue before its content update (review-5)", async () => {
		await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
			const input = amendmentInput(paths, parentIssue, pending, historical, {
				pendingResult: "Deliver the amended pending work",
				blockedBy: [],
			});
			// Re-pin the binding to an Issue number that does not hold the markers.
			input.amendment.tasks[0].binding = { ...input.amendment.tasks[0].binding!, issue_number: 987 };
			const before = gh.mutations;
			const mismatched = await runGithubInitiativePublication(root, JSON.parse(JSON.stringify(input)), gh);
			expect(mismatched.status).toBe("ambiguous_remote_state");
			expect(gh.mutations).toBe(before);
		});
	});

	it("converges dependencies even when the pending Child already carries the approved final content", async () => {
		await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
			// First amendment pass brings the Child to final content with no blockers.
			const first = amendmentInput(paths, parentIssue, pending, historical, {
				pendingResult: "Deliver the amended pending work",
				blockedBy: [],
			});
			const applied = await runGithubInitiativePublication(root, JSON.parse(JSON.stringify(first)), gh);
			expect(applied.status).toBe("updated");
			// Second pass with the same content but a new requested dependency set: only edges change.
			const second = amendmentInput(paths, parentIssue, pending, historical, {
				pendingResult: "Deliver the amended pending work",
				blockedBy: ["amend-done"],
			});
			const converged = await runGithubInitiativePublication(root, JSON.parse(JSON.stringify(second)), gh);
			expect(converged.status).toBe("updated");
			const amended = gh.issues.find((issue) => issue.body.includes("task-id=amend-live"))!;
			expect((amended as any).blockedBy ?? []).toEqual([historical.id]);
		});
		});

		it("fails closed when a historical Child and a pending Child share one slice_id (round-5 R1)", async () => {
			await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
				initializeTrackedIntents(root, [{ task_id: "amend-collide", goal: "Collide with a historical slice", slice_id: "done" }]);
				const input = amendmentInput(paths, parentIssue, pending, historical, {
						pendingResult: "Deliver the amended pending work",
						blockedBy: ["amend-done"],
						newTask: { task_id: "amend-collide", goal: "Collide with a historical slice", intent: "docs/plans/amend-collide.intent.json" },
				});
				// The new Task reuses the historical Child's terminal slice id "done".
				input.tasks[1].slice_id = "done";
				input.amendment.tasks.push({ task_id: "amend-collide" });
				const before = gh.mutations;
				const collision = await runGithubInitiativePublication(root, JSON.parse(JSON.stringify(input)), gh);
				expect(collision.status).toBe("permanent_failure");
				expect(gh.mutations).toBe(before);
			});
		});

		it("fails closed when input.tasks omits a Task declared in amendment.tasks (round-5 R3)", async () => {
			await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
				const input = amendmentInput(paths, parentIssue, pending, historical, {
					pendingResult: "Deliver the amended pending work",
					blockedBy: [],
				});
				// Declare the pending Task in amendment.tasks but drop it from input.tasks —
				// the exact-correspondence contract is violated and the batch must fail closed.
				const input2 = JSON.parse(JSON.stringify(input));
				input2.tasks = [];
				const before = gh.mutations;
				const mismatch = await runGithubInitiativePublication(root, input2 as any, gh);
				expect(mismatch.status).toBe("permanent_failure");
				expect(gh.mutations).toBe(before);
			});
		});

		it("re-attaches an approved-final bound Child that lost its Sub-issue attachment (round-5 R4)", async () => {
			await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
				// First pass converges the Child to approved-final content and no blockers.
				const first = amendmentInput(paths, parentIssue, pending, historical, {
					pendingResult: "Deliver the amended pending work",
					blockedBy: [],
				});
				const applied = await runGithubInitiativePublication(root, JSON.parse(JSON.stringify(first)), gh);
				expect(applied.status).toBe("updated");
				// Detach the Child, simulating a partially-written retry that landed content but lost the edge.
				gh.subIssues.set(parentIssue.number, (gh.subIssues.get(parentIssue.number) ?? []).filter((n) => n !== pending.number));
				// Retry the same batch: the Child is bound, approved-final, unattached — it is re-attached.
				const retry = amendmentInput(
					paths,
					parentIssue,
					pending,
					historical,
					{ pendingResult: "Deliver the amended pending work", blockedBy: [] },
				);
				const converged = await runGithubInitiativePublication(root, JSON.parse(JSON.stringify(retry)), gh);
				expect(["updated", "already_current"]).toContain(converged.status);
				expect(gh.subIssues.get(parentIssue.number)).toContain(pending.number);
			});
		});

		it("re-reads before creating an unbound Child and resumes an exact concurrent creation (round-7 review-1)", async () => {
			await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
				initializeTrackedIntents(root, [{ task_id: "amend-new", goal: "Deliver the new pending work", slice_id: "new" }]);
				const input = amendmentInput(paths, parentIssue, pending, historical, {
					pendingResult: "Deliver the amended pending work",
					blockedBy: ["amend-done"],
					newTask: { task_id: "amend-new", goal: "Deliver the new pending work", intent: "docs/plans/amend-new.intent.json" },
				});
				input.amendment.tasks.push({ task_id: "amend-new" });
				// Derive the exact approved-final title/body for the new Child by running the
				// batch once (real creation), then re-running the same batch: the pre-create
				// re-read observes the existing exact Issue and resumes it without issuing a
				// duplicate create. Zero duplicate Issues is the resumable-creation contract.
				const created = await runGithubInitiativePublication(root, JSON.parse(JSON.stringify(input)), gh);
				expect(created.status).toBe("updated");
				const approved = gh.issues.find((issue) => issue.body.includes("task-id=amend-new"))!;
				const mutationsBefore = gh.mutations;
				const resume = await runGithubInitiativePublication(root, JSON.parse(JSON.stringify(input)), gh);
				expect(resume.status).toBe("already_current");
				expect(gh.mutations).toBe(mutationsBefore);
				const duplicates = gh.issues.filter((issue) => issue.body.includes("task-id=amend-new"));
				expect(duplicates.length).toBe(1);
				expect(duplicates[0].title).toBe(approved.title);
				expect(duplicates[0].body).toBe(approved.body);
			});
		});

		it("fails closed when an unbound new Child is created closed (round-5 R2)", async () => {
			await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
				initializeTrackedIntents(root, [{ task_id: "amend-new", goal: "Deliver the new pending work", slice_id: "new" }]);
				const input = amendmentInput(paths, parentIssue, pending, historical, {
					pendingResult: "Deliver the amended pending work",
					blockedBy: ["amend-done"],
					newTask: { task_id: "amend-new", goal: "Deliver the new pending work", intent: "docs/plans/amend-new.intent.json" },
				});
				input.amendment.tasks.push({ task_id: "amend-new" });
				// Close the freshly created Child immediately after creation: the post-creation
					// guard must detect the closed state and fail the batch.
				gh.afterIssueCreate = (number) => {
					const createdIssue = gh.issues.find((issue) => issue.number === number);
					if (createdIssue) createdIssue.state = "closed";
				};
				const failure = await runGithubInitiativePublication(root, JSON.parse(JSON.stringify(input)), gh);
				expect(failure.status).toBe("ambiguous_remote_state");
			});
		});

	it("fails closed with zero relation writes when the pending Child drifts right after the attachment write (round-11 review-1)", async () => {
		await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
			// First pass converges the Child to approved-final content including the blocker.
			const first = amendmentInput(paths, parentIssue, pending, historical, {
				pendingResult: "Deliver the amended pending work",
				blockedBy: ["amend-done"],
			});
			expect((await runGithubInitiativePublication(root, JSON.parse(JSON.stringify(first)), gh)).status).toBe("updated");
			// Simulate a partial write: drop the blocker edge but keep the approved body,
			// and detach the Child so the retry re-attaches it before re-adding the edge.
			(pending as any).blockedBy = [];
			gh.subIssues.set(parentIssue.number, (gh.subIssues.get(parentIssue.number) ?? []).filter((n) => n !== pending.number));
			// Re-baseline the amendment bindings to the post-first-pass remote state.
			const rebased = amendmentInput(paths, parentIssue, pending, historical, {
				pendingResult: "Deliver the amended pending work",
				blockedBy: ["amend-done"],
			});
			rebased.amendment.tasks[0].binding = { issue_number: pending.number, title: pending.title, body: pending.body, state: "open" };
			rebased.tasks[0].binding = { issue_number: pending.number, title: pending.title, body: pending.body, state: "open" };
			let attached = false;
			const originalRun = gh.run.bind(gh);
			gh.run = async (args: string[], options: any) => {
				const outcome = await originalRun(args, options);
				// Mutation calls use `-F`; list reads do not. Inject drift once, right
				// after the re-attachment mutation lands: the pre-dependency-write
				// revalidation must observe it and fail closed with zero relation writes.
				if (!attached && args.join(" ").includes("/sub_issues") && (args.includes("-F") || args.includes("-f"))) {
					attached = true;
					const child = gh.issues.find((issue) => issue.number === pending.number);
					if (child) child.body += "\nconcurrent edit";
				}
				return outcome;
			};
			const drift = await runGithubInitiativePublication(root, JSON.parse(JSON.stringify(rebased)), gh);
			expect(drift.status).toBe("ambiguous_remote_state");
			expect(attached).toBe(true);
			// Zero relation writes after the drift: no dependency edge was added.
			expect((pending as any).blockedBy ?? []).toEqual([]);
		});
	});

	it("rejects an unbound new Task whose task_id is already owned by another Initiative before any write (round-14 review-1)", async () => {
		await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
			// Publish a second Initiative that owns task_id 'amend-new': requesting
			// it as an unbound new Task in the amendment must fail closed in topology
			// preflight with zero mutations (no Parent rewrite, no Child writes).
			const foreignTasks = [
				{ task_id: "amend-new", goal: "Foreign Initiative Task", slice_id: "foreign" },
				{ task_id: "amend-new-2", goal: "Foreign Initiative Task 2", slice_id: "foreign-2" },
			];
			const foreignPaths = initializeTrackedIntents(root, foreignTasks);
			const foreign = await runGithubInitiativePublication(root, {
				initiative_id: "foreign-init",
				goal: "Foreign Initiative",
				projection: { short_name: "foreign", title: "Foreign Initiative", problem: "Foreign planning context.", result: "Foreign Initiative", design: "A standalone foreign Initiative." },
				tasks: foreignTasks.map((task, index) => ({
					slice_id: task.slice_id,
					intent: foreignPaths[index],
					acceptance: publicAcceptance(task.task_id),
					projection: { title: task.goal, result: task.goal },
				})),
			} as any, gh);
			expect(foreign.status).toBe("created");
			const input = amendmentInput(paths, parentIssue, pending, historical, {
				pendingResult: "Deliver the amended pending work",
				blockedBy: ["amend-done"],
				newTask: { task_id: "amend-new", goal: "Deliver the new amendment Task", intent: foreignPaths[0] },
			});
			input.amendment.tasks.push({ task_id: "amend-new", binding: undefined });
			const before = gh.mutations;
			const outcome = await runGithubInitiativePublication(root, JSON.parse(JSON.stringify(input)), gh);
			expect(outcome.status).toBe("ambiguous_remote_state");
			expect(outcome.message).toContain("task_id is already owned by Issue #");
			expect(gh.mutations).toBe(before);
			// The Parent was not rewritten and the foreign Child is untouched.
			const foreignChild = gh.issues.find((issue) => issue.body.includes("task-id=amend-new"))!;
			expect(foreignChild.body).toContain("initiative-id=foreign-init");
		});
	});

	it("rejects a baseline Parent line that mixes a historical Slice marker with a pending Slice marker (round-12 review-historical-slice-line-loss)", async () => {
		await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
			// Move the pending slice marker onto the historical slice line: the
			// greedy whole-line baseline scan would otherwise drop the historical
			// marker silently when regenerating the Parent. Must fail closed.
			const historicalLine = parentIssue.body.split("\n").find((line: string) => line.includes("slice-id=done"))!;
			const pendingLine = parentIssue.body.split("\n").find((line: string) => line.includes("slice-id=live"))!;
			parentIssue.body = parentIssue.body.replace(pendingLine, "");
			parentIssue.body = parentIssue.body.replace(historicalLine, `${historicalLine} ${pendingLine.trim()}`);
			const input = amendmentInput(paths, parentIssue, pending, historical, {
				pendingResult: "Deliver the amended pending work",
				blockedBy: ["amend-done"],
			});
			const before = gh.mutations;
			const outcome = await runGithubInitiativePublication(root, JSON.parse(JSON.stringify(input)), gh);
			expect(outcome.status).toBe("ambiguous_remote_state");
			expect(outcome.message).toContain("shares a baseline line with another Slice marker");
			expect(gh.mutations).toBe(before);
		});
	});

	it("treats Task IDs and Slice IDs independently: a bound Task is baselined by task_id, and a new Slice colliding with another Task's ID is not mistaken for bound (round-12 review-bound-slice-lookup)", async () => {
		await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
			// task_id 'amend-live' owns slice 'live' (bound, pending) and its Task id
			// is also used as the *slice id* of a new unbound Task: slice identity stays
			// unique while bound classification keys on task_id, not slice id.
			const input = amendmentInput(paths, parentIssue, pending, historical, {
				pendingResult: "Deliver the amended pending work",
				blockedBy: ["amend-done"],
				newTask: { task_id: "amend-new", goal: "Deliver the new amendment Task", intent: paths[1] },
			});
			input.tasks[1].slice_id = "amend-live";
			input.amendment.tasks.push({ task_id: "amend-new", binding: undefined });
			// A tracked TaskIntent must exist for the new Task (its acceptance IDs
			// are validated against the intent on disk).
			const newIntentPath = writeTrackedIntent(root, "amend-new", "Deliver the new amendment Task");
			spawnSync("git", ["add", newIntentPath], { cwd: root });
			input.tasks[1].intent = newIntentPath;
			const before = gh.mutations;
			const outcome = await runGithubInitiativePublication(root, JSON.parse(JSON.stringify(input)), gh);
			expect(outcome.status).toBe("updated");
			expect(gh.mutations).toBeGreaterThan(before);
			// The new Child carries slice id 'amend-live' (the bound Task's task id)
			// while the bound Child keeps slice 'live': both exist and stay unique.
			const newChild = gh.issues.find((issue) => issue.body.includes("task-id=amend-new"))!;
			expect(newChild.body).toContain("slice-id=amend-live");
			expect(newChild.body).toContain("task-id=amend-new");
			expect(pending.body).toContain("slice-id=live");
		});
	});

	it("converges a bound Child whose baseline body carries a validated terminal suffix (failed terminal close) against its original binding (round-12 review-terminal-baseline-retry)", async () => {
		await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
			// Simulate a failed terminal close on the pending Child: append the exact
			// terminal suffix markTerminal would write, over the current baseline body.
			const suffix = `\n\n<!-- immune-brain:terminal-event=evt-failed-close -->\nTerminal event: \`evt-failed-close\`\n`;
			pending.body = `${pending.body.trimEnd()}${suffix}`;
			// The amendment keeps the ORIGINAL binding (baseline bytes without the
			// suffix) and requests changed approved content: topology validation and
			// upsertTask must both accept the suffix as terminal evidence, not drift.
			const input = amendmentInput(paths, parentIssue, pending, historical, {
				pendingResult: "Deliver the newly amended result",
				blockedBy: ["amend-done"],
			});
			const binding = { issue_number: pending.number, title: pending.title, body: pending.body.replace(suffix, ""), state: "open" };
			input.amendment.tasks[0].binding = JSON.parse(JSON.stringify(binding));
			input.tasks[0].binding = JSON.parse(JSON.stringify(binding));
			const outcome = await runGithubInitiativePublication(root, JSON.parse(JSON.stringify(input)), gh);
			expect(outcome.status).toBe("updated");
			// The converged Child carries the new approved body with the validated
			// suffix retained (failed-close evidence survives a changed amendment).
			const refreshed = gh.issues.find((issue) => issue.number === pending.number)!;
			expect(refreshed.body).toContain("Deliver the newly amended result");
			expect(refreshed.body).toContain("evt-failed-close");
		});
	});

	it("rejects a bound Child whose baseline carries a lone terminal marker without its canonical suffix with zero mutations (round-15 review-1)", async () => {
		await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
			// A lone marker (or truncated suffix) in the baseline body is malformed
			// terminal evidence, not a validated suffix: the amendment must fail
			// closed before any write instead of synthesizing a canonical suffix.
			pending.body = `${pending.body.trimEnd()}\n\n<!-- immune-brain:terminal-event=evt-malformed -->\n`;
			const input = amendmentInput(paths, parentIssue, pending, historical, {
				pendingResult: "Deliver the amended pending work",
				blockedBy: ["amend-done"],
			});
			const before = gh.mutations;
			const outcome = await runGithubInitiativePublication(root, JSON.parse(JSON.stringify(input)), gh);
			expect(outcome.status).toBe("ambiguous_remote_state");
			expect(outcome.message).toContain("malformed terminal marker");
			expect(gh.mutations).toBe(before);
		});
	});

	it("rejects an amendment whose pending depender depends on a stopped historical prerequisite with zero mutations (round-16 review-1)", async () => {
		await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
			// Stop the historical prerequisite (not_planned) while the pending Child
			// stays open: the batch is deterministically unfulfillable, so preflight
			// must fail closed before the Parent or any dependency edge is written.
			historical.state = "closed";
			historical.state_reason = "not_planned";
			const input = amendmentInput(paths, parentIssue, pending, historical, {
				pendingResult: "Deliver the amended pending work",
				blockedBy: ["amend-done"],
			});
			const before = gh.mutations;
			const outcome = await runGithubInitiativePublication(root, JSON.parse(JSON.stringify(input)), gh);
			expect(outcome.status).toBe("ambiguous_remote_state");
			expect(outcome.message).toContain("stopped historical prerequisite amend-done");
			expect(gh.mutations).toBe(before);
		});
	});

	it("rejects a bound pending Child observed under a foreign slice id before any Parent rewrite (round-16 review-2)", async () => {
		await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
			// The bound Child's observed body carries the historical slice id 'done'
			// while its requested projection stays 'live': observed Slice ownership
			// must fail closed in topology preflight with zero mutations.
			pending.body = pending.body.replaceAll("slice-id=live", "slice-id=done");
			const input = amendmentInput(paths, parentIssue, pending, historical, {
				pendingResult: "Deliver the amended pending work",
				blockedBy: ["amend-done"],
			});
			const before = gh.mutations;
			const outcome = await runGithubInitiativePublication(root, JSON.parse(JSON.stringify(input)), gh);
			expect(outcome.status).toBe("ambiguous_remote_state");
			expect(outcome.message).toContain("does not match its requested Slice live");
			expect(gh.mutations).toBe(before);
		});
	});

	it("rejects a pending Child whose repo-wide task ownership is ambiguous before any Parent rewrite (round-11 review-2)", async () => {
		await withAmendmentBase(async (root, gh, { parentIssue, pending, historical, paths }) => {
			const input = amendmentInput(paths, parentIssue, pending, historical, {
				pendingResult: "Deliver the amended pending work",
				blockedBy: ["amend-done"],
			});
			// Inject a second open Issue in the same repo carrying the same task-id
			// marker: classifyObservedChildren only scans Parent-marked Issues, but the
			// repo-wide taskLookup in topology validation must fail the batch closed
			// before the Parent or any Child is rewritten.
			const duplicate = {
				id: 9003,
				number: 987,
				html_url: "https://github.com/example/project/issues/987",
				title: "foreign duplicate",
				body: pending.body.replaceAll(`task-id=amend-live`, `task-id=amend-live`),
				state: "open",
				state_reason: null,
			} as any;
			duplicate.body = `${duplicate.body}`;
			const before = gh.mutations;
			gh.issues.push(duplicate);
			const ambiguous = await runGithubInitiativePublication(root, JSON.parse(JSON.stringify(input)), gh);
			expect(ambiguous.status).toBe("ambiguous_remote_state");
			expect(gh.mutations).toBe(before);
			expect(ambiguous.message).toContain("amend-live");
		});
	});
});
