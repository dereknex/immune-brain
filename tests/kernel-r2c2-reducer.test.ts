import { describe, expect, test } from "bun:test";
import {
	canonicalRecordHash,
	isReducedMutation,
	reduceTask,
} from "../plugins/immune-brain/runtime/kernel/reducer";
import { canonicalIntentHash } from "../plugins/immune-brain/runtime/kernel/intent";
import type {
	AuthorityAuditDescriptor,
	TaskAction,
	TaskRecordV3,
} from "../plugins/immune-brain/runtime/kernel/types";
import { KernelInvariantError, KernelValidationError, assertTaskRecordUpdateV3, parseTaskRecordV3 } from "../plugins/immune-brain/runtime/kernel/validation";
import { anchorForEvidence } from "../plugins/immune-brain/runtime/kernel/refutation";

const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: "task-r2c2",
	goal: "One outcome",
	acceptance: [
		{ id: "A1", assertion: "acceptance one", verification: "verify one" },
	],
	scope_hint: ["plugins/immune-brain"],
	risk: "material",
	revision: 1,
	owner: "user",
} as const;

const INTENT_HASH = canonicalIntentHash(INTENT);
const DIFF = `sha256:${"a".repeat(64)}`;
const WS = `sha256:${"b".repeat(64)}`;

function rawRecordFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		contract: "assurance_kernel/task_record/v3",
		task_id: "task-r2c2",
		intent_snapshot: INTENT,
		intent_ref: {
			path: "docs/plans/task-r2c2.intent.json",
			content_hash: INTENT_HASH,
		},
		lifecycle: "active",
		artifact_state: "active",
		baseline: `sha256:${"0".repeat(64)}`,
		attestations: [],
		findings: [],
		history: [],
		...overrides,
	};
}

function recordFixture(overrides: Partial<TaskRecordV3> = {}): TaskRecordV3 {
	return parseTaskRecordV3(rawRecordFixture(overrides as Record<string, unknown>));
}

function qaAttestation(overrides: Record<string, unknown> = {}) {
	return {
		id: "ap-qa",
		kind: "qa",
		authority_role: "qa",
		task_revision: 1,
		intent_content_hash: INTENT_HASH,
		diff_hash: DIFF,
		actor_id: "qa-1",
		summary: "qa passed",
		acceptance_results: [{ acceptance_id: "A1", status: "passed", summary: "A1 passed" }],
		...overrides,
	};
}

function frozenFixture(overrides: Partial<TaskRecordV3> = {}): TaskRecordV3 {
	return recordFixture({
		artifact_state: "frozen",
		intent_ref: {
			path: "docs/plans/archive/task-r2c2.intent.json",
			content_hash: INTENT_HASH,
		},
		...overrides,
	});
}

function baseAction(type: TaskAction["type"]): TaskAction {
	return {
		type,
		event_id: `ev-${type}-${Math.random().toString(36).slice(2, 10)}`,
		at: "2026-08-12T00:00:00.000Z",
		actor_id: "executor-1",
		expected_record_hash: canonicalRecordHash(recordFixture()),
		expected_workspace_hash: WS,
		diff_hash: DIFF,
	} as TaskAction;
}

function audit(authority_kind: "qa" | "review" | "user", actor_id = `${authority_kind}-1`): AuthorityAuditDescriptor {
	return {
		authority_kind,
		actor_id,
		confirmation_ref: `conf-${authority_kind}`,
		issued_at: "2026-08-12T00:00:00.000Z",
		expires_at: "2099-01-01T00:00:00.000Z",
	};
}

function reduce(record: TaskRecordV3, action: TaskAction, authority: AuthorityAuditDescriptor | null = null) {
	return reduceTask(record, {
		...action,
		expected_record_hash: canonicalRecordHash(record),
	} as TaskAction, authority, action.type === "complete" ? [] : undefined);
}

function approval(kind: "qa" | "review" | "user", id = `ap-${kind}`) {
	return {
		id,
		kind,
		authority_role: kind === "review" ? "reviewer" : kind,
		task_revision: 1,
		intent_content_hash: INTENT_HASH,
		diff_hash: DIFF,
		actor_id: `${kind}-1`,
		summary: `${kind} approved`,
	};
}

