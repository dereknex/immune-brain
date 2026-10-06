import { afterAll, describe, expect, mock, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The Kernel QA delivery workspace is a dependency-free checkout, so `typebox`
// belongs to the running Host rather than to this tree. Register the seam only
// when the real package cannot be imported here, so an ordinary suite run keeps
// it, and clear the registry afterwards so no Host-facing sibling test file in
// the same process inherits the mock.
try { await import("typebox"); } catch {
	const optional = Symbol("optional");
	mock.module("typebox", () => ({ Type: {
		Array: (items: object) => ({ type: "array", items }),
		Boolean: () => ({ type: "boolean" }),
		Literal: (value: unknown) => ({ const: value }),
		Null: () => ({ type: "null" }),
		Number: () => ({ type: "number" }),
		Object: (properties: Record<string, unknown>, options: Record<string, unknown> = {}) => ({
			type: "object", properties,
			required: Object.entries(properties).filter(([, value]) => !value[optional]).map(([key]) => key),
			...options,
		}),
		Optional: (schema: Record<string, unknown>) => ({ ...schema, [optional]: true }),
		Record: (_key: object, value: object) => ({ type: "object", additionalProperties: value }),
		String: (options: object = {}) => ({ type: "string", ...options }),
		Union: (anyOf: object[]) => ({ anyOf }),
		Unknown: () => ({}),
	} }));
}
// `imm-canary-work` also loads `pi-canary-assurance`, which imports the Pi host
// UI packages. Seam them under the same condition, for the same reason.
try { await import("@earendil-works/pi-coding-agent"); } catch {
	class DynamicBorder {
		constructor(private style: (text: string) => string) {}
		render(width: number) { return [this.style("─".repeat(Math.max(0, width)))]; }
	}
	mock.module("@earendil-works/pi-coding-agent", () => ({ DynamicBorder }));
}
try { await import("@earendil-works/pi-tui"); } catch {
	class Text {
		constructor(private text: string) {}
		setText(text: string) { this.text = text; }
		render() { return this.text.split("\n"); }
		invalidate() {}
	}
	class Container {
		private children: Array<{ render(width: number): string[] }> = [];
		addChild(child: { render(width: number): string[] }) { this.children.push(child); }
		render(width: number) { return this.children.flatMap((child) => child.render(width)); }
		invalidate() { for (const child of this.children) (child as { invalidate?: () => void }).invalidate?.(); }
	}
	class SelectList {
		onSelect?: (item: unknown) => void;
		onCancel?: () => void;
		private selected = 0;
		constructor(private items: Array<{ label: string }>) {}
		render() { return this.items.map((item, index) => `${index === this.selected ? "> " : "  "}${item.label}`); }
		handleInput(input: string) {
			if (input === "\u001b[B") this.selected = Math.min(this.items.length - 1, this.selected + 1);
			else if (input === "\u001b[A") this.selected = Math.max(0, this.selected - 1);
			else if (input === "\r") this.onSelect?.(this.items[this.selected]!);
			else if (input === "\u001b") this.onCancel?.();
		}
	}
	mock.module("@earendil-works/pi-tui", () => ({
		Container, SelectList, Text,
		sliceByColumn: (text: string, start: number, width?: number) => text.slice(start, width === undefined ? undefined : start + width),
		truncateToWidth: (text: string, width: number, marker = "") => text.length <= width ? text : `${text.slice(0, Math.max(0, width - marker.length))}${marker}`,
		visibleWidth: (text: string) => text.length,
	}));
}
afterAll(() => mock.restore());

const {
	buildSnapshot,
	snapshotDigest,
	buildReviewPrompt,
	parseAssuranceVerdict,
	reviewReworkFindings,
} = await import("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
type SnapshotDescriptor = import("../plugins/immune-brain/runtime/assurance/host_port").SnapshotDescriptor;
import { findingsDigestV2 } from "../plugins/immune-brain/runtime/kernel/reducer";
import { runDeterministicQa } from "../plugins/immune-brain/runtime/assurance/qa";
import {
	parseVerificationDescriptor,
	runFixedVerification,
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
			// A review pass claims the reviewed change set (BR-DEC-3); QA never carries it.
			...(s.role === "review" ? { inspected_paths: [...s.dirty_files] } : {}),
		},
	});
}

