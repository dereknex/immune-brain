import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	realpathSync,
	readFileSync,
	renameSync,
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

/**
 * Write the v4 file-store pair: the record contract the retired store actually
 * wrote, with the Enrollment base commit. `compact` reproduces historical bytes
 * whose formatting is not the canonical pretty-print.
 */
function writeLegacyV4Pair(root: string, taskId: string, baseHead: string, compact = false): void {
	mkdirSync(join(root, ".imm/state/tasks"), { recursive: true });
	const intent = legacyIntent(taskId);
	const record = {
		contract: "assurance_kernel/task_record/v4",
		task_id: taskId,
		intent_snapshot: intent,
		intent_ref: {
			path: `docs/plans/${taskId}.intent.json`,
			content_hash: canonicalIntentHash(parseTaskIntentV1(intent)),
		},
		lifecycle: "done",
		artifact_state: "frozen",
		git_base_head: baseHead,
		baseline: "sha256:" + "0".repeat(64),
		attestations: [],
		findings: [],
		history: [],
	};
	const recordBytes = `${compact ? JSON.stringify(record) : JSON.stringify(record, null, 2)}\n`;
	writeFileSync(join(root, ".imm/state/tasks", `${taskId}.json`), recordBytes);
	const proof = {
		contract: "assurance_kernel/task_tombstone/v2",
		task_id: taskId,
		lifecycle_status: "terminal",
		terminal_lifecycle: "done",
		terminal_event_id: `stop-${taskId}`,
		final_record_hash: `sha256:${createHash("sha256").update(recordBytes).digest("hex")}`,
		terminalized_at: "2026-08-26T00:00:00.000Z",
	};
	mkdirSync(join(root, ".imm/audit", taskId), { recursive: true });
	writeFileSync(join(root, ".imm/audit", taskId, "terminal-proof.json"), `${JSON.stringify(proof, null, 2)}\n`);
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

	it("imports the retired v4 file store under .imm/state/tasks and retires it", async () => {
		const root = tempRoot();
		// The layout this release retires: records under .imm/state/tasks with the
		// terminal proof already kept as tracked audit evidence.
		writeLegacyTerminalPair(root, "2026-08-14-008-old-task");
		mkdirSync(join(root, ".imm/state/tasks"), { recursive: true });
		mkdirSync(join(root, ".imm/audit/2026-08-14-008-old-task"), { recursive: true });
		renameSync(join(root, ".imm/tasks/2026-08-14-008-old-task.json"), join(root, ".imm/state/tasks/2026-08-14-008-old-task.json"));
		renameSync(
			join(root, ".imm/tasks/2026-08-14-008-old-task.backend-claim.json"),
			join(root, ".imm/audit/2026-08-14-008-old-task/terminal-proof.json"),
		);
		rmSync(join(root, ".imm/tasks"), { recursive: true, force: true });
		writeFileSync(join(root, ".imm/state/workspace.json"), `${JSON.stringify({ contract: "assurance_kernel/workspace/v1", current_working: null }, null, 2)}\n`);
		commit(root, "retired file store layout");
		expect(inspectStorageLayout(root).layout).toBe("migration_required");

		expect((await runMigration(root)).outcome).toBe("migration_uncommitted");
		commit(root, "preserve evidence");
		const outcome = await runMigration(root);
		expect(outcome).toMatchObject({ outcome: "migrated" });
		expect(existsSync(join(root, ".imm/state/tasks/2026-08-14-008-old-task.json"))).toBe(false);
		expect(existsSync(join(root, ".imm/state/workspace.json"))).toBe(false);
		// The proof is preserved evidence, not retired authority.
		expect(existsSync(join(root, ".imm/audit/2026-08-14-008-old-task/terminal-proof.json"))).toBe(true);
		const { openKernelStore } = await import("../plugins/immune-brain/runtime/kernel/sqlite_store");
		const db = openKernelStore(root, { create: false });
		expect(db!.prepare("SELECT task_id, state FROM runs").get()).toMatchObject({ task_id: "2026-08-14-008-old-task", state: "done" });
		db!.close();
	});

	it("imports two tasks whose ids sort differently in SQLite and in the locale", async () => {
		const root = tempRoot();
		writeLegacyTerminalPair(root, "Z-task");
		writeLegacyTerminalPair(root, "a-task");
		commit(root, "two tasks");
		expect((await runMigration(root)).outcome).toBe("migration_uncommitted");
		commit(root, "preserve evidence");
		const outcome = await runMigration(root);
		expect(outcome).toMatchObject({ outcome: "migrated" });
		expect(outcome.reason).toMatch(/imported 2 terminal task/);
	});

	it("refuses a symlinked audit subdirectory without writing outside the worktree", async () => {
		const root = tempRoot();
		writeLegacyTerminalPair(root, "task-linked");
		const outside = mkdtempSync(join(tmpdir(), "imm-outside-audit-"));
		try {
			mkdirSync(join(root, ".imm/audit"), { recursive: true });
			execFileSync("ln", ["-s", outside, join(root, ".imm/audit/task-linked")]);
			commit(root, "legacy + linked audit dir");
			const outcome = await runMigration(root);
			expect(outcome.outcome).toBe("invalid");
			expect(outcome.reason).toMatch(/symlinked evidence path/);
			expect(readdirSync(outside)).toEqual([]);
			expect(existsSync(join(root, ".imm/state/kernel.sqlite"))).toBe(false);
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	});

	it("finishes the cleanup when a crash published the store before removing the source", async () => {
		const root = tempRoot();
		writeLegacyTerminalPair(root, "2026-08-14-009-old-task");
		commit(root, "legacy evidence");
		expect((await runMigration(root)).outcome).toBe("migration_uncommitted");
		commit(root, "preserve evidence");
		expect((await runMigration(root)).outcome).toBe("migrated");
		// Reproduce the crash window: publication and receipt happened, the legacy
		// source was not removed yet.
		const recordBytes = readFileSync(join(root, ".imm/audit/2026-08-14-009-old-task/task-record.json"));
		const proofBytes = readFileSync(join(root, ".imm/audit/2026-08-14-009-old-task/terminal-proof.json"));
		mkdirSync(join(root, ".imm/tasks"), { recursive: true });
		writeFileSync(join(root, ".imm/tasks/2026-08-14-009-old-task.json"), recordBytes);
		writeFileSync(join(root, ".imm/tasks/2026-08-14-009-old-task.backend-claim.json"), proofBytes);
		const finished = await runMigration(root);
		expect(finished).toMatchObject({ outcome: "already_migrated" });
		expect(finished.reason).toMatch(/finished the interrupted cleanup/);
		expect(existsSync(join(root, ".imm/tasks/2026-08-14-009-old-task.json"))).toBe(false);
		expect(existsSync(join(root, ".imm/state/kernel.sqlite"))).toBe(true);
	});

	it("refuses a candidate store built for another worktree", async () => {
		const other = tempRoot();
		writeLegacyTerminalPair(other, "2026-08-14-010-old-task");
		commit(other, "legacy evidence");
		expect((await runMigration(other)).outcome).toBe("migration_uncommitted");
		commit(other, "preserve evidence");
		expect((await runMigration(other)).outcome).toBe("migrated");
		const foreignStore = readFileSync(join(other, ".imm/state/kernel.sqlite"));

		const root = tempRoot();
		writeLegacyTerminalPair(root, "2026-08-14-010-old-task");
		commit(root, "legacy evidence");
		expect((await runMigration(root)).outcome).toBe("migration_uncommitted");
		commit(root, "preserve evidence");
		// The candidate is a complete store with the same rows, but it belongs to
		// the other worktree's binding.
		mkdirSync(join(root, ".imm/state"), { recursive: true });
		writeFileSync(join(root, ".imm/state/kernel.sqlite.importing"), foreignStore);
		const outcome = await runMigration(root);
		expect(outcome.outcome).toBe("invalid");
		expect(outcome.reason).toMatch(/different worktree/);
		expect(existsSync(join(root, ".imm/state/kernel.sqlite"))).toBe(false);
		expect(existsSync(join(root, ".imm/tasks/2026-08-14-010-old-task.json"))).toBe(true);
	});

	it("imports a terminal v4 TaskRecord from the retired file store", async () => {
		const root = tempRoot();
		const baseHead = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
		writeLegacyV4Pair(root, "2026-08-14-011-old-task", baseHead);
		commit(root, "v4 record");
		expect((await runMigration(root)).outcome).toBe("migration_uncommitted");
		commit(root, "preserve evidence");
		const outcome = await runMigration(root);
		expect(outcome).toMatchObject({ outcome: "migrated" });
		const { openKernelStore } = await import("../plugins/immune-brain/runtime/kernel/sqlite_store");
		const db = openKernelStore(root, { create: false });
		expect(db!.prepare("SELECT task_id, state FROM runs").get()).toMatchObject({ task_id: "2026-08-14-011-old-task", state: "done" });
		db!.close();
	});

	it("keeps the historical record bytes the terminal proof binds", async () => {
		const root = tempRoot();
		const baseHead = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
		// Compact JSON: not the canonical pretty-print, and exactly what the proof
		// hashes, so the import must not re-serialize it.
		writeLegacyV4Pair(root, "2026-08-14-012-old-task", baseHead, true);
		const rawBytes = readFileSync(join(root, ".imm/state/tasks/2026-08-14-012-old-task.json"));
		const proof = JSON.parse(readFileSync(join(root, ".imm/audit/2026-08-14-012-old-task/terminal-proof.json"), "utf8")) as { final_record_hash: string };
		commit(root, "compact record");
		expect((await runMigration(root)).outcome).toBe("migration_uncommitted");
		commit(root, "preserve evidence");
		expect((await runMigration(root)).outcome).toBe("migrated");

		const { openKernelStore } = await import("../plugins/immune-brain/runtime/kernel/sqlite_store");
		const db = openKernelStore(root, { create: false });
		const row = db!.prepare("SELECT record_json, audit_exported_at FROM runs").get() as Record<string, unknown>;
		expect(String(row.record_json)).toBe(rawBytes.toString("utf8"));
		expect(`sha256:${createHash("sha256").update(String(row.record_json)).digest("hex")}`).toBe(proof.final_record_hash);
		// The historical evidence is the export, so no follow-up rewrites it.
		expect(row.audit_exported_at).not.toBeNull();
		db!.close();
	});

	it("finishes a cleanup that stopped between two tasks", async () => {
		const root = tempRoot();
		writeLegacyTerminalPair(root, "2026-08-14-013-old-task");
		writeLegacyTerminalPair(root, "2026-08-14-014-old-task");
		const recordBytes = readFileSync(join(root, ".imm/tasks/2026-08-14-013-old-task.json"));
		const proofBytes = readFileSync(join(root, ".imm/tasks/2026-08-14-013-old-task.backend-claim.json"));
		commit(root, "legacy evidence");
		expect((await runMigration(root)).outcome).toBe("migration_uncommitted");
		commit(root, "preserve evidence");
		expect((await runMigration(root)).outcome).toBe("migrated");
		// Simulate the crash after the first task's files were removed: the
		// remaining subset can never match the original import digest.
		mkdirSync(join(root, ".imm/tasks"), { recursive: true });
		writeFileSync(join(root, ".imm/tasks/2026-08-14-013-old-task.json"), recordBytes);
		writeFileSync(join(root, ".imm/tasks/2026-08-14-013-old-task.backend-claim.json"), proofBytes);
		const finished = await runMigration(root);
		expect(finished).toMatchObject({ outcome: "already_migrated" });
		expect(existsSync(join(root, ".imm/tasks/2026-08-14-013-old-task.json"))).toBe(false);
		expect(existsSync(join(root, ".imm/tasks/2026-08-14-013-old-task.backend-claim.json"))).toBe(false);
	});

	it("migrates through the explicit claimless CLI entry point", async () => {
		const root = tempRoot();
		const baseHead = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
		writeLegacyV4Pair(root, "2026-08-14-015-old-task", baseHead);
		commit(root, "v4 record");
		// Every mutating path stays fail-closed until the layout is migrated.
		const { probeKernelStore } = await import("../plugins/immune-brain/runtime/kernel/storage");
		expect(() => probeKernelStore(root)).toThrow();
		const { runKernelCli } = await import("../plugins/immune-brain/runtime/v4_runtime");
		const first = await runKernelCli(["migrate", "--storage-layout"], root);
		expect(first.returncode).toBe(0);
		expect(JSON.parse(first.stdout)).toMatchObject({
			contract: "assurance_kernel/migration_pending_commit/v1",
			affected_paths: [".imm/audit/2026-08-14-015-old-task/task-record.json"],
		});
		commit(root, "preserve evidence");
		const second = await runKernelCli(["migrate", "--storage-layout"], root);
		expect(second.returncode).toBe(0);
		expect(JSON.parse(second.stdout)).toMatchObject({ contract: "assurance_kernel/migration_completed/v1" });
		expect(existsSync(join(root, ".imm/state/kernel.sqlite"))).toBe(true);
		expect(inspectStorageLayout(root).layout).toBe("ready");
		// The gate is resolved once the layout is the SQLite one.
		expect(() => probeKernelStore(root)).not.toThrow();
	});

	it("refuses to publish while the preserved evidence is not in HEAD", async () => {
		const root = tempRoot();
		const baseHead = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
		writeLegacyV4Pair(root, "2026-08-14-016-old-task", baseHead);
		commit(root, "v4 record");
		// A broad ignore rule hides the evidence from git status, so only a
		// HEAD-content check can tell that it is unprotected.
		writeFileSync(join(root, ".gitignore"), ".imm/audit/\n");
		commit(root, ".gitignore");
		const preserved = await runMigration(root);
		expect(preserved.outcome).toBe("migration_uncommitted");
		expect(preserved.affected_paths).toEqual([".imm/audit/2026-08-14-016-old-task/task-record.json"]);

		// Even with a verified candidate already built, publication stays blocked.
		mkdirSync(join(root, ".imm/state"), { recursive: true });
		writeFileSync(join(root, ".imm/state/kernel.sqlite.importing"), "not a real store");
		const blocked = await runMigration(root);
		expect(blocked.outcome).toBe("migration_uncommitted");
		expect(existsSync(join(root, ".imm/state/tasks/2026-08-14-016-old-task.json"))).toBe(true);
		expect(existsSync(join(root, ".imm/state/kernel.sqlite"))).toBe(false);
	});

	it("cleans an orphan proof left after the last record was removed", async () => {
		const root = tempRoot();
		writeLegacyTerminalPair(root, "2026-08-14-017-old-task");
		commit(root, "legacy evidence");
		expect((await runMigration(root)).outcome).toBe("migration_uncommitted");
		commit(root, "preserve evidence");
		expect((await runMigration(root)).outcome).toBe("migrated");
		// The crash window: the record is gone, its proof is not.
		const proofBytes = readFileSync(join(root, ".imm/audit/2026-08-14-017-old-task/terminal-proof.json"));
		mkdirSync(join(root, ".imm/tasks"), { recursive: true });
		writeFileSync(join(root, ".imm/tasks/2026-08-14-017-old-task.backend-claim.json"), proofBytes);
		const finished = await runMigration(root);
		expect(finished).toMatchObject({ outcome: "already_migrated" });
		expect(existsSync(join(root, ".imm/tasks/2026-08-14-017-old-task.backend-claim.json"))).toBe(false);
		commit(root, "cleanup");
		expect(inspectStorageLayout(root).layout).toBe("ready");
	});

	it("preserves the retired ledger and other artifacts, then retires the layout", async () => {
		const root = tempRoot();
		const baseHead = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
		writeLegacyV4Pair(root, "2026-08-14-018-old-task", baseHead);
		const ledger = `${JSON.stringify({ schema_version: 3, runtime_status: "idle", steps: {} }, null, 2)}\n`;
		const history = "{\"event\":\"one\"}\n";
		const journal = "{\"entry\":\"one\"}\n";
		mkdirSync(join(root, ".imm/memory"), { recursive: true });
		mkdirSync(join(root, ".imm/templates"), { recursive: true });
		writeFileSync(join(root, ".imm", "memory", "current_iteration.json"), ledger);
		writeFileSync(join(root, ".imm", "memory", "current_iteration_history.jsonl"), history);
		writeFileSync(join(root, ".imm", "templates", "iteration-plan-template.md"), "# plan\n");
		writeFileSync(join(root, ".imm", "journal.jsonl"), journal);
		mkdirSync(join(root, ".imm/tasks"), { recursive: true });
		writeFileSync(join(root, ".imm", "tasks", ".workspace.lock"), "");
		commit(root, "full retired layout");

		const first = await runMigration(root);
		expect(first.outcome).toBe("migration_uncommitted");
		expect(first.affected_paths).toContain(".imm/audit/legacy-v3/current_iteration.json");
		expect(first.affected_paths).toContain(".imm/audit/legacy-v3/journal.jsonl");
		commit(root, "preserve evidence");
		const outcome = await runMigration(root);
		expect(outcome).toMatchObject({ outcome: "migrated" });

		// The historical Ledger is readable at the path the legacy audit reads.
		expect(readFileSync(join(root, ".imm/audit/legacy-v3/current_iteration.json"), "utf8")).toBe(ledger);
		expect(readFileSync(join(root, ".imm/audit/legacy-v3/current_iteration_history.jsonl"), "utf8")).toBe(history);
		expect(readFileSync(join(root, ".imm/audit/legacy-v3/journal.jsonl"), "utf8")).toBe(journal);
		// The retired layout is gone, so the worktree is usable again.
		for (const retired of [".imm/memory", ".imm/templates", ".imm/journal.jsonl", ".imm/tasks/.workspace.lock", ".imm/state/tasks"]) {
			expect(existsSync(join(root, retired))).toBe(false);
		}
		expect(inspectStorageLayout(root).layout).toBe("ready");
	});

	it("recovers a post-publication interruption through the CLI", async () => {
		const root = tempRoot();
		writeLegacyTerminalPair(root, "2026-08-14-019-old-task");
		commit(root, "legacy evidence");
		expect((await runMigration(root)).outcome).toBe("migration_uncommitted");
		commit(root, "preserve evidence");
		expect((await runMigration(root)).outcome).toBe("migrated");
		// Publication happened, the source removal did not: the layout now shows
		// both stores, and that state must stay reachable through the command.
		const recordBytes = readFileSync(join(root, ".imm/audit/2026-08-14-019-old-task/task-record.json"));
		const proofBytes = readFileSync(join(root, ".imm/audit/2026-08-14-019-old-task/terminal-proof.json"));
		mkdirSync(join(root, ".imm/tasks"), { recursive: true });
		writeFileSync(join(root, ".imm/tasks/2026-08-14-019-old-task.json"), recordBytes);
		writeFileSync(join(root, ".imm/tasks/2026-08-14-019-old-task.backend-claim.json"), proofBytes);
		commit(root, "restore legacy source");

		const { runKernelCli } = await import("../plugins/immune-brain/runtime/v4_runtime");
		const recovered = await runKernelCli(["migrate", "--storage-layout"], root);
		expect(recovered.returncode).toBe(0);
		expect(JSON.parse(recovered.stdout)).toMatchObject({ contract: "assurance_kernel/migration_completed/v1" });
		expect(existsSync(join(root, ".imm/tasks/2026-08-14-019-old-task.json"))).toBe(false);
	});

	it("rebuilds an unfinished candidate instead of failing forever", async () => {
		const root = tempRoot();
		writeLegacyTerminalPair(root, "2026-08-14-020-old-task");
		commit(root, "legacy evidence");
		expect((await runMigration(root)).outcome).toBe("migration_uncommitted");
		commit(root, "preserve evidence");
		// The crash window: the candidate store file exists with its schema but the
		// run rows were never written.
		const { createMigrationStoreFile } = await import("../plugins/immune-brain/runtime/kernel/sqlite_store");
		mkdirSync(join(root, ".imm/state"), { recursive: true });
		const canonical = realpathSync(root);
		createMigrationStoreFile(canonical, join(canonical, ".imm/state/kernel.sqlite.importing"), new Date(0).toISOString());
		const outcome = await runMigration(root);
		expect(outcome).toMatchObject({ outcome: "migrated" });
		const { openKernelStore } = await import("../plugins/immune-brain/runtime/kernel/sqlite_store");
		const db = openKernelStore(root, { create: false });
		expect(db!.prepare("SELECT COUNT(*) AS n FROM runs").get()).toMatchObject({ n: 1 });
		db!.close();
	});

	it("migrates a retired workspace that holds no task at all", async () => {
		const root = tempRoot();
		mkdirSync(join(root, ".imm/state"), { recursive: true });
		writeFileSync(
			join(root, ".imm/state/workspace.json"),
			`${JSON.stringify({ contract: "assurance_kernel/workspace/v1", current_working: null }, null, 2)}\n`,
		);
		commit(root, "owner-free retired workspace");
		expect(inspectStorageLayout(root).layout).toBe("migration_required");
		const outcome = await runMigration(root);
		expect(outcome).toMatchObject({ outcome: "migrated" });
		expect(existsSync(join(root, ".imm/state/workspace.json"))).toBe(false);
		expect(existsSync(join(root, ".imm/state/kernel.sqlite"))).toBe(true);
		commit(root, "migrated");
		expect(inspectStorageLayout(root).layout).toBe("ready");
	});

	it("migrates an idle Ledger workspace with no task and keeps the ledger readable", async () => {
		const root = tempRoot();
		const ledger = `${JSON.stringify({ schema_version: 3, runtime_status: "idle", steps: {} }, null, 2)}\n`;
		mkdirSync(join(root, ".imm/memory"), { recursive: true });
		writeFileSync(join(root, ".imm/memory/current_iteration.json"), ledger);
		commit(root, "idle ledger");
		expect(inspectStorageLayout(root).layout).toBe("migration_required");
		const first = await runMigration(root);
		expect(first.outcome).toBe("migration_uncommitted");
		expect(first.affected_paths).toEqual([".imm/audit/legacy-v3/current_iteration.json"]);
		commit(root, "preserve ledger");
		expect((await runMigration(root)).outcome).toBe("migrated");
		expect(readFileSync(join(root, ".imm/audit/legacy-v3/current_iteration.json"), "utf8")).toBe(ledger);
		expect(existsSync(join(root, ".imm/memory"))).toBe(false);
		commit(root, "migrated");
		expect(inspectStorageLayout(root).layout).toBe("ready");
	});

	it("refuses to retire through a symlinked artifact directory", async () => {
		const root = tempRoot();
		const ledger = `${JSON.stringify({ schema_version: 3, runtime_status: "idle", steps: {} }, null, 2)}\n`;
		mkdirSync(join(root, ".imm/memory"), { recursive: true });
		writeFileSync(join(root, ".imm/memory/current_iteration.json"), ledger);
		commit(root, "idle ledger");
		expect((await runMigration(root)).outcome).toBe("migration_uncommitted");
		commit(root, "preserve ledger");
		expect((await runMigration(root)).outcome).toBe("migrated");
		// The store and receipt exist; the retired directory is replaced by a link
		// to an outside directory holding a file of the same name.
		const outside = mkdtempSync(join(tmpdir(), "imm-outside-memory-"));
		try {
			writeFileSync(join(outside, "MEMORY.md"), "outside bytes\n");
			rmSync(join(root, ".imm/memory"), { recursive: true, force: true });
			execFileSync("ln", ["-s", outside, join(root, ".imm/memory")]);
			const outcome = await runMigration(root);
			expect(outcome.outcome).toBe("invalid");
			expect(outcome.reason).toMatch(/symlinked evidence path is forbidden/);
			expect(readFileSync(join(outside, "MEMORY.md"), "utf8")).toBe("outside bytes\n");
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	});

	it("refuses to retire historical bytes that changed after the evidence was committed", async () => {
		const root = tempRoot();
		const journal = "{\"entry\":\"one\"}\n";
		mkdirSync(join(root, ".imm"), { recursive: true });
		writeFileSync(join(root, ".imm/journal.jsonl"), journal);
		commit(root, "retired journal");
		expect((await runMigration(root)).outcome).toBe("migration_uncommitted");
		commit(root, "preserve journal");
		expect((await runMigration(root)).outcome).toBe("migrated");
		// The source reappears with different bytes while the store is published.
		writeFileSync(join(root, ".imm/journal.jsonl"), "{\"entry\":\"two\"}\n");
		const outcome = await runMigration(root);
		expect(outcome.outcome).toBe("invalid");
		expect(outcome.reason).toMatch(/differs from its committed evidence/);
		expect(readFileSync(join(root, ".imm/journal.jsonl"), "utf8")).toBe("{\"entry\":\"two\"}\n");
		expect(readFileSync(join(root, ".imm/audit/legacy-v3/journal.jsonl"), "utf8")).toBe(journal);
	});

	it("recognizes candidate sidecars so an interrupted transaction stays migratable", async () => {
		const root = tempRoot();
		writeLegacyTerminalPair(root, "2026-08-14-021-old-task");
		commit(root, "legacy evidence");
		expect((await runMigration(root)).outcome).toBe("migration_uncommitted");
		commit(root, "preserve evidence");
		// A transaction that died mid-import leaves the candidate plus its journal.
		mkdirSync(join(root, ".imm/state"), { recursive: true });
		writeFileSync(join(root, ".imm/state/kernel.sqlite.importing"), "partial");
		writeFileSync(join(root, ".imm/state/kernel.sqlite.importing-journal"), "txn");
		expect(inspectStorageLayout(root).layout).toBe("migration_required");
		const outcome = await runMigration(root);
		expect(outcome).toMatchObject({ outcome: "migrated" });
		expect(existsSync(join(root, ".imm/state/kernel.sqlite"))).toBe(true);
	});

	it("rebuilds a candidate whose schema never committed", async () => {
		const root = tempRoot();
		writeLegacyTerminalPair(root, "2026-08-14-022-old-task");
		commit(root, "legacy evidence");
		expect((await runMigration(root)).outcome).toBe("migration_uncommitted");
		commit(root, "preserve evidence");
		// The crash window: the candidate file exists, the schema never committed.
		mkdirSync(join(root, ".imm/state"), { recursive: true });
		writeFileSync(join(root, ".imm/state/kernel.sqlite.importing"), "");
		const outcome = await runMigration(root);
		expect(outcome).toMatchObject({ outcome: "migrated" });
		const { openKernelStore } = await import("../plugins/immune-brain/runtime/kernel/sqlite_store");
		const db = openKernelStore(root, { create: false });
		expect(db!.prepare("SELECT COUNT(*) AS n FROM runs").get()).toMatchObject({ n: 1 });
		db!.close();
	});

	it("treats every terminal batch state as settled and every live one as blocking", async () => {
		// Two of the four terminal states are enough here: the predicate itself is
		// owned and covered by the batch state module's own tests.
		for (const state of ["completed", "budget_stopped"]) {
			const root = tempRoot();
			writeLegacyTerminalPair(root, "2026-08-14-023-old-task");
			mkdirSync(join(root, ".imm/state/batches"), { recursive: true });
			writeFileSync(
				join(root, ".imm/state/batches/batch-1.json"),
				`${JSON.stringify({ contract: "assurance_kernel/batch_run_state/v1", batch_state: state }, null, 2)}\n`,
			);
			commit(root, "legacy evidence and terminal batch");
			expect((await runMigration(root)).outcome, state).toBe("migration_uncommitted");
			commit(root, "preserve evidence");
			expect((await runMigration(root)).outcome, state).toBe("migrated");
		}
		// A live batch still blocks the import, including from its report file.
		const root = tempRoot();
		writeLegacyTerminalPair(root, "2026-08-14-024-old-task");
		mkdirSync(join(root, ".imm/state/batches"), { recursive: true });
		writeFileSync(
			join(root, ".imm/state/batches/batch-2.json"),
			`${JSON.stringify({ contract: "assurance_kernel/batch_run_state/v1", batch_state: "needs_human" }, null, 2)}\n`,
		);
		commit(root, "legacy evidence and live batch");
		const blocked = await runMigration(root);
		expect(blocked.outcome).toBe("invalid");
		expect(blocked.reason).toMatch(/recoverable batch/);
	});

	it("refuses to retire a live legacy owner that reappeared after the import", async () => {
		const root = tempRoot();
		writeLegacyTerminalPair(root, "2026-08-14-025-old-task");
		commit(root, "legacy evidence");
		expect((await runMigration(root)).outcome).toBe("migration_uncommitted");
		commit(root, "preserve evidence");
		expect((await runMigration(root)).outcome).toBe("migrated");
		// A live owner reappears beside the published store: the claim and the
		// workspace owner must survive the cleanup attempt.
		mkdirSync(join(root, ".imm/state"), { recursive: true });
		writeFileSync(join(root, ".imm/state/active-claim.json"), `${JSON.stringify({ contract: "assurance_kernel/backend_claim/v2", task_id: "task-live" })}\n`);
		writeFileSync(join(root, ".imm/workspace.json"), `${JSON.stringify({ contract: "assurance_kernel/workspace/v1", current_working: "task-live" })}\n`);
		const outcome = await runMigration(root);
		expect(outcome.outcome).toBe("invalid");
		expect(outcome.reason).toMatch(/live legacy owner/);
		expect(existsSync(join(root, ".imm/state/active-claim.json"))).toBe(true);
		expect(existsSync(join(root, ".imm/workspace.json"))).toBe(true);
	});

	it("refuses a legacy record whose file name and declared identity disagree", async () => {
		const root = tempRoot();
		writeLegacyTerminalPair(root, "task-owner");
		// The record is internally consistent about being `task-other` (including
		// its own intent hash), but it sits in `task-owner.json` with a proof that
		// belongs to the file name.
		const recordPath = join(root, ".imm/tasks/task-owner.json");
		const renamed = JSON.parse(readFileSync(recordPath, "utf8")) as Record<string, any>;
		renamed.task_id = "task-other";
		renamed.intent_snapshot.task_id = "task-other";
		renamed.intent_ref.path = "docs/plans/task-other.intent.json";
		renamed.intent_ref.content_hash = canonicalIntentHash(parseTaskIntentV1(renamed.intent_snapshot));
		const recordBytes = `${JSON.stringify(renamed, null, 2)}\n`;
		writeFileSync(recordPath, recordBytes);
		const proofPath = join(root, ".imm/tasks/task-owner.backend-claim.json");
		const proof = JSON.parse(readFileSync(proofPath, "utf8")) as Record<string, unknown>;
		proof.final_record_hash = `sha256:${createHash("sha256").update(recordBytes).digest("hex")}`;
		writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
		commit(root, "identity mismatch");
		const outcome = await runMigration(root);
		expect(outcome.outcome).toBe("invalid");
		expect(outcome.reason).toMatch(/declares a different task identity/);
		expect(existsSync(join(root, ".imm/state/kernel.sqlite"))).toBe(false);
		expect(existsSync(join(root, ".imm/tasks/task-owner.json"))).toBe(true);
	});

	it("refuses to retire a legacy transaction marker the prior runtime must settle", async () => {
		const root = tempRoot();
		writeLegacyTerminalPair(root, "2026-08-14-026-old-task");
		commit(root, "legacy evidence");
		expect((await runMigration(root)).outcome).toBe("migration_uncommitted");
		commit(root, "preserve evidence");
		expect((await runMigration(root)).outcome).toBe("migrated");
		// The prior runtime left an unfinished transaction behind.
		mkdirSync(join(root, ".imm/tasks"), { recursive: true });
		writeFileSync(join(root, ".imm/tasks/.terminal-transaction.json"), "{\"contract\":\"assurance_kernel/terminal_transaction/v1\"}\n");
		const outcome = await runMigration(root);
		expect(outcome.outcome).toBe("invalid");
		expect(outcome.reason).toMatch(/legacy transaction marker/);
		expect(existsSync(join(root, ".imm/tasks/.terminal-transaction.json"))).toBe(true);
	});

	it("restores the store identity marker on the recovery path", async () => {
		const root = tempRoot();
		writeLegacyTerminalPair(root, "2026-08-14-027-old-task");
		commit(root, "legacy evidence");
		expect((await runMigration(root)).outcome).toBe("migration_uncommitted");
		commit(root, "preserve evidence");
		expect((await runMigration(root)).outcome).toBe("migrated");
		// A crash between the publication rename and the identity marker.
		rmSync(join(root, ".imm/state/kernel.identity.json"), { force: true });
		const recordBytes = readFileSync(join(root, ".imm/audit/2026-08-14-027-old-task/task-record.json"));
		const proofBytes = readFileSync(join(root, ".imm/audit/2026-08-14-027-old-task/terminal-proof.json"));
		mkdirSync(join(root, ".imm/tasks"), { recursive: true });
		writeFileSync(join(root, ".imm/tasks/2026-08-14-027-old-task.json"), recordBytes);
		writeFileSync(join(root, ".imm/tasks/2026-08-14-027-old-task.backend-claim.json"), proofBytes);
		expect((await runMigration(root)).outcome).toBe("already_migrated");
		expect(existsSync(join(root, ".imm/state/kernel.identity.json"))).toBe(true);
	});

	it("removes an empty retired authority directory so the layout ends up ready", async () => {
		const root = tempRoot();
		mkdirSync(join(root, ".imm/authority"), { recursive: true });
		mkdirSync(join(root, ".imm/state"), { recursive: true });
		writeFileSync(join(root, ".imm/state/workspace.json"), `${JSON.stringify({ contract: "assurance_kernel/workspace/v1", current_working: null })}\n`);
		commit(root, "empty retired authority");
		expect(inspectStorageLayout(root).layout).toBe("migration_required");
		const outcome = await runMigration(root);
		expect(outcome).toMatchObject({ outcome: "migrated" });
		expect(existsSync(join(root, ".imm/authority"))).toBe(false);
		commit(root, "migrated");
		expect(inspectStorageLayout(root).layout).toBe("ready");
	});

	it("refuses a dangling symlink at the evidence target", async () => {
		const root = tempRoot();
		writeLegacyTerminalPair(root, "task-dangling");
		const outside = mkdtempSync(join(tmpdir(), "imm-outside-dangling-"));
		try {
			mkdirSync(join(root, ".imm/audit/task-dangling"), { recursive: true });
			// A link whose target does not exist yet: existsSync reports it absent,
			// so only an lstat walk can see it.
			execFileSync("ln", ["-s", join(outside, "task-record.json"), join(root, ".imm/audit/task-dangling/task-record.json")]);
			commit(root, "legacy + dangling link");
			const outcome = await runMigration(root);
			expect(outcome.outcome).toBe("invalid");
			expect(outcome.reason).toMatch(/symlinked evidence path is forbidden/);
			expect(existsSync(join(outside, "task-record.json"))).toBe(false);
			expect(existsSync(join(root, ".imm/state/kernel.sqlite"))).toBe(false);
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	});

	it("serializes concurrent migrations with an exclusive lock", async () => {
		const root = tempRoot();
		writeLegacyTerminalPair(root, "2026-08-14-028-old-task");
		commit(root, "legacy evidence");
		// A live holder blocks the migration.
		mkdirSync(join(root, ".imm/state"), { recursive: true });
		const lockPath = join(root, ".imm/state/migration.lock");
		writeFileSync(lockPath, `${process.pid}\n`);
		const blocked = await runMigration(root);
		expect(blocked.outcome).toBe("invalid");
		expect(blocked.reason).toMatch(/another storage layout migration is running/);
		expect(existsSync(join(root, ".imm/state/kernel.sqlite"))).toBe(false);

		// An abandoned lock, held by a process that is gone, is reclaimed.
		writeFileSync(lockPath, "999999999\n");
		const recovered = await runMigration(root);
		expect(recovered.outcome).toBe("migration_uncommitted");
		expect(existsSync(lockPath)).toBe(false);
	});

	it("refuses to retire while the retired file store still has a pending transaction marker", async () => {
		const root = tempRoot();
		writeLegacyTerminalPair(root, "2026-08-14-029-old-task");
		commit(root, "legacy evidence");
		expect((await runMigration(root)).outcome).toBe("migration_uncommitted");
		commit(root, "preserve evidence");
		expect((await runMigration(root)).outcome).toBe("migrated");
		mkdirSync(join(root, ".imm/state/transactions"), { recursive: true });
		writeFileSync(join(root, ".imm/state/transactions/terminal-transaction.json"), "{\"contract\":\"assurance_kernel/terminal_transaction/v1\"}\n");
		const outcome = await runMigration(root);
		expect(outcome.outcome).toBe("invalid");
		expect(outcome.reason).toMatch(/legacy transaction marker/);
		expect(existsSync(join(root, ".imm/state/transactions/terminal-transaction.json"))).toBe(true);
	});

	it("refuses recovery cleanup when the committed evidence left HEAD", async () => {
		const root = tempRoot();
		writeLegacyTerminalPair(root, "2026-08-14-030-old-task");
		commit(root, "legacy evidence");
		expect((await runMigration(root)).outcome).toBe("migration_uncommitted");
		commit(root, "preserve evidence");
		expect((await runMigration(root)).outcome).toBe("migrated");
		// The surviving source comes back, but the committed evidence left HEAD.
		const recordBytes = readFileSync(join(root, ".imm/audit/2026-08-14-030-old-task/task-record.json"));
		const proofBytes = readFileSync(join(root, ".imm/audit/2026-08-14-030-old-task/terminal-proof.json"));
		mkdirSync(join(root, ".imm/tasks"), { recursive: true });
		writeFileSync(join(root, ".imm/tasks/2026-08-14-030-old-task.json"), recordBytes);
		writeFileSync(join(root, ".imm/tasks/2026-08-14-030-old-task.backend-claim.json"), proofBytes);
		execFileSync("git", ["-C", root, "rm", "-r", "-q", "--cached", ".imm/audit/2026-08-14-030-old-task"]);
		execFileSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "drop evidence from HEAD"]);
		const outcome = await runMigration(root);
		expect(outcome.outcome).toBe("invalid");
		expect(outcome.reason).toMatch(/committed audit evidence .* is missing/);
		expect(existsSync(join(root, ".imm/tasks/2026-08-14-030-old-task.json"))).toBe(true);
	});

	it("treats an empty lock as held until it is provably abandoned", async () => {
		const root = tempRoot();
		writeLegacyTerminalPair(root, "2026-08-14-031-old-task");
		commit(root, "legacy evidence");
		mkdirSync(join(root, ".imm/state"), { recursive: true });
		const lockPath = join(root, ".imm/state/migration.lock");
		// A creator that created the lock but has not written its pid yet.
		writeFileSync(lockPath, "");
		execFileSync("touch", [lockPath]);
		const blocked = await runMigration(root);
		expect(blocked.outcome).toBe("invalid");
		expect(blocked.reason).toMatch(/another storage layout migration is running/);
		expect(existsSync(join(root, ".imm/state/kernel.sqlite"))).toBe(false);
	});

	it("refuses to retire an orphan proof whose committed evidence is gone", async () => {
		const root = tempRoot();
		writeLegacyTerminalPair(root, "2026-08-14-032-old-task");
		commit(root, "legacy evidence");
		expect((await runMigration(root)).outcome).toBe("migration_uncommitted");
		commit(root, "preserve evidence");
		expect((await runMigration(root)).outcome).toBe("migrated");
		// The cleanup died after removing the record but before its proof, and the
		// committed evidence for that task left HEAD.
		const proofBytes = readFileSync(join(root, ".imm/audit/2026-08-14-032-old-task/terminal-proof.json"));
		mkdirSync(join(root, ".imm/tasks"), { recursive: true });
		writeFileSync(join(root, ".imm/tasks/2026-08-14-032-old-task.backend-claim.json"), proofBytes);
		execFileSync("git", ["-C", root, "rm", "-r", "-q", "--cached", ".imm/audit/2026-08-14-032-old-task"]);
		execFileSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "drop evidence from HEAD"]);
		const outcome = await runMigration(root);
		expect(outcome.outcome).toBe("invalid");
		expect(outcome.reason).toMatch(/committed audit evidence .* is missing/);
		expect(existsSync(join(root, ".imm/tasks/2026-08-14-032-old-task.backend-claim.json"))).toBe(true);
	});

	it("refuses to retire a legacy ledger that is still working", async () => {
		const root = tempRoot();
		const idle = `${JSON.stringify({ schema_version: 3, runtime_status: "idle", steps: {} }, null, 2)}\n`;
		mkdirSync(join(root, ".imm/memory"), { recursive: true });
		writeFileSync(join(root, ".imm/memory/current_iteration.json"), idle);
		commit(root, "idle ledger");
		expect((await runMigration(root)).outcome).toBe("migration_uncommitted");
		commit(root, "preserve ledger");
		expect((await runMigration(root)).outcome).toBe("migrated");
		// A ledger that came back mid-work beside the published store still owns
		// execution, so the cleanup must refuse it.
		mkdirSync(join(root, ".imm/memory"), { recursive: true });
		writeFileSync(
			join(root, ".imm/memory/current_iteration.json"),
			`${JSON.stringify({ schema_version: 3, runtime_status: "working", steps: {} }, null, 2)}\n`,
		);
		const outcome = await runMigration(root);
		expect(outcome.outcome).toBe("invalid");
		expect(outcome.reason).toMatch(/legacy ledger is working/);
		expect(existsSync(join(root, ".imm/memory/current_iteration.json"))).toBe(true);
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
