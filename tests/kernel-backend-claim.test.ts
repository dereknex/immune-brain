import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	readBackendClaim,
	readTaskTombstone,
	assertNoKernelBackendForV3,
	parseBackendClaim,
	parseTaskTombstone,
	type BackendClaim,
	type TaskTombstone,
} from "../plugins/immune-brain/runtime/kernel/backend_claim";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import { seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";

const GUARD_INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: "task-001",
	goal: "claim guard fixture",
	acceptance: [{ id: "A1", assertion: "a1", verification: "bun test tests/x.test.ts" }],
	scope_hint: ["docs/plans"],
	risk: "routine" as const,
	revision: 1,
	owner: "user",
};

/** Seed the workspace claim through the store: the claim is derived, not a file. */
function seedClaim(root: string, claimStatus: "active" | "draining" = "active"): void {
	seedKernelRunForTest(root, {
		task_id: "task-001",
		claim_status: claimStatus,
		record: {
			contract: "assurance_kernel/task_record/v4",
			task_id: "task-001",
			intent_snapshot: GUARD_INTENT,
			intent_ref: {
				path: "docs/plans/task-001.intent.json",
				content_hash: canonicalIntentHash(parseTaskIntentV1(GUARD_INTENT)),
			},
			lifecycle: "active",
			artifact_state: "active",
			baseline: `sha256:${"a".repeat(64)}`,
			git_base_head: "a".repeat(40),
			attestations: [],
			findings: [],
			history: [],
		},
	});
}

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

	test("an active run derives a workspace claim that rejects v3 mutation", () => {
		const root = makeRoot();
		seedClaim(root);
		expect(readBackendClaim(root)?.lifecycle_status).toBe("active");
		expect(() => assertNoKernelBackendForV3(root, "task-001")).toThrow(/backend-owned|kernel backend/i);
		expect(() => assertNoKernelBackendForV3(root, "task-other")).toThrow(/backend-owned|kernel backend/i);
	});

	test("draining claim rejects v3 mutation", () => {
		const root = makeRoot();
		seedClaim(root, "draining");
		expect(readBackendClaim(root)?.lifecycle_status).toBe("draining");
		expect(() => assertNoKernelBackendForV3(root, "task-001")).toThrow(/backend-owned|kernel backend/i);
	});

	test("a settled run leaves no workspace claim and never projects a terminal claim", () => {
		const root = makeRoot();
		seedKernelRunForTest(root, {
			task_id: "task-001",
			terminal: { lifecycle: "done" },
			record: {
				contract: "assurance_kernel/task_record/v4",
				task_id: "task-001",
				intent_snapshot: GUARD_INTENT,
				intent_ref: {
					path: "docs/plans/archive/task-001.intent.json",
					content_hash: canonicalIntentHash(parseTaskIntentV1(GUARD_INTENT)),
				},
				lifecycle: "done",
				artifact_state: "frozen",
				baseline: `sha256:${"a".repeat(64)}`,
				git_base_head: "a".repeat(40),
				attestations: [],
				findings: [],
				history: [],
			},
		});
		// Terminal state lives in the run/tombstone, never in a workspace claim.
		expect(readBackendClaim(root)).toBeNull();
		expect(() => assertNoKernelBackendForV3(root, "task-001")).not.toThrow();
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

	test("malformed claim payloads fail closed in the parser", () => {
		expect(() =>
			parseBackendClaim({ contract: "assurance_kernel/backend_claim/v2", backend: "v3" }),
		).toThrow();
		expect(() =>
			parseBackendClaim({ ...claim(), lifecycle_status: "terminal" } as unknown as Record<string, unknown>),
		).toThrow(/active or draining/i);
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
