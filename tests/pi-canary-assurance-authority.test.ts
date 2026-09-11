import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildSnapshot,
	snapshotDigest,
	buildReviewPrompt,
	parseAssuranceVerdict,
	reviewReworkFindings,
	type SnapshotDescriptor,
} from "../plugins/immune-brain/.pi-extension/imm-canary-work.ts";
import { findingsDigestV2 } from "../plugins/immune-brain/runtime/kernel/reducer";
import { runDeterministicQa } from "../plugins/immune-brain/runtime/assurance/qa";
import {
	parseVerificationDescriptor,
	resolveBunRunner,
	type VerificationDescriptor,
} from "../plugins/immune-brain/.pi-extension/pi-canary-verification.ts";

function snapshot(overrides: Partial<SnapshotDescriptor> = {}): SnapshotDescriptor {
	return buildSnapshot({
		root: "/tmp/fake-root",
		task_id: "task-1",
		role: "review",
		record_revision: "sha256:" + "a".repeat(64),
		workspace_revision: "sha256:" + "b".repeat(64),
		intent_revision: 1,
		intent_content_hash: "sha256:" + "c".repeat(64),
		diff_hash: "sha256:" + "d".repeat(64),
		lifecycle: "active",
		artifact_state: "frozen",
		risk: "material",
		fresh_acceptance_ids: ["A1"],
		missing_acceptance_ids: [],
		stale_attestation_ids: [],
		acceptance: [{ id: "A1", assertion: "artifact exists", verification: "descriptor" }],
		dirty_files: ["src/new.ts"],
		review_bundle_digest: "sha256:" + "e".repeat(64),
		...overrides,
	});
}

const REVIEW_EVIDENCE = {
	trigger: "the empty caller chain reaches the defect",
	caller_chain: ["runtime/kernel/reducer.ts", "sharesAcceptanceBoundary()"],
	violated: { kind: "acceptance", ref: "A1" },
};

function reworkVerdict(s: SnapshotDescriptor, evidence: unknown = REVIEW_EVIDENCE): string {
	return JSON.stringify({
		contract: "assurance_kernel/assurance_verdict/v2",
		role: "review",
		task_id: s.task_id,
		snapshot_digest: snapshotDigest(s),
		decision: "rework",
		findings: [{ id: "r-1", kind: "blocking", acceptance_id: "A1", summary: "broken", evidence }],
	});
}

function passVerdict(s: SnapshotDescriptor) {
	return JSON.stringify({
		contract: "assurance_kernel/assurance_verdict/v2",
		role: s.role,
		task_id: s.task_id,
		snapshot_digest: snapshotDigest(s),
		decision: "pass",
		approval: {
			kind: s.role === "qa" ? "qa" : "review",
			authority_role: s.role === "qa" ? "qa" : "reviewer",
			summary: "verified",
		},
	});
}

function descriptor(argv: string[]): VerificationDescriptor {
	const runner = resolveBunRunner();
	return parseVerificationDescriptor(
		JSON.stringify({
			contract: "assurance_kernel/verification_descriptor/v1",
			runner_id: "bun",
			runner_version: runner.version,
			argv,
			cwd: ".",
			timeout_ms: 30000,
			max_output_bytes: 8192,
		}),
	);
}

