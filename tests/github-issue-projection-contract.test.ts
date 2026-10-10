import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deriveGithubTerminalProjectionInput, projectTerminalTrackerState } from "../plugins/immune-brain/runtime/assurance/coordinator.ts";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GhExecution, GhTransport } from "../plugins/immune-brain/runtime/github_issue_tracker.ts";
import {
	runGithubInitiativePublication,
	runGithubTrackerOperation,
} from "../plugins/immune-brain/runtime/github_issue_tracker.ts";

/**
 * Focused contract coverage for the GitHub Issue presentation surface:
 * display-name titles, managed label projection, deduplicated bodies, and
 * provenance/order. The fake transport mirrors only the gh calls the tracker
 * makes, including the label list the publication preflight reads.
 */

interface FakeIssue {
	id: number;
	number: number;
	html_url: string;
	title: string;
	body: string | null;
	state: "open" | "closed";
	state_reason: string | null;
	labels?: string[];
	blockedBy?: number[];
}

class ProjectionGh implements GhTransport {
	issues: FakeIssue[] = [];
	repositoryLabels = ["ready-for-agent", "blocked"];
	subIssues = new Map<number, number[]>();
	mutations = 0;
	createdNumbers: number[] = [];

	async run(args: string[], options: { cwd?: string; stdin?: string } = {}): Promise<GhExecution> {
		const ok = (stdout = ""): GhExecution => ({ exit_code: 0, stdout, stderr: "", timed_out: false, output_exceeded: false });
		if (args[0] === "label" && args[1] === "list")
			return ok(JSON.stringify(this.repositoryLabels.map((name) => ({ name }))));
		if (args[0] === "api" && args[1] === "repos/{owner}/{repo}")
			return ok(JSON.stringify({ id: 77, full_name: "example/project" }));
		if (args[0] === "api") {
			const endpoint = args.at(-1) as string;
			// The direct write flow resolves one created Issue's database id by its
			// number, then attaches relations from that id.
			const detail = endpoint.match(/^repos\/[^/]+\/[^/]+\/issues\/(\d+)$/);
			if (detail) {
				const issue = this.issues.find((candidate) => candidate.number === Number(detail[1]));
				if (!issue) return { ...ok(), exit_code: 1, stderr: "not found" };
				return ok(args.includes("--jq") ? String(issue.id) : JSON.stringify(issue));
			}
			if (endpoint.includes("/issues?state=all"))
				return ok(JSON.stringify(this.issues));
			const dependencyList = endpoint.match(/issues\/(\d+)\/dependencies\/blocked_by/);
			if (dependencyList && args.includes("--paginate")) {
				const child = this.issues.find((issue) => issue.number === Number(dependencyList[1]));
				const blockers = child?.blockedBy ?? [];
				return ok(JSON.stringify(blockers.length ? blockers.map((id) => [{ issue_id: id }]) : [[]]));
			}
			if (dependencyList && args.includes("--method") && args.includes("DELETE")) {
				this.mutations += 1;
				const target = endpoint.match(/issues\/(\d+)\/dependencies\/blocked_by\/(\d+)$/);
				if (!target) return { ...ok(), exit_code: 1, stderr: "bad dependency delete" };
				const child = this.issues.find((issue) => issue.number === Number(target[1]));
				if (!child) return { ...ok(), exit_code: 1, stderr: "not found" };
				const current = (child.blockedBy ??= []);
				const index = current.indexOf(Number(target[2]));
				if (index !== -1) current.splice(index, 1);
				return ok();
			}
			if (dependencyList) {
				this.mutations += 1;
				const child = this.issues.find((issue) => issue.number === Number(dependencyList[1]));
				if (!child) return { ...ok(), exit_code: 1, stderr: "not found" };
				const blocker = Number(args.find((value) => value.startsWith("issue_id="))!.split("=")[1]);
				(child.blockedBy ??= []).push(blocker);
				return ok();
			}
			const subIssueList = endpoint.match(/issues\/(\d+)\/sub_issues/);
			if (subIssueList && !args.some((flag) => flag === "-F" || flag === "-f")) {
				const numbers = this.subIssues.get(Number(subIssueList[1])) ?? [];
				return ok(JSON.stringify(numbers.map((number) => this.issues.find((issue) => issue.number === number) ?? { number })));
			}
			if (subIssueList) {
				this.mutations += 1;
				const parent = Number(subIssueList[1]);
				const childId = Number(args.find((value) => value.startsWith("sub_issue_id="))!.split("=")[1]);
				const child = this.issues.find((issue) => issue.id === childId);
				if (!child) return { ...ok(), exit_code: 1, stderr: "unknown sub_issue_id" };
				this.subIssues.set(parent, [...(this.subIssues.get(parent) ?? []), child.number]);
				return ok();
			}
		}
		if (args[0] === "issue" && args[1] === "create") {
			this.mutations += 1;
			const number = this.issues.length + 1;
			this.createdNumbers.push(number);
			this.issues.push({
				id: number + 1000,
				number,
				html_url: `https://github.com/example/project/issues/${number}`,
				title: args[args.indexOf("--title") + 1],
				body: options.stdin ?? "",
				state: "open",
				state_reason: null,
				labels: args.flatMap((value, index) => (value === "--label" ? [args[index + 1]] : [])),
			});
			return ok(this.issues.at(-1)?.html_url);
		}
		if (args[0] === "issue" && args[1] === "edit") {
			this.mutations += 1;
			const issue = this.issues.find((candidate) => candidate.number === Number(args[2]));
			if (!issue) return { ...ok(), exit_code: 1, stderr: "not found" };
			const titleIndex = args.indexOf("--title");
			if (titleIndex !== -1) issue.title = args[titleIndex + 1];
			if (options.stdin !== undefined) issue.body = options.stdin;
			for (let index = 0; index < args.length; index += 1) {
				if (args[index] === "--add-label" && !(issue.labels ??= []).includes(args[index + 1])) issue.labels.push(args[index + 1]);
				if (args[index] === "--remove-label") issue.labels = (issue.labels ?? []).filter((label) => label !== args[index + 1]);
			}
			return ok();
		}
		if (args[0] === "issue" && args[1] === "close") {
			this.mutations += 1;
			const issue = this.issues.find((candidate) => candidate.number === Number(args[2]));
			if (!issue) return { ...ok(), exit_code: 1, stderr: "not found" };
			issue.state = "closed";
			issue.state_reason = args.at(-1) === "not planned" ? "not_planned" : "completed";
			return ok();
		}
		return { ...ok(), exit_code: 1, stderr: `unexpected fake gh call: ${args.join(" ")}` };
	}
}

