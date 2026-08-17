import { describe, expect, it } from "bun:test";
import * as reducerModule from "../plugins/immune-brain/runtime/kernel/reducer";
import {
	KernelInvariantError,
	KernelValidationError,
	assertIntentUpdate,
	assertKernelInvariants,
	completionDecision,
	mapLegacyState,
	parseTaskIntent,
	parseTaskRecord,
	projectTask,
	reduceTask,
	type TaskAction,
	type TaskIntent,
	type TaskRecord,
} from "../plugins/immune-brain/runtime/kernel";

const intent: TaskIntent = {
	contract: "assurance_kernel/intent/v1",
	task_id: "task-1",
	revision: 2,
	goal: "Close one deterministic kernel boundary",
	acceptance: [
		{ id: "A1", text: "Fresh execution evidence exists" },
		{ id: "A2", text: "Required review is independent" },
	],
	scope_hint: ["plugins/immune-brain/runtime/kernel/"],
	risk: "material",
};

function record(overrides: Partial<TaskRecord> = {}): TaskRecord {
	return {
		contract: "assurance_kernel/task_record/v1",
		task_id: "task-1",
		intent_revision: 2,
		phase: "review",
		baseline: "sha256:baseline",
		evidence: [
			{
				id: "E1",
				acceptance_id: "A1",
				task_revision: 2,
				diff_hash: "sha256:diff",
				status: "passed",
				actor_id: "executor",
				summary: "A1 passed",
			},
			{
				id: "E2",
				acceptance_id: "A2",
				task_revision: 2,
				diff_hash: "sha256:diff",
				status: "passed",
				actor_id: "executor",
				summary: "A2 passed",
			},
		],
		findings: [],
		approvals: [
			{
				id: "P1",
				kind: "review",
				authority_role: "reviewer",
				task_revision: 2,
				diff_hash: "sha256:diff",
				actor_id: "reviewer",
				summary: "Independent review passed",
			},
		],
		history: [],
		...overrides,
	};
}

function legacyFollowUp(
	state: "pending" | "executing" | "ready_for_review" | "rework_needed" | "closed" | "replanning",
): Record<string, unknown> {
	return {
		id: "follow-up-1",
		state,
		scope: ["plugins/immune-brain/runtime/kernel/legacy.ts"],
		change_goal: "Repair the bounded review finding",
		verification_hint: "bun test tests/kernel-core.test.ts",
		origin_review: {
			gate: "imm-code-review",
			evidence_ref: "review://finding-1",
		},
		execution_evidence: null,
		opened_at: "2026-08-11T00:00:00Z",
		round: 1,
	};
}

describe("Assurance Kernel schema", () => {
	it("rejects unknown persisted lifecycle authority", () => {
		expect(() =>
			parseTaskRecord({ ...record(), runtime_status: "idle" }),
		).toThrow(KernelValidationError);
		expect(() =>
			parseTaskRecord({ ...record(), next_action: "activate" }),
		).toThrow("unknown field: next_action");
	});

	it("rejects invalid enums and dangling references", () => {
		expect(() => parseTaskRecord({ ...record(), phase: "idle" })).toThrow(
			"phase must be one of working, review, done, stopped",
		);
		expect(() =>
			assertKernelInvariants(intent, {
				...record(),
				evidence: [{ ...record().evidence[0], acceptance_id: "missing" }],
			}),
		).toThrow(KernelInvariantError);
	});
});

