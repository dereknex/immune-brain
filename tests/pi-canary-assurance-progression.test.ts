import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	buildReviewPrompt,
	deriveGithubTerminalProjectionInput,
	parseAssuranceVerdict,
	type AssuranceProgressionPorts,
} from "../plugins/immune-brain/.pi-extension/pi-canary-assurance-progression.ts";
import {
	TASK,
	ctx,
	makeAssuranceHarness as makeHarness,
	passVerdict,
	projection,
	resultText,
	snapshot,
} from "./helpers/pi-canary-assurance-harness.ts";

describe("foreground assurance progression", () => {
	test("runs QA synchronously and returns one foreground Review reservation", async () => {
		let released!: () => void;
		const gate = new Promise<void>((resolve) => { released = resolve; });
		let qaFinished = false;
		const h = makeHarness({ runQa: async (s, _descriptors, _runner, options) => { options.onProgress?.({ index: 1, total: 1, acceptance_id: "A1", phase: "passed", elapsed_ms: 1 }); await gate; qaFinished = true; return passVerdict(s); } });
		const updates: unknown[] = [];
		const advancing = h.progression.advance(TASK, ctx, undefined, (update) => updates.push(update));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(qaFinished).toBe(false);
		released();
		const result = await advancing;
		expect(result.state).toBe("review_ready");
		expect((result as { agent_params: { run_in_background: boolean } }).agent_params.run_in_background).toBe(false);
		expect(updates.some((item) => JSON.stringify(item).includes("verifying"))).toBe(true);
		expect(h.counts().applyCount).toBe(1);
	});

	test("routine completes after deterministic QA without reserving Review", async () => {
		const h = makeHarness({ risk: "routine" });
		expect(await h.progression.advance(TASK, ctx)).toEqual({ state: "completed" });
		expect(h.progression.active(TASK)).toBeNull();
		expect(h.counts()).toEqual({ applyCount: 1, removeCount: 0, evidenceCount: 0 });
	});

	test("claimless done and stopped projections terminate before QA or claim checks", async () => {
		for (const [lifecycle, state] of [["done", "completed"], ["stopped", "stopped"]] as const) {
			const h = makeHarness({
				project: async () => ({ ...projection(lifecycle, "none"), claim: null }),
				runQa: async () => { throw new Error("terminal projection must not start QA"); },
			});
			expect(await h.progression.advance(TASK, ctx)).toEqual({ state });
			expect(h.counts().applyCount).toBe(0);
		}
	});

	test("host cancellation before authority settlement performs zero QA writes", async () => {
		let released!: () => void;
		const gate = new Promise<void>((resolve) => { released = resolve; });
		const controller = new AbortController();
		const h = makeHarness({ runQa: async () => { await gate; throw new DOMException("aborted", "AbortError"); } });
		const advancing = h.progression.advance(TASK, ctx, controller.signal);
		controller.abort();
		released();
		const result = await advancing;
		expect(result.state).toBe("cancelled");
		expect(h.counts().applyCount).toBe(0);
	});

	test("cancellation after invocation commit cannot abandon QA settlement", async () => {
		const controller = new AbortController();
		let settled = false;
		const h = makeHarness({ applyVerdict: async (_ctx, input) => {
			await input.hooks?.beforeCommit?.();
			input.hooks?.onCommit?.();
			controller.abort();
			await Promise.resolve();
			settled = true;
			await input.hooks?.afterCommit?.();
		} });
		const result = await h.progression.advance(TASK, ctx, controller.signal);
		expect(result.state).toBe("settlement_unknown");
		expect(settled).toBe(true);
	});

	test("synchronous working-to-review cancellation remains a known zero-write outcome", async () => {
		const controller = new AbortController();
		const h = makeHarness({
			phase: "working",
			applyOrdinaryOperation: (() => {
				controller.abort();
				throw new Error("cancelled before mutation started");
			}) as AssuranceProgressionPorts["applyOrdinaryOperation"],
		});
		const result = await h.progression.advance(TASK, ctx, controller.signal);
		expect(result.state).toBe("cancelled");
		expect(h.counts().applyCount).toBe(0);
	});

	test("projection failure after artifact freeze remains settlement-unknown", async () => {
		let projectReads = 0;
		const h = makeHarness({
			phase: "working",
			project: async () => {
				projectReads += 1;
				if (projectReads === 1) return projection("active", "submit_assurance", "material", "active");
				throw new Error("projection unavailable after artifact freeze");
			},
		});
		const result = await h.progression.advance(TASK, ctx);
		expect(result).toMatchObject({ state: "settlement_unknown", operation: "qa" });
		expect((result as { reason: string }).reason).toContain("projection unavailable after artifact freeze");
	});

	test("cancellation between QA settlement and Review preparation is retryable", async () => {
		const controller = new AbortController();
		let projectReads = 0;
		const h = makeHarness({
			project: async () => {
				projectReads += 1;
				if (projectReads === 2) {
					controller.abort();
					throw new Error("Review projection cancelled after QA settlement");
				}
				return projection("active", projectReads === 1 ? "run_qa" : "run_review");
			},
		});
		const result = await h.progression.advance(TASK, ctx, controller.signal);
		expect(result).toMatchObject({ state: "review_preparation_failed", operation: "review" });
		expect(h.counts().applyCount).toBe(1);
		expect((await h.ports.projectTask(ctx.cwd, TASK)).projection.next_obligation).toBe("run_review");
	});

	test("cancellation after QA authority commit reconciles run_review and remains retryable", async () => {
		const controller = new AbortController();
		let projectReads = 0;
		const h = makeHarness({
			project: async () => projection("active", projectReads++ === 0 ? "run_qa" : "run_review"),
			applyVerdict: async (_ctx, input) => {
				await input.hooks?.beforeCommit?.();
				input.hooks?.onCommit?.();
				controller.abort();
				await input.hooks?.afterCommit?.();
			},
		});
		const result = await h.progression.advance(TASK, ctx, controller.signal);
		expect(result).toMatchObject({ state: "review_preparation_failed", operation: "review" });
		expect(h.counts().evidenceCount).toBe(0);
		expect((await h.ports.projectTask(ctx.cwd, TASK)).projection.next_obligation).toBe("run_review");
	});

	test("submit_review preserves ambiguity until the Kernel can be read", async () => {
		const controller = new AbortController();
		const h = makeHarness({ applyVerdict: async (_ctx, input) => {
			await input.hooks?.beforeCommit?.();
			input.hooks?.onCommit?.();
			controller.abort();
			await input.hooks?.afterCommit?.();
		} });
		const advanced = await h.progression.advance(TASK, ctx, controller.signal);
		expect(advanced.state).toBe("settlement_unknown");
		h.ports.projectTask = async () => ({ ...projection(), error: "authority unavailable" });
		expect(await h.progression.advance(TASK, ctx)).toMatchObject({ state: "blocked", reason: "authority unavailable" });
		expect(await h.progression.submitReview(TASK, ctx, {})).toEqual({
			state: "settlement_unknown",
			operation: "qa",
			operation_id: (advanced as { operation_id: string }).operation_id,
			reason: (advanced as { reason: string }).reason,
		});
	});

	test("QA rework applies exactly once and does not reserve Review", async () => {
		const h = makeHarness({ runQa: async (s) => ({ ...passVerdict(s), decision: "rework", approval: undefined, findings: [{ id: "qa-finding", kind: "blocking", acceptance_id: "A1", summary: "repair", findings_digest: "" }] }) });
		const result = await h.progression.advance(TASK, ctx);
		expect(result.state).toBe("rework");
		expect(h.progression.active(TASK)).toBeNull();
		expect(h.counts().applyCount).toBe(1);
	});

	test("v4 revision preparation blocks before QA and leaves authority untouched", async () => {
		const h = makeHarness();
		let attempts = 0;
		h.ports.readTaskRecord = async () => ({ record: { contract: "assurance_kernel/task_record/v4", git_base_head: "a".repeat(40), findings: [] } } as never);
		h.ports.ensureReviewRevision = async () => {
			attempts += 1;
			throw new Error("synthetic revision unavailable");
		};
		const result = await h.progression.advance(TASK, ctx);
		expect(result).toMatchObject({ state: "blocked", reason: expect.stringContaining("revision preparation failed") });
		expect(attempts).toBe(1);
		expect(h.counts().applyCount).toBe(0);
	});

	test("post-QA Review preparation is retryable and preserves run_review", async () => {
		const h = makeHarness();
		const originalBuild = h.ports.buildAssurance;
		h.ports.buildAssurance = async (root, taskId, role, current, runner) => {
			if (role === "review") throw new Error("manifest unavailable");
			return originalBuild(root, taskId, role, current, runner);
		};
		const result = await h.progression.advance(TASK, ctx);
		expect(result).toMatchObject({ state: "review_preparation_failed", operation: "review", reason: "manifest unavailable" });
		expect(h.counts().applyCount).toBe(1);
		expect((await h.ports.projectTask(ctx.cwd, TASK)).projection.next_obligation).toBe("run_review");
	});

	test("already-settled Review frozenRunner failure is retryable and preserves run_review", async () => {
		const h = makeHarness({ project: async () => projection("active", "run_review") });
		h.ports.frozenRunner = async () => { throw new Error("runner unavailable"); };
		const result = await h.progression.advance(TASK, ctx);
		expect(result).toMatchObject({ state: "review_preparation_failed", operation: "review" });
		expect(h.counts().applyCount).toBe(0);
		expect((await h.ports.projectTask(ctx.cwd, TASK)).projection.next_obligation).toBe("run_review");
	});

	test("already-settled Review cancellation before reservation is retryable", async () => {
		const controller = new AbortController();
		const h = makeHarness({ project: async () => projection("active", "run_review") });
		h.ports.frozenRunner = async () => {
			controller.abort();
			return { id: "bun", version: "1.3.14" } as never;
		};
		const result = await h.progression.advance(TASK, ctx, controller.signal);
		expect(result).toMatchObject({ state: "review_preparation_failed", operation: "review" });
		expect(h.counts().applyCount).toBe(0);
		expect((await h.ports.projectTask(ctx.cwd, TASK)).projection.next_obligation).toBe("run_review");
	});

	test("already-settled Review returned projection error is retryable", async () => {
		let reads = 0;
		const h = makeHarness({
			project: async () => {
				reads += 1;
				if (reads === 1) return projection("active", "run_review");
				return { ...projection("active", "run_review"), error: "projection unavailable" };
			},
		});
		const result = await h.progression.advance(TASK, ctx);
		expect(result).toMatchObject({ state: "review_preparation_failed", operation: "review" });
		expect(result.state).not.toBe("settlement_unknown");
		expect(h.counts().applyCount).toBe(0);
	});
	test("post-Review projection failure is settlement-unknown after authority commit", async () => {
		const h = makeHarness();
		const originalProject = h.ports.projectTask;
		let failAfterCommit = false;
		let postReadyReads = 0;
		h.ports.projectTask = async (root, taskId) => {
			if (failAfterCommit) {
				postReadyReads += 1;
				if (postReadyReads > 1) throw new Error("projection unavailable after Review settlement");
			}
			return originalProject(root, taskId);
		};
		const ready = await h.progression.advance(TASK, ctx);
		expect(ready.state).toBe("review_ready");
		failAfterCommit = true;
		expect(await h.progression.submitReview(TASK, ctx, passVerdict(snapshot("review")))).toMatchObject({
			state: "settlement_unknown",
			operation: "review",
			reason: "projection unavailable after Review settlement",
		});
		expect(h.counts().applyCount).toBe(2);
	});
	test("cancelling Review reservation construction removes its evidence", async () => {
		// Covered in tests/pi-canary-work-extension.test.ts against the real
		// extension surface; this in-process harness shares the static invocation
		// registry across tests and cannot reset it without weakening isolation.
	});

	test("accepts one Parent-submitted verdict and settles material Review without user authorization", async () => {
		const h = makeHarness();
		const ready = await h.progression.advance(TASK, ctx);
		expect(ready.state).toBe("review_ready");
		const submitted = await h.progression.submitReview(TASK, ctx, passVerdict(snapshot("review")));
		expect(submitted).toEqual({ state: "completed" });
		expect(h.counts().applyCount).toBe(2);
		const duplicate = await h.progression.submitReview(TASK, ctx, passVerdict(snapshot("review")));
		expect(duplicate).toMatchObject({ state: "blocked" });
	});

	test("critical Review settles and completes without final user approval", async () => {
		const h = makeHarness({ risk: "critical" });
		const ready = await h.progression.advance(TASK, ctx);
		expect(ready.state).toBe("review_ready");
		expect(await h.progression.submitReview(TASK, ctx, passVerdict(snapshot("review")))).toEqual({ state: "completed" });
		expect(h.counts().applyCount).toBe(2);
	});

	test("malformed Parent verdict is retryable without a Review authority write", async () => {
		const h = makeHarness();
		expect((await h.progression.advance(TASK, ctx)).state).toBe("review_ready");
		const invalid = await h.progression.submitReview(TASK, ctx, { decision: "pass" });
		expect(invalid).toMatchObject({ state: "blocked", code: "verdict_invalid" });
		expect(h.counts().applyCount).toBe(1);
		expect(h.progression.active(TASK)?.state).toBe("review_ready");
		const repeatedAdvance = await h.progression.advance(TASK, ctx);
		expect(repeatedAdvance).toMatchObject({ state: "blocked", code: "verdict_invalid" });
		expect(repeatedAdvance).not.toHaveProperty("agent_params");
		expect(await h.progression.submitReview(TASK, ctx, passVerdict(snapshot("review")))).toEqual({ state: "completed" });
	});
	test("discards a stale Review reservation when Kernel no longer requires Review", async () => {
		let qaSettled = false;
		const h = makeHarness();
		h.ports.projectTask = async () => projection("active", qaSettled ? "run_review" : "run_qa");
		const applyVerdict = h.ports.applyVerdict;
		h.ports.applyVerdict = async (applyCtx, input) => {
			await applyVerdict(applyCtx, input);
			if (input.snapshot.role === "qa") qaSettled = true;
		};
		const first = await h.progression.advance(TASK, ctx);
		expect(first.state).toBe("review_ready");
		qaSettled = false;
		const second = await h.progression.advance(TASK, ctx);
		expect(second.state).toBe("review_ready");
		expect((second as { operation_id: string }).operation_id).not.toBe((first as { operation_id: string }).operation_id);
		expect(h.counts().applyCount).toBe(2);
	});

	test("session shutdown aborts in-flight QA and prevents authority writes", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		let qaSignal: AbortSignal | undefined;
		const h = makeHarness({ runQa: async (s, _descriptors, _runner, options) => {
			qaSignal = options.signal;
			await gate;
			return passVerdict(s);
		} });
		const advancing = h.progression.advance(TASK, ctx);
		await new Promise((resolve) => setTimeout(resolve, 0));
		await h.progression.onSessionShutdown();
		expect(qaSignal?.aborted).toBe(true);
		release();
		const result = await advancing;
		expect(result.state).toBe("cancelled");
		expect(h.counts().applyCount).toBe(0);
	});

	test("stale Review correlation and session shutdown discard the transient verdict", async () => {
		let stale = false;
		let projectionReads = 0;
		const h = makeHarness({ project: async () => {
			projectionReads += 1;
			return stale
				? { ...projection("review", "run_review"), projection: { ...projection("review", "run_review").projection, record_revision: "record-new" } } as never
				: projection("review", projectionReads === 1 ? "run_qa" : "run_review");
		} });
		expect((await h.progression.advance(TASK, ctx)).state).toBe("review_ready");
		stale = true;
		expect((await h.progression.submitReview(TASK, ctx, passVerdict(snapshot("review")))).state).toBe("blocked");
		expect(h.counts().removeCount).toBe(1);
		await h.progression.onSessionShutdown();
		expect(h.progression.active(TASK)).toBeNull();
	});
});

