import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runKernelCommand } from "../plugins/immune-brain/runtime/commands/kernel";
import { acquireDaemonLock } from "../plugins/immune-brain/runtime/loop_daemon/lock";
import { initLoopState, saveLoopState } from "../plugins/immune-brain/runtime/loop_daemon/state";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import { applyScopeRiskFloor, parseRiskFloor, RISK_FLOOR_DECLARATION_PATH } from "../plugins/immune-brain/runtime/kernel/risk_floor";
import { ROUTINE_CLASSES_DECLARATION_PATH } from "../plugins/immune-brain/runtime/kernel/routine_classes";
import { seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";

const roots: string[] = [];

function tempRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "imm-kernel-inspect-"));
	roots.push(root);
	mkdirSync(join(root, ".imm"), { recursive: true });
	return root;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeClaimedTask(
	root: string,
	taskId: string,
	scope_hint: string[],
	risk: "routine" | "material" = "routine",
	artifactState: "active" | "frozen" = "active",
	declaration?: unknown,
) {
	const intent = {
		contract: "assurance_kernel/task_intent/v1",
		task_id: taskId,
		goal: "Inspect fixture",
		acceptance: [{ id: "A1", assertion: "a1", verification: "v1" }],
		scope_hint,
		risk,
		revision: 1,
		owner: "user",
	};
	// A declared floor is committed with the intent; the recorded hash is the floored intent's.
	if (declaration !== undefined)
		writeFileSync(join(root, RISK_FLOOR_DECLARATION_PATH), `${JSON.stringify(declaration)}\n`);
	const parsed = declaration === undefined
		? parseTaskIntentV1(intent)
		: applyScopeRiskFloor(parseTaskIntentV1(intent), parseRiskFloor(declaration));
	const hash = canonicalIntentHash(parsed);
	const intentPath = artifactState === "frozen"
		? `docs/plans/archive/${taskId}.intent.json`
		: `docs/plans/${taskId}.intent.json`;
	mkdirSync(join(root, "docs/plans", artifactState === "frozen" ? "archive" : ""), { recursive: true });
	writeFileSync(join(root, intentPath), `${JSON.stringify(intent, null, 2)}\n`);
	execFileSync("git", ["init", "-q"], { cwd: root });
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["commit", "-qm", "inspect"], { cwd: root });
	const gitBaseHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
	seedKernelRunForTest(root, {
		task_id: taskId,
		record: {
			contract: "assurance_kernel/task_record/v4",
			task_id: taskId,
			intent_snapshot: parsed,
			intent_ref: { path: intentPath, content_hash: hash },
			lifecycle: "active",
			artifact_state: artifactState,
			baseline: `sha256:${"a".repeat(64)}`,
			git_base_head: gitBaseHead,
			attestations: [],
			findings: [],
			history: [],
		},
	});
	return parsed;
}

