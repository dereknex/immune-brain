import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runKernelCommand } from "../plugins/immune-brain/runtime/commands/kernel";
import { policyV1CanonicalBytes } from "../plugins/immune-brain/runtime/managed_task_routing_policy";

const roots: string[] = [];

function tempRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "imm-kernel-migrate-"));
	roots.push(root);
	mkdirSync(join(root, ".imm", "memory"), { recursive: true });
	return root;
}

function statePath(root: string): string {
	return join(root, ".imm", "memory", "current_iteration.json");
}

function writeState(root: string, state: Record<string, unknown>): string {
	const content = `${JSON.stringify(state, null, 2)}\n`;
	writeFileSync(statePath(root), content);
	return content;
}

function activeState(): Record<string, unknown> {
	return {
		schema_version: 3,
		plan_path: "docs/plans/example.md",
		plan_signature: "sha256:plan",
		runtime_status: "idle",
		requires_replan: false,
		active_step: 2,
		steps: {
			"1": { number: 1, step_id: "U1", state: "closed" },
			"2": { number: 2, step_id: "U2", state: "active" },
			"3": { number: 3, step_id: "U3", state: "pending" },
		},
	};
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("imm-kernel migrate is retired", () => {
	it("rejects migrate with invalid_command and zero writes", () => {
		const root = tempRoot();
		const before = writeState(root, activeState());
		const first = runKernelCommand(["migrate", "--dry-run", "--json"], root);
		const second = runKernelCommand(["migrate", "--dry-run", "--json"], root);
		expect(first.returncode).toBe(2);
		expect(second.returncode).toBe(2);
		expect(JSON.parse(first.stdout)).toEqual(JSON.parse(second.stdout));
		expect(JSON.parse(first.stdout)).toMatchObject({
			error: { code: "invalid_command" },
		});
		expect(readFileSync(statePath(root), "utf8")).toBe(before);
		expect(existsSync(join(root, ".imm/state"))).toBe(false);
		expect(existsSync(join(root, ".imm/state/workspace.json"))).toBe(false);
	});

	it("rejects migrate regardless of ledger shape with zero journal writes", () => {
		const root = tempRoot();
		const before = writeState(root, {
			schema_version: 3,
			plan_path: "docs/plans/broken.md",
			runtime_status: "idle",
			requires_replan: false,
			active_step: null,
			steps: { "1": { state: "replanning" } },
		});
		const result = runKernelCommand(["migrate", "--dry-run", "--json"], root);
		expect(result.returncode).toBe(2);
		expect(JSON.parse(result.stdout)).toMatchObject({
			error: { code: "invalid_command" },
		});
		expect(readFileSync(statePath(root), "utf8")).toBe(before);
		expect(existsSync(join(root, ".imm", "journal.jsonl"))).toBe(false);
		expect(existsSync(join(root, ".imm/state"))).toBe(false);
	});

	it("rejects migrate without --dry-run through the same retired path", () => {
		const root = tempRoot();
		const before = writeState(root, activeState());
		const result = runKernelCommand(["migrate", "--json"], root);
		expect(result.returncode).toBe(2);
		expect(JSON.parse(result.stdout)).toMatchObject({
			error: { code: "invalid_command" },
		});
		expect(readFileSync(statePath(root), "utf8")).toBe(before);
		expect(existsSync(join(root, ".imm/state"))).toBe(false);
	});
});


describe("intent author never migrates implicitly", () => {
	it("refuses a retired layout and names the explicit migration command", async () => {
		const root = tempRoot();
		execFileSync("git", ["-C", root, "init", "-q"]);
		writeFileSync(join(root, ".gitignore"), ".imm/\n");
		mkdirSync(join(root, "docs/plans"), { recursive: true });
		// The authoring route needs its active policy; the retired Ledger is the
		// layout condition under test.
		writeFileSync(join(root, "docs/plans/managed-task-routing-policy.json"), policyV1CanonicalBytes());
		execFileSync("git", ["-C", root, "add", "-A"]);
		execFileSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "fixture baseline"]);
		mkdirSync(join(root, ".imm/memory"), { recursive: true });
		const ledger = `${JSON.stringify({ schema_version: 3, runtime_status: "idle", steps: {} }, null, 2)}\n`;
		writeFileSync(join(root, ".imm/memory/current_iteration.json"), ledger);

		const result = runKernelCommand(
			["intent", "author", "docs/plans/2026-08-14-author-task.intent.json", "--stdin", "--json"],
			root,
		);
		expect(result.returncode).toBe(1);
		expect(result.stdout).toMatch(/layout_migration_required/);
		expect(result.stdout).toMatch(/migrate --storage-layout/);
		// Zero migration side effects: no store, no evidence, no retired file gone.
		expect(existsSync(join(root, ".imm/state/kernel.sqlite"))).toBe(false);
		expect(existsSync(join(root, ".imm/audit/legacy-v3/current_iteration.json"))).toBe(false);
		expect(readFileSync(join(root, ".imm/memory/current_iteration.json"), "utf8")).toBe(ledger);
	});
});

describe("execution state stays out of git", () => {
	it("keeps execution state out of git", () => {
		const gitignore = readFileSync(join(process.cwd(), ".gitignore"), "utf8");
		expect(gitignore).toMatch(/^\.imm\/state\/\s*$/m);
		expect(gitignore).not.toMatch(/^\.imm\/audit\/\s*$/m);
		expect(gitignore).toContain(".imm/migrations/");
	});
});
