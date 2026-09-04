import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	AssuranceProgression,
	snapshotDigest,
	type AssuranceProgressionPorts,
	type AssuranceVerdict,
	type SnapshotDescriptor,
} from "../../plugins/immune-brain/.pi-extension/pi-canary-assurance-progression.ts";
import type { AssuranceProjectionResult } from "../../plugins/immune-brain/.pi-extension/runtime-stub.ts";
import type { ReviewBundle } from "../../plugins/immune-brain/.pi-extension/pi-canary-review-bundle.ts";

export const TASK = "phase3-task";
export const ROOT = "/tmp/phase3-assurance";
export const ctx = { cwd: ROOT, mode: "tui", ui: {} } as unknown as ExtensionContext;

export function projection(
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

export function snapshot(role: "qa" | "review"): SnapshotDescriptor {
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

export function passVerdict(s: SnapshotDescriptor): AssuranceVerdict {
	return {
		contract: "assurance_kernel/assurance_verdict/v2",
		role: s.role,
		task_id: TASK,
		snapshot_digest: snapshotDigest(s),
		decision: "pass",
		approval: { kind: s.role === "qa" ? "qa" : "review", authority_role: s.role === "qa" ? "qa" : "reviewer", summary: "passed" },
	};
}

export function makeAssuranceHarness(overrides: Partial<{
	phase: string;
	risk: "routine" | "material" | "critical";
	runQa: AssuranceProgressionPorts["runQa"];
	project: AssuranceProgressionPorts["projectTask"];
	writeReviewEvidence: AssuranceProgressionPorts["writeReviewEvidence"];
	applyVerdict: AssuranceProgressionPorts["applyVerdict"];
	applyOrdinaryOperation: AssuranceProgressionPorts["applyOrdinaryOperation"];
}> = {}) {
	let applyCount = 0;
	let removeCount = 0;
	let evidenceCount = 0;
	let currentLifecycle: "active" | "done" | "stopped" = "active";
	let artifactState: "active" | "frozen" = overrides.phase === "working" ? "active" : "frozen";
	const risk = overrides.risk ?? "material";
	let nextObligation: AssuranceProjectionResult["projection"]["next_obligation"] = artifactState === "active" ? "submit_assurance" : "run_qa";
	const ports: AssuranceProgressionPorts = {
		projectTask: overrides.project ?? (async () => projection(currentLifecycle, nextObligation, risk, artifactState)),
		readTaskRecord: async () => ({ record: { findings: [] } } as never),
		readTaskIntent: async () => ({ token: "intent-token" } as never),
		frozenRunner: async () => ({ id: "bun", version: "1.3.14" } as never),
		buildAssurance: async (_root, _task, role) => ({
			snapshot: snapshot(role),
			descriptors: new Map([[
				"A1",
				{ contract: "assurance_kernel/verification_descriptor/v1", runner_id: "bun", runner_version: "1.3.14", argv: ["test"], cwd: ".", timeout_ms: 1000, max_output_bytes: 1024 },
			]] as never),
			reviewBundle: role === "review" ? reviewBundle() : null,
		}),
		runQa: overrides.runQa ?? (async (s, _descriptors, _runner, options) => {
			options.onProgress?.({ index: 1, total: 1, acceptance_id: "A1", phase: "passed", elapsed_ms: 1 });
			return passVerdict(s);
		}),
		writeReviewEvidence: overrides.writeReviewEvidence ?? (() => {
			evidenceCount += 1;
			return { path: `${ROOT}/review-${evidenceCount}.json`, remove: () => { removeCount += 1; } };
		}),
		applyVerdict: overrides.applyVerdict ?? (async (_ctx, input) => {
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
		}),
		applyOrdinaryOperation: overrides.applyOrdinaryOperation ?? (async (_ctx, input) => {
			if (input.operation.op === "freeze_artifacts") {
				artifactState = "frozen";
				nextObligation = "run_qa";
			} else if (input.operation.op === "complete") {
				currentLifecycle = "done";
				nextObligation = "none";
			}
		}),
	};
	return { progression: new AssuranceProgression(ports), ports, counts: () => ({ applyCount, removeCount, evidenceCount }) };
}

export function resultText(s: SnapshotDescriptor, decision: "pass" | "rework" = "pass"): string {
	return JSON.stringify(decision === "pass"
		? passVerdict(s)
		: { contract: "assurance_kernel/assurance_verdict/v2", role: "review", task_id: TASK, snapshot_digest: snapshotDigest(s), decision: "rework", findings: [{ id: "finding", kind: "blocking", acceptance_id: "A1", summary: "needs repair" }] });
}
