import { afterAll, afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

// Delivery QA has no Host peer packages. These seams are never installed over a
// real package; the native dialog double below does not instantiate TUI widgets.
try { await import("typebox"); } catch {
	const optional = Symbol("optional");
	mock.module("typebox", () => ({ Type: {
		String: (options = {}) => ({ type: "string", ...options }), Number: () => ({ type: "number" }),
		Boolean: () => ({ type: "boolean" }), Null: () => ({ type: "null" }), Unknown: () => ({}),
		Literal: (value: unknown) => ({ const: value }), Array: (items: object) => ({ type: "array", items }),
		Union: (anyOf: object[]) => ({ anyOf }), Optional: (schema: object) => ({ ...schema, [optional]: true }),
		Record: (_key: object, value: object) => ({ type: "object", additionalProperties: value }),
		Object: (properties: Record<string, any>, options = {}) => ({ type: "object", properties,
			required: Object.entries(properties).filter(([, value]) => !value[optional]).map(([key]) => key), ...options }),
	} }));
}
try { await import("@earendil-works/pi-coding-agent"); } catch {
	mock.module("@earendil-works/pi-coding-agent", () => ({ DynamicBorder: class {} }));
}
try { await import("@earendil-works/pi-tui"); } catch {
	mock.module("@earendil-works/pi-tui", () => ({ Text: class {}, Container: class {}, SelectList: class {},
		sliceByColumn: (s: string, start: number, width?: number) => s.slice(start, width === undefined ? undefined : start + width),
		truncateToWidth: (s: string, width: number) => s.slice(0, width), visibleWidth: (s: string) => s.length }));
}
const { default: registerPiBatch } = await import("../plugins/immune-brain/.pi-extension/imm-unattended-batch");
const { createPiAssuranceProgressionPorts } = await import("../plugins/immune-brain/.pi-extension/imm-canary-work");
import { AssuranceProgression } from "../plugins/immune-brain/.pi-extension/pi-canary-assurance-progression";
import { createMcpRuntime } from "../plugins/immune-brain/runtime/claude/mcp_server";
import { diffSnapshotOf } from "../plugins/immune-brain/runtime/claude/kernel_ports";
import { canonicalIntentHash, parseTaskIntentV1, readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import { capabilityActionFor, createCanaryApplication } from "../plugins/immune-brain/runtime/kernel/canary_application";
import { digestOfAction } from "../plugins/immune-brain/runtime/kernel/authority_port";
import { createTestMutationRegistry, createMutationAuthorityCapabilityForTest, seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";
import { localRunId, readAuditTaskPair, readTaskRecordRaw } from "../plugins/immune-brain/runtime/kernel/storage";
import { readRunRowByTask, withKernelRead, withKernelTransaction } from "../plugins/immune-brain/runtime/kernel/sqlite_store";
import { captureBatchReconfirmation, ownUnpersistedBatchHead } from "../plugins/immune-brain/runtime/unattended/batch_reconfirmation";
import { projectBatchPreflight } from "../plugins/immune-brain/runtime/unattended/batch_preflight";
import { taskCommitRevisionIdentity } from "../plugins/immune-brain/runtime/workspace_scope";
import * as batchState from "../plugins/immune-brain/runtime/unattended/batch_state";
import * as batchRunner from "../plugins/immune-brain/runtime/unattended/batch_runner";
import { commitBatchChild, lookupBatchCommit } from "../plugins/immune-brain/runtime/unattended/batch_git";
import type { BatchRunnerGitPort } from "../plugins/immune-brain/runtime/unattended/batch_git";
import type { GithubInitiativeObservation } from "../plugins/immune-brain/runtime/github_issue_tracker";
import type { TaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/types";

const ENV = { CLAUDE_CODE_VERSION: "2.1.236", CLAUDE_CODE_PERMISSION_MODE: "manual" };
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
afterAll(() => { mock.restore(); });
function git(root: string, ...args: string[]): string {
	// Only fixture commands suppress optional refresh; production calls inherit the actual Host environment.
	return execFileSync("git", ["--no-optional-locks", "-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function put(root: string, path: string, value: unknown) {
	writeFileSync(join(root, path), `${JSON.stringify(value, null, 2)}\n`);
}
function tree(root: string, relative: string): Record<string, string> {
	if (!existsSync(join(root, relative))) return {};
	const result: Record<string, string> = {};
	for (const entry of readdirSync(join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
		const path = `${relative}/${entry.name}`;
		if (entry.isDirectory()) Object.assign(result, tree(root, path));
		// SQLite shared-memory reader marks are transient lock bookkeeping,
		// not authority. Durable DB/WAL bytes and every other file stay covered.
		else if (!entry.name.endsWith("-shm")) result[path] = createHash("sha256").update(readFileSync(join(root, path))).digest("hex");
	}
	return result;
}
function snapshot(root: string) {
	return { authority: tree(root, ".imm/state"), audit: tree(root, ".imm/audit"),
		index: readFileSync(join(root, ".git/index")).toString("hex"), refs: tree(root, ".git/refs"),
		head: readFileSync(join(root, ".git/HEAD")).toString("hex"),
		packed: existsSync(join(root, ".git/packed-refs")) ? readFileSync(join(root, ".git/packed-refs")).toString("hex") : null };
}

// Restore only test-owned files between independent negative controls. QA
// evidence is reused unchanged; this never fabricates or rewrites settlement.
function restorePoint(root: string) {
	const paths = ["docs/plans", "src", ".imm/audit", ".imm/state/batches", ".git/refs", ".git/HEAD", ".git/index", "unrelated.txt"];
	const saved = new Map<string, Buffer>();
	const visit = (path: string) => {
		if (!existsSync(join(root, path))) return;
		const entries = path === ".git/HEAD" || path === ".git/index" || path === "unrelated.txt" ? null : readdirSync(join(root, path), { withFileTypes: true });
		if (entries === null) saved.set(path, readFileSync(join(root, path)));
		else for (const entry of entries) {
			const child = `${path}/${entry.name}`;
			if (entry.isDirectory()) visit(child); else saved.set(child, readFileSync(join(root, child)));
		}
	};
	for (const path of paths) visit(path);
	return () => {
		for (const path of paths) rmSync(join(root, path), { recursive: true, force: true });
		for (const [path, bytes] of saved) { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), bytes); }
		// Fixture preparation only: recreating files changes inode/stat metadata.
		// Stage the identical saved content before the next measured operation;
		// snapshot() itself never refreshes or writes the index.
		git(root, "add", "-A");
	};
}

// Each fixture starts through the public Host entry: no seeded authority,
// fabricated attestations, scripted projections, or successful advance doubles.
async function fixture(host: "pi" | "claude", settle: "done" | "active" | "stopped" = "done", risk: "routine" | "material" = "routine", includeSidecar = true, hiddenSubmodule = false) {
	const root = mkdtempSync(join(tmpdir(), "imm-reconfirmation-")); roots.push(root);
	const slug = `reconfirm-${host}`;
	mkdirSync(join(root, "docs/plans"), { recursive: true });
	mkdirSync(join(root, "src"));
	mkdirSync(join(root, ".imm/state"), { recursive: true });
	writeFileSync(join(root, ".gitignore"), ".imm/state/\n");
	writeFileSync(join(root, ".imm/state/authority-sentinel"), "nonempty authority sentinel\n");
	const intents: TaskIntentV1[] = [1, 2].map(n => ({
		contract: "assurance_kernel/task_intent/v1", task_id: `${slug}-c${n}`, goal: `implement child ${n}`,
		owner: "user", risk, revision: 1,
		scope_hint: includeSidecar ? [`docs/plans/${slug}-c${n}.intent.json`, `src/child-${n}.txt`] : ["src/**"],
		acceptance: [{ id: `acc-${n}`, assertion: `child ${n} is implemented`, verification: JSON.stringify({
			contract: "assurance_kernel/verification_descriptor/v2",
			command: { executable: "bun", argv: ["-e", `if (await Bun.file('src/child-${n}.txt').text() !== 'implemented\\n') process.exit(3);`],
				cwd: ".", timeout_ms: 10000, max_output_bytes: 8192 }, environment: { writable_paths: [] },
		}) }],
	}));
	for (const [i, intent] of intents.entries()) { put(root, `docs/plans/${intent.task_id}.intent.json`, intent); writeFileSync(join(root, `src/child-${i + 1}.txt`), "original\n"); }
	git(root, "init", "-q", "-b", "main"); git(root, "config", "user.name", "Fixture"); git(root, "config", "user.email", "fixture@example.com");
	git(root, "commit", "--allow-empty", "-qm", "empty baseline without Intents");
	if (hiddenSubmodule) {
		const module = mkdtempSync(join(tmpdir(), "imm-reconfirmation-module-")); roots.push(module);
		git(module, "init", "-q", "-b", "main"); git(module, "config", "user.name", "Fixture"); git(module, "config", "user.email", "fixture@example.com");
		writeFileSync(join(module, "tracked.txt"), "clean\n"); git(module, "add", "-A"); git(module, "commit", "-qm", "module baseline");
		git(root, "-c", "protocol.file.allow=always", "submodule", "add", "-q", module, "vendor/module");
		git(root, "config", "submodule.vendor/module.ignore", "all");
	}
	git(root, "add", "-A"); git(root, "commit", "-qm", "original Intents and source");
	const base = git(root, "rev-parse", "HEAD");
	let observation: GithubInitiativeObservation = { contract: "immune_brain/github_initiative_observation/v1", initiative_id: slug, issue_number: 100,
		tasks: intents.map((intent, i) => ({ task_id: intent.task_id, slice_id: `S${i + 1}`, issue_number: 101 + i, blocked_by: i ? [intents[0]!.task_id] : [] })) };
	let gateCalls = 0;
	let answer: () => Promise<"accept" | "decline" | "cancel"> = async () => "accept";
	let gitPort: BatchRunnerGitPort | undefined;
	let gateFacts: unknown;
	const tools: any[] = [];
	// Getter-backed port allows per-test crash injection while preserving the real Git operation.
	const batchGit: BatchRunnerGitPort = { commitChild: async (...args) => gitPort?.commitChild
		? gitPort.commitChild(...args) : commitBatchChild({ root: args[0], taskId: args[1], batchId: args[2], expectedHead: args[3], branch: args[4], intentPath: args[5] }) };
	registerPiBatch({ registerTool: (tool: unknown) => tools.push(tool), events: { emit() {} } } as never,
		{ readInitiative: async () => observation, batchGit });
	const tool = tools.find(t => t.name === "start_unattended_batch");
	const client = createMcpRuntime({ cwd: root, env: ENV, interactive: true, batchGit, readInitiative: async () => observation,
		requestConfirmation: async request => { gateCalls++; gateFacts = request.batchDetails; return { decision: await answer(), requestId: randomUUID() }; } });
	client.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });
	const run = async (): Promise<any> => {
		if (host === "claude") return client.callTool("start_unattended_batch", { initiative_slug: slug });
		try {
			const response = await tool.execute(randomUUID(), { initiative_slug: slug }, undefined, undefined,
				{ cwd: root, mode: "tui", ui: { setWidget() {}, notify() {}, custom: async () => {
					gateCalls++; const selected = await answer(); return selected === "accept" ? "confirm" : selected;
				} } });
			const content = JSON.parse(response.content[0].text); expect(content).toEqual(response.details); return content;
		} catch (error) { return { state: "rejected", reason: error instanceof Error ? error.message : String(error) }; }
	};
	const first = await run();
	if (first.state !== "started") throw new Error(`fixture Enrollment rejected: ${JSON.stringify(first).slice(0, 1600)}`);
	expect(first.state).toBe("started"); expect(first.report.handoff.task_id).toBe(intents[0]!.task_id); expect(gateCalls).toBe(1);
	const path = `.imm/state/batches/${first.batch_id}.json`;
	const before = batchState.readBatchRunState(root, first.batch_id)!;
	expect(before.children.map(c => c.state)).toEqual(["enrolled", "pending"]);
	const task = intents[0]!.task_id, runId = localRunId(root, task)!;
	const local = withKernelRead(root, db => readRunRowByTask(db, task))!;
	expect(local.enrollment_event_id).toBe(`enroll-${task}-${local.created_at}`);
	expect(Date.parse(local.created_at)).toBeLessThanOrEqual(Date.parse(before.updated_at));
	const current = readTaskRecordRaw(root, task), priorToken = readTaskIntent(root, task).token;
	const next = parseTaskIntentV1({ ...intents[0]!, revision: 2, acceptance: [{ ...intents[0]!.acceptance[0]!, assertion: "revised child is implemented" }] });
	put(root, `docs/plans/${task}.intent.json`, next);
	writeFileSync(join(root, "src/child-1.txt"), "implemented\n"); git(root, "add", "docs/plans", "src/child-1.txt");
	const registry = createTestMutationRegistry(), app = createCanaryApplication(registry), at = new Date().toISOString();
	const diff = diffSnapshotOf(root, current.record!);
	const action = capabilityActionFor({ op: "approve_breaking_intent_revision", task_id: task, actor_id: "user", at, next_intent: next,
		next_intent_ref: { path: `docs/plans/${task}.intent.json`, content_hash: canonicalIntentHash(next) } });
	const capability = createMutationAuthorityCapabilityForTest(registry, { authority_kind: "user", task_id: task,
		action_digest: digestOfAction(action), expected_record_hash: current.revision, intent_revision: next.revision,
		intent_content_hash: canonicalIntentHash(next), diff_hash: diff.diff_hash, actor_id: "user", confirmation_ref: "fixture-native-breaking",
		expires_at: "2099-01-01T00:00:00.000Z", findings_digest: null });
	const revised = app.execute({ root, task_id: task, prior_intent_token: priorToken, diffProvider: diffSnapshotOf, now: at,
		operation: { op: "approve_breaking_intent_revision", next_intent: next, capability, actor_id: "user" } });
	expect(revised.record.intent_snapshot.revision).toBe(2); expect(localRunId(root, task)).toBe(runId);
	const coordinator = host === "pi" ? new AssuranceProgression(createPiAssuranceProgressionPorts()) : client.runtime.coordinator;
	if (settle === "done") {
		const advanced = await coordinator.advance(task, { cwd: root } as never);
		if (risk === "material") {
			expect(advanced.state).toBe("review_ready");
			if (advanced.state !== "review_ready") throw new Error("real QA did not reserve Review");
			// The Reviewer response is a fixture seam, not a fabricated attestation:
			// real frozen QA, reservation, capability and Kernel settlement execute.
			expect(readFileSync(join(root, "src/child-1.txt"), "utf8")).toBe("implemented\n");
			expect(await coordinator.submitReview(task, { cwd: root } as never, {
				contract: "assurance_kernel/assurance_verdict/v2", role: "review", task_id: task,
				snapshot_digest: advanced.snapshot_digest, decision: "pass",
				approval: { kind: "review", authority_role: "reviewer", summary: "Fixture Reviewer checked revised delivery after actual QA" },
			})).toMatchObject({ state: "completed" });
		} else expect(advanced).toMatchObject({ state: "completed" });
		const audit = readAuditTaskPair(root, task, runId)!;
		expect(audit.record.lifecycle).toBe("done"); expect(audit.record.attestations.map(a => a.kind)).toEqual(risk === "material" ? ["qa", "review"] : ["qa"]);
		expect(audit.record.history.some(h => h.type === "approve_breaking_intent_revision")).toBe(true);
		git(root, "add", "-A");
	} else if (settle === "stopped") {
		const active = readTaskRecordRaw(root, task), stopAt = new Date().toISOString();
		const stop = createMutationAuthorityCapabilityForTest(registry, { authority_kind: "user", task_id: task,
			action_digest: digestOfAction(capabilityActionFor({ op: "stop", task_id: task, actor_id: "user", at: stopAt, reason: "fixture stop" })),
			expected_record_hash: active.revision, intent_revision: 2, intent_content_hash: canonicalIntentHash(next),
			diff_hash: diffSnapshotOf(root, active.record!).diff_hash, actor_id: "user", confirmation_ref: "fixture-stop", expires_at: "2099-01-01T00:00:00.000Z", findings_digest: null });
		app.execute({ root, task_id: task, prior_intent_token: readTaskIntent(root, task).token, diffProvider: diffSnapshotOf, now: stopAt,
			operation: { op: "stop", reason: "fixture stop", capability: stop, actor_id: "user" } }); git(root, "add", "-A");
	}
	return { root, slug, task, runId, base, path, before, next, run, client, coordinator,
		state: () => batchState.readBatchRunState(root, first.batch_id)!, gates: () => gateCalls,
		answer: (fn: typeof answer) => { answer = fn; }, gitPort: (port: BatchRunnerGitPort) => { gitPort = port; },
		observation: (value: GithubInitiativeObservation) => { observation = value; }, gateFacts: () => gateFacts,
		claimOther: () => { // A deliberately foreign active claim is a negative control, never settlement evidence.
			const other = readTaskIntent(root, `${slug}-c2`);
			seedKernelRunForTest(root, { task_id: other.intent.task_id, record: {
				contract: "assurance_kernel/task_record/v4", task_id: other.intent.task_id,
				intent_snapshot: other.intent, intent_ref: other.intent_ref, lifecycle: "active", artifact_state: "active",
				baseline: `sha256:${"a".repeat(64)}`, git_base_head: base, attestations: [], findings: [], history: [],
			} });
		} };
}

describe("bounded batch plan reconfirmation", () => {
	for (const host of ["pi", "claude"] as const) it(`${host}: ignore=all cannot hide out-of-scope dirty submodule before or during confirmation`, async () => {
		const f = await fixture(host, "done", "routine", true, true);
		const tracked = join(f.root, "vendor/module/tracked.txt"), index = join(f.root, ".git/modules/vendor/module/index");
		writeFileSync(tracked, "dirty before confirmation\n");
		let before = snapshot(f.root), moduleIndex = readFileSync(index);
		expect((await f.run()).state).toBe("rejected"); expect(f.gates()).toBe(1);
		expect(snapshot(f.root)).toEqual(before); expect(readFileSync(index)).toEqual(moduleIndex);
		writeFileSync(tracked, "clean\n"); git(join(f.root, "vendor/module"), "add", "tracked.txt");
		f.answer(async () => {
			writeFileSync(tracked, "dirty during confirmation\n"); before = snapshot(f.root); moduleIndex = readFileSync(index); return "accept";
		});
		expect((await f.run()).state).toBe("rejected"); expect(f.gates()).toBe(2);
		expect(snapshot(f.root)).toEqual(before); expect(readFileSync(index)).toEqual(moduleIndex);
	}, { timeout: 20000 });
	for (const host of ["pi", "claude"] as const) it(`${host}: public entry reconfirms real revised QA settlement and commits once before next-child handoff`, async () => {
		const f = await fixture(host, "done", "material");
		expect(f.base).toHaveLength(40);
		const projected = await projectBatchPreflight({ root: f.root, initiative_slug: f.slug });
		expect(projected.ok).toBe(true);
		if (!projected.ok) throw new Error(projected.reason);
		expect(projected.projection.reconfirmation).toBeDefined();
		expect(JSON.parse(JSON.stringify(projected.projection))).not.toHaveProperty("reconfirmation");
		const auditBefore = tree(f.root, ".imm/audit");
		const result = await f.run();
		expect(result.state).toBe("started"); expect(result.batch_id).toBe(f.before.batch_id);
		expect(result.report.handoff.task_id).toBe(`${f.slug}-c2`); expect(f.gates()).toBe(2);
		const state = f.state(); expect(state.children.map(c => c.state)).toEqual(["committed", "enrolled"]);
		expect(state.commits).toHaveLength(1); expect(state.plan_digest).not.toBe(f.before.plan_digest);
		for (const key of ["batch_id", "base_head", "branch", "created_at", "consecutive_qa_failures"] as const) expect(state[key]).toEqual(f.before[key]);
		expect(state.budget).toEqual(f.before.budget);
		expect(Date.parse(state.confirmation_time)).toBeGreaterThan(Date.parse(f.before.confirmation_time));
		expect(git(f.root, "rev-parse", "HEAD")).toBe(state.commits[0]!);
		expect(git(f.root, "rev-list", "--count", `${f.base}..HEAD`)).toBe("1");
		expect(git(f.root, "show", "-s", "--format=%B", "HEAD")).toContain(`Immune-Brain-Batch: ${f.before.batch_id}`);
		expect(localRunId(f.root, f.task)).toBe(f.runId); expect(tree(f.root, ".imm/audit")).toEqual(auditBefore);
		const bytes = readFileSync(join(f.root, f.path)); const head = git(f.root, "rev-parse", "HEAD");
		const replay = await f.run(); expect(replay.report.handoff.task_id).toBe(`${f.slug}-c2`);
		expect(f.gates()).toBe(2); expect(readFileSync(join(f.root, f.path))).toEqual(bytes); expect(git(f.root, "rev-parse", "HEAD")).toBe(head);
	}, 90000);

	for (const host of ["pi", "claude"] as const) it(`${host}: default Host decline preserves raw index with stale tracked stat metadata`, async () => {
		const optionalLocks = process.env.GIT_OPTIONAL_LOCKS;
		delete process.env.GIT_OPTIONAL_LOCKS;
		try {
			const f = await fixture(host);
			git(f.root, "config", "diff.autoRefreshIndex", "true");
			const at = new Date(Date.now() + 2000);
			utimesSync(join(f.root, "src/child-1.txt"), at, at);
			utimesSync(join(f.root, "src/child-2.txt"), at, at);
			const before = snapshot(f.root);
			f.answer(async () => "decline");
			expect((await f.run()).state).toBe("rejected"); expect(f.gates()).toBe(2);
			expect(snapshot(f.root)).toEqual(before);
		} finally { if (optionalLocks === undefined) delete process.env.GIT_OPTIONAL_LOCKS; else process.env.GIT_OPTIONAL_LOCKS = optionalLocks; }
	}, 90000);

	for (const host of ["pi", "claude"] as const) it(`${host}: settled sidecar outside commit scope refuses before confirmation with zero writes`, async () => {
		const f = await fixture(host, "done", "material", false), before = snapshot(f.root);
		expect(f.next.scope_hint).toEqual(["src/**"]);
		expect((await f.run()).state).toBe("rejected"); expect(f.gates()).toBe(1);
		expect(f.state().plan_digest).toBe(f.before.plan_digest); expect(snapshot(f.root)).toEqual(before);
	}, 90000);

	it("independently refuses every invalid binding with exact nonempty authority/audit/index/ref bytes", async () => {
		const f = await fixture("pi"), restore = restorePoint(f.root);
		const row = withKernelRead(f.root, db => readRunRowByTask(db, f.task))!;
		for (const failure of ["digest", "missing-baseline", "order", "task", "slice", "dependencies", "pending-intent", "foreign-run", "late-run", "stale-delivery", "dirty-unrelated", "head", "branch", "commits", "child-commit", "short-oid", "nonhex-oid", "commit-evidence", "proof-timestamp"]) {
		try {
		const preflight = await projectBatchPreflight({ root: f.root, initiative_slug: f.slug });
		expect(preflight.ok).toBe(true);
		if (!preflight.ok) throw new Error(preflight.reason);
		const children = structuredClone(preflight.projection.recovery_children);
		const record = f.state();
		switch (failure) {
			case "digest": record.plan_digest = `sha256:${"b".repeat(64)}`; break;
			// A real committed object with no original Intent, not a missing-file mock.
			case "missing-baseline": record.base_head = git(f.root, "rev-parse", "HEAD^"); break;
			case "order": children.reverse(); break;
			case "task": children[0]!.task_id = "another-child"; break;
			case "slice": children[0]!.slice_id = "different-slice"; break;
			case "dependencies": children[0]!.blocked_by = [children[1]!.task_id]; break;
			case "pending-intent": {
				const pending = readTaskIntent(f.root, children[1]!.task_id).intent;
				const next = parseTaskIntentV1({ ...pending, revision: 2 });
				put(f.root, children[1]!.intent_path!, next); git(f.root, "add", children[1]!.intent_path!);
				children[1]!.intent_revision = 2; children[1]!.intent_content_hash = canonicalIntentHash(next); break;
			}
			case "foreign-run": withKernelTransaction(f.root, db => { db.prepare("UPDATE runs SET enrollment_event_id = ? WHERE run_id = ?").run("foreign-enrollment", f.runId); }); break;
			case "late-run": withKernelTransaction(f.root, db => { db.prepare("UPDATE runs SET created_at = ? WHERE run_id = ?").run(new Date(Date.parse(record.updated_at) + 60000).toISOString(), f.runId); }); break;
			case "proof-timestamp": {
				const path = `.imm/audit/${f.task}/${f.runId}/terminal-proof.json`, proof = JSON.parse(readFileSync(join(f.root, path), "utf8"));
				put(f.root, path, { ...proof, terminalized_at: new Date(Date.parse(proof.terminalized_at) + 1000).toISOString() });
				git(f.root, "add", path); break;
			}
			case "stale-delivery": writeFileSync(join(f.root, "src/child-1.txt"), "changed after QA\n"); git(f.root, "add", "src/child-1.txt"); break;
			case "dirty-unrelated": writeFileSync(join(f.root, "unrelated.txt"), "unrelated\n"); git(f.root, "add", "unrelated.txt"); break;
			case "head": git(f.root, "commit", "--allow-empty", "--only", "-qm", "external HEAD movement"); break;
			case "branch": git(f.root, "checkout", "-qb", "foreign"); break;
			case "commits": record.commits = [f.base]; break;
			case "child-commit": record.children[0] = { ...record.children[0]!, state: "committed", commit: f.base }; record.commits = [f.base]; break;
			case "short-oid": record.base_head = "a".repeat(39); break;
			case "nonhex-oid": record.base_head = "z".repeat(40); break;
			case "commit-evidence": mkdirSync(join(f.root, ".imm/state/batches/commits"), { recursive: true }); put(f.root, `.imm/state/batches/commits/${record.batch_id}-${f.task}.json`, {}); break;
		}
		if (["digest", "missing-baseline", "commits", "child-commit", "short-oid", "nonhex-oid"].includes(failure)) put(f.root, f.path, record);
		const before = snapshot(f.root);
		expect(Object.keys(before.authority).length).toBeGreaterThan(2); expect(Object.keys(before.audit).length).toBeGreaterThan(0);
		expect(before.index.length).toBeGreaterThan(0); expect(Object.keys(before.refs).length).toBeGreaterThan(0);
		await expect(captureBatchReconfirmation(f.root, record, children), failure).rejects.toThrow();
		expect(snapshot(f.root), failure).toEqual(before);
		} finally {
			restore();
			if (failure === "foreign-run" || failure === "late-run") withKernelTransaction(f.root, db => {
				db.prepare("UPDATE runs SET enrollment_event_id = ?, created_at = ? WHERE run_id = ?").run(row.enrollment_event_id, row.created_at, f.runId);
			});
		}
		}
		for (const path of [f.path, ".imm/state/authority-sentinel", `.imm/audit/${f.task}/${f.runId}/terminal-proof.json`, ".git/index", ".git/refs/heads/main"]) {
			const bytes = readFileSync(join(f.root, path)), before = snapshot(f.root);
			writeFileSync(join(f.root, path), Buffer.concat([bytes, Buffer.from("mutation-control")]));
			expect(snapshot(f.root)).not.toEqual(before); writeFileSync(join(f.root, path), bytes); expect(snapshot(f.root)).toEqual(before);
		}
	}, 90000);

	it.each(["active", "stopped"] as const)("refuses actually %s revised child through public preflight", async lifecycle => {
		const f = await fixture("pi", lifecycle); const before = snapshot(f.root);
		const result = await f.run(); expect(result.state).toBe("rejected"); expect(f.gates()).toBe(1); expect(snapshot(f.root)).toEqual(before);
	}, 90000);

	for (const host of ["pi", "claude"] as const) it(`${host}: each native refusal or drift cannot write or advance`, async () => {
		const f = await fixture(host), restore = restorePoint(f.root);
		for (const failure of ["decline", "cancel", "expired", "plan-drift", "state-drift", "evidence-drift", "head-drift", "branch-drift"]) {
		let expected = snapshot(f.root), clock: ReturnType<typeof spyOn> | undefined;
		f.answer(async () => {
			if (failure === "decline" || failure === "cancel") return failure;
			if (failure === "expired") clock = spyOn(Date, "now").mockReturnValue(Date.parse(f.before.budget.deadline_at));
			if (failure === "plan-drift") { const pending = readTaskIntent(f.root, `${f.slug}-c2`).intent; put(f.root, `docs/plans/${pending.task_id}.intent.json`, { ...pending, revision: 2 }); }
			if (failure === "state-drift") put(f.root, f.path, { ...f.state(), consecutive_qa_failures: 1 });
			if (failure === "evidence-drift") {
				const path = `.imm/audit/${f.task}/${f.runId}/terminal-proof.json`; const proof = JSON.parse(readFileSync(join(f.root, path), "utf8"));
				put(f.root, path, { ...proof, terminal_event_id: "foreign-proof" });
			}
			if (failure === "head-drift") git(f.root, "commit", "--allow-empty", "--only", "-qm", "external answer-time HEAD");
			if (failure === "branch-drift") git(f.root, "checkout", "-qb", "answer-time-branch");
			expected = snapshot(f.root); return "accept";
		});
		try {
			const result = await f.run().catch(error => ({ state: "rejected", reason: String(error) }));
			expect(["rejected", "cancelled", "blocked"], failure).toContain(result.state);
			expect(snapshot(f.root)).toEqual(expected); expect(f.state().plan_digest).toBe(f.before.plan_digest);
			expect(git(f.root, "rev-list", "--count", `${f.base}..HEAD`)).toBe(failure === "head-drift" ? "1" : "0");
		} finally { clock?.mockRestore(); restore(); }
		}
		expect(f.gates()).toBe(9);
	}, 90000);

	for (const host of ["pi", "claude"] as const) it(`${host}: a foreign claim during native answer refuses without further writes`, async () => {
		const f = await fixture(host);
		let expected = snapshot(f.root);
		f.answer(async () => { f.claimOther(); expected = snapshot(f.root); return "accept"; });
		const result = await f.run();
		expect(result.state).toBe("rejected"); expect(f.gates()).toBe(2);
		expect(snapshot(f.root)).toEqual(expected); expect(f.state().plan_digest).toBe(f.before.plan_digest);
	}, 90000);

	it("crashes before and after atomic replacement resume without replaying QA or reenrolling done child", async () => {
		const f = await fixture("pi"), real = batchState.replaceBatchRunState;
		const bytes = readFileSync(join(f.root, f.path)), audit = tree(f.root, ".imm/audit");
		for (const side of ["before", "after"]) {
			let replacements = 0;
			const fault = spyOn(batchState, "replaceBatchRunState").mockImplementation((...args) => {
				replacements++;
				if (side === "before") throw new Error("fixture crash before replacement");
				real(...args); throw new Error("fixture crash after replacement");
			});
			try {
				const interrupted = await f.run(); expect(interrupted.state).toBe("rejected"); expect(replacements).toBe(1);
				expect(git(f.root, "rev-parse", "HEAD")).toBe(f.base);
				if (side === "before") expect(readFileSync(join(f.root, f.path))).toEqual(bytes);
				else expect(f.state().plan_digest).not.toBe(f.before.plan_digest);
			} finally { fault.mockRestore(); }
			expect(f.gates()).toBe(side === "before" ? 2 : 3);
		}
		const resumed = await f.run(); expect(resumed.report.handoff.task_id).toBe(`${f.slug}-c2`);
		expect(f.gates()).toBe(3); expect(f.state().commits).toHaveLength(1);
		expect(localRunId(f.root, f.task)).toBe(f.runId); expect(tree(f.root, ".imm/audit")).toEqual(audit);
	}, 90000);

	for (const host of ["pi", "claude"] as const) it(`${host}: crash after real commit before persistence refuses invalid proof end-to-end and adopts valid evidence once`, async () => {
		const f = await fixture(host, "done", "material"); const real = batchState.writeBatchRunState;
		let commitCalls = 0;
		f.gitPort({ commitChild: async (root, taskId, batchId, expectedHead, branch, intentPath) => {
			commitCalls++; return commitBatchChild({ root, taskId, batchId, expectedHead, branch, intentPath });
		} });
		const fault = spyOn(batchState, "writeBatchRunState").mockImplementation((root, state) => {
			if (state.children[0]?.state === "committed") throw new Error("fixture crash at committed-state persist");
			return real(root, state);
		});
		try {
			const interrupted = await f.run().catch(error => {
				expect(String(error)).toContain("fixture crash at committed-state persist"); return { state: "rejected" };
			}); expect(interrupted.state).toBe("rejected"); expect(commitCalls).toBe(1);
			expect(f.state().children[0]!.state).toBe("settled"); expect(f.state().commits).toEqual([]);
		} finally { fault.mockRestore(); }
		const committedHead = git(f.root, "rev-parse", "HEAD"); expect(committedHead).not.toBe(f.base);
		expect(await lookupBatchCommit({ root: f.root, taskId: f.task, batchId: f.before.batch_id, expectedHead: f.base, branch: f.before.branch })).toEqual({ commit: committedHead });
		const terminalRecord = readAuditTaskPair(f.root, f.task, f.runId)!.record;
		if (terminalRecord.contract !== "assurance_kernel/task_record/v4") throw new Error("expected actual v4 settlement");
		expect(taskCommitRevisionIdentity(f.root, terminalRecord.intent_snapshot.scope_hint, terminalRecord.git_base_head, committedHead).diff_hash)
			.toBe(terminalRecord.attestations.find(a => a.kind === "qa")!.diff_hash);
		expect(ownUnpersistedBatchHead(f.root, f.state(), committedHead)).toBe(true);
		const evidencePath = `.imm/state/batches/commits/${f.before.batch_id}-${f.task}.json`;
		const evidenceBytes = readFileSync(join(f.root, evidencePath)), evidence = JSON.parse(evidenceBytes.toString("utf8"));
		for (const patch of [{ commit: "--all" }, { parent_head: "z".repeat(40) }, { task_id: "foreign-child" }, { contract: "forged-evidence" }]) {
			try {
				put(f.root, evidencePath, { ...evidence, ...patch }); const before = snapshot(f.root);
				expect(ownUnpersistedBatchHead(f.root, f.state(), committedHead)).toBe(false); expect(snapshot(f.root)).toEqual(before);
			} finally { writeFileSync(join(f.root, evidencePath), evidenceBytes); }
		}
		expect(ownUnpersistedBatchHead(f.root, f.state(), "--all")).toBe(false);
		let issued: batchRunner.StartBatchInput | undefined;
		const capture = spyOn(batchRunner, "startBatch").mockImplementation(async input => { issued = input; throw new Error("fixture capture before shared runner"); });
		try { expect((await f.run().catch(error => {
			expect(String(error)).toContain("fixture capture before shared runner"); return { state: "rejected" };
		})).state).toBe("rejected"); } finally { capture.mockRestore(); }
		if (!issued) throw new Error("valid replay did not reach shared runner");
		const input = issued;
		// Preserve genuine audit bytes but replace the delivered blob or mode.
		// Matching author/trailers/receipt must not manufacture reviewed identity.
		for (const change of ["blob", "mode"] as const) {
			const restore = restorePoint(f.root);
			try {
				if (change === "blob") { writeFileSync(join(f.root, "src/child-1.txt"), "unreviewed\n"); git(f.root, "add", "src/child-1.txt"); }
				else git(f.root, "update-index", "--chmod=+x", "src/child-1.txt");
				const tree = git(f.root, "write-tree"), message = git(f.root, "show", "-s", "--format=%B", committedHead);
				const author = git(f.root, "show", "-s", "--format=%an", committedHead);
				const forged = git(f.root, "-c", `user.name=${author}`, "commit-tree", tree, "-p", f.base, "-m", message);
				git(f.root, "update-ref", "HEAD", forged); put(f.root, evidencePath, { ...evidence, commit: forged });
				const before = snapshot(f.root);
				expect(ownUnpersistedBatchHead(f.root, f.state(), forged)).toBe(false);
				expect((await f.run()).state).toBe("rejected"); expect(f.gates()).toBe(2);
				await expect(batchRunner.startBatch(input)).rejects.toThrow("provenance"); expect(snapshot(f.root)).toEqual(before);
			} finally { restore(); }
		}
		const proofPath = `.imm/audit/${f.task}/${f.runId}/terminal-proof.json`;
		const proofBytes = readFileSync(join(f.root, proofPath)), exportedProof = JSON.parse(proofBytes.toString("utf8"));
		try {
			put(f.root, proofPath, { ...exportedProof, terminalized_at: new Date(Date.parse(exportedProof.terminalized_at) + 1000).toISOString() });
			git(f.root, "add", proofPath); const before = snapshot(f.root);
			expect((await f.run()).state).toBe("rejected"); expect(f.gates()).toBe(2); expect(snapshot(f.root)).toEqual(before);
			await expect(batchRunner.startBatch(input)).rejects.toThrow("provenance"); expect(snapshot(f.root)).toEqual(before);
		} finally { writeFileSync(join(f.root, proofPath), proofBytes); git(f.root, "add", proofPath); }
		const localProof = withKernelRead(f.root, db => readRunRowByTask(db, f.task))!.terminal_proof_json!;
		const proof = JSON.parse(localProof);
		for (const changed of [null, "{}", JSON.stringify({ ...proof, terminalized_at: new Date(Date.parse(proof.terminalized_at) + 1000).toISOString() })]) {
			try {
				withKernelTransaction(f.root, db => { db.prepare("UPDATE runs SET terminal_proof_json = ? WHERE run_id = ?").run(changed, f.runId); });
				const before = snapshot(f.root);
				expect(ownUnpersistedBatchHead(f.root, f.state(), committedHead)).toBe(false); expect(snapshot(f.root)).toEqual(before);
				expect((await f.run()).state).toBe("rejected"); expect(f.gates()).toBe(2); expect(snapshot(f.root)).toEqual(before);
				await expect(batchRunner.startBatch(input)).rejects.toThrow("provenance"); expect(snapshot(f.root)).toEqual(before);
			} finally { withKernelTransaction(f.root, db => { db.prepare("UPDATE runs SET terminal_proof_json = ? WHERE run_id = ?").run(localProof, f.runId); }); }
		}
		expect(ownUnpersistedBatchHead(f.root, f.state(), committedHead)).toBe(true);
		const resumed = await f.run(); expect(resumed.report.handoff.task_id).toBe(`${f.slug}-c2`);
		expect(f.state().commits).toEqual([committedHead]); expect(commitCalls).toBe(1); expect(f.gates()).toBe(2);
	}, 90000);

	it("real native authority refuses forged, stale or changed inputs; expected-byte replacement remains zero-write", async () => {
		const f = await fixture("pi"), state = f.state();
		let issued: batchRunner.StartBatchInput | undefined;
		const capture = spyOn(batchRunner, "startBatch").mockImplementation(async input => { issued = input; throw new Error("fixture interruption before runner entry"); });
		try { expect((await f.run()).state).toBe("rejected"); } finally { capture.mockRestore(); }
		if (!issued) throw new Error("public native gate did not issue a runner input");
		const input = issued;
		const invalidInputs: Partial<batchRunner.StartBatchInput>[] = [
			{ capability: {} as batchRunner.StartBatchInput["capability"] },
			{ confirmation_time: state.confirmation_time },
			{ plan_digest: `sha256:${"f".repeat(64)}` },
			{ budget: { ...input.budget, max_children: input.budget.max_children + 1 } },
			{ children: input.children.map((child, i) => i ? child : { ...child, intent_content_hash: `sha256:${"e".repeat(64)}` }) },
		];
		for (const changed of invalidInputs) {
			const before = snapshot(f.root);
			await expect(batchRunner.startBatch({ ...input, ...changed })).rejects.toThrow(); expect(snapshot(f.root)).toEqual(before);
		}
		const beforeExpiry = snapshot(f.root);
		const expired = spyOn(Date, "now").mockReturnValue(Date.parse(input.authorization_expires_at));
		try { await expect(batchRunner.startBatch(input)).rejects.toThrow(); expect(snapshot(f.root)).toEqual(beforeExpiry); } finally { expired.mockRestore(); }
		expect(f.gates()).toBe(2); expect(f.state().plan_digest).toBe(state.plan_digest);
		const bytes = readFileSync(join(f.root, f.path));
		writeFileSync(join(f.root, f.path), JSON.stringify(state));
		let before = snapshot(f.root);
		expect(() => batchState.replaceBatchRunState(f.root, bytes, state, () => { throw new Error("must not validate stale bytes"); })).toThrow("CAS mismatch");
		expect(snapshot(f.root)).toEqual(before);
		writeFileSync(join(f.root, f.path), bytes); before = snapshot(f.root);
		expect(() => batchState.replaceBatchRunState(f.root, bytes, state, () => { throw new Error("validation interrupted"); })).toThrow("validation interrupted");
		expect(snapshot(f.root)).toEqual(before);
	}, 90000);
});
