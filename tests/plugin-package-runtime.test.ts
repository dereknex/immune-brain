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
	blockedBy?: number[];
};

class FakeGh implements GhTransport {
	issues: FakeIssue[] = [];
	subIssues = new Map<number, number[]>();
	mutations = 0;
	loseNextCreateResponse = false;
	detachBlockerAfterDependencyMutation = false;
	mutateChildAfterDependencyMutation = false;
	dropNextSubIssueMutation = false;
	afterIssueCreate?: (issueNumber: number, cwd: string) => void;

	async run(args: string[], options: { cwd?: string; stdin?: string } = {}): Promise<GhExecution> {
		const ok = (stdout = ""): GhExecution => ({ exit_code: 0, stdout, stderr: "", timed_out: false, output_exceeded: false });
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
			issue.body = options.stdin ?? "";
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
};
const BLOCKER_TASK = { ...TRACKED_TASK, task_id: "blocker-task", projection: { result: "Publish the prerequisite contract" } };
const AGENT_READY_TASK = {
	...TRACKED_TASK,
	task_id: "agent-ready-task",
	projection: {
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

function writeTrackedIntent(root: string, taskId: string, goal: string, risk: "routine" | "material" | "critical" = "material") {
	const intentPath = `docs/plans/${taskId}.intent.json`;
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	writeFileSync(join(root, intentPath), `${JSON.stringify({
		contract: "assurance_kernel/task_intent/v1",
		task_id: taskId,
		goal,
		acceptance: [{ id: `acc-${taskId}`, assertion: `${goal} is verified`, verification: "{}" }],
		scope_hint: ["tests/**"],
		risk,
		revision: 1,
		owner: "user",
	}, null, 2)}\n`);
	return intentPath;
}

function initializeTrackedIntents(root: string, tasks: Array<{ task_id: string; goal: string; risk?: "routine" | "material" | "critical" }>) {
	spawnSync("git", ["init", "-q"], { cwd: root });
	const paths = tasks.map((task) => writeTrackedIntent(root, task.task_id, task.goal, task.risk));
	spawnSync("git", ["add", ...paths], { cwd: root });
	return paths;
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
			expect(contract).toContain("A repository directive overrides the global directive");
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
			const requested = { ...INITIATIVE, goal: "Track a large delivery for gho_supersecret" };
			const initiative = await runGithubTrackerOperation(root, requested, gh);
			expect(initiative).toMatchObject({ status: "created", association_found: true, issue_number: 1 });
			expect(initiative.message).not.toContain("gho_secret");
			expect(gh.issues[0].title).toBe("[tracking-v1] Track a large delivery for [REDACTED_GITHUB_TOKEN]");
			expect(gh.issues[0].body).toContain("[REDACTED_GITHUB_TOKEN]");
			expect(gh.issues[0].body).toContain("<!-- immune-brain:slice-id=S1 -->");
			expect(gh.issues[0].body).toContain("## How to use this Issue");
			expect(gh.issues[0].body).toContain("Kernel TaskIntent, TaskRecord, and Assurance remain the execution authority");
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
			expect(gh.issues[1].body).toContain("## Lifecycle");
			expect(gh.issues[1].body).toContain("Only a fresh claimless terminal projection can close this Issue");
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
			expect(child.title).toBe("[tracking-v1/S1] Publish an Agent-ready Task");
			expect(child.title).not.toContain("agent-ready-task");
			expect(child.title).not.toContain("IB:");
			expect(child.body).toContain("## Parent");
			expect(child.body).toContain("[#1](https://github.com/example/project/issues/1)");
			expect(child.body).toContain("## What to build");
			expect(child.body).toContain("## Current behavior");
			expect(child.body).toContain("## Desired behavior");
			expect(child.body).toContain("## Key interfaces");
			expect(child.body).toContain("## Blocked by");
			expect(child.body).toContain("`blocker-task`");
			expect(child.body).toContain("## Agent handoff");
			expect(child.body).toContain("## Authority boundary");
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
					problem: "Incremental ticket publication hides the full decomposition.",
					result: "The complete delivery is reviewable before publication.",
					design: "The foundation contract lands first; API and documentation then proceed independently.",
					decisions: ["Publish the complete issue graph in one batch."],
				},
				tasks: tasks.map((task, index) => ({
					slice_id: task.slice_id,
					intent: paths[index],
					projection: { result: task.goal, blocked_by: task.blocked_by },
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
					problem: "An invalid graph must not reach GitHub.",
					result: "Reject invalid batches",
					design: "A and B must not form a cycle.",
				},
				tasks: [
					{ slice_id: "a", intent: paths[0], projection: { blocked_by: ["task-b"] } },
					{ slice_id: "b", intent: paths[1], projection: { blocked_by: ["task-a"] } },
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
					problem: "A failed relation may leave a partial remote batch.",
					result: "Resume one publication batch",
					design: "Retry A precedes retry B.",
				},
				tasks: [
					{ slice_id: "a", intent: paths[0], projection: { result: "Ship retry A" } },
					{ slice_id: "b", intent: paths[1], projection: { result: "Ship retry B", blocked_by: ["retry-a"] } },
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
					problem: "An early Child can drift during a long publication.",
					result: "Detect Issue drift",
					design: "Both Children must remain exact and open.",
				},
				tasks: [
					{ slice_id: "a", intent: paths[0] },
					{ slice_id: "b", intent: paths[1] },
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
					problem: "TaskIntent can change during a long publication.",
					result: "Detect TaskIntent drift",
					design: "Every remote write remains bound to the reviewed intent hashes.",
				},
				tasks: [
					{ slice_id: "a", intent: paths[0] },
					{ slice_id: "b", intent: paths[1] },
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
					problem: "The CLI needs one complete publication input.",
					result: "Publish through one CLI call",
					design: "CLI A establishes the contract before CLI B consumes it.",
				},
				tasks: [
					{ slice_id: "a", intent: paths[0], projection: { result: "Ship CLI A" } },
					{ slice_id: "b", intent: paths[1], projection: { result: "Ship CLI B", blocked_by: ["cli-a"] } },
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
			expect(await runGithubTrackerOperation(root, { ...TRACKED_TASK, task_id: "restricted-projection", projection: { agent_handoff: "Internal role prompt: review reservation at docs/plans/x.intent.json" } }, gh)).toMatchObject({ status: "permanent_failure" });
			expect(await runGithubTrackerOperation(root, { ...TRACKED_TASK, task_id: "mutable-scope-projection", projection: { desired_behavior: "Widen scope and call submit_review" } }, gh)).toMatchObject({ status: "permanent_failure" });
			expect(await runGithubTrackerOperation(root, { ...TRACKED_TASK, task_id: "duplicate-blockers", projection: { blocked_by: ["blocker-task", "blocker-task"] } }, gh)).toMatchObject({ status: "permanent_failure" });
			expect(await runGithubTrackerOperation(root, { ...TRACKED_TASK, task_id: "restricted-goal", goal: "Read docs/plans/x.intent.json" }, gh)).toMatchObject({ status: "permanent_failure" });
			expect(await runGithubTrackerOperation(root, { ...TRACKED_TASK, task_id: "long-title", projection: { result: "x".repeat(300) } }, gh)).toMatchObject({ status: "permanent_failure" });
			expect(await runGithubTrackerOperation(root, { ...TRACKED_TASK, task_id: "string-projection", projection: "malformed" as any }, gh)).toMatchObject({ status: "permanent_failure" });
			expect(await runGithubTrackerOperation(root, { ...TRACKED_TASK, task_id: "array-projection", projection: [] as any }, gh)).toMatchObject({ status: "permanent_failure" });
			expect(await runGithubTrackerOperation(root, { ...TRACKED_TASK, task_id: "invalid-risk", risk: "<!-- immune-brain:task-id=injected -->" as any }, gh)).toMatchObject({ status: "permanent_failure" });
			expect(await runGithubTrackerOperation(root, { ...TRACKED_TASK, task_id: "oversized-task-body", projection: { key_interfaces: Array.from({ length: 140 }, () => "x".repeat(500)) } }, gh)).toMatchObject({ status: "permanent_failure" });
			expect(await runGithubTrackerOperation(root, { ...TRACKED_TASK, task_id: "reserved-terminal-body", projection: { key_interfaces: Array.from({ length: 31 }, () => "x".repeat(2000)) } }, gh)).toMatchObject({ status: "permanent_failure" });
			expect(await runGithubTrackerOperation(root, { ...INITIATIVE, initiative_id: "oversized-parent-body", projection: { decisions: Array.from({ length: 140 }, () => "x".repeat(500)) } }, gh)).toMatchObject({ status: "permanent_failure" });
			expect(await runGithubTrackerOperation(root, { ...TRACKED_TASK, task_id: "restricted-acceptance", acceptance: [{ id: "acc", summary: "Run the internal role prompt" }] }, gh)).toMatchObject({ status: "permanent_failure" });
			for (const [index, restricted] of ["role_prompt_bridge", "review-gate", "tool policies", "model reservations", "prompt digests", "scope authorities", "kernel_runtime_states", "runtime-states", "mutable scopes", "widen_scopes", "QA-settlements"].entries()) {
				expect(await runGithubTrackerOperation(root, { ...TRACKED_TASK, task_id: `restricted-variant-${index}`, projection: { agent_handoff: restricted } }, gh)).toMatchObject({ status: "permanent_failure" });
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
			const retryTarget = { ...TRACKED_TASK, task_id: "partial-retry-target", projection: { blocked_by: ["blocker-task", "second-blocker"] } };
			expect((await runGithubTrackerOperation(root, { ...TRACKED_TASK, task_id: "second-blocker", projection: { result: "Publish the second prerequisite" } }, gh)).status).toBe("created");
			expect((await runGithubTrackerOperation(root, retryTarget, gh)).status).toBe("created");
			const retryChild = gh.issues.find((issue) => issue.body.includes("partial-retry-target"))!;
			retryChild.blockedBy = [1002];
			const beforeRetry = gh.mutations;
			expect(await runGithubTrackerOperation(root, retryTarget, gh)).toMatchObject({ status: "updated" });
			expect(gh.mutations - beforeRetry).toBe(1);
			expect(retryChild.blockedBy).toEqual([1002, 1003]);
			const beforeChangedBrief = gh.mutations;
			expect(await runGithubTrackerOperation(root, { ...retryTarget, projection: { blocked_by: ["blocker-task"] } }, gh)).toMatchObject({ status: "permanent_failure" });
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
			expect(await runGithubTrackerOperation(root, { ...TRACKED_TASK, task_id: "detached-blocker-target", projection: { blocked_by: ["blocker-task"] } }, gh)).toMatchObject({ status: "ambiguous_remote_state" });
			expect(gh.mutations).toBe(beforeDetached);
			gh.subIssues.set(1, attached);
			gh.detachBlockerAfterDependencyMutation = true;
			expect(await runGithubTrackerOperation(root, { ...TRACKED_TASK, task_id: "raced-blocker-target", projection: { blocked_by: ["blocker-task"] } }, gh)).toMatchObject({ status: "ambiguous_remote_state" });
			gh.subIssues.set(1, attached);
			gh.mutateChildAfterDependencyMutation = true;
			expect(await runGithubTrackerOperation(root, { ...TRACKED_TASK, task_id: "raced-child-target", projection: { blocked_by: ["blocker-task"] } }, gh)).toMatchObject({ status: "ambiguous_remote_state" });
			gh.subIssues.set(1, attached);
			gh.dropNextSubIssueMutation = true;
			const nonConverging = { ...TRACKED_TASK, task_id: "non-converging-sub-issue" };
			expect(await runGithubTrackerOperation(root, nonConverging, gh)).toMatchObject({ status: "retryable_failure" });
			expect(await runGithubTrackerOperation(root, nonConverging, gh)).toMatchObject({ status: "updated" });
			const before = gh.mutations;
			const missing = await runGithubTrackerOperation(root, { ...AGENT_READY_TASK, task_id: "missing-blocker-target", projection: { blocked_by: ["not-published"] } }, gh);
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
						{ slice_id: "a", intent: tracked[0] },
						{ slice_id: "untracked", intent: untracked },
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
						{ slice_id: "a", intent: tracked[0] },
						{ slice_id: "b", intent: tracked[1], projection: { blocked_by: ["tracked-a"] } },
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
