// S6 of docs/specs/workflow-decision-closure.spec.md: bounded discovery and
// partial local results.
//
// Layer 1: the canonical dispatch protocol and the packaged Planner contract
// require a stated question/scope/evidence/stop condition, bounded reads along
// proved callers, project-scoped log searches, bounded continuation of truncated
// output, and inspection of partial effects before retrying unfinished work.
// Layer 2: the bounded-discovery policy those contracts describe is decisive —
// an unbounded sweep, an out-of-scope log scan, or a wholesale retry of a
// partially applied operation is rejected, while a scoped probe with a stop
// condition and a partial-result merge is accepted.
//
// The policy helper below is a mock-evidence model of the documented rule, not a
// runtime check: nothing in production calls it. It exists so the contract has a
// decisive control instead of a phrase-presence assertion.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const flat = (text: string) => text.replace(/\s+/g, " ");

const PROTOCOL = read("docs/reference/subagent-dispatch-protocol.md");
const PROTOCOL_MIRROR = read(
	"plugins/immune-brain/dist/docs/reference/subagent-dispatch-protocol.md",
);
const PLANNER = read("plugins/immune-brain/dist/imm-planner.md");
const BRAINSTORM_LOADER = read("plugins/immune-brain/skills/imm-brainstorm/SKILL.md");

interface ProbeScope {
	/** The question the probe answers. */
	question: string;
	/** Named paths the probe may read. */
	paths: string[];
	/** The stop condition that closes the probe. */
	stopCondition: string;
	/** How deep the read goes. */
	depth: "known_paths" | "proved_callers" | "repository_wide";
	/** Whether the probe touches another project's logs/history. */
	crossProjectLogScan: boolean;
}

// Paths that belong to this project and are safe to read for evidence.
const PROJECT_PREFIXES = ["docs/", "plugins/", "tests/", "scripts/", ".imm/"];

function judgeProbe(scope: ProbeScope): { ok: boolean; failures: string[] } {
	const failures: string[] = [];
	if (!scope.question.trim()) failures.push("probe states no question");
	if (!scope.stopCondition.trim()) failures.push("probe states no stop condition");
	if (scope.paths.length === 0) failures.push("probe names no bounded paths");
	if (scope.depth === "repository_wide") {
		failures.push("probe expands to a repository-wide sweep instead of proved callers");
	}
	if (scope.crossProjectLogScan) {
		failures.push("probe scans another project's session logs");
	}
	for (const path of scope.paths) {
		if (!PROJECT_PREFIXES.some((prefix) => path.startsWith(prefix)) && !path.startsWith("AGENTS")) {
			failures.push(`probe reads an out-of-scope path: ${path}`);
		}
	}
	return { ok: failures.length === 0, failures };
}

interface LocalOperation {
	name: string;
	/** Whether the operation's output is needed by another operation. */
	dependsOnAnother: boolean;
	/** Result of the operation: one failed result must not discard a sibling's success. */
	outcome: "fulfilled" | "rejected";
	/** Whether it already applied part of its effect. */
	partiallyApplied: boolean;
	/** Parts of its effect that already landed. */
	completedParts: string[];
	/** Parts still owed. */
	unfinishedParts: string[];
}

interface RecoveryTarget {
	/** Whether the caller inspected what the operation already produced. */
	inspectedBeforeRetry: boolean;
	/** The parts the retry would (re-)apply. */
	retryParts: string[];
}

interface LocalOperationPlan {
	independent: string[];
	ordered: string[];
	/** Results kept from independent calls that settled together. */
	keptResults: Array<{ name: string; outcome: "fulfilled" | "rejected" }>;
	/** Operations reported as partial because part of their effect already landed. */
	reportedPartial: string[];
	/** The recovery target for each partially applied operation. */
	recovery: Record<string, RecoveryTarget>;
}

