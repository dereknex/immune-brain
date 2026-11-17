/**
 * Loop Daemon: Decision-Model Thresholds, Judging Agent, Reconciliation & S10 Controls
 *
 * Verifies S10-AC1 and S10-AC2 under docs/plans/loop-daemon-s10-decision-model.intent.json
 * and D12 / SCN-7 in docs/specs/loop-daemon.spec.md.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
	A14_PR_COMMENT_TRIAGE,
	A15_TASK_GRANULARITY,
	A18_EVENT_PREFILTER,
	A19_OWNER_COMMENT_INTENT,
	A20_ISSUE_DUPLICATE_PAIR,
} from "../plugins/immune-brain/runtime/decision_model/thresholds.ts";
import { type Envelope, type ApplicationPointId } from "../plugins/immune-brain/runtime/decision_model/contract.ts";
import {
	type ClassifyFn,
	judgeEvent,
} from "../plugins/immune-brain/runtime/loop_daemon/judgement.ts";
import {
	DUPLICATE_SIMILARITY_FLOOR,
	selectBestDuplicateCandidate,
} from "../plugins/immune-brain/runtime/loop_daemon/duplicate_candidates.ts";
import {
	labelsFilePath,
	loadLoopLabels,
	type LoopLabelRow,
} from "../plugins/immune-brain/runtime/loop_daemon/labels.ts";
import {
	loadReconcileState,
	reconcileCandidates,
} from "../plugins/immune-brain/runtime/loop_daemon/reconcile.ts";
import { listRoleSessions } from "../plugins/immune-brain/runtime/loop_daemon/role_sessions.ts";
import {
	LOOP_DAEMON_EVENT_CONTRACT,
	type E1NewIssueEvent,
	type E3OwnerCommentEvent,
	type E8PRCheckFailedEvent,
	type E10PRReviewCommentEvent,
	type ObservationInput,
	type RawIssue,
} from "../plugins/immune-brain/runtime/loop_daemon/types.ts";
import type { GuardFacts } from "../plugins/immune-brain/runtime/loop_daemon/guards.ts";
import { runLoopDaemonCli } from "../plugins/immune-brain/runtime/loop_daemon/cli.ts";
import {
	createAgentHandlerPort,
	type AgentHandlerDeps,
} from "../plugins/immune-brain/runtime/loop_daemon/agent_handlers.ts";
import { renderLaneDecisionQuestion } from "../plugins/immune-brain/runtime/loop_daemon/decision_relay.ts";
import { loadCorpus } from "../scripts/decision-eval/harness.ts";
import { acquireLoopLease } from "../plugins/immune-brain/runtime/loop_daemon/leases.ts";
import { loadLoopDecisions, loadLoopDispatches } from "../plugins/immune-brain/runtime/loop_daemon/state.ts";
import type { LoopGitHubPort } from "../plugins/immune-brain/runtime/loop_daemon/github_port.ts";
import type { GhExecution, GhTransport } from "../plugins/immune-brain/runtime/github_issue_tracker.ts";

const TS = "2025-11-13T00:00:00.000Z";
const DAY_LATER = "2025-11-14T00:00:01.000Z";

const cleanups: Array<() => void> = [];
afterEach(() => {
	while (cleanups.length > 0) {
		cleanups.pop()!();
	}
});

function makeWorkspace(options: {
	loopConfig?: Record<string, unknown>;
	decisionModels?: Record<string, unknown>;
	userConfig?: Record<string, unknown>;
} = {}) {
	const root = mkdtempSync(join(tmpdir(), "imm-loop-s10-"));
	cleanups.push(() => rmSync(root, { recursive: true, force: true }));
	execFileSync("git", ["init", "-q", root]);
	execFileSync("git", ["config", "user.name", "Immune Test"], { cwd: root });
	execFileSync("git", ["config", "user.email", "test@immune-brain.internal"], { cwd: root });

	mkdirSync(join(root, ".imm/state/loop"), { recursive: true });
	mkdirSync(join(root, "docs/agents"), { recursive: true });
	mkdirSync(join(root, "docs/plans"), { recursive: true });
	writeFileSync(
		join(root, "docs/agents/no-touch.json"),
		JSON.stringify({ contract: "immune_brain/no_touch/v1", paths: ["docs/agents/no-touch.json"] }) + "\n",
	);
	writeFileSync(
		join(root, ".imm/config.json"),
		JSON.stringify(
			{
				contract: "immune_brain/project_config/v2",
				...(options.decisionModels ? { decision_models: options.decisionModels } : {}),
				loop: {
					mode: "assist",
					allowed_actors: ["owner"],
					allowed_associations: ["OWNER"],
					...(options.loopConfig ?? {}),
				},
			},
			null,
			2,
		) + "\n",
	);
	execFileSync("git", ["add", "docs/agents/no-touch.json"], { cwd: root });

	let userConfigPath: string | undefined;
	if (options.userConfig) {
		userConfigPath = join(root, "user-config.json");
		writeFileSync(userConfigPath, JSON.stringify(options.userConfig, null, 2) + "\n");
	}

	return {
		root,
		stateDir: join(root, ".imm/state/loop"),
		userConfigPath,
	};
}

function makeFakeGitHubPort(): {
	port: LoopGitHubPort;
	postedComments: Array<{ targetNumber: number; body: string }>;
	editedComments: Array<{ commentId: number; body: string }>;
	createdIssues: Array<{ title: string; body: string }>;
	closedIssues: number[];
} {
	const postedComments: Array<{ targetNumber: number; body: string }> = [];
	const editedComments: Array<{ commentId: number; body: string }> = [];
	const createdIssues: Array<{ title: string; body: string }> = [];
	const closedIssues: number[] = [];
	let nextId = 5000;

	const port: LoopGitHubPort = {
		async postComment(targetNumber, body) {
			postedComments.push({ targetNumber, body });
			nextId += 1;
			return { id: nextId };
		},
		async editComment(commentId, body) {
			editedComments.push({ commentId, body });
		},
		async createIssue(title, body) {
			createdIssues.push({ title, body });
			return { number: 999 };
		},
		async editIssue() {},
		async upsertPullRequest() {
			return { number: 200, url: "https://example.test/pr/200" };
		},
		async markPrReady() {},
		async checkLog() {
			return null;
		},
		async prReviewComments() {
			return [];
		},
	};

	return { port, postedComments, editedComments, createdIssues, closedIssues };
}

function mockGh(): GhTransport {
	return {
		async run(_args): Promise<GhExecution> {
			return { status: 0, stdout: "", stderr: "" };
		},
	};
}

function issueEvent(overrides: Partial<E1NewIssueEvent> = {}): E1NewIssueEvent {
	return {
		contract: LOOP_DAEMON_EVENT_CONTRACT,
		event_id: "evt-e1-10",
		kind: "E1_NEW_ISSUE",
		timestamp: TS,
		issue_number: 10,
		title: "Implement feature X",
		body: "Add deterministic module for feature X.",
		author: "owner",
		labels: [],
		created_at: TS,
		updated_at: TS,
		...overrides,
	};
}

function commentEvent(overrides: Partial<E3OwnerCommentEvent> = {}): E3OwnerCommentEvent {
	return {
		contract: LOOP_DAEMON_EVENT_CONTRACT,
		event_id: `evt-e3-${overrides.comment_id ?? 101}`,
		kind: "E3_OWNER_COMMENT",
		timestamp: TS,
		issue_number: 10,
		comment_id: 101,
		author: "owner",
		author_association: "OWNER",
		body: "Thanks for looking into this.",
		created_at: TS,
		updated_at: TS,
		...overrides,
	};
}

function reviewCommentEvent(overrides: Partial<E10PRReviewCommentEvent> = {}): E10PRReviewCommentEvent {
	return {
		contract: LOOP_DAEMON_EVENT_CONTRACT,
		event_id: `evt-e10-${overrides.comment_id ?? 301}`,
		kind: "E10_PR_REVIEW_COMMENT",
		timestamp: TS,
		pr_number: 25,
		comment_id: 301,
		author: "owner",
		author_association: "OWNER",
		body: "Please handle null input here.",
		path: "src/feature.ts",
		line: 12,
		...overrides,
	};
}

const OWNER_FACTS: GuardFacts = {
	allowed_actors: ["owner"],
	allowed_associations: ["OWNER"],
	daemon_identity: "imm-bot",
};

function stubClassifier(
	map: Partial<
		Record<
			ApplicationPointId,
			| { choice: string; confidence: number; truncation?: "none" | "possible" | "unknown"; envelope?: Envelope }
			| "unavailable"
		>
	>,
): { classify: ClassifyFn; calls: Array<{ point: ApplicationPointId; state: unknown }> } {
	const calls: Array<{ point: ApplicationPointId; state: unknown }> = [];
	const classify: ClassifyFn = async (point, state) => {
		calls.push({ point, state });
		const entry = map[point];
		if (!entry || entry === "unavailable") {
			return { status: "unavailable", reason: "no_binding", detail: `no stub for ${point}` };
		}
		return {
			status: "decided",
			choice: entry.choice,
			confidence: entry.confidence,
			...(entry.truncation ? { truncation: entry.truncation } : {}),
			...(entry.envelope ? { envelope: entry.envelope } : {}),
		};
	};
	return { classify, calls };
}

describe("D12 v1 thresholds & correctable-direction gating (S3 retains S10 baselines)", () => {
	it("publishes D12 hand-set /v1 threshold sets on all five application points", () => {
		expect(A18_EVENT_PREFILTER.threshold_set).toEqual({ version: "a18/v1", values: { ignore: 0.9 } });
		expect(A15_TASK_GRANULARITY.threshold_set).toEqual({
			version: "a15-granularity/v1",
			values: { clear_single_task: 0.75, needs_initiative_decomposition: 0.75, needs_clarification: 0.75 },
		});
		expect(A20_ISSUE_DUPLICATE_PAIR.threshold_set).toEqual({
			version: "a20/v1",
			values: { duplicate: 0.85 },
		});
		expect(A19_OWNER_COMMENT_INTENT.threshold_set).toEqual({
			version: "a19/v1",
			values: {
				approve_plan: 0.8,
				request_plan_revision: 0.8,
				answer_lane_decision: 0.8,
				command: 0.8,
				discussion: 0.8,
			},
		});
		expect(A14_PR_COMMENT_TRIAGE.threshold_set).toEqual({
			version: "a14/v1",
			values: { blocking: 0.8, nit: 0.8, out_of_scope: 0.8, duplicate: 0.8 },
		});
	});

	it("acts only on listed correctable directions: low-confidence a18 actionable and a20 unrelated still proceed", async () => {
		const { classify } = stubClassifier({
			a18_event_prefilter: { choice: "actionable", confidence: 0.41, truncation: "none" },
			a20_issue_duplicate_pair: { choice: "unrelated", confidence: 0.38, truncation: "none" },
			a15_task_granularity: { choice: "clear_single_task", confidence: 0.76, truncation: "none" },
		});

		const result = await judgeEvent(issueEvent(), {
			facts: { duplicate_candidate: { number: 2, title: "Other", body: "Other" } },
			classify,
		});
		expect(result.tier).toBe(2);
		expect(result.handler).toBe("draft_plan");
	});

	it("applies the point baseline on every needs_judging outcome and starts no session", async () => {
		// Spec loop-leader D3.4: the Tier-3 judging session is retired, so each of
		// these falls to the exact D12 baseline the unavailable-judge path used.
		// 1) Below threshold on a18 ignore (0.85 < 0.90): proceed as `actionable`,
		// then a15 is unavailable, whose baseline escalates.
		const lowIgnore = await judgeEvent(issueEvent(), {
			classify: stubClassifier({ a18_event_prefilter: { choice: "ignore", confidence: 0.85, truncation: "none" } }).classify,
		});
		expect(lowIgnore).toMatchObject({ tier: 3, handler: "escalate", needs_judging: true });
		expect(lowIgnore.judging_agent_used).toBeUndefined();

		// 2) Truncation !== "none" is needs_judging, same baseline.
		const truncated = await judgeEvent(issueEvent(), {
			classify: stubClassifier({
				a18_event_prefilter: { choice: "actionable", confidence: 0.99, truncation: "possible" },
			}).classify,
		});
		expect(truncated).toMatchObject({ tier: 3, handler: "escalate", needs_judging: true });

		// 3) Point disabled (bindings.<point>: "off" leaves it out of enabledPoints).
		const disabledCalls = stubClassifier({
			a18_event_prefilter: { choice: "ignore", confidence: 0.99, truncation: "none" },
		});
		const disabled = await judgeEvent(issueEvent(), {
			classify: disabledCalls.classify,
			enabledPoints: ["a15_task_granularity"],
		});
		// a18 is disabled, so the classifier is asked only for the enabled a15 point.
		expect(disabledCalls.calls.map((call) => call.point)).toEqual(["a15_task_granularity"]);
		expect(disabled).toMatchObject({ tier: 3, handler: "escalate", needs_judging: true });

		// 4) Unavailable classifier.
		const unavailable = await judgeEvent(issueEvent(), {
			classify: stubClassifier({ a18_event_prefilter: "unavailable" }).classify,
		});
		expect(unavailable).toMatchObject({ tier: 3, handler: "escalate", needs_judging: true });

		// Nothing started a session: a needs_judging outcome writes no role session, and
		// the record carries the flag that makes it a briefing reconcile candidate.
		const ws = makeWorkspace();
		await runLoopDaemonCli(["tick", "--json"], ws.root, {
			gh: mockGh(),
			gitHubPort: makeFakeGitHubPort().port,
			guardFacts: { daemon_identity: "imm-bot" },
			classify: stubClassifier({ a18_event_prefilter: { choice: "ignore", confidence: 0.4, truncation: "none" } }).classify,
			snapshotOverride: {
				issues: [
					{
						id: 1,
						number: 10,
						title: "Skipped issue",
						body: "check",
						state: "open",
						created_at: TS,
						updated_at: TS,
						author: { login: "owner" },
						labels: [],
					},
				],
				pull_requests: [],
				observed_at: TS,
			},
		});
		expect(listRoleSessions(ws.stateDir)).toEqual([]);
		expect(loadLoopDecisions(ws.stateDir).map((decision) => decision.needs_judging)).toEqual([true]);
		expect(reconcileCandidates(ws.stateDir).map((candidate) => candidate.target)).toEqual(["issue-10"]);
	});

	it("records full decision_model Envelope provenance in loop_decision_record/v1 via cli.ts default classifier", async () => {
		const ws = makeWorkspace({
			userConfig: {
				contract: "immune_brain/user_config/v2",
				decision_models: {
					profiles: {
						p_a18: { kind: "fake", answers: {}, default: { actionable: 0.95, ignore: 0.05 } },
						p_a15: {
							kind: "fake",
							answers: {},
							default: {
								clear_single_task: 0.85,
								needs_initiative_decomposition: 0.1,
								needs_clarification: 0.05,
							},
						},
					},
					bindings: {
						a18_event_prefilter: "p_a18",
						a15_task_granularity: "p_a15",
					},
				},
			},
		});

		const ghPort = makeFakeGitHubPort();
		const res = await runLoopDaemonCli(["tick", "--json"], ws.root, {
			gh: mockGh(),
			gitHubPort: ghPort.port,
			userConfigPath: ws.userConfigPath,
			guardFacts: { daemon_identity: "imm-bot" },
			snapshotOverride: {
				issues: [
					{
						id: 1,
						number: 42,
						title: "Single scoped task",
						body: "Clear specification",
						state: "open",
						created_at: TS,
						updated_at: TS,
						author: { login: "owner" },
						labels: [],
					},
				],
				pull_requests: [],
				observed_at: TS,
			},
		});
		expect(res.returncode).toBe(0);

		// fakeAdapter returns truncation: "unknown", so every point needs judging and
		// the baseline applies: the record keeps the last point's full Envelope.
		const decisions = loadLoopDecisions(ws.stateDir);
		expect(decisions).toHaveLength(1);
		expect(decisions[0]).toMatchObject({ handler: "escalate", needs_judging: true });
		const cls = decisions[0]!.classification;
		expect(cls).toMatchObject({
			point: "a15_task_granularity",
			choice: "clear_single_task",
			confidence: 0.85,
			probabilities: { clear_single_task: 0.85, needs_initiative_decomposition: 0.1, needs_clarification: 0.05 },
			profile: "p_a15",
			model: "fake",
			model_version: null,
			threshold_set_version: "a15-granularity/v1",
			truncation: "unknown",
		});
	});
});

describe("Reconciliation as leader candidates (S3-AC1)", () => {
	it("lists kept model-skipped decisions as reconcile candidates and starts no session", async () => {
		const ws = makeWorkspace({ loopConfig: { max_concurrent: 2 } });
		const ghPort = makeFakeGitHubPort();
		const { classify } = stubClassifier({
			a18_event_prefilter: { choice: "ignore", confidence: 0.95, truncation: "none" },
		});

		const tick1 = await runLoopDaemonCli(["tick", "--json"], ws.root, {
			gh: mockGh(),
			gitHubPort: ghPort.port,
			classify,
			guardFacts: { daemon_identity: "imm-bot" },
			snapshotOverride: {
				issues: [
					{
						id: 1,
						number: 10,
						title: "Issue the model called noise",
						body: "Fix parser bug",
						state: "open",
						created_at: TS,
						updated_at: TS,
						author: { login: "owner" },
						labels: [],
					},
				],
				pull_requests: [],
				observed_at: TS,
			},
		});
		expect(tick1.returncode).toBe(0);
		const dec1 = loadLoopDecisions(ws.stateDir);
		expect(dec1).toHaveLength(1);
		expect(dec1[0]!.handler).toBe("noop_record");
		expect(dec1[0]!.kept_for_reconciliation).toBe(true);

		// Spec loop-leader D3.4: reconcile collects the skip as a leader candidate and
		// starts no judging session, appends no override decision and writes no label.
		const reconcile = await runLoopDaemonCli(["reconcile", "--json"], ws.root, {
			gh: mockGh(),
			gitHubPort: ghPort.port,
			guardFacts: { daemon_identity: "imm-bot" },
			snapshotOverride: { issues: [], pull_requests: [], observed_at: TS },
		});
		expect(reconcile.returncode).toBe(0);
		const payload = JSON.parse(reconcile.stdout);
		expect(payload.checked).toBe(1);
		expect(payload.candidates).toEqual([
			expect.objectContaining({ target: "issue-10", point: "a18_event_prefilter", choice: "ignore" }),
		]);
		expect(listRoleSessions(ws.stateDir)).toEqual([]);
		expect(loadLoopDispatches(ws.stateDir)).toHaveLength(0);
		expect(existsSync(labelsFilePath(ws.stateDir))).toBe(false);
		expect(loadLoopDecisions(ws.stateDir)).toHaveLength(1);

		// The second pass reports nothing new: the first pass retired the skip,
		// so the candidate list cannot grow without bound. The decision log keeps
		// the evidence; only the re-report stops.
		const second = await runLoopDaemonCli(["reconcile", "--json"], ws.root, {
			gh: mockGh(),
			gitHubPort: ghPort.port,
			guardFacts: { daemon_identity: "imm-bot" },
		});
		expect(second.returncode).toBe(0);
		expect(JSON.parse(second.stdout)).toMatchObject({ checked: 0, candidates: [] });
		expect(reconcileCandidates(ws.stateDir)).toEqual([]);
		expect(loadLoopDecisions(ws.stateDir)).toHaveLength(1);
		expect(loadReconcileState(ws.stateDir).last_reconcile_at).toBeString();
	});

	it("imm-loop run triggers reconcile on startup and again after 24h", async () => {
		const ws = makeWorkspace();
		const ghPort = makeFakeGitHubPort();
		let currentNow = Date.parse(TS);

		// Run iteration 1 at T=0 -> creates initial state & last_reconcile_at = T=0
		const res1 = await runLoopDaemonCli(["run", "--interval", "1"], ws.root, {
			gh: mockGh(),
			gitHubPort: ghPort.port,
			singleIteration: true,
			now: () => new Date(currentNow).toISOString(),
			guardFacts: { daemon_identity: "imm-bot" },
			classify: stubClassifier({}).classify,
			snapshotOverride: { issues: [], pull_requests: [], observed_at: TS },
		});
		expect(res1.returncode).toBe(0);
		expect(loadReconcileState(ws.stateDir).last_reconcile_at).toBe(TS);

		// Add a skipped decision via tick at T+1h
		currentNow += 60 * 60 * 1000;
		await runLoopDaemonCli(["tick"], ws.root, {
			gh: mockGh(),
			gitHubPort: ghPort.port,
			guardFacts: { daemon_identity: "imm-bot" },
			classify: stubClassifier({
				a18_event_prefilter: { choice: "ignore", confidence: 0.95, truncation: "none" },
			}).classify,
			snapshotOverride: {
				issues: [
					{
						id: 2,
						number: 11,
						title: "Skipped issue",
						body: "check",
						state: "open",
						created_at: TS,
						updated_at: TS,
						author: { login: "owner" },
						labels: [],
					},
				],
				pull_requests: [],
				observed_at: new Date(currentNow).toISOString(),
			},
		});
		expect(reconcileCandidates(ws.stateDir).map((candidate) => candidate.target)).toEqual(["issue-11"]);

		// Advance clock past 24h from T=0 -> `run` checks scheduled reconcile automatically
		currentNow = Date.parse(DAY_LATER);
		const res2 = await runLoopDaemonCli(["run", "--interval", "1"], ws.root, {
			gh: mockGh(),
			gitHubPort: ghPort.port,
			singleIteration: true,
			now: () => new Date(currentNow).toISOString(),
			guardFacts: { daemon_identity: "imm-bot" },
			classify: stubClassifier({}).classify,
			snapshotOverride: { issues: [], pull_requests: [], observed_at: DAY_LATER },
		});
		expect(res2.returncode).toBe(0);
		// The scheduled pass ran at the later clock: its stamp is the evidence, and it
		// left the skip as a leader candidate rather than starting a judging session.
		expect(loadReconcileState(ws.stateDir).last_reconcile_at).toBe(DAY_LATER);
		expect(listRoleSessions(ws.stateDir)).toEqual([]);
		expect(reconcileCandidates(ws.stateDir)).toEqual([]);
	});

	it("appends source='owner' labels.jsonl row when verified owner @imm-loop ignore or retry reverses a model decision", async () => {
		const ws = makeWorkspace();
		const ghPort = makeFakeGitHubPort();

		// Model acts on Issue #12 as actionable -> clear_single_task
		await runLoopDaemonCli(["tick"], ws.root, {
			gh: mockGh(),
			gitHubPort: ghPort.port,
			guardFacts: { daemon_identity: "imm-bot" },
			classify: stubClassifier({
				a18_event_prefilter: { choice: "actionable", confidence: 0.92, truncation: "none" },
				a15_task_granularity: { choice: "clear_single_task", confidence: 0.85, truncation: "none" },
			}).classify,
			snapshotOverride: {
				issues: [
					{
						id: 12,
						number: 12,
						title: "Not actually needed",
						body: "Body",
						state: "open",
						created_at: TS,
						updated_at: TS,
						author: { login: "owner" },
						labels: [],
					},
				],
				pull_requests: [],
				observed_at: TS,
			},
		});

		// Verified owner posts `@imm-loop ignore` on Issue #12
		const t2 = "2026-11-13T00:05:00.000Z";
		await runLoopDaemonCli(["tick"], ws.root, {
			gh: mockGh(),
			gitHubPort: ghPort.port,
			guardFacts: { daemon_identity: "imm-bot" },
			classify: stubClassifier({}).classify,
			snapshotOverride: {
				issues: [
					{
						id: 12,
						number: 12,
						title: "Not actually needed",
						body: "Body",
						state: "open",
						created_at: TS,
						updated_at: t2,
						author: { login: "owner" },
						labels: [],
						comments: [
							{
								id: 201,
								body: "@imm-loop ignore",
								user: { login: "owner" },
								author_association: "OWNER",
								created_at: t2,
								updated_at: t2,
							},
						],
					},
				],
				pull_requests: [],
				observed_at: t2,
			},
		});

		const labels = loadLoopLabels(ws.stateDir);
		expect(labels).toHaveLength(1);
		expect(labels[0]).toMatchObject({
			point: "a18_event_prefilter",
			gold: "ignore",
			model_choice: "actionable",
			source: "owner",
		});
		const validated = loadCorpus<LoopLabelRow>(
			readFileSync(labelsFilePath(ws.stateDir), "utf8"),
			[...A18_EVENT_PREFILTER.options],
			(v): v is LoopLabelRow => typeof v === "object" && v !== null && typeof (v as LoopLabelRow).id === "string",
		);
		expect(validated).toHaveLength(1);
	});
});

describe("Safety invariants, baselines, duplicate search, E10 & lane replies (S3-AC1)", () => {
	it("a19 approve_plan or command at any confidence yields one deduplicated format reminder per comment and never enroll_and_drive", async () => {
		const ws = makeWorkspace();
		const ghPort = makeFakeGitHubPort();

		for (const confidence of [0.22, 0.94]) {
			const commentId = confidence < 0.5 ? 701 : 702;
			const body = confidence < 0.5 ? "yeah sounds good ship it" : "run checks and deploy now";
			const choice = confidence < 0.5 ? "approve_plan" : "command";
			const classify = stubClassifier({
				a18_event_prefilter: { choice: "actionable", confidence: 0.95, truncation: "none" },
				a19_owner_comment_intent: { choice, confidence, truncation: "none" },
			}).classify;

			const t = `2026-11-13T01:0${commentId - 700}:00.000Z`;
			const snap: ObservationInput = {
				issues: [
					{
						id: 1,
						number: 10,
						title: "Issue 10",
						body: "Body",
						state: "open",
						created_at: TS,
						updated_at: t,
						author: { login: "owner" },
						labels: [],
						comments: [
							{
								id: commentId,
								body,
								user: { login: "owner" },
								author_association: "OWNER",
								created_at: t,
								updated_at: t,
							},
						],
					},
				],
				pull_requests: [],
				observed_at: t,
			};

			const r1 = await runLoopDaemonCli(["tick", "--json"], ws.root, {
				gh: mockGh(),
				gitHubPort: ghPort.port,
				classify,
				guardFacts: { daemon_identity: "imm-bot" },
				snapshotOverride: snap,
			});
			expect(JSON.parse(r1.stdout).dispatches[0]?.handler).toBe("escalate");
			expect(JSON.parse(r1.stdout).decisions[0]?.handler).not.toBe("enroll_and_drive");
		}
		expect(ghPort.postedComments).toHaveLength(2);
		expect(ghPort.postedComments[0]!.body).toContain("a19_format_reminder:issue:10:comment:701");
		expect(ghPort.postedComments[1]!.body).toContain("a19_format_reminder:issue:10:comment:702");

		// Simulate repeating comment #701 escalation: deduplicates against existing comment holding same escalation key.
		// S9/D7: E2 needs an Issue body change, so a comment-only update no longer escalates.
		const repeatSnap: ObservationInput = {
			issues: [
				{
					id: 1,
					number: 10,
					title: "Issue 10",
					body: "Body edited after the reminder",
					state: "open",
					created_at: TS,
					updated_at: "2026-11-13T01:05:00.000Z",
					author: { login: "owner" },
					labels: [],
					comments: [
						{
							id: 701,
							body: "approve this please",
							user: { login: "owner" },
							author_association: "OWNER",
							created_at: "2026-11-13T01:05:00.000Z",
							updated_at: "2026-11-13T01:05:00.000Z",
						},
						{
							id: 9991,
							body: ghPort.postedComments[0]!.body,
							user: { login: "imm-bot" },
							author_association: "COLLABORATOR",
							created_at: "2026-11-13T01:05:01.000Z",
							updated_at: "2026-11-13T01:05:01.000Z",
						},
					],
				},
			],
			pull_requests: [],
			observed_at: "2026-11-13T01:05:02.000Z",
		};
		await runLoopDaemonCli(["tick", "--json"], ws.root, {
			gh: mockGh(),
			gitHubPort: ghPort.port,
			classify: stubClassifier({
				a18_event_prefilter: { choice: "actionable", confidence: 0.95, truncation: "none" },
				a19_owner_comment_intent: { choice: "approve_plan", confidence: 0.4, truncation: "none" },
			}).classify,
			guardFacts: { daemon_identity: "imm-bot" },
			snapshotOverride: repeatSnap,
		});
		// S5/D5: the already-judged comment 701 is not judged again, so no second
		// reminder; the daemon's own reminder comment stays a noop. What does post is
		// the E2 issue-edit escalation, which the same-target lease hold used to mask.
		expect(
			ghPort.postedComments.filter((c) => c.body.includes("a19_format_reminder:issue:10:comment:701")),
		).toHaveLength(1);
		expect(ghPort.postedComments.filter((c) => c.body.includes(":comment:9991"))).toHaveLength(0);
		expect(ghPort.postedComments).toHaveLength(3);
	});

	it("applies the exact D12 baselines when no point answers and starts no session", async () => {
		const ws = makeWorkspace({ loopConfig: { budget: { max_dispatches_per_day: 2 } } });

		// a18, a20 and a15 all unavailable: the issue takes the documented baseline,
		// which escalates, and the record says a needs_judging outcome produced it.
		const issueFallback = await judgeEvent(issueEvent(), {
			facts: { duplicate_candidate: { number: 3, title: "Dup", body: "Dup" } },
			classify: stubClassifier({}).classify,
		});
		expect(issueFallback).toMatchObject({ tier: 3, handler: "escalate", needs_judging: true });

		// a14 unavailable: baseline address_pr_review.
		const prFallback = await judgeEvent(reviewCommentEvent(), {
			facts: OWNER_FACTS,
			classify: stubClassifier({}).classify,
		});
		expect(prFallback).toMatchObject({ tier: 3, handler: "address_pr_review", needs_judging: true });

		// Three such events in one tick start no judging session at all.
		const ghPort = makeFakeGitHubPort();
		await runLoopDaemonCli(["tick", "--json"], ws.root, {
			gh: mockGh(),
			gitHubPort: ghPort.port,
			guardFacts: { daemon_identity: "imm-bot" },
			classify: stubClassifier({}).classify,
			snapshotOverride: {
				issues: [1, 2, 3].map((number) => ({
					id: number,
					number,
					title: `I${number}`,
					body: `b${number}`,
					state: "open",
					created_at: TS,
					updated_at: TS,
					author: { login: "owner" },
					labels: [],
				})),
				pull_requests: [],
				observed_at: TS,
			},
		});
		expect(loadLoopDecisions(ws.stateDir).map((decision) => decision.needs_judging)).toEqual([true, true, true]);
		expect(listRoleSessions(ws.stateDir)).toEqual([]);
	});

	it("selectBestDuplicateCandidate deterministically finds open lexical duplicates above floor and ignores closed/unrelated issues", async () => {
		const issues: RawIssue[] = [
			{
				id: 1,
				number: 1,
				title: "Fix authentication token refresh timeout bug",
				body: "Users hit auth token timeout during refresh cycle",
				state: "closed", // closed must be excluded!
				created_at: TS,
				updated_at: TS,
				author: { login: "owner" },
			},
			{
				id: 2,
				number: 2,
				title: "Auth token refresh fails with timeout error",
				body: "OAuth token refresh cycle drops on timeout",
				state: "open",
				created_at: TS,
				updated_at: TS,
				author: { login: "owner" },
			},
			{
				id: 3,
				number: 3,
				title: "Update CSS footer padding",
				body: "Minor layout spacing adjustment",
				state: "open",
				created_at: TS,
				updated_at: TS,
				author: { login: "owner" },
			},
			{
				id: 4,
				number: 4,
				title: "Authentication token refresh timeout error",
				body: "Auth token timeout during refresh cycle",
				state: "open",
				created_at: TS,
				updated_at: TS,
				author: { login: "owner" },
			},
		];

		const best = selectBestDuplicateCandidate(
			{
				number: 4,
				title: "Authentication token refresh timeout error",
				body: "Auth token timeout during refresh cycle",
			},
			issues,
		);
		expect(best).toBeDefined();
		expect(best!.number).toBe(2);
		expect(best!.score).toBeGreaterThanOrEqual(DUPLICATE_SIMILARITY_FLOOR);

		const unrelated = selectBestDuplicateCandidate(
			{
				number: 99,
				title: "Completely unrelated database backup command",
				body: "Snapshots postgresql tables",
			},
			issues,
		);
		expect(unrelated).toBeUndefined();

		// Wired end-to-end in cli.ts tick -> feeds a20_issue_duplicate_pair and escalates naming both issues
		const ws = makeWorkspace();
		const ghPort = makeFakeGitHubPort();
		const spy = stubClassifier({
			a18_event_prefilter: { choice: "actionable", confidence: 0.95, truncation: "none" },
			a20_issue_duplicate_pair: { choice: "duplicate", confidence: 0.91, truncation: "none" },
		});
		const tickRes = await runLoopDaemonCli(["tick", "--json"], ws.root, {
			gh: mockGh(),
			gitHubPort: ghPort.port,
			guardFacts: { daemon_identity: "imm-bot" },
			classify: spy.classify,
			snapshotOverride: {
				issues: [issues[1]!, issues[2]!, issues[3]!],
				pull_requests: [],
				observed_at: TS,
			},
		});
		expect(tickRes.returncode).toBe(0);
		const a20Call = spy.calls.find((c) => c.point === "a20_issue_duplicate_pair");
		expect(a20Call).toBeDefined();
		expect(ghPort.closedIssues).toHaveLength(0);
	});

	it("E10_PR_REVIEW_COMMENT uses a14_pr_comment_triage and agent_handlers AddressReviewDeps reuses the recorded answer", async () => {
		const ws = makeWorkspace();
		execFileSync("git", ["commit", "--allow-empty", "-q", "-m", "init"], { cwd: ws.root });
		execFileSync("git", ["checkout", "-q", "-b", "imm/t1"], { cwd: ws.root });
		const reviewSessionCalls: string[] = [];
		const portDeps: AgentHandlerDeps = {
			analyze: () => ({ scopes: ["src/"], seams: [] }),
			commitPlan: () => ({ ok: true, commit_sha: "abc", worktree_path: ws.root, branch: "imm/t1" }),
			enrollTask: () => {},
			runDrive: () => ({ exit_code: 0, timed_out: false, run_id: "r1", verification_evidence_digest: "sha256:" + "a".repeat(64) }),
			openPrDeps: {} as any,
			head: () => "a".repeat(40),
			changedPaths: () => [],
			prWorktree: () => ws.root,
			readIntent: () => ({
				task_id: "t1",
				path: "docs/plans/t1.intent.json",
				revision: 1,
				content_hash: "sha256:" + "b".repeat(64),
				risk: "routine",
				scope_hint: ["src/"],
			}),
			runVerification: async () => ({ exit_code: 0, stdout: "ok", stderr: "" }),
			rebaseOrMerge: async () => ({ success: true }),
			gitCommitAndPush: async () => ({ commit_sha: "sha123" }),
			session_credential: null,
			sessionProvider: {
				run: async (req) => {
					reviewSessionCalls.push(req.kind);
					const outFile = join(req.worktree_path, req.output_path);
					mkdirSync(dirname(outFile), { recursive: true });
					writeFileSync(
						outFile,
						JSON.stringify({ success: true, modified_paths: ["src/feature.ts"], reason: "fixed nit" }),
					);
					return {
						exit_code: 0,
						exit_signal: null,
						timed_out: false,
					};
				},
			},
		};
		const agentPort = createAgentHandlerPort(portDeps);
		const ghPort = makeFakeGitHubPort();

		// Path-less PR comment classified as `nit` by a14_pr_comment_triage -> NOT treated as scope-changing!
		const { classify, calls } = stubClassifier({
			a14_pr_comment_triage: { choice: "nit", confidence: 0.9, truncation: "none" },
		});
		const event: E10PRReviewCommentEvent = reviewCommentEvent({
			path: undefined,
			line: undefined,
			body: "Rename helper variable for clarity",
		});

		const result = await agentPort.handle("address_pr_review", {
			root: ws.root,
			stateDir: ws.stateDir,
			loopConfig: {
				mode: "assist",
				interval_seconds: 60,
				max_concurrent: 2,
				max_ready_buffer: 5,
				max_pr_buffer: 5,
				auto_enroll_max_risk: "none",
				allowed_actors: ["owner"],
				allowed_associations: ["OWNER"],
				budget: { max_ticks_per_day: null, max_dispatches_per_day: null },
			},
			snapshot: {
				issues: [],
				pull_requests: [
					{
						id: 25,
						number: 25,
						title: "PR 25",
						body: "<!-- immune-brain:kind=loop-pr -->",
						state: "open",
						head_ref_name: "imm/t1",
						base_ref_name: "main",
						head_sha: "head25",
						created_at: TS,
						updated_at: TS,
					},
				],
				observed_at: TS,
			},
			guardFacts: OWNER_FACTS,
			gitHubPort: ghPort.port,
			event,
			decision: {
				contract: "assurance_kernel/loop_decision_record/v1",
				decision_id: "dec-e10-1",
				recorded_at: TS,
				event_id: event.event_id,
				event_kind: event.kind,
				target: { kind: "pr", id: "25" },
				tier: 2,
				handler: "address_pr_review",
				reason: "a14 nit",
				guard: null,
				classification: { point: "a14_pr_comment_triage", choice: "nit", confidence: 0.9, truncation: "none" },
				dry_run: false,
				mutations: [],
			},
			now: TS,
			standing_daemon: true,
		});
		expect(result.outcome).toBe("executed");
		expect(reviewSessionCalls).toEqual(["repair"]);

		// Verify judgement itself calls a14_pr_comment_triage (never a14_ambiguous_user_intent)
		const j = await judgeEvent(event, { facts: OWNER_FACTS, classify });
		expect(j.handler).toBe("address_pr_review");
		expect(calls.map((c) => c.point)).toEqual(["a14_pr_comment_triage"]);
	});

	it("binds an explicit Lane decision reply to parked (run_id, record_revision) without a judging session", async () => {
		const ws = makeWorkspace();
		const ghPort = makeFakeGitHubPort();
		const questionBody = renderLaneDecisionQuestion({
			task_id: "task-parked-1",
			run_id: "run-parked-1",
			record_revision: "rev-parked-9",
			question: "Should we keep the minimal change or expand scope?",
			options: [
				{ id: "opt-minimal", label: "Minimal fix" },
				{ id: "opt-expand", label: "Expand scope" },
			],
		});

		const relayedCalls: Array<{ expectedRecordRevision: string; chosenOption: unknown }> = [];
		const replyTime = "2026-11-13T02:00:00.000Z";
		const res = await runLoopDaemonCli(["tick", "--json"], ws.root, {
			gh: mockGh(),
			gitHubPort: ghPort.port,
			guardFacts: { daemon_identity: "imm-bot" },
			classify: stubClassifier({
				a18_event_prefilter: { choice: "actionable", confidence: 0.95, truncation: "none" },
				a19_owner_comment_intent: { choice: "answer_lane_decision", confidence: 0.9, truncation: "none" },
			}).classify,
			relayDecision: (async (input: any) => {
				relayedCalls.push({
					expectedRecordRevision: input.expectedRecordRevision,
					chosenOption: input.extra?.chosen_option,
				});
				return { relayed: true, target: { task_id: input.taskId, lane_path: ws.root }, outcome: "ok" };
			}) as any,
			relayInputFactory: ((op, rev, choice) => ({
				root: ws.root,
				taskId: "task-parked-1",
				operation: op,
				expectedRecordRevision: rev,
				project: (() => ({})) as any,
				apply: (async () => ({})) as any,
				applied: () => true,
				supervisor: {} as any,
				parentHost: "claude-code",
				pluginDir: ws.root,
				extra: { chosen_option: choice.option_id },
			})),
			snapshotOverride: {
				issues: [
					{
						id: 50,
						number: 50,
						title: "Issue 50",
						body: "Work item",
						state: "open",
						created_at: TS,
						updated_at: replyTime,
						author: { login: "owner" },
						labels: [],
						comments: [
							{
								id: 1,
								body: questionBody,
								user: { login: "imm-bot" },
								author_association: "COLLABORATOR",
								created_at: TS,
								updated_at: TS,
							},
							{
								id: 2,
								body: "@imm-loop select opt-minimal",
								user: { login: "owner" },
								author_association: "OWNER",
								created_at: replyTime,
								updated_at: replyTime,
							},
						],
					},
				],
				pull_requests: [],
				observed_at: replyTime,
			},
		});
		expect(res.returncode).toBe(0);
		expect(relayedCalls).toEqual([
			{ expectedRecordRevision: "rev-parked-9", chosenOption: "opt-minimal" },
		]);
		const dispatches = loadLoopDispatches(ws.stateDir);
		expect(dispatches[0]).toMatchObject({ handler: "apply_lane_decision_reply", outcome: "executed" });
	});

	it("never sends CI log text to the decision model", async () => {
		const spy = stubClassifier({
			a14_pr_comment_triage: { choice: "blocking", confidence: 0.9, truncation: "none" },
		});
		const checkFailed: E8PRCheckFailedEvent = {
			contract: LOOP_DAEMON_EVENT_CONTRACT,
			event_id: "evt-e8-1",
			kind: "E8_PR_CHECK_FAILED",
			timestamp: TS,
			pr_number: 25,
			head_sha: "abc",
			check_name: "ci/unit",
			conclusion: "failure",
			details_url: "https://example.test/logs/123",
			failure_summary: "SUPER_SECRET_CI_LOG_OUTPUT_LINE_123",
		};
		const j1 = await judgeEvent(checkFailed, { classify: spy.classify });
		expect(j1.handler).toBe("repair_pr_ci");
		expect(spy.calls).toHaveLength(0);

		const reviewWithExtra = {
			...reviewCommentEvent(),
			ci_logs: "RAW_CI_LOG_TEXT",
			logs: "RAW_CI_LOG_TEXT",
		} as E10PRReviewCommentEvent;
		await judgeEvent(reviewWithExtra, { facts: OWNER_FACTS, classify: spy.classify });
		expect(spy.calls).toHaveLength(1);
		expect(JSON.stringify(spy.calls[0]!.state)).not.toContain("RAW_CI_LOG_TEXT");
	});
});
