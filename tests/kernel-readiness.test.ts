import { describe, expect, test } from "bun:test";
import {
	AUTHORITY_COMMIT_RECEIPT_V2_CONTRACT,
	AUTHORITY_OBSERVATION_GENERATION_V2,
	AUTHORITY_OBSERVER_VERSION_V2,
	type AuthorityCommitReceipt,
} from "../plugins/immune-brain/runtime/authority_commit_receipts";
import type { V3AuthorityObservationV2 } from "../plugins/immune-brain/runtime/kernel/automatic_observations";
import {
	projectReadiness,
	type ReadinessEvidenceBundle,
} from "../plugins/immune-brain/runtime/kernel/readiness";

const SHA_A = `sha256:${"a".repeat(64)}`;
const SHA_B = `sha256:${"b".repeat(64)}`;
const PATH_ID = `sha256:${"c".repeat(64)}`;
const MIGRATION_DIGEST = `sha256:${"d".repeat(64)}`;

function receipt(
	attempt: string,
	status: "prepared" | "committed",
	at: string,
	planPath: string,
	overrides: Partial<AuthorityCommitReceipt> = {},
): AuthorityCommitReceipt {
	const seed = {
		contract: "assurance_kernel/authority_observation_seed/v2" as const,
		observer_version: AUTHORITY_OBSERVER_VERSION_V2,
		source_kind: "state_mutation" as const,
		source_ref: "fixture",
		state_path_identity: PATH_ID,
		committed_bytes_sha256: SHA_B,
		committed_revision: "rev-1",
		committed_at: at,
		plan_path: planPath,
		plan_signature: "sig",
		source_events: [{ id: `${attempt}-event`, action: "record_execution_evidence", at }],
		shadow: { phase: "review" as const, reason: "fixture", ambiguous: false, source_states: ["ready_for_review"] },
		divergence: { detected: false, fields: [] },
	};
	const recordSuffix = attempt.replaceAll("-", "").slice(-8);
	return {
		contract: AUTHORITY_COMMIT_RECEIPT_V2_CONTRACT,
		record_id: `sha256:${"0".repeat(55)}${recordSuffix}${status === "prepared" ? "1" : "2"}`,
		attempt_id: attempt,
		source_kind: "state_mutation",
		status,
		state_path_identity: PATH_ID,
		targets: [{ path: ".imm/memory/current_iteration.json", before_sha256: SHA_A, after_sha256: SHA_B }],
		before_sha256: SHA_A,
		after_sha256: SHA_B,
		ledger_revision: "rev-1",
		source_ref: "fixture",
		previous_record_hash: null,
		recorded_at: at,
		observation_generation: AUTHORITY_OBSERVATION_GENERATION_V2,
		observation_seed: seed,
		...overrides,
	};
}

function observation(
	terminal: AuthorityCommitReceipt,
	actions: string[],
	at: string,
	overrides: Partial<V3AuthorityObservationV2> = {},
): V3AuthorityObservationV2 {
	const seed = terminal.observation_seed!;
	return {
		contract: "assurance_kernel/v3_authority_observation/v2",
		observation_id: `${SHA_B.slice(0, -1)}3`,
		receipt_record_id: terminal.record_id,
		receipt_attempt_id: terminal.attempt_id,
		receipt_protocol: AUTHORITY_COMMIT_RECEIPT_V2_CONTRACT,
		receipt_status: terminal.status as "committed",
		source_kind: terminal.source_kind,
		source_ref: terminal.source_ref,
		state_path_identity: terminal.state_path_identity,
		committed_bytes_sha256: terminal.after_sha256,
		ledger_revision: terminal.ledger_revision,
		plan_path: seed.plan_path,
		plan_signature: seed.plan_signature,
		source_events: actions.map((action, index) => ({ id: `${terminal.attempt_id}-${index}`, action, at })),
		shadow: seed.shadow,
		divergence: seed.divergence,
		observer_generation: AUTHORITY_OBSERVATION_GENERATION_V2,
		observer_version: AUTHORITY_OBSERVER_VERSION_V2,
		committed_at: at,
		observed_at: at,
		...overrides,
	};
}

function bundle(at = "2026-08-01T00:00:00Z"): ReadinessEvidenceBundle {
	return {
		contract: "assurance_kernel/readiness_evidence/v1",
		generated_at: at,
		migration_dry_run: { digest: MIGRATION_DIGEST, writes_performed: false },
		rollback_rehearsal: { result: "passed", at, summary: "rollback rehearsed" },
	};
}