/**
 * Independent operations are issued together and inspected together
 * (`Promise.allSettled` semantics): one rejected result does not discard a
 * sibling's fulfilled result, and a partial success is reported as partial. A
 * dependent operation waits for the output it needs.
 */
function planLocalOperations(operations: LocalOperation[]): LocalOperationPlan {
	const independent: string[] = [];
	const ordered: string[] = [];
	const keptResults: Array<{ name: string; outcome: "fulfilled" | "rejected" }> = [];
	const reportedPartial: string[] = [];
	const recovery: Record<string, RecoveryTarget> = {};
	for (const operation of operations) {
		if (operation.dependsOnAnother) ordered.push(operation.name);
		else {
			independent.push(operation.name);
			// Settled-together semantics: both outcomes are kept.
			keptResults.push({ name: operation.name, outcome: operation.outcome });
		}
		if (operation.partiallyApplied) {
			reportedPartial.push(operation.name);
			// Retry only what is actually unfinished; the landed parts are never retried.
			recovery[operation.name] = {
				inspectedBeforeRetry: true,
				retryParts: [...operation.unfinishedParts],
			};
		}
	}
	return { independent, ordered, keptResults, reportedPartial, recovery };
}

/**
 * Whether a retry plan is a legal partial recovery: it inspected the existing
 * effect first, and it neither omits an unfinished part nor re-applies an
 * already landed part. A wholesale replay of an inspected partial effect is
 * exactly the mis-step this guard rejects.
 */
function judgeRecovery(
	operation: LocalOperation,
	plan: RecoveryTarget,
): { ok: boolean; failures: string[] } {
	const failures: string[] = [];
	if (!plan.inspectedBeforeRetry) {
		failures.push(`${operation.name}: retried without inspecting the partial effect`);
	}
	const retried = new Set(plan.retryParts);
	for (const part of operation.unfinishedParts) {
		if (!retried.has(part)) failures.push(`${operation.name}: unfinished part ${part} was not retried`);
	}
	for (const part of operation.completedParts) {
		if (retried.has(part)) failures.push(`${operation.name}: already completed part ${part} was replayed`);
	}
	return { ok: failures.length === 0, failures };
}

/** Bounded continuation of truncated output: page until the need is met, then stop. */
function continueTruncated(input: {
	truncated: boolean;
	stillNeeded: boolean;
	restartFromTop: boolean;
}): { pages: number; failure: string | null } {
	if (!input.truncated) return { pages: 0, failure: null };
	if (!input.stillNeeded) return { pages: 0, failure: null };
	if (input.restartFromTop) return { pages: 1, failure: "restarted the read from the top instead of continuing" };
	// One bounded page continues the read.
	return { pages: 1, failure: null };
}

