import { describe, expect, it } from "bun:test";
import type { GhExecution, GhTransport } from "../plugins/immune-brain/runtime/github_issue_tracker.ts";
import {
	createGhTransport,
	redactGithubDiagnostic,
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
	number: number;
	html_url: string;
	body: string;
	state: "open" | "closed";
	state_reason: string | null;
};

class FakeGh implements GhTransport {
	issues: FakeIssue[] = [];
	subIssues = new Map<number, number[]>();
	mutations = 0;
	loseNextCreateResponse = false;

	async run(args: string[], options: { cwd?: string; stdin?: string } = {}): Promise<GhExecution> {
		const ok = (stdout = ""): GhExecution => ({ exit_code: 0, stdout, stderr: "", timed_out: false, output_exceeded: false });
		if (args[0] === "api" && args[1] === "repos/{owner}/{repo}")
			return ok(JSON.stringify({ id: 4242, full_name: "example/project" }));
		if (args[0] === "api" && args.includes("--paginate"))
			return ok(JSON.stringify([this.issues]));
		if (args[0] === "api") {
			const endpoint = args.at(-1) as string;
			const subIssueList = endpoint.match(/issues\/(\d+)\/sub_issues/);
			if (subIssueList && !args.some((flag) => flag === "-F" || flag === "-f")) {
				const numbers = this.subIssues.get(Number(subIssueList[1])) ?? [];
				return ok(JSON.stringify(numbers.map((number) => ({ number }))));
			}
			if (subIssueList) {
				this.mutations += 1;
				const parent = Number(subIssueList[1]);
				const child = Number(args.find((value) => value.startsWith("sub_issue_id="))!.split("=")[1]);
				const existingParent = [...this.subIssues.entries()].find(([, children]) => children.includes(child));
				if (existingParent && existingParent[0] !== parent)
					return { ...ok(), exit_code: 1, stderr: `HTTP 422: Issue #${child} already has a parent (#${existingParent[0]})` };
				const current = this.subIssues.get(parent) ?? [];
				if (!current.includes(child)) current.push(child);
				this.subIssues.set(parent, current);
				return ok();
			}
		}
		if (args[0] === "issue" && args[1] === "create") {
			this.mutations += 1;
			const number = this.issues.length + 1;
			this.issues.push({
				number,
				html_url: `https://github.com/example/project/issues/${number}`,
				body: options.stdin ?? "",
				state: "open",
				state_reason: null,
			});
			if (this.loseNextCreateResponse) {
				this.loseNextCreateResponse = false;
				return { exit_code: 1, stdout: "", stderr: "gho_secret timeout", timed_out: true, output_exceeded: false };
			}
			return ok(this.issues.at(-1)?.html_url);
		}
		if (args[0] === "issue" && args[1] === "edit") {
			this.mutations += 1;
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
			"imm-kernel audit --legacy",
		]);
		expect(JSON.stringify(commands)).not.toContain("tools/list");
		expect(JSON.stringify(commands)).not.toContain("tools/call");
		const tracker = commands.find((command: any) => command.name === "imm-tracker");
		expect(tracker.description).toContain("Never grants or consumes Kernel authority");
		expect(tracker.examples).toHaveLength(2);
	});

	it("ships matching Planner and Loop tracker authority contracts", () => {
		const plannerSource = readFileSync(join(REPO_ROOT, "plugins/immune-brain/skills/imm-planner/SKILL.md"), "utf8");
		const plannerPacked = readFileSync(join(REPO_ROOT, "plugins/immune-brain/dist/imm-planner.md"), "utf8");
		const loopSource = readFileSync(join(REPO_ROOT, "plugins/immune-brain/skills/imm-loop/SKILL.md"), "utf8");
		const loopPacked = readFileSync(join(REPO_ROOT, "plugins/immune-brain/dist/imm-loop.md"), "utf8");
		for (const contract of [plannerSource, plannerPacked]) {
			expect(contract).toContain("create-initiative --stdin --json");
			expect(contract).toContain("upsert-task --initiative-id <slug> --slice-id <id> --intent <path> --json");
			expect(contract).toContain("Tracker output is observation, never authority");
			expect(contract).toContain("do not block planning, Enrollment, execution, QA, Review, settlement");
			expect(contract).not.toContain("upsert-initiative");
			expect(contract).not.toContain("mark-active");
		}
		for (const contract of [loopSource, loopPacked]) {
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
				contract: "assurance_kernel/shadow_status/v1",
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
			expect(existsSync(join(root, ".imm", "tasks"))).toBe(false);
			expect(existsSync(join(root, ".imm", "workspace.json"))).toBe(false);
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
			expect(gh.issues[0].body).toContain("[REDACTED_GITHUB_TOKEN]");
			expect(gh.issues[0].body).toContain("<!-- immune-brain:slice-id=S1 -->");

			expect(await runGithubTrackerOperation(root, requested, gh)).toMatchObject({ status: "already_current" });

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
			expect(gh.issues[1].body).toContain("<!-- immune-brain:task-id=2026-08-22-001-task -->");
			expect(gh.issues[1].body).not.toContain("tracker-state");
			expect(gh.issues[1].body).not.toContain(".intent.json");

			expect(await runGithubTrackerOperation(root, TRACKED_TASK, gh)).toMatchObject({ status: "already_current" });

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
			expect(existsSync(join(root, ".imm", "tasks"))).toBe(false);
		});
	});

	it("publishes only a canonical Git-tracked TaskIntent through the CLI", async () => {
		await withIsolatedRootAsync(async (root) => {
			const gh = new FakeGh();
			expect((await runGithubTrackerOperation(root, INITIATIVE, gh)).status).toBe("created");
			mkdirSync(join(root, "docs", "plans"), { recursive: true });
			const intentPath = `docs/plans/${TRACKED_TASK.task_id}.intent.json`;
			writeFileSync(join(root, intentPath), `${JSON.stringify({
				contract: "assurance_kernel/task_intent/v1",
				task_id: TRACKED_TASK.task_id,
				goal: TRACKED_TASK.goal,
				acceptance: [{ id: "acc-task", assertion: "The bounded Task is verified", verification: "{}" }],
				scope_hint: ["tests/**"],
				risk: "material",
				revision: 1,
				owner: "user",
			}, null, 2)}\n`);
			spawnSync("git", ["init", "-q"], { cwd: root });
			spawnSync("git", ["add", intentPath], { cwd: root });
			const published = await runGithubTrackerCli([
				"upsert-task", "--initiative-id", INITIATIVE.initiative_id,
				"--slice-id", TRACKED_TASK.slice_id, "--intent", intentPath, "--json",
			], root, { gh });
			expect(published.returncode).toBe(0);
			expect(JSON.parse(published.stdout)).toMatchObject({ status: "created", issue_number: 2 });
			const untrackedPath = `docs/plans/untracked-task.intent.json`;
			writeFileSync(join(root, untrackedPath), readFileSync(join(root, intentPath)));
			const rejected = await runGithubTrackerCli([
				"upsert-task", "--initiative-id", INITIATIVE.initiative_id,
				"--slice-id", TRACKED_TASK.slice_id, "--intent", untrackedPath, "--json",
			], root, { gh });
			expect(rejected.returncode).toBe(2);
			expect(rejected.stderr).toContain("not Git-tracked");
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
