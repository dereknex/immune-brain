import { afterEach, describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runKernelCommand } from "../plugins/immune-brain/runtime/commands/kernel";

const roots: string[] = [];

function tempRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "imm-kernel-status-"));
	roots.push(root);
	mkdirSync(join(root, ".imm"), { recursive: true });
	return root;
}

function writeClaim(root: string, taskId = "status-owner-task"): void {
	mkdirSync(join(root, ".imm/state"), { recursive: true });
	writeFileSync(
		join(root, ".imm/state/active-claim.json"),
		`${JSON.stringify({
			contract: "assurance_kernel/backend_claim/v2",
			backend: "kernel",
			task_id: taskId,
			intent_revision: 1,
			intent_content_hash: "sha256:" + "0".repeat(64),
			enrollment_event_id: `enroll-${taskId}`,
			lifecycle_status: "active",
			created_at: "2026-08-12T00:00:00.000Z",
			updated_at: "2026-08-12T00:00:00.000Z",
		}, null, 2)}\n`,
	);
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("imm-kernel status", () => {
	it("reports a ready layout with unowned Kernel facts, zero writes", () => {
		const root = tempRoot();
		const result = runKernelCommand(["status", "--json"], root);
		expect(result.returncode).toBe(0);
		const output = JSON.parse(result.stdout);
		expect(output.contract).toBe("assurance_kernel/status/v1");
		expect(output.layout).toMatchObject({ layout: "ready" });
		expect(output.kernel).toEqual({ claim: null, workspace: { current_working: null } });
		// Strictly read-only: no authority bytes, no journal, no lock residue.
		expect(existsSync(join(root, ".imm/state/workspace.json"))).toBe(false);
		expect(existsSync(join(root, ".imm/state/active-claim.json"))).toBe(false);
		expect(existsSync(join(root, ".imm/state/journal.jsonl"))).toBe(false);
	});

	it("reports an owner-free legacy layout as migration_required without interpreting old authority", () => {
		const root = tempRoot();
		mkdirSync(join(root, ".imm/memory"), { recursive: true });
		writeFileSync(
			join(root, ".imm/memory/current_iteration.json"),
			`${JSON.stringify({
				schema_version: 3,
				plan_path: "docs/plans/example.md",
				runtime_status: "idle",
				steps: {},
			}, null, 2)}\n`,
		);
		const result = runKernelCommand(["status", "--json"], root);
		expect(result.returncode).toBe(0);
		const output = JSON.parse(result.stdout);
		expect(output.layout.layout).toBe("migration_required");
		// The archived Ledger is never projected as current authority.
		expect(output.kernel).toEqual({ claim: null, workspace: { current_working: null } });
	});

	it("reports the Kernel claim and workspace owner when present", () => {
		const root = tempRoot();
		writeClaim(root);
		mkdirSync(join(root, ".imm/state"), { recursive: true });
		writeFileSync(
			join(root, ".imm/state/workspace.json"),
			`${JSON.stringify({
				contract: "assurance_kernel/workspace/v1",
				current_working: "status-owner-task",
			}, null, 2)}\n`,
		);
		const result = runKernelCommand(["status", "--json"], root);
		expect(result.returncode).toBe(0);
		const output = JSON.parse(result.stdout);
		expect(output.layout.layout).toBe("ready");
		expect(output.kernel.claim).toEqual({
			task_id: "status-owner-task",
			lifecycle_status: "active",
		});
		expect(output.kernel.workspace.current_working).toBe("status-owner-task");
	});

	it("rejects a symlinked claim path with a layout failure instead of following it", () => {
		const root = tempRoot();
		mkdirSync(join(root, ".imm/state"), { recursive: true });
		const outside = join(root, "outside.json");
		writeFileSync(outside, "{}");
		symlinkSync(outside, join(root, ".imm/state/active-claim.json"));
		const result = runKernelCommand(["status", "--json"], root);
		expect(result.returncode).toBe(1);
		const output = JSON.parse(result.stdout);
		expect(output.error.code).toBe("source_read_failed");
	});

	it("journals rejected unknown commands without mutating authoritative state", () => {
		const root = tempRoot();
		const result = runKernelCommand(["totally-unknown-command"], root);
		expect(result.returncode).toBe(2);
		const journalPath = join(root, ".imm/state/journal.jsonl");
		expect(existsSync(journalPath)).toBe(true);
		const line = JSON.parse(readFileSync(journalPath, "utf8").trim().split("\n").at(-1) ?? "{}");
		expect(line.command).toBe("totally-unknown-command");
		expect(line.result).toBe("rejected");
		expect(existsSync(join(root, ".imm/state/workspace.json"))).toBe(false);
	});

	it("status is strictly read-only and never touches the journal", () => {
		const root = tempRoot();
		runKernelCommand(["status", "--json"], root);
		expect(existsSync(join(root, ".imm/state/journal.jsonl"))).toBe(false);
	});
});