describe("S6 bounded discovery and partial local results", () => {
	test("the dispatch protocol states question, scope, evidence, and stop condition", () => {
		const contract = flat(PROTOCOL);
		for (const fragment of [
			"Before any dispatch, state the bounded question and scope: the question being investigated, the named paths the probe may read, the expected evidence, and the stop condition that closes the probe",
			"A probe without a stated stop condition is an open-ended sweep, not a bounded one",
			"Read known paths directly first",
			"Expand along proved callers, dependencies, and state owners only when a concrete missing fact requires it, and stop once the question is closed",
			"Repository-wide listings, unrelated directories, and other projects' session logs are out of scope",
			"Project-specific log or history searches stay inside the named project paths",
			"do not scan external session directories unless the user explicitly asks",
		]) {
			expect(contract).toContain(fragment);
		}
	});

	test("the dispatch protocol keeps independent calls settled-together and dependent calls ordered", () => {
		const contract = flat(PROTOCOL);
		for (const fragment of [
			"### Parallel Local Calls And Partial Results",
			"Independent local calls may be issued together and their results inspected together, `Promise.allSettled`-style, so one failure does not discard the other results",
			"Dependent actions stay ordered: an action that needs another's output waits for it",
			"Do not use a settled-all barrier for work that has a real sequence dependency",
			"When output is truncated, continue in bounded pages only while the material is still needed for the question",
			"do not restart the read from the top or expand it into a full-file sweep",
			"Before retrying an operation that may have partially succeeded, inspect what it already produced",
			"a partial edit or partial write is retried only for the part that is actually unfinished, never replayed wholesale",
			"Telemetry and tool-call counts are observational; they never justify omitting evidence the question still requires",
			"they are not comparable to another session's numbers unless the inputs and environment match",
			"报告 partial 结果时说明哪些部分已完成、哪些仍未完成，不把部分结果当作完整结果",
		]) {
			expect(contract).toContain(fragment);
		}
		// Foreground/no-nesting/empty-footer rules remain intact.
		expect(contract).toContain("Parent launches one child at a time");
		expect(contract).toContain("nested delegation 一律禁止");
		expect(contract).toContain("Footer 保持严格为空");
	});

	test("Planner carries the same bounded-discovery rule", () => {
		const contract = flat(PLANNER);
		for (const fragment of [
			"**Bounded discovery.** State the question, the named paths, the expected evidence, and the stop condition before an investigation expands",
			"Read known paths directly, expand only along proved callers and state owners, and stop once the question is closed instead of continuing into nearby unrelated paths",
			"Keep project-specific log or history searches inside the named project paths",
			"Reads or investigation output that is truncated continue in bounded pages only while still needed",
			"an operation that may have partially succeeded is inspected before it is retried for only its unfinished part",
			"Telemetry and tool-call counts are observational: they never justify dropping evidence the question requires",
			"they are not comparable to another session's numbers unless the inputs and environment match",
		]) {
			expect(contract).toContain(fragment);
		}
		// No hard cap and no new orchestrator were introduced.
		expect(contract).toContain("must not weaken acceptance-specific focused verification descriptors");
		expect(contract).not.toContain("hard token cap");
		expect(contract).not.toContain("orchestrator");
	});

	test("the packaged dispatch protocol mirror is byte-identical", () => {
		expect(PROTOCOL_MIRROR).toBe(PROTOCOL);
		// The loader still routes research without inlining the reference.
		expect(flat(BRAINSTORM_LOADER)).toContain("../../dist/imm-brainstorm.md");
	});

	test("a scoped probe passes and an unbounded or cross-project probe fails", () => {
		const bounded = judgeProbe({
			question: "which modules read the legacy discovery cache?",
			paths: ["docs/reference/subagent-dispatch-protocol.md", "plugins/immune-brain/dist/imm-planner.md"],
			stopCondition: "the reference and its mirror are the only readers",
			depth: "proved_callers",
			crossProjectLogScan: false,
		});
		expect(bounded.ok).toBe(true);

		const unbounded = judgeProbe({
			question: "where is discovery used?",
			paths: ["plugins/"],
			stopCondition: "",
			depth: "repository_wide",
			crossProjectLogScan: false,
		});
		expect(unbounded.ok).toBe(false);
		expect(unbounded.failures.join("\n")).toContain("repository-wide sweep");
		expect(unbounded.failures.join("\n")).toContain("no stop condition");

		const crossProject = judgeProbe({
			question: "did another project hit this?",
			paths: ["plugins/immune-brain/dist/imm-planner.md"],
			stopCondition: "one matching session is found",
			depth: "known_paths",
			crossProjectLogScan: true,
		});
		expect(crossProject.ok).toBe(false);
		expect(crossProject.failures.join("\n")).toContain("another project's session logs");

		const outOfScopePath = judgeProbe({
			question: "what do the notes say?",
			paths: ["/Users/someone/notes.md"],
			stopCondition: "the note is read",
			depth: "known_paths",
			crossProjectLogScan: false,
		});
		expect(outOfScopePath.ok).toBe(false);
		expect(outOfScopePath.failures.join("\n")).toContain("out-of-scope path");
	});

	test("independent calls settle together, dependent calls stay ordered", () => {
		const plan = planLocalOperations([
			{ name: "read-a", dependsOnAnother: false, outcome: "fulfilled", partiallyApplied: false, completedParts: [], unfinishedParts: [] },
			{ name: "read-b", dependsOnAnother: false, outcome: "rejected", partiallyApplied: false, completedParts: [], unfinishedParts: [] },
			{ name: "write-using-a", dependsOnAnother: true, outcome: "fulfilled", partiallyApplied: false, completedParts: [], unfinishedParts: [] },
		]);
		expect(plan.independent.sort()).toEqual(["read-a", "read-b"]);
		expect(plan.ordered).toEqual(["write-using-a"]);
		// A rejected sibling does not discard the fulfilled sibling's result.
		expect(plan.keptResults).toEqual([
			{ name: "read-a", outcome: "fulfilled" },
			{ name: "read-b", outcome: "rejected" },
		]);
		// The dependent operation is not in the settled-together set.
		expect(plan.keptResults.map((result) => result.name)).not.toContain("write-using-a");
	});

	test("a partially applied operation is inspected and retried only for its unfinished part", () => {
		const operation: LocalOperation = {
			name: "patch-three-files",
			dependsOnAnother: false,
			outcome: "fulfilled",
			partiallyApplied: true,
			completedParts: ["file-a", "file-b"],
			unfinishedParts: ["file-c"],
		};
		const plan = planLocalOperations([operation]);
		expect(plan.reportedPartial).toEqual(["patch-three-files"]);
		const legal = judgeRecovery(operation, plan.recovery["patch-three-files"]);
		expect(legal.failures).toEqual([]);
		expect(legal.ok).toBe(true);
		// The retry target is the unfinished part only.
		expect(plan.recovery["patch-three-files"].retryParts).toEqual(["file-c"]);

		// A wholesale replay of the inspected partial effect is illegal.
		const replay = judgeRecovery(operation, {
			inspectedBeforeRetry: true,
			retryParts: ["file-a", "file-b", "file-c"],
		});
		expect(replay.ok).toBe(false);
		expect(replay.failures.join("\n")).toContain("already completed part file-a was replayed");
		expect(replay.failures.join("\n")).toContain("already completed part file-b was replayed");
	});

	test("an uninspected retry or a dropped unfinished part fails", () => {
		const operation: LocalOperation = {
			name: "write-report",
			dependsOnAnother: false,
			outcome: "rejected",
			partiallyApplied: true,
			completedParts: ["header"],
			unfinishedParts: ["body", "footer"],
		};
		const uninspected = judgeRecovery(operation, {
			inspectedBeforeRetry: false,
			retryParts: ["body", "footer"],
		});
		expect(uninspected.ok).toBe(false);
		expect(uninspected.failures.join("\n")).toContain("retried without inspecting the partial effect");

		const dropped = judgeRecovery(operation, {
			inspectedBeforeRetry: true,
			retryParts: ["body"],
		});
		expect(dropped.ok).toBe(false);
		expect(dropped.failures.join("\n")).toContain("unfinished part footer was not retried");
	});

	test("truncated output continues in bounded pages rather than restarting", () => {
		expect(continueTruncated({ truncated: false, stillNeeded: true, restartFromTop: false }).pages).toBe(0);
		// Not needed any more: no continuation at all.
		expect(continueTruncated({ truncated: true, stillNeeded: false, restartFromTop: false }).pages).toBe(0);
		const continued = continueTruncated({ truncated: true, stillNeeded: true, restartFromTop: false });
		expect(continued.pages).toBe(1);
		expect(continued.failure).toBeNull();
		const restarted = continueTruncated({ truncated: true, stillNeeded: true, restartFromTop: true });
		expect(restarted.failure).toContain("restarted the read from the top");
	});
});
