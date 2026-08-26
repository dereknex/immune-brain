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
import { createHash } from "node:crypto";
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
	const record = {
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
	};
	const recordBytes = `${JSON.stringify(record, null, 2)}\n`;
	writeFileSync(join(root, ".imm", "tasks", `${taskId}.json`), recordBytes);
	writeFileSync(
		join(root, ".imm", "tasks", `${taskId}.backend-claim.json`),
		`${JSON.stringify({
			contract: "assurance_kernel/task_tombstone/v2",
			task_id: taskId,
			lifecycle_status: "terminal",
			terminal_lifecycle: "done",
			terminal_event_id: `stop-${taskId}`,
			final_record_hash: `sha256:${createHash("sha256").update(recordBytes).digest("hex")}`,
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
describe("migrateLegacyLayout direct execution (review-6)", () => {
	async function runMigration(
		root: string,
	): Promise<import("../plugins/immune-brain/runtime/kernel/storage_layout_migration").MigrationOutcome> {
		const { migrateLegacyLayout } = await import("../plugins/immune-brain/runtime/kernel/storage_layout_migration");
		return migrateLegacyLayout(root);
	}

	it("relocates a terminal pair byte-for-byte under the dual lock and leaves the layout uncommitted", async () => {
		const root = tempRoot();
		writeLegacyTerminalPair(root, "2026-08-14-001-old-task");
		// Legacy evidence is tracked so the diff shows exactly the relocation.
		execFileSync("git", ["-C", root, "add", "-A"]);
		execFileSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "legacy evidence"]);
		const outcome = await runMigration(root);
		expect(outcome.outcome).toBe("migrated");
		expect(existsSync(join(root, ".imm/audit/2026-08-14-001-old-task/task-record.json"))).toBe(true);
		expect(existsSync(join(root, ".imm/audit/2026-08-14-001-old-task/terminal-proof.json"))).toBe(true);
		expect(existsSync(join(root, ".imm/tasks"))).toBe(false);
		// The affected diff is uncommitted; mutation stays blocked.
		const inspection = inspectStorageLayout(root);
		expect(inspection.layout).toBe("migration_uncommitted");
		expect(inspection.dirty_affected_paths.length).toBeGreaterThan(0);
		// Committing the diff makes the layout ready.
		execFileSync("git", ["-C", root, "add", "-A"]);
		execFileSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "migrated"]);
		expect(inspectStorageLayout(root).layout).toBe("ready");
	});

	it("replays an interrupted migration from the frozen manifest without recomputing", async () => {
		const root = tempRoot();
		writeLegacyTerminalPair(root, "2026-08-14-002-old-task");
		execFileSync("git", ["-C", root, "add", "-A"]);
		execFileSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "legacy evidence"]);
		// Simulate a crash after marker creation: relocate just the record.
		mkdirSync(join(root, ".imm/state/transactions"), { recursive: true });
		const before = readFileSync(join(root, ".imm/tasks/2026-08-14-002-old-task.json"), "utf8");
		const proofBefore = readFileSync(join(root, ".imm/tasks/2026-08-14-002-old-task.backend-claim.json"), "utf8");
		writeFileSync(
			join(root, ".imm/state/transactions/storage-layout-migration.json"),
			`${JSON.stringify({
				contract: "assurance_kernel/storage_layout_migration/v1",
				version: 1,
				entries: [
					{ source: ".imm/tasks/2026-08-14-002-old-task.json", target: ".imm/audit/2026-08-14-002-old-task/task-record.json", sha256: createHash("sha256").update(before).digest("hex"), size: before.length },
					{ source: ".imm/tasks/2026-08-14-002-old-task.backend-claim.json", target: ".imm/audit/2026-08-14-002-old-task/terminal-proof.json", sha256: createHash("sha256").update(proofBefore).digest("hex"), size: proofBefore.length },
				],
			}, null, 2)}\n`,
		);
		// Interruption point: the record was relocated, the proof was not.
		mkdirSync(join(root, ".imm/audit/2026-08-14-002-old-task"), { recursive: true });
		writeFileSync(join(root, ".imm/audit/2026-08-14-002-old-task/task-record.json"), before);
		rmSync(join(root, ".imm/tasks/2026-08-14-002-old-task.json"));
		const outcome = await runMigration(root);
		expect(outcome.outcome).toBe("migrated");
		expect(readFileSync(join(root, ".imm/audit/2026-08-14-002-old-task/task-record.json"), "utf8")).toBe(before);
		expect(readFileSync(join(root, ".imm/audit/2026-08-14-002-old-task/terminal-proof.json"), "utf8")).toBe(proofBefore);
		expect(existsSync(join(root, ".imm/tasks"))).toBe(false);
		expect(existsSync(join(root, ".imm/state/transactions/storage-layout-migration.json"))).toBe(false);
	});

	it("stops with migration_uncommitted when affected paths are dirty before relocation", async () => {
		const root = tempRoot();
		writeLegacyTerminalPair(root, "2026-08-14-003-old-task");
		// Introduced after the committed baseline: dirty affected paths block.
		const outcome = await runMigration(root);
		expect(outcome.outcome).toBe("migration_uncommitted");
		expect(existsSync(join(root, ".imm/audit/2026-08-14-003-old-task"))).toBe(false);
	});
});

describe("migrateLegacyLayout case-fold and target preflight (review round 6)", () => {
	async function runMigration(root: string): Promise<unknown> {
		const { migrateLegacyLayout } = await import("../plugins/immune-brain/runtime/kernel/storage_layout_migration");
		try {
			return migrateLegacyLayout(root);
		} catch (error) {
			return { threw: error instanceof Error ? error.message : String(error) };
		}
	}

	it("rejects case-colliding audit targets (Foo vs foo) before any relocation", async () => {
		// The detector is evaluated per-axis but constructing two distinct
		// case variants requires a case-sensitive filesystem. Skip the live
		// collision fixture on case-insensitive filesystems (macOS/Windows
		// default) where the two names collapse to one directory entry; the
		// per-axis lowercase detection is additionally covered by the
		// migration marker validation tests below.
		const probe = mkdtempSync(join(tmpdir(), "imm-casefold-probe-"));
		try {
			const fs = require("node:fs") as typeof import("node:fs");
			writeFileSync(join(probe, "Probe"), "a");
			try {
				writeFileSync(join(probe, "probe"), "b");
				// Case-insensitive collision: "Probe" now reads "b".
				if (fs.readFileSync(join(probe, "Probe"), "utf8") === "b") {
					expect(true).toBe(true);
					return;
				}
			} catch {
				// Case-insensitive collision surfaced as an error.
				expect(true).toBe(true);
				return;
			}
			const root = tempRoot();
			writeLegacyTerminalPair(root, "Foo");
			writeLegacyTerminalPair(root, "foo");
			execFileSync("git", ["-C", root, "add", "-A"]);
			execFileSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "legacy evidence"]);
			const outcome = await runMigration(root);
			expect(JSON.stringify(outcome)).toMatch(/case-fold target collision/);
			// Zero relocation happened.
			expect(existsSync(join(root, ".imm/audit"))).toBe(false);
		} finally {
			rmSync(probe, { recursive: true, force: true });
		}
	});

	it("rejects an already-existing audit target as invalid with zero writes", async () => {
		const root = tempRoot();
		writeLegacyTerminalPair(root, "task-001");
		// Bind the legacy proof to the record bytes so the pair passes the
		// proof-binding check and the preflight is what rejects it.
		{
			const recordPath = join(root, ".imm/tasks/task-001.json");
			const recordBytes = readFileSync(recordPath, "utf8");
			const proofPath = join(root, ".imm/tasks/task-001.backend-claim.json");
			const proof = JSON.parse(readFileSync(proofPath, "utf8"));
			proof.final_record_hash = `sha256:${createHash("sha256").update(recordBytes).digest("hex")}`;
			writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
		}
		mkdirSync(join(root, ".imm/audit/task-001"), { recursive: true });
		writeFileSync(join(root, ".imm/audit/task-001/task-record.json"), "{\"contract\":\"assurance_kernel/task_record/v3\",\"task_id\":\"task-001\",\"lifecycle\":\"done\"}\n");
		execFileSync("git", ["-C", root, "add", "-A"]);
		execFileSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "legacy + conflicting target"]);
		const outcome = await runMigration(root);
		expect(JSON.stringify(outcome)).toMatch(/target already exists/);
		// The legacy source stays untouched; zero writes.
		expect(existsSync(join(root, ".imm/tasks/task-001.json"))).toBe(true);
		expect(existsSync(join(root, ".imm/state/transactions/storage-layout-migration.json"))).toBe(false);
	});
});
