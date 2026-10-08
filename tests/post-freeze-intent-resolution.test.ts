// Regression guard for the post-freeze TaskIntent settlement path.
//
// Historical freeze layouts relocated the sidecar from `docs/plans/<task-id>.intent.json`
// into `docs/plans/archive/`. A Host adapter that reads the intent at the
// pre-freeze default path can never settle QA after a freeze. The Claude Code
// adapter carried that defect from the day the Host was added; no test covered
// the boundary because every settled task in this repository had run on Pi.

import { afterAll, describe, expect, mock, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { readTaskIntent, parseTaskIntentV1, canonicalIntentHash } from "../plugins/immune-brain/runtime/kernel/intent";
import { readSettledTaskEvidence, readAuditTaskPair, recoverKernelStoreFollowUps } from "../plugins/immune-brain/runtime/kernel/storage";
import { seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";
import { localRunId } from "../plugins/immune-brain/runtime/kernel/storage";
import { insertRunRow, markAuditExported, updateRunTerminal, withKernelTransaction } from "../plugins/immune-brain/runtime/kernel/sqlite_store";
import { inspectSpecBinding } from "../plugins/immune-brain/runtime/kernel/spec_binding";

const TASK_ID = "123-short-goal";
const ACTIVE_PATH = `docs/plans/${TASK_ID}.intent.json`;
const ARCHIVED_PATH = `docs/plans/archive/${TASK_ID}.intent.json`;

const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: TASK_ID,
	goal: "One outcome statement",
	acceptance: [
		{
			id: "A1",
			assertion: "One observable acceptance condition",
			verification: "One deterministic verification description",
		},
	],
	scope_hint: ["path/or/domain"],
	risk: "routine",
	revision: 1,
	owner: "user",
};

function git(root: string, args: string[]): void {
	execFileSync("git", args, { cwd: root, stdio: "pipe" });
}

function makeRepo(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "imm-post-freeze-"));
	git(root, ["init", "-q"]);
	git(root, ["config", "user.email", "test@example.com"]);
	git(root, ["config", "user.name", "Test"]);
	for (const [rel, content] of Object.entries(files)) {
		const target = join(root, rel);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, content);
	}
	git(root, ["add", "-A"]);
	return root;
}

const intentJson = `${JSON.stringify(INTENT, null, 2)}\n`;