test("native Review reservations inject the internal Code Review role contract", () => {
	const prompt = buildReviewPrompt(snapshot("review"), "/tmp/evidence.json");
	expect(prompt).toContain("internal role: code-review");
	expect(prompt).toContain("imm-code-review");
	expect(prompt).toContain("do not discover or load Pi Skills");
});

test("native v4 Review prompt reads the synthetic Git revision", () => {
	const s = {
		...snapshot("review"),
		review_revision: {
			contract: "assurance_kernel/review_revision_identity/v1" as const,
			base_head: "a".repeat(40),
			review_commit: "b".repeat(40),
			review_tree: "c".repeat(40),
			manifest_digest: `sha256:${"d".repeat(64)}`,
		},
	};
	const prompt = buildReviewPrompt(s, "/tmp/evidence.json");
	expect(prompt).toContain("assurance_kernel/review_manifest/v5");
	expect(prompt).toContain("git diff");
	expect(prompt).toContain("immutable Git objects");
	expect(prompt).not.toContain("neighborhood_files");
	expect(prompt).not.toContain("current_content");
});
test("projects GitHub terminal state only from an exact claimless tombstone", () => {
	const settled = projection("done");
	settled.claim = null;
	const tombstone = {
		contract: "assurance_kernel/task_tombstone/v2",
		task_id: TASK,
		lifecycle_status: "terminal",
		terminal_lifecycle: "done",
		terminal_event_id: "complete:phase3-task:2099-01-01T02:00:00.000Z",
	} as never;
	expect(deriveGithubTerminalProjectionInput(TASK, settled, tombstone)).toEqual({
		task_id: TASK,
		phase: "done",
		terminal_event_id: "complete:phase3-task:2099-01-01T02:00:00.000Z",
	});
	expect(deriveGithubTerminalProjectionInput(TASK, { ...settled, claim: { task_id: TASK } } as never, tombstone)).toBeNull();
	expect(deriveGithubTerminalProjectionInput(TASK, settled, { ...tombstone, terminal_lifecycle: "stopped" })).toBeNull();
	expect(deriveGithubTerminalProjectionInput(TASK, projection("active"), tombstone)).toBeNull();
});

