import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	AssuranceCoordinator,
	buildReviewPrompt,
	parseAssuranceVerdict,
	snapshotDigest,
	type AssuranceCoordinatorPorts,
	type AssuranceVerdict,
	type SnapshotDescriptor,
} from "../plugins/immune-brain/runtime/assurance/coordinator";
import type { AssuranceHostPort, HostReviewReservation, ReviewRequest } from "../plugins/immune-brain/runtime/assurance/host_port";
import type { AssuranceProjectionResult } from "../plugins/immune-brain/runtime/kernel/assurance_projection";
import type { ReviewBundle } from "../plugins/immune-brain/runtime/assurance/review_evidence";

const TASK = "phase3-task";
const ROOT = "/tmp/phase3-assurance";
const ctx = { cwd: ROOT };

function projection(
	lifecycle: "active" | "done" | "stopped" = "active",
	nextObligation: AssuranceProjectionResult["projection"]["next_obligation"] = "run_qa",
	risk: AssuranceProjectionResult["projection"]["risk"] = "material",
	artifactState: "active" | "frozen" = "frozen",
): AssuranceProjectionResult {
	return {
		error: null,
		claim: { task_id: TASK, lifecycle_status: lifecycle === "active" ? "active" : "terminal" } as never,
		projection: {
			lifecycle,
			artifact_state: artifactState,
			risk,
			next_obligation: nextObligation,
			record_revision: "record-1",
			workspace_revision: "workspace-1",
			intent_revision: 1,
			intent_content_hash: "sha256:intent",
			diff_hash: "sha256:diff",
			fresh_acceptance_ids: ["A1"],
			missing_acceptance_ids: [],
			stale_attestation_ids: [],
			blocking_finding_ids: [],
			unresolved_user_decision_ids: [],
			replan_required_ids: [],
			completion_ready: false,
			authorization: { state: "blocked" },
		} as never,
	} as AssuranceProjectionResult;
}

function snapshot(role: "qa" | "review"): SnapshotDescriptor {
	return {
		contract: "assurance_kernel/assurance_snapshot/v2",
		task_id: TASK,
		role,
		record_revision: "record-1",
		workspace_revision: "workspace-1",
		intent_revision: 1,
		intent_content_hash: "sha256:intent",
		diff_hash: "sha256:diff",
		lifecycle: "active",
		artifact_state: "frozen",
		risk: "material",
		fresh_acceptance_ids: ["A1"],
		missing_acceptance_ids: [],
		stale_attestation_ids: [],
		acceptance: [{ id: "A1", assertion: "the contract holds", verification: "{}" }],
		dirty_files: ["src/change.ts"],
		review_bundle_digest: role === "review" ? "sha256:bundle" : null,
		root: ROOT,
	};
}

function reviewBundle(): ReviewBundle {
	return {
		contract: "assurance_kernel/review_bundle/v4",
		root: ROOT,
		head: "a".repeat(40),
		scope: ["src/change.ts"],
		diff_hash: "sha256:diff",
		dirty_files: {},
		outcomes: { A1: { status: "passed", summary: "fresh" } },
		bundle_digest: "sha256:bundle",
	} as unknown as ReviewBundle;
}

function passVerdict(s: SnapshotDescriptor): AssuranceVerdict {
	return {
		contract: "assurance_kernel/assurance_verdict/v2",
		role: s.role,
		task_id: TASK,
		snapshot_digest: snapshotDigest(s),
		decision: "pass",
		approval: { kind: s.role === "qa" ? "qa" : "review", authority_role: s.role === "qa" ? "qa" : "reviewer", summary: "passed" },
	};
}

class FakeReviewHost implements AssuranceHostPort {
	readonly host = "fake" as const;

	prepareReview(request: ReviewRequest): HostReviewReservation {
		return { id: request.operationId, dispatch: { run_in_background: false } };
	}

	releaseReview(reservation: HostReviewReservation): void {
		void reservation;
	}
}

