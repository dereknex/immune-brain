// S4 of docs/specs/workflow-decision-closure.spec.md: verification by invariant
// and environment.
//
// Layer 1: the canonical Planner contract and the packaged QA/Review role
// prompts require an acceptance-to-invariant mapping with positive, negative,
// and bound controls, explicit prerequisite provenance, preparation/cleanup
// ownership, and the zero-match/skipped/prerequisite-absent failure rule.
// Layer 2: the descriptor gate those contracts describe is decisive — a
// descriptor with no negative control for its invariant, an absent prerequisite,
// a zero-match required check, or a skipped required check fails, while a
// complete descriptor passes.
//
// The gate below is a mock-evidence model of the documented rule, not a runtime
// check: nothing in production calls it, and the strict descriptor parser in
// runtime/verification_descriptor.ts is unchanged. It exists so the contract has
// a decisive control over the six motivating invariant classes instead of a
// phrase-presence assertion.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const flat = (text: string) => text.replace(/\s+/g, " ");

const PLANNER = read("plugins/immune-brain/dist/imm-planner.md");
const QA = read("plugins/immune-brain/runtime/prompts/qa.md");
const QA_MIRROR = read("plugins/immune-brain/dist/role-prompts/qa.md");
const REVIEW = read("plugins/immune-brain/runtime/prompts/code-review.md");
const REVIEW_MIRROR = read("plugins/immune-brain/dist/role-prompts/code-review.md");

/**
 * The six generalized motivating invariant classes from the audited sessions.
 * They are workflow-quality fixture inputs; none of them edits an original
 * application.
 */
type InvariantClass =
	| "normalization_to_retrieval"
	| "validation_before_merge"
	| "whole_lifecycle_deadline"
	| "missing_embedding_ranking"
	| "serialized_request_budget"
	| "duration_evidence";

/** What a control observes. `bound` is a boundary/limit control. */
type ControlKind = "positive" | "negative" | "bound";

/** Where a required prerequisite comes from. */
type PrerequisiteProvenance = "qa_host" | "tracked_delivery" | "absent";

interface InvariantSpec {
	invariant: InvariantClass;
	/** Controls the descriptor names for this invariant. */
	controls: ControlKind[];
	/** Provenance of every prerequisite the check needs. */
	prerequisites: PrerequisiteProvenance[];
	/** Required checks that actually matched at least one test. */
	required_checks_matched: number;
	/** Required checks the runner skipped. */
	required_checks_skipped: number;
	/** Explicit setup the check declares, if any. */
	preparation: string | null;
	/** Cleanup declared for failure and interruption. */
	cleanup: string | null;
	/** Evidence class this descriptor can assert. */
	evidence: "automated_behavior" | "automated_geometry" | "human_motion_quality";
}

interface VerificationVerdict {
	ok: boolean;
	failures: string[];
}

/**
 * The descriptor gate. A control set must include a positive, a negative, and a
 * bound control for the invariant: the happy path alone never proves a guard,
 * and the boundary/limit behavior is a third distinct claim. Every prerequisite
 * must have real provenance, and the run must have matched at least one test
 * with nothing skipped. Preparation and cleanup are required whenever the
 * descriptor declares preparation. A human judgment claim is never satisfied by
 * an automated descriptor.
 */
function judgeDescriptor(spec: InvariantSpec): VerificationVerdict {
	const failures: string[] = [];
	const kinds = new Set(spec.controls);
	if (!kinds.has("positive")) {
		failures.push(`${spec.invariant}: no positive control`);
	}
	if (!kinds.has("negative")) {
		failures.push(`${spec.invariant}: no negative control for the invariant`);
	}
	if (!kinds.has("bound")) {
		failures.push(`${spec.invariant}: no bound control for the invariant`);
	}
	for (const provenance of spec.prerequisites) {
		if (provenance === "absent") {
			failures.push(`${spec.invariant}: a required prerequisite is absent`);
		}
	}
	if (spec.required_checks_matched < 1) {
		failures.push(`${spec.invariant}: a required check matched zero tests`);
	}
	if (spec.required_checks_skipped > 0) {
		failures.push(`${spec.invariant}: a required check was skipped`);
	}
	if (spec.preparation && !spec.cleanup) {
		failures.push(`${spec.invariant}: declared preparation has no cleanup`);
	}
	if (spec.evidence === "human_motion_quality") {
		failures.push(`${spec.invariant}: human motion quality cannot be asserted by a descriptor`);
	}
	return { ok: failures.length === 0, failures };
}

