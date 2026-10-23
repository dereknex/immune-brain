// The batch disposition: one explicit literal-user decision retires a record the
// plan moved past, preserving its evidence and granting nothing.
//
// Every case here is a recovery path for the #165 failure (a batch whose child
// needed a mid-batch Intent Revision, so the plan digest drifted while the batch
// already held child commits). The record could neither reconfirm nor continue,
// and the only exits were a manual state edit or deletion, both of which destroy
// the evidence of what the batch actually delivered. These tests pin the
// supported exit: the retirement writes, what it preserves, and what it refuses.

import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { confirmationRef, entryTokenRequestId } from "../plugins/immune-brain/runtime/claude/interaction";
import { ClaudeRuntime } from "../plugins/immune-brain/runtime/claude/kernel_ports";
import { consumePhaseAdmission, phaseEntryGateHookOutput, recordPhaseEntryPrompt, type GatedTool } from "../plugins/immune-brain/runtime/claude/lane_guard";
import { createMcpRuntime, handleJsonRpc } from "../plugins/immune-brain/runtime/claude/mcp_server";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import { batchStatePath } from "../plugins/immune-brain/runtime/kernel/storage_paths";
import { seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";
import { batchReason } from "../plugins/immune-brain/runtime/unattended/batch_reasons";
import {
	readStaleBatchLookup,
	retireStaleBatch,
	type StaleBatchFacts,
} from "../plugins/immune-brain/runtime/unattended/batch_disposition";
import { findExistingActiveBatch, findSettledBatchRecord } from "../plugins/immune-brain/runtime/unattended/batch_preflight";
import {
	isTerminalBatchState,
	readAnyBatchRunState,
	readBatchRunState,
	writeBatchRunState,
	type AnyBatchRunStateRecord,
	type BatchLaneRunStateRecord,
	type BatchRunStateRecord,
} from "../plugins/immune-brain/runtime/unattended/batch_state";

it("newer batch contracts block retirement and settled-lineage reuse without a gate or writes", async () => {
	const r = repo();
	const settled = { ...laneRecord(r), batch_state: "completed" as const };
	writeFileSync(join(r.root, ".imm/state/batches/a-settled.json"), JSON.stringify(settled));
	expect(findSettledBatchRecord(r.root, SLUG)?.contract).toBe("assurance_kernel/batch_run_state/v2");
	const path = join(r.root, ".imm/state/batches/z-newer.json");
	const contract = "assurance_kernel/batch_run_state/v3";
	const bytes = JSON.stringify({ contract, initiative_slug: SLUG });
	writeFileSync(path, bytes);
	expect(readStaleBatchLookup(r.root, SLUG)).toEqual({ kind: "corrupt", path, newer_contract: contract });
	let gates = 0;
	const result = await retireStaleBatch({ root: r.root, initiative_slug: SLUG, now: NOW, gate: async () => { gates++; return { kind: "confirmed", request_id: "unexpected" }; } });
	expect(result).toMatchObject({ outcome: "rejected", rejection: { state: "blocked", reason: expect.stringContaining("batch_runtime_too_old") } });
	expect(gates).toBe(0); expect(readFileSync(path, "utf8")).toBe(bytes);
	expect(() => findSettledBatchRecord(r.root, SLUG)).toThrow("batch_runtime_too_old");
});

it.each(["before", "after"] as const)("a newer record listed %s an active v2 record blocks the active lookup", order => {
	const r = repo();
	write(r, laneRecord(r));
	const dir = join(r.root, ".imm/state/batches");
	const contract = "assurance_kernel/batch_run_state/v3";
	const bytes = JSON.stringify({ contract, initiative_slug: SLUG });
	// Directory order is filesystem-defined, so probe for a name that lands on the wanted side.
	let path: string | null = null;
	for (let i = 0; i < 64 && path === null; i++) {
		const candidate = join(dir, `newer-${i}.json`);
		writeFileSync(candidate, bytes);
		const listed = readdirSync(dir);
		const after = listed.indexOf(`newer-${i}.json`) > listed.indexOf(`${BATCH_ID}.json`);
		if (after === (order === "after")) path = candidate;
		else rmSync(candidate);
	}
	if (path === null) throw new Error(`no probe name listed ${order} the active record`);
	expect(findExistingActiveBatch(r.root, SLUG)).toEqual({ corrupt: true, path, newer_contract: contract });
});

const SLUG = "parallel-batch-lanes";
const BATCH_ID = "batch-parallel-batch-lanes-26c9dc0d";
const BATCH_BRANCH = `imm/${SLUG}`;
const CONFIRMED_AT = "2026-08-16T09:00:00.000Z";
const PLAN_DIGEST = "sha256:" + "a".repeat(64);
const REVISED_DIGEST = "sha256:" + "b".repeat(64);
const NOW = "2026-08-18T10:00:00.000Z";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(root: string, ...args: string[]): string {
	return execFileSync("git", ["--no-optional-locks", "-C", root, ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

interface Repo {
	root: string;
	base: string;
	first: string;
	second: string;
	cleanup(): void;
}

/** A repository on the batch branch with two child commits on top of the base. */
function repo(): Repo {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "imm-disposition-")));
	roots.push(root);
	mkdirSync(join(root, ".imm", "state", "batches"), { recursive: true });
	writeFileSync(join(root, ".gitignore"), ".imm/state/\n");
	git(root, "init", "-q", "-b", "main");
	git(root, "config", "user.name", "Fixture");
	git(root, "config", "user.email", "fixture@example.com");
	writeFileSync(join(root, "base.txt"), "base\n");
	git(root, "add", "-A");
	git(root, "commit", "-qm", "base");
	const base = git(root, "rev-parse", "HEAD");
	git(root, "checkout", "-q", "-b", BATCH_BRANCH);
	for (const [name, content] of [["child-1.txt", "one\n"], ["child-2.txt", "two\n"]] as const) {
		writeFileSync(join(root, name), content);
		git(root, "add", "-A");
		git(root, "commit", "-qm", `child ${name}`);
	}
	return {
		root,
		base,
		first: git(root, "rev-parse", "HEAD~1"),
		second: git(root, "rev-parse", "HEAD"),
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

/** Seed the coordinator's Kernel run for a child: live, or already ended. */
function seedKernelRun(root: string, taskId: string, lifecycle: "active" | "done" | "stopped", runId?: string): void {
	const intent = {
		contract: "assurance_kernel/task_intent/v1",
		task_id: taskId,
		goal: "disposition fixture",
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
			intent_ref: { path: `docs/plans/${taskId}.intent.json`, content_hash: canonicalIntentHash(parseTaskIntentV1(intent)) },
			lifecycle,
			artifact_state: lifecycle === "active" ? "active" : "frozen",
			baseline: `sha256:${"a".repeat(64)}`,
			git_base_head: "a".repeat(40),
			attestations: [],
			findings: [],
			history: [],
		},
		...(lifecycle === "active" ? {} : { terminal: { lifecycle } }),
		...(runId ? { run_id: runId } : {}),
	});
}

function realpath(path: string): string {
	return execFileSync("git", ["-C", path, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim() || path;
}


/** The #165 shape: two children delivered by the batch, three never executed. */
function serialRecord(r: Repo, overrides: Partial<BatchRunStateRecord> = {}): BatchRunStateRecord {
	return {
		contract: "assurance_kernel/batch_run_state/v1",
		batch_id: BATCH_ID,
		initiative_slug: SLUG,
		base_head: r.base,
		branch: BATCH_BRANCH,
		plan_digest: PLAN_DIGEST,
		confirmation_time: CONFIRMED_AT,
		batch_state: "running",
		children: [
			{ task_id: "parallel-batch-lanes-s1", slice_id: "S1", state: "committed", commit: r.first, blocked_by: [], reason: null },
			{ task_id: "parallel-batch-lanes-s2", slice_id: "S2", state: "committed", commit: r.second, blocked_by: [], reason: null },
			{ task_id: "parallel-batch-lanes-s3", slice_id: "S3", state: "pending", commit: null, blocked_by: ["parallel-batch-lanes-s2"], reason: null },
			{ task_id: "parallel-batch-lanes-s4", slice_id: "S4", state: "pending", commit: null, blocked_by: ["parallel-batch-lanes-s3"], reason: null },
			{ task_id: "parallel-batch-lanes-s5", slice_id: "S5", state: "pending", commit: null, blocked_by: ["parallel-batch-lanes-s4"], reason: null },
		],
		commits: [r.first, r.second],
		consecutive_qa_failures: 0,
		budget: { max_children: 5, qa_failure_limit: 2 },
		created_at: CONFIRMED_AT,
		updated_at: CONFIRMED_AT,
		...overrides,
	};
}

function laneRecord(r: Repo): BatchLaneRunStateRecord {
	const lane = (taskId: string, runId: string) => ({
		path: r.root,
		branch: `${BATCH_BRANCH}-${taskId}`,
		base_head: r.base,
		lane_commit: r.first,
		run_id: runId,
	});
	return {
		contract: "assurance_kernel/batch_run_state/v2",
		batch_id: BATCH_ID,
		initiative_slug: SLUG,
		base_head: r.base,
		branch: BATCH_BRANCH,
		plan_digest: PLAN_DIGEST,
		confirmation_time: CONFIRMED_AT,
		batch_state: "needs_human",
		max_parallel: 3,
		children: [
			{ task_id: "parallel-batch-lanes-s1", slice_id: "S1", state: "integrated", commit: r.first, blocked_by: [], reason: null, qa_failures: 0, lane: lane("parallel-batch-lanes-s1", "run-s1") },
			{ task_id: "parallel-batch-lanes-s2", slice_id: "S2", state: "needs_human", commit: null, blocked_by: [], reason: "parked for a human decision", qa_failures: 0, lane: null },
			{ task_id: "parallel-batch-lanes-s3", slice_id: "S3", state: "pending", commit: null, blocked_by: ["parallel-batch-lanes-s2"], reason: null, qa_failures: 0, lane: null },
		],
		commits: [r.first],
		consecutive_qa_failures: 0,
		budget: { max_children: 3, qa_failure_limit: 2 },
		created_at: CONFIRMED_AT,
		updated_at: CONFIRMED_AT,
	};
}

function write(r: Repo, record: AnyBatchRunStateRecord): void {
	writeFileSync(join(r.root, batchStatePath(record.batch_id)), `${JSON.stringify(record, null, 2)}\n`);
}

function bytes(r: Repo, batchId = BATCH_ID): Buffer {
	return readFileSync(join(r.root, batchStatePath(batchId)));
}

function reports(r: Repo): Record<string, unknown> {
	const path = join(r.root, ".imm", "state", "batches", `${BATCH_ID}.report.json`);
	return existsSync(path) ? { [`${BATCH_ID}.report.json`]: JSON.parse(readFileSync(path, "utf8")) } : {};
}

type Decision = { kind: "confirmed"; request_id: string } | { kind: "host_rejection"; value: unknown };

function gate(plan: { decision: Decision; onFacts?: (facts: StaleBatchFacts) => void } = { decision: { kind: "confirmed", request_id: "req-1" } }) {
	const calls: StaleBatchFacts[] = [];
	return {
		calls,
		run: async (facts: StaleBatchFacts): Promise<Decision> => {
			calls.push(facts);
			plan.onFacts?.(facts);
			return plan.decision;
		},
	};
}

describe("stale batch disposition", () => {
	it("superseded is a terminal batch state", () => {
		expect(isTerminalBatchState("superseded")).toBe(true);
	});

	it("reads a drifted record with recorded child progress as retirable evidence", () => {
		const r = repo();
		write(r, serialRecord(r));
		const lookup = readStaleBatchLookup(r.root, SLUG);
		expect(lookup.kind).toBe("retirable");
		if (lookup.kind !== "retirable") throw new Error("expected retirable");
		expect(lookup.facts).toEqual({
			batch_id: BATCH_ID,
			initiative_slug: SLUG,
			batch_state: "running",
			plan_digest: PLAN_DIGEST,
			branch: BATCH_BRANCH,
			base_head: r.base,
			confirmation_time: CONFIRMED_AT,
			recorded_commits: [r.first, r.second],
			children: [
				{ task_id: "parallel-batch-lanes-s1", slice_id: "S1", state: "committed", commit: r.first, lane_branch: null, kernel_lifecycle: null },
				{ task_id: "parallel-batch-lanes-s2", slice_id: "S2", state: "committed", commit: r.second, lane_branch: null, kernel_lifecycle: null },
				{ task_id: "parallel-batch-lanes-s3", slice_id: "S3", state: "pending", commit: null, lane_branch: null, kernel_lifecycle: null },
				{ task_id: "parallel-batch-lanes-s4", slice_id: "S4", state: "pending", commit: null, lane_branch: null, kernel_lifecycle: null },
				{ task_id: "parallel-batch-lanes-s5", slice_id: "S5", state: "pending", commit: null, lane_branch: null, kernel_lifecycle: null },
			],
		});
	});

	it("retires a drifted serial record to a terminal state, preserving every child, commit and the old confirmation", async () => {
		const r = repo();
		write(r, serialRecord(r));
		const before = bytes(r);
		const g = gate();
		const outcome = await retireStaleBatch({
			root: r.root,
			initiative_slug: SLUG,
			now: NOW,
			gate: g.run,
		});
		expect(outcome.outcome).toBe("retired");
		if (outcome.outcome !== "retired") throw new Error("expected retired");
		expect(g.calls).toHaveLength(1);
		expect(outcome.batch_id).toBe(BATCH_ID);

		const after = readBatchRunState(r.root, BATCH_ID)!;
		expect(after.batch_state).toBe("superseded");
		// Nothing about what the batch delivered is rewritten: same children, same
		// states, same commits, and the old authorization's confirmation time.
		expect(after.children).toEqual(serialRecord(r).children);
		expect(after.commits).toEqual([r.first, r.second]);
		expect(after.confirmation_time).toBe(CONFIRMED_AT);
		expect(after.plan_digest).toBe(PLAN_DIGEST);
		expect(after.base_head).toBe(r.base);
		expect(before.equals(bytes(r))).toBe(false);

		// A retired record is settled: it no longer blocks a new run, and the
		// Initiative's lineage stays available to one.
		expect(findExistingActiveBatch(r.root, SLUG)).toBeNull();
		expect(findSettledBatchRecord(r.root, SLUG)?.batch_id).toBe(BATCH_ID);

		// The terminal report states what is preserved and what is not claimed.
		const [report] = Object.values(reports(r));
		expect(report).toMatchObject({
			contract: "assurance_kernel/batch_run_report/v1",
			batch_id: BATCH_ID,
			batch_state: "superseded",
			commits: [r.first, r.second],
			children: serialRecord(r).children,
		});
		const reportRecord = report as { reason: string; next_action: string; handoff?: unknown };
		expect(reportRecord.reason).toContain("explicit literal-user disposition");
		expect(reportRecord.reason).toContain("no batch trailer and no approval");
		expect(reportRecord.next_action).toContain("imm-run");
		// The retired authorization grants no handoff to the children it never ran.
		expect(reportRecord.handoff).toBeUndefined();
	});

	it("under an entry token the Claude runtime retires with no native gate (ADR 0025)", async () => {
		const r = repo();
		write(r, serialRecord(r));
		let gates = 0;
		const runtime = new ClaudeRuntime({
			cwd: r.root,
			env: { CLAUDE_CODE_VERSION: "2.1.236", CLAUDE_CODE_PERMISSION_MODE: "manual" },
			interactive: true,
			permissionMode: "manual",
			requestConfirmation: async () => { gates++; return { decision: "accept", requestId: "gate" }; },
		});
		const result = await runtime.retireStaleBatch(SLUG, {
			sessionId: "s", toolCallId: "toolu_r", requiresUserInteraction: true, interactive: true, permissionMode: "manual",
			entryToken: "token-1",
		});
		expect(result.state).toBe("retired");
		expect(gates).toBe(0);
		// The retirement records the entry-token act, bound to the retired plan digest.
		const retirement = (Object.values(reports(r))[0] as { retirement?: { confirmation_ref: string; plan_digest: string } }).retirement;
		expect(retirement?.confirmation_ref).toMatch(/^claude-entry-[0-9a-f]{16}$/);
		expect(retirement?.plan_digest).toBe(PLAN_DIGEST);
		expect(retirement?.confirmation_ref).toBe(confirmationRef({
			connectionId: "s",
			toolCallId: "toolu_r",
			requestId: entryTokenRequestId("token-1"),
			operation: "retire_stale_batch",
			initiativeSlug: SLUG,
			planDigest: PLAN_DIGEST,
		}));
	});

	it("a gate-confirmed Claude retirement records a claude-confirm reference", async () => {
		const r = repo();
		write(r, serialRecord(r));
		const runtime = new ClaudeRuntime({
			cwd: r.root,
			env: { CLAUDE_CODE_VERSION: "2.1.236", CLAUDE_CODE_PERMISSION_MODE: "manual" },
			interactive: true,
			permissionMode: "manual",
			requestConfirmation: async () => ({ decision: "accept", requestId: "gate" }),
		});
		const result = await runtime.retireStaleBatch(SLUG, {
			sessionId: "s", toolCallId: "toolu_r", requiresUserInteraction: true, interactive: true, permissionMode: "manual",
		});
		expect(result.state).toBe("retired");
		const retirement = (Object.values(reports(r))[0] as { retirement?: { confirmation_ref: string } }).retirement;
		expect(retirement?.confirmation_ref).toMatch(/^claude-confirm-[0-9a-f]{16}$/);
	});

	/**
	 * The host seam end to end: a literal UserPromptSubmit mints the token, the
	 * PreToolUse hook writes the admission, and tools/call consumes it. Only the
	 * private store location is a fixture.
	 */
	async function seamSession(r: Repo) {
		const store = mkdtempSync(join(tmpdir(), "imm-retire-store-"));
		roots.push(store);
		const base = { session_id: "retire-seam-session", cwd: r.root };
		let gates = 0;
		const mcp = createMcpRuntime({
			cwd: r.root,
			env: { CLAUDE_CODE_VERSION: "2.1.236", CLAUDE_CODE_PERMISSION_MODE: "manual" },
			requestConfirmation: async () => { gates++; return { decision: "accept", requestId: "gate" }; },
			consumePhaseAdmission: (toolCallId: string, operation: GatedTool) => consumePhaseAdmission(toolCallId, operation, store),
		});
		await handleJsonRpc({
			jsonrpc: "2.0", id: 1, method: "initialize",
			params: { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code", version: "2.1.236" }, capabilities: { elicitation: {} } },
		}, mcp);
		return {
			gates: () => gates,
			prompt: (prompt: string) => recordPhaseEntryPrompt({ hook_event_name: "UserPromptSubmit", prompt, ...base }, { root: store, home: store }),
			hook: (toolUseId: string) => phaseEntryGateHookOutput({
				hook_event_name: "PreToolUse", tool_name: "mcp__plugin_immune-brain_immune-brain__retire_stale_batch",
				tool_input: {}, tool_use_id: toolUseId, ...base,
			}, { root: store, home: store }),
			retire: (toolUseId: string) => handleJsonRpc({
				jsonrpc: "2.0", id: 2, method: "tools/call",
				params: { name: "retire_stale_batch", arguments: { initiative_slug: SLUG }, _meta: { "claudecode/toolUseId": toolUseId } },
			}, mcp),
		};
	}

	it("a literal imm-run entry retires through the hook admission and tools/call with no gate, recording an entry reference", async () => {
		const r = repo();
		write(r, serialRecord(r));
		const s = await seamSession(r);
		expect(s.prompt(`/imm-run ${SLUG}`)).toBe(true);
		expect(s.hook("toolu_retire")).toBeNull();
		const reply = await s.retire("toolu_retire");
		expect(reply?.error).toBeUndefined();
		expect(JSON.parse((reply?.result as { content: Array<{ text: string }> }).content[0].text).state).toBe("retired");
		expect(s.gates()).toBe(0);
		const retirement = (Object.values(reports(r))[0] as { retirement?: { confirmation_ref: string; plan_digest: string } }).retirement;
		expect(retirement?.confirmation_ref).toMatch(/^claude-entry-[0-9a-f]{16}$/);
		expect(retirement?.plan_digest).toBe(PLAN_DIGEST);
	});

	it("with no literal entry the hook denies and tools/call refuses retirement with no write", async () => {
		const r = repo();
		write(r, serialRecord(r));
		const before = bytes(r);
		const s = await seamSession(r);
		s.prompt("retire the old batch");
		const denial = JSON.parse(s.hook("toolu_retire")!) as { hookSpecificOutput: { permissionDecision: string } };
		expect(denial.hookSpecificOutput.permissionDecision).toBe("deny");
		const reply = await s.retire("toolu_retire");
		expect(reply?.error?.data?.reason_code).toBe("run_entry_required");
		expect(s.gates()).toBe(0);
		expect(bytes(r).equals(before)).toBe(true);
		expect(reports(r)).toEqual({});
	});

	it("retires a drifted lane record and writes a lane report without handoffs", async () => {
		const r = repo();
		write(r, laneRecord(r));
		const g = gate();
		const outcome = await retireStaleBatch({
			root: r.root,
			initiative_slug: SLUG,
			now: NOW,
			gate: g.run,
		});
		expect(outcome.outcome).toBe("retired");
		if (outcome.outcome !== "retired") throw new Error("expected retired");
		const after = readAnyBatchRunState(r.root, BATCH_ID)!;
		expect(after.contract).toBe("assurance_kernel/batch_run_state/v2");
		expect(after.batch_state).toBe("superseded");
		if (after.contract !== "assurance_kernel/batch_run_state/v2") throw new Error("expected v2");
		// Lane branches and run identity survive as evidence.
		expect(after.children.map((c) => c.lane?.branch ?? null)).toEqual([
			`${BATCH_BRANCH}-parallel-batch-lanes-s1`,
			null,
			null,
		]);
		expect(after.children[0]!.lane?.run_id).toBe("run-s1");
		expect(after.children[1]!.state).toBe("needs_human");const [report] = Object.values(reports(r)) as Array<Record<string, unknown>>;
		expect(report.contract).toBe("assurance_kernel/batch_run_report/v1");
		expect(report.max_parallel).toBe(3);
		expect(report.handoffs).toEqual([]);
		expect(String(report.reason)).toContain("explicit literal-user disposition");
	});

	it("refuses a mid-flight child: a live Kernel run settles before its batch is retired", async () => {
		const r = repo();
		const record = serialRecord(r, {
			children: serialRecord(r).children.map((child, index) => (index === 2 ? { ...child, state: "enrolled" as const } : child)),
		});
		write(r, record);
		const before = bytes(r);
		const g = gate();
		const outcome = await retireStaleBatch({
			root: r.root,
			initiative_slug: SLUG,
			now: NOW,
			gate: g.run,
		});
		expect(outcome.outcome).toBe("rejected");
		if (outcome.outcome !== "rejected") throw new Error("expected rejected");
		expect(outcome.rejection.state).toBe("blocked");
		expect(outcome.rejection.reason).toContain("still mid-flight");
		expect(outcome.rejection.recovery_action).toContain("settle or stop the in-flight child");
		// No gate, no write.
		expect(g.calls).toHaveLength(0);
		expect(bytes(r).equals(before)).toBe(true);
	});

	it("still refuses a mid-flight child whose Kernel run is live", async () => {
		const r = repo();
		const record = serialRecord(r, {
			children: serialRecord(r).children.map((child, index) => (index === 2 ? { ...child, state: "enrolled" as const } : child)),
		});
		write(r, record);
		seedKernelRun(r.root, record.children[2]!.task_id, "active");
		const g = gate();
		const outcome = await retireStaleBatch({ root: r.root, initiative_slug: SLUG, now: NOW, gate: g.run });
		expect(outcome.outcome).toBe("rejected");
		if (outcome.outcome !== "rejected") throw new Error("expected rejected");
		expect(outcome.rejection.reason).toContain("still mid-flight");
		expect(g.calls).toHaveLength(0);
	});

	it("retires a record whose mid-flight child already ended in the Kernel outside the batch", async () => {
		for (const lifecycle of ["done", "stopped"] as const) {
			const r = repo();
			const record = serialRecord(r, {
				children: serialRecord(r).children.map((child, index) => (index === 2 ? { ...child, state: "enrolled" as const } : child)),
			});
			write(r, record);
			const stuck = record.children[2]!.task_id;
			seedKernelRun(r.root, stuck, lifecycle);
			const g = gate();
			const outcome = await retireStaleBatch({ root: r.root, initiative_slug: SLUG, now: NOW, gate: g.run });
			// The gate shows both facts: the record's state and the Kernel's lifecycle.
			expect(g.calls).toHaveLength(1);
			const shown = g.calls[0]!.children.find((child) => child.task_id === stuck)!;
			expect(shown.state).toBe("enrolled");
			expect(shown.kernel_lifecycle).toBe(lifecycle);
			expect(outcome.outcome).toBe("retired");
			if (outcome.outcome !== "retired") throw new Error("expected retired");
			// The child is carried over untouched: no invented settlement or commit.
			const stored = readBatchRunState(r.root, BATCH_ID)!;
			expect(stored.batch_state).toBe("superseded");
			expect(stored.children).toEqual(record.children);
			expect(stored.commits).toEqual(record.commits);
			expect(String(outcome.report.reason)).toContain("had already ended in the Kernel store");
			expect(findExistingActiveBatch(r.root, SLUG)).toBeNull();
		}
	});

	it("refuses a lane child admitted to a lane worktree", async () => {
		const r = repo();
		const record = laneRecord(r);
		write(r, {
			...record,
			children: record.children.map((child, index) =>
				index === 1
					? { ...child, state: "lane_admitted" as const, reason: null, lane: { path: r.root, branch: `${BATCH_BRANCH}-parallel-batch-lanes-s2`, base_head: r.base, lane_commit: null, run_id: "run-s2" } }
					: child,
			),
		});
		const g = gate();
		const outcome = await retireStaleBatch({
			root: r.root,
			initiative_slug: SLUG,
			now: NOW,
			gate: g.run,
		});
		expect(outcome.outcome).toBe("rejected");
		if (outcome.outcome !== "rejected") throw new Error("expected rejected");
		expect(outcome.rejection.reason).toContain("still mid-flight");
		expect(g.calls).toHaveLength(0);
	});

	it("reads a Lane child's run from its own Lane store, bound to the enrolled run", async () => {
		// A Lane child runs under the Lane worktree's Kernel store; a stop there
		// never reaches the coordinator store, so only the Lane store can prove it ended.
		const cases = [
			{ lifecycle: "stopped", runId: "run-s2", coordinator: null, retired: true },
			{ lifecycle: "done", runId: "run-s2", coordinator: null, retired: true },
			{ lifecycle: "active", runId: "run-s2", coordinator: null, retired: false },
			// A terminal run that is not the one the batch enrolled proves nothing.
			{ lifecycle: "stopped", runId: "run-other", coordinator: null, retired: false },
			// A stale terminal coordinator run never overrides what the Lane store holds.
			{ lifecycle: "active", runId: "run-s2", coordinator: "stopped", retired: false },
			{ lifecycle: "stopped", runId: "run-other", coordinator: "stopped", retired: false },
			{ lifecycle: null, runId: "run-s2", coordinator: "stopped", retired: false },
			// A readable Lane store with no run for the task defers to the coordinator store.
			{ lifecycle: "unrelated", runId: "run-s2", coordinator: "stopped", retired: true },
		] as const;
		for (const { lifecycle, runId, coordinator, retired } of cases) {
			const r = repo();
			const laneRoot = realpathSync(mkdtempSync(join(tmpdir(), "imm-disposition-lane-")));
			roots.push(laneRoot);
			const record = laneRecord(r);
			const stuck = record.children[1]!.task_id;
			write(r, {
				...record,
				children: record.children.map((child, index) =>
					index === 1
						? { ...child, state: "enrolled" as const, reason: null, lane: { path: laneRoot, branch: `${BATCH_BRANCH}-${stuck}`, base_head: r.base, lane_commit: null, run_id: "run-s2" } }
						: child,
				),
			});
			// A null Lane lifecycle leaves the Lane with no Kernel store at all.
			if (lifecycle === "unrelated") seedKernelRun(laneRoot, "unrelated-task", "stopped", runId);
			else if (lifecycle !== null) seedKernelRun(laneRoot, stuck, lifecycle, runId);
			if (coordinator !== null) seedKernelRun(r.root, stuck, coordinator, "run-earlier");
			const g = gate();
			const outcome = await retireStaleBatch({ root: r.root, initiative_slug: SLUG, now: NOW, gate: g.run });
			if (!retired) {
				expect(outcome.outcome).toBe("rejected");
				if (outcome.outcome !== "rejected") throw new Error("expected rejected");
				expect(outcome.rejection.reason).toContain(`child ${stuck}`);
				expect(g.calls).toHaveLength(0);
				continue;
			}
			expect(g.calls).toHaveLength(1);
			expect(g.calls[0]!.children.find((child) => child.task_id === stuck)!.kernel_lifecycle).toBe(lifecycle === "unrelated" ? coordinator : lifecycle);
			expect(outcome.outcome).toBe("retired");
			expect(readAnyBatchRunState(r.root, BATCH_ID)!.batch_state).toBe("superseded");
		}
	});

	it("declines and cancels write nothing", async () => {
		for (const key of ["confirmation_declined", "confirmation_cancelled"] as const) {
			const r = repo();
			write(r, serialRecord(r));
			const before = bytes(r);
			const outcome = await retireStaleBatch({
				root: r.root,
				initiative_slug: SLUG,
				now: NOW,
				gate: gate({ decision: { kind: "host_rejection", value: batchReason(key) } }).run,
			});
			// The Host owns the envelope; the disposition passes it through unchanged.
			expect(outcome.outcome).toBe("host_rejection");
			if (outcome.outcome !== "host_rejection") throw new Error("expected host_rejection");
			expect(outcome.value).toMatchObject({ state: key === "confirmation_declined" ? "rejected" : "cancelled" });
			expect(bytes(r).equals(before)).toBe(true);
			expect(reports(r)).toEqual({});
		}
	});

	it("cannot adopt a record that moved while the gate was open", async () => {
		const r = repo();
		write(r, serialRecord(r));
		const g = gate({
			decision: { kind: "confirmed", request_id: "req-1" },
			// A concurrent actor advances the batch while the literal user answers.
			onFacts: () => {
				const record = readBatchRunState(r.root, BATCH_ID)!;
				write(r, { ...record, updated_at: NOW, batch_state: "needs_human" });
			},
		});
		const outcome = await retireStaleBatch({
			root: r.root,
			initiative_slug: SLUG,
			now: NOW,
			gate: g.run,
		});
		expect(outcome.outcome).toBe("rejected");
		if (outcome.outcome !== "rejected") throw new Error("expected rejected");
		expect(outcome.rejection.reason).toContain("changed after native confirmation");
		// The record keeps the other actor's transition, not a partial retirement.
		expect(readBatchRunState(r.root, BATCH_ID)!.batch_state).toBe("needs_human");
	});

	it("has nothing to retire when the Initiative has no active batch", async () => {
		const r = repo();
		const outcome = await retireStaleBatch({
			root: r.root,
			initiative_slug: SLUG,
			now: NOW,
			gate: gate().run,
		});
		expect(outcome.outcome).toBe("rejected");
		if (outcome.outcome !== "rejected") throw new Error("expected rejected");
		expect(outcome.rejection.reason).toContain("no active batch");
	});

	it("has nothing to retire when the newest record is already terminal", async () => {
		const r = repo();
		write(r, serialRecord(r, { batch_state: "failed" }));
		const lookup = readStaleBatchLookup(r.root, SLUG);
		expect(lookup.kind).toBe("terminal");
		const outcome = await retireStaleBatch({
			root: r.root,
			initiative_slug: SLUG,
			now: NOW,
			gate: gate().run,
		});
		expect(outcome.outcome).toBe("rejected");
		if (outcome.outcome !== "rejected") throw new Error("expected rejected");
		expect(outcome.rejection.reason).toContain("already reached a terminal state");
		expect(readBatchRunState(r.root, BATCH_ID)!.batch_state).toBe("failed");
	});

	it("only a superseded record may carry a mid-flight child; other terminal states still refuse it", () => {
		const r = repo();
		const children = serialRecord(r).children.map((child, index) => (index === 2 ? { ...child, state: "enrolled" as const } : child));
		for (const batch_state of ["failed", "rejected", "budget_stopped"] as const)
			expect(() => writeBatchRunState(r.root, serialRecord(r, { batch_state, children }))).toThrow("still mid-flight");
		expect(() => writeBatchRunState(r.root, serialRecord(r, { batch_state: "superseded", children }))).not.toThrow();
	});

	it("a superseded record keeps the retired clock fields out of the written bytes", async () => {
		const r = repo();
		const record = serialRecord(r) as BatchRunStateRecord & { authorization_expires_at?: string };
		record.authorization_expires_at = "2099-01-01T00:00:00.000Z";
		write(r, record);
		const outcome = await retireStaleBatch({
			root: r.root,
			initiative_slug: SLUG,
			now: NOW,
			gate: gate().run,
		});
		expect(outcome.outcome).toBe("retired");
		expect(bytes(r).toString()).not.toContain("authorization_expires_at");
	});
});
