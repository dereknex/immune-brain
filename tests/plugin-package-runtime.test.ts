import { describe, expect, it } from "bun:test";
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

describe("plugin package runtime cutover parity", () => {
	it("list-commands exposes the CLI command manifest", () => {
		const ts = spawnSync("bun", [TS_RUNTIME, "list-commands", "--json"], {
			encoding: "utf-8",
			cwd: REPO_ROOT,
		});
		expect(ts.status).toBe(0);
		const commands = JSON.parse(ts.stdout).commands;
		const names = commands.map((command: any) => command.name).sort();
		expect(names).toEqual(["imm-kernel", "imm-plan"]);
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

});
