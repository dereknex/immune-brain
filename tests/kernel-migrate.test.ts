import { afterEach, describe, expect, it } from "bun:test";
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
		expect(existsSync(join(root, ".imm", "tasks"))).toBe(false);
		expect(existsSync(join(root, ".imm", "workspace.json"))).toBe(false);
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
		expect(existsSync(join(root, ".imm", "tasks"))).toBe(false);
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
		expect(existsSync(join(root, ".imm", "tasks"))).toBe(false);
	});
});


describe("execution state stays out of git", () => {
	it("keeps execution state out of git", () => {
		const gitignore = readFileSync(join(process.cwd(), ".gitignore"), "utf8");
		expect(gitignore).not.toMatch(/^\.imm\/tasks\/\s*$/m);
		expect(gitignore).toContain(".imm/workspace.json");
		expect(gitignore).toContain(".imm/journal.jsonl");
		expect(gitignore).toContain(".imm/migrations/");
	});
});