function makeCoordinator(overrides: {
	risk?: "routine" | "material" | "critical";
	host?: FakeReviewHost;
	project?: AssuranceCoordinatorPorts["projectTask"];
} = {}) {
	let applyCount = 0;
	const risk = overrides.risk ?? "material";
	let currentLifecycle: "active" | "done" | "stopped" = "active";
	let artifactState: "active" | "frozen" = "frozen";
	let nextObligation: AssuranceProjectionResult["projection"]["next_obligation"] = "run_qa";
	const host = overrides.host ?? new FakeReviewHost();
	const ports: AssuranceCoordinatorPorts = {
		host,
		projectTask: overrides.project ?? (async () => projection(currentLifecycle, nextObligation, risk, artifactState)),
		readTaskRecord: async () => ({ record: { findings: [] } }),
		readTaskIntent: async () => ({ token: "intent-token" }),
		frozenRunner: async () => ({ runner_id: "bun", path: "/bun", dev: 1, ino: 1, content_hash: "sha256:x", version: "1.3.14" }),
		buildAssurance: async (_root, _task, role) => ({
			snapshot: snapshot(role),
			descriptors: new Map([[
				"A1",
				{ contract: "assurance_kernel/verification_descriptor/v1", runner_id: "bun", runner_version: "1.3.14", argv: ["test"], cwd: ".", timeout_ms: 1000, max_output_bytes: 1024 },
			]] as never),
			reviewBundle: role === "review" ? reviewBundle() : null,
		}),
		runQa: async (s) => passVerdict(s),
		writeReviewEvidence: () => ({ path: `${ROOT}/review.json`, remove: () => undefined }),
		applyVerdict: async (_ctx, input) => {
			applyCount += 1;
			await input.hooks?.beforeCommit?.();
			input.hooks?.onCommit?.();
			if (input.verdict.decision === "rework") {
				artifactState = "active";
				nextObligation = "resolve_findings";
			} else if (input.snapshot.role === "qa") {
				nextObligation = risk === "routine" ? "complete" : "run_review";
			} else {
				nextObligation = "complete";
			}
			await input.hooks?.afterCommit?.();
		},
		applyOrdinaryOperation: async (_ctx, input) => {
			if (input.operation.op === "complete") {
				currentLifecycle = "done";
				nextObligation = "none";
			}
		},
	};
	return { coordinator: new AssuranceCoordinator(ports), host, counts: () => ({ applyCount }) };
}

