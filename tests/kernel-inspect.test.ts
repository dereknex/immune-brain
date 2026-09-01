import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runKernelCommand } from "../plugins/immune-brain/runtime/commands/kernel";
import { canonicalIntentHash, parseTaskIntentV1, RISK_FLOOR_SCOPE_PREFIXES } from "../plugins/immune-brain/runtime/kernel/intent";

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

function writeClaim(root: string, taskId: string): void {
	mkdirSync(join(root, ".imm/state"), { recursive: true });
	writeFileSync(
		join(root, ".imm/state/active-claim.json"),
		`${JSON.stringify({
			contract: "assurance_kernel/backend_claim/v2",
			backend: "kernel",
			task_id: taskId,
			intent_revision: 1,
			intent_content_hash: "sha256:" + "0".repeat(64),
			enrollment_event_id: `enroll-${taskId}`,
			lifecycle_status: "active",
			created_at: "2026-08-12T00:00:00.000Z",
			updated_at: "2026-08-12T00:00:00.000Z",
		}, null, 2)}\n`,
	);
	writeFileSync(
		join(root, ".imm/state/workspace.json"),
		`${JSON.stringify({
			contract: "assurance_kernel/workspace/v1",
			current_working: taskId,
		}, null, 2)}\n`,
	);
}

function writeClaimedTask(root: string, taskId: string, scope_hint: string[], risk: "routine" | "material" = "routine") {
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
	const parsed = parseTaskIntentV1(intent);
	const hash = canonicalIntentHash(parsed);
	mkdirSync(join(root, "docs/plans"), { recursive: true });
	writeFileSync(join(root, "docs/plans", `${taskId}.intent.json`), `${JSON.stringify(intent, null, 2)}\n`);
	writeClaim(root, taskId);
	mkdirSync(join(root, ".imm/state/tasks"), { recursive: true });
	writeFileSync(
		join(root, ".imm/state/tasks", `${taskId}.json`),
		`${JSON.stringify({
			contract: "assurance_kernel/task_record/v3",
			task_id: taskId,
			intent_snapshot: intent,
			intent_ref: { path: `docs/plans/${taskId}.intent.json`, content_hash: hash },
			lifecycle: "active",
			artifact_state: "active",
			baseline: `sha256:${"a".repeat(64)}`,
			attestations: [],
			findings: [],
			history: [],
		}, null, 2)}\n`,
	);
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
		expect(output.risk.floor_prefixes).toEqual([...RISK_FLOOR_SCOPE_PREFIXES]);
		expect(output.unobservable).toEqual({
			capability: "unobservable",
			rehearsal: "unobservable",
			cas_holder: "unobservable",
		});
		expect(existsSync(join(root, ".imm/state/workspace.json"))).toBe(false);
		expect(existsSync(join(root, ".imm/state/active-claim.json"))).toBe(false);
		expect(existsSync(join(root, ".imm/state/journal.jsonl"))).toBe(false);
		expect(existsSync(join(root, ".imm/state/locks"))).toBe(false);
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
		writeClaimedTask(root, "inspect-floor-hit", ["plugins/immune-brain/runtime/kernel/intent.ts"]);
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
		expect(output.unobservable.capability).toBe("unobservable");
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

	it("fails closed when a claim exists without a TaskRecord", () => {
		const root = tempRoot();
		const taskId = "inspect-missing-record";
		const intent = {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskId,
			goal: "Missing record",
			acceptance: [{ id: "A1", assertion: "a1", verification: "v1" }],
			scope_hint: ["docs/specs/example.spec.md"],
			risk: "routine",
			revision: 1,
			owner: "user",
		};
		mkdirSync(join(root, "docs/plans"), { recursive: true });
		writeFileSync(join(root, "docs/plans", `${taskId}.intent.json`), `${JSON.stringify(intent, null, 2)}\n`);
		writeClaim(root, taskId);
		const result = runKernelCommand(["inspect", "--json"], root);
		expect(result.returncode).toBe(1);
		expect(JSON.parse(result.stdout).error.code).toBe("source_read_failed");
		expect(existsSync(join(root, ".imm/state/journal.jsonl"))).toBe(false);
	});
});
