import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { buildAssuranceSnapshot, createVerdictAuthority } from "../plugins/immune-brain/runtime/assurance/verdict_authority";
import { readTaskRecordRaw } from "../plugins/immune-brain/runtime/kernel/storage";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import { projectAssurance } from "../plugins/immune-brain/runtime/kernel/assurance_projection";
import { createMutationAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/authority_port";
import { seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";
import type { VerdictAuthority } from "../plugins/immune-brain/runtime/assurance/verdict_authority";
import { afterAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	AssuranceCoordinator,
	buildReviewPrompt,
	buildReviewSnapshotPrompt,
	parseAssuranceVerdict,
	reviewAdvisoryRecords,
	snapshotDigest,
	type AssuranceCoordinatorPorts,
	type AssuranceVerdict,
	type SnapshotDescriptor,
} from "../plugins/immune-brain/runtime/assurance/coordinator";
import { STATIC_REVIEW_RULES } from "../plugins/immune-brain/runtime/role_prompt_bridge";
import type { AssuranceHostPort, HostReviewReservation, ReviewRequest } from "../plugins/immune-brain/runtime/assurance/host_port";
import type { AssuranceProjectionResult } from "../plugins/immune-brain/runtime/kernel/assurance_projection";
import type { ReviewBundle } from "../plugins/immune-brain/runtime/assurance/review_evidence";
import { VerificationAbortedError } from "../plugins/immune-brain/runtime/assurance/verification";
import { QaPreparationError } from "../plugins/immune-brain/runtime/assurance/qa";

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
			authorization: { state: "none", blocked: null },
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
		approval: {
			kind: s.role === "qa" ? "qa" : "review",
			authority_role: s.role === "qa" ? "qa" : "reviewer",
			summary: "passed",
			// A review pass claims the reviewed change set (BR-DEC-3); QA never carries it.
			...(s.role === "review" ? { inspected_paths: [...s.dirty_files] } : {}),
		},
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
	assurance?: VerdictAuthority["buildAssurance"];
	qa?: AssuranceCoordinatorPorts["runQa"];
	record?: AssuranceCoordinatorPorts["readTaskRecord"];
	qaJobTimeoutMs?: number;
} = {}) {
	let applyCount = 0;
	let qaRuns = 0;
	const risk = overrides.risk ?? "material";
	let currentLifecycle: "active" | "done" | "stopped" = "active";
	let artifactState: "active" | "frozen" = "frozen";
	let nextObligation: AssuranceProjectionResult["projection"]["next_obligation"] = "run_qa";
	let findings: Array<{ id?: string; acceptance_id?: string | null; kind: string; status: string }> = [];
	const host = overrides.host ?? new FakeReviewHost();
	const ports: AssuranceCoordinatorPorts & Partial<VerdictAuthority> = {
		host,
		confirmationReference: ({ actorId }) => `fixture:${actorId}`,
		projectTask: overrides.project ?? (async () => {
			const fresh = projection(currentLifecycle, nextObligation, risk, artifactState);
			fresh.projection.blocking_finding_ids = findings.filter(f => f.kind === "blocking" && f.status === "open").map(f => f.id!);
			return fresh;
		}),
		readTaskRecord: overrides.record ?? (async () => ({ revision: "record-1", record: { findings } })),
		readTaskIntent: async () => ({ token: "intent-token" }),
		buildAssurance: overrides.assurance ?? (async (_root, _task, role) => ({
			snapshot: snapshot(role),
			descriptors: new Map([[
				"A1",
				{ contract: "assurance_kernel/verification_descriptor/v2", command: { executable: "tool", argv: ["test"], cwd: ".", timeout_ms: 1000, max_output_bytes: 1024 }, environment: { prepare: null, writable_paths: [] } },
			]] as never),
			reviewBundle: role === "review" ? reviewBundle() : null,
		})),
		runQa: async (s, descriptors, options) => {
			qaRuns += 1;
			return overrides.qa ? overrides.qa(s, descriptors, options) : passVerdict(s);
		},
		...(overrides.qaJobTimeoutMs !== undefined ? { qaJobTimeoutMs: overrides.qaJobTimeoutMs } : {}),
		writeReviewEvidence: () => ({ path: `${ROOT}/review.json`, remove: () => undefined }),
		applyVerdict: async (_ctx, input) => {
			applyCount += 1;
			await input.hooks?.beforeCommit?.();
			input.hooks?.onCommit?.();
			if (input.verdict.decision === "rework") {
				findings = (input.verdict.findings ?? []).map(f => ({ ...f, status: "open" }));
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
	const coordinator = new AssuranceCoordinator(ports, ports);
	return { coordinator, authority: coordinator.authority, ports, host, counts: () => ({ applyCount }), qaRuns: () => qaRuns };
}

describe("host-neutral assurance coordinator", () => {
	test("environment failure returns safe diagnostics and fresh obligations, not findings or authorization", async () => {
		const diagnostic = { acceptance_id: "A1", descriptor_ref: "acceptance/0/verification/command", descriptor_digest: `sha256:${"a".repeat(64)}`,
			stage: "resolution" as const, outcome: "process_launch_failed" as const, elapsed_ms: 2, exit_code: null, stdout_bytes: null, stderr_bytes: null };
		const h = makeCoordinator({ qa: async () => { throw new QaPreparationError("resolution", ["A1"], "process_launch_failed", [diagnostic]); } });
		const result = await h.coordinator.advance(TASK, ctx);
		expect(result).toMatchObject({ state: "failed", diagnostics: [diagnostic], recovery: {
			category: "environment", task_id: TASK, next_obligation: "run_qa", acceptance_ids: ["A1"], finding_ids: [],
		} });
		expect((result as any).recovery.next_action).toContain("environment");
		expect((result as any).recovery.next_action).not.toContain("authorization");
		expect(h.counts().applyCount).toBe(0);
	});
	for (const stage of ["build", "write", "reserve"] as const) test(`Review ${stage} failure preserves fresh QA and resumes only run_review after repair`, async () => {
		const h = makeCoordinator();
		const originalBuild = h.authority.buildAssurance, originalWrite = h.ports.writeReviewEvidence, originalReserve = h.host.prepareReview;
		h.authority.buildAssurance = async (...args) => {
			if (stage === "build" && args[2] === "review") throw new Error("fixture Review preparation unavailable");
			return originalBuild(...args);
		};
		if (stage === "write") h.ports.writeReviewEvidence = () => { throw new Error("fixture evidence unavailable"); };
		if (stage === "reserve") h.host.prepareReview = () => { throw new Error("fixture reservation unavailable"); };
		expect(await h.coordinator.advance(TASK, ctx)).toMatchObject({ state: "review_preparation_failed", recovery: {
			category: "environment", task_id: TASK, next_obligation: "run_review", acceptance_ids: ["A1"], finding_ids: [],
			next_action: expect.stringContaining("retain fresh QA"),
		} });
		expect(h.coordinator.active(TASK)).toBeNull(); expect(h.qaRuns()).toBe(1); expect(h.counts().applyCount).toBe(1);
		h.authority.buildAssurance = originalBuild; h.ports.writeReviewEvidence = originalWrite; h.host.prepareReview = originalReserve;
		expect((await h.coordinator.advance(TASK, ctx)).state).toBe("review_ready");
		expect(h.qaRuns()).toBe(1); expect(h.counts().applyCount).toBe(1);
	});
	test("the coordinator hands a Host both the complete prompt and the snapshot facts", async () => {
		let captured: ReviewRequest | null = null;
		const h = makeCoordinator();
		h.host.prepareReview = (request: ReviewRequest) => {
			captured = request;
			return { id: request.operationId, dispatch: { run_in_background: false } };
		};
		expect((await h.coordinator.advance(TASK, ctx)).state).toBe("review_ready");
		const request = captured as unknown as ReviewRequest;

		// One build, two projections: a Host whose agent carries no instructions
		// gets `prompt`; a Host whose definition carries them gets
		// `snapshotPrompt`. They are the same facts, so the two cannot disagree.
		expect(request.snapshotPrompt).toBe(buildReviewSnapshotPrompt(snapshot("review"), request.evidencePath));
		expect(request.prompt).toBe(buildReviewPrompt(snapshot("review"), request.evidencePath));
		expect(request.prompt.endsWith(request.snapshotPrompt)).toBe(true);
		expect(request.snapshotPrompt.length).toBeLessThan(request.prompt.length);
	});

	test("open findings return exact repair identities and prevent local green from running QA", async () => {
		const fresh = projection("active", "resolve_findings", "material", "active");
		fresh.projection.blocking_finding_ids = ["qa-A1-current"];
		fresh.projection.missing_acceptance_ids = ["A1"];
		const h = makeCoordinator({ project: async () => fresh });
		const result = await h.coordinator.advance(TASK, ctx);
		expect(result).toMatchObject({ state: "blocked", recovery: {
			category: "repair", task_id: TASK, next_obligation: "resolve_findings", acceptance_ids: ["A1"], finding_ids: ["qa-A1-current"],
		} });
		expect((result as any).recovery.next_action).toContain("resolve_finding");
		expect(h.qaRuns()).toBe(0);
		expect(h.counts().applyCount).toBe(0);
	});
	test("remaining findings are mapped to their own acceptance, never bulk-closed", async () => {
		const fresh = projection("active", "resolve_findings", "material", "active");
		fresh.projection.blocking_finding_ids = ["qa-A2"];
		fresh.projection.missing_acceptance_ids = ["A1", "A2"];
		const h = makeCoordinator({ project: async () => fresh, record: async () => ({ revision: "record-1", record: { findings: [
			{ id: "qa-A1", kind: "blocking", status: "resolved", acceptance_id: "A1" },
			{ id: "qa-A2", kind: "blocking", status: "open", acceptance_id: "A2" },
		] } }) });
		expect(await h.coordinator.advance(TASK, ctx)).toMatchObject({ state: "blocked", recovery: { acceptance_ids: ["A2"], finding_ids: ["qa-A2"] } });
		expect(h.qaRuns()).toBe(0); expect(h.counts().applyCount).toBe(0);
	});
	test("progress and failure DTOs strip injected stdout/stderr/argv/environment fields", async () => {
		const secret = "credential-metadata-canary-S2", updates: unknown[] = [];
		const diagnostic = { acceptance_id: "A1", descriptor_ref: "acceptance/0/verification/command", descriptor_digest: `sha256:${"a".repeat(64)}`,
			stage: "check" as const, outcome: "execution_failed" as const, elapsed_ms: 2, exit_code: null, stdout_bytes: null, stderr_bytes: null,
			stdout: secret, stderr: secret, argv: [secret], environment: { SECRET_ENV: secret } };
		const h = makeCoordinator({ qa: async (_s, _d, options) => {
			options!.onProgress!({ index: 1, total: 1, acceptance_id: "A1", phase: "running", elapsed_ms: 0, diagnostic: { ...diagnostic, outcome: "running" } });
			throw new QaPreparationError("check", ["A1"], "execution_failed", [diagnostic]);
		} });
		const result = await h.coordinator.advance(TASK, ctx, undefined, update => updates.push(update));
		expect(result).toMatchObject({ state: "failed", recovery: { category: "environment" } });
		expect(JSON.stringify({ result, updates })).not.toContain(secret);
		expect(JSON.stringify(updates)).toContain("acceptance/0/verification/command");
		expect(h.counts().applyCount).toBe(0);
	});
	test("oversized QA metadata fails loudly without clipping it into an approval", async () => {
		const diagnostic = { acceptance_id: "A1", descriptor_ref: "acceptance/0/verification/command", descriptor_digest: `sha256:${"a".repeat(64)}`,
			stage: "prepare" as const, outcome: "execution_failed" as const, elapsed_ms: 0, exit_code: null, stdout_bytes: null, stderr_bytes: null };
		const h = makeCoordinator({ qa: async () => { throw new QaPreparationError("prepare", ["A1"], "execution_failed", Array(100).fill(diagnostic)); } });
		const result = await h.coordinator.advance(TASK, ctx);
		expect(result).toMatchObject({ state: "failed", reason: expect.stringContaining("execution_metadata_limit_exceeded"), environment_failure: true });
		expect(h.counts().applyCount).toBe(0);
		expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(16_384);
	});
	test("unknown QA executor error text is not exposed as a failure reason", async () => {
		const secret = "credential-unknown-error-canary-S2";
		const h = makeCoordinator({ qa: async () => { throw new Error(`SECRET_ENV=${secret}`); } });
		const result = await h.coordinator.advance(TASK, ctx);
		expect(result).toMatchObject({ state: "failed", environment_failure: true, recovery: { category: "environment" } });
		expect(JSON.stringify(result)).not.toContain(secret);
		expect(h.counts().applyCount).toBe(0);
	});
	test.each(["scope", "unstaged"])("%s failure keeps the shared binding/staging recovery", async (kind) => {
		const h = makeCoordinator({ assurance: async () => { throw new Error(kind === "scope"
			? "task delivery contains paths outside the authorization envelope: private.ts"
			: "task delivery has unstaged or untracked changes: scoped.ts"); } });
		const result = await h.coordinator.advance(TASK, ctx);
		expect(result).toMatchObject({ state: "failed", recovery: { category: kind === "scope" ? "authorization" : "repair", next_obligation: "run_qa" } });
		expect((result as any).recovery.next_action).toContain(kind === "scope" ? "native Intent revision" : "Stage only");
		expect(h.qaRuns()).toBe(0);
	});
	test("changed recovery record fails closed rather than fabricating fresh identities", async () => {
		const fresh = projection("active", "resolve_findings", "material", "active"); fresh.projection.blocking_finding_ids = ["qa-A1"];
		const h = makeCoordinator({ project: async () => fresh, record: async () => ({ revision: "changed", record: { findings: [] } }) });
		expect(await h.coordinator.advance(TASK, ctx)).toMatchObject({ state: "blocked", recovery_error: "fresh_kernel_projection_unavailable" });
		expect(h.qaRuns()).toBe(0);
	});
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

	test("an advisory pass verdict settles and keeps its notes", async () => {
		const host = new FakeReviewHost();
		const h = makeCoordinator({ host });
		const ready = await h.coordinator.advance(TASK, ctx);
		expect(ready.state).toBe("review_ready");
		const advisory = {
			...passVerdict(snapshot("review")),
			findings: [{
				id: "review-1",
				kind: "advisory",
				acceptance_id: "A1",
				summary: "non-blocking provenance note",
				evidence: {
					trigger: "a helper is duplicated",
					caller_chain: ["runtime/assurance/coordinator.ts"],
					violated: { kind: "acceptance", ref: "A1" },
				},
			}],
		};
		expect(await h.coordinator.submitReview(TASK, ctx, advisory)).toEqual({ state: "completed" });
		const parsed = parseAssuranceVerdict(advisory, snapshot("review"));
		const records = reviewAdvisoryRecords(parsed);
		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({ acceptance_id: "A1", summary: "non-blocking provenance note" });
		// The advisory rides on the attestation, so its anchor is derived from the
		// same evidence a blocking finding would carry.
		expect(records[0].anchor).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(records[0].evidence).toMatchObject({ violated: { kind: "acceptance", ref: "A1" } });
	});

	test("a pass verdict that omits a reviewed changed path is a correctable invalid verdict", async () => {
		const host = new FakeReviewHost();
		const h = makeCoordinator({ host });
		const ready = await h.coordinator.advance(TASK, ctx);
		expect(ready.state).toBe("review_ready");
		const claim = (paths: unknown) => ({
			...passVerdict(snapshot("review")),
			approval: { ...passVerdict(snapshot("review")).approval, inspected_paths: paths },
		});

		// Missing path: rejected, the reservation survives, and nothing settles.
		const omitted = await h.coordinator.submitReview(TASK, ctx, claim([]));
		expect(omitted).toMatchObject({ state: "blocked", code: "verdict_invalid" });
		expect((omitted as { reason: string }).reason).toContain("omits reviewed changed paths: src/change.ts");
		expect(h.counts().applyCount).toBe(1);
		// The retained reservation demands one correction instead of a new envelope.
		expect(await h.coordinator.advance(TASK, ctx)).toMatchObject({
			state: "blocked",
			code: "verdict_invalid",
			reason: "Review verdict correction is required before advancing",
		});

		// Single-correction path: the complete claim settles the same reservation.
		expect(await h.coordinator.submitReview(TASK, ctx, claim(["src/change.ts"]))).toEqual({ state: "completed" });
		expect(h.counts().applyCount).toBe(2);
	});

	test("structured Review rework returns fresh finding and acceptance identities before repair", async () => {
		const h = makeCoordinator();
		expect((await h.coordinator.advance(TASK, ctx)).state).toBe("review_ready");
		const verdict = { contract: "assurance_kernel/assurance_verdict/v2", role: "review", task_id: TASK,
			snapshot_digest: snapshotDigest(snapshot("review")), decision: "rework", findings: [{ id: "review-A1", kind: "blocking", acceptance_id: "A1",
				summary: "fixture review repair", evidence: { trigger: "fixture violated assertion", caller_chain: ["src/change.ts"], violated: { kind: "acceptance", ref: "A1" } } }] };
		expect(await h.coordinator.submitReview(TASK, ctx, verdict)).toMatchObject({ state: "rework", recovery: {
			category: "repair", next_obligation: "resolve_findings", acceptance_ids: ["A1"], finding_ids: [expect.stringMatching(/^review-[a-f0-9]+-1-review-A1$/)],
		} });
		expect((await h.coordinator.advance(TASK, ctx)).state).toBe("blocked");
		expect(h.qaRuns()).toBe(1); expect(h.counts().applyCount).toBe(2);
	});
	test("a blocking finding on a pass verdict is rejected", async () => {
		const host = new FakeReviewHost();
		const h = makeCoordinator({ host });
		const ready = await h.coordinator.advance(TASK, ctx);
		expect(ready.state).toBe("review_ready");
		const blocking = {
			...passVerdict(snapshot("review")),
			findings: [{
				id: "review-1",
				kind: "blocking",
				acceptance_id: "A1",
				summary: "blocking claim",
				evidence: {
					trigger: "a caller ignores the frozen tree",
					caller_chain: ["runtime/assurance/coordinator.ts"],
					violated: { kind: "acceptance", ref: "A1" },
				},
			}],
		};
		expect(await h.coordinator.submitReview(TASK, ctx, blocking)).toMatchObject({ state: "blocked", code: "verdict_invalid" });
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

	test("the complete Review prompt is the static block followed by the snapshot facts", () => {
		const s = snapshot("review");
		const complete = buildReviewPrompt(s, "/tmp/evidence.json");
		const facts = buildReviewSnapshotPrompt(s, "/tmp/evidence.json");

		// The complete prompt is exactly static text plus the facts, so no
		// sentence can exist in only one of the two dispatch shapes.
		expect(complete.endsWith(facts)).toBe(true);
		expect(complete.length).toBeGreaterThan(facts.length);

		// The facts alone carry everything a reviewer needs to act: the evidence
		// contract, the revision it pins, the acceptances and both verdict shapes.
		expect(facts).toContain(snapshotDigest(s));
		expect(facts).toContain("TaskRecord revision: record-1");
		expect(facts).toContain("Acceptance assertions:");
		expect(facts).toContain("- A1: the contract holds");
		expect(facts).toContain("PASS shape:");
		expect(facts).toContain("REWORK shape:");
		expect(facts).toContain("/tmp/evidence.json");

		// And they carry no static instruction: the role prompt and every static
		// rule belong to the reviewer definition the plugin build generates.
		expect(facts).not.toContain("internal role: code-review");
		expect(facts).not.toContain("do not discover or load Pi Skills");
		for (const rule of STATIC_REVIEW_RULES) expect(facts).not.toContain(rule);

		// The complete prompt keeps every static instruction, so a Host whose
		// agent carries none still gets them.
		expect(complete).toContain("internal role: code-review");
		for (const rule of STATIC_REVIEW_RULES) expect(complete).toContain(rule);
	});

	test("the snapshot facts prompt is built for a review revision as well as a legacy bundle", () => {
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
		const facts = buildReviewSnapshotPrompt(s, "/tmp/evidence.json");
		expect(facts).toContain("assurance_kernel/review_manifest/v5");
		expect(facts).toContain(`git diff ${"a".repeat(40)} ${"b".repeat(40)}`);
		expect(facts).not.toContain("neighborhood_files");
		expect(facts).not.toContain("current_content");
		expect(buildReviewPrompt(s, "/tmp/evidence.json").endsWith(facts)).toBe(true);
	});

	test("buildReviewPrompt states the evidence contract and discloses no prior finding", () => {
		const prompt = buildReviewPrompt(snapshot("review"));
		expect(prompt).toContain("evidence.trigger");
		expect(prompt).toContain("caller_chain");
		expect(prompt).toContain("security_boundary");
		expect(prompt).not.toContain("counterevidence");
		expect(prompt).not.toContain("refuted");
	});

	test("a declared QA budget over the ceiling is refused before any preparation runs", async () => {
		const command = (environment: string) => ({
			executable: "project-tool",
			argv: [environment],
			cwd: ".",
			timeout_ms: 600_000,
			max_output_bytes: 1024,
		});
		// Four distinct environments, each declaring a prepare and a check at the
		// per-command ceiling: every command is legal on its own, the aggregate is
		// 82 minutes with overhead.
		const descriptors = new Map(["A1", "A2", "A3", "A4"].map((id) => [id, {
			contract: "assurance_kernel/verification_descriptor/v2",
			command: command(id),
			environment: { prepare: command(`prepare-${id}`), writable_paths: [] },
		}])) as never;
		const h = makeCoordinator({
			assurance: async (_root, _task, role) => ({ snapshot: snapshot(role), descriptors, reviewBundle: null }),
		});
		const result = await h.coordinator.advance(TASK, ctx);
		expect(result).toMatchObject({ state: "failed", operation: "qa" });
		expect((result as { reason: string }).reason).toContain("exceeds the maximum of 60 minutes");
		// The rejection precedes preparation: no check ran and no authority was written.
		expect(h.qaRuns()).toBe(0);
		expect(h.counts().applyCount).toBe(0);
	});

	test("the declared QA budget bounds preparation and checks together", async () => {
		// A host may tighten the derived budget. The deadline is wired into the
		// operation controller, so an in-flight QA is aborted and settles as a
		// failed operation instead of running past its declaration.
		const h = makeCoordinator({
			qaJobTimeoutMs: 50,
			qa: async (_snapshot, _descriptors, options) => new Promise((_resolve, reject) => {
				options.signal?.addEventListener("abort", () => reject(new VerificationAbortedError()), { once: true });
			}),
		});
		const result = await h.coordinator.advance(TASK, ctx);
		expect(result).toMatchObject({ state: "failed", operation: "qa" });
		expect((result as { reason: string }).reason).toContain("exceeded its declared job budget");
		expect(h.qaRuns()).toBe(1);
		expect(h.counts().applyCount).toBe(0);
	});

	test("QA stops rerunning after identical failures on the same snapshot", async () => {
		const failing = async () => { throw new Error("fixture execution failure"); };
		const h = makeCoordinator({ qa: failing });
		const outcomes = [];
		for (let i = 0; i < 3; i++) outcomes.push(await h.coordinator.advance(TASK, ctx));
		expect(outcomes.map(o => o.state)).toEqual(["failed", "failed", "blocked"]);
		expect((outcomes[2] as { reason: string }).reason).toContain("already failed 2 times");
		expect(h.qaRuns()).toBe(2);
	});

	test("a changed snapshot resets the QA failure limit", async () => {
		let diff = "sha256:diff";
		const h = makeCoordinator({
			qa: async () => { throw new Error("fixture execution failure"); },
			assurance: async (_root, _task, role) => ({ snapshot: { ...snapshot(role), diff_hash: diff }, descriptors: new Map([["A1", { contract: "assurance_kernel/verification_descriptor/v2", command: { executable: "tool", argv: ["test"], cwd: ".", timeout_ms: 1000, max_output_bytes: 1024 }, environment: { prepare: null, writable_paths: [] } }]] as never), reviewBundle: null }),
		});
		await h.coordinator.advance(TASK, ctx);
		await h.coordinator.advance(TASK, ctx);
		diff = "sha256:changed";
		expect((await h.coordinator.advance(TASK, ctx)).state).toBe("failed");
		expect(h.qaRuns()).toBe(3);
	});

	test("advance reports per-stage timings that sum to the total", async () => {
		expect(await makeCoordinator().coordinator.advance(TASK, ctx)).not.toHaveProperty("timings");
		const h = makeCoordinator();
		h.ports.reportTimings = true;
		const result = await h.coordinator.advance(TASK, ctx);
		const timings = (result as { timings?: { total_ms: number; stage_ms: Record<string, number> } }).timings!;
		expect(Object.keys(timings.stage_ms)).toEqual(expect.arrayContaining(["capturing_snapshot", "settling_qa", "review_ready"]));
		const sum = Object.values(timings.stage_ms).reduce((a, b) => a + b, 0);
		expect(Math.abs(sum - timings.total_ms)).toBeLessThanOrEqual(Object.keys(timings.stage_ms).length);
	});
});

const authorityRoots: string[] = [];
afterAll(() => { for (const root of authorityRoots) rmSync(root, { recursive: true, force: true }); });
function authorityFixture() {
 const root = mkdtempSync(join(tmpdir(), "s4-authority-")); authorityRoots.push(root);
 const taskId = "s4-verdict";
 const intent = parseTaskIntentV1({ contract: "assurance_kernel/task_intent/v1", task_id: taskId,
  owner: "user", goal: "exercise shared verdict authority", risk: "material", revision: 1,
  scope_hint: ["src/work.ts", `docs/plans/archive/${taskId}.intent.json`],
  acceptance: [{ id: "A1", assertion: "work passes", verification: JSON.stringify({
   contract: "assurance_kernel/verification_descriptor/v2", command: { executable: "bun", argv: ["test", "src/work.ts"], cwd: ".", timeout_ms: 1000, max_output_bytes: 1024 }, environment: { prepare: null, writable_paths: [] } }) }] });
 mkdirSync(join(root, "src"), { recursive: true }); mkdirSync(join(root, "docs/plans/archive"), { recursive: true });
 writeFileSync(join(root, "src/work.ts"), "export const value = 1;\n");
 writeFileSync(join(root, `docs/plans/archive/${taskId}.intent.json`), JSON.stringify(intent, null, 2)+"\n");
 const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "f@f", GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "f@f" } }).trim();
 git("init", "-q"); git("add", "-A"); git("commit", "-qm", "base"); const base = git("rev-parse", "HEAD");
 writeFileSync(join(root, "src/work.ts"), "export const value = 2;\n"); git("add", "src/work.ts");
 // A planning artifact outside scope_hint, so the projection still sees a clean
 // scope while the post-commit staging side effect has something observable to
 // stage: the record's intent_ref points at the archive copy, whose active
 // counterpart is this untracked file.
 writeFileSync(join(root, `docs/plans/${taskId}.intent.json`), JSON.stringify(intent, null, 2)+"\n");
 const hash = canonicalIntentHash(intent);
 seedKernelRunForTest(root, { task_id: taskId, created_at: "2026-08-12T10:00:00.000Z", updated_at: "2026-08-12T10:00:00.000Z", record: {
  contract: "assurance_kernel/task_record/v4", task_id: taskId, intent_snapshot: intent,
  intent_ref: { path: `docs/plans/archive/${taskId}.intent.json`, content_hash: hash }, lifecycle: "active", artifact_state: "frozen",
  baseline: hash, git_base_head: base, attestations: [], findings: [], history: [],
 } });
 return { root, taskId, git };
}

describe("shared verdict authority through host-configured coordinators", () => {
 for (const host of ["claude-code", "pi"] as const) {
  const source = ({ snapshot, actorId, now }: Parameters<import("../plugins/immune-brain/runtime/assurance/host_port").ConfirmationReferenceSource>[0]) =>
   host === "claude-code" ? `claude:${actorId}` : `pi-confirm-${require("node:crypto").createHash("sha256").update(`${snapshot.task_id}\0${now}\0${snapshot.intent_revision}\0${snapshot.intent_content_hash}\0${snapshot.diff_hash}`).digest("hex").slice(0,16)}`;
  function configured(f: ReturnType<typeof authorityFixture>, registry = createMutationAuthorityRegistry()) {
   const issued: string[] = []; const issue = registry.issue.bind(registry);
   registry.issue = (binding, at) => { issued.push(binding.confirmation_ref); return issue(binding, at); };
   const coordinator = new AssuranceCoordinator({ host: { host, prepareReview: () => { throw new Error("unused"); }, releaseReview: () => {} },
    confirmationReference: source, projectTask: (r,t) => projectAssurance(r,t),
    readTaskRecord: async (r,t) => readTaskRecordRaw(r,t), readTaskIntent: async () => ({}),
    runQa: async () => { throw new Error("unused"); }, writeReviewEvidence: () => { throw new Error("unused"); }, applyOrdinaryOperation: async () => {},
   });
   const authority = createVerdictAuthority({ confirmationReference: source, commitInvocation: t => coordinator.commitInvocation(t) }, registry);
   Object.assign(coordinator.authority, authority);
   return { coordinator, issued };
  }
  test(`${host}: capture validates all three identities and the v4 base`, async () => {
   const f = authorityFixture(); const h = configured(f); const p = await projectAssurance(f.root,f.taskId);
   expect((await h.coordinator.authority.buildAssurance(f.root,f.taskId,"qa",p)).snapshot.task_id).toBe(f.taskId);
   for (const key of ["record_revision", "intent_revision", "intent_content_hash"] as const) {
    const bad = { ...p, projection: { ...p.projection, [key]: key === "intent_revision" ? p.projection.intent_revision+1 : "changed" } };
    await expect(h.coordinator.authority.buildAssurance(f.root,f.taskId,"qa",bad)).rejects.toThrow("TaskRecord changed before assurance snapshot capture");
   }
   const current = readTaskRecordRaw(f.root,f.taskId);
   const missingBase = { ...current, record: { ...current.record!, git_base_head: undefined } };
   await expect(buildAssuranceSnapshot(f.root,f.taskId,"qa",p, () => missingBase as typeof current)).rejects.toThrow("missing its Enrollment git_base_head");
  });
  test(`${host}: stale snapshot refuses before minting; approval hook errors retain the committed transition`, async () => {
   const f=authorityFixture(); const h=configured(f); const p=await projectAssurance(f.root,f.taskId);
   const { snapshot:s }=await h.coordinator.authority.buildAssurance(f.root,f.taskId,"qa",p);
   const verdict: AssuranceVerdict={ contract:"assurance_kernel/assurance_verdict/v2", role:"qa",task_id:f.taskId,snapshot_digest:snapshotDigest(s),decision:"pass",approval:{kind:"qa",authority_role:"qa",summary:"passed"} };
   const invocation=h.coordinator.openInvocation(f.taskId); const before=readTaskRecordRaw(f.root,f.taskId).revision;
   await expect(h.coordinator.authority.applyVerdict({cwd:f.root},{taskId:f.taskId,snapshot:{...s,diff_hash:"changed"},verdict,invocation,actorId:"deterministic-qa"})).rejects.toThrow("assurance snapshot changed before authority application");
   expect(h.issued).toEqual([]);expect(readTaskRecordRaw(f.root,f.taskId).revision).toBe(before);
   const order:string[]=[];const first=new Error("onCommit failed");
   await expect(h.coordinator.authority.applyVerdict({cwd:f.root},{taskId:f.taskId,snapshot:s,verdict,invocation,actorId:"deterministic-qa",hooks:{beforeCommit:async()=>{expect(h.issued.length).toBe(1);order.push("before");},onCommit:()=>{order.push("on");throw first;},afterCommit:async()=>{order.push("after");throw new Error("after failed");}}})).rejects.toBe(first);
   expect(order).toEqual(["before","on","after"]);expect(readTaskRecordRaw(f.root,f.taskId).record!.attestations).toHaveLength(1);
   expect(h.issued[0]).toMatch(host==="pi"?/^pi-confirm-[a-f0-9]{16}$/:/^claude:deterministic-qa$/);h.coordinator.closeInvocation(invocation);
  });
  test(`${host}: rework commits findings, runs afterCommit before staging, and stages the planning artifact`, async () => {
   const f=authorityFixture();const h=configured(f);const p=await projectAssurance(f.root,f.taskId);const {snapshot:s}=await h.coordinator.authority.buildAssurance(f.root,f.taskId,"qa",p);
   const invocation=h.coordinator.openInvocation(f.taskId);
   const reworkVerdict={contract:"assurance_kernel/assurance_verdict/v2",role:"qa",task_id:f.taskId,snapshot_digest:snapshotDigest(s),decision:"rework",findings:[{id:"qa-finding",kind:"blocking",acceptance_id:"A1",summary:"failed",findings_digest:"sha256:"+"a".repeat(64)}]} as const;
   let sawUnstagedInAfterCommit=false;
   await h.coordinator.authority.applyVerdict({cwd:f.root},{taskId:f.taskId,snapshot:s,invocation,actorId:"qa",verdict:reworkVerdict,hooks:{afterCommit:async()=>{expect(readTaskRecordRaw(f.root,f.taskId).record!.artifact_state).toBe("active");sawUnstagedInAfterCommit=!f.git("diff","--cached","--name-only").includes(`docs/plans/${f.taskId}.intent.json`);}}});
   // afterCommit runs before the post-commit staging side effect, matching the
   // hook lifecycle the Pi adapter has always provided.
   expect(sawUnstagedInAfterCommit).toBe(true);
   expect(f.git("diff","--cached","--name-only").split("\n").filter(Boolean)).toContain(`docs/plans/${f.taskId}.intent.json`);
   expect(readTaskRecordRaw(f.root,f.taskId).record!.findings.some(x=>x.id==="qa-finding")).toBe(true);h.coordinator.closeInvocation(invocation);
  });
  test(`${host}: a staging failure after commit cannot skip afterCommit or mask the first hook error`, async () => {
   const f=authorityFixture();const h=configured(f);const p=await projectAssurance(f.root,f.taskId);const {snapshot:s}=await h.coordinator.authority.buildAssurance(f.root,f.taskId,"qa",p);
   const invocation=h.coordinator.openInvocation(f.taskId);
   const reworkVerdict={contract:"assurance_kernel/assurance_verdict/v2",role:"qa",task_id:f.taskId,snapshot_digest:snapshotDigest(s),decision:"rework",findings:[{id:"qa-staging",kind:"blocking",acceptance_id:"A1",summary:"failed",findings_digest:"sha256:"+"a".repeat(64)}]} as const;
   const onCommitError=new Error("onCommit failed");
   writeFileSync(join(f.root, ".git", "index.lock"), "");
   let afterRan=false;
   await expect(h.coordinator.authority.applyVerdict({cwd:f.root},{taskId:f.taskId,snapshot:s,invocation,actorId:"qa",verdict:reworkVerdict,hooks:{onCommit:()=>{throw onCommitError;},afterCommit:async()=>{afterRan=true;}}})).rejects.toBe(onCommitError);
   // The committed transition stands and the lifecycle completed, so the host's
   // ambiguous-state handling never sees a masking staging error.
   expect(afterRan).toBe(true);
   expect(readTaskRecordRaw(f.root,f.taskId).record!.findings.some(x=>x.id==="qa-staging")).toBe(true);
   rmSync(join(f.root, ".git", "index.lock"));
   h.coordinator.closeInvocation(invocation);
  });
 }
});