test("host hooks never project active state and publish terminal projection only from fresh claimless evidence", () => {
	const root = resolve(import.meta.dir, "..");
	const enrollment = readFileSync(resolve(root, "plugins/immune-brain/.pi-extension/imm-canary-enroll.ts"), "utf8");
	const work = readFileSync(resolve(root, "plugins/immune-brain/.pi-extension/imm-canary-work.ts"), "utf8");
	const stub = readFileSync(resolve(root, "plugins/immune-brain/.pi-extension/runtime-stub.ts"), "utf8");
	// Durable absence guards: the retired mark-active projection is fully deleted.
	expect(enrollment).not.toContain("markGithubTaskActive");
	expect(enrollment).not.toContain("github_issue_tracker");
	expect(stub).not.toContain("markGithubTaskActive");
	expect(stub).not.toContain("mark-active");
	// Terminal projection stays gated behind fresh Assurance plus exact tombstone reads.
	const enrichment = work.indexOf("async function enrichAssuranceResult");
	const freshProjection = work.indexOf("await projectAssuranceState", enrichment);
	const tombstoneRead = work.indexOf("await readTaskTombstone", freshProjection);
	const terminalProjection = work.indexOf("await markGithubTaskTerminal", tombstoneRead);
	expect(enrichment).toBeGreaterThan(-1);
	expect(freshProjection).toBeGreaterThan(enrichment);
	expect(tombstoneRead).toBeGreaterThan(freshProjection);
	expect(terminalProjection).toBeGreaterThan(tombstoneRead);
});

test("parseAssuranceVerdict rejects a verdict bound to another snapshot", () => {
	const s = snapshot("review");
	expect(() => parseAssuranceVerdict(resultText({ ...s, diff_hash: "sha256:other" }), s)).toThrow(/snapshot digest/i);
});

test("parseAssuranceVerdict rejects unknown approval fields", () => {
	const s = snapshot("review");
	const pass = JSON.parse(resultText(s)) as { approval: Record<string, unknown> };
	pass.approval.extra = "nope";
	expect(() => parseAssuranceVerdict(JSON.stringify(pass), s)).toThrow(/unknown field/i);
});