describe("post-freeze TaskIntent resolution", () => {
	test("resolves the archived sidecar when the active path is gone", () => {
		const root = makeRepo({ [ARCHIVED_PATH]: intentJson });
		try {
			const read = readTaskIntent(root, TASK_ID);
			expect(read.intent_ref.path).toBe(ARCHIVED_PATH);
			expect(read.intent.task_id).toBe(TASK_ID);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("still resolves the active sidecar before freeze", () => {
		const root = makeRepo({ [ACTIVE_PATH]: intentJson });
		try {
			expect(readTaskIntent(root, TASK_ID).intent_ref.path).toBe(ACTIVE_PATH);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("honours an explicitly requested archived path", () => {
		const root = makeRepo({ [ARCHIVED_PATH]: intentJson });
		try {
			expect(readTaskIntent(root, TASK_ID, ARCHIVED_PATH).intent_ref.path).toBe(ARCHIVED_PATH);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("reports a stable contract failure instead of a raw ENOENT", () => {
		const root = makeRepo({ "docs/plans/.keep": "" });
		try {
			expect(() => readTaskIntent(root, TASK_ID)).toThrow(
				`TaskIntent sidecar is missing at ${ACTIVE_PATH}`,
			);
			expect(() => readTaskIntent(root, TASK_ID, ARCHIVED_PATH)).toThrow(
				`TaskIntent sidecar is missing at ${ARCHIVED_PATH}`,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("the active sidecar wins when both paths exist", () => {
		// A leftover archived sidecar from an earlier task reusing this id must not
		// shadow the live one, so a path-less read only consults the archive once
		// the active path is gone.
		const stale = `${JSON.stringify({ ...INTENT, goal: "Stale archived outcome" }, null, 2)}\n`;
		const root = makeRepo({ [ACTIVE_PATH]: intentJson, [ARCHIVED_PATH]: stale });
		try {
			const read = readTaskIntent(root, TASK_ID);
			expect(read.intent_ref.path).toBe(ACTIVE_PATH);
			expect(read.intent.goal).toBe(INTENT.goal);
			// The record is still the authority: an explicit path reaches the archive.
			expect(readTaskIntent(root, TASK_ID, ARCHIVED_PATH).intent.goal).toBe("Stale archived outcome");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("Spec binding survives sidecar relocation", () => {
	test("the archived sidecar still binds its active and archive Spec pair", () => {
		// freeze_artifacts moves the sidecar into the archive; the binding it
		// carries is what a restore reads back, so the pair must survive intact.
		const bound = {
			...INTENT,
			scope_hint: ["docs/specs/post-freeze.spec.md", "docs/specs/archive/post-freeze.spec.md"],
		};
		const root = makeRepo({ [ARCHIVED_PATH]: `${JSON.stringify(bound, null, 2)}\n` });
		try {
			const read = readTaskIntent(root, TASK_ID);
			expect(read.intent_ref.path).toBe(ARCHIVED_PATH);
			expect(inspectSpecBinding(read.intent)).toEqual({
				ok: true,
				binding: {
					active: "docs/specs/post-freeze.spec.md",
					archive: "docs/specs/archive/post-freeze.spec.md",
				},
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("Host adapter intent resolution parity", () => {
	// Both Hosts must resolve the sidecar through the TaskRecord's
	// `intent_ref.path`. A bare `readTaskIntent(root, taskId)` in an adapter is the
	// exact shape of the original defect, so it stays banned at the source level.
	const adapters = [
		"plugins/immune-brain/runtime/claude/kernel_ports.ts",
		"plugins/immune-brain/.pi-extension/imm-canary-work.ts",
	];

	for (const relativePath of adapters) {
		test(`${relativePath} never reads the intent at the default path`, () => {
			const source = readFileSync(resolve(relativePath), "utf8");
			const bare = source.match(/readTaskIntent\(\s*[A-Za-z_.]+\s*,\s*[A-Za-z_.]+\s*\)/g) ?? [];
			expect({ relativePath, bare }).toEqual({ relativePath, bare: [] });
		});

		test(`${relativePath} resolves the sidecar from the TaskRecord`, () => {
			const source = readFileSync(resolve(relativePath), "utf8");
			expect(source).toContain("intent_ref");
		});
	}
});

describe("S6: the settled read names its own run's frozen sidecar", () => {
	function makeSeededStore(root: string, intent: Record<string, unknown>) {
		const parsed = parseTaskIntentV1(intent);
		const record = {
			contract: "assurance_kernel/task_record/v4",
			task_id: parsed.task_id,
			intent_snapshot: parsed,
			intent_ref: { path: ARCHIVED_PATH, content_hash: canonicalIntentHash(parsed) },
			lifecycle: "done",
			artifact_state: "frozen",
			baseline: canonicalIntentHash(parsed),
			git_base_head: "a".repeat(40),
			attestations: [],
			findings: [],
			history: [],
		};
		return seedKernelRunForTest(root, { task_id: parsed.task_id, record, terminal: { lifecycle: "done" } });
	}

	test("a settled task's evidence is its own run's, never a foreign run's pair", () => {
		const root = makeRepo({ [ARCHIVED_PATH]: intentJson });
		try {
			const seeded = makeSeededStore(root, INTENT);
			// Another worktree's earlier run of the same logical task settled and
			// its pair reached this worktree under its own run directory.
			const staleIntent = { ...INTENT, goal: "Another worktree's run" };
			const staleRecord = {
				contract: "assurance_kernel/task_record/v4",
				task_id: TASK_ID,
				intent_snapshot: staleIntent,
				intent_ref: { path: ACTIVE_PATH, content_hash: canonicalIntentHash(parseTaskIntentV1(staleIntent)) },
				lifecycle: "done",
				artifact_state: "frozen",
				baseline: `sha256:${"a".repeat(64)}`,
				git_base_head: "a".repeat(40),
				attestations: [],
				findings: [],
				history: [],
			};
			const staleBytes = `${JSON.stringify(staleRecord, null, 2)}\n`;
			const staleDir = join(root, ".imm", "audit", TASK_ID, "run-00000000-0000-0000-0000-000000000000");
			mkdirSync(staleDir, { recursive: true });
			writeFileSync(join(staleDir, "task-record.json"), staleBytes);
			writeFileSync(
				join(staleDir, "terminal-proof.json"),
				`${JSON.stringify(
					{
						contract: "assurance_kernel/task_tombstone/v2",
						task_id: TASK_ID,
						lifecycle_status: "terminal",
						terminal_lifecycle: "done",
						terminal_event_id: "evt-term-foreign",
						final_record_hash: `sha256:${new Bun.CryptoHasher("sha256").update(staleBytes).digest("hex")}`,
						terminalized_at: "2026-08-12T09:00:00.000Z",
					},
					null,
					2,
				)}\n`,
			);
			// The settled read answers from this worktree's own terminal run.
			const evidence = readSettledTaskEvidence(root, TASK_ID);
			expect(evidence).not.toBeNull();
			expect(evidence!.runId).toBe(seeded.run_id);
			expect(evidence!.record.intent_ref.path).toBe(ARCHIVED_PATH);
			// The intent the settled record names is the frozen sidecar.
			const read = readTaskIntent(root, TASK_ID, evidence!.record.intent_ref.path);
			expect(read.intent.goal).toBe(INTENT.goal);
			// The foreign pair stays readable evidence but never becomes the answer.
			expect(readAuditTaskPair(root, TASK_ID, "run-00000000-0000-0000-0000-000000000000")?.record.intent_ref.path).toBe(ACTIVE_PATH);
			// An earlier run's pair is not what the settled read returns.
			expect(evidence!.record.intent_ref.path).not.toBe(ACTIVE_PATH);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

/** Seed one settled Run for this worktree, its intent bound to the given path. */
function seedSettledRun(root: string, intent: Record<string, unknown>, intentPath: string) {
	const parsed = parseTaskIntentV1(intent);
	const record = {
		contract: "assurance_kernel/task_record/v4",
		task_id: parsed.task_id,
		intent_snapshot: parsed,
		intent_ref: { path: intentPath, content_hash: canonicalIntentHash(parsed) },
		lifecycle: "done",
		artifact_state: "frozen",
		baseline: canonicalIntentHash(parsed),
		git_base_head: "a".repeat(40),
		attestations: [],
		findings: [],
		history: [],
	};
	return seedKernelRunForTest(root, { task_id: parsed.task_id, record, terminal: { lifecycle: "done" } });
}

/** A stale flat pair of the same logical task whose facts disagree. */
function staleFlatRecord(taskId: string) {
	return {
		contract: "assurance_kernel/task_record/v2",
		task_id: taskId,
		intent: null,
		lifecycle_status: "terminal",
		terminal_lifecycle: "stopped",
		terminal_event_id: `stopped:${taskId}:flat`,
		finished_at: "2026-08-12T10:00:00.000Z",
		scope: ["docs/foreign"],
		evidence: { git_base_commit: "a".repeat(40), git_head_commit: "b".repeat(40) },
	};
}

/** A live TaskRecord for a run that has not settled. */
function liveRecord(taskId: string, intentPath: string) {
	const parsed = parseTaskIntentV1({ ...INTENT, task_id: taskId });
	return {
		contract: "assurance_kernel/task_record/v4",
		task_id: taskId,
		intent_snapshot: parsed,
		intent_ref: { path: intentPath, content_hash: canonicalIntentHash(parsed) },
		lifecycle: "active",
		artifact_state: "active",
		baseline: `sha256:${"a".repeat(64)}`,
		git_base_head: "a".repeat(40),
		attestations: [],
		findings: [],
		history: [],
	};
}

describe("S6: the Pi settled reader answers the current Run's evidence", () => {
	// The Pi extension module imports host packages; register the seam only
	// when the real packages are unavailable, and restore it after this suite
	// so no mock leaks into process-neighbor tests.
	async function loadPiSettledReader(): Promise<
		(typeof import("../plugins/immune-brain/.pi-extension/imm-unattended-batch"))["readSettledTaskRecord"]
	> {
		// The QA tree has no node_modules: mock only what the extension really
		// imports, and only when the real package is unavailable, so a
		// deliverable-tree run registers the same seams Pi Host tests use and
		// this repository run keeps the real packages.
		const seams: Record<string, () => unknown> = {
			typebox: () => {
				const optional = Symbol("optional");
				return { Type: {
					String: (options = {}) => ({ type: "string", ...options }),
					Number: () => ({ type: "number" }),
					Boolean: () => ({ type: "boolean" }),
					Null: () => ({ type: "null" }),
					Unknown: () => ({}),
					Literal: (value: unknown) => ({ const: value }),
					Array: (items: object) => ({ type: "array", items }),
					Union: (anyOf: object[]) => ({ anyOf }),
					Optional: (schema: object) => ({ ...schema, [optional]: true }),
					Record: (_key: object, value: object) => ({ type: "object", additionalProperties: value }),
					Object: (properties: Record<string, unknown>, options = {}) => ({
						type: "object", properties,
						required: Object.entries(properties).filter(([, value]) => !(value as Record<symbol, unknown>)[optional]).map(([key]) => key),
						...options,
					}),
				} };
			},
			"@earendil-works/pi-coding-agent": () => ({ DynamicBorder: class {} }),
			"@earendil-works/pi-tui": () => ({ Text: class {}, Container: class {}, SelectList: class {},
				sliceByColumn: (value: string, start: number, width?: number) =>
					value.slice(start, width === undefined ? undefined : start + width),
				truncateToWidth: (value: string, width: number) => value.slice(0, width),
				visibleWidth: (value: string) => value.length }),
		};
		for (const [spec, factory] of Object.entries(seams)) {
			try {
				await import(spec);
			} catch {
				mock.module(spec, factory);
			}
		}
		const module = await import("../plugins/immune-brain/.pi-extension/imm-unattended-batch");
		return module.readSettledTaskRecord;
	}

	afterAll(() => {
		mock.restore();
	});

	test("a migrated historical v3 run is settled evidence, not a parse failure", async () => {
		const root = makeRepo({ [ACTIVE_PATH]: intentJson });
		try {
			const parsed = parseTaskIntentV1(INTENT);
			const v3 = {
				contract: "assurance_kernel/task_record/v3",
				task_id: TASK_ID,
				intent_snapshot: parsed,
				intent_ref: { path: ARCHIVED_PATH, content_hash: canonicalIntentHash(parsed) },
				lifecycle: "done",
				artifact_state: "frozen",
				baseline: canonicalIntentHash(parsed),
				attestations: [],
				findings: [],
				history: [],
			};
			const recordBytes = `${JSON.stringify(v3, null, 2)}\n`;
			const recordHash = new Bun.CryptoHasher("sha256").update(recordBytes).digest("hex");
			const proof = {
				contract: "assurance_kernel/task_tombstone/v2",
				task_id: TASK_ID,
				lifecycle_status: "terminal",
				terminal_lifecycle: "done",
				terminal_event_id: `migrated:${TASK_ID}`,
				final_record_hash: `sha256:${recordHash}`,
				terminalized_at: "2026-08-12T11:00:00.000Z",
			};
			const proofBytes = `${JSON.stringify(proof, null, 2)}\n`;
			// A supported legacy import preserves a terminal v3 record and its
			// proof in the run rows, exactly as the migration writes them.
			withKernelTransaction(root, (db) => {
				const run = insertRunRow(db, {
					run_id: "run-00000000-0000-0000-0000-000000000001",
					task_id: TASK_ID,
					record_json: recordBytes,
					intent_revision: parsed.revision,
					intent_content_hash: canonicalIntentHash(parsed),
					enrollment_event_id: `migrated:${TASK_ID}`,
					claim_status: "active",
					created_at: "2026-08-12T10:00:00.000Z",
					updated_at: "2026-08-12T10:00:00.000Z",
				});
				updateRunTerminal(db, run.run_id, "done", recordBytes, proofBytes, "2026-08-12T11:00:00.000Z");
				markAuditExported(db, run.run_id, "2026-08-12T11:00:00.000Z");
			});
			const evidence = readSettledTaskEvidence(root, TASK_ID);
			expect(evidence).not.toBeNull();
			expect(evidence!.record.intent_ref?.path).toBe(ARCHIVED_PATH);
			expect(evidence!.record.intent_snapshot.scope_hint).toEqual(INTENT.scope_hint);
			expect(evidence!.proof.terminal_event_id).toBe(`migrated:${TASK_ID}`);
			const readPiSettledRecord = await loadPiSettledReader();
			const read = await readPiSettledRecord(root, TASK_ID);
			expect(read).toEqual({ scope_hint: INTENT.scope_hint, intent_path: ARCHIVED_PATH });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("a live Run answers null even when an earlier Run's export exists", () => {
		const root = makeRepo({ [ACTIVE_PATH]: intentJson });
		try {
			// The live run has no settled evidence: the single exported pair of
			// the same task belongs to another run and may not answer.
			seedKernelRunForTest(root, { task_id: TASK_ID, record: liveRecord(TASK_ID, ACTIVE_PATH) });
			const flatDir = join(root, ".imm", "audit", TASK_ID);
			mkdirSync(flatDir, { recursive: true });
			writeFileSync(join(flatDir, "task-record.json"), `${JSON.stringify(staleFlatRecord(TASK_ID), null, 2)}\n`);
			expect(readSettledTaskEvidence(root, TASK_ID)).toBeNull();
			expect(localRunId(root, TASK_ID)).not.toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("a settled Run's evidence is read from the store, never a stale flat pair", async () => {
		const readSettledTaskRecord = await loadPiSettledReader();
		const root = makeRepo({ [ACTIVE_PATH]: intentJson });
		try {
			const seeded = seedSettledRun(root, INTENT, ACTIVE_PATH);
			recoverKernelStoreFollowUps(root, TASK_ID);
			// A stale flat pair of the same logical task with different facts
			// reaches this worktree; a run-blind read would answer it.
			const flatDir = join(root, ".imm/audit", TASK_ID);
			mkdirSync(flatDir, { recursive: true });
			writeFileSync(
				join(flatDir, "task-record.json"),
				`${JSON.stringify(staleFlatRecord(TASK_ID), null, 2)}\n`,
			);
			const read = await readSettledTaskRecord(root, TASK_ID);
			expect(read).not.toBeNull();
			expect(read!.scope_hint).toEqual(INTENT.scope_hint);
			expect(read!.intent_path).toBe(seeded.record.intent_ref.path);
			// The foreign flat pair never becomes the settled answer.
			expect(read!.intent_path).not.toBe("docs/plans/foreign.json");
			expect(readSettledTaskEvidence(root, TASK_ID)?.runId).toBe(seeded.run_id);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