function descriptor(argv: string[]): VerificationDescriptor {
	return parseVerificationDescriptor(
		JSON.stringify({
			contract: "assurance_kernel/verification_descriptor/v2",
			command: { executable: "bun", argv, cwd: ".", timeout_ms: 30000, max_output_bytes: 8192 },
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
		expect(prompt).toContain('"inspected_paths"');
		expect(prompt).toContain("A path may be listed only after its diff was read");
		expect(prompt).toContain("deleted paths included");
		expect(prompt).not.toContain("counterevidence");
		expect(prompt).not.toContain("refuted");
	});

	test("a review pass must claim the whole reviewed change set", () => {
		const s = snapshot();
		const verdict = (paths: unknown) => {
			const base = JSON.parse(passVerdict(s)) as { approval: Record<string, unknown> };
			if (paths === undefined) delete base.approval.inspected_paths;
			else base.approval.inspected_paths = paths;
			return JSON.stringify(base);
		};

		// Positive: the exact change set settles, and the field is checked but not
		// carried into the Kernel approval.
		const parsed = parseAssuranceVerdict(verdict(["src/new.ts"]), s);
		expect(parsed.decision).toBe("pass");
		expect(parsed.approval).toEqual({ kind: "review", authority_role: "reviewer", summary: "verified" });

		// Every rejection names the offending paths and is a parse failure, which
		// the coordinator reports as verdict_invalid while keeping the reservation.
		expect(() => parseAssuranceVerdict(verdict(undefined), s)).toThrow(/inspected_paths is required/);
		expect(() => parseAssuranceVerdict(verdict([]), s)).toThrow(/omits reviewed changed paths: src\/new\.ts/);
		expect(() => parseAssuranceVerdict(verdict("src/new.ts"), s)).toThrow(/must be an array of repository-relative path strings/);
		expect(() => parseAssuranceVerdict(verdict(["src/new.ts", 7]), s)).toThrow(/must be an array of repository-relative path strings/);
		expect(() => parseAssuranceVerdict(verdict(["src/new.ts", "src/new.ts"]), s)).toThrow(/lists a duplicate path: src\/new\.ts/);
		expect(() => parseAssuranceVerdict(verdict(["src/new.ts", "src/outside.ts"]), s)).toThrow(/outside the reviewed change set: src\/outside\.ts/);

		// A deleted path is part of the required set, not something to omit.
		const withDeletion = snapshot({ dirty_files: ["src/new.ts", "src/old.ts"] });
		expect(() => parseAssuranceVerdict(
			JSON.stringify({ ...JSON.parse(passVerdict(withDeletion)), approval: { kind: "review", authority_role: "reviewer", summary: "verified", inspected_paths: ["src/new.ts"] } }),
			withDeletion,
		)).toThrow(/omits reviewed changed paths: src\/old\.ts/);
		expect(parseAssuranceVerdict(
			JSON.stringify({ ...JSON.parse(passVerdict(withDeletion)), approval: { kind: "review", authority_role: "reviewer", summary: "verified", inspected_paths: ["src/new.ts", "src/old.ts"] } }),
			withDeletion,
		).decision).toBe("pass");

		// An empty change set is claimed as an empty list.
		const empty = snapshot({ dirty_files: [] });
		expect(parseAssuranceVerdict(
			JSON.stringify({ ...JSON.parse(passVerdict(empty)), approval: { kind: "review", authority_role: "reviewer", summary: "verified", inspected_paths: [] } }),
			empty,
		).decision).toBe("pass");
	});

	test("QA passes and rework verdicts still reject the field as unknown", () => {
		const qa = snapshot({ role: "qa" });
		expect(parseAssuranceVerdict(passVerdict(qa), qa).decision).toBe("pass");
		const withPaths = JSON.parse(passVerdict(qa)) as { approval: Record<string, unknown> };
		withPaths.approval.inspected_paths = ["src/new.ts"];
		expect(() => parseAssuranceVerdict(JSON.stringify(withPaths), qa)).toThrow(/unknown field: inspected_paths/);
		// A rework verdict keeps its shape: findings, no approval, and no path list.
		const rework = JSON.parse(reworkVerdict(snapshot())) as Record<string, unknown>;
		const reviewRework = { ...rework, approval: { kind: "review", authority_role: "reviewer", summary: "x", inspected_paths: [] } };
		expect(() => parseAssuranceVerdict(JSON.stringify(reviewRework), snapshot())).toThrow(/rework verdict must omit approval/);
		delete (reviewRework as Record<string, unknown>).approval;
		expect(parseAssuranceVerdict(JSON.stringify(reviewRework), snapshot()).decision).toBe("rework");
	});

	test("deterministic QA runs fixed descriptors without executor-authored evidence", async () => {
		const root = mkdtempSync(join(tmpdir(), "canary-qa-"));
		try {
			execFileSync("git", ["init", "-q"], { cwd: root });
			execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
			execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
			execFileSync("git", ["commit", "--allow-empty", "-qm", "base"], { cwd: root });
			const s = snapshot({ root, role: "qa", acceptance: [{ id: "A1", assertion: "passes", verification: "descriptor" }] });
			const options = {
				_writeDeliveryTree: () => "0".repeat(40),
				_materializeDeliveryWorkspace: () => ({ root, tree: "0".repeat(40), seal: "[]", cleanup: () => undefined }),
				_runFixedVerification: runFixedVerification,
			} as const;
			const passed = await runDeterministicQa(s, new Map([["A1", descriptor(["-e", "1"])]]), {
				...options,
			});
			expect(passed.decision).toBe("pass");
			const withoutExecutorEvidence = await runDeterministicQa(
				snapshot({ ...s, missing_acceptance_ids: ["A1"], fresh_acceptance_ids: [] }),
				new Map([["A1", descriptor(["-e", "1"])]]),
				options,
			);
			expect(withoutExecutorEvidence.decision).toBe("pass");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
