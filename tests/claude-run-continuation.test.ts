import { describe, expect, spyOn, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync, appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canonicalIntentHash, parseTaskIntentV1, readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import { computeBatchPlanDigest } from "../plugins/immune-brain/runtime/kernel/batch_authority";
import { recoverKernelStoreFollowUps, readSettledRunEvidence } from "../plugins/immune-brain/runtime/kernel/storage";
import { hasContiguousLaneRebind } from "../plugins/immune-brain/runtime/assurance/run_continuation";
import { prepareBatchLaneRunState, rebindBatchChildIdentity, rebindSingleTaskIdentity, writeBatchLaneRunState,
	type BatchLaneRunStateRecord } from "../plugins/immune-brain/runtime/unattended/batch_state";
import { recordParentRepair } from "../plugins/immune-brain/runtime/unattended/batch_git";
import * as coordinator from "../plugins/immune-brain/runtime/assurance/coordinator";
import { NO_PHASE_ENTRY } from "../plugins/immune-brain/runtime/assurance/phase_entry";
import { consumePhaseAdmission, phaseEntryGateHookOutput, readPhaseEntryState, recordPhaseEntryPrompt } from "../plugins/immune-brain/runtime/claude/lane_guard";
import { readRunToolSession, runContinuationHookOutput } from "../plugins/immune-brain/runtime/claude/run_continuation";
import { sessionHash } from "../plugins/immune-brain/runtime/host-core/private_file";
import { seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "gdr-claude-"));
	const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
	git("init", "-q"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.test");
	mkdirSync(join(root, "docs/plans"), { recursive: true });
	writeFileSync(join(root, ".gitignore"), ".imm/\nimmune-brain-claude/\n"); writeFileSync(join(root, "value.txt"), "before\n");
	const intent = parseTaskIntentV1({ contract: "assurance_kernel/task_intent/v1", task_id: "slice-a", goal: "Change value",
		acceptance: [{ id: "A1", assertion: "Value changes", verification: "bun test tests/value.test.ts" }],
		scope_hint: ["value.txt", "docs/plans/slice-a.intent.json"], risk: "material", revision: 1, owner: "user" });
	writeFileSync(join(root, "docs/plans/slice-a.intent.json"), JSON.stringify(intent, null, 2) + "\n");
	git("add", "."); git("commit", "-qm", "fixture");
	seedKernelRunForTest(root, { task_id: "slice-a", run_id: "run-a", record: {
		contract: "assurance_kernel/task_record/v4", task_id: "slice-a", intent_snapshot: intent,
		intent_ref: { path: "docs/plans/slice-a.intent.json", content_hash: canonicalIntentHash(intent) },
		lifecycle: "active", artifact_state: "active", baseline: `sha256:${"a".repeat(64)}`,
		git_base_head: git("rev-parse", "HEAD"), attestations: [], findings: [], history: [],
	} });
	let sequence = 0;
	const base = { cwd: root, session_id: "hook-session" };
	const hook = (event: Record<string, unknown>) => runContinuationHookOutput({ ...base, ...event }, root);
	const prompt = async (text: string) => {
		const event = { ...base, hook_event_name: "UserPromptSubmit", prompt: text };
		recordPhaseEntryPrompt(event, { root }); await hook(event);
	};
	const tool = (operation = "status") => ({ tool_name: `mcp__plugin_immune-brain_immune-brain__${operation}`,
		tool_use_id: `tool-${++sequence}`, tool_input: { task_id: "slice-a" } });
	const enter = async () => {
		await prompt("/drive slice-a"); const event = tool();
		await hook({ hook_event_name: "PreToolUse", ...event });
		await hook({ hook_event_name: "PostToolUse", ...event, tool_response: {} });
	};
	let boundary = 0;
	const transcript = join(root, ".imm", "transcript.jsonl");
	const stop = (duplicate = false) => {
		if (!duplicate) appendFileSync(transcript, JSON.stringify({ type: "assistant", uuid: `assistant-${++boundary}`, message: { role: "assistant" } }) + "\n");
		return hook({ hook_event_name: "Stop", stop_hook_active: true, transcript_path: transcript });
	};
	return { root, hook, prompt, tool, enter, stop, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

describe("Claude run continuation", () => {
	test("second incomplete pauses and revokes the run entry, not Kernel authority", async () => {
		const h = fixture(); try {
			await h.enter();
			const result = async (response: object) => {
				const event = h.tool("submit_review");
				await h.hook({ hook_event_name: "PreToolUse", ...event });
				await h.hook({ hook_event_name: "PostToolUse", ...event, tool_response: response });
			};
			await result({ state: "blocked", reason: "review_incomplete_retry", recovery_action: "advance_assurance" });
			expect(readPhaseEntryState("hook-session", h.root)?.run_live).toBe(true);
			await result({ state: "review_incomplete", reason: "unfinished", recovery_action: "reduce scope and enter drive" });
			expect(readPhaseEntryState("hook-session", h.root)?.run_live).toBe(false);
			expect(JSON.parse((await h.stop())!)).toMatchObject({ systemMessage: expect.stringContaining("review_incomplete") });
		} finally { h.dispose(); }
	});
	test("unbound Stop is silent; exact run entry, Hook and Kernel facts bind", async () => {
		const h = fixture(); try {
			expect(await h.stop()).toBeNull(); await h.enter();
			expect(JSON.parse((await h.stop())!)).toMatchObject({ decision: "block" });
			await h.prompt("What remains?"); writeFileSync(join(h.root, "value.txt"), "edited\n");
			expect(JSON.parse((await h.stop())!)).toMatchObject({ decision: "block" });
		} finally { h.dispose(); }
	});

	test("a wrong session or workspace cannot consume another Hook's result", async () => {
		const h = fixture(); try {
			await h.prompt("/drive slice-a"); const event = h.tool();
			await h.hook({ hook_event_name: "PreToolUse", ...event });
			expect(readRunToolSession(event.tool_use_id, "status", h.root, h.root)).toBe("hook-session");
			expect(readRunToolSession(event.tool_use_id, "enroll", h.root, h.root)).toBeNull();
			expect(readRunToolSession(event.tool_use_id, "status", tmpdir(), h.root)).toBeNull();
			await h.hook({ hook_event_name: "PostToolUse", ...event, session_id: "another-session", tool_response: {} });
			expect(await h.stop()).toBeNull();
			await h.hook({ hook_event_name: "PostToolUse", ...event, tool_response: {} });
			expect(JSON.parse((await h.stop())!)).toMatchObject({ decision: "block" });
			// Correlation is one-use, even across MCP transport reconnections.
			expect(readRunToolSession(event.tool_use_id, "status", h.root, h.root)).toBeNull();
		} finally { h.dispose(); }
	});

	test("an unchanged digest blocks once then yields every later Stop without pausing; progress blocks again (D12)", async () => {
		const h = fixture(); try {
			await h.enter(); expect(JSON.parse((await h.stop())!).decision).toBe("block");
			// Waiting on background work: any number of unchanged Stops end the turn quietly.
			for (let wait = 0; wait < 10; wait++) expect(await h.stop()).toBeNull();
			expect(await h.hook({ hook_event_name: "Stop", stop_hook_active: false, transcript_path: join(h.root, ".imm", "transcript.jsonl") })).toBeNull();
			expect(readPhaseEntryState("hook-session", h.root)?.token).toBeTruthy();
			expect(await h.hook({ hook_event_name: "PreToolUse", ...h.tool("enroll") })).toBeNull();
			writeFileSync(join(h.root, "value.txt"), "after\n");
			expect(JSON.parse((await h.stop())!).decision).toBe("block");
			expect(await h.stop()).toBeNull();
		} finally { h.dispose(); }
	}, 20000);

	test("the block reason says a user-only wait is a valid stop and must not repeat the request", async () => {
		const h = fixture(); try {
			await h.enter();
			const reason = JSON.parse((await h.stop())!).reason as string;
			expect(reason).toContain("only the user can perform");
			expect(reason).toContain("valid stop");
			expect(reason).toContain("without repeating the request");
		} finally { h.dispose(); }
	});

	test.each(["取消任务", "/draw-up", "/clarify"])("%s releases the binding", async prompt => {
		const h = fixture(); try { await h.enter(); await h.prompt(prompt); expect(await h.stop()).toBeNull(); }
		finally { h.dispose(); }
	});

	test("two native-operation failures leave the run live; the third pauses and denies; a new entry resets the count (D9)", async () => {
		const h = fixture(); try {
			await h.enter();
			const fail = async () => {
				const event = h.tool("request_authorization");
				await h.hook({ hook_event_name: "PreToolUse", ...event });
				await h.hook({ hook_event_name: "PostToolUseFailure", ...event, error: "rejected" });
			};
			for (let attempt = 1; attempt <= 2; attempt++) {
				await fail();
				expect(JSON.parse((await h.stop())!).decision).toBe("block");
				writeFileSync(join(h.root, "value.txt"), `retry ${attempt}\n`);
				expect(await h.hook({ hook_event_name: "PreToolUse", ...h.tool("enroll") })).toBeNull();
			}
			await fail();
			expect(JSON.parse((await h.stop())!)).toMatchObject({ systemMessage: expect.stringContaining("failed 3 times under this entry") });
			const retry = await h.hook({ hook_event_name: "PreToolUse", ...h.tool("enroll") });
			expect(retry === null || JSON.parse(retry).hookSpecificOutput?.permissionDecision === "deny").toBe(true);
			expect(readPhaseEntryState("hook-session", h.root)?.run_live).toBe(false);
			await h.enter(); await fail(); await fail();
			expect(JSON.parse((await h.stop())!).decision).toBe("block");
		} finally { h.dispose(); }
	});

	test("session metadata past the 256 KiB bound is treated as blank (D9)", async () => {
		const h = fixture(); try {
			await h.enter();
			expect(JSON.parse((await h.stop())!).decision).toBe("block");
			const path = join(h.root, "immune-brain-claude", `${sessionHash("hook-session")}.continuation`);
			expect(existsSync(path)).toBe(true);
			// Still valid metadata, only past the bound: the size alone decides the blank read, not a parse fault.
			const metadata = JSON.parse(readFileSync(path, "utf8").trim());
			writeFileSync(path, JSON.stringify({ ...metadata, pad: "x".repeat(256 * 1024) }) + "\n");
			expect(await h.stop()).toBeNull();
		} finally { h.dispose(); }
	});

	test("the actual MCP text-block array reports native rejection and pauses at the third one", async () => {
		const h = fixture(); try {
			await h.enter();
			for (let attempt = 0; attempt < 3; attempt++) {
				const event = h.tool("request_authorization");
				await h.hook({ hook_event_name: "PreToolUse", ...event });
				await h.hook({ hook_event_name: "PostToolUse", ...event,
					tool_response: [{ type: "text", text: JSON.stringify({ state: "rejected" }) }] });
			}
			expect(JSON.parse((await h.stop())!)).toMatchObject({ systemMessage: expect.stringContaining("did not apply 3 times") });
		} finally { h.dispose(); }
	});

	test("duplicate and unidentifiable Stop callbacks yield without spending stall budget", async () => {
		const h = fixture(); try {
			await h.enter();
			expect(await h.hook({ hook_event_name: "Stop", stop_hook_active: true })).toBeNull();
			expect(JSON.parse((await h.stop())!).decision).toBe("block");
			expect(await h.stop(true)).toBeNull(); expect(await h.stop(true)).toBeNull();
			expect(await h.stop()).toBeNull();
		} finally { h.dispose(); }
	});

	test("a changed workspace releases the run before observing old authority", async () => {
		const h = fixture(); try {
			await h.enter();
			expect(JSON.parse((await h.hook({ hook_event_name: "Stop", cwd: tmpdir() }))!).systemMessage).toContain("workspace changed");
			expect(await h.stop()).toBeNull();
		} finally { h.dispose(); }
	});

	test("a pause revokes the entry token and refuses retire_stale_batch and the native gates (D10)", async () => {
		const h = fixture(); try {
			await h.enter();
			for (let attempt = 0; attempt < 3; attempt++) {
				const event = h.tool("request_authorization");
				await h.hook({ hook_event_name: "PreToolUse", ...event });
				await h.hook({ hook_event_name: "PostToolUseFailure", ...event, error: "rejected" });
			}
			expect(JSON.parse((await h.stop())!).systemMessage).toContain("failed 3 times");
			expect(readPhaseEntryState("hook-session", h.root)?.token ?? null).toBeNull();
			// With the entry spent, the phase-entry gate denies and records no admission for tools/call to consume.
			for (const operation of ["retire_stale_batch", "start_unattended_batch"] as const) {
				const denial = JSON.parse(phaseEntryGateHookOutput({ hook_event_name: "PreToolUse",
					tool_name: `mcp__plugin_immune-brain_immune-brain__${operation}`, tool_input: {}, tool_use_id: `paused-${operation}`,
					session_id: "hook-session", cwd: h.root }, { root: h.root })!);
				expect(denial).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
				expect(consumePhaseAdmission(`paused-${operation}`, operation, h.root)).toBe(false);
			}
		} finally { h.dispose(); }
	});

	test("the entry token survives a same-session Stop continuation and is spent when the bound run settles", async () => {
		const h = fixture();
		const retire = (tool_use_id: string) => phaseEntryGateHookOutput({ hook_event_name: "PreToolUse",
			tool_name: "mcp__plugin_immune-brain_immune-brain__retire_stale_batch", tool_input: {}, tool_use_id,
			session_id: "hook-session", cwd: h.root }, { root: h.root });
		const projection = spyOn(coordinator, "projectTaskStatus");
		try {
			await h.enter();
			const token = readPhaseEntryState("hook-session", h.root)?.token;
			expect(token).toBeTruthy();
			expect(JSON.parse((await h.stop())!).decision).toBe("block");
			expect(readPhaseEntryState("hook-session", h.root)).toMatchObject({ run_live: true, token });
			expect(retire("tool-live")).toBeNull();
			expect(consumePhaseAdmission("tool-live", "retire_stale_batch", h.root)).toMatchObject({ entry_token: token });
			// The Kernel now reports the bound run terminal: the next Stop settles it.
			const live = await coordinator.projectTaskStatus(h.root, "slice-a");
			projection.mockResolvedValue({ ...live, claim: null, projection: { ...live.projection, lifecycle: "done", completion_ready: true } });
			expect(await h.stop()).toBeNull();
			expect(readPhaseEntryState("hook-session", h.root)).toEqual(NO_PHASE_ENTRY);
			expect(JSON.parse(retire("tool-spent")!)).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
			expect(consumePhaseAdmission("tool-spent", "retire_stale_batch", h.root)).toBe(false);
		} finally { projection.mockRestore(); h.dispose(); }
	});

	test("SessionEnd removes continuation without settling Kernel authority", async () => {
		const h = fixture(); try {
			await h.enter(); await h.hook({ hook_event_name: "SessionEnd" }); expect(await h.stop()).toBeNull();
		} finally { h.dispose(); }
	});
});

// Spec docs/specs/parent-hook-remoteless-guards.spec.md: a remote-less `single_task`
// Lane has no Initiative carrier, no configured final verification and no Parent ref
// after Lane cleanup, so Parent continuation must read its own local facts only.
const LANE_TASK = "lane-task";
const LANE_BATCH = "batch-lane";
const LANE_CONFIRMED_AT = "2026-01-01T00:00:00.000Z";
const LANE_NOW = "2026-01-02T00:00:00.000Z";

function laneIntentJson(revision: number) {
	return `${JSON.stringify({ contract: "assurance_kernel/task_intent/v1", task_id: LANE_TASK, owner: "user",
		goal: `Deliver ${LANE_TASK} rev ${revision}`,
		acceptance: [{ id: "A1", assertion: "The Lane task is delivered", verification: "bun test tests/value.test.ts" }],
		scope_hint: [`docs/plans/${LANE_TASK}.intent.json`, "delivery.txt"], risk: "material", revision })}\n`;
}

function laneParent(options: {
	completed?: boolean;
	laneRemoved?: boolean;
	deleteRef?: boolean;
	finalVerification?: string[];
	finalResult?: { exit_code: number | null; passed: boolean };
	blockedReturn?: boolean;
} = {}) {
	const root = mkdtempSync(join(tmpdir(), "gdr-lane-parent-"));
	const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
	git("init", "-q", "-b", "main");
	git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.test");
	mkdirSync(join(root, "docs/plans"), { recursive: true });
	writeFileSync(join(root, ".gitignore"), "immune-brain-claude/\n.imm/state/\n");
	writeFileSync(join(root, `docs/plans/${LANE_TASK}.intent.json`), laneIntentJson(1));
	git("add", "-A"); git("commit", "-qm", "base");
	const base = git("rev-parse", "HEAD");
	const read = readTaskIntent(root, LANE_TASK);
	let head = base;
	if (options.completed) {
		seedKernelRunForTest(root, { task_id: LANE_TASK, run_id: "run-lane", terminal: { lifecycle: "done" }, record: {
			contract: "assurance_kernel/task_record/v4", task_id: LANE_TASK, intent_snapshot: read.intent,
			intent_ref: { path: `docs/plans/${LANE_TASK}.intent.json`, content_hash: read.content_hash },
			lifecycle: "done", artifact_state: "frozen", baseline: read.content_hash, git_base_head: base,
			attestations: [], findings: [], history: [] } });
		recoverKernelStoreFollowUps(root, LANE_TASK);
		writeFileSync(join(root, "delivery.txt"), "delivered\n");
		git("add", "-A", "delivery.txt", ".imm/audit");
		git("commit", "-qm", "lane delivery");
		head = git("rev-parse", "HEAD");
		git("update-ref", `refs/heads/imm/${LANE_TASK}`, head);
		if (options.deleteRef ?? options.laneRemoved) git("update-ref", "-d", `refs/heads/imm/${LANE_TASK}`);
	} else git("update-ref", `refs/heads/imm/${LANE_TASK}`, base);
	const lanePath = join(root, ".git", "imm", "worktrees", LANE_TASK, LANE_TASK);
	const laneBranch = `imm-lane/${LANE_TASK}/${LANE_TASK}`;
	const children = [{ task_id: LANE_TASK, slice_id: LANE_TASK, blocked_by: [], status: "enrollable" as const, reason: null,
		intent_path: `docs/plans/${LANE_TASK}.intent.json`, intent_revision: 1, intent_content_hash: read.content_hash }];
	const prepared = prepareBatchLaneRunState({ plan_source: "single_task", batch_id: LANE_BATCH, initiative_slug: LANE_TASK,
		children, plan_digest: computeBatchPlanDigest(children), base_head: base, branch: `refs/heads/imm/${LANE_TASK}`,
		confirmation_time: LANE_CONFIRMED_AT,
		budget: { max_children: 1, qa_failure_limit: 2 }, max_parallel: 1, now: LANE_NOW,
		final_verification: options.finalVerification });
	const lane = { path: lanePath, branch: laneBranch, base_head: base, lane_commit: null };
	const record: BatchLaneRunStateRecord = options.completed
		? { ...prepared, batch_state: "completed", commits: [head],
			...(options.finalResult ? { final_verification_result: { passed: options.finalResult.passed, head,
				results: [{ command: options.finalVerification![0]!, exit_code: options.finalResult.exit_code,
					signal: null, passed: options.finalResult.passed, duration_ms: 1 }] } } : {}),
			final_report: { contract: "assurance_kernel/batch_final_report/v1", head, children: [], final_verification: null,
				return_to_coordinator: { mode: "manual", status: options.blockedReturn ? "blocked" : "staged",
					reason: options.blockedReturn ? "checkout_delivery_overlap" : null } },
			children: [{ ...prepared.children[0]!, state: "released", commit: head,
				lane: { ...lane, lane_commit: head },
				...(options.laneRemoved
					? { lane_removed: { exit: { generation: 1, code: 0, signal: null }, worktree: lanePath,
						branches: [laneBranch, `imm/${LANE_TASK}`] } }
					: { lane_retained: { condition: "exit_proof_unavailable" } }) }] }
		: { ...prepared, batch_state: "running", children: [{ ...prepared.children[0]!, state: "enrolled", lane }] };
	writeBatchLaneRunState(root, record);
	// A remote-less checkout: the Parent has no carrier to query and `gh` can answer nothing.
	const transcript = join(root, "transcript.jsonl");
	let boundary = 0;
	const hook = (event: Record<string, unknown>) => runContinuationHookOutput({ cwd: root, session_id: "lane-session", ...event }, root);
	const prompt = async () => {
		recordPhaseEntryPrompt({ hook_event_name: "UserPromptSubmit", prompt: `/drive ${LANE_TASK}`, cwd: root, session_id: "lane-session" }, { root });
		await hook({ hook_event_name: "UserPromptSubmit", prompt: `/drive ${LANE_TASK}` });
	};
	const tool = (operation: string, id: string) => ({ tool_name: `mcp__plugin_immune-brain_immune-brain__${operation}`,
		tool_use_id: id, tool_input: {} });
	const start = async (id = "lane-start") => {
		const event = tool("start_unattended_batch", id);
		await hook({ hook_event_name: "PreToolUse", ...event });
		return hook({ hook_event_name: "PostToolUse", ...event, tool_response: { state: "started", batch_id: LANE_BATCH } });
	};
	const open = async () => { await prompt(); await start(); };
	const stop = async (cwd = root) => {
		appendFileSync(transcript, JSON.stringify({ type: "assistant", uuid: `assistant-${++boundary}`, message: { role: "assistant" } }) + "\n");
		return hook({ hook_event_name: "Stop", stop_hook_active: true, transcript_path: transcript, cwd });
	};
	const binding = () => {
		const path = join(root, "immune-brain-claude", `${sessionHash("lane-session")}.continuation`);
		return existsSync(path) ? JSON.parse(readFileSync(path, "utf8").trim()).state?.binding ?? null : null;
	};
	const rebind = (revision: number) => {
		writeFileSync(join(root, `docs/plans/${LANE_TASK}.intent.json`), laneIntentJson(revision));
		const revised = readTaskIntent(root, LANE_TASK);
		return rebindSingleTaskIdentity(root, LANE_BATCH, { task_id: LANE_TASK, intent: revised.intent, content_hash: revised.content_hash });
	};
	return { root, git, lanePath, hook, prompt, start, tool, open, stop, binding, rebind, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

describe("Claude run continuation: remote-less single_task Parent", () => {
	test("remote-less single_task Parent blocks once on active progress without gh", async () => {
		const p = laneParent(); try {
			await p.open();
			expect(JSON.parse((await p.stop())!).decision).toBe("block");
		} finally { p.dispose(); }
	});

	test("remote-less single_task Parent yields unchanged waits without spending its entry token", async () => {
		const p = laneParent(); try {
			await p.open();
			expect(JSON.parse((await p.stop())!).decision).toBe("block");
			for (let wait = 0; wait < 3; wait++) expect(await p.stop()).toBeNull();
			expect(readPhaseEntryState("lane-session", p.root)).toMatchObject({ run_live: true });
		} finally { p.dispose(); }
	});

	for (const [label, removed] of [["lane_removed", true], ["lane_retained", false]] as const)
		test(`remote-less single_task Parent settles silently after Lane cleanup (${label})`, async () => {
			const p = laneParent({ completed: true, laneRemoved: removed }); try {
				await p.open();
				expect(await p.stop()).toBeNull();
				expect(readPhaseEntryState("lane-session", p.root)).toEqual(NO_PHASE_ENTRY);
			} finally { p.dispose(); }
		});

	test("remote-less single_task Parent repair observation never calls gh", async () => {
		const p = laneParent({ completed: true, laneRemoved: false, finalVerification: ["bun test"],
			finalResult: { exit_code: 1, passed: false } }); try {
			await expect(recordParentRepair(p.root, LANE_BATCH, LANE_TASK)).resolves.toBeUndefined();
		} finally { p.dispose(); }
	});

	test("remote-less single_task Parent refuses settlement without a passing final verification", async () => {
		const p = laneParent({ completed: true, laneRemoved: false, finalVerification: ["bun test"] }); try {
			await p.open();
			expect(JSON.parse((await p.stop())!).systemMessage).toContain("Final verification has not passed on the delivered content");
		} finally { p.dispose(); }
	});

	test("remote-less single_task Parent refuses a blocked checkout return after its ref is gone", async () => {
		const p = laneParent({ completed: true, laneRemoved: true, blockedReturn: true }); try {
			await p.open();
			expect(JSON.parse((await p.stop())!).systemMessage).toContain("continuation facts could not be verified");
		} finally { p.dispose(); }
	});

	test("remote-less single_task Parent refuses a missing Parent ref without a removed Lane", async () => {
		const p = laneParent({ completed: true, laneRemoved: false, deleteRef: true }); try {
			await p.open();
			expect(JSON.parse((await p.stop())!).systemMessage).toContain("Parent evidence requires an existing Parent ref");
		} finally { p.dispose(); }
	});

	test("a remote-less non-single_task Parent still fails closed without its Initiative carrier", async () => {
		const p = laneParent(); try {
			// The recorded batch claims an Initiative identity, so its reader is the GitHub one.
			writeBatchLaneRunState(p.root, { ...(JSON.parse(readFileSync(join(p.root, ".imm/state/batches", `${LANE_BATCH}.json`), "utf8")) as BatchLaneRunStateRecord),
				plan_source: undefined });
			await p.open();
			expect(JSON.parse((await p.stop())!).systemMessage).toContain("continuation facts could not be verified");
		} finally { p.dispose(); }
	});
});

describe("Claude run continuation: lane_rebinds plan_digest", () => {
	test("lane_rebinds plan_digest advance advances the persisted binding on Stop", async () => {
		const p = laneParent(); try {
			await p.open();
			const before = p.binding().plan_digest;
			const rebound = p.rebind(2);
			expect(rebound.plan_digest).not.toBe(before);
			expect(JSON.parse((await p.stop())!).decision).toBe("block");
			expect(p.binding()).toMatchObject({ plan_digest: rebound.plan_digest });
		} finally { p.dispose(); }
	});

	test("lane_rebinds plan_digest advance binds PostToolUse of start_unattended_batch", async () => {
		const p = laneParent(); try {
			await p.open();
			const rebound = p.rebind(2);
			await p.start("lane-rebound");
			expect(p.binding()).toMatchObject({ plan_digest: rebound.plan_digest });
		} finally { p.dispose(); }
	});

	test("a two-step contiguous lane_rebinds plan_digest chain advances in one Stop boundary", async () => {
		const p = laneParent(); try {
			await p.open();
			const first = p.rebind(2);
			const second = p.rebind(3);
			expect(second.plan_digest).not.toBe(first.plan_digest);
			expect(JSON.parse((await p.stop())!).decision).toBe("block");
			expect(p.binding()).toMatchObject({ plan_digest: second.plan_digest });
		} finally { p.dispose(); }
	});

	test("a lane_rebinds plan_digest change without a contiguous chain fails closed", async () => {
		const p = laneParent(); try {
			await p.open();
			const path = join(p.root, ".imm/state/batches", `${LANE_BATCH}.json`);
			const record = JSON.parse(readFileSync(path, "utf8")) as BatchLaneRunStateRecord;
			writeBatchLaneRunState(p.root, { ...record, plan_digest: `sha256:${"b".repeat(64)}` });
			expect(JSON.parse((await p.stop())!).systemMessage)
				.toContain("Parent continuation has no matching persisted batch identity");
		} finally { p.dispose(); }
	});
});

describe("hasContiguousLaneRebind: Initiative and negative controls (AGR-A2)", () => {
	const NOW = "2026-01-01T00:00:00.000Z";
	function intent(taskId: string, revision: number) {
		return parseTaskIntentV1({ contract: "assurance_kernel/task_intent/v1", task_id: taskId, owner: "user",
			goal: `Goal ${taskId}`, acceptance: [{ id: "A1", assertion: "done", verification: "bun test x" }],
			scope_hint: [`docs/plans/${taskId}.intent.json`], risk: "material", revision });
	}
	function twoChildRecord() {
		const a = intent("task-a", 1), b = intent("task-b", 1);
		const kids = [
			{ task_id: "task-a", slice_id: "A", blocked_by: [], intent_path: "docs/plans/task-a.intent.json", intent_revision: 1, intent_content_hash: canonicalIntentHash(a) },
			{ task_id: "task-b", slice_id: "B", blocked_by: [], intent_path: "docs/plans/task-b.intent.json", intent_revision: 1, intent_content_hash: canonicalIntentHash(b) },
		];
		const root = mkdtempSync(join(tmpdir(), "rebind-neg-"));
		try { execFileSync("git", ["init", "-q"], { cwd: root }); } catch { /* git optional for pure rebind math */ }
		const planDigest = computeBatchPlanDigest(kids);
		const record = prepareBatchLaneRunState({ batch_id: "neg", initiative_slug: "init-neg", children: kids,
			plan_digest: planDigest, base_head: "a".repeat(40), branch: "imm/init-neg", confirmation_time: NOW,
			budget: { max_children: 2, qa_failure_limit: 2 }, max_parallel: 2, now: NOW });
		return { root, record, planDigest, cleanup: () => rmSync(root, { recursive: true, force: true }) };
	}
	test("accepts a contiguous Initiative child chain", () => {
		const f = twoChildRecord();
		try {
			writeBatchLaneRunState(f.root, f.record);
			const revised = intent("task-b", 2);
			const rebound = rebindBatchChildIdentity(f.root, "neg", { task_id: "task-b", intent: revised, content_hash: canonicalIntentHash(revised) });
			expect(hasContiguousLaneRebind(rebound, f.planDigest)).toBe(true);
		} finally { f.cleanup(); }
	});
	test("refuses a chain with a gap", () => {
		const f = twoChildRecord();
		try {
			writeBatchLaneRunState(f.root, f.record);
			const r2 = intent("task-b", 2);
			const first = rebindBatchChildIdentity(f.root, "neg", { task_id: "task-b", intent: r2, content_hash: canonicalIntentHash(r2) });
			const gapped = { ...first, lane_rebinds: [{ ...first.lane_rebinds![0]!, to_digest: `sha256:${"c".repeat(64)}` }] };
			expect(hasContiguousLaneRebind(gapped as BatchLaneRunStateRecord, f.planDigest)).toBe(false);
		} finally { f.cleanup(); }
	});
	test("refuses a foreign task_id", () => {
		const f = twoChildRecord();
		try {
			writeBatchLaneRunState(f.root, f.record);
			const r2 = intent("task-b", 2);
			const rebound = rebindBatchChildIdentity(f.root, "neg", { task_id: "task-b", intent: r2, content_hash: canonicalIntentHash(r2) });
			const foreign = { ...rebound, lane_rebinds: [{ ...rebound.lane_rebinds![0]!, task_id: "task-foreign" }] };
			expect(hasContiguousLaneRebind(foreign as BatchLaneRunStateRecord, f.planDigest)).toBe(false);
		} finally { f.cleanup(); }
	});
	test("refuses a target digest off the chain", () => {
		const f = twoChildRecord();
		try {
			writeBatchLaneRunState(f.root, f.record);
			const r2 = intent("task-b", 2);
			const rebound = rebindBatchChildIdentity(f.root, "neg", { task_id: "task-b", intent: r2, content_hash: canonicalIntentHash(r2) });
			expect(hasContiguousLaneRebind(rebound, `sha256:${"d".repeat(64)}`)).toBe(false);
			expect(hasContiguousLaneRebind({ ...rebound, plan_digest: `sha256:${"e".repeat(64)}` } as BatchLaneRunStateRecord, f.planDigest)).toBe(false);
		} finally { f.cleanup(); }
	});
});

describe("Claude run continuation: drifted cwd", () => {
	test("a drifted cwd records no correlation and never reports a missing batch receipt", async () => {
		const p = laneParent(); try {
			await p.open();
			const laneCwd = realpathSync(p.root).replace(/$/, "") + `/.git/imm/worktrees/${LANE_TASK}/${LANE_TASK}`;
			mkdirSync(laneCwd, { recursive: true });
			for (const operation of ["start_unattended_batch", "status"]) {
				const id = `drift-${operation}`;
				const event = { tool_name: `mcp__plugin_immune-brain_immune-brain__${operation}`, tool_use_id: id, tool_input: {} };
				expect(await p.hook({ hook_event_name: "PreToolUse", ...event, cwd: laneCwd })).toBeNull();
				expect(readRunToolSession(id, operation, laneCwd, p.root)).toBeNull();
				const result = await p.hook({ hook_event_name: "PostToolUse", ...event, cwd: laneCwd,
					tool_response: { state: "started", batch_id: LANE_BATCH } });
				expect(result).toBeNull();
			}
			// Back at the coordinator root the same session correlates and binds normally.
			expect(await p.hook({ hook_event_name: "PreToolUse", ...p.tool("start_unattended_batch", "lane-home") })).toBeNull();
			expect(readRunToolSession("lane-home", "start_unattended_batch", p.root, p.root)).toBe("lane-session");
			expect(await p.hook({ hook_event_name: "PostToolUse", ...p.tool("start_unattended_batch", "lane-home"),
				tool_response: { state: "started", batch_id: LANE_BATCH } })).toBeNull();
			expect(JSON.parse((await p.stop())!).decision).toBe("block");
			// A Stop from the drifted cwd still releases the run for a changed workspace.
			expect(JSON.parse((await p.stop(laneCwd))!).systemMessage).toContain("workspace changed");
		} finally { p.dispose(); }
	});
});
