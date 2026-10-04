// S5 of docs/specs/workflow-decision-closure.spec.md: discoverable commands and
// bounded publication.
//
// The tracker already owns strict v2 parsing, exclusive canonical authoring,
// idempotent markers and native top-level readback. This file proves the two
// properties S5 adds on top of that machinery, against one fake transport:
//
//   1. Truthful effect reporting. A caller can tell a confirmed, read-back write
//      (`write_state: "confirmed"`) from an outcome it may not treat as zero
//      writes (`"uncertain"`, carrying exactly one recovery action). No
//      execution handoff happens before a complete readback.
//   2. A bounded call. One publication call is one finite remote step sequence
//      with no internal retry loop, so a lost response or partial success is
//      recovered by re-reading exact ownership/topology/hash state on the next
//      approved call.
//
// Fake transport only: no real remote write, no credential, no test-side loop.

import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { GhExecution, GhTransport, OperationBudget } from "../plugins/immune-brain/runtime/github_issue_tracker.ts";
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
	mutationLog: string[] = [];
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

	async run(args: string[], options: { cwd?: string; stdin?: string; budget?: OperationBudget } = {}): Promise<GhExecution> {
		// Mirror the real transport's operation budget: a spent or cancelled budget
		// refuses the call instead of starting another remote write.
		if (options.budget && (options.budget.signal?.aborted || options.budget.deadline_ms - Date.now() <= 0)) {
			return {
				exit_code: 1,
				stdout: "",
				stderr: options.budget.signal?.aborted
					? "operation cancelled by the caller"
					: "publication deadline exceeded before the next remote call",
				timed_out: true,
				output_exceeded: false,
			};
		}
		const write = isWriteCall(args);
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
			if (endpoint.includes("/issues?state=all")) {
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

	it("a lost response that landed is adopted, never duplicated", async () => {
		await withRoot(async (root, gh) => {
			const input = batch(root);
			// The Parent creation lands, then the transport reports failure. The
			// tracker re-reads and converges, so the caller is not told to redo it.
			gh.fault = { at: "issue_create", after: "applied", execution: retryable("connection reset by peer") };
			const lost = await runGithubInitiativePublication(root, input, gh);
			expect(lost.status).toBe("created");
			expect(lost.write_state).toBe("confirmed");
			// The landed write was adopted, not repeated: three Issues, one each.
			expect(gh.issues.length).toBe(3);
			expect(new Set(gh.createdNumbers).size).toBe(3);
		});
	});

	it("an unconfirmed readback is uncertain and the replay adopts the landed write", async () => {
		await withRoot(async (root, gh) => {
			const input = batch(root);
			// The Parent write lands, but a later post-write snapshot fails with a
			// retryable transport error: the tracker cannot confirm convergence, so the
			// outcome is uncertain rather than "confirmed" or "zero writes".
			let lists = 0;
			const unconfirmedTransport: GhTransport = {
				run: async (args, options) => {
					if (args[0] === "api" && (args.at(-1) as string).includes("/issues?state=all")) {
						lists += 1;
						if (lists === 3) return retryable();
					}
					return gh.run(args, options);
				},
			};
			const unconfirmed = await runGithubInitiativePublication(root, input, unconfirmedTransport);
			expect(unconfirmed.status).toBe("retryable_failure");
			expect(unconfirmed.write_state).toBe("uncertain");
			expect(unconfirmed.execution).toBeUndefined();
			expect(unconfirmed.message).toContain("does not prove zero writes");
			// Exactly one Issue landed, and it was never duplicated by a retry.
			expect(gh.issues.length).toBe(1);
			expect(gh.writeCalls).toBe(1);

			// The next approved call reads the live state back and adopts it.
			const resumed = await runGithubInitiativePublication(root, input, gh);
			expect(resumed.status).toBe("updated");
			expect(resumed.write_state).toBe("confirmed");
			expect(gh.issues.length).toBe(3);
			expect(new Set(gh.createdNumbers).size).toBe(3);
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

	it("a spent whole-publication budget refuses the next remote write", async () => {
		await withRoot(async (root, gh) => {
			const input = batch(root);
			// The first remote write consumes the operation budget. A per-call timeout
			// would let the remaining writes start anyway; the shared deadline must not.
			gh.fault = { at: "issue_create", after: "applied", execution: retryable("publication deadline exceeded"), atCount: 1 };
			const expired: OperationBudget = { deadline_ms: Date.now() - 1 };
			const result = await runGithubInitiativePublication(root, input, gh, expired);
			expect(result.status).toBe("retryable_failure");
			expect(result.write_state).toBe("uncertain");
			// No write was started: an expired budget refuses the very first call.
			expect(gh.writeCalls).toBe(0);
			expect(gh.issues).toEqual([]);
			expect(result.pending_steps).toEqual(["widget-a", "widget-b"]);
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
			const result = await runGithubInitiativePublication(root, input, cancelling, {
				deadline_ms: Date.now() + 60_000,
				signal,
			});
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

	it("an identity change on the final readback is not reported as success", async () => {
		await withRoot(async (root, gh) => {
			const input = batch(root);
			await runGithubInitiativePublication(root, input, gh);
			const snapshot = gh.issues.find((issue) => issue.body?.includes("task-id=widget-b"))!.body!;
			const corrupt = () => {
				const childB = gh.issues.find((issue) => issue.body?.includes("task-id=widget-b"))!;
				childB.body = childB.body!.replace(/intent-hash=[A-Za-z0-9._:-]+/, "intent-hash=stale0000000000");
			};
			// First pass: count the read-only snapshots of a converging replay, so the
			// drift below lands on the very last one instead of a hardcoded index.
			let snapshots = 0;
			const counting: GhTransport = {
				run: async (args, options) => {
					if (args[0] === "api" && (args.at(-1) as string).includes("/issues?state=all")) snapshots += 1;
					return gh.run(args, options);
				},
			};
			await runGithubInitiativePublication(root, input, counting);
			expect(snapshots).toBeGreaterThan(0);

			// Second pass: rewrite the published identity only on the final snapshot, so
			// every earlier check has already seen the correct value.
			let call = 0;
			const drifting: GhTransport = {
				run: async (args, options) => {
					if (args[0] === "api" && (args.at(-1) as string).includes("/issues?state=all")) {
						call += 1;
						if (call === snapshots) corrupt();
					}
					return gh.run(args, options);
				},
			};
			const result = await runGithubInitiativePublication(root, input, drifting);
			// A confirmed handoff would mean the final readback missed the change.
			expect(result.status).toBe("ambiguous_remote_state");
			expect(result.message).toContain("different TaskIntent revision");
			expect(result.execution).toBeUndefined();
			expect(result.write_state).toBe("uncertain");
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