const complete = (invariant: InvariantClass): InvariantSpec => ({
	invariant,
	controls: ["positive", "negative", "bound"],
	prerequisites: ["qa_host"],
	required_checks_matched: 2,
	required_checks_skipped: 0,
	preparation: null,
	cleanup: null,
	evidence: "automated_behavior",
});

const SIX: InvariantClass[] = [
	"normalization_to_retrieval",
	"validation_before_merge",
	"whole_lifecycle_deadline",
	"missing_embedding_ranking",
	"serialized_request_budget",
	"duration_evidence",
];

describe("S4 verification by invariant and environment", () => {
	test("Planner maps acceptance to positive, negative, and bound controls", () => {
		const contract = flat(PLANNER);
		for (const fragment of [
			"**Acceptance-to-invariant mapping.** Trace each acceptance assertion to an observable invariant at a real seam, then name the positive, negative, and bound controls that exercise it",
			"Name the controls explicitly instead of relying on the happy path: a happy path alone never proves a guard",
			"The six generalized motivating classes to check for are",
			"normalization precedes retrieval",
			"validation precedes merge",
			"the deadline covers the whole lifecycle including cleanup",
			"ranking tolerates missing embeddings",
			"the budget covers the complete serialized request",
			"each success, failure, and timeout outcome carries its own duration evidence",
			"workflow-quality input patterns, not requests to edit the original applications that motivated the audit",
		]) {
			expect(contract).toContain(fragment);
		}
	});

	test("Planner states prerequisite provenance, preparation, and cleanup ownership", () => {
		const contract = flat(PLANNER);
		for (const fragment of [
			"**Environment and prerequisite discipline.** A descriptor that needs a prerequisite states its provenance and how it is obtained",
			"Preparation must not hide a download, credential use, production write, or system change",
			"Require cleanup on failure and interruption, and restoration of any explicitly authorized setting",
			"An absent dependency, a missing simulator, or a preparation failure is a failed check, not a pass",
			"Zero matched checks and skipped required checks are failures",
			"a required check that selects no test, or that is skipped, must fail the acceptance rather than silently succeed",
			"Separate automated behavioral or geometry evidence from human judgment of motion quality",
			"Textual presence in a contract string is not proof that a provider obeyed it, and structural Enrollment readiness is not proof that a descriptor executed",
		]) {
			expect(contract).toContain(fragment);
		}
		// The pre-existing descriptor discipline is preserved.
		expect(contract).toContain("environment.prepare");
		expect(contract).toContain("environment.writable_paths");
		expect(contract).toContain("A dependency found only in the Planner's live worktree");
		expect(contract).toContain("must not weaken acceptance-specific focused verification descriptors or add a mandatory user confirmation");
		// No new mandatory gate, scheduler, or user confirmation was added.
		expect(contract).not.toContain("browser/simulator subsystem installation");
	});

	test("QA and Review role prompts carry the same evidence rules, with packaged mirrors", () => {
		const qa = flat(QA);
		for (const fragment of [
			"Judge the recorded execution evidence, not the descriptor text",
			"an absent dependency, a prerequisite preparation failure, a skipped required check, or a check that matched zero tests is a failure, not a pass",
			"Structural \"Enrollment ready\" or \"descriptor valid\" is not execution evidence",
			"a contract string proves nothing about provider behavior",
			"Automated behavioral or geometry evidence cannot stand in for a human motion-quality judgment",
			"Environment, preparation, and cleanup breakdowns are environment findings, not assertion findings",
		]) {
			expect(qa).toContain(fragment);
		}

		const review = flat(REVIEW);
		for (const fragment of [
			"## Invariant and Evidence Coverage",
			"Judge whether the change actually closes the invariant its acceptance names, not only the path the report mentions",
			"a coverage gap in the same class, not a new independent bug",
			"Check the negative and bound behavior, not only the happy path",
			"normalization precedes retrieval, validation precedes merge",
			"A required check that is skipped, that matches zero tests, or whose prerequisite is absent does not prove the acceptance",
			"Full suite coverage reported at a coarse pass count is not per-invariant evidence",
			"Keep automated behavioral or geometry evidence separated from a human quality judgment",
		]) {
			expect(review).toContain(fragment);
		}

		// Packaged mirrors stay byte-identical to their sources.
		expect(QA_MIRROR).toBe(QA);
		expect(REVIEW_MIRROR).toBe(REVIEW);
	});

	test("every motivating invariant class has a complete positive/negative/bound control", () => {
		for (const invariant of SIX) {
			const verdict = judgeDescriptor(complete(invariant));
			expect(verdict.failures).toEqual([]);
			expect(verdict.ok).toBe(true);
		}
	});

	test("an invariant missing any one of the three control kinds fails", () => {
		const verdict = judgeDescriptor({ ...complete("validation_before_merge"), controls: ["positive"] });
		expect(verdict.ok).toBe(false);
		expect(verdict.failures.join("\n")).toContain("no negative control for the invariant");
		expect(verdict.failures.join("\n")).toContain("no bound control for the invariant");

		// A positive + negative pair still lacks the boundary claim.
		const noBound = judgeDescriptor({ ...complete("serialized_request_budget"), controls: ["positive", "negative"] });
		expect(noBound.ok).toBe(false);
		expect(noBound.failures.join("\n")).toContain("no bound control for the invariant");

		// A bound control is distinct from a negative control and cannot replace it.
		const boundOnly = judgeDescriptor({ ...complete("serialized_request_budget"), controls: ["positive", "bound"] });
		expect(boundOnly.ok).toBe(false);
		expect(boundOnly.failures.join("\n")).toContain("no negative control");
	});

	test("zero-match, skipped, and absent-prerequisite checks all fail", () => {
		const zero = judgeDescriptor({ ...complete("normalization_to_retrieval"), required_checks_matched: 0 });
		expect(zero.ok).toBe(false);
		expect(zero.failures.join("\n")).toContain("matched zero tests");

		const skipped = judgeDescriptor({ ...complete("missing_embedding_ranking"), required_checks_skipped: 1 });
		expect(skipped.ok).toBe(false);
		expect(skipped.failures.join("\n")).toContain("was skipped");

		const absent = judgeDescriptor({
			...complete("whole_lifecycle_deadline"),
			prerequisites: ["absent"],
		});
		expect(absent.ok).toBe(false);
		expect(absent.failures.join("\n")).toContain("required prerequisite is absent");

		const unprovenProvenance = judgeDescriptor({
			...complete("duration_evidence"),
			prerequisites: ["tracked_delivery", "absent"],
		});
		expect(unprovenProvenance.ok).toBe(false);
	});

	test("declared preparation requires cleanup, and human judgment is never a descriptor claim", () => {
		const uncleaned = judgeDescriptor({
			...complete("whole_lifecycle_deadline"),
			preparation: "start a local browser fixture",
			cleanup: null,
		});
		expect(uncleaned.ok).toBe(false);
		expect(uncleaned.failures.join("\n")).toContain("has no cleanup");

		const cleaned = judgeDescriptor({
			...complete("whole_lifecycle_deadline"),
			preparation: "start a local browser fixture",
			cleanup: "stop the fixture on success, failure, and interruption",
		});
		expect(cleaned.ok).toBe(true);

		const human = judgeDescriptor({ ...complete("duration_evidence"), evidence: "human_motion_quality" });
		expect(human.ok).toBe(false);
		expect(human.failures.join("\n")).toContain("human motion quality cannot be asserted");

		// Automated geometry is a valid descriptor claim on its own.
		const geometry = judgeDescriptor({ ...complete("duration_evidence"), evidence: "automated_geometry" });
		expect(geometry.ok).toBe(true);
	});

	test("the strict descriptor parser is unchanged", () => {
		const parser = read("plugins/immune-brain/runtime/verification_descriptor.ts");
		expect(parser).toContain("export function parseVerificationDescriptor");
		expect(parser).toContain("export function canonicalDescriptorBytes");
		// This Slice adds no second parser, scheduler, or verifier engine.
		expect(parser).not.toContain("invariant_class");
		expect(PLANNER).not.toContain("invariant_class");
	});
});
