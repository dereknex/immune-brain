import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	readBackendClaim,
	readTaskTombstone,
	assertNoKernelBackendForV3,
	parseTaskTombstone,
	type BackendClaim,
	type TaskTombstone,
} from "../plugins/immune-brain/runtime/kernel/backend_claim";

function makeRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "p2b0-claim-"));
	mkdirSync(join(root, ".imm/state"), { recursive: true });
	mkdirSync(join(root, ".imm/audit/task-001"), { recursive: true });
	mkdirSync(join(root, ".imm/audit/task-other"), { recursive: true });
	return root;
}

const CLAIM_PATH = ".imm/state/active-claim.json";

function claim(overrides: Partial<BackendClaim> = {}): BackendClaim {
	return {
		contract: "assurance_kernel/backend_claim/v2",
		backend: "kernel",
		task_id: "task-001",
		intent_revision: 1,
		intent_content_hash: "sha256:intent",
		enrollment_event_id: "evt-1",
		lifecycle_status: "active",
		created_at: "2026-08-12T00:00:00.000Z",
		updated_at: "2026-08-12T00:00:00.000Z",
		...overrides,
	};
}

function tombstone(overrides: Partial<TaskTombstone> = {}): TaskTombstone {
	return {
		contract: "assurance_kernel/task_tombstone/v2",
		task_id: "task-001",
		lifecycle_status: "terminal",
		terminal_lifecycle: "done",
		terminal_event_id: "complete:task-001:2026-08-12T00:00:00.000Z",
		final_record_hash: "sha256:" + "a".repeat(64),
		terminalized_at: "2026-08-12T00:00:00.000Z",
		...overrides,
	};
}

describe("backend claim guard", () => {
	test("absent claim allows v3 managed mutation", () => {
		const root = makeRoot();
		expect(() => assertNoKernelBackendForV3(root, "any-task")).not.toThrow();
	});

	test("active claim rejects v3 mutation for the owned task", () => {
		const root = makeRoot();
		writeFileSync(join(root, CLAIM_PATH), `${JSON.stringify(claim(), null, 2)}\n`);
		expect(() => assertNoKernelBackendForV3(root, "task-001")).toThrow(/backend-owned|kernel backend/i);
	});

	test("active claim rejects v3 mutation for any other task", () => {
		const root = makeRoot();
		writeFileSync(join(root, CLAIM_PATH), `${JSON.stringify(claim(), null, 2)}\n`);
		expect(() => assertNoKernelBackendForV3(root, "task-other")).toThrow(/backend-owned|kernel backend/i);
	});

	test("draining claim rejects v3 mutation", () => {
		const root = makeRoot();
		writeFileSync(join(root, CLAIM_PATH), `${JSON.stringify(claim({ lifecycle_status: "draining" }), null, 2)}\n`);
		expect(() => assertNoKernelBackendForV3(root, "task-001")).toThrow(/backend-owned|kernel backend/i);
	});

	test("workspace claim rejects terminal lifecycle_status; terminal lives in the tombstone", () => {
		const root = makeRoot();
		writeFileSync(join(root, CLAIM_PATH), `${JSON.stringify(claim({ lifecycle_status: "terminal" }), null, 2)}\n`);
		// A legacy fixture-shaped global terminal claim is malformed and fails
		// closed; it is never silently upgraded to a tombstone.
		expect(() => readBackendClaim(root)).toThrow(/active or draining/i);
		expect(() => assertNoKernelBackendForV3(root, "task-001")).toThrow();
	});

	test("terminal tombstone alone does not block v3 routing for any task", () => {
		const root = makeRoot();
		writeFileSync(
			join(root, ".imm/audit/task-001/terminal-proof.json"),
			`${JSON.stringify(tombstone(), null, 2)}\n`,
		);
		// No workspace-active claim remains; v3 routing is released.
		expect(() => assertNoKernelBackendForV3(root, "task-001")).not.toThrow();
		const read = readTaskTombstone(root, "task-001");
		expect(read?.terminal_lifecycle).toBe("done");
	});

	test("malformed claim fails closed", () => {
		const root = makeRoot();
		writeFileSync(join(root, CLAIM_PATH), `{"contract":"assurance_kernel/backend_claim/v2","backend":"v3"}\n`);
		expect(() => assertNoKernelBackendForV3(root, "task-001")).toThrow();
	});

	test("tombstone round-trip and fail-closed parsing", () => {
		const root = makeRoot();
		expect(readTaskTombstone(root, "task-001")).toBeNull();
		writeFileSync(
			join(root, ".imm/audit/task-001/terminal-proof.json"),
			`${JSON.stringify(tombstone(), null, 2)}\n`,
		);
		const read = readTaskTombstone(root, "task-001");
		expect(read?.task_id).toBe("task-001");
		expect(read?.lifecycle_status).toBe("terminal");
		// identity inconsistency fails closed
		writeFileSync(
			join(root, ".imm/audit/task-001/terminal-proof.json"),
			`${JSON.stringify(tombstone({ task_id: "task-other" }), null, 2)}\n`,
		);
		expect(() => readTaskTombstone(root, "task-001")).toThrow(/identity is inconsistent/i);
		// malformed lifecycle fails closed
		expect(() =>
			parseTaskTombstone(tombstone({ terminal_lifecycle: "active" as never }) as unknown as Record<string, unknown>),
		).toThrow(/done or stopped/i);
		// wrong contract fails closed
		expect(() =>
			parseTaskTombstone({ ...tombstone(), contract: "assurance_kernel/backend_claim/v2" } as unknown as Record<string, unknown>),
		).toThrow(/tombstone contract/i);
	});

	test("legacy v1 tombstones remain read-only and normalize to v2", () => {
		const { terminal_lifecycle: _terminalLifecycle, ...current } = tombstone();
		const parsed = parseTaskTombstone({
			...current,
			contract: "assurance_kernel/task_tombstone/v1",
			terminal_phase: "done",
		} as unknown as Record<string, unknown>);
		expect(parsed).toMatchObject({
			contract: "assurance_kernel/task_tombstone/v2",
			terminal_lifecycle: "done",
		});
	});

	test("tombstone with bad hash or lifecycle fails closed", () => {
		expect(() =>
			parseTaskTombstone(tombstone({ final_record_hash: "not-a-hash" }) as unknown as Record<string, unknown>),
		).toThrow(/canonical sha256/i);
		expect(() =>
			parseTaskTombstone(tombstone({ lifecycle_status: "active" }) as unknown as Record<string, unknown>),
		).toThrow(/must be terminal/i);
	});

	test("symlinked tombstone fails closed", () => {
		const root = makeRoot();
		// A directory entry that is a symlink is not a regular file.
		const { symlinkSync } = require("node:fs") as typeof import("node:fs");
		const target = join(root, ".imm/audit/task-other/terminal-proof.json");
		writeFileSync(target, `${JSON.stringify(tombstone(), null, 2)}\n`);
		try {
			symlinkSync(target, join(root, ".imm/audit/task-001/terminal-proof.json"));
		} catch {
			// platform without symlink support: fall back to non-regular file
			rmSync(target);
			mkdirSync(join(root, ".imm/audit/task-001/terminal-proof.json"));
		}
		expect(() => readTaskTombstone(root, "task-001")).toThrow(/symlink|regular file/i);
	});
});
