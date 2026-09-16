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
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
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

function legacyIntent(taskId: string): Record<string, unknown> {
	return {
		contract: "assurance_kernel/task_intent/v1",
		task_id: taskId,
		goal: `legacy outcome for ${taskId}`,
		acceptance: [{ id: "A1", assertion: "legacy acceptance", verification: "verify one" }],
		scope_hint: ["path/or/domain"],
		risk: "routine",
		revision: 1,
		owner: "user",
	};
}

function writeLegacyTerminalPair(root: string, taskId: string): void {
	mkdirSync(join(root, ".imm", "tasks"), { recursive: true });
	const intent = legacyIntent(taskId);
	const record = {
		contract: "assurance_kernel/task_record/v3",
		task_id: taskId,
		intent_snapshot: intent,
		intent_ref: {
			path: `docs/plans/${taskId}.intent.json`,
			content_hash: canonicalIntentHash(parseTaskIntentV1(intent)),
		},
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

	it("reports migration_required when the pre-cutover workspace owner file exists without an owner", () => {
		const root = tempRoot();
		mkdirSync(join(root, ".imm"), { recursive: true });
		writeFileSync(
			join(root, ".imm", "workspace.json"),
			`${JSON.stringify({ contract: "assurance_kernel/workspace/v1", current_working: null }, null, 2)}\n`,
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

	it("reports migration_blocked_active when a legacy kernel transaction marker exists", () => {
		const root = tempRoot();
		mkdirSync(join(root, ".imm", "tasks"), { recursive: true });
		writeFileSync(join(root, ".imm", "tasks", ".terminal-transaction.json"), "{\"contract\":\"assurance_kernel/terminal_transaction/v1\"}\n");
		const inspection = inspectStorageLayout(root);
		expect(inspection.layout).toBe("migration_blocked_active");
		expect(inspection.reason).toContain("prior runtime");
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
describe("explicit SQLite import of the retired file store (A1)", () => {
	async function runMigration(
		root: string,
	): Promise<import("../plugins/immune-brain/runtime/kernel/storage_layout_migration").MigrationOutcome> {
		const { migrateLegacyLayout } = await import("../plugins/immune-brain/runtime/kernel/storage_layout_migration");
		return migrateLegacyLayout(root);
	}

	function commit(root: string, message: string): void {
		execFileSync("git", ["-C", root, "add", "-A"]);
		execFileSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", message]);
	}

	it("imports an owner-free legacy terminal task and preserves its raw bytes as evidence", async () => {
		const root = tempRoot();
		writeLegacyTerminalPair(root, "2026-08-14-001-old-task");
		const recordBefore = readFileSync(join(root, ".imm/tasks/2026-08-14-001-old-task.json"));
		const proofBefore = readFileSync(join(root, ".imm/tasks/2026-08-14-001-old-task.backend-claim.json"));
		commit(root, "legacy evidence");
		expect(inspectStorageLayout(root).layout).toBe("migration_required");

		// Phase 1 preserves the bytes and refuses to retire the source until the
		// audit copies are committed.
		const first = await runMigration(root);
		expect(first).toMatchObject({ outcome: "migration_uncommitted" });
		expect(first.affected_paths).toEqual([
			".imm/audit/2026-08-14-001-old-task/task-record.json",
			".imm/audit/2026-08-14-001-old-task/terminal-proof.json",
		]);
		expect(existsSync(join(root, ".imm/state/kernel.sqlite"))).toBe(false);
		expect(existsSync(join(root, ".imm/tasks/2026-08-14-001-old-task.json"))).toBe(true);
		expect(readFileSync(join(root, ".imm/audit/2026-08-14-001-old-task/task-record.json"))).toEqual(recordBefore);
		commit(root, "preserve evidence");

		const outcome = await runMigration(root);
		expect(outcome).toMatchObject({ outcome: "migrated" });
		expect(outcome.reason).toMatch(/imported 1 terminal task/);

		// The published authority is the SQLite store, and the historical bytes
		// survive verbatim as tracked evidence.
		const { openKernelStore } = await import("../plugins/immune-brain/runtime/kernel/sqlite_store");
		const db = openKernelStore(root, { create: false });
		expect(db).not.toBeNull();
		const row = db!.prepare("SELECT task_id, state, record_json, claim_status FROM runs").get() as Record<string, unknown>;
		expect(row).toMatchObject({ task_id: "2026-08-14-001-old-task", state: "done", claim_status: null });
		db!.close();
		expect(readFileSync(join(root, ".imm/audit/2026-08-14-001-old-task/task-record.json"))).toEqual(recordBefore);
		expect(readFileSync(join(root, ".imm/audit/2026-08-14-001-old-task/terminal-proof.json"))).toEqual(proofBefore);
		expect(existsSync(join(root, ".imm/state/kernel.identity.json"))).toBe(true);
		// The retired store is gone: one authority, not two.
		expect(existsSync(join(root, ".imm/tasks/2026-08-14-001-old-task.json"))).toBe(false);
		commit(root, "import");
		expect(inspectStorageLayout(root).layout).toBe("ready");
	});

	it("retries idempotently through the recorded import identity", async () => {
		const root = tempRoot();
		writeLegacyTerminalPair(root, "2026-08-14-002-old-task");
		const recordBefore = readFileSync(join(root, ".imm/tasks/2026-08-14-002-old-task.json"));
		commit(root, "legacy evidence");
		expect((await runMigration(root)).outcome).toBe("migration_uncommitted");
		commit(root, "preserve evidence");
		expect((await runMigration(root)).outcome).toBe("migrated");
		const storeBefore = readFileSync(join(root, ".imm/state/kernel.sqlite"));

		const retry = await runMigration(root);
		expect(retry).toMatchObject({ outcome: "already_migrated" });
		expect(readFileSync(join(root, ".imm/state/kernel.sqlite"))).toEqual(storeBefore);
		expect(readFileSync(join(root, ".imm/audit/2026-08-14-002-old-task/task-record.json"))).toEqual(recordBefore);
	});

	it("recovers an interrupted publication from the verified candidate store", async () => {
		const root = tempRoot();
		writeLegacyTerminalPair(root, "2026-08-14-003-old-task");
		const recordBytes = readFileSync(join(root, ".imm/tasks/2026-08-14-003-old-task.json"));
		commit(root, "legacy evidence");
		expect((await runMigration(root)).outcome).toBe("migration_uncommitted");
		commit(root, "preserve evidence");
		expect((await runMigration(root)).outcome).toBe("migrated");
		// Reproduce the crash window: a verified candidate store exists, the
		// publication rename did not happen, and no receipt was written.
		const candidate = join(root, ".imm/state/kernel.sqlite.importing");
		writeFileSync(candidate, readFileSync(join(root, ".imm/state/kernel.sqlite")));
		rmSync(join(root, ".imm/state/kernel.sqlite"));
		rmSync(join(root, ".imm/state/kernel.sqlite-wal"), { force: true });
		rmSync(join(root, ".imm/state/kernel.sqlite-shm"), { force: true });
		rmSync(join(root, ".imm/state/migration-receipt.json"), { force: true });
		// The legacy source is restored from the evidence the import preserved:
		// both sides of the terminal pair must exist for the import to resume.
		mkdirSync(join(root, ".imm/tasks"), { recursive: true });
		writeFileSync(join(root, ".imm/tasks/2026-08-14-003-old-task.json"), recordBytes);
		writeFileSync(
			join(root, ".imm/tasks/2026-08-14-003-old-task.backend-claim.json"),
			readFileSync(join(root, ".imm/audit/2026-08-14-003-old-task/terminal-proof.json")),
		);
		commit(root, "restore legacy source");
		expect(inspectStorageLayout(root).layout).toBe("migration_required");

		const recovered = await runMigration(root);
		expect(recovered).toMatchObject({ outcome: "migrated" });
		const { openKernelStore } = await import("../plugins/immune-brain/runtime/kernel/sqlite_store");
		const db = openKernelStore(root, { create: false });
		expect(db).not.toBeNull();
		expect(db!.prepare("SELECT COUNT(*) AS n FROM runs").get()).toMatchObject({ n: 1 });
		db!.close();
		expect(existsSync(candidate)).toBe(false);
	});

	it("refuses to overwrite an existing SQLite store", async () => {
		const root = tempRoot();
		writeLegacyTerminalPair(root, "2026-08-14-004-old-task");
		commit(root, "legacy evidence");
		const { openKernelStore } = await import("../plugins/immune-brain/runtime/kernel/sqlite_store");
		const db = openKernelStore(root, { create: true });
		db!.close();
		const storeBefore = readFileSync(join(root, ".imm/state/kernel.sqlite"));
		const outcome = await runMigration(root);
		expect(outcome.outcome).toBe("invalid");
		expect(outcome.reason).toMatch(/both a SQLite authority store and retired file-store authority exist/);
		expect(readFileSync(join(root, ".imm/state/kernel.sqlite"))).toEqual(storeBefore);
		expect(existsSync(join(root, ".imm/tasks/2026-08-14-004-old-task.json"))).toBe(true);
	});

	it("refuses a live legacy task with zero writes", async () => {
		const root = tempRoot();
		writeLegacyClaim(root, "task-live");
		commit(root, "live claim");
		const outcome = await runMigration(root);
		expect(outcome.outcome).toBe("migration_blocked_active");
		expect(existsSync(join(root, ".imm/state/kernel.sqlite"))).toBe(false);
		expect(existsSync(join(root, ".imm/tasks/.backend-claim.json"))).toBe(true);
	});

	it("refuses a recoverable batch before importing anything", async () => {
		const root = tempRoot();
		writeLegacyTerminalPair(root, "2026-08-14-005-old-task");
		mkdirSync(join(root, ".imm/state/batches"), { recursive: true });
		writeFileSync(join(root, ".imm/state/batches/batch-1.json"), `${JSON.stringify({ contract: "assurance_kernel/batch_run_state/v1", batch_state: "running" }, null, 2)}\n`);
		commit(root, "legacy evidence and live batch");
		const outcome = await runMigration(root);
		expect(outcome.outcome).toBe("invalid");
		expect(outcome.reason).toMatch(/recoverable batch/);
		expect(existsSync(join(root, ".imm/state/kernel.sqlite"))).toBe(false);
		expect(existsSync(join(root, ".imm/tasks/2026-08-14-005-old-task.json"))).toBe(true);
	});

	it("keeps the legacy authority untouched when affected paths are dirty", async () => {
		const root = tempRoot();
		writeLegacyTerminalPair(root, "2026-08-14-006-old-task");
		// Introduced after the committed baseline: nothing may be imported yet.
		const outcome = await runMigration(root);
		expect(outcome.outcome).toBe("migration_uncommitted");
		// The uncommitted historical bytes stay authoritative: nothing published,
		// and the source is still in place until its evidence is committed.
		expect(existsSync(join(root, ".imm/state/kernel.sqlite"))).toBe(false);
		expect(existsSync(join(root, ".imm/tasks/2026-08-14-006-old-task.json"))).toBe(true);
	});

	it("refuses a retired relocation manifest instead of replaying it", async () => {
		const root = tempRoot();
		writeLegacyTerminalPair(root, "2026-08-14-007-old-task");
		commit(root, "legacy evidence");
		const recordBefore = readFileSync(join(root, ".imm/tasks/2026-08-14-007-old-task.json"));
		const proofBefore = readFileSync(join(root, ".imm/tasks/2026-08-14-007-old-task.backend-claim.json"));
		mkdirSync(join(root, ".imm/state/transactions"), { recursive: true });
		writeFileSync(
			join(root, ".imm/state/transactions/storage-layout-migration.json"),
			`${JSON.stringify({
				contract: "assurance_kernel/storage_layout_migration/v1",
				version: 1,
				entries: [
					{ source: ".imm/tasks/2026-08-14-007-old-task.json", target: ".imm/audit/2026-08-14-007-old-task/task-record.json", sha256: createHash("sha256").update(recordBefore).digest("hex"), size: recordBefore.length },
				],
			}, null, 2)}\n`,
		);
		const outcome = await runMigration(root);
		expect(outcome.outcome).toBe("recovery_required");
		expect(outcome.reason).toMatch(/not replayed/);
		// The retired writer is gone: neither side of the pair moved.
		expect(readFileSync(join(root, ".imm/tasks/2026-08-14-007-old-task.json"))).toEqual(recordBefore);
		expect(readFileSync(join(root, ".imm/tasks/2026-08-14-007-old-task.backend-claim.json"))).toEqual(proofBefore);
		expect(existsSync(join(root, ".imm/audit/2026-08-14-007-old-task"))).toBe(false);
		expect(existsSync(join(root, ".imm/state/transactions/storage-layout-migration.json"))).toBe(true);
	});

	it("rejects case-colliding legacy task ids before writing evidence", async () => {
		const probe = mkdtempSync(join(tmpdir(), "imm-casefold-probe-"));
		try {
			writeFileSync(join(probe, "Probe"), "a");
			try {
				writeFileSync(join(probe, "probe"), "b");
				if (readFileSync(join(probe, "Probe"), "utf8") === "b") return;
			} catch {
				return;
			}
			const root = tempRoot();
			writeLegacyTerminalPair(root, "Foo");
			writeLegacyTerminalPair(root, "foo");
			commit(root, "two case variants");
			const outcome = await runMigration(root);
			expect(outcome.outcome).toBe("invalid");
			expect(outcome.reason).toMatch(/case-fold source collision/);
			expect(existsSync(join(root, ".imm/audit"))).toBe(false);
			expect(existsSync(join(root, ".imm/state/kernel.sqlite"))).toBe(false);
		} finally {
			rmSync(probe, { recursive: true, force: true });
		}
	});

	it("refuses an existing audit target with zero writes", async () => {
		const root = tempRoot();
		writeLegacyTerminalPair(root, "task-001");
		mkdirSync(join(root, ".imm/audit/task-001"), { recursive: true });
		const existing = "{\"contract\":\"assurance_kernel/task_record/v3\",\"task_id\":\"task-001\",\"lifecycle\":\"done\"}\n";
		writeFileSync(join(root, ".imm/audit/task-001/task-record.json"), existing);
		commit(root, "legacy + conflicting target");
		const outcome = await runMigration(root);
		expect(outcome.outcome).toBe("invalid");
		expect(outcome.reason).toMatch(/different bytes/);
		expect(readFileSync(join(root, ".imm/audit/task-001/task-record.json"), "utf8")).toBe(existing);
		expect(existsSync(join(root, ".imm/tasks/task-001.json"))).toBe(true);
		expect(existsSync(join(root, ".imm/state/kernel.sqlite"))).toBe(false);
	});
});

describe("inspectStorageLayout new-layout root safety (review round 10)", () => {
	it("reports invalid when .imm/state is a symlink outside the repository", () => {
		const root = tempRoot();
		mkdirSync(join(root, ".imm"), { recursive: true });
		const outside = mkdtempSync(join(tmpdir(), "imm-outside-"));
		try {
			execFileSync("ln", ["-s", outside, join(root, ".imm", "state")]);
			const inspection = inspectStorageLayout(root);
			expect(inspection.layout).toBe("invalid");
			expect(inspection.reason).toContain("state");
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	});

	it("reports invalid when .imm/audit is a symlink outside the repository", () => {
		const root = tempRoot();
		mkdirSync(join(root, ".imm"), { recursive: true });
		const outside = mkdtempSync(join(tmpdir(), "imm-outside-"));
		try {
			execFileSync("ln", ["-s", outside, join(root, ".imm", "audit")]);
			const inspection = inspectStorageLayout(root);
			expect(inspection.layout).toBe("invalid");
			expect(inspection.reason).toContain("audit");
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	});
});