describe("host-neutral assurance coordinator", () => {
	test("routine completes after QA without a Review reservation", async () => {
		const h = makeCoordinator({ risk: "routine" });
		expect(await h.coordinator.advance(TASK, ctx)).toEqual({ state: "completed" });
		expect(h.counts().applyCount).toBe(1);
	});

	test("material Review from a fake Host settles without Pi APIs", async () => {
		const host = new FakeReviewHost();
		const h = makeCoordinator({ host });
		const ready = await h.coordinator.advance(TASK, ctx);
		expect(ready.state).toBe("review_ready");
		expect((ready as { agent_params: { run_in_background: boolean } }).agent_params.run_in_background).toBe(false);
		expect(await h.coordinator.submitReview(TASK, ctx, passVerdict(snapshot("review")))).toEqual({ state: "completed" });
		expect(h.counts().applyCount).toBe(2);
	});

	test("critical Review completes without a second user authorization", async () => {
		const host = new FakeReviewHost();
		const h = makeCoordinator({ risk: "critical", host });
		const ready = await h.coordinator.advance(TASK, ctx);
		expect(ready.state).toBe("review_ready");
		expect(await h.coordinator.submitReview(TASK, ctx, passVerdict(snapshot("review")))).toEqual({ state: "completed" });
		expect(h.counts().applyCount).toBe(2);
	});

	test("missing Review evidence fails before mutation", async () => {
		const h = makeCoordinator();
		const ready = await h.coordinator.advance(TASK, ctx);
		expect(ready.state).toBe("review_ready");
		// Simulate evidence/reservation loss: release happens via reviewPreparationFailed.
		expect(await h.coordinator.submitReview("unknown-task", ctx, passVerdict(snapshot("review")))).toMatchObject({
			state: "blocked",
			reason: "no active Review operation",
		});
		expect(h.counts().applyCount).toBe(1);
	});

	test("stale snapshot fails closed without a second mutation", async () => {
		const host = new FakeReviewHost();
		let reads = 0;
		const h = makeCoordinator({
			host,
			project: async () => {
				reads += 1;
				if (reads <= 2) return projection("active", reads === 1 ? "run_qa" : "run_review");
				const current = projection("active", "run_review");
				return { ...current, projection: { ...current.projection, record_revision: "changed" } };
			},
		});
		const ready = await h.coordinator.advance(TASK, ctx);
		expect(ready.state).toBe("review_ready");
		expect(await h.coordinator.submitReview(TASK, ctx, passVerdict(snapshot("review")))).toMatchObject({
			state: "blocked",
			reason: "assurance snapshot changed before Review submission",
		});
		expect(h.counts().applyCount).toBe(1);
	});

	test("invalid verdict keeps the reservation until a corrected payload settles", async () => {
		const host = new FakeReviewHost();
		const h = makeCoordinator({ host });
		const ready = await h.coordinator.advance(TASK, ctx);
		expect(ready.state).toBe("review_ready");
		expect(await h.coordinator.submitReview(TASK, ctx, { contract: "nope" })).toMatchObject({ state: "blocked", code: "verdict_invalid" });
		expect(h.counts().applyCount).toBe(1);
		// Advancing stays blocked while the verdict correction is outstanding.
		expect(await h.coordinator.advance(TASK, ctx)).toMatchObject({ state: "blocked", code: "verdict_invalid" });
		expect(h.counts().applyCount).toBe(1);
		expect(await h.coordinator.submitReview(TASK, ctx, passVerdict(snapshot("review")))).toEqual({ state: "completed" });
		expect(h.counts().applyCount).toBe(2);
	});

	test("shared assurance modules import no Host SDK or adapter", () => {
		const dir = resolve("plugins/immune-brain/runtime/assurance");
		const banned = /@earendil-works\/|pi-coding-agent|\.pi-extension|claude-plugin|generic dispatcher|createSharedRegistry/;
		for (const name of readdirSync(dir)) {
			if (!name.endsWith(".ts")) continue;
			const source = readFileSync(join(dir, name), "utf8");
			expect({ name, match: source.match(banned)?.[0] }).toEqual({ name, match: undefined });
		}
	});

	test("review rework findings require machine-checkable evidence", async () => {
		const host = new FakeReviewHost();
		const h = makeCoordinator({ host });
		expect((await h.coordinator.advance(TASK, ctx)).state).toBe("review_ready");
		const s = snapshot("review");
		const verdict = (evidence?: unknown) => ({
			contract: "assurance_kernel/assurance_verdict/v2",
			role: "review",
			task_id: TASK,
			snapshot_digest: snapshotDigest(s),
			decision: "rework" as const,
			findings: [{
				id: "r-1",
				kind: "blocking" as const,
				acceptance_id: "A1",
				summary: "broken",
				...(evidence !== undefined ? { evidence } : {}),
			}],
		});
		const complete = {
			trigger: "the empty caller chain reaches state the assertion forbids",
			caller_chain: ["runtime/a.ts", "shares()"],
			violated: { kind: "acceptance" as const, ref: "A1" },
		};
		// Missing or empty evidence returns the existing verdict_invalid path
		// with zero authority writes; a complete verdict settles.
		expect(await h.coordinator.submitReview(TASK, ctx, verdict())).toMatchObject({ state: "blocked", code: "verdict_invalid" });
		expect(await h.coordinator.submitReview(TASK, ctx, verdict({ ...complete, caller_chain: [] }))).toMatchObject({ state: "blocked", code: "verdict_invalid" });
		expect(h.counts().applyCount).toBe(1);
		expect(await h.coordinator.submitReview(TASK, ctx, verdict(complete))).toMatchObject({ state: "rework" });
		expect(h.counts().applyCount).toBe(2);
	});

	test("a review verdict derives one stable anchor from violated identity and caller chain", () => {
		const s = snapshot("review");
		const parse = (evidence: unknown) => parseAssuranceVerdict({
			contract: "assurance_kernel/assurance_verdict/v2",
			role: "review",
			task_id: TASK,
			snapshot_digest: snapshotDigest(s),
			decision: "rework",
			findings: [{ id: "r-1", kind: "blocking", acceptance_id: "A1", summary: "broken", evidence }],
		}, s);
		const evidence = { trigger: "t", caller_chain: ["a.ts"], violated: { kind: "acceptance", ref: "A1" } };
		const first = parse(evidence).findings![0];
		expect(first.anchor).toMatch(/^sha256:[a-f0-9]{64}$/);
		expect(parse(evidence).findings![0].anchor).toBe(first.anchor);
		expect(parse({ ...evidence, caller_chain: ["b.ts"] }).findings![0].anchor).not.toBe(first.anchor);
		expect(parse({ ...evidence, violated: { kind: "acceptance", ref: "A2" } }).findings![0].anchor).not.toBe(first.anchor);
	});

	test("buildReviewPrompt states the evidence contract and discloses no prior finding", () => {
		const prompt = buildReviewPrompt(snapshot("review"));
		expect(prompt).toContain("evidence.trigger");
		expect(prompt).toContain("caller_chain");
		expect(prompt).toContain("security_boundary");
		expect(prompt).not.toContain("counterevidence");
		expect(prompt).not.toContain("refuted");
	});
});
