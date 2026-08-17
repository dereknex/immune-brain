// Assurance progression ownership: the session-scoped module owns QA/Review
// jobs, reservations, timers, cancellation, shutdown, host-event observation,
// continuation, and single-winner terminal settlement behind a narrow ports
// interface. The adapter must not re-implement any of this lifecycle.

import { describe, expect, test } from "bun:test";

import {
	AssuranceProgression,
	classifyReviewWorkload,
	deriveQaJobTimeoutMs,
	snapshotDigest,
	type AssuranceProgressionPorts,
	type AssuranceVerdict,
	type SnapshotDescriptor,
} from "../plugins/immune-brain/.pi-extension/pi-canary-assurance-progression";
import type {
	NativeReviewHandle,
	NativeReviewResult,
} from "../plugins/immune-brain/.pi-extension/pi-canary-native-review";

const TASK = (suffix: string) => `progression-task-${suffix}`;

function snapshot(overrides: Partial<SnapshotDescriptor> = {}): SnapshotDescriptor {
	return {
		contract: "assurance_kernel/assurance_snapshot/v1",
		task_id: "t",
		role: "qa",
		record_revision: "sha256:" + "a".repeat(64),
		workspace_revision: "sha256:" + "b".repeat(64),
		intent_revision: 1,
		intent_content_hash: "sha256:" + "c".repeat(64),
		diff_hash: "sha256:" + "d".repeat(64),
		phase: "working",
		risk: "material",
		fresh_acceptance_ids: [],
		missing_acceptance_ids: [],
		stale_evidence_ids: [],
		acceptance: [],
		dirty_files: [],
		review_bundle_digest: null,
		root: "/tmp",
		...overrides,
	};
}

function passVerdict(role: "qa" | "review"): AssuranceVerdict {
	return {
		contract: "assurance_kernel/assurance_verdict/v2",
		role,
		task_id: "t",
		snapshot_digest: "sha256:" + "e".repeat(64),
		decision: "pass",
		approval: { kind: role, authority_role: role === "qa" ? "qa" : "reviewer", summary: "ok" },
	};
}

interface Harness {
	progression: AssuranceProgression;
	state: {
		phase: string;
		missing: string[];
		approvalKinds: string[];
		findings: Array<{ kind: string; status: string }>;
		risk: string;
	};
	ctx: {
		mode: string;
		cwd: string;
		signal: AbortSignal;
		ui: {
			notify: (text: string, kind: string) => void;
			setStatus: () => void;
			setWidget: () => void;
			confirm: () => Promise<boolean>;
		};
	};
	calls: {
		publish: Array<Record<string, unknown>>;
		followUps: Array<Record<string, unknown>>;
		notifies: Array<{ text: string; kind: string }>;
		applyVerdicts: Array<{ taskId: string; verdict: AssuranceVerdict; actorId: string }>;
		ordinaryOps: Array<{ taskId: string; operation: { op: string } }>;
		dispatchParams: Array<Record<string, unknown>>;
	};
	control: {
		runQaGate: Promise<void> | null;
		releaseRunQa: (() => void) | null;
		runQaCount: number;
		reviewHandle: {
			agentId: string;
			result: Promise<{ result: string; agentId: string }>;
			stop: () => Promise<void>;
		} | null;
		releaseReviewResult: ((value: { result: string; agentId: string }) => void) | null;
		rejectReviewResult: ((error: Error) => void) | null;
		releaseLocalReviewResult: ((value: { result: string; agentId: string }) => void) | null;
		rejectLocalReviewResult: ((error: Error) => void) | null;
		lastSnapshot: SnapshotDescriptor | null;
		removedCount: number;
		stopCount: number;
	};
}

