import { afterEach, describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runKernelCommand } from "../plugins/immune-brain/runtime/commands/kernel";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import { openKernelStore, readJournalRows } from "../plugins/immune-brain/runtime/kernel/sqlite_store";
import { seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";

const roots: string[] = [];

function tempRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "imm-kernel-status-"));
	roots.push(root);
	mkdirSync(join(root, ".imm"), { recursive: true });
	return root;
}

/** Seed the workspace claim through the store: claims are derived from runs. */
function writeClaim(root: string, taskId = "status-owner-task"): void {
	const intent = {
		contract: "assurance_kernel/task_intent/v1",
		task_id: taskId,
		goal: "status owner fixture",
		acceptance: [{ id: "A1", assertion: "a1", verification: "bun test tests/x.test.ts" }],
		scope_hint: ["docs/plans"],
		risk: "routine" as const,
		revision: 1,
		owner: "user",
	};
	seedKernelRunForTest(root, {
		task_id: taskId,
		record: {
			contract: "assurance_kernel/task_record/v4",
			task_id: taskId,
			intent_snapshot: intent,
			intent_ref: {
				path: `docs/plans/${taskId}.intent.json`,
				content_hash: canonicalIntentHash(parseTaskIntentV1(intent)),
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

/** Read the durable friction journal out of the authority store. */
function journalLines(root: string): unknown[] {
	const db = openKernelStore(root, { create: false });
	if (!db) return [];
	try {
		return readJournalRows(db).map((row) => JSON.parse(row.entry_json) as unknown);
	} finally {
		db.close();
	}
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("imm-kernel status", () => {
	it("reports a ready layout with unowned Kernel facts, zero writes", () => {
		const root = tempRoot();
		const result = runKernelCommand(["status", "--json"], root);
		expect(result.returncode).toBe(0);
		const output = JSON.parse(result.stdout);
		expect(output.contract).toBe("assurance_kernel/status/v1");
		expect(output.layout).toMatchObject({ layout: "ready" });
		expect(output.kernel).toEqual({ claim: null, workspace: { current_working: null } });
		// Strictly read-only: no authority store, no journal, no lock residue.
		expect(existsSync(join(root, ".imm/state/kernel.sqlite"))).toBe(false);
		expect(existsSync(join(root, ".imm/state/workspace.json"))).toBe(false);
		expect(existsSync(join(root, ".imm/state/active-claim.json"))).toBe(false);
		expect(existsSync(join(root, ".imm/state/journal.jsonl"))).toBe(false);
	});

	it("reports an owner-free legacy layout as migration_required without interpreting old authority", () => {
		const root = tempRoot();
		mkdirSync(join(root, ".imm/memory"), { recursive: true });
		writeFileSync(
			join(root, ".imm/memory/current_iteration.json"),
			`${JSON.stringify({
				schema_version: 3,
				plan_path: "docs/plans/example.md",
				runtime_status: "idle",
				steps: {},
			}, null, 2)}\n`,
		);
		const result = runKernelCommand(["status", "--json"], root);
		expect(result.returncode).toBe(0);
		const output = JSON.parse(result.stdout);
		expect(output.layout.layout).toBe("migration_required");
		// The archived Ledger is never projected as current authority.
		expect(output.kernel).toEqual({ claim: null, workspace: { current_working: null } });
	});

	it("reports the Kernel claim and workspace owner when present", () => {
		const root = tempRoot();
		writeClaim(root);
		const result = runKernelCommand(["status", "--json"], root);
		expect(result.returncode).toBe(0);
		const output = JSON.parse(result.stdout);
		expect(output.layout.layout).toBe("ready");
		expect(output.kernel.claim).toEqual({
			task_id: "status-owner-task",
			lifecycle_status: "active",
		});
		expect(output.kernel.workspace.current_working).toBe("status-owner-task");
	});

	it("rejects a symlinked authority store with a layout failure instead of following it", () => {
		const root = tempRoot();
		mkdirSync(join(root, ".imm/state"), { recursive: true });
		const outside = join(root, "outside.sqlite");
		writeFileSync(outside, "");
		symlinkSync(outside, join(root, ".imm/state/kernel.sqlite"));
		const result = runKernelCommand(["status", "--json"], root);
		expect(result.returncode).toBe(1);
		const output = JSON.parse(result.stdout);
		expect(["source_invalid", "source_read_failed"]).toContain(output.error.code);
	});

	it("journals rejected unknown commands without mutating authoritative state", () => {
		const root = tempRoot();
		// ISL-2 successor: the coverage retired with tests/kernel-r2a-boundary.test.ts
		// at S5 asserted that the removed `readiness` command refuses as an
		// unrecognized one with zero writes. The literal token is exercised here
		// beside the arbitrary placeholder, so a command table that resolved it again
		// would fail on the real command rather than only on a token nobody can
		// register. `readiness` is also a retired top-level token, which the command
		// surface deliberately keeps out of the friction journal, so the journal
		// assertion belongs to the unknown-command path and the retired token is
		// asserted on the same refusal plus its silence.
		const unknown = runKernelCommand(["totally-unknown-command"], root);
		expect(unknown.returncode).toBe(2);
		expect(JSON.parse(unknown.stdout).error?.code).toBe("invalid_command");
		const lines = journalLines(root);
		expect(lines.at(-1)).toMatchObject({
			command: "totally-unknown-command",
			result: "rejected",
			reason_code: "invalid_command",
		});

		const retired = runKernelCommand(["readiness", "--json"], root);
		expect(retired.returncode).toBe(2);
		expect(JSON.parse(retired.stdout).error?.code).toBe("invalid_command");
		expect(journalLines(root)).toHaveLength(1);
		expect(existsSync(join(root, ".imm/state/workspace.json"))).toBe(false);
	});

	it("status is strictly read-only and never touches the journal", () => {
		const root = tempRoot();
		runKernelCommand(["status", "--json"], root);
		expect(existsSync(join(root, ".imm/state/journal.jsonl"))).toBe(false);
		expect(journalLines(root)).toEqual([]);
	});
});