describe("canary assurance authority", () => {
	test("snapshot and review prompt bind all authority owners", () => {
		const s = snapshot();
		expect(snapshotDigest(s)).toMatch(/^sha256:[a-f0-9]{64}$/);
		expect(snapshotDigest(buildSnapshot({ ...s, artifact_state: "active" }))).not.toBe(snapshotDigest(s));
		expect(snapshotDigest(buildSnapshot({ ...s, dirty_files: ["src/other.ts"] }))).not.toBe(snapshotDigest(s));
		expect(snapshotDigest(buildSnapshot({ ...s, review_bundle_digest: "sha256:" + "f".repeat(64) }))).not.toBe(snapshotDigest(s));
		const prompt = buildReviewPrompt(s);
		expect(prompt).toContain(snapshotDigest(s));
		expect(prompt).toContain("read-only code review");
		expect(prompt).toContain("Read that file first");
	expect(prompt).toContain("Verify immutable bundle provenance before analyzing findings");
	expect(prompt).toContain("Limit repository inspection to the acceptance assertions and dirty_files contents in the immutable bundle");
	expect(prompt).toContain("Do not explore unrelated repository paths");
	expect(prompt).toContain("Reserve the final turn for exactly one strict JSON verdict");
		expect(prompt).toContain("verify that git rev-parse HEAD in the isolated reviewer worktree equals bundle.head");
		expect(prompt).toContain("base_oid");
		expect(prompt).toContain("Do not inspect or depend on live task bytes outside the immutable bundle");
		expect(prompt).toContain('"authority_role":"reviewer"');
		expect(prompt).toContain('do not emit "approval": null');
		expect(() => buildReviewPrompt(snapshot({ role: "qa" }))).toThrow(/review role/i);
	});

	test("strict verdict parsing binds role, task, snapshot, and host findings digest", () => {
		const s = snapshot();
		const pass = parseAssuranceVerdict(passVerdict(s), s);
		expect(pass.approval?.authority_role).toBe("reviewer");
		const rework = reworkVerdict(s);
		const first = parseAssuranceVerdict(rework, s);
		expect(first.findings?.[0].id).toBe(`review-${snapshotDigest(s).slice(7, 19)}-1-r-1`);
		expect(first.findings?.[0].findings_digest).toMatch(/^sha256:/);
		expect(first.findings?.[0].anchor).toMatch(/^sha256:[a-f0-9]{64}$/);
		const reworkObject = JSON.parse(rework);
		expect(parseAssuranceVerdict({ ...reworkObject, approval: null }, s).decision).toBe("rework");
		expect(() => parseAssuranceVerdict({ ...reworkObject, approval: { kind: "review" } }, s)).toThrow("rework verdict must omit approval");
		const nextSnapshot = snapshot({ record_revision: "sha256:" + "f".repeat(64) });
		const nextRework = rework.replaceAll(snapshotDigest(s), snapshotDigest(nextSnapshot));
		expect(parseAssuranceVerdict(nextRework, nextSnapshot).findings?.[0].id).not.toBe(first.findings?.[0].id);
		expect(() => parseAssuranceVerdict(passVerdict(s).replace('"role":"review"', '"role":"qa"'), s)).toThrow(/role mismatch/i);
		expect(() => parseAssuranceVerdict(passVerdict(s).replace(snapshotDigest(s), "sha256:" + "0".repeat(64)), s)).toThrow(/snapshot digest mismatch/i);
		expect(() => parseAssuranceVerdict(rework.replace('"summary":"broken"', '"summary":"broken","findings_digest":"forged"'), s)).toThrow(/unknown field/i);
	});

	test("review rework findings require evidence and reject an anchor they assert", () => {
		const s = snapshot();
		const withoutEvidence = JSON.parse(reworkVerdict(s)) as { findings: Array<Record<string, unknown>> };
		delete withoutEvidence.findings[0].evidence;
		expect(() => parseAssuranceVerdict(JSON.stringify(withoutEvidence), s)).toThrow(/evidence is required/);
		expect(() => parseAssuranceVerdict(reworkVerdict(s, { ...REVIEW_EVIDENCE, caller_chain: [] }), s)).toThrow(/caller_chain/);
		expect(() => parseAssuranceVerdict(reworkVerdict(s, { ...REVIEW_EVIDENCE, trigger: "  " }), s)).toThrow(/trigger/);
		expect(() => parseAssuranceVerdict(reworkVerdict(s, { ...REVIEW_EVIDENCE, violated: { kind: "other", ref: "A1" } }), s)).toThrow(/violated.kind/);
		expect(() => parseAssuranceVerdict(reworkVerdict(s, { ...REVIEW_EVIDENCE, anchor: "sha256:" + "0".repeat(64) }), s)).toThrow(/unknown field/);
		// QA-role rework verdicts keep the pre-extension finding contract.
		const qa = snapshot({ role: "qa" });
		const qaVerdict = JSON.stringify({
			contract: "assurance_kernel/assurance_verdict/v2",
			role: "qa",
			task_id: qa.task_id,
			snapshot_digest: snapshotDigest(qa),
			decision: "rework",
			findings: [{ id: "q-1", kind: "blocking", acceptance_id: "A1", summary: "failed" }],
		});
		expect(parseAssuranceVerdict(qaVerdict, qa).decision).toBe("rework");
		const qaWithEvidence = JSON.stringify({
			contract: "assurance_kernel/assurance_verdict/v2",
			role: "qa",
			task_id: qa.task_id,
			snapshot_digest: snapshotDigest(qa),
			decision: "rework",
			findings: [{ id: "q-1", kind: "blocking", acceptance_id: "A1", summary: "failed", evidence: REVIEW_EVIDENCE }],
		});
		expect(() => parseAssuranceVerdict(qaWithEvidence, qa)).toThrow(/unknown field/);
	});

	test("both host adapters forward the derived anchor and evidence into findingsDigestV2", () => {
		const s = snapshot();
		const parsed = parseAssuranceVerdict(reworkVerdict(s), s);
		const findings = reviewReworkFindings(parsed);
		expect(findings[0]).toMatchObject({ anchor: parsed.findings?.[0].anchor, evidence: { ...REVIEW_EVIDENCE } });
		const digest = findingsDigestV2(findings as never[]);
		expect(digest).toBe(findingsDigestV2(findings as never[]));
		expect(digest).not.toBe(findingsDigestV2([{ ...findings[0], anchor: "sha256:" + "0".repeat(64) }] as never[]));
		expect(digest).not.toBe(findingsDigestV2([{ ...findings[0], evidence: { ...REVIEW_EVIDENCE, caller_chain: ["other"] } }] as never[]));
		// Anchors are derived, not asserted: the same evidence yields one stable
		// anchor and a different violated identity or caller chain yields another.
		const otherAnchor = parseAssuranceVerdict(reworkVerdict(s, { ...REVIEW_EVIDENCE, caller_chain: ["other"] }), s).findings?.[0].anchor;
		expect(otherAnchor).not.toBe(parsed.findings?.[0].anchor);
	});

	test("buildReviewPrompt states the evidence contract without disclosing prior findings", () => {
		const prompt = buildReviewPrompt(snapshot());
		expect(prompt).toContain("evidence.trigger");
		expect(prompt).toContain("caller_chain");
		expect(prompt).toContain("security_boundary");
		expect(prompt).not.toContain("counterevidence");
		expect(prompt).not.toContain("refuted");
	});

	test("deterministic QA runs fixed descriptors without executor-authored evidence", async () => {
		const root = mkdtempSync(join(tmpdir(), "canary-qa-"));
		try {
			const runner = resolveBunRunner();
			const s = snapshot({ root, role: "qa", acceptance: [{ id: "A1", assertion: "passes", verification: "descriptor" }] });
			const passed = await runDeterministicQa(s, new Map([["A1", descriptor(["-e", "1"])]]), runner);
			expect(passed.decision).toBe("pass");
			const withoutExecutorEvidence = await runDeterministicQa(
				snapshot({ ...s, missing_acceptance_ids: ["A1"], fresh_acceptance_ids: [] }),
				new Map([["A1", descriptor(["-e", "1"])]]),
				runner,
			);
			expect(withoutExecutorEvidence.decision).toBe("pass");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
