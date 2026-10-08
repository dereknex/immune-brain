// S3 of docs/specs/workflow-decision-closure.spec.md: authoritative recovery
// consumer.
//
// Layer 1: the canonical Loop contract makes recovery bind to Kernel authority
// facts rather than prose.
// Layer 2: the recovery decision that contract describes is decisive — a
// summary claiming an advanced lifecycle stage does not create authority, the
// stages stay distinct, a successful operation's fresh projection is consumed
// without a redundant status read, and a false later-Slice enrollment retains
// the real owner with no mutation, gate, or completion replay.
//
// The resume helper below is a mock-evidence model of the documented rule, not
// a runtime authority check: nothing in production calls it. It exists so the
// contract has an executable negative control instead of a phrase-presence
// assertion over the prose alone.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const flat = (text: string) => text.replace(/\s+/g, " ");

const LOOP = read("plugins/immune-brain/dist/imm-run.md");
const LOOP_LOADER = read("plugins/immune-brain/skills/imm-run/SKILL.md");
const H1 = read("docs/reports/workflow-summary-host-followup.md");

/** Lifecycle stages that a Managed workflow distinguishes; none implies another. */
type Stage = "authored" | "validated" | "published" | "enrolled" | "assured" | "completed";

/** The facts the Kernel projection actually proves, per stage. */
interface AuthorityFacts {
	task_id: string;
	run_id: string;
	lifecycle: "active" | "done" | "stopped";
	artifact_state: "active" | "frozen";
	claim: string | null;
	/** Stages the projection proves by evidence. */
	proven_stages: Stage[];
	next_obligation: string;
	/** Sibling tasks the same Initiative already published, with their own proven stages. */
	siblings: Array<{ task_id: string; run_id: string | null; proven_stages: Stage[] }>;
}

/** One stage claim a summary makes about a specific task. */
interface SummaryClaim {
	task_id: string;
	stage: Stage;
}

interface ResumePlan {
	/** The owner the recovery actually resumes. */
	owner_task_id: string | null;
	/** Mutations, gates, or completions the recovery would replay. */
	replayed_effects: string[];
	/** Stage claims that were reported from a summary instead of evidence. */
	corrected_claims: string[];
}

/**
 * Resume from authority facts. A summary may claim any stage for any task; only
 * the evidence actually held for that task may be reported as reached. A claim
 * about another task's stage is corrected prose, never a reason to adopt that
 * task as owner, enroll it, replay a gate, or complete anything.
 */
function resumeFromAuthority(
	facts: AuthorityFacts,
	claims: readonly SummaryClaim[],
): ResumePlan {
	const provenByTask = new Map<string, Set<Stage>>([
		[facts.task_id, new Set(facts.proven_stages)],
		...facts.siblings.map((sibling) => [sibling.task_id, new Set(sibling.proven_stages)] as const),
	]);
	const corrected: string[] = [];
	for (const claim of claims) {
		const proven = provenByTask.get(claim.task_id);
		if (!proven?.has(claim.stage)) {
			corrected.push(`summary claimed ${claim.task_id} was ${claim.stage} without evidence`);
		}
	}
	// The owner is the projection's task, never a summary-implied successor.
	const owner = facts.lifecycle === "active" ? facts.task_id : null;
	return { owner_task_id: owner, replayed_effects: [], corrected_claims: corrected };
}

/**
 * Where the next action comes from. A successful operation returns a fresh
 * projection: consume it and do not add another status read. Only an
 * interruption, ambiguous mutation, absent projection, or suspected external
 * change justifies a fresh read.
 */
function recoveryReadPlan(input: {
	operationReturnedProjection: boolean;
	interrupted: boolean;
	ambiguousMutation: boolean;
	suspectedExternalChange: boolean;
}): { reads: number; reason: string } {
	if (input.operationReturnedProjection && !input.interrupted && !input.ambiguousMutation && !input.suspectedExternalChange) {
		return { reads: 0, reason: "consume the fresh projection returned by the successful operation" };
	}
	return { reads: 1, reason: "a fresh status read is required before resuming" };
}

