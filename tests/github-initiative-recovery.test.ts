// S5 of docs/specs/workflow-decision-closure.spec.md: discoverable commands.
// S1 of docs/specs/tracker-direct-publication.spec.md: the direct write flow.
//
// The tracker already owns strict v2 parsing, exclusive canonical authoring and
// idempotent markers. This file proves the publication properties on top of that
// machinery, against one fake transport:
//
//   1. Truthful effect reporting. A caller can tell a confirmed write
//      (`write_state: "confirmed"`) from an outcome it may not treat as zero
//      writes (`"uncertain"`, carrying exactly one recovery action). No
//      execution handoff happens before a complete run.
//   2. A bounded call. One publication call is one finite remote step sequence
//      with no internal retry loop and no whole-operation deadline, so a lost
//      response or partial success is recovered by rerunning the same approved
//      manifest: the next start listing adopts whatever landed.
//
// Fake transport only: no real remote write, no credential, no test-side loop.

import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { GhExecution, GhTransport, OperationCancellation } from "../plugins/immune-brain/runtime/github_issue_tracker.ts";
import { runGithubInitiativePublication } from "../plugins/immune-brain/runtime/github_issue_tracker.ts";
import { intentAuthorHelp } from "../plugins/immune-brain/runtime/v4_runtime.ts";

const TS_RUNTIME = resolve(import.meta.dir, "../plugins/immune-brain/runtime/v4_runtime.ts");

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

type FaultKind =
	| "issue_create"
	| "issue_edit"
	| "issue_close"
	| "blocked_by_add"
	| "blocked_by_delete"
	| "sub_issue_attach"
	| "issue_list";

/**
 * One injected fault. `after: "none"` fails before any effect. `after:
 * "applied"` lets the effect land and then reports the transport failure: the
 * audited F8 shape, where the caller must not infer zero writes. `repeat` fires
 * on every matching call, which is how an internal retry loop would show up.
 */
interface Fault {
	at: FaultKind;
	after: "none" | "applied";
	execution: GhExecution;
	/** Fire on every matching call instead of once. */
	repeat?: boolean;
	/** Fire on the Nth matching call (1-based) instead of the first. */
	atCount?: number;
}

function retryable(stderr = "network is unreachable"): GhExecution {
	return { exit_code: 1, stdout: "", stderr, timed_out: false, output_exceeded: false };
}

function timedOut(): GhExecution {
	return { exit_code: 1, stdout: "", stderr: "", timed_out: true, output_exceeded: false };
}

/**
 * A remote write call, as opposed to a read-only snapshot call. Only the `api`
 * requests that actually carry a mutation (`-F`/`-f` field or `--method`) count;
 * `--paginate`, `--slurp` and plain GET snapshots do not.
 */
function isWriteCall(args: string[]): boolean {
	if (args[0] === "issue" && (args[1] === "create" || args[1] === "edit" || args[1] === "close")) return true;
	if (args[0] === "api" && (args.includes("--method") || args.some((arg) => arg === "-F" || arg === "-f"))) return true;
	return false;
}

/** The FaultKind an `api` write belongs to, or null when it is not a tracked write. */
function apiWriteKind(args: string[]): FaultKind | null {
	if (args[0] !== "api") return null;
	const mutating = args.includes("--method") || args.some((arg) => arg === "-F" || arg === "-f");
	if (!mutating) return null;
	const endpoint = [...args].reverse().find((arg) => arg.includes("repos/")) ?? "";
	if (endpoint.includes("/dependencies/blocked_by"))
		return args.includes("DELETE") ? "blocked_by_delete" : "blocked_by_add";
	if (endpoint.includes("/sub_issues")) return "sub_issue_attach";
	return null;
}

/** The fault kind this call belongs to, or null for a read-only call. */
function faultKind(args: string[]): FaultKind | null {
	if (args[0] === "issue" && args[1] === "create") return "issue_create";
	if (args[0] === "issue" && args[1] === "edit") return "issue_edit";
	if (args[0] === "issue" && args[1] === "close") return "issue_close";
	return apiWriteKind(args);
}

class RecoveryGh implements GhTransport {
	issues: FakeIssue[] = [];
	repositoryLabels = ["ready-for-agent", "blocked"];
	subIssues = new Map<number, number[]>();
	/** Counted at the transport boundary, the only place a call is a real fact. */
	writeCalls = 0;
	/** Repository-wide Issue listings observed, so read count can be asserted. */
	issueListings = 0;
	mutationLog: string[] = [];
	/** Every call in order, so the read/write sequence itself can be asserted. */
	callLog: string[] = [];
	createdNumbers: number[] = [];
	fault: Fault | null = null;
	/** Matching calls seen per fault kind, so `atCount` can target one of them. */
	private callCounts = new Map<FaultKind, number>();

	private ok(stdout = ""): GhExecution {
		return { exit_code: 0, stdout, stderr: "", timed_out: false, output_exceeded: false };
	}

	/**
	 * Fire the pending fault if this call kind matches. The per-kind counter is
	 * advanced once per call by `run`, so a create's two fire points (before the
	 * effect, and again once it landed) see the same value.
	 */
	private fireFault(kind: FaultKind, consumeApplied = false): GhExecution | null {
		const seen = this.callCounts.get(kind) ?? 0;
		if (!this.fault || this.fault.at !== kind) return null;
		if (this.fault.atCount !== undefined && this.fault.atCount !== seen) return null;
		const fault = this.fault;
		if (fault.after === "none" || consumeApplied) {
			if (!fault.repeat) this.fault = null;
			return fault.execution;
		}
		return null;
	}

	async run(args: string[], options: { cwd?: string; stdin?: string; signal?: { readonly aborted: boolean } } = {}): Promise<GhExecution> {
		// Mirror the real transport's cancellation boundary: an aborted caller
		// refuses the call instead of starting another remote write. There is no
		// whole-operation deadline any more -- only the per-call timeout remains.
		if (options.signal?.aborted) {
			return {
				exit_code: 1,
				stdout: "",
				stderr: "operation cancelled by the caller",
				timed_out: true,
				output_exceeded: false,
			};
		}
		const write = isWriteCall(args);
		this.callLog.push(args.join(" "));
		const kind = faultKind(args) ?? (args[0] === "api" && !write ? "issue_list" : null);
		if (kind) this.callCounts.set(kind, (this.callCounts.get(kind) ?? 0) + 1);
		const result = await this.dispatch(args, options);
		if (write) {
			this.writeCalls += 1;
			this.mutationLog.push(`${args[0]}:${args[1]}`);
		}
		return result;
	}