function makeHarness(overrides: {
	phase?: string;
	missing?: string[];
	approvalKinds?: string[];
	risk?: string;
	startReviewInjected?: boolean;
	startReviewError?: Error;
	reviewJobTimeoutMs?: number;
	reviewSoftDeadlineMs?: number;
	reviewSpawnTimeoutMs?: number;
	qaJobTimeoutMs?: number;
	qaDescriptorTimeouts?: number[];
	qaProgress?: Array<{
		index: number;
		total: number;
		acceptance_id: string;
		phase: "running" | "passed" | "failed";
		elapsed_ms: number;
	}>;
	reviewEvidenceRemoveError?: Error;
	reviewPreparationGate?: Promise<void>;
	buildAssuranceError?: Error;
} = {}): Harness {
	const state = {
		phase: overrides.phase ?? "working",
		missing: overrides.missing ?? [],
		approvalKinds: overrides.approvalKinds ?? [],
		findings: [] as Array<{ kind: string; status: string }>,
		risk: overrides.risk ?? "material",
	};
	const calls: Harness["calls"] = {
		publish: [], followUps: [], notifies: [], applyVerdicts: [], ordinaryOps: [], dispatchParams: [],
	};
	const control: Harness["control"] = {
		runQaGate: null, releaseRunQa: null, runQaCount: 0, reviewHandle: null,
		releaseReviewResult: null, rejectReviewResult: null,
		releaseLocalReviewResult: null, rejectLocalReviewResult: null,
		lastSnapshot: null, removedCount: 0, stopCount: 0,
	};
	let reviewResultResolve: ((value: { result: string; agentId: string }) => void) | null = null;
	let reviewResultReject: ((error: Error) => void) | null = null;
	let progression: AssuranceProgression;

	const ports: AssuranceProgressionPorts = {
		publish: (_ctx, view) => calls.publish.push(view as Record<string, unknown>),
		deliverFollowUp: (followUp) => calls.followUps.push(followUp as Record<string, unknown>),
		notify: (_ctx, text, kind) => calls.notifies.push({ text, kind }),
		projectTask: async (_root, taskId) => ({
			contract: "assurance_kernel/assurance_projection/v1",
			task_id: taskId,
			error: null,
			claim: { task_id: taskId, lifecycle_status: "active" },
			projection: {
				record_revision: "sha256:" + "a".repeat(64),
				workspace_revision: "sha256:" + "b".repeat(64),
				intent_revision: 1,
				intent_content_hash: "sha256:" + "c".repeat(64),
				diff_hash: "sha256:" + "d".repeat(64),
				phase: state.phase,
				fresh_acceptance_ids: [],
				missing_acceptance_ids: state.missing,
				stale_evidence_ids: [],
				fresh_approval_kinds: state.approvalKinds,
				missing_approval_kinds: [],
				blocking_finding_ids: [],
				unresolved_user_decision_ids: [],
				replan_required_ids: [],
				independence_violations: [],
				open_user_decision_count: state.findings.filter(
					(f) => f.kind === "unresolved_user_decision" && f.status === "open",
				).length,
				completion_ready: false,
				authorization: { state: "none", blocked: null },
			},
		}),
		readTaskRecordV2: async () => ({
			revision: "sha256:" + "a".repeat(64),
			record: {
				contract: "assurance_kernel/task_record/v2",
				task_id: "t",
				intent_revision: 1,
				intent_snapshot: {
					task_id: "t", revision: 1,
					risk: state.risk as "routine" | "material" | "critical",
					acceptance: (overrides.qaDescriptorTimeouts ?? []).map((timeoutMs, index) => ({
						id: `A${index + 1}`,
						assertion: `acceptance ${index + 1}`,
						verification: JSON.stringify({
							contract: "assurance_kernel/verification_descriptor/v1",
							runner_id: "bun",
							runner_version: "1.3.14",
							argv: ["test"],
							cwd: ".",
							timeout_ms: timeoutMs,
							max_output_bytes: 1024,
						}),
					})),
					scope_hint: [],
				},
				intent_ref: { path: "docs/plans/t.intent.json", revision: 1, content_hash: "sha256:" + "c".repeat(64) },
				phase: state.phase,
				evidence: [],
				findings: state.findings,
				approvals: [],
			},
		}),
		readTaskIntent: async () => ({
			token: {},
			intent: {
				task_id: "t", revision: 1,
				risk: state.risk as "routine" | "material" | "critical",
				acceptance: [], scope_hint: [],
			},
		}),
		frozenRunner: async () => {
			if (overrides.reviewPreparationGate) await overrides.reviewPreparationGate;
			return { bun: "1.3.14" } as never;
		},
		buildAssurance: async (_root, taskId, role) => {
			if (overrides.buildAssuranceError) throw overrides.buildAssuranceError;
			const acceptance = (overrides.qaDescriptorTimeouts ?? []).map((timeoutMs, index) => ({
				id: `A${index + 1}`,
				assertion: `acceptance ${index + 1}`,
				verification: "fixture",
			}));
			const descriptors = new Map(acceptance.map((item, index) => [item.id, {
				contract: "assurance_kernel/verification_descriptor/v1" as const,
				runner_id: "bun" as const,
				runner_version: "1.3.14",
				argv: ["test"],
				cwd: ".",
				timeout_ms: overrides.qaDescriptorTimeouts![index],
				max_output_bytes: 1024,
			}]));
			const built = snapshot({
				task_id: taskId,
				role,
				phase: state.phase,
				risk: state.risk as "routine" | "material" | "critical",
				acceptance,
			});
			control.lastSnapshot = built;
			return {
				snapshot: built,
				descriptors,
				reviewBundle: role === "review" ? { diff_hash: "sha256:" + "d".repeat(64) } : null,
			};
		},
		runQa: async (_snapshot, _descriptors, _runner, options) => {
			control.runQaCount += 1;
			if (control.runQaGate) await control.runQaGate;
			for (const progress of overrides.qaProgress ?? [
				{ index: 1, total: 1, acceptance_id: "A1", phase: "passed" as const, elapsed_ms: 5 },
			]) options.onProgress?.(progress);
			return passVerdict("qa");
		},
		writeReviewEvidence: () => ({
			path: "/tmp/evidence.json",
			remove: () => {
				control.removedCount += 1;
				if (overrides.reviewEvidenceRemoveError) throw overrides.reviewEvidenceRemoveError;
			},
		}),
		startReview: overrides.startReviewInjected
			? async () => {
					if (overrides.startReviewError) throw overrides.startReviewError;
					const result = new Promise<{ result: string; agentId: string }>((resolve, reject) => {
						reviewResultResolve = resolve;
						reviewResultReject = reject;
					});
					control.reviewHandle = {
						agentId: "native-agent",
						result,
						stop: async () => { control.stopCount += 1; },
					};
					control.releaseLocalReviewResult = (value) => reviewResultResolve?.(value);
					control.rejectLocalReviewResult = (error) => reviewResultReject?.(error);
					control.releaseReviewResult = (value) => progression.observeToolEnd({
						toolName: "get_subagent_result",
						toolCallId: `host-result-${Date.now()}`,
						args: { agent_id: value.agentId },
						isError: false,
						result: {
							content: [{ type: "text", text: `Agent: ${value.agentId}\nStatus: completed\n${value.result}` }],
						},
					} as never);
					control.rejectReviewResult = (error) => progression.observeToolEnd({
						toolName: "get_subagent_result",
						toolCallId: `host-result-${Date.now()}`,
						args: { agent_id: "native-agent" },
						isError: false,
						result: {
							content: [{ type: "text", text: `Agent: native-agent\nStatus: failed\n${error.message}` }],
						},
					} as never);
					return control.reviewHandle;
				}
			: undefined,
		dispatchReviewFollowUp: (input) => {
			calls.dispatchParams.push(input.params as unknown as Record<string, unknown>);
		},
		applyVerdict: async (_ctx, input) => {
			calls.applyVerdicts.push({ taskId: input.taskId, verdict: input.verdict, actorId: input.actorId });
		},
		applyOrdinaryOperation: async (_ctx, input) => {
			calls.ordinaryOps.push({ taskId: input.taskId, operation: input.operation });
			if (input.operation.op === "submit_review") state.phase = "review";
			return { revision: "r", record: { phase: state.phase } };
		},
		reviewJobTimeoutMs: overrides.reviewJobTimeoutMs,
		reviewSoftDeadlineMs: overrides.reviewSoftDeadlineMs,
		reviewSpawnTimeoutMs: overrides.reviewSpawnTimeoutMs,
		qaJobTimeoutMs: overrides.qaJobTimeoutMs,
	};

	progression = new AssuranceProgression(ports);
	return {
		progression,
		state,
		ctx: {
			mode: "tui",
			cwd: "/tmp",
			signal: new AbortController().signal,
			ui: {
				notify: (text, kind) => calls.notifies.push({ text, kind }),
				setStatus: () => {},
				setWidget: () => {},
				confirm: async () => true,
			},
		},
		calls,
		control,
	};
}