describe("S3 authoritative recovery consumer", () => {
	test("Loop binds recovery to Kernel authority facts, not prose", () => {
		const contract = flat(LOOP);
		for (const fragment of [
			"Resume from authority facts, not prose",
			"After an uncertain interruption, bind the exact `task_id`, `run_id`, record revision, lifecycle, artifact state, obligation, and claim from the Kernel projection before acting",
			"A compaction heading, a Handoff summary, an Issue state, or any other prose summary is not authority",
			"when it conflicts with the projection, correct the prose and resume the existing owner instead of trusting the summary",
			"The workflow stages are distinct and never inferred from one another: authored, validated, published, enrolled, assured, and completed each require their own evidence",
			"An open or closed Issue is not Enrollment or completion; a published Issue is not Enrollment; a plan-only delivery is not execution readiness",
			"Consume a successful operation's fresh projection directly",
			"Do not add a status read after an operation that already returned the current projection",
			"never repeat a mutation merely to re-observe its result",
			"Kernel CAS and freshness checks remain mandatory",
			"A falsely claimed later-Slice enrollment is a summary defect, not authority",
			"Retain the actual owner, and do not create or replay a mutation, gate, or completion to match the prose",
			"Summary production outside this repository is not locally fixed",
			"a producer bug is recorded as a separate follow-up rather than resolved here",
		]) {
			expect(contract).toContain(fragment);
		}
		// The pre-existing read-discipline and ownership rules are preserved.
		expect(contract).toContain(
			"Use the fresh projection returned by a successful operation when supplied",
		);
		expect(contract).toContain("Read `status` after interruption, ambiguous mutation results, absent projections, or suspected external changes");
		expect(contract).toContain("Do not poll or create detached jobs");
		expect(contract).not.toContain("imm-autowork");
	});

	test("Loop submits a rework verdict before editing and reports evidence-based exits", () => {
		const contract = flat(LOOP);
		expect(contract).toContain(
			"Submit the rework verdict first, then edit",
		);
		expect(contract).toContain(
			"staging an in-scope change while the artifacts are frozen invalidates the snapshot and discards that verdict",
		);
		expect(contract).toContain(
			"Every line reports authority evidence, not prose inference",
		);
		expect(contract).toContain(
			"If a summary claimed more than the projection proves",
		);
		// Exit summary shape is unchanged.
		for (const line of ["Task:", "Completed work:", "QA:", "Review:", "Stop reason:", "Next action:"]) {
			expect(LOOP).toContain(line);
		}
	});

	test("the Loop loader routes recovery to the authority rules", () => {
		const loader = flat(LOOP_LOADER);
		expect(loader).toContain(
			"Resume only from those authority facts",
		);
		expect(loader).toContain(
			"a compaction heading, HANDOFF summary, or Issue state is prose, never authority",
		);
		expect(loader).toContain(
			"Rework submits the verdict before editing, and an uncertain interruption resumes from exact task/run authority facts rather than a summary",
		);
		expect(loader).not.toMatch(/^## /m);
	});

	test("a summary claiming a later Slice as enrolled creates no authority", () => {
		// The audited shape: slice-1 is really enrolled and still active, while the
		// sibling Slices were only authored/published; the compaction heading
		// claims the later Slices enrolled and the Initiative complete.
		const facts: AuthorityFacts = {
			task_id: "slice-1",
			run_id: "run-1",
			lifecycle: "active",
			artifact_state: "active",
			claim: "slice-1",
			proven_stages: ["authored", "validated", "published", "enrolled"],
			next_obligation: "submit_assurance",
			siblings: [
				{ task_id: "slice-2", run_id: null, proven_stages: ["authored", "validated", "published"] },
				{ task_id: "slice-3", run_id: null, proven_stages: ["authored", "validated", "published"] },
			],
		};
		const plan = resumeFromAuthority(facts, [
			{ task_id: "slice-1", stage: "enrolled" },
			{ task_id: "slice-2", stage: "enrolled" },
			{ task_id: "slice-3", stage: "enrolled" },
			{ task_id: "slice-1", stage: "completed" },
		]);
		// The actual owner is retained and nothing is created, replayed, or completed.
		expect(plan.owner_task_id).toBe("slice-1");
		expect(plan.replayed_effects).toEqual([]);
		expect(plan.corrected_claims).toEqual([
			"summary claimed slice-2 was enrolled without evidence",
			"summary claimed slice-3 was enrolled without evidence",
			"summary claimed slice-1 was completed without evidence",
		]);
		// slice-1's own enrolled claim is evidence-backed and is not corrected.
		expect(plan.corrected_claims.join("\n")).not.toContain("slice-1 was enrolled");
	});

	test("a summary cannot promote a sibling to owner or replay its gate", () => {
		const facts: AuthorityFacts = {
			task_id: "slice-1",
			run_id: "run-1",
			lifecycle: "active",
			artifact_state: "frozen",
			claim: "slice-1",
			proven_stages: ["authored", "validated", "published", "enrolled", "assured"],
			next_obligation: "run_review",
			siblings: [{ task_id: "slice-2", run_id: null, proven_stages: ["authored"] }],
		};
		// A summary that names slice-2 as the enrolled owner must not redirect recovery.
		const plan = resumeFromAuthority(facts, [{ task_id: "slice-2", stage: "enrolled" }]);
		expect(plan.owner_task_id).toBe("slice-1");
		expect(plan.replayed_effects).toEqual([]);
		expect(plan.corrected_claims).toEqual(["summary claimed slice-2 was enrolled without evidence"]);
	});

	test("stages never imply one another", () => {
		const authored: AuthorityFacts = {
			task_id: "t",
			run_id: "r",
			lifecycle: "active",
			artifact_state: "active",
			claim: "t",
			proven_stages: ["authored", "validated", "published"],
			next_obligation: "enroll",
			siblings: [],
		};
		// Published is not enrolled; enrolling is still owed.
		expect(resumeFromAuthority(authored, [{ task_id: "t", stage: "enrolled" }]).corrected_claims).toEqual([
			"summary claimed t was enrolled without evidence",
		]);
		expect(authored.next_obligation).toBe("enroll");

		const done: AuthorityFacts = {
			task_id: "t",
			run_id: "r",
			lifecycle: "done",
			artifact_state: "frozen",
			claim: null,
			proven_stages: ["authored", "validated", "published", "enrolled", "assured", "completed"],
			next_obligation: "none",
			siblings: [],
		};
		expect(resumeFromAuthority(done, [{ task_id: "t", stage: "completed" }]).owner_task_id).toBeNull();
	});

	test("a successful operation's fresh projection is consumed without another read", () => {
		expect(
			recoveryReadPlan({
				operationReturnedProjection: true,
				interrupted: false,
				ambiguousMutation: false,
				suspectedExternalChange: false,
			}).reads,
		).toBe(0);
		for (const reason of ["interrupted", "ambiguousMutation", "suspectedExternalChange"] as const) {
			const input = {
				operationReturnedProjection: true,
				interrupted: false,
				ambiguousMutation: false,
				suspectedExternalChange: false,
				[reason]: true,
			};
			expect(recoveryReadPlan(input).reads).toBe(1);
		}
		expect(
			recoveryReadPlan({
				operationReturnedProjection: false,
				interrupted: false,
				ambiguousMutation: false,
				suspectedExternalChange: false,
			}).reads,
		).toBe(1);
	});

	test("the H1 follow-up is sanitized and keeps production external", () => {
		expect(H1).toContain("prepared, not filed");
		expect(H1).toContain("producer-side summary defect in the external Host");
		expect(H1).toContain("not in this repository");
		expect(H1).toContain("Do not patch project prompts");
		expect(H1).toContain(
			"Closure requires an externally verifiable upstream fix or release",
		);
		// Sanitized: no raw payloads, credentials, or personal paths.
		expect(H1).not.toMatch(/sk-[A-Za-z0-9]/);
		expect(H1).not.toMatch(/\/Users\//);
		expect(H1).not.toMatch(/session[_-]?id/i);
	});
});