describe("imm-kernel inspect", () => {
	it("returns inspect/v1 on an idle workspace with floor prefixes and unobservable stubs", () => {
		const root = tempRoot();
		const result = runKernelCommand(["inspect", "--json"], root);
		expect(result.returncode).toBe(0);
		const output = JSON.parse(result.stdout);
		expect(output.contract).toBe("assurance_kernel/inspect/v1");
		expect(output.layout).toMatchObject({ layout: "ready" });
		expect(output.kernel).toEqual({ claim: null, workspace: { current_working: null } });
		expect(output.assurance).toBeNull();
		expect(output.risk.declared).toBeNull();
		expect(output.risk.resolved).toBeNull();
		expect(output.risk.floor_applied).toBe(false);
		expect(output.risk.matching_scope_entries).toEqual([]);
		// No declaration: only the declarations' own paths are floored.
		expect(output.risk.floor_prefixes).toEqual([RISK_FLOOR_DECLARATION_PATH, ROUTINE_CLASSES_DECLARATION_PATH]);
		expect(output.risk.floor_invalid).toBeNull();
		expect(output.risk.routine_classes).toBeNull();
		expect(output.risk.outside_routine_allowlist).toEqual([]);
		expect(output.loop).toEqual({
			daemon_running: false,
			pid: null,
			lock: null,
			stale_lock: false,
			paused: false,
			pause_reason: null,
			active_leases_count: 0,
			active_leases: [],
			watermarks: null,
			stats: null,
			updated_at: null,
			log_path: join(root, ".imm/state/loop/daemon.log"),
			log_exists: false,
			state_error: null,
		});
		expect(output.unobservable).toEqual({
			capability: "unobservable",
			rehearsal: "unobservable",
			cas_holder: "unobservable",
		});
		// A read-only inspect creates no authority state at all.
		expect(existsSync(join(root, ".imm/state/kernel.sqlite"))).toBe(false);
		expect(existsSync(join(root, ".imm/state/workspace.json"))).toBe(false);
		expect(existsSync(join(root, ".imm/state/journal.jsonl"))).toBe(false);
		expect(existsSync(join(root, ".imm/state/locks"))).toBe(false);
		expect(existsSync(join(root, ".imm/state/loop"))).toBe(false);
	});

	it("rejects missing --json and leaves status --json unchanged", () => {
		const root = tempRoot();
		const missing = runKernelCommand(["inspect"], root);
		expect(missing.returncode).toBe(2);
		expect(JSON.parse(missing.stdout).error.code).toBe("invalid_command");
		expect(existsSync(join(root, ".imm/state/journal.jsonl"))).toBe(false);
		const status = runKernelCommand(["status", "--json"], root);
		expect(status.returncode).toBe(0);
		expect(JSON.parse(status.stdout).contract).toBe("assurance_kernel/status/v1");
		expect(JSON.parse(status.stdout).kernel).toEqual({
			claim: null,
			workspace: { current_working: null },
		});
	});

	it("projects declared vs floored risk for a claimed kernel-scope task", () => {
		const root = tempRoot();
		writeClaimedTask(root, "inspect-floor-hit", ["plugins/immune-brain/runtime/kernel/intent.ts"], "routine", "active", {
			contract: "assurance_kernel/risk_floor/v1",
			material: { paths: ["plugins/immune-brain/runtime/kernel"] },
		});
		const result = runKernelCommand(["inspect", "--json"], root);
		expect(result.returncode).toBe(0);
		const output = JSON.parse(result.stdout);
		expect(output.contract).toBe("assurance_kernel/inspect/v1");
		expect(output.kernel.claim.task_id).toBe("inspect-floor-hit");
		expect(output.assurance.contract).toBe("assurance_kernel/assurance_projection/v1");
		expect(output.assurance.error).toBeNull();
		expect(output.assurance.projection.lifecycle).toBe("active");
		expect(output.risk.declared).toBe("routine");
		expect(output.risk.resolved).toBe("material");
		expect(output.risk.floor_applied).toBe(true);
		expect(output.risk.matching_scope_entries).toEqual(["plugins/immune-brain/runtime/kernel/intent.ts"]);
		expect(output.risk.floor_prefixes).toEqual([RISK_FLOOR_DECLARATION_PATH, ROUTINE_CLASSES_DECLARATION_PATH, "plugins/immune-brain/runtime/kernel"]);
		expect(output.unobservable.capability).toBe("unobservable");
	});

	it("projects a frozen task from the TaskRecord archive path and rejects sidecar drift", () => {
		const root = tempRoot();
		const intent = writeClaimedTask(root, "inspect-frozen", ["docs/specs/example.spec.md"], "routine", "frozen");
		const result = runKernelCommand(["inspect", "--json"], root);
		expect(result.returncode).toBe(0);
		const output = JSON.parse(result.stdout);
		expect(output.assurance.error).toBeNull();
		expect(output.assurance.projection).toMatchObject({
			lifecycle: "active",
			artifact_state: "frozen",
		});

		writeFileSync(
			join(root, "docs/plans/archive/inspect-frozen.intent.json"),
			`${JSON.stringify({ ...intent, goal: "tampered" }, null, 2)}\n`,
		);
		const drifted = runKernelCommand(["inspect", "--json"], root);
		expect(drifted.returncode).toBe(1);
		expect(JSON.parse(drifted.stdout).error).toMatchObject({
			code: "source_read_failed",
			message: "TaskIntent sidecar does not match TaskRecord content hash",
		});
	});

	it("keeps routine risk when scope does not touch the floor", () => {
		const root = tempRoot();
		writeClaimedTask(root, "inspect-floor-miss", ["docs/specs/example.spec.md"]);
		const result = runKernelCommand(["inspect", "--json"], root);
		expect(result.returncode).toBe(0);
		const output = JSON.parse(result.stdout);
		expect(output.risk.declared).toBe("routine");
		expect(output.risk.resolved).toBe("routine");
		expect(output.risk.floor_applied).toBe(false);
		expect(output.risk.matching_scope_entries).toEqual([]);
	});

	it("raises a routine task whose delivery leaves the routine allowlist and names the paths", () => {
		const root = tempRoot();
		writeFileSync(join(root, ROUTINE_CLASSES_DECLARATION_PATH), `${JSON.stringify({
			contract: "assurance_kernel/routine_classes/v1",
			classes: [{ id: "docs-only", paths: ["docs/guide"] }],
		})}\n`);
		// The estimate reaches src, so the scope alone keeps the routine declaration.
		writeClaimedTask(root, "inspect-routine-allowlist", ["docs/guide/intro.md", "src/feature.ts"]);
		mkdirSync(join(root, "docs/guide"), { recursive: true });
		writeFileSync(join(root, "docs/guide/intro.md"), "intro\n");
		execFileSync("git", ["add", "docs/guide"], { cwd: root });
		const inside = JSON.parse(runKernelCommand(["inspect", "--json"], root).stdout);
		expect(inside.risk.routine_classes).toEqual(["docs-only"]);
		expect(inside.risk.resolved).toBe("routine");
		expect(inside.risk.outside_routine_allowlist).toEqual([]);
		expect(inside.assurance.projection.missing_approval_kinds).toEqual(["qa"]);

		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(join(root, "src/feature.ts"), "export {};\n");
		execFileSync("git", ["add", "src"], { cwd: root });
		const outside = JSON.parse(runKernelCommand(["inspect", "--json"], root).stdout);
		expect(outside.risk.declared).toBe("routine");
		expect(outside.risk.resolved).toBe("material");
		expect(outside.risk.floor_applied).toBe(true);
		expect(outside.risk.outside_routine_allowlist).toEqual(["src/feature.ts"]);
		expect(outside.assurance.projection.missing_approval_kinds).toEqual(["qa", "review"]);
	});

	it("does not interpret a retired claim file as authority", () => {
		const root = tempRoot();
		mkdirSync(join(root, ".imm/state"), { recursive: true });
		writeFileSync(
			join(root, ".imm/state/active-claim.json"),
			`${JSON.stringify({
				contract: "assurance_kernel/backend_claim/v2",
				backend: "kernel",
				task_id: "retired-claim-task",
				intent_revision: 1,
				intent_content_hash: "sha256:" + "0".repeat(64),
				enrollment_event_id: "enroll-retired-claim-task",
				lifecycle_status: "active",
				created_at: "2026-08-12T00:00:00.000Z",
				updated_at: "2026-08-12T00:00:00.000Z",
			}, null, 2)}\n`,
		);
		const result = runKernelCommand(["inspect", "--json"], root);
		expect(result.returncode).toBe(0);
		const output = JSON.parse(result.stdout);
		// The retired file store grants nothing: no claim and no owner are
		// derived from it, and the layout asks for the supported migration.
		expect(output.kernel).toEqual({ claim: null, workspace: { current_working: null } });
		expect(output.layout.layout).toBe("migration_blocked_active");
		expect(existsSync(join(root, ".imm/state/journal.jsonl"))).toBe(false);
	});

	it("reflects active loop daemon lock/state and surfaces corrupt loop state.json without failing inspect", () => {
		const root = tempRoot();
		const stateDir = join(root, ".imm/state/loop");
		const lock = acquireDaemonLock(stateDir);
		expect(lock.acquired).toBe(true);
		try {
			const state = initLoopState();
			state.paused = true;
			state.pause_reason = "smoke check";
			state.stats.ticks_total = 3;
			saveLoopState(stateDir, state);
			writeFileSync(join(stateDir, "daemon.log"), "daemon boot\n", { mode: 0o600 });

			const activeRes = runKernelCommand(["inspect", "--json"], root);
			expect(activeRes.returncode).toBe(0);
			const activeOutput = JSON.parse(activeRes.stdout);
			expect(activeOutput.loop).toMatchObject({
				daemon_running: true,
				pid: process.pid,
				stale_lock: false,
				paused: true,
				pause_reason: "smoke check",
				active_leases_count: 0,
				log_exists: true,
				state_error: null,
			});
			expect(activeOutput.loop.stats.ticks_total).toBe(3);
		} finally {
			if (lock.acquired) lock.release();
		}

		writeFileSync(join(stateDir, "state.json"), "{corrupt json\n", { mode: 0o600 });
		const corruptRes = runKernelCommand(["inspect", "--json"], root);
		expect(corruptRes.returncode).toBe(0);
		const corruptOutput = JSON.parse(corruptRes.stdout);
		expect(corruptOutput.loop).toMatchObject({
			daemon_running: false,
			pid: null,
			stale_lock: false,
			state_error: ".imm/state/loop/state.json is corrupt or unreadable",
		});
	});
});
