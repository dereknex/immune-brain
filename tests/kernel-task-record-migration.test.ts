import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalIntentHash } from "../plugins/immune-brain/runtime/kernel/intent";
import { migrateActiveTaskRecord, readHistoricalTaskRecordV2Raw } from "../plugins/immune-brain/runtime/kernel/storage";

const roots: string[] = [];
const TASK = "migrate-active-task";
const intent = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: TASK,
	goal: "migrate one active record",
	acceptance: [{ id: "A1", assertion: "migrated", verification: "verify" }],
	scope_hint: ["src"],
	risk: "routine",
	revision: 1,
	owner: "user",
} as const;
const intentHash = canonicalIntentHash(intent);

function rootWithLegacy(
	phase: "working" | "review" | "done" = "working",
	layout: "active" | "frozen" = phase === "review" ? "frozen" : "active",
) {
	const root = mkdtempSync(join(tmpdir(), "task-record-migration-"));
	roots.push(root);
	mkdirSync(join(root, ".imm", "tasks"), { recursive: true });
	mkdirSync(join(root, "docs", "plans", "archive"), { recursive: true });
	const intentPath = layout === "frozen"
		? `docs/plans/archive/${TASK}.intent.json`
		: `docs/plans/${TASK}.intent.json`;
	writeFileSync(join(root, intentPath), `${JSON.stringify(intent, null, 2)}\n`);
	execFileSync("git", ["init", "-q"], { cwd: root });
	execFileSync("git", ["add", "--", intentPath], { cwd: root });
	execFileSync(
		"git",
		["-c", "user.name=Migration Test", "-c", "user.email=migration@example.invalid", "commit", "-qm", "intent"],
		{ cwd: root },
	);
	writeFileSync(join(root, ".imm", "workspace.json"), `${JSON.stringify({
		contract: "assurance_kernel/workspace/v1",
		current_working: phase === "working" ? TASK : null,
	}, null, 2)}\n`);
	writeFileSync(join(root, ".imm", "tasks", `${TASK}.json`), `${JSON.stringify({
		contract: "assurance_kernel/task_record/v2",
		task_id: TASK,
		intent_revision: 1,
		intent_snapshot: intent,
		intent_ref: { path: intentPath, revision: 1, content_hash: intentHash },
		phase,
		...(layout === "frozen" ? { artifact_ref: { state: "frozen" } } : {}),
		baseline: `sha256:${"0".repeat(64)}`,
		evidence: [],
		findings: [],
		approvals: [],
		history: [],
	}, null, 2)}\n`);
	if (phase === "working" || phase === "review") writeFileSync(join(root, ".imm", "tasks", ".backend-claim.json"), `${JSON.stringify({
		contract: "assurance_kernel/backend_claim/v2",
		backend: "kernel",
		task_id: TASK,
		intent_revision: 1,
		intent_content_hash: intentHash,
		enrollment_event_id: "enroll-1",
		lifecycle_status: "active",
		created_at: "2026-08-12T00:00:00.000Z",
		updated_at: "2026-08-12T00:00:00.000Z",
	}, null, 2)}\n`);
	return root;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("one-time active TaskRecord migration", () => {
	test("atomically replaces an exactly owned active v2 record with v3", () => {
		const root = rootWithLegacy();
		const migrated = migrateActiveTaskRecord(root, TASK);
		expect(migrated.migrated).toBe(true);
		expect(migrated.record).toMatchObject({
			contract: "assurance_kernel/task_record/v3",
			lifecycle: "active",
			artifact_state: "active",
			attestations: [],
		});
		expect(migrated.record).not.toHaveProperty("intent_revision");
		expect(migrated.record.intent_ref).not.toHaveProperty("revision");

		const replay = migrateActiveTaskRecord(root, TASK);
		expect(replay.migrated).toBe(false);
		expect(replay.revision).toBe(migrated.revision);
	});

	test("preserves a real frozen v2 review sidecar and released workspace", () => {
		const root = rootWithLegacy("review", "frozen");
		const migrated = migrateActiveTaskRecord(root, TASK);
		expect(migrated.migrated).toBe(true);
		expect(migrated.record).toMatchObject({
			contract: "assurance_kernel/task_record/v3",
			lifecycle: "active",
			artifact_state: "frozen",
			intent_ref: { path: `docs/plans/archive/${TASK}.intent.json` },
		});
		expect(existsSync(join(root, "docs", "plans", "archive", `${TASK}.intent.json`))).toBe(true);
		expect(existsSync(join(root, "docs", "plans", `${TASK}.intent.json`))).toBe(false);
		expect(JSON.parse(readFileSync(join(root, ".imm", "workspace.json"), "utf8")).current_working).toBeNull();
	});

	test("returns a pre-freeze v2 review sidecar to active v3 ownership", () => {
		const root = rootWithLegacy("review", "active");
		const migrated = migrateActiveTaskRecord(root, TASK);
		expect(migrated.record).toMatchObject({
			artifact_state: "active",
			intent_ref: { path: `docs/plans/${TASK}.intent.json` },
		});
		expect(JSON.parse(readFileSync(join(root, ".imm", "workspace.json"), "utf8")).current_working).toBe(TASK);
	});

	test("releases old working ownership when its sidecar was already frozen", () => {
		const root = rootWithLegacy("working", "frozen");
		const migrated = migrateActiveTaskRecord(root, TASK);
		expect(migrated.record.artifact_state).toBe("frozen");
		expect(JSON.parse(readFileSync(join(root, ".imm", "workspace.json"), "utf8")).current_working).toBeNull();
	});

	test("fails closed when active and archived sidecars conflict", () => {
		const root = rootWithLegacy("review", "frozen");
		writeFileSync(join(root, "docs", "plans", `${TASK}.intent.json`), `${JSON.stringify(intent, null, 2)}\n`);
		expect(() => migrateActiveTaskRecord(root, TASK)).toThrow(/exactly one active or archived TaskIntent sidecar/);
	});

	test("fails closed when the only sidecar is missing or drifted", () => {
		const missingRoot = rootWithLegacy();
		rmSync(join(missingRoot, "docs", "plans", `${TASK}.intent.json`));
		expect(() => migrateActiveTaskRecord(missingRoot, TASK)).toThrow(/exactly one active or archived TaskIntent sidecar/);

		const driftedRoot = rootWithLegacy();
		writeFileSync(
			join(driftedRoot, "docs", "plans", `${TASK}.intent.json`),
			`${JSON.stringify({ ...intent, goal: "drifted" }, null, 2)}\n`,
		);
		expect(() => migrateActiveTaskRecord(driftedRoot, TASK)).toThrow(/intent identities are inconsistent/);
	});

	test("fails closed when active ownership facts do not match", () => {
		const root = rootWithLegacy();
		writeFileSync(join(root, ".imm", "workspace.json"), `${JSON.stringify({
			contract: "assurance_kernel/workspace/v1",
			current_working: "other-task",
		}, null, 2)}\n`);
		expect(() => migrateActiveTaskRecord(root, TASK)).toThrow(/ownership facts are inconsistent/);
		expect(JSON.parse(readFileSync(join(root, ".imm", "tasks", `${TASK}.json`), "utf8")).contract).toBe("assurance_kernel/task_record/v2");
	});

	test("terminal v2 records remain historical and immutable", () => {
		const root = rootWithLegacy("done");
		expect(() => migrateActiveTaskRecord(root, TASK)).toThrow(/historical and cannot be migrated/);
		expect(readHistoricalTaskRecordV2Raw(root, TASK).record?.phase).toBe("done");
	});
});
