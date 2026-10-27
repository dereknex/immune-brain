import { afterAll, describe, expect, it, mock, spyOn } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyGitTemplate } from "./helpers/git-template";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { GithubInitiativeObservation } from "../plugins/immune-brain/runtime/github_issue_tracker";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import { seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";

// Delivery QA has no node_modules; use host seams only when the real package is absent.
try { await import("typebox"); } catch {
	const optional = Symbol("optional");
	mock.module("typebox", () => ({ Type: {
		Array: (items: object) => ({ type: "array", items }), Boolean: () => ({ type: "boolean" }),
		Literal: (value: unknown) => ({ const: value }), Null: () => ({ type: "null" }),
		Number: (options: object = {}) => ({ type: "number", ...options }),
		Object: (properties: Record<string, any>, options: object = {}) => ({ type: "object", properties,
			required: Object.entries(properties).filter(([, value]) => !value[optional]).map(([key]) => key), ...options }),
		Optional: (schema: Record<string, unknown>) => ({ ...schema, [optional]: true }),
		Record: (_key: object, value: object) => ({ type: "object", additionalProperties: value }),
		String: (options: object = {}) => ({ type: "string", ...options }), Union: (anyOf: object[]) => ({ anyOf }), Unknown: () => ({}),
	} }));
}
try { await import("@earendil-works/pi-coding-agent"); } catch {
	class DynamicBorder {
		constructor(private style: (text: string) => string) {}
		render(width: number) { return [this.style("─".repeat(Math.max(0, width)))]; }
	}
	mock.module("@earendil-works/pi-coding-agent", () => ({ DynamicBorder }));
}
try { await import("@earendil-works/pi-tui"); } catch {
	class Text {
		constructor(private text: string) {} setText(text: string) { this.text = text; }
		render() { return this.text.split("\n"); } invalidate() {}
	}
	class Container {
		private children: Array<{ render(width: number): string[] }> = [];
		addChild(child: { render(width: number): string[] }) { this.children.push(child); }
		render(width: number) { return this.children.flatMap((child) => child.render(width)); } invalidate() {}
	}
	class SelectList {
		onSelect?: (item: any) => void; onCancel?: () => void; private selected = 0;
		constructor(private items: any[]) {}
		render() { return this.items.map((item, index) => `${index === this.selected ? "> " : "  "}${item.label}`); }
		handleInput(input: string) {
			if (input === "\u001b[B") this.selected = Math.min(this.items.length - 1, this.selected + 1);
			else if (input === "\u001b[A") this.selected = Math.max(0, this.selected - 1);
			else if (input === "\r") this.onSelect?.(this.items[this.selected]);
			else if (input === "\u001b") this.onCancel?.();
		}
	}
	mock.module("@earendil-works/pi-tui", () => ({ Container, SelectList, Text,
		sliceByColumn: (text: string, start: number, width?: number) => text.slice(start, width === undefined ? undefined : start + width),
		truncateToWidth: (text: string, width: number, marker = "") => text.length <= width ? text : `${text.slice(0, Math.max(0, width - marker.length))}${marker}`,
		visibleWidth: (text: string) => text.length,
	}));
}
afterAll(() => mock.restore());
const { executePiUnattendedBatch, default: registerBatchExtension, mapDialogSelection } = await import("../plugins/immune-brain/.pi-extension/imm-unattended-batch");
const { recordPiPhaseInput } = await import("../plugins/immune-brain/.pi-extension/imm-canary-work");
const runBatch = (options: Parameters<typeof executePiUnattendedBatch>[0]) => executePiUnattendedBatch({ final_verification: ["bun test", "bun run typecheck"], ...options });
const SESSION = { getSessionId: () => "pi-batch-authority-tests" };
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
const git = (root: string, ...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

function fixture(slug: string) {
	const root = mkdtempSync(join(tmpdir(), "pi-batch-test-")); roots.push(root); copyGitTemplate(root);
	mkdirSync(join(root, "docs/plans"), { recursive: true });
	for (const [n, risk] of [[1, "routine"], [2, "material"], [3, "critical"]] as const) {
		const task_id = `${slug}-c${n}`;
		writeFileSync(join(root, `docs/plans/${task_id}.intent.json`), `${JSON.stringify({ contract: "assurance_kernel/task_intent/v1", task_id, owner: "user", goal: `child ${n}`,
			acceptance: [{ id: `acc-${n}`, assertion: `c${n} assertion`, verification: "bun test" }],
			scope_hint: [`docs/plans/${task_id}.intent.json`, `docs/specs/${task_id}.spec.md`, `docs/specs/archive/${task_id}.spec.md`], risk, revision: 1 }, null, 2)}\n`);
	}
	git(root, "add", "docs"); git(root, "commit", "-qm", "child intents");
	const observation: GithubInitiativeObservation = { contract: "immune_brain/github_initiative_observation/v1", initiative_id: slug, issue_number: 100,
		tasks: [1, 2, 3].map(n => ({ task_id: `${slug}-c${n}`, slice_id: `S${n}`, issue_number: 100 + n, blocked_by: n === 2 ? [`${slug}-c1`] : [] })) };
	return { root, slug, head: git(root, "rev-parse", "HEAD"), observation };
}
function claim(root: string, task_id: string) {
	const intent = parseTaskIntentV1({ contract: "assurance_kernel/task_intent/v1", task_id, owner: "user", goal: "claim fixture",
		acceptance: [{ id: "A1", assertion: "a1", verification: "bun test" }], scope_hint: ["docs/plans"], risk: "routine", revision: 1 });
	seedKernelRunForTest(root, { task_id, record: { contract: "assurance_kernel/task_record/v4", task_id, intent_snapshot: intent,
		intent_ref: { path: `docs/plans/${task_id}.intent.json`, content_hash: canonicalIntentHash(intent) }, lifecycle: "active", artifact_state: "active",
		baseline: `sha256:${"a".repeat(64)}`, git_base_head: git(root, "rev-parse", "HEAD"), attestations: [], findings: [], history: [] } });
}
function snapshot(root: string) {
	return { head: git(root, "rev-parse", "HEAD"), branch: git(root, "symbolic-ref", "HEAD"), refs: git(root, "show-ref"),
		index: readFileSync(join(root, ".git/index")), status: git(root, "status", "--porcelain=v1") };
}
function noBatchWrites(root: string) {
	for (const path of [".imm/state/batch", ".imm/state/batches", ".imm/state/tasks"]) expect(existsSync(join(root, path))).toBe(false);
}
function register(readInitiative: () => Promise<GithubInitiativeObservation>) {
	const tools: any[] = [];
	registerBatchExtension({ registerTool: (tool: unknown) => tools.push(tool), events: { emit: () => {} } } as unknown as ExtensionAPI, { readInitiative });
	return tools.find(tool => tool.name === "start_unattended_batch")!;
}
function context(root: string, selection: string, opened = { count: 0 }) {
	recordPiPhaseInput({ text: "/skill:imm-run", source: "interactive" }, { cwd: root, sessionManager: SESSION });
	return { cwd: root, mode: "tui", sessionManager: SESSION, ui: { custom: async () => { opened.count++; return selection; } } };
}
const textOf = (result: any) => JSON.parse(result.content.map((item: any) => item.text).join("\n"));

describe("acc-pi-batch-gate", () => {
	it.each([{ final_verification: undefined }, { final_verification: [] }])("requires final verification on a new Pi tool start (%p)", async ({ final_verification }) => {
		const f = fixture("final-required"); const before = snapshot(f.root); const opened = { count: 0 };
		await expect(register(async () => f.observation).execute("final-required", {
			initiative_slug: f.slug, final_verification,
		}, undefined, undefined, context(f.root, "confirm", opened))).rejects.toThrow("final_verification_required");
		expect(opened.count).toBe(0); expect(snapshot(f.root)).toEqual(before); noBatchWrites(f.root);
	});
	it("registers the Lane tool and exactly its supported parameters", () => {
		const tool = register(async () => { throw new Error("schema does not read a plan"); });
		expect(tool).toBeDefined(); expect(tool.description).toContain("Lane"); expect(tool.description).not.toMatch(/serial/i);
		expect(Object.keys(tool.parameters.properties)).toEqual(["initiative_slug", "max_parallel", "lane_offers", "final_verification", "lane_instruction"]);
		expect(tool.parameters.required).toEqual(["initiative_slug"]);
		const schema = tool.parameters.properties.max_parallel;
		expect(schema.minimum).toBe(1); expect(schema.type === "integer" || schema.multipleOf === 1).toBe(true);
	});
	it.each([undefined, null, {}])("rejects unknown lane_revision before direct execution or tool effects (%p)", async lane_revision => {
		const f = fixture("retired-revision"); const before = snapshot(f.root); const opened = { count: 0 };
		const readInitiative = async () => { throw new Error("must reject before reading the plan"); };
		await expect(runBatch({ root: f.root, initiativeSlug: f.slug, readInitiative, lane_revision } as never)).rejects.toThrow("unknown parameter: lane_revision");
		await expect(register(readInitiative).execute("retired", { initiative_slug: f.slug, lane_revision }, undefined, undefined, context(f.root, "confirm", opened))).rejects.toThrow("unknown parameter: lane_revision");
		expect(opened.count).toBe(0); expect(snapshot(f.root)).toEqual(before); noBatchWrites(f.root);
	});
	it("rejects non-interactive invocation with an interactive-TUI recovery and zero writes", async () => {
		const f = fixture("non-inter"); const before = snapshot(f.root);
		const result = await runBatch({ root: f.root, initiativeSlug: f.slug, interactive: false, readInitiative: async () => f.observation });
		expect(result).toEqual({ state: "rejected", reason: "interactive TUI elicitation is unavailable in non-interactive mode", recovery_action: "invoke through an interactive Pi TUI session in the current Host" });
		expect(snapshot(f.root)).toEqual(before); noBatchWrites(f.root);
	});
	for (const max_parallel of [undefined, 1, 2]) it(`renders authoritative Lane confirmation at max_parallel=${max_parallel ?? "omitted"}`, async () => {
		const f = fixture(`confirm-${max_parallel ?? "default"}`); const confirmations: any[] = [];
		const result = await runBatch({ root: f.root, initiativeSlug: f.slug, max_parallel, readInitiative: async () => f.observation,
			confirmBatch: async details => { confirmations.push(details); return "decline"; } });
		expect(result.state).toBe("rejected"); expect(confirmations).toHaveLength(1);
		const details = confirmations[0];
		expect(details.title).toContain(`Authorize Unattended Batch: ${f.slug}`);
		expect(details.summary).toContain(`Initiative: ${f.slug}`); expect(details.summary).toContain(`Batch branch: refs/heads/imm/${f.slug}`);
		expect(details.summary).toMatch(/Plan digest: sha256:[a-f0-9]{64}/); expect(details.summary).toContain(`Lane mode: max_parallel=${max_parallel ?? 1}`);
		expect(details.summary).toContain("Budget: max_children="); expect(details.summary).not.toMatch(/expires|deadline|serial/i);
		expect(details.details).toContain("Ordered children (3):"); expect(details.details).toContain("Parallel groups (");
		for (const [n, risk] of [[1, "routine"], [2, "material"], [3, "critical"]]) expect(details.details).toContain(`${f.slug}-c${n} (S${n}) [risk: ${risk}]`);
		expect(JSON.stringify(details)).not.toMatch(/delegat/i);
		noBatchWrites(f.root);
	});
	it.each([undefined, null, "invalid", 42])("fails closed when the confirmation port is missing or invalid (%p)", async confirmBatch => {
		const f = fixture("invalid-port"); const before = snapshot(f.root);
		const result = await runBatch({ root: f.root, initiativeSlug: f.slug, readInitiative: async () => f.observation, confirmBatch: confirmBatch as never });
		expect(result.state).toBe("rejected"); expect(snapshot(f.root)).toEqual(before); noBatchWrites(f.root);
	});
	it.each(["decline", "cancel", undefined])("native selection %p preserves refs, index and dirty bytes", async selection => {
		const f = fixture(`selection-${selection ?? "escape"}`);
		writeFileSync(join(f.root, "staged.txt"), "staged bytes\n"); git(f.root, "add", "staged.txt");
		writeFileSync(join(f.root, "staged.txt"), "unstaged bytes\n"); const before = snapshot(f.root);
		const result = await runBatch({ root: f.root, initiativeSlug: f.slug, readInitiative: async () => f.observation,
			confirmBatch: async () => mapDialogSelection(selection) });
		expect(result.state).toBe(selection === "decline" ? "rejected" : "cancelled");
		expect(result.reason).toContain(selection === "decline" ? "native interaction declined" : "native interaction cancelled");
		expect(snapshot(f.root)).toEqual(before); expect(readFileSync(join(f.root, "staged.txt"), "utf8")).toBe("unstaged bytes\n"); noBatchWrites(f.root);
	});
	it("maps dialog decisions and fails closed for the retired delegation choice", () => {
		expect(mapDialogSelection("confirm")).toBe("accept"); expect(mapDialogSelection("confirm_delegate")).toBe("cancel");
		expect(mapDialogSelection("decline")).toBe("decline"); expect(mapDialogSelection("cancel")).toBe("cancel"); expect(mapDialogSelection(undefined)).toBe("cancel");
	});
	it("pending confirmation settles on caller cancellation without writes", async () => {
		const f = fixture("pending-cancel"); const before = snapshot(f.root); const controller = new AbortController();
		let opened!: () => void; const opening = new Promise<void>(resolve => { opened = resolve; });
		const pending = runBatch({ root: f.root, initiativeSlug: f.slug, signal: controller.signal, readInitiative: async () => f.observation,
			confirmBatch: async details => { opened(); return new Promise(resolve => details.signal!.addEventListener("abort", () => resolve("cancel"), { once: true })); } });
		await opening; controller.abort(); const result = await pending;
		expect(result.state).toBe("cancelled"); expect(snapshot(f.root)).toEqual(before); noBatchWrites(f.root);
	});
	it("cancellation at issuance produces no batch writes", async () => {
		const f = fixture("cancel-issue"); const before = snapshot(f.root); const controller = new AbortController();
		const result = await runBatch({ root: f.root, initiativeSlug: f.slug, signal: controller.signal, readInitiative: async () => f.observation,
			confirmBatch: async () => { controller.abort(); return "accept"; } });
		expect(result.state).toBe("cancelled"); expect(snapshot(f.root)).toEqual(before); noBatchWrites(f.root);
	});
	it("active workspace claim blocks before the gate without changing authority", async () => {
		const f = fixture("claim-block"); claim(f.root, "foreign-task"); const before = snapshot(f.root); let gates = 0;
		const result = await runBatch({ root: f.root, initiativeSlug: f.slug, readInitiative: async () => f.observation, confirmBatch: async () => { gates++; return "accept"; } });
		expect(result.state).toBe("blocked"); expect(result.reason).toContain("foreign-task"); expect(gates).toBe(0);
		expect(snapshot(f.root)).toEqual(before); expect(existsSync(join(f.root, ".imm/state/batches"))).toBe(false);
	});
	for (const tip of ["HEAD", "HEAD~1"]) it(`conflicting Parent at ${tip} rejects before the gate and preserves all refs`, async () => {
		const f = fixture("branch-conflict"); git(f.root, "branch", `imm/${f.slug}`, tip); const before = snapshot(f.root); let gates = 0;
		const result = await runBatch({ root: f.root, initiativeSlug: f.slug, readInitiative: async () => f.observation, confirmBatch: async () => { gates++; return "accept"; } });
		expect(result.state).toBe("rejected"); expect(result.reason).toContain("branch"); expect(result.recovery_action).toContain("branch");
		expect(gates).toBe(0); expect(snapshot(f.root)).toEqual(before); noBatchWrites(f.root);
	});
	it("refuses a same-tip Parent created during confirmation without adopting it", async () => {
		const f = fixture("branch-race"); let gates = 0; let afterCreation = snapshot(f.root);
		const result = await runBatch({ root: f.root, initiativeSlug: f.slug, readInitiative: async () => f.observation,
			confirmBatch: async () => { gates++; git(f.root, "branch", `imm/${f.slug}`); afterCreation = snapshot(f.root); return "accept"; } });
		expect(gates).toBe(1); expect(result.state).toBe("rejected"); expect(result.reason).toContain("recorded provenance");
		expect(snapshot(f.root)).toEqual(afterCreation); noBatchWrites(f.root);
	});
	it("critical-only Parent uses the ordinary batch gate", async () => {
		const f = fixture("critical-only"); let details = "";
		const result = await runBatch({ root: f.root, initiativeSlug: f.slug, readInitiative: async () => ({ ...f.observation, tasks: f.observation.tasks.slice(2) }),
			confirmBatch: async conf => { details = conf.details; return "decline"; } });
		expect(details).toContain(`${f.slug}-c3 (S3) [risk: critical]`); expect(result.state).toBe("rejected"); noBatchWrites(f.root);
	});
	it.each(["subject", "dependency"])("rejects %s drift after confirmation", async drift => {
		const f = fixture(`drift-${drift}`); let confirmed = false;
		const result = await runBatch({ root: f.root, initiativeSlug: f.slug, readInitiative: async () => confirmed && drift === "dependency"
			? { ...f.observation, tasks: f.observation.tasks.map(task => ({ ...task, blocked_by: [] })) } : f.observation,
			confirmBatch: async () => { confirmed = true; if (drift === "subject") {
				const path = join(f.root, `docs/plans/${f.slug}-c1.intent.json`); const intent = JSON.parse(readFileSync(path, "utf8")); intent.goal = "different authority subject";
				writeFileSync(path, `${JSON.stringify(intent, null, 2)}\n`);
			} return "accept"; } });
		expect(result.state).toBe("rejected"); expect(result.reason).toContain("batch plan changed after native confirmation");
		expect(result.recovery_action).toContain("fresh native gate"); noBatchWrites(f.root);
	});
	it.each(["dependency", "external-slice", "removed-external", "missing-identity", "at-gate", "at-port"])("refuses %s drift of an excluded prerequisite before Lane admission", async drift => {
		const f = fixture(`external-${drift}`); let gates = 0;
		f.observation.tasks = f.observation.tasks.slice(0, 2);
		const first = f.observation.tasks[0]!.task_id;
		const intent = parseTaskIntentV1(JSON.parse(readFileSync(join(f.root, `docs/plans/${first}.intent.json`), "utf8")));
		seedKernelRunForTest(f.root, { task_id: first, terminal: { lifecycle: "done" }, record: {
			contract: "assurance_kernel/task_record/v4", task_id: first, intent_snapshot: intent,
			intent_ref: { path: `docs/plans/${first}.intent.json`, content_hash: canonicalIntentHash(intent) }, lifecycle: "done", artifact_state: "frozen",
			baseline: `sha256:${"a".repeat(64)}`, git_base_head: f.head, attestations: [], findings: [], history: [],
		} });
		const { readSettledRunEvidence } = await import("../plugins/immune-brain/runtime/kernel/storage");
		const evidence = readSettledRunEvidence(f.root, first)!;
		const audit = join(f.root, `.imm/audit/${first}/${evidence.run_id}`);
		mkdirSync(audit, { recursive: true });
		writeFileSync(join(audit, "task-record.json"), evidence.record_json);
		writeFileSync(join(audit, "terminal-proof.json"), evidence.proof_json);
		let confirmedReads = 0;
		const options = { root: f.root, initiativeSlug: f.slug, readInitiative: async () => {
			if (gates && ++confirmedReads === 2 && drift === "at-port") f.observation.tasks[1]!.blocked_by = [];
			return f.observation;
		},
			confirmBatch: async () => { gates++; if (drift === "at-gate") f.observation.tasks[1]!.blocked_by = []; return "accept" as const; } };
		const started = await runBatch(options);
		if (drift === "at-gate" || drift === "at-port") {
			expect(started.state).toBe("rejected"); expect(started.reason).toContain("plan changed");
			expect(gates).toBe(1); noBatchWrites(f.root); return;
		}
		expect(started.state).toBe("started");
		if (started.state !== "started") throw new Error(started.reason);
		expect(started.report.children).toMatchObject([{ task_id: `${f.slug}-c2`, state: "pending", lane: null }]);
		expect(started.report.handoffs).toEqual([]);
		// An unchanged graph still waits for A's actual delivery on the Parent ref.
		expect((await runBatch(options)).state).toBe("started");
		const path = join(f.root, `.imm/state/batches/${started.batch_id}.json`);
		if (drift === "dependency") f.observation.tasks[1]!.blocked_by = [];
		if (drift === "external-slice") f.observation.tasks[0]!.slice_id = "changed";
		if (drift === "removed-external") f.observation.tasks = [{ ...f.observation.tasks[1]!, blocked_by: [] }];
		if (drift === "missing-identity") {
			const record = JSON.parse(readFileSync(path, "utf8")); delete record.topology_digest;
			writeFileSync(path, JSON.stringify(record));
		}
		const bytes = readFileSync(path), before = snapshot(f.root), worktrees = git(f.root, "worktree", "list", "--porcelain");
		const refused = await runBatch(options);
		expect(refused.state).toBe("rejected"); expect(refused.reason).toContain("plan changed");
		expect(gates).toBe(1); expect(readFileSync(path)).toEqual(bytes); expect(snapshot(f.root)).toEqual(before);
		expect(git(f.root, "worktree", "list", "--porcelain")).toBe(worktrees);
		expect(JSON.parse(readFileSync(path, "utf8")).children).toMatchObject([{ state: "pending", lane: null }]);
	});
	it("compatible revision at the gate retains the authorization", async () => {
		const f = fixture("compatible-revision"); let gates = 0;
		const result = await runBatch({ root: f.root, initiativeSlug: f.slug, readInitiative: async () => f.observation, confirmBatch: async () => {
			gates++; const path = join(f.root, `docs/plans/${f.slug}-c1.intent.json`); const intent = JSON.parse(readFileSync(path, "utf8")); intent.revision++;
			intent.scope_hint.push(`docs/plans/${f.slug}-notes.md`); writeFileSync(path, `${JSON.stringify(intent, null, 2)}\n`);
			return "accept";
		} });
		expect(result.state).toBe("started"); expect(gates).toBe(1);
	});
	it("a delayed answer is accepted without adding expiry or deadline", async () => {
		const f = fixture("pi-ttl"); let clock: ReturnType<typeof spyOn> | undefined; let shown = "";
		const result = await runBatch({ root: f.root, initiativeSlug: f.slug, readInitiative: async () => f.observation, confirmBatch: async details => {
			shown = details.summary; clock = spyOn(Date, "now").mockReturnValue(Date.now() + 365 * 24 * 60 * 60 * 1000); return "accept";
		} }).finally(() => clock?.mockRestore());
		expect(result.state).toBe("started"); if (result.state !== "started") throw new Error(result.reason);
		const record = JSON.parse(readFileSync(join(f.root, `.imm/state/batches/${result.batch_id}.json`), "utf8"));
		expect(record).not.toHaveProperty("authorization_expires_at"); expect(Object.keys(record.budget).sort()).toEqual(["max_children", "qa_failure_limit"]);
		expect(shown).not.toMatch(/expires|deadline/i);
	});
	it("corrupt batch state fails closed before any gate with byte preservation", async () => {
		const f = fixture("corrupt-batch"); const path = join(f.root, ".imm/state/batches/batch-corrupt.json"); mkdirSync(join(f.root, ".imm/state/batches"), { recursive: true });
		writeFileSync(path, "{ not valid json"); const before = snapshot(f.root); let gates = 0;
		const result = await runBatch({ root: f.root, initiativeSlug: f.slug, readInitiative: async () => f.observation, confirmBatch: async () => { gates++; return "accept"; } });
		expect(result.state).toBe("blocked"); expect(result.reason).toContain("unreadable or invalid"); expect(gates).toBe(0);
		expect(readFileSync(path, "utf8")).toBe("{ not valid json"); expect(snapshot(f.root)).toEqual(before);
	});
	it("projects existing enrolled records and shares the foreground Review reservation", async () => {
		const f = fixture("proj-scope"); claim(f.root, `${f.slug}-c1`);
		const { projectAssuranceForTask, getSharedPiProgression } = await import("../plugins/immune-brain/.pi-extension/imm-canary-work");
		const projection = await projectAssuranceForTask(f.root, `${f.slug}-c1`);
		expect(projection.error).toBeNull(); expect(projection.projection.lifecycle).toBe("active");
		expect(await getSharedPiProgression()).toBe(await getSharedPiProgression());
	});
	it("the package includes the batch runtime and Pi extension", async () => {
		expect(JSON.parse(readFileSync(join(import.meta.dir, "../package.json"), "utf8")).files).toContain("plugins/immune-brain/runtime/unattended");
		expect((await import("../plugins/immune-brain/runtime/unattended/batch_plan")).projectBatchPlan).toBeDefined();
		expect(JSON.parse(readFileSync(join(import.meta.dir, "../plugins/immune-brain/.pi-extension/package.json"), "utf8")).pi.extensions).toContain("./imm-unattended-batch.ts");
	});
	it("registered Tool content exposes the Lane report, Executor handoffs and every child manifest", async () => {
		const f = fixture("tool-content-manifest"); const tool = register(async () => f.observation);
		const response = await tool.execute("manifest", { initiative_slug: f.slug, final_verification: ["bun test", "bun run typecheck"] }, undefined, undefined, context(f.root, "confirm")); const content = textOf(response);
		expect(content.state).toBe("started"); expect(content.report.batch_state).toBe("running"); expect(content.report.max_parallel).toBe(1);
		expect(content.report.handoffs[0]).toMatchObject({ role: "executor", task_id: `${f.slug}-c1`, next_obligation: "submit_assurance" });
		expect(content.report).not.toHaveProperty("handoff"); expect(content.report.next_action.length).toBeGreaterThan(0);
		expect(content.manifest.children).toHaveLength(3);
		for (const [n, risk] of [[1, "routine"], [2, "material"], [3, "critical"]]) expect(content.manifest.children).toContainEqual({
			task_id: `${f.slug}-c${n}`, slice_id: `S${n}`, risk, scope: [`docs/plans/${f.slug}-c${n}.intent.json`, `docs/specs/archive/${f.slug}-c${n}.spec.md`, `docs/specs/${f.slug}-c${n}.spec.md`], verification: ["bun test"],
		});
	});
});

describe("lane mode parameters and authorization reuse", () => {
	it("refuses lane_offers without max_parallel on a fresh start before any gate opens", async () => {
		const f = fixture("lane-offers-only"); const tool = register(async () => f.observation); const opened = { count: 0 };
		await expect(tool.execute("tc", { initiative_slug: f.slug, lane_offers: [] }, undefined, undefined, context(f.root, "decline", opened))).rejects.toThrow(/lane_offers_retired/);
		expect(opened.count).toBe(0); noBatchWrites(f.root);
	});
	it("refuses invalid max_parallel and malformed offers before any gate with zero writes", async () => {
		const f = fixture("lane-invalid"); const tool = register(async () => f.observation); const before = snapshot(f.root);
		for (const extra of [{ max_parallel: 0 }, { max_parallel: -1 }, { max_parallel: 1.5 }, { max_parallel: "1" },
			{ lane_offers: [{ task_id: `${f.slug}-c1`, path: "/tmp/x" }] }, { max_parallel: 1, lane_offers: [{ task_id: `${f.slug}-c1`, path: "relative" }] },
			{ max_parallel: 1, lane_offers: [{ task_id: "../escape", path: "/tmp/x" }] }, { max_parallel: 1, lane_offers: [{ task_id: `${f.slug}-c1`, path: "/tmp/x", extra: 1 }] }]) {
			const opened = { count: 0 }; await expect(tool.execute("tc", { initiative_slug: f.slug, ...extra }, undefined, undefined, context(f.root, "decline", opened))).rejects.toThrow();
			expect(opened.count).toBe(0); expect(snapshot(f.root)).toEqual(before); noBatchWrites(f.root);
		}
	});
	for (const max_parallel of [1, 2]) it(`reuses max_parallel=${max_parallel} Lane authorization without a second native gate`, async () => {
		const f = fixture(`lane-reuse-${max_parallel}`); let gates = 0;
		const options = { root: f.root, initiativeSlug: f.slug, readInitiative: async () => f.observation, confirmBatch: async () => { gates++; return "accept" as const; } };
		const first = await runBatch({ ...options, max_parallel }); const second = await runBatch({ ...options, final_verification: undefined });
		expect(first.state).toBe("started"); expect(second.state).toBe("started"); expect(gates).toBe(1);
		if (first.state !== "started" || second.state !== "started") throw new Error("Lane did not start");
		expect(second.batch_id).toBe(first.batch_id); expect(second.report.max_parallel).toBe(max_parallel);
		const path = join(f.root, `.imm/state/batches/${first.batch_id}.json`); const bytes = readFileSync(path);
		const mismatch = await runBatch({ ...options, max_parallel: max_parallel + 1 });
		expect(JSON.stringify(mismatch)).toContain("batch_parallel_mismatch"); expect(gates).toBe(1); expect(readFileSync(path)).toEqual(bytes);
	});
	it("accepts max_parallel above 1 through one gate", async () => {
		const f = fixture("lane-wide"); let gates = 0;
		const result = await runBatch({ root: f.root, initiativeSlug: f.slug, max_parallel: 2, readInitiative: async () => f.observation, confirmBatch: async () => { gates++; return "accept"; } });
		expect(gates).toBe(1); expect(result.state).toBe("started");
	});
});

describe("native Parent final verification gate", () => {
	it("shows exact commands before any Git or command effect", async () => {
		const root = mkdtempSync(join(tmpdir(), "pi-native-final-")); roots.push(root); copyGitTemplate(root);
		const taskId = "delivered", paths = ["src/delivered.ts", `docs/plans/${taskId}.intent.json`, `docs/plans/archive/${taskId}.intent.json`];
		const intent = parseTaskIntentV1({ contract: "assurance_kernel/task_intent/v1", task_id: taskId, owner: "user", goal: "Deliver", scope_hint: paths,
			acceptance: [{ id: "acc-1", assertion: "delivered", verification: "bun test" }], risk: "material", revision: 1 });
		mkdirSync(join(root, "docs/plans/archive"), { recursive: true }); for (const path of paths.slice(1)) writeFileSync(join(root, path), `${JSON.stringify(intent, null, 2)}\n`);
		const ran = join(root, ".imm-ran"); writeFileSync(join(root, "marker.ts"), `require('node:fs').writeFileSync(${JSON.stringify(ran)}, 'ran');\n`);
		git(root, "add", "docs", "marker.ts"); git(root, "commit", "-qm", "plan"); const baseline = git(root, "rev-parse", "HEAD"); const hash = canonicalIntentHash(intent);
		const audit = join(root, ".imm/audit", taskId); mkdirSync(audit, { recursive: true });
		const record = `${JSON.stringify({ contract: "assurance_kernel/task_record/v4", task_id: taskId, intent_snapshot: intent,
			intent_ref: { path: paths[2], content_hash: hash }, lifecycle: "done", artifact_state: "frozen", baseline: hash, git_base_head: baseline, attestations: [], findings: [], history: [] }, null, 2)}\n`;
		writeFileSync(join(audit, "task-record.json"), record); writeFileSync(join(audit, "terminal-proof.json"), `${JSON.stringify({ contract: "assurance_kernel/task_tombstone/v2", task_id: taskId,
			lifecycle_status: "terminal", terminal_lifecycle: "done", terminal_event_id: "evt-term-delivered", final_record_hash: `sha256:${new Bun.CryptoHasher("sha256").update(record).digest("hex")}`, terminalized_at: new Date().toISOString() }, null, 2)}\n`);
		mkdirSync(join(root, "src")); writeFileSync(join(root, paths[0]!), "export const delivered = true;\n");
		const seen: any[] = []; const observation = { initiative_slug: "native-final", carrier: "local" as const, tasks: [{ task_id: taskId, slice_id: "S1", blocked_by: [] }] };
		const run = (decision: "accept" | "decline") => runBatch({ root, initiativeSlug: "native-final", final_verification: ["bun marker.ts"], readInitiative: async () => observation,
			confirmBatch: async details => { seen.push(details); return decision; } });
		expect(await run("decline")).toMatchObject({ state: "rejected" }); expect(seen).toHaveLength(1);
		expect(seen[0].title).toContain("Parent Final Verification"); expect(seen[0].summary).toContain("bun marker.ts"); expect(seen[0].details).toContain(taskId);
		expect(git(root, "rev-parse", "HEAD")).toBe(baseline); expect(existsSync(ran)).toBe(false);
		expect(await run("accept")).toMatchObject({ state: "native_parent", action: "complete", proof: { complete: true } }); expect(existsSync(ran)).toBe(true);
		expect(await runBatch({ root, initiativeSlug: "native-final", final_verification: undefined, readInitiative: async () => observation,
			confirmBatch: async () => { throw new Error("recorded Parent commands need no new gate"); } }))
			.toMatchObject({ state: "native_parent", action: "complete", final_verification_commands: ["bun marker.ts"] });
	});
});