describe("Assurance Kernel completion predicate", () => {
	it("accepts only fresh evidence and independent required approvals", () => {
		const decision = completionDecision(intent, record(), "sha256:diff");
		expect(decision).toEqual({
			complete: true,
			fresh_acceptance_ids: ["A1", "A2"],
			missing_acceptance_ids: [],
			stale_evidence_ids: [],
			missing_approval_kinds: [],
			blocking_finding_ids: [],
			unresolved_user_decision_ids: [],
			replan_required_ids: [],
			independence_violations: [],
		});
	});

	it("reports stale evidence", () => {
		const stale = record({
			evidence: record().evidence.map((item) => ({
				...item,
				diff_hash: "sha256:old",
			})),
		});
		const decision = completionDecision(intent, stale, "sha256:diff");
		expect(decision.complete).toBe(false);
		expect(decision.missing_acceptance_ids).toEqual(["A1", "A2"]);
		expect(decision.stale_evidence_ids).toEqual(["E1", "E2"]);
	});

	it("reports missing and self-issued approvals", () => {
		const missing = completionDecision(
			intent,
			record({ approvals: [] }),
			"sha256:diff",
		);
		expect(missing.missing_approval_kinds).toEqual(["review"]);

		const selfApproved = completionDecision(
			intent,
			record({
				approvals: [{ ...record().approvals[0], actor_id: "executor" }],
			}),
			"sha256:diff",
		);
		expect(selfApproved.complete).toBe(false);
		expect(selfApproved.missing_approval_kinds).toEqual(["review"]);
		expect(selfApproved.independence_violations).toEqual(["P1"]);
	});

	it("requires distinct, role-aligned critical authorities", () => {
		const criticalIntent: TaskIntent = { ...intent, risk: "critical" };
		const sharedActor = record({
			approvals: [
				{
					...record().approvals[0],
					id: "P-QA",
					kind: "qa",
					authority_role: "qa",
					actor_id: "same-reviewer",
				},
				{
					...record().approvals[0],
					id: "P-REVIEW",
					actor_id: "same-reviewer",
				},
				{
					...record().approvals[0],
					id: "P-USER",
					kind: "user",
					authority_role: "user",
					actor_id: "same-reviewer",
				},
			],
		});
		const sharedDecision = completionDecision(
			criticalIntent,
			sharedActor,
			"sha256:diff",
		);
		expect(sharedDecision.complete).toBe(false);
		expect(sharedDecision.independence_violations).toEqual([
			"P-QA",
			"P-REVIEW",
			"P-USER",
		]);

		const distinctActors = record({
			approvals: sharedActor.approvals.map((approval) => ({
				...approval,
				actor_id: `${approval.authority_role}-authority`,
			})),
		});
		expect(
			completionDecision(criticalIntent, distinctActors, "sha256:diff").complete,
		).toBe(true);
		expect(() =>
			completionDecision(
				criticalIntent,
				record({
					approvals: [
						{
							...record().approvals[0],
							authority_role: "qa",
						},
					],
				}),
				"sha256:diff",
			),
		).toThrow("approval P1 kind review requires authority_role reviewer");
	});

	it("blocks on findings and unresolved user decisions", () => {
		const blocked = record({
			findings: [
				{
					id: "F1",
					kind: "blocking",
					status: "open",
					acceptance_id: "A1",
					source: "review",
					review_round: 1,
					summary: "Assertion is incomplete",
				},
				{
					id: "F2",
					kind: "unresolved_user_decision",
					status: "open",
					acceptance_id: "A2",
					source: "kernel",
					review_round: 2,
					summary: "User must decide the disputed boundary",
				},
			],
		});
		const decision = completionDecision(intent, blocked, "sha256:diff");
		expect(decision.complete).toBe(false);
		expect(decision.blocking_finding_ids).toEqual(["F1"]);
		expect(decision.unresolved_user_decision_ids).toEqual(["F2"]);
		expect(decision.replan_required_ids).toEqual([]);
	});
});