function lifecycle(path: string, index: number): { receipts: AuthorityCommitReceipt[]; observations: V3AuthorityObservationV2[] } {
	const events = [
		["record_execution_evidence"],
		["review_step"],
		["finish_reset"],
	];
	const receipts: AuthorityCommitReceipt[] = [];
	const observations: V3AuthorityObservationV2[] = [];
	for (let step = 0; step < events.length; step += 1) {
		const suffix = String(index * 10 + step + 1).padStart(12, "0");
		const attempt = `00000000-0000-4000-8000-${suffix}`;
		const at = `2026-08-${String(1 + index * 2 + step).padStart(2, "0")}T00:00:00Z`;
		const prepared = receipt(attempt, "prepared", at, path);
		const terminal = receipt(attempt, "committed", at, path, { previous_record_hash: prepared.record_id });
		receipts.push(prepared, terminal);
		observations.push(observation(terminal, events[step], at));
	}
	return { receipts, observations };
}

function input() {
	const parts = [lifecycle("docs/plans/a.md", 0), lifecycle("docs/plans/b.md", 1), lifecycle("docs/plans/c.md", 2)];
	return {
		receipts: parts.flatMap((part) => part.receipts),
		observations: parts.flatMap((part) => part.observations),
		evidence: { status: "valid" as const, bundle: bundle() },
		current_migration_digest: MIGRATION_DIGEST,
		now: "2026-08-14T00:00:00Z",
		legacy_counts: { receipts_v1: 4, observations_v1: 2 },
	};
}

describe("R2B readiness projector", () => {
	test("returns collecting for an empty epoch", () => {
		const report = projectReadiness({ ...input(), receipts: [], observations: [] });
		expect(report.status).toBe("collecting");
		expect(report.gaps.map((gap) => gap.code)).toContain("epoch_empty");
	});

	test("counts inclusive UTC days and becomes candidate at day 2", () => {
		const day1 = projectReadiness({ ...input(), now: "2026-08-01T23:59:59Z" });
		expect(day1.window_days).toBe(1);
		expect(day1.status).toBe("collecting");
		const day2 = projectReadiness({ ...input(), now: "2026-08-02T00:00:00Z" });
		expect(day2.window_days).toBe(2);
		expect(day2.lifecycle_count).toBe(3);
		expect(day2.status).toBe("candidate");
	});

	test("blocks missing and mismatched observations", () => {
		const base = input();
		const missing = projectReadiness({ ...base, observations: base.observations.slice(1) });
		expect(missing.status).toBe("blocked");
		expect(missing.gaps.map((gap) => gap.code)).toContain("missing_observation");
		const mismatched = projectReadiness({
			...base,
			observations: base.observations.map((entry, index) => index === 0 ? { ...entry, state_path_identity: SHA_A } : entry),
		});
		expect(mismatched.gaps.map((gap) => gap.code)).toContain("binding_mismatch");
	});

	test("keeps an epoch blocked across later healthy records and reports generation discontinuity", () => {
		const base = input();
		const broken = { ...base.observations[0], divergence: { detected: true, fields: ["steps"] } };
		const report = projectReadiness({ ...base, observations: [broken, ...base.observations.slice(1)] });
		expect(report.status).toBe("blocked");
		expect(report.gaps.map((gap) => gap.code)).toContain("shadow_divergence");
		const discontinuous = projectReadiness({
			...base,
			observations: base.observations.map((entry, index) => index === 1 ? { ...entry, observer_version: "future" as typeof entry.observer_version } : entry),
		});
		expect(discontinuous.gaps.map((gap) => gap.code)).toContain("version_discontinuity");
	});

	test("requires distinct ordered lifecycles and family coverage", () => {
		const base = input();
		const repeated = projectReadiness({
			...base,
			receipts: base.receipts.map((entry) => entry.observation_seed ? {
				...entry,
				observation_seed: { ...entry.observation_seed, plan_path: "docs/plans/a.md" },
			} : entry),
			observations: base.observations.map((entry) => ({ ...entry, plan_path: "docs/plans/a.md" })),
		});
		expect(repeated.status).toBe("collecting");
		expect(repeated.lifecycle_count).toBe(0);
		const outOfOrder = projectReadiness({
			...base,
			observations: base.observations.map((entry, index) => index === 0 ? { ...entry, source_events: [{ id: "early-review", action: "review_step", at: entry.committed_at }] } : entry),
		});
		expect(outOfOrder.lifecycle_count).toBeLessThan(3);
	});

	test("treats bundle absence as collecting and invalid evidence as blocked", () => {
		const base = input();
		expect(projectReadiness({ ...base, evidence: { status: "missing" } }).status).toBe("collecting");
		expect(projectReadiness({ ...base, evidence: { status: "invalid", reason: "dirty" } }).status).toBe("blocked");
		expect(projectReadiness({ ...base, current_migration_digest: SHA_A }).gaps.map((gap) => gap.code)).toContain("evidence_bundle_invalid");
	});
});
