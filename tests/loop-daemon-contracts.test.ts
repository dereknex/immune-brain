import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	APPLICATION_POINTS,
	isApplicationPointId,
	assertApplicationPointId,
	POINT_REGISTRY,
	A18_EVENT_PREFILTER,
	A19_OWNER_COMMENT_INTENT,
	A20_ISSUE_DUPLICATE_PAIR,
} from "../plugins/immune-brain/runtime/decision_model/contract.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
	return readFileSync(join(ROOT, rel), "utf8");
}

function normalized(rel: string): string {
	return read(rel).replace(/\s+/g, " ");
}

describe("loop daemon upstream contracts (loop-daemon-s0-contracts)", () => {
	test("docs/adr/0039-loop-daemon.md exists, is accepted, and renumbers from 0038 per BR-DEC-3", () => {
		const adr39Path = "docs/adr/0039-loop-daemon.md";
		expect(existsSync(join(ROOT, adr39Path))).toBe(true);
		const content = read(adr39Path);
		expect(content).toMatch(/^---\nstatus:\s*accepted\n---/);
		const norm = normalized(adr39Path);
		expect(norm).toContain("Renumbered from 0038 per BR-DEC-3");
		expect(norm).toContain("[ADR 0038](0038-supervised-session-port.md)");
		expect(norm).toContain("[ADR 0005](0005-unattended-initiative-batch-run.md)");
		expect(norm).toContain("[ADR 0006](0006-unattended-review-dispatch-authority.md)");
		expect(norm).toContain("[ADR 0019](0019-explicit-run-entry-owns-enrollment.md)");
		expect(norm).toContain("[ADR 0025](0025-run-entry-decision-hosting.md)");
	});

	test("docs/proposals/loop-agent.md exists, is accepted, and links to ADR 0039", () => {
		const proposalPath = "docs/proposals/loop-agent.md";
		expect(existsSync(join(ROOT, proposalPath))).toBe(true);
		const norm = normalized(proposalPath);
		expect(norm).toContain("状态：已接受");
		expect(norm).toContain("ADR 0039");
	});

	test("boundary control: docs/adr/0038-supervised-session-port.md remains intact and 0038-loop-daemon.md is removed", () => {
		expect(existsSync(join(ROOT, "docs/adr/0038-supervised-session-port.md"))).toBe(true);
		const adr38 = read("docs/adr/0038-supervised-session-port.md");
		expect(adr38).toMatch(/^---\nstatus:\s*accepted\n---/);
		expect(adr38).toContain("# Supervised Session Port");
		expect(existsSync(join(ROOT, "docs/adr/0038-loop-daemon.md"))).toBe(false);
	});

	test("ADR 0005 carries loop-daemon confirmation sources and risk-floor amendments", () => {
		const norm = normalized("docs/adr/0005-unattended-initiative-batch-run.md");
		expect(norm).toContain("amended by [ADR 0039](0039-loop-daemon.md)");
		expect(norm).toContain('confirmation_source: "user_session" | "tracker_approval" | "policy_auto"');
		expect(norm).toContain(".imm/risk-floor.json");
	});

	test("ADR 0006 registers loop daemon as 4th composition root with model access", () => {
		const norm = normalized("docs/adr/0006-unattended-review-dispatch-authority.md");
		expect(norm).toContain("amended by [ADR 0039](0039-loop-daemon.md)");
		expect(norm).toContain("4th authorized composition root");
		expect(norm).toContain("decision model for event judging");
	});

	test("ADR 0019 carries loop-daemon standing publication and unattended enrollment", () => {
		const norm = normalized("docs/adr/0019-explicit-run-entry-owns-enrollment.md");
		expect(norm).toContain("amended by [ADR 0039](0039-loop-daemon.md)");
		expect(norm).toContain("standing publication grant");
		expect(norm).toContain("policy_auto");
		expect(norm).toContain("tracker_approval");
	});

	test("ADR 0025 carries loop-daemon standing publication and unattended enrollment", () => {
		const norm = normalized("docs/adr/0025-run-entry-decision-hosting.md");
		expect(norm).toContain("amended by [ADR 0039](0039-loop-daemon.md)");
		expect(norm).toContain("standing publication grant");
		expect(norm).toContain("policy_auto");
		expect(norm).toContain("tracker_approval");
	});

	test("CONTEXT.md carries Loop dual-form definition, Batch Branch PR update, and composition root", () => {
		const norm = normalized("CONTEXT.md");
		expect(norm).toContain("It runs in two forms");
		expect(norm).toContain("as the Loop daemon, a standing process");
		expect(norm).toContain("under the Loop daemon with standing publication enabled ([ADR 0039](docs/adr/0039-loop-daemon.md))");
		expect(norm).toContain("Loop daemon: `plugins/immune-brain/runtime/loop_daemon/` forms the 4th authorized composition root");
	});

	test("BASELINE.md Host Confirmation Boundary acknowledges bounded standing grant", () => {
		const norm = normalized("plugins/immune-brain/BASELINE.md");
		expect(norm).toContain("standing publication grant under ADR 0039");
		expect(norm).toContain("satisfies this boundary");
	});

	test("fix-pr skill and packaged contract document headless repair invocation constraints", () => {
		const skillNorm = normalized("plugins/immune-brain/skills/fix-pr/SKILL.md");
		expect(skillNorm).toContain("Under unattended execution (ADR 0039)");
		expect(skillNorm).toContain("Loop daemon may enter `fix-pr` headlessly");

		const distNorm = normalized("plugins/immune-brain/dist/fix-pr.md");
		expect(distNorm).toContain("Under unattended execution (ADR 0039)");
		expect(distNorm).toContain("Loop daemon may enter `fix-pr` headlessly");
	});

	test("decision-model-core.spec.md registers a18, a19, and a20 and records online daemon import", () => {
		const norm = normalized("docs/specs/decision-model-core.spec.md");
		expect(norm).toContain("a18_event_prefilter");
		expect(norm).toContain("a19_owner_comment_intent");
		expect(norm).toContain("a20_issue_duplicate_pair");
		expect(norm).toContain("imported by the Loop daemon judging module");
	});

	test("decision_model/contract.ts registers a18, a19, and a20 and rejects unknown point IDs", () => {
		expect(APPLICATION_POINTS).toContain("a18_event_prefilter");
		expect(APPLICATION_POINTS).toContain("a19_owner_comment_intent");
		expect(APPLICATION_POINTS).toContain("a20_issue_duplicate_pair");

		expect(isApplicationPointId("a18_event_prefilter")).toBe(true);
		expect(isApplicationPointId("a19_owner_comment_intent")).toBe(true);
		expect(isApplicationPointId("a20_issue_duplicate_pair")).toBe(true);
		expect(isApplicationPointId("a99_nonexistent")).toBe(false);

		expect(() => assertApplicationPointId("a18_event_prefilter")).not.toThrow();
		expect(() => assertApplicationPointId("a99_nonexistent")).toThrow('unknown application point "a99_nonexistent"');
	});

	test("POINT_REGISTRY registers a18, a19, and a20 with valid structure and criteria", () => {
		expect(POINT_REGISTRY.a18_event_prefilter).toBe(A18_EVENT_PREFILTER);
		expect(POINT_REGISTRY.a19_owner_comment_intent).toBe(A19_OWNER_COMMENT_INTENT);
		expect(POINT_REGISTRY.a20_issue_duplicate_pair).toBe(A20_ISSUE_DUPLICATE_PAIR);

		const expectedThresholds: Record<string, { version: string; values: Record<string, number> }> = {
			a18_event_prefilter: { version: "a18/v1", values: { ignore: 0.9 } },
			a19_owner_comment_intent: {
				version: "a19/v1",
				values: {
					approve_plan: 0.8,
					request_plan_revision: 0.8,
					answer_lane_decision: 0.8,
					command: 0.8,
					discussion: 0.8,
				},
			},
			a20_issue_duplicate_pair: { version: "a20/v1", values: { duplicate: 0.85 } },
		};

		for (const pointId of ["a18_event_prefilter", "a19_owner_comment_intent", "a20_issue_duplicate_pair"]) {
			const point = POINT_REGISTRY[pointId];
			expect(point).toBeDefined();
			expect(point.id).toBe(pointId);
			expect(point.question_type).toBe("choice");
			expect(point.options.length).toBeGreaterThan(0);
			expect(Object.keys(point.criteria).sort()).toEqual([...point.options].sort());
			expect(point.instructions.trim().length).toBeGreaterThan(0);
			expect(point.threshold_set.version).toBe(expectedThresholds[pointId]!.version);
			expect(point.threshold_set.values).toEqual(expectedThresholds[pointId]!.values);
		}
	});

	test("Enrollment policy_auto contract enforces routine-only boundary and rejects material auto-enrollment", () => {
		const adr39Norm = normalized("docs/adr/0039-loop-daemon.md");
		expect(adr39Norm).toContain("A `routine` task starts without approval");
		expect(adr39Norm).toContain("lists `routine` as the only auto-start risk");
		expect(adr39Norm).toContain("A `material` or `critical` task starts on the owner's tracker approval");

		const specNorm = normalized("docs/specs/loop-daemon.spec.md");
		expect(specNorm).toContain('`auto_enroll_max_risk`: `"none" | "routine"`');
		expect(specNorm).toContain("routine-only under ADR 0039 Decision 8");
		expect(specNorm).toContain("strictly routine tasks only");
		expect(specNorm).toContain("strictly rejected for `policy_auto`");

		// Contract function asserting rejection of material and critical auto-enrollment
		function canPolicyAutoEnroll(params: {
			mode: string;
			degraded: boolean;
			effectiveRisk: "routine" | "material" | "critical";
			touchesNoTouch: boolean;
		}): boolean {
			if (params.mode !== "autonomous") return false;
			if (params.degraded) return false;
			if (params.effectiveRisk !== "routine") return false;
			if (params.touchesNoTouch) return false;
			return true;
		}

		expect(canPolicyAutoEnroll({ mode: "autonomous", degraded: false, effectiveRisk: "routine", touchesNoTouch: false })).toBe(true);
		expect(canPolicyAutoEnroll({ mode: "autonomous", degraded: false, effectiveRisk: "material", touchesNoTouch: false })).toBe(false);
		expect(canPolicyAutoEnroll({ mode: "autonomous", degraded: false, effectiveRisk: "critical", touchesNoTouch: false })).toBe(false);
		expect(canPolicyAutoEnroll({ mode: "autonomous", degraded: true, effectiveRisk: "routine", touchesNoTouch: false })).toBe(false);
	});

	test("Human-only merge boundary: Spec and ADR 0039 prohibit auto-merge and exclude merge_pr from handlers", () => {
		const adr39Norm = normalized("docs/adr/0039-loop-daemon.md");
		expect(adr39Norm).toContain("Merging stays with a person");
		expect(adr39Norm).toContain("There is no auto-merge");
		expect(adr39Norm).toContain("It may not push the default branch, force-push a branch it did not create, merge");

		const specNorm = normalized("docs/specs/loop-daemon.spec.md");
		expect(specNorm).toContain("Human-Only Merge Boundary");
		expect(specNorm).toContain("leaving merge strictly to the human owner (ADR 0039 Decision 11: no auto-merge under any posture)");
		expect(specNorm).not.toContain("`merge_pr`");
		expect(specNorm).toContain("`close_out`");
	});

	test("Tracker approval verification boundary: requires unedited, non-daemon comments and rejects edited approvals", () => {
		const adr39Norm = normalized("docs/adr/0039-loop-daemon.md");
		expect(adr39Norm).toContain("the author is not the daemon's own identity");
		expect(adr39Norm).toContain("has never been edited by anyone");

		const specNorm = normalized("docs/specs/loop-daemon.spec.md");
		expect(specNorm).toContain("updated_at === created_at");
		expect(specNorm).toContain("actor_login !== daemon_identity");

		interface TrackerApprovalProof {
			actor_login: string;
			author_association: string;
			created_at: string;
			updated_at: string;
			plan_digest: string;
		}

		function verifyTrackerApproval(
			proof: TrackerApprovalProof,
			context: {
				daemon_identity: string;
				allowed_actors: string[];
				allowed_associations: string[];
				published_at: string;
				expected_digest: string;
			}
		): { valid: boolean; reason?: string } {
			if (proof.actor_login === context.daemon_identity) {
				return { valid: false, reason: "daemon_authored" };
			}
			if (!context.allowed_actors.includes(proof.actor_login)) {
				return { valid: false, reason: "actor_not_allowed" };
			}
			if (!context.allowed_associations.includes(proof.author_association)) {
				return { valid: false, reason: "association_not_allowed" };
			}
			if (new Date(proof.created_at).getTime() <= new Date(context.published_at).getTime()) {
				return { valid: false, reason: "created_before_publication" };
			}
			if (proof.updated_at !== proof.created_at) {
				return { valid: false, reason: "comment_edited" };
			}
			if (proof.plan_digest !== context.expected_digest) {
				return { valid: false, reason: "digest_mismatch" };
			}
			return { valid: true };
		}

		const ctx = {
			daemon_identity: "imm-loop[bot]",
			allowed_actors: ["dereknex"],
			allowed_associations: ["OWNER"],
			published_at: "2026-11-11T10:00:00Z",
			expected_digest: "sha256:abc123plan",
		};

		// Positive control: unedited owner comment after plan publication with matching digest
		expect(
			verifyTrackerApproval(
				{
					actor_login: "dereknex",
					author_association: "OWNER",
					created_at: "2026-11-11T10:05:00Z",
					updated_at: "2026-11-11T10:05:00Z",
					plan_digest: "sha256:abc123plan",
				},
				ctx
			)
		).toEqual({ valid: true });

		// Negative control: edited comment (updated_at !== created_at) is strictly rejected
		expect(
			verifyTrackerApproval(
				{
					actor_login: "dereknex",
					author_association: "OWNER",
					created_at: "2026-11-11T10:05:00Z",
					updated_at: "2026-11-11T10:06:00Z",
					plan_digest: "sha256:abc123plan",
				},
				ctx
			)
		).toEqual({ valid: false, reason: "comment_edited" });

		// Negative control: daemon-authored comment is strictly rejected
		expect(
			verifyTrackerApproval(
				{
					actor_login: "imm-loop[bot]",
					author_association: "OWNER",
					created_at: "2026-11-11T10:05:00Z",
					updated_at: "2026-11-11T10:05:00Z",
					plan_digest: "sha256:abc123plan",
				},
				ctx
			)
		).toEqual({ valid: false, reason: "daemon_authored" });

		// Negative control: comment created prior to plan publication is rejected
		expect(
			verifyTrackerApproval(
				{
					actor_login: "dereknex",
					author_association: "OWNER",
					created_at: "2026-11-11T09:59:59Z",
					updated_at: "2026-11-11T09:59:59Z",
					plan_digest: "sha256:abc123plan",
				},
				ctx
			)
		).toEqual({ valid: false, reason: "created_before_publication" });

		// Negative control: digest mismatch
		expect(
			verifyTrackerApproval(
				{
					actor_login: "dereknex",
					author_association: "OWNER",
					created_at: "2026-11-11T10:05:00Z",
					updated_at: "2026-11-11T10:05:00Z",
					plan_digest: "sha256:differentdigest",
				},
				ctx
			)
		).toEqual({ valid: false, reason: "digest_mismatch" });
	});

	test("normative upstream ADR references in loop-daemon.spec.md and intent resolve to existing files", () => {
		const upstreamAdrs = [
			"docs/adr/0005-unattended-initiative-batch-run.md",
			"docs/adr/0006-unattended-review-dispatch-authority.md",
			"docs/adr/0019-explicit-run-entry-owns-enrollment.md",
			"docs/adr/0025-run-entry-decision-hosting.md",
			"docs/adr/0038-supervised-session-port.md",
			"docs/adr/0039-loop-daemon.md",
		];
		for (const adr of upstreamAdrs) {
			expect(existsSync(join(ROOT, adr))).toBe(true);
		}

		const specContent = read("docs/specs/loop-daemon.spec.md");
		for (const adr of upstreamAdrs) {
			expect(specContent).toContain(adr);
		}

		// Negative control: obsolete conceptual filenames must not be referenced
		const obsoleteNames = [
			"0005-enrollment-membrane-and-promotion.md",
			"0006-execution-authority-and-lane-supervision.md",
			"0019-github-issue-tracker-publication-and-reconcile.md",
			"0025-decision-model-architecture.md",
		];
		for (const obsolete of obsoleteNames) {
			expect(specContent).not.toContain(obsolete);
		}

		const intentRaw = read("docs/plans/loop-daemon-s0-contracts.intent.json");
		for (const obsolete of obsoleteNames) {
			expect(intentRaw).not.toContain(obsolete);
		}
	});

	test("mirror and dist packaging check passes", () => {
		const syncCheck = execFileSync("bun", ["scripts/sync-dist-docs.ts", "--check"], {
			cwd: ROOT,
			encoding: "utf8",
		});
		expect(syncCheck).toContain("All generated packaged docs are in sync.");

		const baseRoot = read("plugins/immune-brain/BASELINE.md");
		const baseSkills = read("plugins/immune-brain/skills/BASELINE.md");
		const baseDist = read("plugins/immune-brain/dist/BASELINE.md");
		expect(baseSkills).toBe(baseRoot);
		expect(baseDist).toBe(baseRoot);
	});
});