describe("Assurance Kernel reducer", () => {
	it("parks the second review return on a replan boundary", () => {
		const first = reduceTask(
			record({ findings: [] }),
			{
				type: "request_rework",
				event_id: "H1",
				at: "2026-08-10T00:00:00Z",
				findings: [
					{
						id: "F1",
						kind: "blocking",
						acceptance_id: "A1",
						summary: "First review gap",
					},
				],
			},
		);
		expect(first.phase).toBe("working");
		expect(first.findings.some((item) => item.kind === "unresolved_user_decision")).toBe(false);

		const secondReview = reduceTask(first, {
			type: "submit_review",
			event_id: "H2",
			at: "2026-08-10T00:01:00Z",
		});
		const second = reduceTask(secondReview, {
			type: "request_rework",
			event_id: "H3",
			at: "2026-08-10T00:02:00Z",
			findings: [
				{
					id: "F3",
					kind: "blocking",
					acceptance_id: "A1",
					summary: "Disputed second review gap",
				},
			],
		});
		expect(second.phase).toBe("review");
		expect(second.findings).toContainEqual(
			expect.objectContaining({
				id: "H3:replan-required",
				kind: "replan_required",
				status: "open",
				review_round: 2,
			}),
		);
		expect(second.findings.some((item) => item.kind === "unresolved_user_decision")).toBe(false);
		expect(projectTask(intent, second, "sha256:diff").blocked).toBe(true);
	});

	it("requires separate user authority for privileged outcomes", () => {
		const userDecisionRecord = record({
			phase: "working",
			findings: [
				{
					id: "user-decision",
					kind: "unresolved_user_decision",
					status: "open",
					acceptance_id: "A1",
					source: "kernel",
					review_round: 2,
					summary: "A literal user must choose",
				},
			],
		});
		expect(() =>
			reduceTask(userDecisionRecord, {
				type: "resolve_finding",
				event_id: "generic-user-resolve",
				at: "2026-08-10T00:03:00Z",
				finding_id: "user-decision",
			}),
		).toThrow("generic resolve_finding cannot resolve a user decision");
		expect(() =>
			reduceTask(record({ phase: "working" }), {
				type: "stop",
				event_id: "self-asserted-stop",
				at: "2026-08-10T00:04:00Z",
				reason: "caller claims user approval",
				user_confirmed: true,
			} as unknown as TaskAction),
		).toThrow("stop requires user authority context");
	});

	it("binds privileged event replay to an auditable authority descriptor", () => {
		const authorityFactory = (
			reducerModule as unknown as {
				createUserAuthorityContextForTest?: (audit: {
					actor_id: string;
					source: "literal_user";
					confirmation_ref: string;
				}) => unknown;
			}
		).createUserAuthorityContextForTest;
		expect(authorityFactory).toBeFunction();
		if (!authorityFactory) return;
		const authority = authorityFactory({
			actor_id: "user-1",
			source: "literal_user",
			confirmation_ref: "prompt-42",
		});
		const changedAuthority = authorityFactory({
			actor_id: "user-2",
			source: "literal_user",
			confirmation_ref: "prompt-43",
		});
		const action = {
			type: "stop",
			event_id: "authorized-stop",
			at: "2026-08-10T00:05:00Z",
			reason: "user cancelled",
		} as const;
		const first = reducerModule.reduceTask(
			record({ phase: "working" }),
			action,
			authority,
		);
		expect(first.phase).toBe("stopped");
		expect(first.history.at(-1)).toMatchObject({
			type: "stop",
			authority: {
				actor_id: "user-1",
				source: "literal_user",
				confirmation_ref: "prompt-42",
			},
		});
		expect(reducerModule.reduceTask(first, action, authority)).toEqual(first);
		expect(() =>
			reducerModule.reduceTask(first, action, changedAuthority),
		).toThrow("event_id authorized-stop conflicts with a recorded action");

		const decisionRecord = record({
			phase: "working",
			findings: [
				{
					id: "decision-to-resolve",
					kind: "unresolved_user_decision",
					status: "open",
					acceptance_id: "A1",
					source: "kernel",
					review_round: 2,
					summary: "Choose the boundary",
				},
			],
		});
		const resolved = reducerModule.reduceTask(
			decisionRecord,
			{
				type: "resolve_user_decision",
				event_id: "authorized-resolution",
				at: "2026-08-10T00:06:00Z",
				finding_id: "decision-to-resolve",
				resolution: "keep current acceptance",
			} as never,
			authority,
		);
		expect(resolved.findings[0]?.status).toBe("resolved");
		expect(resolved.history.at(-1)?.authority).toEqual({
			actor_id: "user-1",
			source: "literal_user",
			confirmation_ref: "prompt-42",
		});
	});

	it("replays identical events idempotently and rejects conflicting reuse", () => {
		const cases: Array<{ source: TaskRecord; action: TaskAction }> = [
			{
				source: record({ phase: "working" }),
				action: {
					type: "submit_review",
					event_id: "retry-submit",
					at: "2026-08-10T01:00:00Z",
				},
			},
			{
				source: record(),
				action: {
					type: "request_rework",
					event_id: "retry-rework",
					at: "2026-08-10T01:01:00Z",
					findings: [
						{
							id: "retry-finding",
							kind: "blocking",
							acceptance_id: "A1",
							summary: "Retry-safe finding",
						},
					],
				},
			},
			{
				source: record(),
				action: {
					type: "complete",
					event_id: "retry-complete",
					at: "2026-08-10T01:02:00Z",
					intent,
					current_diff_hash: "sha256:diff",
				},
			},
			{
				source: record({
					phase: "working",
					findings: [
						{
							id: "open-finding",
							kind: "blocking",
							status: "open",
							acceptance_id: "A1",
							source: "review",
							review_round: 1,
							summary: "Resolve me",
						},
					],
				}),
				action: {
					type: "resolve_finding",
					event_id: "retry-resolve",
					at: "2026-08-10T01:04:00Z",
					finding_id: "open-finding",
				},
			},
		];
		for (const { source, action } of cases) {
			const first = reduceTask(source, action);
			const second = reduceTask(first, action);
			expect(second).toEqual(first);
			expect(second.history).toHaveLength(source.history.length + 1);
			const conflicting = { ...action, at: "2026-08-10T09:00:00Z" } as TaskAction;
			expect(() => reduceTask(first, conflicting)).toThrow(
				`event_id ${action.event_id} conflicts with a recorded action`,
			);
		}
	});

	it("rejects illegal transitions and incomplete closure", () => {
		expect(() =>
			reduceTask(record({ phase: "done" }), {
				type: "submit_review",
				event_id: "H1",
				at: "2026-08-10T00:00:00Z",
			}),
		).toThrow("illegal phase transition: done -> review");
		expect(() =>
			reduceTask(
				record({ approvals: [] }),
				{
					type: "complete",
					event_id: "H2",
					at: "2026-08-10T00:00:00Z",
					intent,
					current_diff_hash: "sha256:diff",
				},
			),
		).toThrow("task is not eligible for completion");
	});
});