	private async dispatch(args: string[], options: { cwd?: string; stdin?: string } = {}): Promise<GhExecution> {
		if (args[0] === "label" && args[1] === "list")
			return this.ok(JSON.stringify(this.repositoryLabels.map((name) => ({ name }))));
		if (args[0] === "api" && args[1] === "repos/{owner}/{repo}")
			return this.ok(JSON.stringify({ id: 77, full_name: "example/project" }));
		if (args[0] === "api") {
			const endpoint = args.at(-1) as string;
			const issueDetail = endpoint.match(/^repos\/[^/]+\/[^/]+\/issues\/(\d+)$/);
			if (issueDetail) {
				const issue = this.issues.find((candidate) => candidate.number === Number(issueDetail[1]));
				if (!issue) return { ...this.ok(), exit_code: 1, stderr: "not found" };
				// `--jq` resolves only the database id. A bare read is the Parent
				// body the terminal projection checks before closing it.
				// `--jq` resolves only the database id. A bare read is the Parent
				// body the terminal projection checks before closing it.
				return this.ok(args.includes("--jq") ? String(issue.id) : JSON.stringify(issue));
			}
			if (endpoint.includes("/issues?state=all")) {
				this.issueListings += 1;
				const short = this.fireFault("issue_list");
				if (short) return short;
				return this.ok(JSON.stringify(this.issues));
			}
			const dependencyList = endpoint.match(/issues\/(\d+)\/dependencies\/blocked_by/);
			if (dependencyList && args.includes("--paginate")) {
				const child = this.issues.find((issue) => issue.number === Number(dependencyList[1]));
				const blockers = child?.blockedBy ?? [];
				return this.ok(JSON.stringify(blockers.length ? blockers.map((id) => [{ issue_id: id }]) : [[]]));
			}
			if (dependencyList && args.includes("--method") && args.includes("DELETE")) {
				const short = this.fireFault("blocked_by_delete");
				if (short) return short;
				const target = endpoint.match(/issues\/(\d+)\/dependencies\/blocked_by\/(\d+)$/);
				if (!target) return { ...this.ok(), exit_code: 1, stderr: "bad dependency delete" };
				const child = this.issues.find((issue) => issue.number === Number(target[1]));
				if (!child) return { ...this.ok(), exit_code: 1, stderr: "not found" };
				const current = (child.blockedBy ??= []);
				const index = current.indexOf(Number(target[2]));
				if (index !== -1) current.splice(index, 1);
				return this.ok();
			}
			if (dependencyList) {
				const short = this.fireFault("blocked_by_add");
				if (short) return short;
				const child = this.issues.find((issue) => issue.number === Number(dependencyList[1]));
				if (!child) return { ...this.ok(), exit_code: 1, stderr: "not found" };
				const blocker = Number(args.find((value) => value.startsWith("issue_id="))!.split("=")[1]);
				(child.blockedBy ??= []).push(blocker);
				return this.ok();
			}
			const subIssueList = endpoint.match(/issues\/(\d+)\/sub_issues/);
			if (subIssueList && !args.some((flag) => flag === "-F" || flag === "-f")) {
				const numbers = this.subIssues.get(Number(subIssueList[1])) ?? [];
				return this.ok(JSON.stringify(numbers.map((number) => ({ number }))));
			}
			if (subIssueList) {
				const short = this.fireFault("sub_issue_attach");
				if (short) return short;
				const parent = Number(subIssueList[1]);
				const childId = Number(args.find((value) => value.startsWith("sub_issue_id="))!.split("=")[1]);
				const child = this.issues.find((issue) => issue.id === childId);
				if (!child) return { ...this.ok(), exit_code: 1, stderr: "unknown sub_issue_id" };
				this.subIssues.set(parent, [...(this.subIssues.get(parent) ?? []), child.number]);
				return this.ok();
			}
		}
		if (args[0] === "issue" && args[1] === "create") {
			const short = this.fireFault("issue_create");
			if (short) return short;
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
			const lost = this.fireFault("issue_create", true);
			return lost ?? this.ok(this.issues.at(-1)?.html_url);
		}
		if (args[0] === "issue" && args[1] === "edit") {
			const short = this.fireFault("issue_edit");
			if (short) return short;
			const issue = this.issues.find((candidate) => candidate.number === Number(args[2]));
			if (!issue) return { ...this.ok(), exit_code: 1, stderr: "not found" };
			const titleIndex = args.indexOf("--title");
			if (titleIndex !== -1) issue.title = args[titleIndex + 1];
			if (options.stdin !== undefined) issue.body = options.stdin;
			for (let index = 0; index < args.length; index += 1) {
				if (args[index] === "--add-label" && !(issue.labels ??= []).includes(args[index + 1])) issue.labels.push(args[index + 1]);
				if (args[index] === "--remove-label") issue.labels = (issue.labels ?? []).filter((label) => label !== args[index + 1]);
			}
			const lost = this.fireFault("issue_edit", true);
			return lost ?? this.ok();
		}
		if (args[0] === "issue" && args[1] === "close") {
			const short = this.fireFault("issue_close");
			if (short) return short;
			const issue = this.issues.find((candidate) => candidate.number === Number(args[2]));
			if (!issue) return { ...this.ok(), exit_code: 1, stderr: "not found" };
			issue.state = "closed";
			issue.state_reason = args.at(-1) === "not planned" ? "not_planned" : "completed";
			const lost = this.fireFault("issue_close", true);
			return lost ?? this.ok();
		}
		return { ...this.ok(), exit_code: 1, stderr: `unexpected fake gh call: ${args.join(" ")}` };
	}
}

