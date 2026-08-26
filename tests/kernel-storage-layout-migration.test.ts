import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	auditTaskRecordPath,
	auditTerminalProofPath,
	inspectStorageLayout,
	legacyV3Path,
	stateTaskRecordPath,
} from "../plugins/immune-brain/runtime/kernel/storage_paths";

const roots: string[] = [];

function tempRoot(initGit = true): string {
	const root = mkdtempSync(join(tmpdir(), "imm-layout-"));
	roots.push(root);
	if (initGit) {
		execFileSync("git", ["-C", root, "init", "-q"]);
		execFileSync("git", [
			"-C", root, "-c", "user.email=test@example.com",
			"-c", "user.name=Test", "commit", "--allow-empty", "-q",
			"-m", "init",
		]);
	}
	return root;
}

function gitDirty(root: string): string[] {
	const out = spawnSync(
		"git", ["-C", root, "status", "--porcelain"],
		{ encoding: "utf8" },
	);
	return out.stdout.trim() ? out.stdout.split("\n") : [];
}

function writeLegacyTerminalPair(root: string, taskId: string): void {
	mkdirSync(join(root, ".imm", "tasks"), { recursive: true });
	writeFileSync(
		join(root, ".imm", "tasks", `${taskId}.json`),
		`${JSON.stringify({
			contract: "assurance_kernel/task_record/v3",
			task_id: taskId,
			intent_snapshot: { revision: 1, risk: "routine" },
			intent_ref: { path: `docs/plans/${taskId}.intent.json`, content_hash: "sha256:" + "0".repeat(64) },
			lifecycle: "done",
			artifact_state: "frozen",
			baseline: "sha256:" + "0".repeat(64),
			attestations: [],
			findings: [],
			history: [],
		}, null, 2)}\n`,
	);
	writeFileSync(
		join(root, ".imm", "tasks", `${taskId}.backend-claim.json`),
		`${JSON.stringify({
			contract: "assurance_kernel/task_tombstone/v2",
			task_id: taskId,
			lifecycle_status: "terminal",
			terminal_lifecycle: "done",
			terminal_event_id: `stop-${taskId}`,
			final_record_hash: "sha256:" + "0".repeat(64),
			terminalized_at: "2026-08-26T00:00:00.000Z",
		}, null, 2)}\n`,
	);
}