async function withRoot(fn: (root: string, gh: ProjectionGh) => Promise<void>) {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "issue-projection-")));
	try {
		spawnSync("git", ["init", "-q"], { cwd: root });
		await fn(root, new ProjectionGh());
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function writeIntent(root: string, taskId: string, goal: string) {
	const path = `docs/plans/${taskId}.intent.json`;
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	writeFileSync(join(root, path), `${JSON.stringify({
		contract: "assurance_kernel/task_intent/v1",
		task_id: taskId,
		goal,
		acceptance: [{ id: `acc-${taskId}`, assertion: `${goal} is verified`, verification: "{}" }],
		scope_hint: ["tests/**"],
		risk: "material",
		revision: 1,
		owner: "user",
	}, null, 2)}\n`);
	spawnSync("git", ["add", path], { cwd: root });
	return path;
}

function acceptance(taskId: string) {
	return [{ id: `acc-${taskId}`, summary: "The bounded result is delivered" }];
}

const INITIATIVE_PROJECTION = {
	short_name: "widget",
	title: "Track widget delivery",
	problem: "Widget work is untracked.",
	result: "Widget delivery is tracked end to end.",
	design: "One Parent Issue and one Child per Slice.",
	decisions: ["Publish the complete graph in one batch."],
	testing_strategy: "Each Child closes from its focused acceptance verification.",
	out_of_scope: ["Widget runtime behavior."],
};

/** A two-Slice batch: the second Slice is blocked by the first. */
function batch(root: string, extra: { sourceIssue?: string } = {}) {
	const paths = [writeIntent(root, "widget-a", "Deliver widget Slice A"), writeIntent(root, "widget-b", "Deliver widget Slice B")];
	return {
		initiative_id: "widget-tracker",
		goal: "Deliver both widget Slices",
		projection: { ...INITIATIVE_PROJECTION, ...(extra.sourceIssue ? { source_issue: extra.sourceIssue } : {}) },
		tasks: [
			{ slice_id: "a", intent: paths[0], acceptance: acceptance("widget-a"), projection: { title: "Ship Slice A" } },
			{ slice_id: "b", intent: paths[1], acceptance: acceptance("widget-b"), projection: { title: "Ship Slice B", blocked_by: ["widget-a"] } },
		],
	};
}

describe("GitHub Issue presentation contract", () => {
	it("composes titles from display names and fails closed on unbounded titles", async () => {
		await withRoot(async (root, gh) => {
			const published = await runGithubInitiativePublication(root, batch(root), gh);
			expect(published.status).toBe("created");
			const [parent, childA, childB] = gh.issues;
			expect(parent.title).toBe("[widget] Track widget delivery");
			expect(childA.title).toBe("[widget] S1 Ship Slice A");
			expect(childB.title).toBe("[widget] S2 Ship Slice B");
			// Goal prose stays in the body and never leaks into a title.
			for (const issue of gh.issues) expect(issue.title).not.toContain("Deliver widget Slice");
			expect(childA.body).toContain("Deliver widget Slice A");
		});

		await withRoot(async (root, gh) => {
			const input = batch(root);
			delete (input.projection as { title?: string }).title;
			const missing = await runGithubInitiativePublication(root, input as never, gh);
			expect(missing.status).toBe("permanent_failure");
			expect(missing.message).toContain("projection.title");
			expect(gh.mutations).toBe(0);
		});

		await withRoot(async (root, gh) => {
			const input = batch(root);
			(input.projection as { title?: string }).title = "W".repeat(90);
			const oversized = await runGithubInitiativePublication(root, input as never, gh);
			expect(oversized.status).toBe("permanent_failure");
			expect(oversized.message).toContain("projection.title");
			expect(gh.mutations).toBe(0);
		});

		await withRoot(async (root, gh) => {
			// Each display name is inside its own bound while the composed title is not:
			// the composition cap, not the field cap, has to fail the batch.
			const input = batch(root);
			(input.projection as { short_name?: string }).short_name = "w".repeat(32);
			(input.projection as { title?: string }).title = "T".repeat(50);
			const composed = await runGithubInitiativePublication(root, input as never, gh);
			expect(composed.status).toBe("permanent_failure");
			expect(composed.message).toContain("80 characters");
			expect(gh.mutations).toBe(0);
		});

		await withRoot(async (root, gh) => {
			const input = batch(root);
			(input.tasks[1].projection as { short_name?: string }).short_name = "other";
			const mismatch = await runGithubInitiativePublication(root, input as never, gh);
			expect(mismatch.status).toBe("permanent_failure");
			expect(mismatch.message).toContain("projection.short_name");
			expect(gh.mutations).toBe(0);
		});

		await withRoot(async (root, gh) => {
			const input = batch(root);
			(input.tasks[1].projection as { slice_ordinal?: number }).slice_ordinal = 5;
			const ordinal = await runGithubInitiativePublication(root, input as never, gh);
			expect(ordinal.status).toBe("permanent_failure");
			expect(ordinal.message).toContain("projection.slice_ordinal");
			expect(gh.mutations).toBe(0);
		});
	});

	it("projects managed labels onto Children only and fails closed on a missing label", async () => {
		await withRoot(async (root, gh) => {
			const published = await runGithubInitiativePublication(root, batch(root), gh);
			expect(published.status).toBe("created");
			const [parent, childA, childB] = gh.issues;
			expect(parent.labels ?? []).toEqual([]);
			expect(childA.labels).toEqual(["ready-for-agent"]);
			expect(childB.labels).toEqual(["ready-for-agent", "blocked"]);
			// A repeated complete batch is idempotent: no mutation, no duplicate label.
			const before = gh.mutations;
			const repeated = await runGithubInitiativePublication(root, batch(root), gh);
			expect(repeated.status).toBe("already_current");
			expect(gh.mutations).toBe(before);
			expect(gh.issues[2].labels).toEqual(["ready-for-agent", "blocked"]);
		});

		await withRoot(async (root, gh) => {
			gh.repositoryLabels = ["ready-for-agent"];
			const blocked = await runGithubInitiativePublication(root, batch(root), gh);
			expect(blocked.status).toBe("permanent_failure");
			expect(blocked.message).toContain("blocked");
			expect(gh.mutations).toBe(0);
			expect(gh.issues).toEqual([]);
		});
	});

	it("repairs label drift on the next convergence pass and keeps bodies deduplicated", async () => {
		await withRoot(async (root, gh) => {
			const published = await runGithubInitiativePublication(root, batch(root), gh);
			expect(published.status).toBe("created");
			const [parent, childA, childB] = gh.issues;

			// Body presentation: no title duplicate, no repeated stanzas.
			for (const issue of [parent, childA]) {
				expect(issue.body).not.toContain("Opt-in, non-authoritative");
				expect(issue.body).not.toContain("## Authority boundary");
				expect(issue.body).not.toContain("## Lifecycle");
				expect(issue.body?.split("Outbound visibility only").length).toBe(2);
			}
			expect(childA.body).not.toContain("## What to build");
			expect(childA.body).not.toContain(`# ${childA.title}`);
			for (const section of ["## Problem", "## Result", "## Initiative design", "## Decisions", "## Testing strategy", "## Out of scope", "## Slices"])
				expect(parent.body).toContain(section);

			// Drift: a human removed a managed label, and the Parent gained one.
			childB.labels = [];
			parent.labels = ["ready-for-agent"];
			const terminal = await runGithubTrackerOperation(root, {
				op: "mark-terminal",
				initiative_id: "widget-tracker",
				task_id: "widget-a",
				slice_id: "a",
				phase: "done",
				terminal_event_id: "evt-widget-a",
			} as never, gh);
			expect(terminal.status).toBe("updated");
			expect(childA.state).toBe("closed");

			const amendment = await runGithubInitiativePublication(root, {
				initiative_id: "widget-tracker",
				goal: "Deliver both widget Slices",
				projection: INITIATIVE_PROJECTION,
				tasks: [
					{
						slice_id: "b",
						intent: "docs/plans/widget-b.intent.json",
						acceptance: acceptance("widget-b"),
						projection: { title: "Ship Slice B", blocked_by: [] },
						binding: { issue_number: childB.number, title: childB.title, body: childB.body, state: "open" },
					},
				],
				amendment: {
					parent: { issue_number: parent.number, title: parent.title, body: parent.body, state: "open" },
					tasks: [{ task_id: "widget-b", binding: { issue_number: childB.number, title: childB.title, body: childB.body, state: "open" } }],
					historical: [{ task_id: "widget-a", binding: { issue_number: childA.number, title: childA.title, body: childA.body, state: "closed" } }],
				},
			} as never, gh);
			expect(amendment.status).toBe("updated");
			expect(gh.issues[2].labels).toEqual(["ready-for-agent"]);
			expect(gh.issues[0].labels ?? []).toEqual([]);
		});
	});

	it("repairs managed label drift on a repeated complete batch without rewriting content", async () => {
		await withRoot(async (root, gh) => {
			const published = await runGithubInitiativePublication(root, batch(root), gh);
			expect(published.status).toBe("created");
			const [parent, childA, childB] = gh.issues;
			const bodies = gh.issues.map((issue) => issue.body);
			// A human removed a managed Child label and added one to the Parent.
			childA.labels = [];
			childB.labels = ["blocked"];
			parent.labels = ["ready-for-agent"];

			const repeated = await runGithubInitiativePublication(root, batch(root), gh);
			expect(repeated.status).toBe("updated");
			expect([...(childA.labels ?? [])].sort()).toEqual(["ready-for-agent"]);
			expect([...(childB.labels ?? [])].sort()).toEqual(["blocked", "ready-for-agent"]);
			expect(parent.labels ?? []).toEqual([]);
			// Label convergence never rewrites Issue content.
			expect(gh.issues.map((issue) => issue.body)).toEqual(bodies);

			// A second pass is idempotent again.
			const settled = gh.mutations;
			const again = await runGithubInitiativePublication(root, batch(root), gh);
			expect(again.status).toBe("already_current");
			expect(gh.mutations).toBe(settled);
		});
	});

	it("numbers Child titles from the Slices checklist even when historical lines are checked", async () => {
		await withRoot(async (root, gh) => {
			const published = await runGithubInitiativePublication(root, batch(root), gh);
			expect(published.status).toBe("created");
			const [parent, childA, childB] = gh.issues;
			// A human checked the completed Slice line before the amendment.
			parent.body = parent.body!.replace("- [ ] <!-- immune-brain:slice-id=a -->", "- [x] <!-- immune-brain:slice-id=a -->");
			const terminal = await runGithubTrackerOperation(root, {
				op: "mark-terminal",
				initiative_id: "widget-tracker",
				task_id: "widget-a",
				slice_id: "a",
				phase: "done",
				terminal_event_id: "evt-checked-a",
			} as never, gh);
			expect(terminal.status).toBe("updated");
			// The closed Child's Parent line was updated after the checkbox edit, so the
			// binding below is the exact approved baseline.
			const baselineParent = gh.issues.find((issue) => issue.body?.includes("kind=initiative"))!;
			const amendment = await runGithubInitiativePublication(root, {
				initiative_id: "widget-tracker",
				goal: "Deliver both widget Slices",
				projection: INITIATIVE_PROJECTION,
				tasks: [
					{
						slice_id: "b",
						intent: "docs/plans/widget-b.intent.json",
						acceptance: acceptance("widget-b"),
						projection: { title: "Ship Slice B", blocked_by: [] },
						binding: { issue_number: childB.number, title: childB.title, body: childB.body, state: "open" },
					},
				],
				amendment: {
					parent: { issue_number: baselineParent.number, title: baselineParent.title, body: baselineParent.body, state: "open" },
					tasks: [{ task_id: "widget-b", binding: { issue_number: childB.number, title: childB.title, body: childB.body, state: "open" } }],
					historical: [{ task_id: "widget-a", binding: { issue_number: childA.number, title: childA.title, body: childA.body, state: "closed" } }],
				},
			} as never, gh);
			expect(amendment.status).toBe("updated");
			expect(gh.issues[2].title).toBe("[widget] S2 Ship Slice B");
			expect(gh.issues[0].body).toContain("- [x] <!-- immune-brain:slice-id=a -->");
		});
	});

	it("projects user scenarios onto the owning Child and a derived Parent listing", async () => {
		await withRoot(async (root, gh) => {
			const input = batch(root);
			const automated = {
				id: "SCN-5",
				actor: "Developer",
				given: "The Initiative was published with scenarios",
				when: "They read the Child",
				then: "The Child shows its own scenarios",
				mode: "automated" as const,
				acceptance: ["acc-widget-a"],
			};
			const manual = {
				id: "BR-SCN-4",
				actor: "Developer",
				given: "The bound Spec lists a manual scenario",
				when: "The Loop prints its exit summary",
				then: "The summary names the scenario as pending",
				mode: "manual" as const,
				manual_reason: "a deterministic test cannot assert that a person follows the written contract",
			};
			(input.tasks[0] as { scenarios?: unknown }).scenarios = [automated, manual];
			const published = await runGithubInitiativePublication(root, input, gh);
			expect(published.status).toBe("created");
			const [parent, childA, childB] = gh.issues;

			const childSection = childA.body!.split("## Acceptance criteria")[1].split("## Verification")[0];
			expect(childSection).toContain("## User scenarios");
			expect(childSection).toContain("- `SCN-5` (automated, `acc-widget-a`): Actor: Developer. Given: The Initiative was published with scenarios. When: They read the Child. Then: The Child shows its own scenarios.");
			expect(childSection).toContain("- [ ] `BR-SCN-4` (manual, none): Actor: Developer. Given: The bound Spec lists a manual scenario. When: The Loop prints its exit summary. Then: The summary names the scenario as pending. Reason: a deterministic test cannot assert that a person follows the written contract.");
			expect(childSection.indexOf("- `SCN-5`")).toBeLessThan(childSection.indexOf("- [ ] `BR-SCN-4`"));
			expect(childSection.split("\n").some((line) => line.startsWith("- [ ] `BR-SCN-4`"))).toBe(true);
			expect(childSection.split("\n").some((line) => line.startsWith("- `SCN-5`"))).toBe(true);

			const parentSection = parent.body!.split("## Testing strategy")[1].split("## Out of scope")[0];
			expect(parentSection).toContain("## User scenarios");
			expect(parentSection).toContain("- `SCN-5` (Slice `a`, automated): When: They read the Child. Then: The Child shows its own scenarios.");
			expect(parentSection).toContain("- `BR-SCN-4` (Slice `a`, manual): When: The Loop prints its exit summary. Then: The summary names the scenario as pending.");
			expect(parentSection).not.toContain("- [ ]");
			expect(parentSection).not.toContain("Actor:");

			// A sibling with no scenarios of its own renders no heading.
			expect(childB.body).not.toContain("## User scenarios");

			// A ticked manual box is body text. Terminal projection appends its
			// marker and closes the Child; it never rewrites the box.
			childA.body = childA.body!.replace("- [ ] `BR-SCN-4`", "- [x] `BR-SCN-4`");
			const ticked = childA.body;
			const terminal = await runGithubTrackerOperation(root, {
				op: "mark-terminal",
				initiative_id: "widget-tracker",
				task_id: "widget-a",
				slice_id: "a",
				phase: "done",
				terminal_event_id: "evt-scn-4",
			} as never, gh);
			expect(terminal.status).toBe("updated");
			expect(childA.state).toBe("closed");
			expect(childA.state_reason).toBe("completed");
			expect(childA.body?.startsWith(ticked.trimEnd())).toBe(true);
			expect(childA.body).toContain("- [x] `BR-SCN-4`");
		});
	});

	it("rejects a malformed scenario before any remote write and accepts a manual scenario with no acceptance", async () => {
		const valid = {
			id: "SCN-1",
			actor: "Developer",
			given: "Work is published",
			when: "They open the Issue",
			then: "The scenario is listed",
			mode: "automated" as const,
			acceptance: ["acc-widget-a"],
		};
		const cases: Array<{ name: string; scenarios: unknown; needle: string }> = [
			{ name: "missing field", scenarios: [{ ...valid, then: undefined }], needle: "missing then" },
			{ name: "bad id", scenarios: [{ ...valid, id: "SCENE-1" }], needle: "BR-SCN-<n> or SCN-<n>" },
			{ name: "duplicate id", scenarios: [valid, { ...valid }], needle: "repeats scenario id SCN-1" },
			{ name: "automated without acceptance", scenarios: [{ ...valid, acceptance: undefined }], needle: "automated with no acceptance id" },
			{ name: "unknown acceptance", scenarios: [{ ...valid, acceptance: ["acc-missing"] }], needle: "unknown acceptance id acc-missing" },
			{ name: "manual without reason", scenarios: [{ ...valid, mode: "manual", acceptance: undefined }], needle: "manual without manual_reason" },
			{ name: "escaped field beyond the bound", scenarios: [{ ...valid, given: "<!--".repeat(100) }], needle: "1-500 safe characters" },
			{ name: "automated with an invalid manual_reason", scenarios: [{ ...valid, manual_reason: 42 }], needle: "manual_reason must be a string" },
		];
		for (const rejection of cases) {
			await withRoot(async (root, gh) => {
				const input = batch(root);
				(input.tasks[0] as { scenarios?: unknown }).scenarios = rejection.scenarios;
				const failed = await runGithubInitiativePublication(root, input, gh);
				expect({ name: rejection.name, status: failed.status, message: failed.message }).toEqual({
					name: rejection.name,
					status: "permanent_failure",
					message: expect.stringContaining(rejection.needle),
				});
				expect(failed.message).toContain("widget-a");
				expect(gh.mutations).toBe(0);
				expect(gh.issues).toEqual([]);
			});
		}

		// A canonical acceptance ID that passes the identifier pattern but carries
		// restricted authority context must fail at publish, not at the later
		// historical read-back, so a published Child stays amendable.
		await withRoot(async (root, gh) => {
			const input = batch(root);
			const intentPath = join(root, "docs", "plans", "widget-a.intent.json");
			writeFileSync(intentPath, `${JSON.stringify({
				contract: "assurance_kernel/task_intent/v1",
				task_id: "widget-a",
				goal: "Deliver widget Slice A",
				acceptance: [{ id: "QA-settlement", assertion: "The bounded result is delivered", verification: "{}" }],
				scope_hint: ["tests/**"],
				risk: "material",
				revision: 1,
				owner: "user",
			}, null, 2)}\n`);
			input.tasks[0].acceptance = [{ id: "QA-settlement", summary: "The bounded result is delivered" }];
			(input.tasks[0] as { scenarios?: unknown }).scenarios = [{ ...valid, acceptance: ["QA-settlement"] }];
			const failed = await runGithubInitiativePublication(root, input, gh);
			expect(failed.status).toBe("permanent_failure");
			expect(failed.message).toContain("restricted authority context");
			expect(failed.message).toContain("widget-a");
			expect(gh.mutations).toBe(0);
			expect(gh.issues).toEqual([]);
		});

		await withRoot(async (root, gh) => {
			const input = batch(root);
			(input.tasks[0] as { scenarios?: unknown }).scenarios = [{
				id: "SCN-2",
				actor: "Developer",
				given: "No deterministic check exists",
				when: "They publish",
				then: "The scenario is accepted",
				mode: "manual",
				manual_reason: "no deterministic check can observe this",
			}];
			const published = await runGithubInitiativePublication(root, input, gh);
			expect(published.status).toBe("created");
			expect(gh.issues[1].body).toContain("- [ ] `SCN-2` (manual, none):");
		});
	});

	it("renders declared provenance and creates Children in plan order", async () => {
		await withRoot(async (root, gh) => {
			const published = await runGithubInitiativePublication(root, batch(root, { sourceIssue: "29" }), gh);
			expect(published.status).toBe("created");
			expect(gh.issues[0].body).toContain("## Provenance");
			expect(gh.issues[0].body).toContain("Derived from #29");
		});

		await withRoot(async (root, gh) => {
			const published = await runGithubInitiativePublication(root, batch(root), gh);
			expect(published.status).toBe("created");
			expect(gh.issues[0].body).not.toContain("## Provenance");
			// Creation order matches the reported execution order, including the
			// declared position of each Slice inside its parallel group.
			expect(gh.createdNumbers.slice(1)).toEqual(published.execution?.issue_order);
			expect(published.execution?.order).toEqual(["widget-a", "widget-b"]);
		});
	});
});

describe("post-settlement tracker projection", () => {
	const TASK = "tracker-terminal-task";
	const TOMBSTONE = {
		task_id: TASK,
		lifecycle_status: "terminal",
		terminal_lifecycle: "done",
		terminal_event_id: "evt-tracker-terminal",
	};
	const settled = {
		claim: null,
		projection: { lifecycle: "done" },
	} as never;

	it("derives the same terminal input the Pi Host derives and forwards it verbatim", async () => {
		const seen: Array<{ root: string; task_id: string; phase: string; terminal_event_id: string }> = [];
		const result = await projectTerminalTrackerState({
			root: "/repo",
			task_id: TASK,
			projection: settled,
			tombstone: TOMBSTONE,
			markTerminal: async (root, input) => {
				seen.push({ root, ...input });
				return {
					contract: "immune_brain/github_issue_tracker_result/v1",
					operation: "mark-terminal",
					status: "not_tracked",
					association_found: false,
					message: "no tracker association",
				};
			},
		});
		// One derivation: the projection input is exactly the shared denominator of
		// the Pi Host's own call, so both Hosts project the same terminal state.
		expect(seen).toEqual([
			{ root: "/repo", ...deriveGithubTerminalProjectionInput(TASK, settled, TOMBSTONE as never) },
		]);
		expect(seen[0].phase).toBe("done");
		expect(result?.operation).toBe("mark-terminal");
	});

	it("projects nothing unless the Kernel already shows a settled, claimless task", async () => {
		let calls = 0;
		const markTerminal = async (): Promise<never> => {
			calls += 1;
			throw new Error("must not be called");
		};
		const cases: Array<[string, unknown, unknown]> = [
			["projection error", { error: "no claim" } as never, TOMBSTONE],
			["live claim", { claim: { task_id: TASK }, projection: { lifecycle: "done" } } as never, TOMBSTONE],
			["active task", { claim: null, projection: { lifecycle: "active" } } as never, TOMBSTONE],
			["missing tombstone", settled, null],
			["non-terminal tombstone", settled, { ...TOMBSTONE, lifecycle_status: "active" }],
			["mismatched tombstone", settled, { ...TOMBSTONE, task_id: "other" }],
			[
				"lifecycle mismatch",
				{ claim: null, projection: { lifecycle: "stopped" } } as never,
				TOMBSTONE,
			],
		];
		for (const [label, projection, tombstone] of cases) {
			const result = await projectTerminalTrackerState({
				root: "/repo",
				task_id: TASK,
				projection: projection as never,
				tombstone: tombstone as never,
				markTerminal,
			});
			expect({ label, result }).toEqual({ label, result: undefined });
		}
		expect(calls).toBe(0);
	});

	it("reports a tracker failure beside the authoritative result instead of failing the settlement", async () => {
		const failure = await projectTerminalTrackerState({
			root: "/repo",
			task_id: TASK,
			projection: settled,
			tombstone: TOMBSTONE,
			markTerminal: async () => {
				throw new Error("gh exited 1");
			},
		});
		// The settlement already happened in the Kernel; the tracker outcome is
		// transport, so it is reported and never retried as authority.
		expect(failure).toEqual({
			contract: "immune_brain/github_issue_tracker_result/v1",
			operation: "mark-terminal",
			status: "retryable_failure",
			association_found: false,
			message: "tracker observation failed after authoritative settlement",
		});
	});

	it("keeps both Hosts on that one shared projection", () => {
		// The Claude Host settles through advance, submitReview, and authorize, and
		// every one of those paths runs the shared step; the Pi Host runs it after
		// its own settlement. A Host that stops calling it, or that invents its own
		// tracker step, fails here.
		const claude = readFileSync(resolve("plugins/immune-brain/runtime/claude/kernel_ports.ts"), "utf8");
		const piWork = readFileSync(resolve("plugins/immune-brain/.pi-extension/imm-canary-work.ts"), "utf8");
		expect(claude).toContain("projectTerminalTrackerState");
		expect(piWork).toContain("projectTerminalTrackerState");
		expect(claude).toContain("runGithubTrackerOperation(root, { op: \"mark-terminal\"");
		const wrapper = claude.slice(claude.indexOf("private async withTerminalTracker"));
		expect(wrapper.slice(0, wrapper.indexOf("\n\t}"))).not.toMatch(/applyOrdinary|advancePiTask|makeCapability|mintCapability/);
	});
});