function approve(record: TaskRecordV3, kind: "qa" | "review" | "user"): TaskRecordV3 {
	return reduce(record, {
		...baseAction("record_approval"),
		approval: approval(kind),
	} as TaskAction, audit(kind)).record;
}

describe("TaskRecord v3 reducer", () => {
	test("QA approval atomically attests every acceptance", () => {
		const record = frozenFixture();
		const mutation = reduce(record, {
			...baseAction("record_approval"),
			approval: approval("qa"),
		} as TaskAction, audit("qa"));

		expect(isReducedMutation(mutation)).toBe(true);
		expect(mutation.record.attestations).toEqual([
			expect.objectContaining({
				kind: "qa",
				acceptance_results: [{ acceptance_id: "A1", status: "passed", summary: "host-attested QA: qa approved" }],
			}),
		]);
		expect(mutation.record.history[0].reason).toContain("action_v2_sha256:");
		expect(mutation.next_workspace_working).toBe("task-r2c2");
	});

	test("approval authority must match attestation kind", () => {
		const action = {
			...baseAction("record_approval"),
			approval: approval("qa"),
		} as TaskAction;
		expect(() => reduce(frozenFixture(), action, audit("review"))).toThrow(KernelInvariantError);
	});

	test("ordinary findings can be recorded and resolved", () => {
		const finding = {
			id: "f-1",
			kind: "blocking",
			status: "open",
			acceptance_id: "A1",
			source: "execution",
			review_round: null,
			summary: "blocked",
		} as const;
		const afterAdd = reduce(recordFixture(), {
			...baseAction("record_finding"),
			finding,
		} as TaskAction).record;
		const afterResolve = reduce(afterAdd, {
			...baseAction("resolve_finding"),
			finding_id: finding.id,
		} as TaskAction).record;
		expect(afterResolve.findings[0].status).toBe("resolved");
	});

	test("user-decision findings cannot be resolved as ordinary findings", () => {
		const record = recordFixture({
			findings: [{
				id: "ud-1",
				kind: "unresolved_user_decision",
				status: "open",
				acceptance_id: "A1",
				source: "kernel",
				review_round: 2,
				summary: "user decision required",
			}],
		});
		expect(() => reduce(record, {
			...baseAction("resolve_finding"),
			finding_id: "ud-1",
		} as TaskAction)).toThrow(KernelInvariantError);
	});

	test("review rework restores active artifacts and parks the second review round", () => {
		const rework = (id: string) => ({
			...baseAction("request_rework"),
			findings: [{
				id,
				kind: "blocking",
				status: "open",
				acceptance_id: "A1",
				source: "review",
				review_round: 1,
				summary: "rework",
			}],
		}) as TaskAction;
		const afterRound1 = reduce(frozenFixture(), rework("f-1"), audit("review")).record;
		expect(afterRound1.artifact_state).toBe("active");
		expect(afterRound1.intent_ref.path).toBe("docs/plans/task-r2c2.intent.json");

		const round2Input = frozenFixture({
			findings: afterRound1.findings,
			history: afterRound1.history,
		});
		const afterRound2 = reduce(round2Input, rework("f-2"), audit("review")).record;
		expect(afterRound2.artifact_state).toBe("frozen");
		expect(afterRound2.findings.some((item) => item.kind === "replan_required" && item.status === "open")).toBe(true);
	});

	test("material completion requires QA and Review attestations", () => {
		const qaOnly = approve(frozenFixture(), "qa");
		expect(() => reduce(qaOnly, { ...baseAction("complete") } as TaskAction)).toThrow(/not eligible for completion/);
		const ready = approve(qaOnly, "review");
		const mutation = reduce(ready, { ...baseAction("complete") } as TaskAction);
		expect(mutation.record.lifecycle).toBe("done");
		expect(mutation.record.artifact_state).toBe("frozen");
		expect(mutation.next_workspace_working).toBeNull();
	});

	test("stop requires user authority and freezes the intent path", () => {
		const record = recordFixture();
		const action = { ...baseAction("stop"), reason: "cancelled" } as TaskAction;
		expect(() => reduce(record, action)).toThrow(KernelInvariantError);
		const mutation = reduce(record, action, audit("user"));
		expect(mutation.record.lifecycle).toBe("stopped");
		expect(mutation.record.artifact_state).toBe("frozen");
		expect(mutation.record.intent_ref.path).toBe("docs/plans/archive/task-r2c2.intent.json");
	});

	test("compatible intent revision updates the snapshot without a mirrored revision field", () => {
		const nextIntent = {
			...INTENT,
			revision: 2,
			acceptance: [...INTENT.acceptance, { id: "A2", assertion: "acceptance two", verification: "verify two" }],
		};
		const mutation = reduce(recordFixture(), {
			...baseAction("revise_intent"),
			next_intent: nextIntent,
			next_intent_ref: {
				path: "docs/plans/task-r2c2.intent.json",
				content_hash: canonicalIntentHash(nextIntent),
			},
		} as TaskAction);
		expect(mutation.record.intent_snapshot.revision).toBe(2);
		expect(mutation.record).not.toHaveProperty("intent_revision");
		expect(mutation.record.intent_ref).not.toHaveProperty("revision");
	});

	test("breaking intent revision requires user authority", () => {
		const nextIntent = {
			...INTENT,
			revision: 2,
			acceptance: [{ ...INTENT.acceptance[0], assertion: "rewritten assertion" }],
		};
		const next_intent_ref = {
			path: "docs/plans/task-r2c2.intent.json",
			content_hash: canonicalIntentHash(nextIntent),
		};
		expect(() => reduce(recordFixture(), {
			...baseAction("revise_intent"),
			next_intent: nextIntent,
			next_intent_ref,
		} as TaskAction)).toThrow(KernelInvariantError);
		const approved = reduce(recordFixture(), {
			...baseAction("approve_breaking_intent_revision"),
			next_intent: nextIntent,
			next_intent_ref,
		} as TaskAction, audit("user")).record;
		expect(approved.intent_snapshot.revision).toBe(2);
	});

	test("exact replay is idempotent and conflicting event reuse fails", () => {
		const record = recordFixture();
		const action = {
			...baseAction("record_finding"),
			event_id: "ev-replay-1",
			expected_record_hash: canonicalRecordHash(record),
			finding: {
				id: "f-1",
				kind: "blocking",
				status: "open",
				acceptance_id: "A1",
				source: "execution",
				review_round: null,
				summary: "blocked",
			},
		} as TaskAction;
		const first = reduceTask(record, action, null).record;
		const replayed = reduceTask(first, action, null).record;
		expect(canonicalRecordHash(replayed)).toBe(canonicalRecordHash(first));
		expect(replayed.history).toHaveLength(1);
		expect(() => reduceTask(first, {
			...action,
			finding: { ...action.finding, summary: "changed" },
		} as TaskAction, null)).toThrow(KernelInvariantError);
	});

	test("unknown actions and stale record hashes fail closed", () => {
		const record = frozenFixture();
		expect(() => reduce(record, { type: "patch", event_id: "x" } as unknown as TaskAction)).toThrow();
		expect(() => reduceTask(record, {
			...baseAction("complete"),
			expected_record_hash: `sha256:${"0".repeat(64)}`,
		} as TaskAction, null)).toThrow(KernelInvariantError);
	});

	test("refute_finding binds a fresh passing QA attestation and rejects everything weaker", () => {
		const finding = {
			id: "f-1",
			kind: "blocking",
			status: "open",
			acceptance_id: "A1",
			source: "review",
			review_round: 1,
			summary: "broken",
		} as const;
		const attestation = qaAttestation;
		const fixture = (findings: unknown[], attestations: unknown[] = []) =>
			recordFixture({ findings, attestations } as never);
		const refute = (record: TaskRecordV3) =>
			reduce(record, {
				...baseAction("refute_finding"),
				finding_id: "f-1",
				attestation_id: "ap-qa",
			} as TaskAction);
		const resolve = (record: TaskRecordV3) =>
			reduce(record, {
				...baseAction("resolve_finding"),
				finding_id: "f-1",
			} as TaskAction);
		// The actor cannot assert a refutation: no fresh, passing QA attestation
		// covering A1 means the action is rejected with the record unchanged.
		expect(() => refute(fixture([finding]))).toThrow(KernelInvariantError);
		expect(() => refute(fixture([finding], [attestation({ diff_hash: `sha256:${"e".repeat(64)}` })]))).toThrow(KernelInvariantError);
		expect(() => refute(fixture([finding], [attestation({ task_revision: 2 })]))).toThrow(KernelInvariantError);
		expect(() => refute(fixture([finding], [attestation({ acceptance_results: [{ acceptance_id: "A1", status: "failed", summary: "no" }] })]))).toThrow(KernelInvariantError);
		// A fresh passing QA attestation covering the finding's acceptance refutes it.
		const mutation = refute(fixture([finding], [attestation()]));
		expect(mutation.record.findings[0]).toMatchObject({
			status: "refuted",
			counterevidence: { attestation_id: "ap-qa", acceptance_id: "A1" },
		});
		// Append-only: a live refutation cannot be rewritten by another
		// refute_finding.
		expect(() => refute(mutation.record)).toThrow(KernelInvariantError);
		// A live refutation already suppresses the finding, so resolving it would
		// make that suppression permanent; the Kernel refuses while the bound
		// evidence is live.
		expect(() => resolve(mutation.record)).toThrow(KernelInvariantError);
		// Once the bound attestation leaves the fresh set the refutation has no
		// force, so the stale refuted finding is resolvable again.
		const staleRefuted = fixture(
			[{
				...finding,
				status: "refuted",
				counterevidence: { attestation_id: "ap-qa", acceptance_id: "A1" },
			}],
			[attestation({ diff_hash: `sha256:${"e".repeat(64)}` })],
		);
		expect(resolve(staleRefuted).record.findings[0].status).toBe("resolved");
	});

	test("a persisted refutation must prove the binding the Kernel could have written", () => {
		const refutedFinding = {
			id: "f-1",
			kind: "blocking",
			status: "refuted",
			acceptance_id: "A1",
			source: "review",
			review_round: 1,
			summary: "already refuted",
			counterevidence: { attestation_id: "ap-qa", acceptance_id: "A1" },
		};
		const parse = (findings: unknown[], attestations: unknown[] = []) =>
			parseTaskRecordV3(rawRecordFixture({ findings, attestations }));
		// The record a live refutation is written as stays parseable.
		expect(parse([refutedFinding], [qaAttestation()])).toBeTruthy();
		// A refuted finding without the evidence it claims is not authority.
		expect(() => parse([{ ...refutedFinding, counterevidence: undefined }], [qaAttestation()]))
			.toThrow(KernelValidationError);
		// Evidence for another acceptance cannot suppress this finding.
		expect(() => parse(
			[{ ...refutedFinding, counterevidence: { attestation_id: "ap-qa", acceptance_id: "A2" } }],
			[qaAttestation()],
		)).toThrow(KernelValidationError);
		// An inherited refutation keeps the acceptance its QA evidence was
		// proved on, which need not be the finding's own acceptance id.
		expect(parse(
			[{
				...refutedFinding,
				acceptance_id: "A2",
				counterevidence: { attestation_id: "ap-qa", acceptance_id: "A1" },
			}],
			[qaAttestation()],
		)).toBeTruthy();
		// Dangling or non-QA evidence is not executable counterevidence.
		expect(() => parse([refutedFinding])).toThrow(KernelValidationError);
		expect(() => parse([refutedFinding], [qaAttestation({ kind: "review", authority_role: "reviewer" })]))
			.toThrow(KernelValidationError);
		// An open finding cannot carry counterevidence, and an asserted anchor
		// must have the derived digest shape.
		expect(() => parse([{ ...refutedFinding, status: "open" }], [qaAttestation()]))
			.toThrow(KernelValidationError);
		expect(() => parse([{
			id: "f-1",
			kind: "blocking",
			status: "open",
			acceptance_id: "A1",
			source: "review",
			review_round: 1,
			summary: "asserted anchor",
			anchor: "not-a-digest",
		}])).toThrow(KernelValidationError);
		// A refuted user decision or replan boundary would hide the gate those
		// findings exist to hold.
		for (const kind of ["unresolved_user_decision", "replan_required"])
			expect(() => parse([{ ...refutedFinding, kind }], [qaAttestation()]))
				.toThrow(KernelValidationError);
		// An anchor is only authority when it is the digest of the finding's own
		// evidence.
		const evidence = {
			trigger: "the claim was reproduced by its caller chain",
			caller_chain: ["runtime/kernel/refutation.ts"],
			violated: { kind: "acceptance", ref: "A1" },
		};
		const derived = anchorForEvidence(evidence as never);
		expect(parse([{ ...refutedFinding, anchor: derived, evidence }], [qaAttestation()])).toBeTruthy();
		expect(() => parse([{ ...refutedFinding, anchor: derived }], [qaAttestation()]))
			.toThrow(KernelValidationError);
		expect(() => parse([{ ...refutedFinding, anchor: `sha256:${"b".repeat(64)}`, evidence }], [qaAttestation()]))
			.toThrow(KernelValidationError);
	});

	test("a legal refutation transition may not carry a rewritten claim", () => {
		const finding = {
			id: "f-1",
			kind: "blocking",
			status: "open",
			acceptance_id: "A1",
			source: "review",
			review_round: 1,
			summary: "broken",
		} as const;
		const previous = recordFixture({ findings: [finding], attestations: [qaAttestation()] } as never);
		const action = {
			...baseAction("refute_finding"),
			finding_id: "f-1",
			attestation_id: "ap-qa",
		} as TaskAction;
		const mutation = reduce(previous, action);
		// The Kernel's own transition is a legal write...
		expect(() => assertTaskRecordUpdateV3(previous, mutation.record, action)).not.toThrow();
		// ...but the same transition cannot also rewrite the claim it refutes.
		const tampered = {
			...mutation.record,
			findings: mutation.record.findings.map((item) =>
				item.id === "f-1" ? { ...item, summary: "rewritten" } : item,
			),
		} as TaskRecordV3;
		expect(() => assertTaskRecordUpdateV3(previous, tampered, action)).toThrow(KernelInvariantError);
	});

	test("the append-only refutation exemption admits only the Kernel's transitions", () => {
		const finding = {
			id: "f-1",
			kind: "blocking",
			status: "open",
			acceptance_id: "A1",
			source: "review",
			review_round: 1,
			summary: "broken",
		} as const;
		const stale = qaAttestation({ id: "ap-qa-stale", diff_hash: `sha256:${"c".repeat(64)}` });
		const attestations = [qaAttestation(), stale];
		const action = {
			...baseAction("refute_finding"),
			finding_id: "f-1",
			attestation_id: "ap-qa",
		} as TaskAction;
		// The Spec's stale -> refuted renewal is a legal write.
		const stalePrior = parseTaskRecordV3(rawRecordFixture({
			findings: [{
				...finding,
				status: "refuted",
				counterevidence: { attestation_id: "ap-qa-stale", acceptance_id: "A1" },
			}],
			attestations,
		}));
		const renewed = reduce(stalePrior, action).record;
		expect(() => assertTaskRecordUpdateV3(stalePrior, renewed, action)).not.toThrow();
		// Rebinding a refutation that is still live is not.
		const livePrior = parseTaskRecordV3(rawRecordFixture({
			findings: [{
				...finding,
				status: "refuted",
				counterevidence: { attestation_id: "ap-qa", acceptance_id: "A1" },
			}],
			attestations,
		}));
		const rebound = {
			...livePrior,
			findings: livePrior.findings.map((item) => ({
				...item,
				counterevidence: { attestation_id: "ap-qa-stale", acceptance_id: "A1" },
			})),
			history: renewed.history,
		};
		expect(() => assertTaskRecordUpdateV3(livePrior, rebound as never, action)).toThrow(KernelInvariantError);
		// The refutation binds the acceptance the finding names, not another
		// acceptance the same attestation happens to pass.
		const mismatched = parseTaskRecordV3(rawRecordFixture({
			findings: [{ ...finding, acceptance_id: "A0" }],
			attestations,
		}));
		const misbound = {
			...mismatched,
			findings: mismatched.findings.map((item) => ({
				...item,
				status: "refuted",
				counterevidence: { attestation_id: "ap-qa", acceptance_id: "A1" },
			})),
			history: renewed.history,
		};
		expect(() => assertTaskRecordUpdateV3(mismatched, misbound as never, action)).toThrow(KernelInvariantError);
		// Neither can a rework action rewrite a finding it names.
		const rework = { ...baseAction("request_rework"), findings: [finding] } as TaskAction;
		const rewritten = {
			...livePrior,
			findings: livePrior.findings.map((item) => ({ ...item, summary: "rewritten" })),
			history: renewed.history,
		};
		expect(() => assertTaskRecordUpdateV3(livePrior, rewritten as never, rework)).toThrow(KernelInvariantError);
	});
});
