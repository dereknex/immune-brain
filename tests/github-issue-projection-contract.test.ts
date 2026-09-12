import { describe, expect, it } from "bun:test";
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
				return ok(JSON.stringify(numbers.map((number) => ({ number }))));
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
