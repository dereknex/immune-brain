import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
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
import { readLegacyLedgerBounded, projectLegacyAudit } from "../plugins/immune-brain/runtime/kernel/legacy_audit";
import { inspectStorageLayout } from "../plugins/immune-brain/runtime/kernel/storage_paths";

const roots: string[] = [];

function tempRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "imm-legacy-v3-"));
	roots.push(root);
	return root;
}

function seededLedger(): Record<string, unknown> {
	return {
		schema_version: 3,
		plan_path: "docs/plans/example.md",
		plan_signature: "sha256:plan",
		runtime_status: "idle",
		requires_replan: false,
		active_step: null,
		reset_reason: "intentional_reset",
		steps: {
			"1": { number: 1, step_id: "U1", state: "closed" },
		},
	};
}

function writeArchivedLedger(root: string): void {
	mkdirSync(join(root, ".imm", "audit", "legacy-v3"), { recursive: true });
	const content = `${JSON.stringify(seededLedger(), null, 2)}\n`;
	writeFileSync(join(root, ".imm/audit/legacy-v3/current_iteration.json"), content);
	// Also commit it so the layout gate sees a ready Git tree.
	execFileSync("git", ["init", "-q"], { cwd: root });
	execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"], { cwd: root });
	execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "archived ledger"], { cwd: root });
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("v4 storage retirement legacy audit", () => {
	it("reads the relocated legacy-v3 ledger byte-preserved and redacted", () => {
		const root = tempRoot();
		writeArchivedLedger(root);
		const read = readLegacyLedgerBounded(root);
		expect(read?.path).toBe(".imm/audit/legacy-v3/current_iteration.json");
		const projection = projectLegacyAudit(root);
		expect(projection.contract).toBe("assurance_kernel/legacy_audit/v1");
		expect(projection.source).toBe(".imm/audit/legacy-v3/current_iteration.json");
		expect(projection.read_only).toBe(true);
		expect(projection.writes_performed).toBe(false);
		expect(projection.plan_path).toBe("docs/plans/example.md");
		expect(projection.phase).toBe("finished");
		expect(projection.step_count).toBe(1);
		expect(projection.redacted).toBe(true);
		expect(projection.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
	});

	it("surfaces the legacy audit through the CLI without treating it as current authority", () => {
		const root = tempRoot();
		writeArchivedLedger(root);
		const result = runKernelCommand(["audit", "--legacy"], root);
		expect(result.returncode).toBe(0);
		const output = JSON.parse(result.stdout);
		expect(output.contract).toBe("assurance_kernel/legacy_audit/v1");
		expect(output.read_only).toBe(true);
		// status reports layout/ownership facts only; no synthesized TaskRecord.
		const status = runKernelCommand(["status", "--json"], root);
		expect(JSON.parse(status.stdout).contract).toBe("assurance_kernel/status/v1");
		expect(JSON.parse(status.stdout).kernel).toEqual({
			claim: null,
			workspace: { current_working: null },
		});
	});

	it("rejects a symlinked legacy-v3 ledger and reports an empty projection when absent", () => {
		const root = tempRoot();
		expect(projectLegacyAudit(root).digest).toBe("sha256:none");
		mkdirSync(join(root, ".imm", "audit", "legacy-v3"), { recursive: true });
		const outside = join(root, "outside.json");
		writeFileSync(outside, `${JSON.stringify(seededLedger())}\n`);
		const { symlinkSync } = require("node:fs") as typeof import("node:fs");
		try {
			symlinkSync(outside, join(root, ".imm/audit/legacy-v3/current_iteration.json"));
			expect(() => readLegacyLedgerBounded(root)).toThrow(/symlink/);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
	});

	it("treats archived legacy evidence as non-authoritative for the layout gate", () => {
		const root = tempRoot();
		writeArchivedLedger(root);
		// A legacy-v3 ledger alone is a ready layout: it never blocks or
		// migrates and never projects authority.
		expect(inspectStorageLayout(root).layout).toBe("ready");
		expect(existsSync(join(root, ".imm/state/active-claim.json"))).toBe(false);
	});

	it("the legacy audit performs zero writes across the packed fixture", () => {
		const root = tempRoot();
		writeArchivedLedger(root);
		const before = readFileSync(join(root, ".imm/audit/legacy-v3/current_iteration.json"), "utf8");
		runKernelCommand(["audit", "--legacy"], root);
		expect(readFileSync(join(root, ".imm/audit/legacy-v3/current_iteration.json"), "utf8")).toBe(before);
		expect(existsSync(join(root, ".imm/state/tasks"))).toBe(false);
	});
});