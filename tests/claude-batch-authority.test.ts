import { afterAll, describe, expect, it, mock, spyOn } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { copyGitTemplate } from "./helpers/git-template";
import { createMcpRuntime, elicitationParams, listMcpTools, serveStdio } from "../plugins/immune-brain/runtime/claude/mcp_server";
import { consumePhaseAdmission, phaseEntryGateHookOutput, recordPhaseEntryPrompt, type GatedTool } from "../plugins/immune-brain/runtime/claude/lane_guard";
import { PRIVILEGED_OPERATIONS } from "../plugins/immune-brain/runtime/claude/interaction";
import { ClaudeRuntime, type ToolMeta } from "../plugins/immune-brain/runtime/claude/kernel_ports";
import type { GithubInitiativeObservation } from "../plugins/immune-brain/runtime/github_issue_tracker";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import { seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";
import { readTaskTombstone } from "../plugins/immune-brain/runtime/kernel/backend_claim";
import { readSettledRunEvidence, readTaskRecordRaw } from "../plugins/immune-brain/runtime/kernel/storage";
import { batchTopologyDigest, prepareBatchRunState, prepareBatchLaneRunState, writeBatchRunState, writeBatchLaneRunState, readAnyBatchRunState } from "../plugins/immune-brain/runtime/unattended/batch_state";
import { integrateSettledCriticalSlices } from "../plugins/immune-brain/runtime/unattended/batch_git";
import { retireStaleBatch } from "../plugins/immune-brain/runtime/unattended/batch_disposition";

// Delivery QA has no node_modules; use host seams only when the real package is absent.
try { await import("typebox"); } catch {
	const optional = Symbol("optional");
	mock.module("typebox", () => ({ Type: {
		Array: (items: object) => ({ type: "array", items }), Boolean: () => ({ type: "boolean" }), Literal: (value: unknown) => ({ const: value }), Null: () => ({ type: "null" }),
		Number: (options: object = {}) => ({ type: "number", ...options }),
		Object: (properties: Record<string, any>, options: object = {}) => ({ type: "object", properties,
			required: Object.entries(properties).filter(([, value]) => !value[optional]).map(([key]) => key), ...options }),
		Optional: (schema: Record<string, unknown>) => ({ ...schema, [optional]: true }), Record: (_key: object, value: object) => ({ type: "object", additionalProperties: value }),
		String: (options: object = {}) => ({ type: "string", ...options }), Union: (anyOf: object[]) => ({ anyOf }), Unknown: () => ({}),
	} }));
}
try { await import("@earendil-works/pi-coding-agent"); } catch {
	class DynamicBorder { constructor(private style: (text: string) => string) {} render(width: number) { return [this.style("─".repeat(Math.max(0, width)))]; } }
	mock.module("@earendil-works/pi-coding-agent", () => ({ DynamicBorder }));
}
try { await import("@earendil-works/pi-tui"); } catch {
	class Text { constructor(private text: string) {} setText(text: string) { this.text = text; } render() { return this.text.split("\n"); } invalidate() {} }
	class Container { private children: Array<{ render(width: number): string[] }> = []; addChild(child: { render(width: number): string[] }) { this.children.push(child); }
		render(width: number) { return this.children.flatMap(child => child.render(width)); } invalidate() {} }
	class SelectList {
		onSelect?: (item: any) => void; onCancel?: () => void; private selected = 0; constructor(private items: any[]) {}
		render() { return this.items.map((item, index) => `${index === this.selected ? "> " : "  "}${item.label}`); }
		handleInput(input: string) { if (input === "\u001b[B") this.selected = Math.min(this.items.length - 1, this.selected + 1);
			else if (input === "\u001b[A") this.selected = Math.max(0, this.selected - 1); else if (input === "\r") this.onSelect?.(this.items[this.selected]); else if (input === "\u001b") this.onCancel?.(); }
	}
	mock.module("@earendil-works/pi-tui", () => ({ Container, SelectList, Text,
		sliceByColumn: (text: string, start: number, width?: number) => text.slice(start, width === undefined ? undefined : start + width),
		truncateToWidth: (text: string, width: number, marker = "") => text.length <= width ? text : `${text.slice(0, Math.max(0, width - marker.length))}${marker}`, visibleWidth: (text: string) => text.length,
	}));
}
afterAll(() => mock.restore());
const { executePiUnattendedBatch: runPiBatch } = await import("../plugins/immune-brain/.pi-extension/imm-unattended-batch");
const ENV = { CLAUDE_CODE_VERSION: "2.1.236", CLAUDE_CODE_PERMISSION_MODE: "manual" };
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
const git = (root: string, ...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
function fixture(slug: string) {
	const root = mkdtempSync(join(tmpdir(), "claude-batch-test-")); roots.push(root); copyGitTemplate(root); mkdirSync(join(root, "docs/plans"), { recursive: true });
	for (const [n, risk] of [[1, "routine"], [2, "material"], [3, "critical"]] as const) {
		const task_id = `${slug}-c${n}`;
		writeFileSync(join(root, `docs/plans/${task_id}.intent.json`), `${JSON.stringify({ contract: "assurance_kernel/task_intent/v1", task_id, owner: "user", goal: `child ${n}`,
			acceptance: [{ id: `acc-${n}`, assertion: `c${n} assertion`, verification: "bun test" }],
			scope_hint: [`docs/plans/${task_id}.intent.json`, `docs/specs/${task_id}.spec.md`, `docs/specs/archive/${task_id}.spec.md`], risk, revision: 1 }, null, 2)}\n`);
	}
	git(root, "add", "docs"); git(root, "commit", "-qm", "child intents");
	const observation: GithubInitiativeObservation = { contract: "immune_brain/github_initiative_observation/v1", initiative_id: slug, issue_number: 100,
		tasks: [1, 2, 3].map(n => ({ task_id: `${slug}-c${n}`, slice_id: `S${n}`, issue_number: 100 + n, blocked_by: n === 2 ? [`${slug}-c1`] : [] })) };
	return { root, slug, observation, head: git(root, "rev-parse", "HEAD") };
}
function claim(root: string, task_id: string) {
	const intent = parseTaskIntentV1({ contract: "assurance_kernel/task_intent/v1", task_id, owner: "user", goal: "claim fixture", acceptance: [{ id: "A1", assertion: "a1", verification: "bun test" }], scope_hint: ["docs/plans"], risk: "routine", revision: 1 });
	seedKernelRunForTest(root, { task_id, record: { contract: "assurance_kernel/task_record/v4", task_id, intent_snapshot: intent, intent_ref: { path: `docs/plans/${task_id}.intent.json`, content_hash: canonicalIntentHash(intent) },
		lifecycle: "active", artifact_state: "active", baseline: `sha256:${"a".repeat(64)}`, git_base_head: git(root, "rev-parse", "HEAD"), attestations: [], findings: [], history: [] } });
}
// These tests enter through the real hook. Dedicated phase-entry tests own refusals.
function withRunEntry(workspace: string, prompt = "/imm-run") {
	const root = mkdtempSync(join(tmpdir(), "imm-phase-entry-")); roots.push(root);
	const session = { session_id: "phase-entry-test-session", cwd: workspace };
	recordPhaseEntryPrompt({ hook_event_name: "UserPromptSubmit", prompt, ...session }, { root, home: root });
	return { consumePhaseAdmission(toolCallId: string, operation: GatedTool) {
		phaseEntryGateHookOutput({ hook_event_name: "PreToolUse", tool_name: `mcp__plugin_immune-brain_immune-brain__${operation}`, tool_use_id: toolCallId, ...session }, { root });
		return consumePhaseAdmission(toolCallId, operation, root);
	} };
}
function client(f: ReturnType<typeof fixture>, options: Partial<Parameters<typeof createMcpRuntime>[0]> = {}) {
	const runtime = createMcpRuntime({ ...withRunEntry(f.root), cwd: f.root, env: ENV, interactive: true, readInitiative: async () => f.observation, ...options });
	runtime.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" }); return runtime;
}
function snapshot(root: string) {
	return { head: git(root, "rev-parse", "HEAD"), branch: git(root, "symbolic-ref", "HEAD"), refs: git(root, "show-ref"), index: readFileSync(join(root, ".git/index")), status: git(root, "status", "--porcelain=v1") };
}
function noBatchWrites(root: string) { for (const path of [".imm/state/batch", ".imm/state/batches", ".imm/state/tasks"]) expect(existsSync(join(root, path))).toBe(false); }
function jsonLineReader(output: PassThrough) {
	let buffer = ""; const queue: any[] = [], waiters: Array<(value: any) => void> = [];
	output.on("data", chunk => { buffer += chunk.toString(); while (buffer.includes("\n")) {
		const newline = buffer.indexOf("\n"), line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); if (!line) continue;
		const value = JSON.parse(line), waiter = waiters.shift(); if (waiter) waiter(value); else queue.push(value);
	} });
	return (): Promise<any> => queue.length ? Promise.resolve(queue.shift()) : new Promise(resolve => waiters.push(resolve));
}

describe("record and topology validation before Host batch effects", () => {
	for (const state of ["running", "completed"] as const) for (const reuseOnly of [false, true]) it.each(["claude", "pi"] as const)(
		`%s: preserves ${state} v1 before critical integration (reuseOnly=${reuseOnly})`, async host => {
			const f = fixture(`retired-${host}-${state}-${reuseOnly}`);
			const task = `${f.slug}-c3`, run = `run-${task}`;
			const intent = parseTaskIntentV1(JSON.parse(readFileSync(join(f.root, `docs/plans/${task}.intent.json`), "utf8")));
			const child = { task_id: `${f.slug}-c1`, slice_id: "S1", blocked_by: [], status: "enrollable" as const,
				reason: null, intent_path: `docs/plans/${f.slug}-c1.intent.json`, intent_revision: 1,
				intent_content_hash: canonicalIntentHash(parseTaskIntentV1(JSON.parse(readFileSync(join(f.root, `docs/plans/${f.slug}-c1.intent.json`), "utf8")))) };
			const now = new Date().toISOString();
			const input = { batch_id: "retired-batch", initiative_slug: f.slug, base_head: f.head, branch: "main",
				plan_digest: `sha256:${"a".repeat(64)}`, confirmation_time: now, now,
				budget: { max_children: 1, qa_failure_limit: 2 }, children: [child] };
			const record = prepareBatchRunState(input); record.batch_state = state;
			if (state === "completed") { record.children[0]!.state = "committed"; record.children[0]!.commit = f.head; record.commits = [f.head]; }
			writeBatchRunState(f.root, record);
			// Real Kernel terminal proof and staged delivery that would integrate if
			// a Host reached native critical reconciliation before checking v1.
			seedKernelRunForTest(f.root, { task_id: task, run_id: run, terminal: { lifecycle: "done" }, record: {
				contract: "assurance_kernel/task_record/v4", task_id: task, intent_snapshot: intent,
				intent_ref: { path: `docs/plans/${task}.intent.json`, content_hash: canonicalIntentHash(intent) }, lifecycle: "done", artifact_state: "frozen",
				baseline: `sha256:${"b".repeat(64)}`, git_base_head: f.head, attestations: [], findings: [], history: [],
			} });
			const evidence = readSettledRunEvidence(f.root, task)!;
			const audit = join(f.root, `.imm/audit/${task}/${run}`); mkdirSync(audit, { recursive: true });
			writeFileSync(join(audit, "task-record.json"), evidence.record_json); writeFileSync(join(audit, "terminal-proof.json"), evidence.proof_json);
			mkdirSync(join(f.root, "docs/specs"), { recursive: true }); writeFileSync(join(f.root, `docs/specs/${task}.spec.md`), "# Critical delivery\n");
			git(f.root, "add", `.imm/audit/${task}`, `docs/specs/${task}.spec.md`);
			const path = join(f.root, ".imm/state/batches/retired-batch.json");
			const bytes = readFileSync(path), before = snapshot(f.root); let gates = 0, reads = 0;
			const readInitiative = async () => { reads++; return f.observation; };
			const runtime = client(f, { readInitiative, requestConfirmation: async () => { gates++; return { decision: "decline", requestId: "declined-new-batch" }; } });
			const result = host === "claude"
				? await runtime.runtime.startUnattendedBatch(f.slug, { toolCallId: "retired", interactive: true }, { reuseOnly })
				: await runPiBatch({ root: f.root, initiativeSlug: f.slug, reuseOnly, readInitiative, confirmBatch: async () => { gates++; return "decline"; } });
			if (state === "running") {
				expect(result).toMatchObject({ state: "rejected", reason: expect.stringContaining("batch_record_shape_retired"), recovery_action: expect.stringContaining("retire_stale_batch") });
				expect(gates).toBe(0); expect(reads).toBe(0);
			} else {
				// A terminal history is not a resume: a new v2 batch needs its own
				// authorization, never implicit execution of the old v1 record.
				expect(result.state).not.toBe("started"); expect(reads).toBeGreaterThan(0);
				expect(gates).toBe(reuseOnly ? 0 : 1);
			}
			expect(readFileSync(path)).toEqual(bytes); expect(snapshot(f.root)).toEqual(before);
			if (state === "completed" && !reuseOnly) {
				const next = host === "claude"
					? await client(f, { requestConfirmation: async () => ({ decision: "accept", requestId: "fresh-after-history" }) }).runtime.startUnattendedBatch(f.slug, { toolCallId: "fresh-after-history", interactive: true })
					: await runPiBatch({ root: f.root, initiativeSlug: f.slug, readInitiative: async () => f.observation, confirmBatch: async () => "accept" });
				expect(next.state).toBe("started"); if (next.state !== "started") throw new Error(next.reason);
				expect(next.batch_id).not.toBe(record.batch_id);
				expect(readAnyBatchRunState(f.root, next.batch_id!)).toMatchObject({ contract: "assurance_kernel/batch_run_state/v2", max_parallel: 1 });
				expect(readFileSync(path)).toEqual(bytes); expect(snapshot(f.root).index).toEqual(before.index); expect(snapshot(f.root).head).toBe(before.head);
				return;
			}
			// Positive control: the same eligible critical delivery still integrates
			// for a live v2 record; refusal is not an inert/invalid fixture.
			const live = prepareBatchLaneRunState({ ...input, max_parallel: 1, topology_digest: batchTopologyDigest(f.observation.tasks) });
			live.batch_state = "running"; writeBatchLaneRunState(f.root, live);
			const liveBytes = readFileSync(path);
			const original = structuredClone(f.observation);
			for (const drift of ["dependency", "slice", "removed", "duplicate", "cycle", "identity", "missing-digest"] as const) {
				f.observation = structuredClone(original);
				if (drift === "dependency") f.observation.tasks[2]!.blocked_by = [`${f.slug}-c1`];
				if (drift === "slice") f.observation.tasks[2]!.slice_id = "changed";
				if (drift === "removed") f.observation.tasks.pop();
				if (drift === "duplicate") f.observation.tasks.push(f.observation.tasks[2]!);
				if (drift === "cycle") f.observation.tasks[2]!.blocked_by = [task];
				if (drift === "identity") f.observation.initiative_id = "other-parent";
				if (drift === "missing-digest") { const missing = JSON.parse(liveBytes.toString()); delete missing.topology_digest; writeFileSync(path, JSON.stringify(missing)); }
				const recorded = readFileSync(path); gates = 0;
				const refused = host === "claude"
					? await runtime.runtime.startUnattendedBatch(f.slug, { toolCallId: `topology-${drift}`, interactive: true }, { reuseOnly })
					: await runPiBatch({ root: f.root, initiativeSlug: f.slug, reuseOnly, readInitiative, confirmBatch: async () => { gates++; return "decline"; } });
				expect(refused).toMatchObject({ state: "rejected", reason: expect.stringContaining("batch plan changed") });
				expect(gates).toBe(0); expect(readFileSync(path)).toEqual(recorded); expect(snapshot(f.root)).toEqual(before);
				writeFileSync(path, liveBytes);
			}
			f.observation = original;
			await integrateSettledCriticalSlices(f.root, f.slug, async () => f.observation);
			expect(git(f.root, "rev-parse", "HEAD")).not.toBe(before.head);
			expect(readAnyBatchRunState(f.root, input.batch_id)?.adopted_heads).toHaveLength(1);
		}, 30000);
});

describe("acc-claude-batch-gate", () => {
	it("registers the privileged Lane tool, destructive annotation and supported schema", () => {
		expect(PRIVILEGED_OPERATIONS).toContain("start_unattended_batch"); const tool = listMcpTools().find(t => t.name === "start_unattended_batch")!;
		expect(tool).toBeDefined(); expect(tool.annotations).toEqual({ destructiveHint: true }); expect(tool.description).toContain("Lane"); expect(tool.description).not.toMatch(/serial/i);
		expect(tool.inputSchema.required).toEqual(["initiative_slug"]); expect(Object.keys(tool.inputSchema.properties ?? {})).toEqual(["initiative_slug", "max_parallel", "lane_offers", "final_verification", "lane_instruction"]);
	});
	it.each([undefined, null, {}])("rejects unknown lane_revision at MCP and direct runtime boundaries (%p)", async lane_revision => {
		const f = fixture("retired-revision"); const before = snapshot(f.root); let gates = 0;
		const runtime = client(f, { requestConfirmation: async () => { gates++; return { decision: "accept", requestId: "retired" }; } });
		await expect(runtime.callTool("start_unattended_batch", { initiative_slug: f.slug, lane_revision })).rejects.toThrow("unknown parameter: lane_revision");
		await expect(runtime.runtime.startUnattendedBatch(f.slug, { toolCallId: "retired", interactive: true }, { lane_revision } as never)).rejects.toThrow("unknown parameter: lane_revision");
		expect(gates).toBe(0); expect(snapshot(f.root)).toEqual(before); noBatchWrites(f.root);
	});
	it("refuses non-interactive Claude Code before writes", async () => {
		const f = fixture("non-interactive"); const before = snapshot(f.root);
		const runtime = createMcpRuntime({ cwd: f.root, env: ENV, interactive: false, readInitiative: async () => f.observation });
		runtime.bindClientHandshake({ version: "2.1.236", interactive: false, protocolVersion: "2025-06-18" }); expect(runtime.sessionInteractive()).toBe(false);
		await expect(runtime.callTool("start_unattended_batch", { initiative_slug: f.slug })).rejects.toThrow("unsupported_host"); expect(snapshot(f.root)).toEqual(before); noBatchWrites(f.root);
	});
	for (const max_parallel of [undefined, 1, 2]) it(`derives Lane confirmation from authoritative facts at max_parallel=${max_parallel ?? "omitted"}`, async () => {
		const f = fixture(`content-${max_parallel ?? "default"}`); const confirmations: any[] = [];
		const runtime = client(f, { requestConfirmation: async input => { confirmations.push(input); return { decision: "decline", requestId: "facts" }; } });
		const result = await runtime.callTool("start_unattended_batch", { initiative_slug: f.slug, ...(max_parallel === undefined ? {} : { max_parallel }), model_fake_param: "attacker_attempt" }, { toolCallId: "facts" });
		expect(result.state).toBe("rejected"); expect(confirmations).toHaveLength(1); const input = confirmations[0];
		expect(input.operation).toBe("start_unattended_batch"); expect(input.initiativeSlug).toBe(f.slug); expect(input.planDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
		const message = elicitationParams(input).message;
		expect(message).toContain(`Initiative: ${f.slug}`); expect(message).toContain(`Batch branch: refs/heads/imm/${f.slug}`); expect(message).toContain("Plan digest: sha256:");
		expect(message).toContain("Ordered children (3):"); for (const [n, risk] of [[1, "routine"], [2, "material"], [3, "critical"]]) expect(message).toContain(`${f.slug}-c${n} (S${n}) [risk: ${risk}]`);
		expect(message).not.toContain("Excluded children"); expect(message).not.toContain("attacker_attempt"); expect(message).toContain(`Lane mode: max_parallel=${max_parallel ?? 1}`); expect(message).toContain("Budget: max_children="); expect(message).not.toMatch(/expires|deadline|serial/i);
		expect(input.batchDetails.lane_mode).toMatchObject({ max_parallel: max_parallel ?? 1 }); expect(Array.isArray(input.batchDetails.lane_mode.parallel_groups)).toBe(true);
		expect(JSON.stringify(input.batchDetails)).not.toMatch(/delegat/i);
		expect(elicitationParams(input).requestedSchema).toEqual({ type: "object", properties: {} });
		expect(message).not.toMatch(/delegat/i);
		noBatchWrites(f.root);
	});
	it("one accepted confirmation issues a Lane authorization", async () => {
		const f = fixture("accept-exec"); let gates = 0; const runtime = client(f, { requestConfirmation: async () => { gates++; return { decision: "accept", requestId: "accept" }; } });
		const result = await runtime.callTool("start_unattended_batch", { initiative_slug: f.slug }, { toolCallId: "accept" });
		expect(gates).toBe(1); expect(result.state).toBe("started"); expect(result.batch_id).toMatch(/^batch-accept-exec-[0-9a-f-]{36}$/);
		expect(result.report).toMatchObject({ initiative_slug: f.slug, batch_state: "running", max_parallel: 1 });
	});
	it("a delayed answer is accepted without time-based authorization fields", async () => {
		const f = fixture("claude-ttl"); let clock: ReturnType<typeof spyOn> | undefined; const shown: any[] = [];
		const runtime = client(f, { requestConfirmation: async input => { shown.push(input.batchDetails); clock = spyOn(Date, "now").mockReturnValue(Date.now() + 365 * 24 * 60 * 60 * 1000); return { decision: "accept", requestId: "ttl" }; } });
		const result = await runtime.callTool("start_unattended_batch", { initiative_slug: f.slug }, { toolCallId: "ttl" }).finally(() => clock?.mockRestore());
		expect(result.state).toBe("started"); expect(shown[0]).not.toHaveProperty("expires_at"); expect(Object.keys(shown[0].budget).sort()).toEqual(["max_children", "qa_failure_limit"]);
		const record = JSON.parse(readFileSync(join(f.root, `.imm/state/batches/${result.batch_id}.json`), "utf8")); expect(record).not.toHaveProperty("authorization_expires_at"); expect(record.budget).toEqual(shown[0].budget);
	});
});

describe("acc-claude-batch-fail-closed", () => {
	it.each(["decline", "cancel"] as const)("%s preserves index, refs and unrelated dirty bytes", async decision => {
		const f = fixture(`decision-${decision}`); writeFileSync(join(f.root, "staged.txt"), "staged\n"); git(f.root, "add", "staged.txt"); writeFileSync(join(f.root, "staged.txt"), "unstaged\n");
		const runtime = client(f, { requestConfirmation: async () => ({ decision, requestId: "decision" }) }); const before = snapshot(f.root);
		const result = await runtime.callTool("start_unattended_batch", { initiative_slug: f.slug }, { toolCallId: "decision" });
		expect(result).toEqual({ state: decision === "decline" ? "rejected" : "cancelled", reason: `native interaction ${decision === "decline" ? "declined" : "cancelled"}`, recovery_action: "wait for a fresh literal-user request" });
		expect(snapshot(f.root)).toEqual(before); expect(readFileSync(join(f.root, "staged.txt"), "utf8")).toBe("unstaged\n"); noBatchWrites(f.root);
	});
	it.each(["subject", "dependency"])("rejects %s drift after native confirmation", async drift => {
		const f = fixture(`drift-${drift}`); let confirmed = false, gates = 0;
		const runtime = client(f, { readInitiative: async () => confirmed && drift === "dependency" ? { ...f.observation, tasks: f.observation.tasks.map(t => ({ ...t, blocked_by: [] })) } : f.observation,
			requestConfirmation: async () => { gates++; confirmed = true; if (drift === "subject") { const path = join(f.root, `docs/plans/${f.slug}-c1.intent.json`); const intent = JSON.parse(readFileSync(path, "utf8")); intent.goal = "different goal"; writeFileSync(path, `${JSON.stringify(intent, null, 2)}\n`); } return { decision: "accept", requestId: "drift" }; } });
		const result = await runtime.callTool("start_unattended_batch", { initiative_slug: f.slug }, { toolCallId: "drift" });
		expect(gates).toBe(1); expect(result.state).toBe("rejected"); expect(result.reason).toContain("batch plan changed after native confirmation"); expect(result.recovery_action).toContain("fresh native gate"); noBatchWrites(f.root);
	});
	it("active workspace claim rejects before the gate without changing its record", async () => {
		const f = fixture("claim-block"); claim(f.root, "foreign-task"); const revision = readTaskRecordRaw(f.root, "foreign-task").revision; let gates = 0;
		const runtime = client(f, { requestConfirmation: async () => { gates++; return { decision: "accept", requestId: "claim" }; } });
		const result = await runtime.callTool("start_unattended_batch", { initiative_slug: f.slug });
		expect(gates).toBe(0); expect(result.state).toBe("blocked"); expect(result.reason).toContain("foreign-task"); expect(result.recovery_action).toContain("resolve or stop the active task");
		expect(readTaskRecordRaw(f.root, "foreign-task").revision).toBe(revision); expect(existsSync(join(f.root, ".imm/state/batches"))).toBe(false);
	});
	it("conflicting Parent branch fails before the gate with refs unchanged", async () => {
		const f = fixture("branch-conflict"); git(f.root, "branch", `imm/${f.slug}`, "HEAD~1"); let gates = 0; const before = snapshot(f.root);
		const runtime = client(f, { requestConfirmation: async () => { gates++; return { decision: "accept", requestId: "branch" }; } });
		const result = await runtime.callTool("start_unattended_batch", { initiative_slug: f.slug });
		expect(gates).toBe(0); expect(result.state).toBe("rejected"); expect(result.reason).toContain("branch"); expect(result.recovery_action).toContain("branch"); expect(snapshot(f.root)).toEqual(before); noBatchWrites(f.root);
	});
	it("critical-only Parent opens the ordinary batch gate", async () => {
		const f = fixture("critical-only"); let message = ""; const runtime = client(f, { readInitiative: async () => ({ ...f.observation, tasks: f.observation.tasks.slice(2) }),
			requestConfirmation: async input => { message = elicitationParams(input).message; return { decision: "decline", requestId: "critical" }; } });
		expect((await runtime.callTool("start_unattended_batch", { initiative_slug: f.slug })).state).toBe("rejected"); expect(message).toContain(`${f.slug}-c3 (S3) [risk: critical]`); noBatchWrites(f.root);
	});
	it("Local Slice dependency refusal precedes Claude Enrollment's native gate", async () => {
		const f = fixture("boundary-local-dependency"); let gates = 0;
		if (git(f.root, "remote").split("\n").includes("origin")) git(f.root, "remote", "remove", "origin");
		mkdirSync(join(f.root, "docs/initiatives"), { recursive: true });
		writeFileSync(join(f.root, `docs/initiatives/${f.slug}.md`), `# Parent\n## S1: predecessor\nTasks:\n- ${f.slug}-c1\n## S2: target\nTasks:\n- ${f.slug}-c2\nBlocked by: ${f.slug}-c1\n`);
		const runtime = client(f, { ...withRunEntry(f.root, `/imm-run ${f.slug}-c2`), requestConfirmation: async () => { gates++; return { decision: "accept", requestId: "local" }; } });
		await expect(runtime.callTool("enroll", { task_id: `${f.slug}-c2` })).rejects.toThrow(`Isolated Slice prerequisites are not integrated: ${f.slug}-c1`);
		expect(gates).toBe(0);
	});
	it("status remains usable after a rejected batch", async () => {
		const f = fixture("status-usable"); const runtime = client(f, { requestConfirmation: async () => ({ decision: "decline", requestId: "status" }) });
		expect((await runtime.callTool("start_unattended_batch", { initiative_slug: f.slug })).state).toBe("rejected");
		const status = await runtime.callTool("status", { task_id: `${f.slug}-c1` }); expect(status.plugin_version).toBeDefined(); expect(status.projection).toMatchObject({ lifecycle: "", next_obligation: "none" });
	});
	it("cancellation during revalidation produces zero writes", async () => {
		const f = fixture("cancel-reval"); const controller = new AbortController(); const before = snapshot(f.root);
		const runtime = client(f, { requestConfirmation: async () => { controller.abort(); return { decision: "accept", requestId: "cancel" }; } });
		const result = await runtime.callTool("start_unattended_batch", { initiative_slug: f.slug }, { toolCallId: "cancel", signal: controller.signal });
		expect(result).toEqual({ state: "cancelled", reason: "user cancelled before batch execution", recovery_action: "wait for a fresh literal-user request" }); expect(snapshot(f.root)).toEqual(before); noBatchWrites(f.root);
	});
	it("a claim appearing during revalidation blocks with no batch effects", async () => {
		const f = fixture("claim-race"); let reads = 0;
		const runtime = client(f, { readInitiative: async () => { if (++reads === 2) claim(f.root, "concurrent-task"); return f.observation; }, requestConfirmation: async () => ({ decision: "accept", requestId: "race" }) });
		const result = await runtime.callTool("start_unattended_batch", { initiative_slug: f.slug }, { toolCallId: "race" });
		expect(result.state).toBe("blocked"); expect(result.reason).toContain("concurrent-task"); expect(result.recovery_action).toContain("resolve or stop"); expect(git(f.root, "branch", "--list", `imm/${f.slug}`)).toBe(""); expect(existsSync(join(f.root, ".imm/state/batches"))).toBe(false);
	});
	it("HEAD movement during revalidation rejects without batch writes", async () => {
		const f = fixture("head-race"); let reads = 0;
		const runtime = client(f, { readInitiative: async () => { if (++reads === 2) { writeFileSync(join(f.root, "outside.txt"), "external"); git(f.root, "add", "outside.txt"); git(f.root, "commit", "-qm", "external"); } return f.observation; }, requestConfirmation: async () => ({ decision: "accept", requestId: "head" }) });
		const result = await runtime.callTool("start_unattended_batch", { initiative_slug: f.slug }, { toolCallId: "head" });
		expect(result.state).toBe("rejected"); expect(result.reason).toContain("Git HEAD moved after native confirmation"); expect(result.recovery_action).toContain("fresh native gate"); noBatchWrites(f.root);
	});
	it("a prerequisite tombstone without audited record refuses before the gate", async () => {
		const f = fixture("settled-prereq"); const path = join(f.root, `.imm/audit/${f.slug}-c1/terminal-proof.json`); mkdirSync(join(f.root, `.imm/audit/${f.slug}-c1`), { recursive: true });
		writeFileSync(path, `${JSON.stringify({ contract: "assurance_kernel/task_tombstone/v2", task_id: `${f.slug}-c1`, lifecycle_status: "terminal", terminal_lifecycle: "done", terminal_event_id: "complete:settled:2099-01-01T00:00:00.000Z", final_record_hash: `sha256:${"b".repeat(64)}`, terminalized_at: "2099-01-01T00:00:00.000Z" }, null, 2)}\n`);
		git(f.root, "add", ".imm/audit"); git(f.root, "commit", "-qm", "audit"); const bytes = readFileSync(path), before = snapshot(f.root); let gates = 0;
		const runtime = client(f, { requestConfirmation: async () => { gates++; return { decision: "accept", requestId: "audit" }; } });
		await expect(runtime.callTool("start_unattended_batch", { initiative_slug: f.slug }, { toolCallId: "audit" })).rejects.toThrow("terminal audit pair is incomplete");
		expect(gates).toBe(0); expect(readFileSync(path)).toEqual(bytes); expect(snapshot(f.root)).toEqual(before); noBatchWrites(f.root);
	});
});

describe("Claude wire native authority", () => {
	it.each([false, true])("wire correlation and live-only elicitation (correlated: %p)", async correlated => {
		const f = fixture(`wire-${correlated}`), input = new PassThrough(), output = new PassThrough(), next = jsonLineReader(output);
		const server = serveStdio({ input, output, runtime: createMcpRuntime({ ...withRunEntry(f.root), cwd: f.root, env: ENV, readInitiative: async () => f.observation }), exit: () => undefined });
		const send = (message: unknown) => input.write(`${JSON.stringify(message)}\n`);
		send({ jsonrpc: "2.0", id: "init", method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code", version: "2.1.236" }, capabilities: { elicitation: {} } } }); await next();
		send({ jsonrpc: "2.0", id: "outer", method: "tools/call", params: { name: "start_unattended_batch", arguments: { initiative_slug: f.slug }, ...(correlated ? { _meta: { "claudecode/toolUseId": "wire" } } : {}) } });
		if (!correlated) { expect(JSON.stringify(await next())).toContain("correlation_missing"); }
		else {
			const elicitation = await next(); send({ jsonrpc: "2.0", id: "old-request-id", result: { action: "accept" } }); const settled = next();
			expect(await Promise.race([settled, new Promise(resolve => setTimeout(() => resolve("still waiting"), 200))])).toBe("still waiting");
			send({ jsonrpc: "2.0", id: elicitation.id, result: { action: "decline" } }); const result = JSON.stringify(await settled);
			expect(result).toContain("native interaction declined"); expect(result).toContain("rejected");
		}
		input.end(); await server; noBatchWrites(f.root);
	});
});

describe("Lane preflight preserves coordinator bytes", () => {
	for (const host of ["claude", "pi"] as const) {
		const start = (f: ReturnType<typeof fixture>, decision: "accept" | "decline" | "cancel", counter: { gates: number }) => host === "claude"
			? client(f, { requestConfirmation: async () => { counter.gates++; return { decision, requestId: "preflight" }; } }).callTool("start_unattended_batch", { initiative_slug: f.slug })
			: runPiBatch({ root: f.root, initiativeSlug: f.slug, readInitiative: async () => f.observation, confirmBatch: async () => { counter.gates++; return decision; } });
		for (const decision of ["accept", "decline", "cancel"] as const) it(`${host}: ${decision} never commits or changes a dirty index in the coordinator`, async () => {
			const f = fixture(`dirt-${host}-${decision}`); writeFileSync(join(f.root, "outside.txt"), "staged\n"); git(f.root, "add", "outside.txt"); writeFileSync(join(f.root, "outside.txt"), "unstaged\n");
			const before = snapshot(f.root); const counter = { gates: 0 }; const result = await start(f, decision, counter);
			expect(counter.gates).toBe(1); expect(result.state).toBe(decision === "accept" ? "started" : decision === "decline" ? "rejected" : "cancelled");
			expect(git(f.root, "rev-parse", "HEAD")).toBe(before.head); expect(git(f.root, "symbolic-ref", "HEAD")).toBe(before.branch); expect(readFileSync(join(f.root, ".git/index"))).toEqual(before.index);
			expect(readFileSync(join(f.root, "outside.txt"), "utf8")).toBe("unstaged\n"); if (decision !== "accept") { expect(snapshot(f.root)).toEqual(before); noBatchWrites(f.root); }
		});
		it(`${host}: a failing pre-commit hook cannot commit coordinator preconditions`, async () => {
			const f = fixture(`hook-${host}`); git(f.root, "config", "core.hooksPath", ".git/hooks"); const path = join(f.root, ".git/hooks/pre-commit"); writeFileSync(path, "#!/bin/sh\nexit 1\n"); execFileSync("chmod", ["+x", path]);
			const before = snapshot(f.root), counter = { gates: 0 }; const result = await start(f, "accept", counter);
			expect(result.state).toBe("started"); expect(counter.gates).toBe(1); expect(git(f.root, "rev-parse", "HEAD")).toBe(before.head); expect(readFileSync(join(f.root, ".git/index"))).toEqual(before.index);
		});
		for (const tracking of ["tracked", "all-untracked", "mixed"] as const) it(`${host}: ${tracking} intents and coordinator dirt stay untouched`, async () => {
			const f = fixture(`tracking-${host}-${tracking}`); const paths = [1, 2].map(n => `docs/plans/${f.slug}-c${n}.intent.json`); const removed = tracking === "tracked" ? [] : tracking === "mixed" ? paths.slice(1) : paths;
			if (removed.length) { git(f.root, "rm", "--cached", ...removed); git(f.root, "commit", "-qm", "untracked intents"); }
			writeFileSync(join(f.root, "outside.txt"), "draft"); const before = snapshot(f.root), bytes = paths.map(path => readFileSync(join(f.root, path))), counter = { gates: 0 };
			const result = await start(f, "accept", counter); expect(result.state).toBe("started"); expect(counter.gates).toBe(1); expect(git(f.root, "rev-parse", "HEAD")).toBe(before.head);
			expect(readFileSync(join(f.root, ".git/index"))).toEqual(before.index); paths.forEach((path, i) => expect(readFileSync(join(f.root, path))).toEqual(bytes[i])); expect(readFileSync(join(f.root, "outside.txt"), "utf8")).toBe("draft");
		});
		it(`${host}: arbitrary in-scope coordinator bytes never become Lane delivery`, async () => {
			const f = fixture(`scope-${host}`), path = join(f.root, "src/task.ts");
			const intentPath = join(f.root, `docs/plans/${f.slug}-c1.intent.json`), intent = JSON.parse(readFileSync(intentPath, "utf8")); intent.scope_hint.push("src/");
			writeFileSync(intentPath, `${JSON.stringify(intent, null, 2)}\n`); git(f.root, "add", intentPath); git(f.root, "commit", "-qm", "source scope");
			mkdirSync(join(f.root, "src"), { recursive: true }); writeFileSync(path, "coordinator draft\n");
			const counter = { gates: 0 }; const result: any = await start(f, "accept", counter); expect(result.state).toBe("started"); expect(counter.gates).toBe(1); expect(readFileSync(path, "utf8")).toBe("coordinator draft\n");
			const handoff = result.report.handoffs.find((h: any) => h.task_id === `${f.slug}-c1`); expect(handoff).toBeDefined(); expect(existsSync(join(handoff.lane_path, "src/task.ts"))).toBe(false);
		});
	}
});

const normalize = (value: unknown, f: { root: string; head: string }) => JSON.parse(JSON.stringify(value, (key, item) => key === "run_id" || key === "record_revision" ? `<${key}>` : item)
	.split(realpathSync(f.root)).join("<root>").split(f.head).join("<head>").replace(/batch-[A-Za-z0-9._-]+?-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<batch>").replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, "<time>"));
describe("lane mode parameters and resume", () => {
	for (const drift of ["dependency", "slice"] as const) it.each(["claude", "pi"] as const)(
		`%s: fresh default Lane authorization after retirement and ${drift} drift`, async host => {
			const f = fixture(`fresh-${host}-${drift}`), now = new Date().toISOString();
			const branch = `refs/heads/imm/${f.slug}`; git(f.root, "update-ref", branch, f.head);
			const record = prepareBatchLaneRunState({ batch_id: "old-batch", initiative_slug: f.slug, base_head: f.head, branch,
				plan_digest: `sha256:${"a".repeat(64)}`, topology_digest: batchTopologyDigest(f.observation.tasks),
				confirmation_time: now, now, max_parallel: 1, budget: { max_children: 3, qa_failure_limit: 2 },
				children: f.observation.tasks.map(task => ({ ...task, status: "enrollable" as const, reason: null,
					intent_path: `docs/plans/${task.task_id}.intent.json`, intent_revision: 1,
					intent_content_hash: canonicalIntentHash(parseTaskIntentV1(JSON.parse(readFileSync(join(f.root, `docs/plans/${task.task_id}.intent.json`), "utf8")))) })) });
			record.batch_state = "running"; writeBatchLaneRunState(f.root, record);
			if (drift === "dependency") f.observation.tasks[1]!.blocked_by = [];
			else f.observation.tasks[1]!.slice_id = "changed";
			let gates = 0;
			const runtime = client(f, { requestConfirmation: async () => { gates++; return { decision: "accept", requestId: "fresh" }; } });
			const start = (): Promise<any> => host === "claude"
				? runtime.runtime.startUnattendedBatch(f.slug, { toolCallId: "fresh", interactive: true })
				: runPiBatch({ root: f.root, initiativeSlug: f.slug, readInitiative: async () => f.observation,
					confirmBatch: async () => { gates++; return "accept"; } });
			const path = join(f.root, ".imm/state/batches/old-batch.json"), activeBytes = readFileSync(path), before = snapshot(f.root);
			expect(await start()).toMatchObject({ state: "rejected", reason: expect.stringContaining("batch plan changed") });
			expect(gates).toBe(0); expect(readFileSync(path)).toEqual(activeBytes); expect(snapshot(f.root)).toEqual(before);
			const retired = await retireStaleBatch({ root: f.root, initiative_slug: f.slug, now,
				gate: async () => ({ kind: "accepted", request_id: "retire", confirmation_ref: "retire" }) });
			expect(retired.outcome).toBe("retired");
			const terminalBytes = readFileSync(path);
			const next = await start();
			expect(next.state).toBe("started"); expect(gates).toBe(1); expect(next.batch_id).not.toBe(record.batch_id);
			expect(readAnyBatchRunState(f.root, next.batch_id)).toMatchObject({ contract: "assurance_kernel/batch_run_state/v2", max_parallel: 1 });
			expect(readFileSync(path)).toEqual(terminalBytes); expect(git(f.root, "rev-parse", "HEAD")).toBe(before.head);
		}, 30000);
	it("refuses invalid max_parallel and malformed Lane offers before any gate", async () => {
		const f = fixture("lane-invalid"); let gates = 0; const runtime = client(f, { requestConfirmation: async () => { gates++; return { decision: "accept", requestId: "invalid" }; } });
		for (const extra of [{ max_parallel: 0 }, { max_parallel: -1 }, { max_parallel: 1.5 }, { max_parallel: "1" }, { lane_offers: [{ task_id: `${f.slug}-c1`, path: "/tmp/x" }] },
			{ max_parallel: 1, lane_offers: [{ task_id: `${f.slug}-c1`, path: "relative" }] }, { max_parallel: 1, lane_offers: [{ task_id: "../escape", path: "/tmp/x" }] }, { max_parallel: 1, lane_offers: [{ task_id: `${f.slug}-c1`, path: "/tmp/x", extra: 1 }] }]) {
			await expect(runtime.callTool("start_unattended_batch", { initiative_slug: f.slug, ...extra })).rejects.toThrow(); expect(gates).toBe(0); noBatchWrites(f.root);
		}
	});
	it("accepts max_parallel above 1 through one gate", async () => {
		const f = fixture("lane-wide"); let gates = 0; const runtime = client(f, { requestConfirmation: async () => { gates++; return { decision: "accept", requestId: "wide" }; } });
		const result = await runtime.callTool("start_unattended_batch", { initiative_slug: f.slug, max_parallel: 2 }); expect(gates).toBe(1); expect(result.state).toBe("started");
	});
	for (const max_parallel of [1, 2, 3]) it(`both Hosts give equal Lane reports at max_parallel=${max_parallel}`, async () => {
		const slug = `lane-parity-${max_parallel}`, claude = fixture(slug), pi = fixture(slug);
		const runtime = client(claude, { requestConfirmation: async () => ({ decision: "accept", requestId: "parity" }) });
		const a = await runtime.callTool("start_unattended_batch", { initiative_slug: slug, max_parallel });
		const b = await runPiBatch({ root: pi.root, initiativeSlug: slug, max_parallel, readInitiative: async () => pi.observation, confirmBatch: async () => "accept" });
		expect(a.state).toBe("started"); expect(b.state).toBe("started"); if (b.state !== "started") throw new Error(b.reason);
		expect(a.report.max_parallel).toBe(max_parallel); expect(a.report.handoffs[0]).toMatchObject({ role: "executor", task_id: `${slug}-c1`, next_obligation: "submit_assurance" }); expect(a.report).not.toHaveProperty("handoff");
		expect(normalize(a.report.handoffs, claude)).toEqual(normalize(b.report.handoffs, pi)); expect(normalize(a.report, claude)).toEqual(normalize(b.report, pi));
	}, 30000);
	for (const max_parallel of [1, 2]) it(`omitted max_parallel reuses ${max_parallel}-Lane authorization in both Hosts`, async () => {
		const slug = `lane-resume-${max_parallel}`, claude = fixture(slug), pi = fixture(slug); let claudeGates = 0, piGates = 0;
		const runtime = client(claude, { requestConfirmation: async () => { claudeGates++; return { decision: "accept", requestId: "resume" }; } });
		const options = { root: pi.root, initiativeSlug: slug, readInitiative: async () => pi.observation, confirmBatch: async () => { piGates++; return "accept" as const; } };
		const first = await runtime.callTool("start_unattended_batch", { initiative_slug: slug, max_parallel }); await runPiBatch({ ...options, max_parallel });
		const a = await runtime.callTool("start_unattended_batch", { initiative_slug: slug }), b = await runPiBatch(options);
		expect(a.state).toBe("started"); expect(b.state).toBe("started"); if (b.state !== "started") throw new Error(b.reason);
		expect(a.batch_id).toBe(first.batch_id); expect(a.report.max_parallel).toBe(max_parallel); expect(b.report.max_parallel).toBe(max_parallel);
		expect(claudeGates).toBe(1); expect(piGates).toBe(1); expect(normalize(a.report, claude)).toEqual(normalize(b.report, pi));
		const path = join(claude.root, `.imm/state/batches/${a.batch_id}.json`), bytes = readFileSync(path);
		expect(JSON.stringify(await runtime.callTool("start_unattended_batch", { initiative_slug: slug, max_parallel: max_parallel + 1 }))).toContain("batch_parallel_mismatch");
		expect(claudeGates).toBe(1); expect(readFileSync(path)).toEqual(bytes);
	}, 30000);
	it("refuses lane_offers on fresh and default-one Lane starts without another gate", async () => {
		const f = fixture("lane-offers"); let gates = 0; const runtime = client(f, { requestConfirmation: async () => { gates++; return { decision: "accept", requestId: "offers" }; } });
		await expect(runtime.callTool("start_unattended_batch", { initiative_slug: f.slug, lane_offers: [] })).rejects.toThrow(); expect(gates).toBe(0); noBatchWrites(f.root);
		await runtime.callTool("start_unattended_batch", { initiative_slug: f.slug });
		await expect(runtime.callTool("start_unattended_batch", { initiative_slug: f.slug, lane_offers: [] })).rejects.toThrow(); expect(gates).toBe(1);
	});
	for (const host of ["claude", "pi"] as const) for (const scenario of ["user-amend", "digest-corrupt", "foreign-claim", "terminal-history"] as const) it(`${host}: Lane reuse protects ${scenario}`, async () => {
		const f = fixture(`reuse-${host}-${scenario}`); let gates = 0;
		const runtime = client(f, { requestConfirmation: async () => { gates++; return { decision: "accept", requestId: "reuse" }; } });
		const options = { root: f.root, initiativeSlug: f.slug, readInitiative: async () => f.observation, confirmBatch: async () => { gates++; return "accept" as const; } };
		const run = (): Promise<any> => host === "claude" ? runtime.callTool("start_unattended_batch", { initiative_slug: f.slug }) : runPiBatch(options);
		const first = await run(); expect(first.state).toBe("started"); expect(gates).toBe(1);
		const path = join(f.root, `.imm/state/batches/${first.batch_id}.json`), record = JSON.parse(readFileSync(path, "utf8"));
		if (scenario === "user-amend") {
			writeFileSync(join(f.root, "outside.txt"), "user commit"); git(f.root, "add", "outside.txt"); git(f.root, "commit", "-qm", "user commit"); git(f.root, "commit", "--amend", "--no-edit", "-q");
		} else if (scenario === "digest-corrupt") {
			record.plan_digest = `sha256:${"f".repeat(64)}`; writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
		} else if (scenario === "foreign-claim") claim(f.root, "foreign-task");
		else {
			const head = git(f.root, "rev-parse", "HEAD"), lane = record.children.find((child: any) => child.lane)?.lane;
			record.batch_state = "completed"; record.commits = [head];
			for (const child of record.children) { child.state = "released"; child.commit = head; child.lane = { ...lane, lane_commit: head }; }
			writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
			const intent = JSON.parse(readFileSync(join(f.root, `docs/plans/${f.slug}-c1.intent.json`), "utf8")); intent.task_id = `${f.slug}-c4`;
			writeFileSync(join(f.root, `docs/plans/${intent.task_id}.intent.json`), `${JSON.stringify(intent, null, 2)}\n`);
			f.observation.tasks = [{ task_id: intent.task_id, slice_id: "S4", issue_number: 104, blocked_by: [] }];
		}
		const bytes = readFileSync(path), before = snapshot(f.root); const next = await run();
		if (scenario === "digest-corrupt" || scenario === "foreign-claim") {
			expect(next.state).toBe(scenario === "foreign-claim" ? "blocked" : "rejected"); expect(next.reason).toContain(scenario === "foreign-claim" ? "foreign-task" : "plan");
			expect(readFileSync(path)).toEqual(bytes); expect(snapshot(f.root)).toEqual(before); expect(gates).toBe(1);
		} else {
			expect(next.state).toBe("started"); expect(next.report.max_parallel).toBe(1); expect(git(f.root, "rev-parse", "HEAD")).toBe(before.head);
			if (scenario === "user-amend") { expect(next.batch_id).toBe(first.batch_id); expect(gates).toBe(1); }
			else { expect(next.batch_id).not.toBe(first.batch_id); expect(gates).toBe(2); expect(readFileSync(path)).toEqual(bytes); }
		}
	}, 30000);
	it("reads no workspace-tool environment variables in either Host adapter or Lane runtime", () => {
		for (const file of ["plugins/immune-brain/.pi-extension/imm-unattended-batch.ts", "plugins/immune-brain/runtime/claude/mcp_server.ts", "plugins/immune-brain/runtime/unattended/batch_lanes.ts", "plugins/immune-brain/runtime/unattended/batch_integration.ts"]) {
			expect({ file, herdr: /HERDR/i.test(readFileSync(join(import.meta.dir, "..", file), "utf8")) }).toEqual({ file, herdr: false });
		}
	});
});

describe("post-settlement tracker projection", () => {
	it("keeps the committed mutation when tracker projection throws", async () => {
		const f = fixture("tracker-throw"), taskId = `${f.slug}-c1`;
		const runtime = new ClaudeRuntime({ cwd: f.root, env: ENV, interactive: true, permissionMode: "manual", requestConfirmation: async ({ operation }) => ({ decision: "accept", requestId: `nested-${operation}` }) });
		const meta = (toolCallId: string): ToolMeta => ({ taskId, sessionId: "s", toolCallId, requiresUserInteraction: true, interactive: true, permissionMode: "manual" });
		await runtime.enroll(taskId, meta("enroll")); const realStatus = runtime.status.bind(runtime); let forced = 0;
		runtime.status = (async id => { if (readTaskTombstone(f.root, id)) { forced++; throw new Error("terminal-tracker projection failed"); } return realStatus(id); }) as ClaudeRuntime["status"];
		const result = await runtime.authorize(taskId, "stop", meta("stop")); expect(forced).toBe(1); expect(result.record.lifecycle).toBe("stopped");
		expect((result as { tracker?: unknown }).tracker).toMatchObject({ operation: "mark-terminal", status: "retryable_failure" }); expect(readTaskTombstone(f.root, taskId)?.terminal_lifecycle).toBe("stopped"); expect(readTaskRecordRaw(f.root, taskId).record).toBeNull();
	});
});