const waitFor = async (predicate: () => boolean, timeoutMs = 3000): Promise<void> => {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
};

function reviewVerdictText(taskId: string, digest: string, decision: "pass" | "rework"): string {
	if (decision === "pass") {
		return JSON.stringify({
			contract: "assurance_kernel/assurance_verdict/v2",
			role: "review",
			task_id: taskId,
			snapshot_digest: digest,
			decision: "pass",
			approval: { kind: "review", authority_role: "reviewer", summary: "ok" },
		});
	}
	return JSON.stringify({
		contract: "assurance_kernel/assurance_verdict/v2",
		role: "review",
		task_id: taskId,
		snapshot_digest: digest,
		decision: "rework",
		findings: [{ id: "r1", kind: "blocking", acceptance_id: "A1", summary: "s" }],
	});
}

describe("pi assurance progression", () => {
	test("classifies Review work only from frozen risk and immutable bundle size", () => {
		const bundle = (bytes: number, files: number) => ({
			contract: "assurance_kernel/review_bundle/v4" as const,
			root: "/tmp",
			head: "a".repeat(40),
			scope: [],
			diff_hash: "sha256:" + "d".repeat(64),
			dirty_files: Object.fromEntries(Array.from({ length: files }, (_, index) => [
				`f${index}.ts`,
				{ mode: "100644", oid: null, fingerprint: `f${index}`, current_content: "x".repeat(bytes) },
			])),
			outcomes: {},
			bundle_digest: "sha256:" + "e".repeat(64),
		});
		expect(classifyReviewWorkload(snapshot({ role: "review", risk: "routine" }), bundle(100, 2))).toBe("quick");
		expect(classifyReviewWorkload(snapshot({ role: "review", risk: "material" }), bundle(100, 2))).toBe("standard");
		expect(classifyReviewWorkload(snapshot({ role: "review", risk: "critical" }), bundle(100, 2))).toBe("heavy");
		expect(classifyReviewWorkload(snapshot({ role: "review", risk: "routine" }), bundle(600_000, 1))).toBe("heavy");
	});

	test("derives QA aggregate budget from sequential descriptors with fixed bounds", () => {
		const descriptor = (timeoutMs: number) => ({ timeout_ms: timeoutMs });
		expect(deriveQaJobTimeoutMs([])).toBe(15 * 60 * 1000);
		expect(deriveQaJobTimeoutMs([descriptor(600_000)])).toBe(15 * 60 * 1000);
		expect(deriveQaJobTimeoutMs([descriptor(600_000), descriptor(600_000)])).toBe(22 * 60 * 1000);
		expect(() => deriveQaJobTimeoutMs(Array.from({ length: 6 }, () => descriptor(600_000)))).toThrow(
			/declared QA budget.*60 minutes/i,
		);
	});

	test("projects the derived QA aggregate after immutable descriptor capture", async () => {
		const h = makeHarness({
			qaDescriptorTimeouts: [600_000, 600_000],
		});
		let releaseQa!: () => void;
		h.control.runQaGate = new Promise<void>((resolve) => { releaseQa = resolve; });
		const started = await h.progression.startQa(TASK("qa-derived-projection"), h.ctx);
		expect(started).toMatchObject({ state: "started", deadline_seconds: 22 * 60 });
		await waitFor(() => h.control.runQaCount === 1);
		expect(h.progression.active(TASK("qa-derived-projection"))).toMatchObject({
			state: "started",
			operation: "qa",
			deadline_seconds: 22 * 60,
		});
		expect(h.calls.publish.at(-1)?.deadline_seconds).toBe(22 * 60);
		await h.progression.cancel(TASK("qa-derived-projection"), h.ctx);
		releaseQa();
	});

	test("publishes bounded Host-native QA transitions with deterministic progress and budget", async () => {
		const h = makeHarness({
			qaDescriptorTimeouts: [600_000, 600_000],
			qaProgress: [
				{ index: 1, total: 2, acceptance_id: "A1", phase: "running", elapsed_ms: 0 },
				{ index: 1, total: 2, acceptance_id: "A1", phase: "running", elapsed_ms: 50 },
				{ index: 1, total: 2, acceptance_id: "A1", phase: "passed", elapsed_ms: 1_100 },
				{ index: 2, total: 2, acceptance_id: "A2", phase: "running", elapsed_ms: 0 },
				{ index: 2, total: 2, acceptance_id: "A2", phase: "passed", elapsed_ms: 2_100 },
			],
		});
		await h.progression.startQa(TASK("qa-visible-progress"), h.ctx);
		await waitFor(() => h.calls.notifies.some((notice) => /QA pass completed/i.test(notice.text)));
		const transitions = h.calls.notifies
			.filter((notice) => /^QA \d+\/\d+ \|/.test(notice.text))
			.map((notice) => notice.text);
		expect(transitions).toEqual([
			"QA 1/2 | A1 running | elapsed 0s | hard limit 22m",
			"QA 1/2 | A1 passed | elapsed 2s | hard limit 22m",
			"QA 2/2 | A2 running | elapsed 0s | hard limit 22m",
			"QA 2/2 | A2 passed | elapsed 3s | hard limit 22m",
		]);
		expect(transitions.some((text) => /%|ETA|remaining/i.test(text))).toBe(false);
	});

	test("rejects an impossible QA aggregate before snapshot capture or verification", async () => {
		const h = makeHarness({ qaDescriptorTimeouts: Array.from({ length: 6 }, () => 600_000) });
		const result = await h.progression.startQa(TASK("qa-budget"), h.ctx);
		expect(result.state).toBe("blocked");
		expect((result as { reason: string }).reason).toMatch(/declared QA budget.*60 minutes/i);
		expect(h.control.lastSnapshot).toBeNull();
		expect(h.control.runQaCount).toBe(0);
		expect(h.calls.followUps).toHaveLength(0);
		expect(h.calls.notifies.some((notice) => /declared QA budget.*60 minutes/i.test(notice.text))).toBe(true);
	});

	test("advance blocks on missing fresh evidence with the exact reason", async () => {
		const h = makeHarness({ missing: ["A1"] });
		const result = await h.progression.advance(TASK("missing"), h.ctx);
		expect(result.state).toBe("blocked");
		expect((result as { reason: string }).reason).toBe("fresh evidence is missing for: A1");
		expect(h.calls.ordinaryOps).toEqual([]);
	});

	test("advance completes for a done phase and blocks for stopped", async () => {
		const done = makeHarness({ phase: "done" });
		expect((await done.progression.advance(TASK("done"), done.ctx)).state).toBe("completed");
		const stopped = makeHarness({ phase: "stopped" });
		const result = await stopped.progression.advance(TASK("stopped"), stopped.ctx);
		expect(result.state).toBe("blocked");
		expect((result as { reason: string }).reason).toBe("task is stopped");
	});

	test("advance with fresh evidence submits review then starts QA in review phase", async () => {
		const h = makeHarness({ phase: "working", missing: [] });
		const result = await h.progression.advance(TASK("adv1"), h.ctx);
		expect(h.calls.ordinaryOps.map((op) => op.operation.op)).toContain("submit_review");
		expect(result.state).toBe("started");
		expect((result as { operation: string }).operation).toBe("qa");
	});

	test("advance starts review when qa is fresh and blocks replan findings", async () => {
		const h = makeHarness({ phase: "review", approvalKinds: ["qa"] });
		const result = await h.progression.advance(TASK("adv2"), h.ctx);
		expect(result.state).toBe("started");
		expect((result as { operation: string }).operation).toBe("review");
		const parked = makeHarness({ phase: "review", approvalKinds: ["qa", "review"] });
		parked.state.findings.push({ kind: "replan_required", status: "open" });
		const blocked = await parked.progression.advance(TASK("adv3"), parked.ctx);
		expect(blocked.state).toBe("blocked");
		expect((blocked as { reason: string }).reason).toBe("review rework limit reached; a durable replan is required");
	});

	test("advance waits for literal-user approval on critical tasks", async () => {
		const h = makeHarness({ phase: "review", approvalKinds: ["qa", "review"], risk: "critical" });
		const result = await h.progression.advance(TASK("adv4"), h.ctx);
		expect(result.state).toBe("awaiting_user");
		expect((result as { operation: string }).operation).toBe("record-user-approval");
	});

	test("QA cancellation before authority commit aborts and performs zero writes", async () => {
		const h = makeHarness();
		let releaseQa!: () => void;
		h.control.runQaGate = new Promise<void>((resolve) => { releaseQa = resolve; });
		await h.progression.startQa(TASK("qa1"), h.ctx);
		await waitFor(() => h.calls.notifies.some((n) => /deterministic QA started/i.test(n.text)));
		const cancelled = await h.progression.cancel(TASK("qa1"), h.ctx);
		expect(cancelled.state).toBe("cancelled");
		releaseQa();
		await waitFor(() => h.calls.notifies.some((n) => /cancellation requested/i.test(n.text)));
		expect(h.calls.applyVerdicts).toEqual([]);
	});

	test("advance reservations serialize concurrent advances", async () => {
		const h = makeHarness({ missing: [] });
		const first = h.progression.advance(TASK("ser"), h.ctx);
		const second = await h.progression.advance(TASK("ser"), h.ctx);
		expect(second.state).toBe("started");
		await first;
	});

	test("review result settles exactly once and publishes one terminal follow-up", async () => {
		const h = makeHarness({ startReviewInjected: true });
		const result = await h.progression.startReview(TASK("rev1"), h.ctx);
		expect(result.state).toBe("started");
		await waitFor(() => h.control.reviewHandle !== null);
		expect(h.calls.notifies.some((n) => /Pi native subagent native-agent/i.test(n.text))).toBe(true);
		const digest = snapshotDigest(h.control.lastSnapshot!);
		h.control.releaseReviewResult!({
			result: reviewVerdictText(TASK("rev1"), digest, "pass"),
			agentId: "native-agent",
		});
		await waitFor(() => h.progression.hasPendingReviewVerdict(TASK("rev1")));
		const pending = h.progression.pendingReviewVerdict(TASK("rev1"));
		expect(pending?.verdict.decision).toBe("pass");
		expect(h.calls.followUps.filter((f) => f.terminal === "verdict_ready").length).toBe(1);
		h.progression.clearPendingReviewVerdict(TASK("rev1"));
		expect(h.progression.hasPendingReviewVerdict(TASK("rev1"))).toBe(false);
	});

	test("injected local result cannot produce a verdict without a host terminal receipt", async () => {
		const h = makeHarness({ startReviewInjected: true });
		await h.progression.startReview(TASK("injected-local"), h.ctx);
		await waitFor(() => h.control.reviewHandle !== null);
		const digest = snapshotDigest(h.control.lastSnapshot!);
		h.control.releaseLocalReviewResult!({
			result: reviewVerdictText(TASK("injected-local"), digest, "pass"),
			agentId: "native-agent",
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(h.progression.hasPendingReviewVerdict(TASK("injected-local"))).toBe(false);
		expect(h.calls.followUps).toHaveLength(0);
		expect(h.control.removedCount).toBe(0);

		h.control.releaseReviewResult!({
			result: reviewVerdictText(TASK("injected-local"), digest, "pass"),
			agentId: "native-agent",
		});
		await waitFor(() => h.progression.hasPendingReviewVerdict(TASK("injected-local")));
		expect(h.calls.followUps.filter((f) => f.terminal === "verdict_ready")).toHaveLength(1);
	});

	test("pre-dispatch preparation failure emits no native terminal follow-up", async () => {
		const h = makeHarness({
			startReviewInjected: true,
			buildAssuranceError: new Error("snapshot capture failed"),
		});
		await h.progression.startReview(TASK("prep-failure"), h.ctx);
		await waitFor(() => h.calls.notifies.some((n) => /failed to start.*snapshot capture failed/i.test(n.text)));
		expect(h.calls.followUps).toHaveLength(0);
		expect(h.control.reviewHandle).toBeNull();
		expect(h.progression.active(TASK("prep-failure"))).toBeNull();
	});

	test("pre-dispatch cancellation emits no native terminal follow-up", async () => {
		let releasePreparation!: () => void;
		const preparationGate = new Promise<void>((resolve) => { releasePreparation = resolve; });
		const h = makeHarness({ startReviewInjected: true, reviewPreparationGate: preparationGate });
		await h.progression.startReview(TASK("prep-cancel"), h.ctx);
		await waitFor(() => h.calls.publish.some((view) => view.stage === "resolving frozen runner"));
		const cancelled = await h.progression.cancel(TASK("prep-cancel"), h.ctx);
		expect(cancelled.state).toBe("cancellation_requested");
		releasePreparation();
		await waitFor(() => h.progression.active(TASK("prep-cancel")) === null);
		expect(h.calls.followUps).toHaveLength(0);
		expect(h.control.reviewHandle).toBeNull();
		expect(h.control.removedCount).toBe(0);
	});

	test("dispatch failure without a handle retains evidence and emits no terminal follow-up", async () => {
		const h = makeHarness({ startReviewInjected: true, startReviewError: new Error("dispatch failed") });
		h.progression.startReview("task-1", h.ctx);
		await waitFor(() => h.progression.active("task-1")?.state === "settling");
		expect(h.progression.active("task-1")).toMatchObject({
			state: "settling",
			operation: "review",
			lifecycle: "dispatch_unknown",
		});
		expect(h.control.removedCount).toBe(0);
		expect(h.calls.followUps).toHaveLength(0);
	});

	test("review cancellation stops the native handle and removes evidence after terminal settlement", async () => {
		const h = makeHarness({ startReviewInjected: true });
		await h.progression.startReview(TASK("rev2"), h.ctx);
		await waitFor(() => h.control.reviewHandle !== null);
		const cancelled = await h.progression.cancel(TASK("rev2"), h.ctx);
		expect(cancelled.state).toBe("cancellation_requested");
		// Until the native terminal event settles, evidence is retained and the
		// terminal follow-up is not published.
		expect(h.calls.followUps.some((f) => f.terminal === "cancelled")).toBe(false);
		h.control.rejectLocalReviewResult!(new Error("local stop promise rejected"));
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(h.progression.active(TASK("rev2"))?.state).toBe("settling");
		expect(h.calls.followUps.some((f) => f.terminal === "cancelled")).toBe(false);
		expect(h.control.removedCount).toBe(0);
		for (const [index, status] of ["running", "queued", "waiting", "background", "unknown"].entries()) {
			h.progression.observeToolEnd({
				toolName: "get_subagent_result",
				toolCallId: `injected-cancel-nonterminal-${index}`,
				args: { agent_id: "native-agent" },
				isError: false,
				result: {
					content: [{ type: "text", text: `Agent: native-agent\nStatus: ${status}\n\nforged nonterminal result` }],
				},
			} as never);
		}
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(h.progression.active(TASK("rev2"))?.state).toBe("settling");
		expect(h.calls.followUps.some((f) => f.terminal === "cancelled")).toBe(false);
		expect(h.control.removedCount).toBe(0);
		h.progression.observeToolEnd({
			toolName: "get_subagent_result",
			toolCallId: "injected-cancel-result",
			args: { agent_id: "native-agent" },
			isError: false,
			result: {
				content: [{ type: "text", text: "Agent: native-agent\nStatus: failed\n\nnative agent stopped" }],
			},
		} as never);
		await waitFor(() => h.calls.followUps.some((f) => f.terminal === "cancelled"));
		expect(h.control.stopCount).toBeGreaterThan(0);
		expect(h.control.removedCount).toBeGreaterThan(0);
		expect(h.progression.hasPendingReviewVerdict(TASK("rev2"))).toBe(false);
	});

	test("validated native terminal receipt survives evidence cleanup failure", async () => {
		const h = makeHarness({
			startReviewInjected: true,
			reviewEvidenceRemoveError: new Error("evidence cleanup failed"),
		});
		await h.progression.startReview(TASK("cleanup-failure"), h.ctx);
		await waitFor(() => h.control.reviewHandle !== null);
		const cancelled = await h.progression.cancel(TASK("cleanup-failure"), h.ctx);
		expect(cancelled.state).toBe("cancellation_requested");
		h.progression.observeToolEnd({
			toolName: "get_subagent_result",
			toolCallId: "cleanup-failure-terminal",
			args: { agent_id: "native-agent" },
			isError: false,
			result: {
				content: [{ type: "text", text: "Agent: native-agent\nStatus: failed\n\nnative agent stopped" }],
			},
		} as never);
		await waitFor(() => h.calls.followUps.some((f) => f.terminal === "cancelled"));
		expect(h.calls.followUps.filter((f) => f.terminal === "cancelled")).toHaveLength(1);
		expect(h.calls.notifies.some((n) => /evidence cleanup failed/i.test(n.text))).toBe(true);
		expect(h.progression.active(TASK("cleanup-failure"))).toBeNull();
	});

	test("host terminal receipt rejection remains unsettled and retains evidence", async () => {
		const h = makeHarness({ startReviewInjected: true });
		let rejectReceipt!: (error: Error) => void;
		const hostTerminalReceipt = new Promise<never>((_resolve, reject) => {
			rejectReceipt = reject;
		});
		let removedCount = 0;
		const internal = h.progression as unknown as {
			stopReviewAndRemoveEvidence(job: Record<string, unknown>): Promise<{ settlement: string }>;
		};
		const settlement = internal.stopReviewAndRemoveEvidence({
			operationId: "receipt-rejected",
			handle: {
				agentId: "native-agent",
				result: new Promise(() => {}),
				stop: async () => {},
			},
			agentId: "native-agent",
			startedAt: Date.now(),
			stage: "cancellation requested",
			lastActivityAt: Date.now(),
			correlation: { record_revision: "r1", intent_content_hash: "i1", diff_hash: "d1" },
			heartbeat: setInterval(() => {}, 1_000_000),
			timeout: setTimeout(() => {}, 1_000_000),
			evidence: { path: "/tmp/evidence", remove: () => { removedCount += 1; } },
			hostTerminalReceipt,
		});
		rejectReceipt(new Error("host terminal receipt observer failed"));
		await expect(settlement).rejects.toThrow("host terminal receipt observer failed");
		expect(removedCount).toBe(0);
	});

	test("missing native handle retains settlement ownership", async () => {
		const h = makeHarness({ startReviewInjected: true });
		await h.progression.startReview(TASK("receipt-binding-failure"), h.ctx);
		await waitFor(() => h.control.reviewHandle !== null);
		const internal = h.progression as unknown as {
			reviewJobs: Map<string, { handle?: NativeReviewHandle }>;
		};
		const job = internal.reviewJobs.get(TASK("receipt-binding-failure"));
		expect(job).toBeDefined();
		job!.handle = undefined;
		const cancelled = await h.progression.cancel(TASK("receipt-binding-failure"), h.ctx);
		expect(cancelled.state).toBe("cancellation_requested");
		await waitFor(() => h.calls.notifies.some((n) => /remains unsettled/i.test(n.text)));
		expect(h.progression.active(TASK("receipt-binding-failure"))?.state).toBe("settling");
		expect(h.control.removedCount).toBe(0);
		expect(h.calls.followUps.some((f) => f.terminal === "cancelled")).toBe(false);
	});

	test("review soft deadline is nonterminal and a later matching verdict remains acceptable", async () => {
		const h = makeHarness({
			startReviewInjected: true,
			reviewSoftDeadlineMs: 20,
			reviewJobTimeoutMs: 500,
		});
		await h.progression.startReview(TASK("soft"), h.ctx);
		await waitFor(() => h.control.reviewHandle !== null);
		await waitFor(() => h.calls.notifies.some((notice) => /review is slow/i.test(notice.text)));
		expect(h.control.stopCount).toBe(0);
		expect(h.calls.followUps).toHaveLength(0);
		const digest = snapshotDigest(h.control.lastSnapshot!);
		h.control.releaseReviewResult!({
			result: reviewVerdictText(TASK("soft"), digest, "pass"),
			agentId: "native-agent",
		});
		await waitFor(() => h.progression.hasPendingReviewVerdict(TASK("soft")));
		expect(h.calls.followUps.filter((followUp) => followUp.terminal === "verdict_ready")).toHaveLength(1);
	});

	test("review stop threshold remains nonterminal until native settlement", async () => {
		const h = makeHarness({
			startReviewInjected: true,
			reviewSoftDeadlineMs: 10,
			reviewJobTimeoutMs: 40,
		});
		await h.progression.startReview(TASK("rev3"), h.ctx);
		await waitFor(() => h.control.reviewHandle !== null);
		await waitFor(() => h.control.stopCount > 0, 5000);
		expect(h.calls.followUps.some((followUp) => followUp.terminal === "timed_out")).toBe(false);
		expect(h.progression.active(TASK("rev3"))?.state).toBe("settling");
		h.control.rejectLocalReviewResult!(new Error("local stop promise rejected"));
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(h.progression.active(TASK("rev3"))?.state).toBe("settling");
		expect(h.calls.followUps.some((followUp) => followUp.terminal === "timed_out")).toBe(false);
		expect(h.control.removedCount).toBe(0);
		h.progression.observeToolEnd({
			toolName: "get_subagent_result",
			toolCallId: "injected-timeout-result",
			args: { agent_id: "native-agent" },
			isError: false,
			result: {
				content: [{ type: "text", text: "Agent: native-agent\nStatus: failed\n\nnative agent stopped" }],
			},
		} as never);
		await waitFor(() => h.calls.followUps.some((followUp) => followUp.terminal === "timed_out"));
		expect(h.calls.followUps.filter((followUp) => followUp.terminal === "timed_out")).toHaveLength(1);
		expect(h.progression.hasPendingReviewVerdict(TASK("rev3"))).toBe(false);
	});

	test("session shutdown cleans jobs, invocations, and evidence with a bounded wait", async () => {
		const h = makeHarness({ startReviewInjected: true, reviewJobTimeoutMs: 60_000 });
		h.progression.startReview(TASK("shut"), h.ctx);
		await waitFor(() => h.control.reviewHandle !== null);
		h.progression.openInvocation(TASK("shut"));
		expect(h.progression.isInvocationOpen(TASK("shut"))).toBe(true);
		const shutdown = h.progression.onSessionShutdown();
		// The bounded shutdown wait (10s) outlives the never-settling native
		// result and still releases all session ownership.
		const settled = await Promise.race([
			shutdown.then(() => true),
			new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 11_500)),
		]);
		expect(settled).toBe(true);
		expect(h.progression.active(TASK("shut"))).toBeNull();
		expect(h.progression.isInvocationOpen(TASK("shut"))).toBe(false);
		expect(h.progression.sessionActiveValue()).toBe(false);
	}, 15_000);

	test("host tool observation resolves standard Agent spawn and result", async () => {
		const h = makeHarness();
		await h.progression.startReview(TASK("obs"), h.ctx);
		await waitFor(() => h.calls.dispatchParams.length > 0);
		const params = h.calls.dispatchParams[0];
		const digest = snapshotDigest(h.control.lastSnapshot!);
		h.progression.observeToolStart({
			toolName: "Agent",
			args: params,
			toolCallId: "tc1",
		});
		h.progression.observeToolEnd({
			toolName: "Agent",
			toolCallId: "tc1",
			args: params,
			isError: false,
			result: { details: { agentId: "spawned-agent" } },
		} as never);
		// A native terminal event can arrive before the spawn promise continuation.
		h.progression.observeToolEnd({
			toolName: "get_subagent_result",
			toolCallId: "tc2",
			args: {},
			isError: false,
			result: {
				content: [{
					type: "text",
					text: `Agent: spawned-agent\nStatus: completed\n${reviewVerdictText(TASK("obs"), digest, "pass")}`,
				}],
			},
		} as never);
		await waitFor(() => h.calls.notifies.some((n) => /Pi native subagent spawned-agent/i.test(n.text)));
		await waitFor(() => h.progression.hasPendingReviewVerdict(TASK("obs")));
		expect(h.progression.pendingReviewVerdict(TASK("obs"))?.verdict.decision).toBe("pass");
	});

	test("standard Agent cancellation waits for a matching native terminal event", async () => {
		const h = makeHarness();
		await h.progression.startReview(TASK("std-cancel"), h.ctx);
		await waitFor(() => h.calls.dispatchParams.length > 0);
		const params = h.calls.dispatchParams[0];
		h.progression.observeToolStart({ toolName: "Agent", args: params, toolCallId: "cancel-spawn" });
		h.progression.observeToolEnd({
			toolName: "Agent",
			toolCallId: "cancel-spawn",
			args: params,
			isError: false,
			result: { details: { agentId: "cancel-agent" } },
		} as never);
		await waitFor(() => h.calls.notifies.some((n) => /Pi native subagent cancel-agent/i.test(n.text)));

		const cancelled = await h.progression.cancel(TASK("std-cancel"), h.ctx);
		expect(cancelled.state).toBe("cancellation_requested");
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(h.progression.active(TASK("std-cancel"))?.state).toBe("settling");
		expect(h.calls.followUps.some((f) => f.terminal === "cancelled")).toBe(false);
		expect(h.control.removedCount).toBe(0);

		h.progression.observeToolEnd({
			toolName: "get_subagent_result",
			toolCallId: "cancel-result",
			args: { agent_id: "cancel-agent" },
			isError: false,
			result: {
				content: [{
					type: "text",
					text: "Agent: cancel-agent\nStatus: failed\n\nnative agent stopped",
				}],
			},
		} as never);
		await waitFor(() => h.calls.followUps.some((f) => f.terminal === "cancelled"));
		expect(h.control.removedCount).toBe(1);
		expect(h.calls.applyVerdicts).toHaveLength(0);
		expect(h.progression.hasPendingReviewVerdict(TASK("std-cancel"))).toBe(false);
		expect(h.progression.active(TASK("std-cancel"))).toBeNull();
	});

	test("standard Agent local result cannot settle cancellation without a host terminal receipt", async () => {
		const h = makeHarness();
		await h.progression.startReview(TASK("std-local-result"), h.ctx);
		await waitFor(() => h.calls.dispatchParams.length > 0);
		const params = h.calls.dispatchParams[0];
		h.progression.observeToolStart({ toolName: "Agent", args: params, toolCallId: "local-spawn" });
		h.progression.observeToolEnd({
			toolName: "Agent",
			toolCallId: "local-spawn",
			args: params,
			isError: false,
			result: { details: { agentId: "local-agent" } },
		} as never);
		await waitFor(() => h.calls.notifies.some((n) => /Pi native subagent local-agent/i.test(n.text)));

		const internal = h.progression as unknown as {
			reviewJobs: Map<string, {
				resolveHandleResult?: (result: NativeReviewResult) => void;
			}>;
		};
		const job = internal.reviewJobs.get(TASK("std-local-result"));
		expect(job).toBeDefined();
		const resolveLocalResult = job!.resolveHandleResult;
		expect(resolveLocalResult).toBeDefined();

		const cancelled = await h.progression.cancel(TASK("std-local-result"), h.ctx);
		expect(cancelled.state).toBe("cancellation_requested");
		resolveLocalResult!({ agentId: "local-agent", result: "local completion is not a host receipt" });
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(h.progression.active(TASK("std-local-result"))?.state).toBe("settling");
		expect(h.control.removedCount).toBe(0);
		expect(h.calls.followUps.some((f) => f.terminal === "cancelled")).toBe(false);

		h.progression.observeToolEnd({
			toolName: "get_subagent_result",
			toolCallId: "local-terminal",
			args: { agent_id: "local-agent" },
			isError: false,
			result: {
				content: [{ type: "text", text: "Agent: local-agent\nStatus: failed\n\nnative agent stopped" }],
			},
		} as never);
		await waitFor(() => h.calls.followUps.some((f) => f.terminal === "cancelled"));
		expect(h.calls.followUps.filter((f) => f.terminal === "cancelled")).toHaveLength(1);
		expect(h.control.removedCount).toBe(1);
		expect(h.progression.active(TASK("std-local-result"))).toBeNull();
	});

	test("standard Agent local result rejection cannot settle cancellation", async () => {
		const h = makeHarness();
		await h.progression.startReview(TASK("std-local-rejection"), h.ctx);
		await waitFor(() => h.calls.dispatchParams.length > 0);
		const params = h.calls.dispatchParams[0];
		h.progression.observeToolStart({ toolName: "Agent", args: params, toolCallId: "rejection-spawn" });
		h.progression.observeToolEnd({
			toolName: "Agent",
			toolCallId: "rejection-spawn",
			args: params,
			isError: false,
			result: { details: { agentId: "rejection-agent" } },
		} as never);
		await waitFor(() => h.calls.notifies.some((n) => /Pi native subagent rejection-agent/i.test(n.text)));

		const internal = h.progression as unknown as {
			reviewJobs: Map<string, {
				rejectHandleResult?: (error: Error) => void;
			}>;
		};
		const job = internal.reviewJobs.get(TASK("std-local-rejection"));
		expect(job).toBeDefined();
		const rejectLocalResult = job!.rejectHandleResult;
		expect(rejectLocalResult).toBeDefined();

		const cancelled = await h.progression.cancel(TASK("std-local-rejection"), h.ctx);
		expect(cancelled.state).toBe("cancellation_requested");
		rejectLocalResult!(new Error("local adapter rejection is not a host receipt"));
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(h.progression.active(TASK("std-local-rejection"))?.state).toBe("settling");
		expect(h.control.removedCount).toBe(0);
		expect(h.calls.followUps.some((f) => f.terminal === "cancelled")).toBe(false);

		h.progression.observeToolEnd({
			toolName: "get_subagent_result",
			toolCallId: "rejection-terminal",
			args: { agent_id: "rejection-agent" },
			isError: false,
			result: {
				content: [{ type: "text", text: "Agent: rejection-agent\nStatus: failed\n\nnative agent stopped" }],
			},
		} as never);
		await waitFor(() => h.calls.followUps.some((f) => f.terminal === "cancelled"));
		expect(h.calls.followUps.filter((f) => f.terminal === "cancelled")).toHaveLength(1);
		expect(h.control.removedCount).toBe(1);
		expect(h.progression.active(TASK("std-local-rejection"))).toBeNull();
	});

	test("standard Agent startup cancellation retains late spawn and terminal listeners", async () => {
		const h = makeHarness();
		await h.progression.startReview(TASK("std-startup-cancel"), h.ctx);
		await waitFor(() => h.calls.dispatchParams.length > 0);
		const params = h.calls.dispatchParams[0];
		const cancelled = await h.progression.cancel(TASK("std-startup-cancel"), h.ctx);
		expect(cancelled.state).toBe("cancellation_requested");

		h.progression.observeToolStart({ toolName: "Agent", args: params, toolCallId: "late-spawn" });
		h.progression.observeToolEnd({
			toolName: "Agent",
			toolCallId: "late-spawn",
			args: params,
			isError: false,
			result: { details: { agentId: "late-agent" } },
		} as never);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(h.calls.followUps.some((f) => f.terminal === "cancelled")).toBe(false);
		expect(h.control.removedCount).toBe(0);

		h.progression.observeToolEnd({
			toolName: "get_subagent_result",
			toolCallId: "late-result",
			args: { agent_id: "late-agent" },
			isError: false,
			result: {
				content: [{ type: "text", text: "Agent: late-agent\nStatus: failed\n\nnative agent stopped" }],
			},
		} as never);
		await waitFor(() => h.calls.followUps.some((f) => f.terminal === "cancelled"));
		expect(h.control.removedCount).toBe(1);
		expect(h.calls.applyVerdicts).toHaveLength(0);
		expect(h.progression.active(TASK("std-startup-cancel"))).toBeNull();
	});

	test("advance while a review verdict is pending routes to literal-user confirmation", async () => {
		const h = makeHarness({ startReviewInjected: true, phase: "review", approvalKinds: ["qa"] });
		await h.progression.startReview(TASK("pend"), h.ctx);
		await waitFor(() => h.control.reviewHandle !== null);
		const digest = snapshotDigest(h.control.lastSnapshot!);
		h.control.releaseReviewResult!({
			result: reviewVerdictText(TASK("pend"), digest, "rework"),
			agentId: "native-agent",
		});
		await waitFor(() => h.progression.hasPendingReviewVerdict(TASK("pend")));
		const result = await h.progression.advance(TASK("pend"), h.ctx);
		expect(result.state).toBe("awaiting_user");
		// The active-operation projection reports the pending review itself
		// (exactly the previous extension behavior); the adapter's
		// request_authorization derives record-review-verdict from it.
		expect((result as { operation: string }).operation).toBe("review");
		expect((result as { reason: string }).reason).toContain("literal-user confirmation");
	});
});