function writeLegacyClaim(root: string, taskId: string): void {
	mkdirSync(join(root, ".imm", "tasks"), { recursive: true });
	writeFileSync(
		join(root, ".imm", "tasks", ".backend-claim.json"),
		`${JSON.stringify({
			contract: "assurance_kernel/backend_claim/v2",
			backend: "kernel",
			task_id: taskId,
			intent_revision: 1,
			intent_content_hash: "sha256:" + "0".repeat(64),
			enrollment_event_id: `enroll-${taskId}`,
			lifecycle_status: "active",
			created_at: "2026-08-26T00:00:00.000Z",
			updated_at: "2026-08-26T00:00:00.000Z",
		}, null, 2)}\n`,
	);
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("storage_paths contract", () => {
	it("returns the permanent state/audit path vocabulary", () => {
		expect(stateTaskRecordPath("task-001")).toBe(".imm/state/tasks/task-001.json");
		expect(auditTaskRecordPath("task-001")).toBe(".imm/audit/task-001/task-record.json");
		expect(auditTerminalProofPath("task-001")).toBe(".imm/audit/task-001/terminal-proof.json");
		expect(legacyV3Path("current_iteration.json")).toBe(".imm/audit/legacy-v3/current_iteration.json");
	});

	it("rejects unsafe task ids in path derivation", () => {
		for (const bad of ["../escape", "a/b", "a\\b", "", "a b", ".hidden"]) {
			expect(() => stateTaskRecordPath(bad)).toThrow();
			expect(() => auditTaskRecordPath(bad)).toThrow();
		}
	});
});

describe("inspectStorageLayout failure branches", () => {
	it("reports ready for an empty committed repository", () => {
		const root = tempRoot();
		const inspection = inspectStorageLayout(root);
		expect(inspection.layout).toBe("ready");
		expect(inspection.contract).toBe("assurance_kernel/storage_layout_inspection/v1");
	});

	it("reports migration_required for an owner-free legacy tasks layout", () => {
		const root = tempRoot();
		writeLegacyTerminalPair(root, "2026-08-14-001-old-task");
		const inspection = inspectStorageLayout(root);
		expect(inspection.layout).toBe("migration_required");
		expect(inspection.old_authority_present).toBe(true);
	});

	it("reports migration_required for a legacy workspace.json without an owner", () => {
		const root = tempRoot();
		mkdirSync(join(root, ".imm"), { recursive: true });
		writeFileSync(
			join(root, ".imm", "workspace.json"),
			`${JSON.stringify({
				contract: "assurance_kernel/workspace/v1",
				current_working: null,
			}, null, 2)}\n`,
		);
		expect(inspectStorageLayout(root).layout).toBe("migration_required");
	});

	it("reports migration_blocked_active when a legacy claim exists", () => {
		const root = tempRoot();
		writeLegacyClaim(root, "task-001");
		const inspection = inspectStorageLayout(root);
		expect(inspection.layout).toBe("migration_blocked_active");
	});

	it("reports migration_blocked_active when the workspace owner is non-null", () => {
		const root = tempRoot();
		mkdirSync(join(root, ".imm"), { recursive: true });
		writeFileSync(
			join(root, ".imm", "workspace.json"),
			`${JSON.stringify({
				contract: "assurance_kernel/workspace/v1",
				current_working: "task-001",
			}, null, 2)}\n`,
		);
		expect(inspectStorageLayout(root).layout).toBe("migration_blocked_active");
	});

	it("reports migration_blocked_active when the v3 Ledger is non-idle", () => {
		const root = tempRoot();
		mkdirSync(join(root, ".imm", "memory"), { recursive: true });
		writeFileSync(
			join(root, ".imm", "memory", "current_iteration.json"),
			`${JSON.stringify({
				schema_version: 3,
				plan_path: "docs/plans/example.md",
				runtime_status: "working",
				steps: {},
			}, null, 2)}\n`,
		);
		expect(inspectStorageLayout(root).layout).toBe("migration_blocked_active");
	});

	it("reports recovery_required when any kernel transaction marker exists", () => {
		const root = tempRoot();
		mkdirSync(join(root, ".imm", "tasks"), { recursive: true });
		writeFileSync(join(root, ".imm", "tasks", ".terminal-transaction.json"), "{\"contract\":\"assurance_kernel/terminal_transaction/v1\"}\n");
		const inspection = inspectStorageLayout(root);
		expect(inspection.layout).toBe("recovery_required");
		expect(inspection.pending_marker).toContain(".terminal-transaction.json");
	});

	it("reports recovery_required for a new-layout migration marker", () => {
		const root = tempRoot();
		mkdirSync(join(root, ".imm", "state", "transactions"), { recursive: true });
		writeFileSync(
			join(root, ".imm", "state", "transactions", "storage-layout-migration.json"),
			"{\"contract\":\"assurance_kernel/storage_layout_migration/v1\"}\n",
		);
		expect(inspectStorageLayout(root).layout).toBe("recovery_required");
	});

	it("reports migration_uncommitted when audit evidence differs from HEAD", () => {
		const root = tempRoot();
		mkdirSync(join(root, ".imm", "audit", "task-001"), { recursive: true });
		writeFileSync(join(root, ".imm", "audit", "task-001", "task-record.json"), "{\"contract\":\"assurance_kernel/task_record/v3\"}\n");
		const inspection = inspectStorageLayout(root);
		expect(inspection.layout).toBe("migration_uncommitted");
		expect(inspection.dirty_affected_paths.length).toBeGreaterThan(0);
	});

	it("reports ready when audit evidence is committed", () => {
		const root = tempRoot();
		mkdirSync(join(root, ".imm", "audit", "task-001"), { recursive: true });
		writeFileSync(join(root, ".imm", "audit", "task-001", "task-record.json"), "{\"contract\":\"assurance_kernel/task_record/v3\"}\n");
		execFileSync("git", ["-C", root, "add", "-A"]);
		execFileSync("git", [
			"-C", root, "-c", "user.email=test@example.com",
			"-c", "user.name=Test", "commit", "-q", "-m", "audit",
		]);
		expect(gitDirty(root)).toEqual([]);
		expect(inspectStorageLayout(root).layout).toBe("ready");
	});

	it("reports invalid for a symlinked legacy path", () => {
		const root = tempRoot();
		mkdirSync(join(root, ".imm"), { recursive: true });
		execFileSync("ln", ["-s", "workspace-other.json", join(root, ".imm", "workspace.json")]);
		expect(inspectStorageLayout(root).layout).toBe("invalid");
	});

	it("reports invalid for unknown files under .imm/tasks", () => {
		const root = tempRoot();
		mkdirSync(join(root, ".imm", "tasks"), { recursive: true });
		writeFileSync(join(root, ".imm", "tasks", "mystery.bin"), "not a known owner file");
		expect(inspectStorageLayout(root).layout).toBe("invalid");
	});
});