describe("Assurance Kernel projection and migration", () => {
	it("maps the reproduced v3 contradiction to stopped", () => {
		const mapped = mapLegacyState({
			runtime_status: "idle",
			requires_replan: false,
			active_step: null,
			steps: { "1": { state: "replanning" } },
		});
		expect(mapped).toEqual({
			phase: "stopped",
			reason: "legacy-inconsistent",
			ambiguous: true,
			source_states: ["replanning"],
		});
	});

	it("fails closed when active_step masks another current state", () => {
		expect(
			mapLegacyState({
				requires_replan: false,
				active_step: 1,
				steps: {
					"1": { state: "active" },
					"2": { state: "ready_for_review" },
				},
			}),
		).toMatchObject({
			phase: "stopped",
			reason: "legacy-inconsistent",
			ambiguous: true,
		});
		expect(
			mapLegacyState({
				requires_replan: false,
				active_step: 1,
				steps: {
					"1": { state: "pending" },
					"2": { state: "active" },
				},
			}),
		).toMatchObject({
			phase: "stopped",
			reason: "legacy-inconsistent",
			ambiguous: true,
		});
	});

	it("maps the validated pending follow-up lifecycle", () => {
		const base = {
			plan_path: "docs/plans/follow-up.md",
			plan_terminal: null,
			runtime_status: "idle",
			active_step: null,
			requires_replan: false,
			steps: { "1": { state: "closed" } },
		};
		for (const state of ["pending", "executing", "rework_needed"] as const) {
			expect(
				mapLegacyState({ ...base, pending_follow_up: legacyFollowUp(state) }),
			).toMatchObject({
				phase: "working",
				reason: "legacy-working",
				ambiguous: false,
			});
		}
		expect(
			mapLegacyState({
				...base,
				pending_follow_up: legacyFollowUp("ready_for_review"),
			}),
		).toMatchObject({
			phase: "review",
			reason: "legacy-review",
			ambiguous: false,
		});
		expect(
			mapLegacyState({
				...base,
				requires_replan: true,
				pending_follow_up: legacyFollowUp("replanning"),
			}),
		).toMatchObject({
			phase: "stopped",
			reason: "legacy-replan",
			ambiguous: false,
		});
	});

	it("fails closed for malformed, closed, or conflicting follow-up ownership", () => {
		const base = {
			plan_path: "docs/plans/follow-up.md",
			plan_terminal: null,
			runtime_status: "idle",
			active_step: null,
			requires_replan: false,
			steps: { "1": { state: "closed" } },
		};
		for (const pending_follow_up of [
			{ state: "executing" },
			legacyFollowUp("closed"),
		]) {
			expect(mapLegacyState({ ...base, pending_follow_up })).toMatchObject({
				phase: "stopped",
				reason: "legacy-inconsistent",
				ambiguous: true,
			});
		}
		expect(
			mapLegacyState({
				...base,
				active_step: 1,
				steps: { "1": { state: "executing" } },
				pending_follow_up: legacyFollowUp("executing"),
			}),
		).toMatchObject({
			phase: "stopped",
			reason: "legacy-inconsistent",
			ambiguous: true,
		});
	});

	it("requires positive Plan identity before mapping an all-closed aggregate", () => {
		expect(
			mapLegacyState({
				runtime_status: "idle",
				active_step: null,
				requires_replan: false,
				pending_follow_up: null,
				steps: { "1": { state: "closed" } },
			}),
		).toMatchObject({
			phase: "stopped",
			reason: "legacy-inconsistent",
			ambiguous: true,
		});
	});

	it("maps normal closed/current/future step aggregates", () => {
		expect(
			mapLegacyState({
				requires_replan: false,
				active_step: 2,
				steps: {
					"1": { state: "closed" },
					"2": { state: "active" },
					"3": { state: "pending" },
				},
			}),
		).toMatchObject({ phase: "working", ambiguous: false });
		expect(
			mapLegacyState({
				requires_replan: false,
				active_step: 2,
				steps: {
					"1": { state: "closed" },
					"2": { state: "ready_for_review" },
					"3": { state: "pending" },
				},
			}),
		).toMatchObject({ phase: "review", ambiguous: false });
		expect(
			mapLegacyState({
				plan_path: "docs/plans/reviewing.md",
				plan_terminal: null,
				active_step: null,
				steps: {
					"1": { state: "closed" },
					"2": { state: "closed" },
				},
			}),
		).toMatchObject({
			phase: "review",
			reason: "legacy-review",
			ambiguous: false,
		});
	});

	it("distinguishes a finished Plan from all-closed review state", () => {
		const planPath = "docs/plans/finished.md";
		const closed = {
			plan_path: planPath,
			plan_terminal: null,
			runtime_status: "idle",
			active_step: null,
			requires_replan: false,
			pending_follow_up: null,
			steps: {
				"1": { state: "closed" },
				"2": { state: "closed" },
			},
		};
		const matchingFinish = {
			at: "2026-08-11T03:00:02Z",
			action: "finish_reset",
			details: { plan_path: planPath },
		};

		expect(
			mapLegacyState({
				...closed,
				reset_reason: "intentional_reset",
				history: [matchingFinish],
			}),
		).toEqual({
			phase: "done",
			reason: "legacy-finished",
			ambiguous: false,
			source_states: ["closed"],
		});

		const unverified = [
			{ ...closed, history: [matchingFinish] },
			{ ...closed, reset_reason: "intentional_reset" },
			{
				...closed,
				reset_reason: "intentional_reset",
				history: "malformed",
			},
			{
				...closed,
				reset_reason: "intentional_reset",
				history: [
					{ ...matchingFinish, details: { plan_path: "docs/plans/other.md" } },
				],
			},
			{
				...closed,
				reset_reason: "intentional_reset",
				steps: {
					"1": { state: "closed" },
					"2": {},
				},
				history: [matchingFinish],
			},
			{
				...closed,
				reset_reason: "intentional_reset",
				requires_replan: "true",
				history: [matchingFinish],
			},
			{
				...closed,
				reset_reason: "intentional_reset",
				requires_replan: 1,
				history: [matchingFinish],
			},
			{
				...closed,
				reset_reason: "intentional_reset",
				requires_replan: null,
				history: [matchingFinish],
			},
			{
				...closed,
				reset_reason: "intentional_reset",
				requires_replan: undefined,
				history: [matchingFinish],
			},
			{
				...closed,
				reset_reason: "intentional_reset",
				active_step: {},
				history: [matchingFinish],
			},
			{
				...closed,
				reset_reason: "intentional_reset",
				pending_follow_up: false,
				history: [matchingFinish],
			},
			{
				...closed,
				reset_reason: "intentional_reset",
				pending_follow_up: { id: "follow-up-open" },
				history: [matchingFinish],
			},
			{
				...closed,
				reset_reason: "intentional_reset",
				history: [
					matchingFinish,
					{
						...matchingFinish,
						at: "2026-08-11T03:01:00Z",
						details: { plan_path: "docs/plans/other.md" },
					},
				],
			},
		];
		const failClosed = [
			...unverified.splice(4, 4),
			...unverified.splice(5, 3),
		];
		for (const state of unverified) {
			expect(mapLegacyState(state)).toMatchObject({
				phase: "review",
				reason: "legacy-review",
				ambiguous: false,
			});
		}
		for (const state of failClosed) {
			expect(mapLegacyState(state)).toMatchObject({
				phase: "stopped",
				reason: "legacy-inconsistent",
				ambiguous: true,
			});
		}
		expect(
			mapLegacyState({
				...closed,
				plan_terminal: { status: "superseded", plan_path: planPath },
				reset_reason: "intentional_reset",
				history: [matchingFinish],
			}),
		).toMatchObject({
			phase: "stopped",
			reason: "legacy-terminal",
			ambiguous: true,
		});
		expect(
			mapLegacyState({
				plan_path: planPath,
				plan_terminal: { status: "superseded", plan_path: planPath },
				active_step: null,
				requires_replan: false,
				pending_follow_up: null,
				steps: {},
			}),
		).toMatchObject({
			phase: "stopped",
			reason: "legacy-terminal",
			ambiguous: true,
		});
	});

	it("derives an idempotent projection without persisting it", () => {
		for (const phase of ["working", "review", "done", "stopped"] as const) {
			const source = record({ phase });
			const first = projectTask(intent, source, "sha256:diff");
			const second = projectTask(intent, source, "sha256:diff");
			expect(second).toEqual(first);
			expect(source).not.toHaveProperty("next_action");
			expect(source).not.toHaveProperty("blocked");
		}
	});

	it("enforces monotonic risk and revisioned intent changes", () => {
		expect(() =>
			assertIntentUpdate(intent, { ...intent, risk: "routine" }, record()),
		).toThrow("risk cannot be downgraded");
		expect(() =>
			assertIntentUpdate(
				intent,
				{ ...intent, goal: "Changed goal without revision" },
				record(),
			),
		).toThrow("goal or acceptance changes require a revision bump");
		expect(() =>
			parseTaskIntent({ ...intent, revision: 0 }),
		).toThrow("revision must be a positive integer");
	});
});