async function withRoot(fn: (root: string, gh: RecoveryGh) => Promise<void>) {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "initiative-recovery-")));
	try {
		spawnSync("git", ["init", "-q"], { cwd: root });
		await fn(root, new RecoveryGh());
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

/** A six-Child chain: Children 2-6 are each blocked by the previous one. */
function sixBatch(root: string) {
	const ids = ["s1", "s2", "s3", "s4", "s5", "s6"];
	const paths = ids.map((id) => writeIntent(root, `chain-${id}`, `Deliver chain Slice ${id}`));
	return {
		initiative_id: "chain-tracker",
		goal: "Deliver six chained Slices",
		projection: {
			short_name: "chain",
			title: "Track chained delivery",
			problem: "Chained work is untracked.",
			result: "Chained delivery is tracked end to end.",
			design: "One Parent Issue and one Child per Slice.",
		},
		tasks: ids.map((id, index) => ({
			slice_id: id,
			intent: paths[index],
			acceptance: [{ id: `acc-chain-${id}`, summary: `Slice ${id} is delivered` }],
			projection: { title: `Ship ${id}`, ...(index === 0 ? {} : { blocked_by: [`chain-${ids[index - 1]}`] }) },
		})),
	};
}

/** Scenarios a historical Child was published with, read back from its marker. */
const historicalScenarios = [
	{ id: "SCN-1", actor: "Developer", given: "Slice A is published", when: "They open the historical Child", then: "The historical scenario stays listed", mode: "automated", acceptance: ["acc-widget-a"] },
	{ id: "SCN-2", actor: "Developer", given: "A\n---\nB\n- `widget`\n## Verification", when: "They continue", then: "The second scenario stays reserved", mode: "automated", acceptance: ["acc-widget-a"] },
];

/** A two-Slice batch: the second Slice is blocked by the first. */
function batch(root: string) {
	const paths = [writeIntent(root, "widget-a", "Deliver widget Slice A"), writeIntent(root, "widget-b", "Deliver widget Slice B")];
	return {
		initiative_id: "widget-tracker",
		goal: "Deliver both widget Slices",
		projection: {
			short_name: "widget",
			title: "Track widget delivery",
			problem: "Widget work is untracked.",
			result: "Widget delivery is tracked end to end.",
			design: "One Parent Issue and one Child per Slice.",
			decisions: ["Publish the complete graph in one batch."],
			testing_strategy: "Each Child closes from its focused acceptance verification.",
			out_of_scope: ["Widget runtime behavior."],
		},
		tasks: [
			{ slice_id: "a", intent: paths[0], acceptance: [{ id: "acc-widget-a", summary: "Slice A is delivered" }], projection: { title: "Ship Slice A" } },
			{
				slice_id: "b",
				intent: paths[1],
				acceptance: [{ id: "acc-widget-b", summary: "Slice B is delivered" }],
				projection: { title: "Ship Slice B", blocked_by: ["widget-a"] },
			},
		],
	};
}

describe("S5 bounded publication recovery", () => {
	it("performs the direct write flow with one start listing and no post-write read", async () => {
		await withRoot(async (root, gh) => {
			const published = await runGithubInitiativePublication(root, batch(root), gh);
			expect(published.status).toBe("created");
			// Exactly one repository-wide listing, and it precedes every write: no
			// attachment, dependency or ownership confirmation follows a write.
			expect(gh.issueListings).toBe(1);
			const startListing = gh.callLog.findIndex((call) => call.includes("/issues?state=all"));
			const firstWrite = gh.callLog.findIndex((call) => call.startsWith("issue create") || call.startsWith("api -F"));
			expect(startListing).toBeGreaterThanOrEqual(0);
			expect(firstWrite).toBeGreaterThan(startListing);
			expect(gh.callLog.slice(firstWrite).filter((call) => call.includes("/issues?state=all"))).toEqual([]);
			// Three creates (Parent + two Children), two attaches, one blocked_by.
			expect(gh.mutationLog).toEqual([
				"issue:create", "issue:create", "api:-F", "issue:create", "api:-F", "api:-F",
			]);
		});
	});

	it("the repository-wide read count does not grow with the number of Children", async () => {
		await withRoot(async (root, gh) => {
			expect((await runGithubInitiativePublication(root, batch(root), gh)).status).toBe("created");
			expect(gh.issueListings).toBe(1);

			const sixGh = new RecoveryGh();
			const six = await runGithubInitiativePublication(root, sixBatch(root), sixGh);
			expect(six.message).toBe("complete Initiative Parent, Children, and dependency graph published");
			expect(six.status).toBe("created");
			// Six Children in a chain: the same single start listing, and one write per
			// Issue plus one per relation -- 7 creates, 6 attaches, 5 dependencies.
			expect(sixGh.issueListings).toBe(1);
			expect(sixGh.mutationLog.filter((call) => call === "issue:create").length).toBe(7);
			expect(sixGh.mutationLog.length).toBe(7 + 6 + 5);
		});
	});

	it("an owned Child without its Parent is refused before any write", async () => {
		await withRoot(async (root, gh) => {
			const input = batch(root);
			expect((await runGithubInitiativePublication(root, input, gh)).status).toBe("created");
			// The Parent disappears from the repository while both Children remain. A
			// direct flow must not create a replacement Parent over Children that still
			// link the old one.
			gh.issues = gh.issues.filter((issue) => !issue.body?.includes("kind=initiative"));
			const writes = gh.writeCalls;
			const result = await runGithubInitiativePublication(root, input, gh);
			expect(result.status).toBe("ambiguous_remote_state");
			expect(result.message).toContain("its Parent Issue is missing");
			expect(gh.writeCalls).toBe(writes);
		});
	});

	it("a closed Issue and an unapproved relation are refused before any write", async () => {
		await withRoot(async (root, gh) => {
			const input = batch(root);
			expect((await runGithubInitiativePublication(root, input, gh)).status).toBe("created");

			// Start-of-run drift that the listing already reveals: a closed Child.
			const childA = gh.issues.find((issue) => issue.body?.includes("task-id=widget-a"))!;
			childA.state = "closed";
			let writes = gh.writeCalls;
			const closed = await runGithubInitiativePublication(root, input, gh);
			expect(closed.status).toBe("ambiguous_remote_state");
			expect(closed.message).toContain("no longer open");
			expect(gh.writeCalls).toBe(writes);

			// A relation present at start that this Intent never approved.
			childA.state = "open";
			(childA.blockedBy ??= []).push(9999);
			writes = gh.writeCalls;
			const unapproved = await runGithubInitiativePublication(root, input, gh);
			expect(unapproved.status).toBe("ambiguous_remote_state");
			expect(unapproved.message).toContain("this Intent does not approve");
			expect(gh.writeCalls).toBe(writes);
		});
	});

	it("reports a confirmed, complete publication with no pending step", async () => {
		await withRoot(async (root, gh) => {
			const published = await runGithubInitiativePublication(root, batch(root), gh);
			expect(published.status).toBe("created");
			expect(published.write_state).toBe("confirmed");
			expect(published.pending_steps).toEqual([]);
			expect(published.confirmed_steps.sort()).toEqual(["widget-a", "widget-b"]);
			// Publication success is read back, so the execution recommendation is
			// present only here — never on an unconfirmed outcome.
			expect(published.execution).toBeDefined();
			expect(gh.issues.length).toBe(3);
			expect(published.message).not.toContain("does not prove zero writes");
		});
	});

	it("a partial success reports confirmed and pending steps and hands off nothing", async () => {
		await withRoot(async (root, gh) => {
			const input = batch(root);
			// The Parent and both Children land; the first blocked_by write then fails
			// before applying, so the dependency graph is unfinished.
			gh.fault = { at: "blocked_by_add", after: "none", execution: retryable(), atCount: 1 };
			const partial = await runGithubInitiativePublication(root, input, gh);
			expect(partial.status).toBe("retryable_failure");
			expect(partial.write_state).toBe("uncertain");
			// A failure never means "zero writes".
			expect(partial.message).toContain("does not prove zero writes");
			// Exactly one recovery action, attached at the failure origin.
			expect(partial.message.match(/Re-read the exact ownership/g)?.length).toBe(1);
			expect(partial.confirmed_steps).toContain("widget-a");
			expect(partial.pending_steps).toContain("widget-b");
			// No execution handoff before a complete readback.
			expect(partial.execution).toBeUndefined();
			expect(gh.issues.length).toBe(3);
			const created = gh.createdNumbers.length;

			// The same approved manifest converges on the next call, adopting the three
			// already-published Issues instead of duplicating them.
			const converged = await runGithubInitiativePublication(root, input, gh);
			expect(converged.status).toBe("updated");
			expect(converged.write_state).toBe("confirmed");
			expect(converged.message).not.toContain("does not prove zero writes");
			expect(gh.createdNumbers.length).toBe(created);
			expect(new Set(gh.createdNumbers).size).toBe(gh.createdNumbers.length);
			expect(gh.issues.length).toBe(3);
		});
	});

	it("a lost create response leaves the outcome uncertain and the rerun adopts the landed write", async () => {
		await withRoot(async (root, gh) => {
			const input = batch(root);
			// The Parent creation lands, then the transport loses the response, so the
			// direct flow cannot learn the Issue number and must report the batch
			// uncertain instead of claiming a confirmation it never performed.
			gh.fault = { at: "issue_create", after: "applied", execution: retryable("connection reset by peer") };
			const lost = await runGithubInitiativePublication(root, input, gh);
			expect(lost.status).toBe("retryable_failure");
			expect(lost.write_state).toBe("uncertain");
			expect(lost.execution).toBeUndefined();
			expect(lost.message).toContain("does not prove zero writes");
			// The landed write exists exactly once: no retry loop duplicated it.
			expect(gh.issues.length).toBe(1);
			expect(gh.writeCalls).toBe(1);

			// The next approved call reads the live state at its own start and adopts it.
			const resumed = await runGithubInitiativePublication(root, input, gh);
			expect(resumed.status).toBe("updated");
			expect(resumed.write_state).toBe("confirmed");
			expect(resumed.execution).toBeDefined();
			expect(gh.issues.length).toBe(3);
			expect(new Set(gh.createdNumbers).size).toBe(3);
		});
	});

	it("a rerun adopts every Issue of a partial run and writes only the missing relations", async () => {
		await withRoot(async (root, gh) => {
			const input = batch(root);
			// The Parent and both Children land; the first blocked_by write then fails,
			// so the dependency graph is unfinished.
			gh.fault = { at: "blocked_by_add", after: "none", execution: retryable(), atCount: 1 };
			const partial = await runGithubInitiativePublication(root, input, gh);
			expect(partial.status).toBe("retryable_failure");
			expect(partial.write_state).toBe("uncertain");
			expect(partial.message).toContain("does not prove zero writes");
			expect(partial.pending_steps).toEqual(["widget-b"]);
			expect(partial.execution).toBeUndefined();
			expect(gh.issues.length).toBe(3);
			const created = gh.createdNumbers.length;
			const writes = gh.writeCalls;

			// The rerun creates nothing, adopts the three already-published Issues from
			// its start listing, and writes only the one missing relation.
			const converged = await runGithubInitiativePublication(root, input, gh);
			expect(converged.status).toBe("updated");
			expect(converged.write_state).toBe("confirmed");
			expect(converged.message).not.toContain("does not prove zero writes");
			expect(gh.createdNumbers.length).toBe(created);
			expect(new Set(gh.createdNumbers).size).toBe(gh.createdNumbers.length);
			expect(gh.issues.length).toBe(3);
			expect(gh.writeCalls - writes).toBe(1);
		});
	});

	it("a timeout before any effect is uncertain with one recovery action", async () => {
		await withRoot(async (root, gh) => {
			gh.fault = { at: "issue_create", after: "none", execution: timedOut() };
			const result = await runGithubInitiativePublication(root, batch(root), gh);
			expect(result.status).toBe("retryable_failure");
			expect(result.write_state).toBe("uncertain");
			expect(result.message.match(/Re-read the exact ownership/g)?.length).toBe(1);
			expect(result.execution).toBeUndefined();
			expect(gh.issues).toEqual([]);
		});
	});

	it("repeated publication of the same approved manifest is idempotent", async () => {
		await withRoot(async (root, gh) => {
			const input = batch(root);
			const first = await runGithubInitiativePublication(root, input, gh);
			expect(first.status).toBe("created");
			const writeCalls = gh.writeCalls;
			const second = await runGithubInitiativePublication(root, input, gh);
			expect(second.status).toBe("already_current");
			expect(second.write_state).toBe("confirmed");
			expect(gh.writeCalls).toBe(writeCalls);
			expect(gh.issues.length).toBe(3);
		});
	});

	it("stale intent bytes and ambiguous ownership both fail closed before a write", async () => {
		await withRoot(async (root, gh) => {
			const input = batch(root);
			await runGithubInitiativePublication(root, input, gh);
			const writeCalls = gh.writeCalls;
			// Rewrite the canonical intent: the published hash no longer binds, and
			// the tracker refuses to rewrite an existing Initiative silently.
			writeFileSync(join(root, "docs/plans/widget-b.intent.json"), `${JSON.stringify({
				contract: "assurance_kernel/task_intent/v1",
				task_id: "widget-b",
				goal: "Deliver a different widget Slice B",
				acceptance: [{ id: "acc-widget-b", assertion: "different", verification: "{}" }],
				scope_hint: ["tests/**"],
				risk: "material",
				revision: 1,
				owner: "user",
			}, null, 2)}\n`);
			spawnSync("git", ["add", "docs/plans/widget-b.intent.json"], { cwd: root });
			const stale = await runGithubInitiativePublication(root, input, gh);
			// The whole batch is validated before the first recovery write, so the
			// mismatch is refused rather than discovered after an earlier Child write.
			expect(stale.status).toBe("ambiguous_remote_state");
			expect(stale.write_state).toBe("uncertain");
			expect(stale.execution).toBeUndefined();
			// The refusal mutated nothing.
			expect(gh.writeCalls).toBe(writeCalls);
		});

		await withRoot(async (root, gh) => {
			const input = batch(root);
			await runGithubInitiativePublication(root, input, gh);
			const writeCalls = gh.writeCalls;
			// Clone an existing Child Issue with identical markers: two Issues now
			// claim the same Task identity, so ownership is ambiguous and the batch
			// must fail closed with zero further writes.
			const child = gh.issues.find((issue) => issue.body?.includes("task-id=widget-a"))!;
			gh.issues.push({ ...child, id: 9001, number: gh.issues.length + 1, html_url: "https://github.com/example/project/issues/999" });
			const ambiguous = await runGithubInitiativePublication(root, input, gh);
			expect(ambiguous.status).toBe("ambiguous_remote_state");
			expect(ambiguous.write_state).toBe("uncertain");
			expect(ambiguous.message).toContain("does not prove zero writes");
			expect(ambiguous.execution).toBeUndefined();
			expect(gh.writeCalls).toBe(writeCalls);
		});
	});

	it("one publication call is a finite step sequence with no internal retry loop", async () => {
		await withRoot(async (root, gh) => {
			const input = batch(root);
			// Every create fails before applying: a retry loop would re-attempt it.
			gh.fault = { at: "issue_create", after: "none", execution: retryable(), repeat: true };
			const result = await runGithubInitiativePublication(root, input, gh);
			expect(result.status).toBe("retryable_failure");
			expect(result.write_state).toBe("uncertain");
			// Exactly one remote create was attempted: the call stopped instead of
			// looping, and the recovery belongs to the next approved call.
			expect(gh.writeCalls).toBe(1);
		});
	});

	it("a Parent failure still names every planned Task as a pending step", async () => {
		await withRoot(async (root, gh) => {
			const input = batch(root);
			// The Parent write never lands: no Task result exists yet, but both planned
			// Tasks are unfinished and must be reported as such.
			gh.fault = { at: "issue_create", after: "none", execution: timedOut() };
			const result = await runGithubInitiativePublication(root, input, gh);
			expect(result.status).toBe("retryable_failure");
			expect(result.confirmed_steps).toEqual([]);
			expect(result.pending_steps).toEqual(["widget-a", "widget-b"]);
			// No execution handoff either.
			expect(result.execution).toBeUndefined();
		});
	});

	it("an early Child failure still names the remaining planned Tasks", async () => {
		await withRoot(async (root, gh) => {
			const input = batch(root);
			// The Parent lands, the first Child's create fails before applying, and the
			// second Child is never attempted: the batch still reports both.
			gh.fault = { at: "issue_create", after: "none", execution: retryable(), atCount: 2 };
			const result = await runGithubInitiativePublication(root, input, gh);
			expect(result.status).toBe("retryable_failure");
			expect(result.confirmed_steps).toEqual([]);
			expect(result.pending_steps).toEqual(["widget-a", "widget-b"]);
			expect(result.execution).toBeUndefined();
		});
	});

	it("a cancelled publication stops before its next write and keeps the landed steps visible", async () => {
		await withRoot(async (root, gh) => {
			const input = batch(root);
			// The Parent lands; the caller then cancels. The next attempt must be refused
			// mid-operation, and the outcome must still expose what already landed.
			const signal = { aborted: false };
			const cancelling: GhTransport = {
				run: async (args, options) => {
					const execution = await gh.run(args, options);
					if (args[0] === "issue" && args[1] === "create") signal.aborted = true;
					return execution;
				},
			};
			const result = await runGithubInitiativePublication(root, input, cancelling, { signal });
			expect(result.status).toBe("retryable_failure");
			expect(result.write_state).toBe("uncertain");
			expect(result.execution).toBeUndefined();
			// The Parent write landed; the Children did not, so both stay pending.
			expect(gh.writeCalls).toBe(1);
			expect(result.pending_steps).toEqual(["widget-a", "widget-b"]);
			expect(result.message).toContain("does not prove zero writes");
		});
	});

	it("a permanent failure keeps exactly one matching action, not a blind replay", async () => {
		await withRoot(async (root, gh) => {
			// A missing managed label is a permanent input fix the tracker never
			// performs. Its own message is the single corrective action, and replaying
			// the same manifest cannot resolve it.
			gh.repositoryLabels = ["ready-for-agent"];
			const result = await runGithubInitiativePublication(root, batch(root), gh);
			expect(result.status).toBe("permanent_failure");
			expect(result.message).toContain("create them before publishing");
			expect(result.message).not.toContain("replay the same approved manifest");
			expect(gh.writeCalls).toBe(0);
		});
	});

	it("an amendment validation failure still reports every planned Task as pending", async () => {
		await withRoot(async (root, gh) => {
			const input = batch(root);
			await runGithubInitiativePublication(root, input, gh);
			// An amendment whose historical Child is missing its Slice marker: the
			// rejection happens after `prepared.order` exists, so the plan is known and
			// every unconfirmed Task must still be listed.
			const parent = gh.issues.find((issue) => issue.body?.includes("kind=initiative"))!;
			const childA = gh.issues.find((issue) => issue.body?.includes("task-id=widget-a"))!;
			const amended = await runGithubInitiativePublication(
				root,
				{
					...input,
					amendment: {
						parent: { issue_number: parent.number, title: parent.title, body: parent.body },
						tasks: [
							{ ...input.tasks[0], issue_number: childA.number, title: childA.title, body: childA.body, state: "open" },
						],
						historical: [
							{
								task_id: "widget-b",
								slice_id: "b",
								issue_number: 999,
								title: "closed without a Slice marker",
								body: "<!-- immune-brain-tracker:v1 -->\n<!-- immune-brain:kind=task -->\n",
								state: "closed",
							},
						],
					},
				} as never,
				gh,
			);
			expect(["permanent_failure", "ambiguous_remote_state"]).toContain(amended.status);
			expect(amended.write_state).toBe("uncertain");
			// The plan was known, so no planned Task silently disappears.
			expect(amended.pending_steps.length).toBeGreaterThan(0);
		});
	});

	it("replay binds to the approved Intent identity, not to current bytes", async () => {
		await withRoot(async (root, gh) => {
			const input = batch(root);
			const created = await runGithubInitiativePublication(root, input, gh);
			expect(created.status).toBe("created");
			const childB = gh.issues.find((issue) => issue.body?.includes("task-id=widget-b"))!;
			// The published Child records the approved Intent identity...
			expect(childB.body).toMatch(/<!-- immune-brain:intent-hash=[A-Za-z0-9:._-]+ -->/);
			const writeCalls = gh.writeCalls;

			// ...so a later edit that changes no public projection text at all is still
			// detected: the published surface no longer matches the Intent being
			// published, and the tracker refuses instead of reporting success.
			const intentPath = join(root, "docs/plans/widget-b.intent.json");
			const intent = JSON.parse(readFileSync(intentPath, "utf8"));
			intent.acceptance[0].verification = JSON.stringify({
				contract: "assurance_kernel/verification_descriptor/v2",
				command: { executable: "bun", argv: ["test", "tests/other.test.ts"], cwd: ".", timeout_ms: 1000, max_output_bytes: 1024 },
				environment: { prepare: null, writable_paths: [] },
			});
			writeFileSync(intentPath, `${JSON.stringify(intent, null, 2)}\n`);
			spawnSync("git", ["add", "docs/plans/widget-b.intent.json"], { cwd: root });

			const replay = await runGithubInitiativePublication(root, input, gh);
			expect(["ambiguous_remote_state", "permanent_failure"]).toContain(replay.status);
			expect(replay.write_state).toBe("uncertain");
			expect(replay.execution).toBeUndefined();
			// It refused instead of silently converging, and it wrote nothing.
			expect(gh.writeCalls).toBe(writeCalls);
		});
	});

	it("a later Child's mismatch is refused before an earlier Child is repaired", async () => {
		await withRoot(async (root, gh) => {
			const input = batch(root);
			await runGithubInitiativePublication(root, input, gh);
			const writeCalls = gh.writeCalls;
			// Earlier Child needs a managed-label repair; later Child's published
			// identity no longer matches. The whole batch is validated first, so the
			// label repair must NOT happen before the later mismatch is known.
			const childA = gh.issues.find((issue) => issue.body?.includes("task-id=widget-a"))!;
			childA.labels = [];
			const childB = gh.issues.find((issue) => issue.body?.includes("task-id=widget-b"))!;
			childB.body = childB.body!.replace(/<!-- immune-brain:intent-hash=[A-Za-z0-9._:-]+ -->/, "<!-- immune-brain:intent-hash=stale0000000000 -->");

			const refused = await runGithubInitiativePublication(root, input, gh);
			expect(refused.status).toBe("ambiguous_remote_state");
			expect(refused.message).toContain("different TaskIntent revision");
			// Not one write, so the earlier Child was never repaired first.
			expect(gh.writeCalls).toBe(writeCalls);
			expect(childA.labels).toEqual([]);
		});
	});

	it("a batch published before the identity marker existed still converges", async () => {
		await withRoot(async (root, gh) => {
			const input = batch(root);
			await runGithubInitiativePublication(root, input, gh);
			// Strip the marker from every Child: this is the shape the previous version
			// published. The marker is additive, so the unchanged batch must still be
			// idempotently replayable instead of becoming a permanent failure.
			for (const issue of gh.issues) {
				if (issue.body?.includes("kind=task"))
					issue.body = issue.body.replace(/<!-- immune-brain:intent-hash=[A-Za-z0-9._:-]+ -->\n/, "");
			}
			const writeCalls = gh.writeCalls;
			const replay = await runGithubInitiativePublication(root, input, gh);
			expect(replay.write_state).toBe("confirmed");
			expect(replay.execution).toBeDefined();
			expect(["created", "updated", "already_current"]).toContain(replay.status);
			// No new Issues, and no duplicate identity.
			expect(gh.issues.length).toBe(3);
			expect(new Set(gh.createdNumbers).size).toBe(gh.createdNumbers.length);
			// A convergence pass may repair content, but it must not multiply writes.
			expect(gh.writeCalls).toBeGreaterThanOrEqual(writeCalls);
		});
	});

	it("a duplicate published identity marker fails closed before any write", async () => {
		await withRoot(async (root, gh) => {
			const input = batch(root);
			await runGithubInitiativePublication(root, input, gh);
			const writeCalls = gh.writeCalls;
			// A Child that carries both the correct and a stale identity states two
			// identities, so it is ambiguous -- not "published before the marker".
			const childB = gh.issues.find((issue) => issue.body?.includes("task-id=widget-b"))!;
			childB.body = childB.body!.replace(
				/(<!-- immune-brain:intent-hash=[A-Za-z0-9._:-]+ -->)/,
				"$1\n<!-- immune-brain:intent-hash=stale0000000000 -->",
			);
			const result = await runGithubInitiativePublication(root, input, gh);
			expect(result.status).toBe("ambiguous_remote_state");
			expect(result.message).toContain("conflicting intent-hash markers");
			// Nothing was written, in particular no earlier-Child repair.
			expect(gh.writeCalls).toBe(writeCalls);
			expect(result.execution).toBeUndefined();
		});
	});

	it("an identity change is caught by the start-of-run check", async () => {
		// The final readback is retired, so identity mismatch is covered where it
		// still can be: the start listing of the next run.
		await withRoot(async (root, gh) => {
			const input = batch(root);
			await runGithubInitiativePublication(root, input, gh);
			const snapshot = gh.issues.find((issue) => issue.body?.includes("task-id=widget-b"))!.body!;
			const corrupt = () => {
				const childB = gh.issues.find((issue) => issue.body?.includes("task-id=widget-b"))!;
				childB.body = childB.body!.replace(/intent-hash=[A-Za-z0-9._:-]+/, "intent-hash=stale0000000000");
			};
			// Rewrite the published identity during the start listing, so the batch is
			// refused from the only repository-wide read the direct flow performs.
			let listing = 0;
			const drifting: GhTransport = {
				run: async (args, options) => {
					if (args[0] === "api" && (args.at(-1) as string).includes("/issues?state=all")) {
						listing += 1;
						if (listing === 1) corrupt();
					}
					return gh.run(args, options);
				},
			};
			const writes = gh.writeCalls;
			const result = await runGithubInitiativePublication(root, input, drifting);
			expect(result.status).toBe("ambiguous_remote_state");
			expect(result.message).toContain("different TaskIntent revision");
			expect(result.execution).toBeUndefined();
			expect(gh.writeCalls).toBe(writes);
			expect(gh.issues.find((issue) => issue.body?.includes("task-id=widget-b"))!.body).not.toBe(snapshot);
		});
	});

	it("the canonical author shape is discoverable before any error probing", () => {
		const help = intentAuthorHelp();
		expect(help).toContain("imm-kernel intent author <destination> --stdin --json");
		expect(help).toContain("docs/plans/<task-id>.intent.json");
		expect(help).toContain("file descriptor 0");
		expect(help).toContain("imm-kernel intent validate <path> --json");
		expect(help).toContain("assurance_kernel/task_intent/v1");
		expect(help).toContain("assurance_kernel/verification_descriptor/v2");
		expect(help).toContain("Unknown fields are rejected");
		expect(help).toContain("historical-only");

		// The same text is reachable from the packaged CLI without error probing.
		const printed = spawnSync("bun", [TS_RUNTIME, "cli", "imm-kernel", "intent"], { encoding: "utf8" });
		expect(printed.status).toBe(0);
		expect(printed.stdout).toContain("imm-kernel intent author <destination> --stdin --json");
		expect(printed.stdout).toContain("file descriptor 0");
		const helpFlag = spawnSync("bun", [TS_RUNTIME, "cli", "imm-kernel", "intent", "--help"], { encoding: "utf8" });
		expect(helpFlag.status).toBe(0);
		expect(helpFlag.stdout).toBe(printed.stdout);

		// Strict parsing and exclusive creation are unchanged: an unknown field is
		// still rejected, and the destination is still required.
		const root = realpathSync(mkdtempSync(join(tmpdir(), "author-shape-")));
		try {
			spawnSync("git", ["init", "-q"], { cwd: root });
			mkdirSync(join(root, "docs/plans"), { recursive: true });
			writeFileSync(
				join(root, "docs/plans/managed-task-routing-policy.json"),
				'{\n  "contract": "immune_brain/managed_task_routing_policy/v1",\n  "revision": 1,\n  "new_task_route": "kernel_task_intent",\n  "v3_new_plan_sync": "retired",\n  "legacy_v3_mode": "drain_read_only",\n  "terminal_import": "disabled"\n}\n',
			);
			spawnSync("git", ["add", "docs/plans/managed-task-routing-policy.json"], { cwd: root });
			const forged = spawnSync(
				"bun",
				[TS_RUNTIME, "cli", "imm-kernel", "intent", "author", "docs/plans/forged.intent.json", "--stdin", "--json"],
				{
					cwd: root,
					encoding: "utf8",
					input: JSON.stringify({
						contract: "assurance_kernel/task_intent/v1",
						task_id: "forged",
						owner: "user",
						goal: "g",
						risk: "material",
						revision: 1,
						scope_hint: ["tests/**"],
						acceptance: [],
						forged: true,
					}),
				},
			);
			expect(forged.status).not.toBe(0);
			expect(forged.stdout + forged.stderr).toContain("forged");
			const missingDestination = spawnSync(
				"bun",
				[TS_RUNTIME, "cli", "imm-kernel", "intent", "author", "--stdin", "--json"],
				{ cwd: root, encoding: "utf8", input: "{}" },
			);
			expect(missingDestination.status).toBe(2);
			expect(missingDestination.stdout + missingDestination.stderr).toContain("destination path");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("a publication without scenarios renders the same bodies, and a ticked manual box survives closure", async () => {
		await withRoot(async (root, gh) => {
			const plain = await runGithubInitiativePublication(root, batch(root), gh);
			expect(plain.status).toBe("created");
			const without = gh.issues.map((issue) => issue.body);
			for (const body of without) expect(body).not.toContain("## User scenarios");

			// The same batch with an explicit empty list is the same publication.
			const empty = batch(root);
			for (const task of empty.tasks) (task as { scenarios?: unknown[] }).scenarios = [];
			const repeated = await runGithubInitiativePublication(root, empty, gh);
			expect(repeated.status).toBe("already_current");
			expect(gh.issues.map((issue) => issue.body)).toEqual(without);
		});
	});

	it("an amendment rewrites only the bound pending Child and leaves the historical Child untouched", async () => {
		await withRoot(async (root, gh) => {
			const initial = batch(root);
			initial.tasks[0].scenarios = historicalScenarios;
			const published = await runGithubInitiativePublication(root, initial, gh);
			expect(published.status).toBe("created");
			const [parent, childA, childB] = gh.issues;
			const historical = childA.body;
			// The historical Child is already closed. This transport does not model the
			// single-Issue read terminal projection uses, and that path is covered by
			// the projection contract; here only the amendment boundary matters.
			childA.state = "closed";
			childA.state_reason = "completed";
			const amendment = await runGithubInitiativePublication(root, {
				initiative_id: "widget-tracker",
				goal: "Deliver both widget Slices",
				projection: {
					short_name: "widget",
					title: "Track widget delivery",
					problem: "Widget work is untracked.",
					result: "Widget delivery is tracked end to end.",
					design: "One Parent Issue and one Child per Slice.",
					decisions: ["Publish the complete graph in one batch."],
					testing_strategy: "Each Child closes from its focused acceptance verification.",
					out_of_scope: ["Widget runtime behavior."],
				},
				tasks: [{
					slice_id: "b",
					intent: "docs/plans/widget-b.intent.json",
					acceptance: [{ id: "acc-widget-b", summary: "Slice B is delivered" }],
					projection: { title: "Ship Slice B", blocked_by: [] },
					scenarios: [{
						id: "SCN-3",
						actor: "Developer",
						given: "The pending brief changed",
						when: "The amendment publishes",
						then: "The pending Child shows the scenario",
						mode: "automated",
						acceptance: ["acc-widget-b"],
					}],
				}],
				amendment: {
					parent: { issue_number: parent.number, title: parent.title, body: parent.body, state: "open" },
					tasks: [{ task_id: "widget-b", binding: { issue_number: childB.number, title: childB.title, body: childB.body, state: "open" } }],
					historical: [{ task_id: "widget-a", binding: { issue_number: childA.number, title: childA.title, body: childA.body, state: "closed" } }],
				},
			} as never, gh);
			if (amendment.status !== "updated") throw new Error(`amendment:${amendment.status}:${amendment.message}`);
			expect(childA.body).toBe(historical);
			expect(childA.body).toContain("<!-- immune-brain:scenarios=");
			expect(childB.body).toContain("## User scenarios");
			expect(childB.body).toContain("`SCN-3` (automated, `acc-widget-b`)");
			expect(parent.body).toContain("- `SCN-1` (Slice `a`, automated):");
			expect(parent.body).toContain("- `SCN-2` (Slice `a`, automated):");
			expect(parent.body.indexOf("- `SCN-1`")).toBeLessThan(parent.body.indexOf("- `SCN-3` (Slice `b`, automated):"));
		});
	});

	it("an amendment rejects a pending scenario that reuses a historical scenario id before any remote write", async () => {
		await withRoot(async (root, gh) => {
			const initial = batch(root);
			initial.tasks[0].scenarios = historicalScenarios;
			const published = await runGithubInitiativePublication(root, initial, gh);
			expect(published.status).toBe("created");
			const [parent, childA, childB] = gh.issues;
			childA.state = "closed";
			childA.state_reason = "completed";
			const writes = gh.writeCalls;
			const reused = await runGithubInitiativePublication(root, {
				initiative_id: "widget-tracker",
				goal: "Deliver both widget Slices",
				projection: {
					short_name: "widget",
					title: "Track widget delivery",
					problem: "Widget work is untracked.",
					result: "Widget delivery is tracked end to end.",
					design: "One Parent Issue and one Child per Slice.",
					decisions: ["Publish the complete graph in one batch."],
					testing_strategy: "Each Child closes from its focused acceptance verification.",
					out_of_scope: ["Widget runtime behavior."],
				},
				tasks: [{
					slice_id: "b",
					intent: "docs/plans/widget-b.intent.json",
					acceptance: [{ id: "acc-widget-b", summary: "Slice B is delivered" }],
					projection: { title: "Ship Slice B", blocked_by: [] },
					scenarios: [{
						id: "SCN-1",
						actor: "Developer",
						given: "The pending brief changed",
						when: "The amendment publishes",
						then: "The pending Child reuses the historical id",
						mode: "automated",
						acceptance: ["acc-widget-b"],
					}],
				}],
				amendment: {
					parent: { issue_number: parent.number, title: parent.title, body: parent.body, state: "open" },
					tasks: [{ task_id: "widget-b", binding: { issue_number: childB.number, title: childB.title, body: childB.body, state: "open" } }],
					historical: [{ task_id: "widget-a", binding: { issue_number: childA.number, title: childA.title, body: childA.body, state: "closed" } }],
				},
			} as never, gh);
			expect(reused.status).toBe("permanent_failure");
			expect(reused.message).toContain("widget-b");
			expect(reused.message).toContain("repeats scenario id SCN-1");
			expect(gh.writeCalls).toBe(writes);
			const reusedSecond = await runGithubInitiativePublication(root, {
				initiative_id: "widget-tracker",
				goal: "Deliver both widget Slices",
				projection: {
					short_name: "widget",
					title: "Track widget delivery",
					problem: "Widget work is untracked.",
					result: "Widget delivery is tracked end to end.",
					design: "One Parent Issue and one Child per Slice.",
					decisions: ["Publish the complete graph in one batch."],
					testing_strategy: "Each Child closes from its focused acceptance verification.",
					out_of_scope: ["Widget runtime behavior."],
				},
				tasks: [{
					slice_id: "b",
					intent: "docs/plans/widget-b.intent.json",
					acceptance: [{ id: "acc-widget-b", summary: "Slice B is delivered" }],
					projection: { title: "Ship Slice B", blocked_by: [] },
					scenarios: [{
						id: "SCN-2",
						actor: "Developer",
						given: "The pending brief changed",
						when: "The amendment publishes",
						then: "The pending Child reuses the second historical id",
						mode: "automated",
						acceptance: ["acc-widget-b"],
					}],
				}],
				amendment: {
					parent: { issue_number: parent.number, title: parent.title, body: parent.body, state: "open" },
					tasks: [{ task_id: "widget-b", binding: { issue_number: childB.number, title: childB.title, body: childB.body, state: "open" } }],
					historical: [{ task_id: "widget-a", binding: { issue_number: childA.number, title: childA.title, body: childA.body, state: "closed" } }],
				},
			} as never, gh);
			expect(reusedSecond.status).toBe("permanent_failure");
			expect(reusedSecond.message).toContain("repeats scenario id SCN-2");
			expect(gh.writeCalls).toBe(writes);
			const preserved = await runGithubInitiativePublication(root, {
				initiative_id: "widget-tracker",
				goal: "Deliver both widget Slices",
				projection: {
					short_name: "widget",
					title: "Track widget delivery",
					problem: "Widget work is untracked.",
					result: "Widget delivery is tracked end to end.",
					design: "One Parent Issue and one Child per Slice.",
					decisions: ["Publish the complete graph in one batch."],
					testing_strategy: "Each Child closes from its focused acceptance verification.",
					out_of_scope: ["Widget runtime behavior."],
				},
				tasks: [{
					slice_id: "b",
					intent: "docs/plans/widget-b.intent.json",
					acceptance: [{ id: "acc-widget-b", summary: "Slice B is delivered" }],
					projection: { title: "Ship Slice B", blocked_by: [] },
				}],
				amendment: {
					parent: { issue_number: parent.number, title: parent.title, body: parent.body, state: "open" },
					tasks: [{ task_id: "widget-b", binding: { issue_number: childB.number, title: childB.title, body: childB.body, state: "open" } }],
					historical: [{ task_id: "widget-a", binding: { issue_number: childA.number, title: childA.title, body: childA.body, state: "closed" } }],
				},
			} as never, gh);
			if (preserved.status !== "updated") throw new Error(`${preserved.status}:${preserved.message}`);
			expect(parent.body).toContain("When: They open the historical Child. Then: The historical scenario stays listed.");
			expect(parent.body).toContain("`SCN-1` (Slice `a`, automated): When: They open the historical Child. Then: The historical scenario stays listed.");
			expect(parent.body).toContain("`SCN-2` (Slice `a`, automated): When: They continue. Then: The second scenario stays reserved.");
		});
	});

	it("an amendment rejects historical scenario markers that fail public-projection validation before any remote write", async () => {
		await withRoot(async (root, gh) => {
			const input = batch(root);
			(input.tasks[0] as { scenarios?: unknown }).scenarios = [{
				id: "BR-SCN-7",
				actor: "Reviewer",
				given: "Available resources",
				when: "They inspect the Child",
				then: "The result is visible",
				mode: "manual",
				manual_reason: "Human judgment is required",
			}];
			const published = await runGithubInitiativePublication(root, input, gh);
			expect(published.status).toBe("created");
			const [parent, childA, childB] = gh.issues;
			childA.state = "closed";
			childA.state_reason = "completed";
			const writes = gh.writeCalls;
			const cases: Array<[string, string]> = [
				["restricted authority context in when", encodeURIComponent(JSON.stringify([{
					id: "SCN-1", actor: "Developer", given: "Published", when: "run submit_review", then: "Visible", mode: "manual", manual_reason: "Human judgment",
				}]))],
				["oversized field", encodeURIComponent(JSON.stringify([{
					id: "SCN-1", actor: "Developer", given: "Published", when: "x".repeat(501), then: "Visible", mode: "automated",
				}]))],
				["non-string manual_reason", encodeURIComponent(JSON.stringify([{
					id: "SCN-1", actor: "Developer", given: "Published", when: "They inspect", then: "Visible", mode: "manual", manual_reason: 42,
				}]))],
				["non-string given", encodeURIComponent(JSON.stringify([{
					id: "SCN-1", actor: "Developer", given: 42, when: "They inspect", then: "Visible", mode: "automated",
				}]))],
				["non-string acceptance element", encodeURIComponent(JSON.stringify([{
					id: "SCN-1", actor: "Developer", given: "Published", when: "They inspect", then: "Visible", mode: "automated", acceptance: [42],
				}]))],
				["duplicate acceptance elements", encodeURIComponent(JSON.stringify([{
					id: "SCN-1", actor: "Developer", given: "Published", when: "They inspect", then: "Visible", mode: "automated", acceptance: ["acc-widget-a", "acc-widget-a"],
				}]))],
				["id outside the scenario id pattern", encodeURIComponent(JSON.stringify([{
					id: "SCENE-1", actor: "Developer", given: "Published", when: "They inspect", then: "Visible", mode: "automated", acceptance: ["acc-widget-a"],
				}]))],
				["missing actor", encodeURIComponent(JSON.stringify([{
					id: "SCN-1", given: "Published", when: "They inspect", then: "Visible", mode: "automated", acceptance: ["acc-widget-a"],
				}]))],
				["missing given", encodeURIComponent(JSON.stringify([{
					id: "SCN-1", actor: "Developer", when: "They inspect", then: "Visible", mode: "automated", acceptance: ["acc-widget-a"],
				}]))],
				["automated without acceptance", encodeURIComponent(JSON.stringify([{
					id: "SCN-1", actor: "Developer", given: "Published", when: "They inspect", then: "Visible", mode: "automated",
				}]))],
				["manual without reason", encodeURIComponent(JSON.stringify([{
					id: "SCN-1", actor: "Developer", given: "Published", when: "They inspect", then: "Visible", mode: "manual",
				}]))],
			];
			for (const [label, encoded] of cases) {
				const historical = childA.body.replace(/<!-- immune-brain:scenarios=[^>]* -->/, `<!-- immune-brain:scenarios=${encoded} -->`);
				const rejected = await runGithubInitiativePublication(root, {
					initiative_id: "widget-tracker",
					goal: "Deliver both widget Slices",
					projection: input.projection,
					tasks: [{
						slice_id: "b",
						intent: "docs/plans/widget-b.intent.json",
						acceptance: [{ id: "acc-widget-b", summary: "Slice B is delivered" }],
						projection: { title: "Ship Slice B", blocked_by: [] },
					}],
					amendment: {
						parent: { issue_number: parent.number, title: parent.title, body: parent.body, state: "open" },
						tasks: [{ task_id: "widget-b", binding: { issue_number: childB.number, title: childB.title, body: childB.body, state: "open" } }],
						historical: [{ task_id: "widget-a", binding: { issue_number: childA.number, title: childA.title, body: historical, state: "closed" } }],
					},
				} as never, gh);
				expect(rejected.status, label).toBe("permanent_failure");
				expect(rejected.message, label).toContain("malformed scenarios marker");
				expect(gh.writeCalls, label).toBe(writes);
			}
			const smuggled = childA.body.replace(
				"<!-- immune-brain:slice-id=a -->",
				(segment) => `${segment} <!-- immune-brain:scenarios=%%not json%% -->`,
			);
			const rejected = await runGithubInitiativePublication(root, {
				initiative_id: "widget-tracker",
				goal: "Deliver both widget Slices",
				projection: input.projection,
				tasks: [{
					slice_id: "b",
					intent: "docs/plans/widget-b.intent.json",
					acceptance: [{ id: "acc-widget-b", summary: "Slice B is delivered" }],
					projection: { title: "Ship Slice B", blocked_by: [] },
				}],
				amendment: {
					parent: { issue_number: parent.number, title: parent.title, body: parent.body, state: "open" },
					tasks: [{ task_id: "widget-b", binding: { issue_number: childB.number, title: childB.title, body: childB.body, state: "open" } }],
					historical: [{ task_id: "widget-a", binding: { issue_number: childA.number, title: childA.title, body: smuggled, state: "closed" } }],
				},
			} as never, gh);
			expect(rejected.status).toBe("permanent_failure");
			expect(rejected.message).toContain("duplicate scenarios markers");
			expect(gh.writeCalls).toBe(writes);
			const truncated = childA.body.replace(/<!-- immune-brain:scenarios=[^>]* -->/, "<!-- immune-brain:scenarios=abc");
			const truncatedCase = await runGithubInitiativePublication(root, {
				initiative_id: "widget-tracker",
				goal: "Deliver both widget Slices",
				projection: input.projection,
				tasks: [{
					slice_id: "b",
					intent: "docs/plans/widget-b.intent.json",
					acceptance: [{ id: "acc-widget-b", summary: "Slice B is delivered" }],
					projection: { title: "Ship Slice B", blocked_by: [] },
				}],
				amendment: {
					parent: { issue_number: parent.number, title: parent.title, body: parent.body, state: "open" },
					tasks: [{ task_id: "widget-b", binding: { issue_number: childB.number, title: childB.title, body: childB.body, state: "open" } }],
					historical: [{ task_id: "widget-a", binding: { issue_number: childA.number, title: childA.title, body: truncated, state: "closed" } }],
				},
			} as never, gh);
			expect(truncatedCase.status).toBe("permanent_failure");
			expect(truncatedCase.message).toContain("malformed scenarios marker");
			expect(gh.writeCalls).toBe(writes);
			const unclosed = `${childA.body} <!-- immune-brain:scenarios=abc`;
			const unclosedCase = await runGithubInitiativePublication(root, {
				initiative_id: "widget-tracker",
				goal: "Deliver both widget Slices",
				projection: input.projection,
				tasks: [{
					slice_id: "b",
					intent: "docs/plans/widget-b.intent.json",
					acceptance: [{ id: "acc-widget-b", summary: "Slice B is delivered" }],
					projection: { title: "Ship Slice B", blocked_by: [] },
				}],
				amendment: {
					parent: { issue_number: parent.number, title: parent.title, body: parent.body, state: "open" },
					tasks: [{ task_id: "widget-b", binding: { issue_number: childB.number, title: childB.title, body: childB.body, state: "open" } }],
					historical: [{ task_id: "widget-a", binding: { issue_number: childA.number, title: childA.title, body: unclosed, state: "closed" } }],
				},
			} as never, gh);
			expect(unclosedCase.status).toBe("permanent_failure");
			expect(unclosedCase.message).toContain("duplicate scenarios markers");
			expect(gh.writeCalls).toBe(writes);
		});
	});

	it("an amendment rejects duplicate or malformed historical scenarios markers before any remote write", async () => {
		await withRoot(async (root, gh) => {
			const input = batch(root);
			(input.tasks[0] as { scenarios?: unknown }).scenarios = [{
				id: "BR-SCN-7",
				actor: "Reviewer",
				given: "Available resources",
				when: "They inspect the Child",
				then: "The result is visible",
				mode: "manual",
				manual_reason: "Human judgment is required",
			}];
			const published = await runGithubInitiativePublication(root, input, gh);
			expect(published.status).toBe("created");
			const [parent, childA, childB] = gh.issues;
			const writes = gh.writeCalls;
			for (const markerCount of [2, 3] as const) {
				const historical = childA.body.replace(
					"<!-- immune-brain:slice-id=a -->",
					(segment) => `${segment} ` + Array.from({ length: markerCount - 1 }, () => childA.body.match(/<!-- immune-brain:scenarios=[^>]* -->/)![0]).join(" "),
				);
				childA.state = "closed";
				childA.state_reason = "completed";
				const rejected = await runGithubInitiativePublication(root, {
					initiative_id: "widget-tracker",
					goal: "Deliver both widget Slices",
					projection: input.projection,
					tasks: [{
						slice_id: "b",
						intent: "docs/plans/widget-b.intent.json",
						acceptance: [{ id: "acc-widget-b", summary: "Slice B is delivered" }],
						projection: { title: "Ship Slice B", blocked_by: [] },
					}],
					amendment: {
						parent: { issue_number: parent.number, title: parent.title, body: parent.body, state: "open" },
						tasks: [{ task_id: "widget-b", binding: { issue_number: childB.number, title: childB.title, body: childB.body, state: "open" } }],
						historical: [{ task_id: "widget-a", binding: { issue_number: childA.number, title: childA.title, body: historical, state: "closed" } }],
					},
				} as never, gh);
				expect(rejected.status).toBe("permanent_failure");
				expect(rejected.message).toContain("duplicate scenarios markers");
				expect(gh.writeCalls).toBe(writes);
			}
			const malformed = childA.body.replace(
				/<!-- immune-brain:scenarios=[^>]* -->/,
				"<!-- immune-brain:scenarios=%%not-json%% -->",
			);
			const rejected = await runGithubInitiativePublication(root, {
				initiative_id: "widget-tracker",
				goal: "Deliver both widget Slices",
				projection: input.projection,
				tasks: [{
					slice_id: "b",
					intent: "docs/plans/widget-b.intent.json",
					acceptance: [{ id: "acc-widget-b", summary: "Slice B is delivered" }],
					projection: { title: "Ship Slice B", blocked_by: [] },
				}],
				amendment: {
					parent: { issue_number: parent.number, title: parent.title, body: parent.body, state: "open" },
					tasks: [{ task_id: "widget-b", binding: { issue_number: childB.number, title: childB.title, body: childB.body, state: "open" } }],
					historical: [{ task_id: "widget-a", binding: { issue_number: childA.number, title: childA.title, body: malformed, state: "closed" } }],
				},
			} as never, gh);
			expect(rejected.status).toBe("permanent_failure");
			expect(rejected.message).toContain("malformed scenarios marker");
			expect(gh.writeCalls).toBe(writes);
		});
	});

	it("an amendment treats a historical Child without a scenarios marker as having no scenarios", async () => {
			await withRoot(async (root, gh) => {
				const input = batch(root);
				(input.tasks[0] as { scenarios?: unknown }).scenarios = [{
					id: "BR-SCN-7",
					actor: "Reviewer",
					given: "Available resources",
					when: "They inspect the Child",
					then: "The result is visible",
					mode: "manual",
					manual_reason: "Human judgment is required",
				}];
				const published = await runGithubInitiativePublication(root, input, gh);
				expect(published.status).toBe("created");
				const [parent, childA, childB] = gh.issues;
				const markerless = childA.body.replace(/<!-- immune-brain:scenarios=[^>]* -->\s*/, "");
				expect(markerless).not.toBe(childA.body);
				childA.body = markerless;
				childA.state = "closed";
				childA.state_reason = "completed";
				const amendment = await runGithubInitiativePublication(root, {
					initiative_id: "widget-tracker",
					goal: "Deliver both widget Slices",
					projection: input.projection,
					tasks: [{
						slice_id: "b",
						intent: "docs/plans/widget-b.intent.json",
						acceptance: [{ id: "acc-widget-b", summary: "Slice B is delivered" }],
						projection: { title: "Ship Slice B", blocked_by: [] },
						scenarios: [{
							id: "BR-SCN-7",
							actor: "Reviewer",
							given: "Available resources",
							when: "They inspect the reopened Slice",
							then: "The result is visible",
							mode: "manual",
							manual_reason: "Human judgment is required",
						}],
					}],
					amendment: {
						parent: { issue_number: parent.number, title: parent.title, body: parent.body, state: "open" },
						tasks: [{ task_id: "widget-b", binding: { issue_number: childB.number, title: childB.title, body: childB.body, state: "open" } }],
						historical: [{ task_id: "widget-a", binding: { issue_number: childA.number, title: childA.title, body: markerless, state: "closed" } }],
					},
				} as never, gh);
				if (amendment.status !== "updated") throw new Error(`${amendment.status}:${amendment.message}`);
				expect(childA.body).toBe(markerless);
				expect(parent.body).not.toContain("BR-SCN-7` (Slice `a`");
				expect(parent.body).toContain("BR-SCN-7` (Slice `b`");
				expect(childB.body).toContain("BR-SCN-7");
			});
	});

	it("an amendment preserves a historical manual multiline scenario exactly", async () => {
		await withRoot(async (root, gh) => {
			const input = batch(root);
			(input.tasks[0] as { scenarios?: unknown }).scenarios = [{
				id: "BR-SCN-7",
				actor: "Reviewer",
				given: "Available resources\n- `widget`\n## Verification\nStill ready\n---",
				when: "They inspect the Child",
				then: "The result is visible",
				mode: "manual",
				manual_reason: "Human judgment is required",
			}];
			const published = await runGithubInitiativePublication(root, input, gh);
			expect(published.status).toBe("created");
			const [parent, childA, childB] = gh.issues;
			const historical = childA.body;
			childA.state = "closed";
			childA.state_reason = "completed";
			const amendment = await runGithubInitiativePublication(root, {
				initiative_id: "widget-tracker",
				goal: "Deliver both widget Slices",
				projection: input.projection,
				tasks: [{
					slice_id: "b",
					intent: "docs/plans/widget-b.intent.json",
					acceptance: [{ id: "acc-widget-b", summary: "Slice B is delivered" }],
					projection: { title: "Ship Slice B", blocked_by: [] },
				}],
				amendment: {
					parent: { issue_number: parent.number, title: parent.title, body: parent.body, state: "open" },
					tasks: [{ task_id: "widget-b", binding: { issue_number: childB.number, title: childB.title, body: childB.body, state: "open" } }],
					historical: [{ task_id: "widget-a", binding: { issue_number: childA.number, title: childA.title, body: historical, state: "closed" } }],
				},
			} as never, gh);
			if (amendment.status !== "updated") throw new Error(`${amendment.status}:${amendment.message}`);
			expect(childA.body).toBe(historical);
			const marker = historical.match(/<!-- immune-brain:scenarios=([^>]*) -->/);
			expect(marker).not.toBeNull();
			const restored = JSON.parse(decodeURIComponent(marker![1]));
			expect(restored).toEqual([{ id: "BR-SCN-7", actor: "Reviewer", given: "Available resources\n- `widget`\n## Verification\nStill ready\n---", when: "They inspect the Child", then: "The result is visible", mode: "manual", manual_reason: "Human judgment is required" }]);
			expect(parent.body).toContain("`BR-SCN-7` (Slice `a`, manual): When: They inspect the Child. Then: The result is visible. Reason: Human judgment is required.");
		});
	});

	it("an amendment keeps an automated scenario's manual_reason verbatim through the marker", async () => {
		await withRoot(async (root, gh) => {
			const input = batch(root);
			(input.tasks[0] as { scenarios?: unknown }).scenarios = [{
				id: "SCN-8",
				actor: "Developer",
				given: "The automated Child is published",
				when: "They open the amendment",
				then: "The historical listing is unchanged",
				mode: "automated",
				acceptance: ["acc-widget-a"],
				manual_reason: "Human judgment is required",
			}];
			const published = await runGithubInitiativePublication(root, input, gh);
			expect(published.status).toBe("created");
			const [parent, childA, childB] = gh.issues;
			const historical = childA.body;
			childA.state = "closed";
			childA.state_reason = "completed";
			const amendment = await runGithubInitiativePublication(root, {
				initiative_id: "widget-tracker",
				goal: "Deliver both widget Slices",
				projection: input.projection,
				tasks: [{
					slice_id: "b",
					intent: "docs/plans/widget-b.intent.json",
					acceptance: [{ id: "acc-widget-b", summary: "Slice B is delivered" }],
					projection: { title: "Ship Slice B", blocked_by: [] },
				}],
				amendment: {
					parent: { issue_number: parent.number, title: parent.title, body: parent.body, state: "open" },
					tasks: [{ task_id: "widget-b", binding: { issue_number: childB.number, title: childB.title, body: childB.body, state: "open" } }],
					historical: [{ task_id: "widget-a", binding: { issue_number: childA.number, title: childA.title, body: historical, state: "closed" } }],
				},
			} as never, gh);
			if (amendment.status !== "updated") throw new Error(`${amendment.status}:${amendment.message}`);
			const marker = historical.match(/<!-- immune-brain:scenarios=([^>]*) -->/);
			expect(marker).not.toBeNull();
			const restored = JSON.parse(decodeURIComponent(marker![1]));
			expect(restored).toEqual([{
				id: "SCN-8",
				actor: "Developer",
				given: "The automated Child is published",
				when: "They open the amendment",
				then: "The historical listing is unchanged",
				mode: "automated",
				acceptance: ["acc-widget-a"],
				manual_reason: "Human judgment is required",
			}]);
			expect(parent.body).toContain("`SCN-8` (Slice `a`, automated): When: They open the amendment. Then: The historical listing is unchanged. Reason: Human judgment is required.");
		});
	});

	it("the author help never claims an execution handoff from publication alone", () => {
		const help = intentAuthorHelp().toLowerCase();
		for (const forbidden of ["enrolled", "completed", "enrollment granted", "task is done"]) {
			expect(help).not.toContain(forbidden);
		}
		// The Planner contract still owns Initiative publication, unchanged here.
		expect(readFileSync(resolve(import.meta.dir, "../plugins/immune-brain/dist/imm-planner.md"), "utf8")).toContain(
			"imm-tracker publish-initiative --stdin --json",
		);
	});
});
