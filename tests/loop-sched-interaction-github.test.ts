/**
 * Loop Daemon: Interaction protocol and its `github` channel (S3)
 *
 * Verifies S3-AC1 and S3-AC2 under docs/plans/loop-sched-s3-interaction-github.intent.json
 * and D3 of docs/specs/loop-agent-scheduling.spec.md (BR-DEC-6, BR-DEC-8, BR-DEC-10):
 * - One marker comment per `interaction_id`; a repost is `already_posted`; a
 *   request whose binding moved is reported `stale` and its comment edited to a
 *   withdrawn notice.
 * - `github.accepts` applies exactly `/approve <digest>` (ADR 0039 Decision 9
 *   checks) and a Lane decision reply (today's relay checks), and posts every
 *   other literal-user operation as `notice_only` naming the local action.
 * - Negative: a reply from a non-allowlisted author, from the daemon identity,
 *   edited after creation, or carrying a different digest or record_revision is
 *   ignored. Pre-protocol Lane decision and `/approve` markers still parse.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseLaneDecisionQuestion, renderLaneDecisionQuestion } from "../plugins/immune-brain/runtime/loop_daemon/decision_relay.ts";
import { escalationInteractionRequest, planEscalation } from "../plugins/immune-brain/runtime/loop_daemon/escalation.ts";
import { parsePlanDigestFromComment } from "../plugins/immune-brain/runtime/loop_daemon/events.ts";
import {
	createGithubInteractionChannel,
	INTERACTION_WITHDRAWN_MARKER,
	isWithdrawn,
	parseInteractionMarker,
	renderInteractionBody,
	type GithubInteractionPort,
} from "../plugins/immune-brain/runtime/loop_daemon/interaction/github_channel.ts";
import {
	INTERACTION_REQUEST_CONTRACT,
	localOnlyNotice,
	changedBindingFields,
	CONTEXT_MAX_BYTES,
	CONTEXT_SECTION_END,
	CONTEXT_SECTION_START,
	CONTEXT_TRUNCATED_MARKER,
	fitInteractionContext,
	renderInteractionContext,
	sanitizeContextText,
	type InteractionBinding,
	type InteractionRequest,
} from "../plugins/immune-brain/runtime/loop_daemon/interaction/protocol.ts";
import { askOwnerQuestion, ownerQuestionRequest, pendingLaneEntryBlocked } from "../plugins/immune-brain/runtime/loop_daemon/replan.ts";
import { clearWaitingPointer, listWaitingStatus, recordWaitingPointer } from "../plugins/immune-brain/runtime/loop_daemon/waiting.ts";
import type { GuardFacts } from "../plugins/immune-brain/runtime/loop_daemon/guards.ts";
import type { RawComment } from "../plugins/immune-brain/runtime/loop_daemon/types.ts";

const TS = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-01T00:10:00.000Z";
const EVEN_LATER = "2026-01-01T00:20:00.000Z";
const OWNER = "dereknex";
const DAEMON = "imm-loop-bot";
const PLAN_DIGEST = "sha256:9f0f0c5f3a1b";
const RUN_ID = "run-bcbfc187";
const REVISION = "rev-001";
const ISSUE = 42;

const OWNER_FACTS: GuardFacts = {
	allowed_actors: [OWNER],
	allowed_associations: ["OWNER", "MEMBER", "COLLABORATOR"],
	daemon_identity: DAEMON,
};

interface FakePort extends GithubInteractionPort {
	comments: Array<{ id: number; issue: number; body: string }>;
	edits: Array<{ id: number; body: string }>;
}

/** The fake GitHub write port: records the comment each request is posted as. */
function fakePort(): FakePort {
	const comments: FakePort["comments"] = [];
	const edits: FakePort["edits"] = [];
	let next = 1000;
	return {
		comments,
		edits,
		async postComment(issue: number, body: string) {
			const id = next++;
			comments.push({ id, issue, body });
			return { id, url: `https://github.com/example/repo/issues/${issue}#issuecomment-${id}` };
		},
		async editComment(id: number, body: string) {
			const existing = comments.find((comment) => comment.id === id);
			if (!existing) throw new Error(`no comment ${id}`);
			existing.body = body;
			edits.push({ id, body });
			return { id };
		},
	};
}

/** What the daemon observed: the posted comments plus the owner replies read back. */
function reader(port: FakePort): { comments: () => readonly RawComment[]; add: (comment: RawComment) => void } {
	const observed: RawComment[] = [];
	return {
		comments: () => {
			for (const posted of port.comments) {
				const seen = observed.find((comment) => comment.id === posted.id);
				if (seen) seen.body = posted.body;
				else
					observed.push({
						id: posted.id,
						body: posted.body,
						user: { login: DAEMON },
						author_association: "NONE",
						created_at: TS,
						updated_at: TS,
					});
			}
			return observed;
		},
		add: (comment) => {
			observed.push(comment);
		},
	};
}

function reply(input: {
	id: number;
	body: string;
	author?: string;
	association?: string;
	created_at?: string;
	updated_at?: string;
}): RawComment {
	const created = input.created_at ?? LATER;
	return {
		id: input.id,
		body: input.body,
		user: { login: input.author ?? OWNER },
		author_association: input.association ?? "OWNER",
		created_at: created,
		updated_at: input.updated_at ?? created,
	};
}

function laneReplyBody(revision: string, choice: string): string {
	return `<!-- immune-brain:run-id=${RUN_ID} --> <!-- immune-brain:record-revision=${revision} --> ${choice}`;
}

function approvalRequest(binding: InteractionBinding): InteractionRequest {
	return {
		contract: INTERACTION_REQUEST_CONTRACT,
		interaction_id: "plan-approval:issue-42:v7",
		kind: "plan_approval",
		subject: { issue: ISSUE },
		binding,
		prompt: "The plan for issue 42 is published and waits for your approval.",
		answer: "approve_digest",
		authority: "literal_user",
	};
}

function laneDecisionRequest(): InteractionRequest {
	return {
		contract: INTERACTION_REQUEST_CONTRACT,
		interaction_id: `lane-decision:task-7:${REVISION}`,
		kind: "lane_decision",
		subject: { issue: ISSUE, task_id: "task-7", run_id: RUN_ID },
		binding: { record_revision: REVISION },
		prompt: "The Lane hit a gate it cannot decide alone. Which way should it go?",
		options: ["proceed", "stop-work"],
		answer: "choice",
		authority: "literal_user",
	};
}

function setup(request: InteractionRequest, binding?: () => InteractionBinding) {
	const port = fakePort();
	const read = reader(port);
	let current: InteractionBinding = binding ? binding() : { ...request.binding };
	const channel = createGithubInteractionChannel({
		port,
		comments: read.comments,
		binding: () => current,
		guardFacts: OWNER_FACTS,
	});
	return {
		port,
		read,
		channel,
		setBinding: (next: InteractionBinding) => {
			current = next;
		},
	};
}

describe("interaction protocol: one marker comment per interaction_id (S3-AC1)", () => {
	it("posts exactly one marker comment and reports a repost as already_posted", async () => {
		const request = approvalRequest({ plan_digest: PLAN_DIGEST });
		const { port, channel } = setup(request);

		expect(await channel.post(request)).toBe("posted");
		expect(port.comments).toHaveLength(1);
		expect(port.comments[0]!.issue).toBe(ISSUE);
		const marker = parseInteractionMarker(port.comments[0]!.body);
		expect(marker).toMatchObject({
			interaction_id: request.interaction_id,
			kind: "plan_approval",
			binding: { plan_digest: PLAN_DIGEST },
			subject: { issue: ISSUE },
		});

		expect(await channel.post(request)).toBe("already_posted");
		expect(port.comments).toHaveLength(1);
	});

	it("reports a changed binding as stale, edits the comment to a withdrawn notice, then withdrawn", async () => {
		const request = approvalRequest({ plan_digest: PLAN_DIGEST });
		const { port, channel, setBinding } = setup(request);

		expect(await channel.post(request)).toBe("posted");
		expect(await channel.poll(request.interaction_id)).toEqual({ state: "pending" });

		setBinding({ plan_digest: "sha256:newer" });
		expect(await channel.poll(request.interaction_id)).toEqual({ state: "stale" });
		expect(port.edits).toHaveLength(1);
		expect(isWithdrawn(port.edits[0]!.body)).toBe(true);
		expect(port.edits[0]!.body).toContain(INTERACTION_WITHDRAWN_MARKER);
		expect(port.edits[0]!.body).toContain("plan_digest");

		expect(await channel.poll(request.interaction_id)).toEqual({ state: "withdrawn" });
		expect(port.comments).toHaveLength(1);
	});

	it("reports a stale request for a moved record_revision and issue_revision too", async () => {
		const request = laneDecisionRequest();
		const lane = setup(request);
		expect(await lane.channel.post(request)).toBe("posted");
		lane.setBinding({ record_revision: "rev-002" });
		expect(await lane.channel.poll(request.interaction_id)).toEqual({ state: "stale" });

		const issue = approvalRequest({ plan_digest: PLAN_DIGEST, issue_revision: "issue-1" });
		const edit = setup(issue);
		expect(await edit.channel.post(issue)).toBe("posted");
		edit.setBinding({ plan_digest: PLAN_DIGEST, issue_revision: "issue-2" });
		expect(await edit.channel.poll(issue.interaction_id)).toEqual({ state: "stale" });
	});

	it("keeps the pre-protocol Lane decision question and /approve markers readable", () => {
		const question = renderLaneDecisionQuestion({
			task_id: "task-7",
			run_id: RUN_ID,
			record_revision: REVISION,
			question: "Which way?",
			options: [{ id: "proceed", label: "Proceed" }],
		});
		expect(parseInteractionMarker(question)).toBeNull();
		expect(parseLaneDecisionQuestion(question)).toMatchObject({
			run_id: RUN_ID,
			record_revision: REVISION,
			task_id: "task-7",
		});
		expect(parsePlanDigestFromComment(`/approve ${PLAN_DIGEST}`)).toBe(PLAN_DIGEST);
	});

	it("refuses a request whose binding is missing the field its answer must match", async () => {
		const { port, channel } = setup(approvalRequest({}));
		await expect(channel.post(approvalRequest({}))).rejects.toThrow(/interaction_binding_required/);
		expect(port.comments).toHaveLength(0);
	});

	it("treats an absent binding field as unchanged", () => {
		expect(changedBindingFields({ plan_digest: "a" }, { plan_digest: "a" })).toBe("");
		expect(changedBindingFields({ plan_digest: "a" }, { plan_digest: "b" })).toBe("plan_digest");
	});
});

describe("github channel: applied answers (S3-AC2)", () => {
	it("applies an owner /approve <digest> to the published plan digest", async () => {
		const request = approvalRequest({ plan_digest: PLAN_DIGEST });
		const { read, channel } = setup(request);

		expect(channel.accepts(request)).toBe(true);
		expect(await channel.post(request)).toBe("posted");
		read.add(reply({ id: 2001, body: `/approve ${PLAN_DIGEST}` }));

		expect(await channel.poll(request.interaction_id)).toEqual({
			state: "answered",
			value: PLAN_DIGEST,
			actor: OWNER,
			provenance: "github:comment:2001",
		});
	});

	it("applies a Lane decision reply carrying the question's run_id and record_revision", async () => {
		const request = laneDecisionRequest();
		const { read, channel } = setup(request);

		expect(channel.accepts(request)).toBe(true);
		expect(await channel.post(request)).toBe("posted");
		expect(renderInteractionBody(request)).toContain(`immune-brain:run-id=${RUN_ID}`);
		read.add(reply({ id: 2010, body: laneReplyBody(REVISION, "proceed") }));

		expect(await channel.poll(request.interaction_id)).toEqual({
			state: "answered",
			value: "proceed",
			actor: OWNER,
			provenance: "github:comment:2010",
		});
	});

	it("ignores a Lane decision reply naming a different record_revision", async () => {
		const request = laneDecisionRequest();
		const { read, channel } = setup(request);
		expect(await channel.post(request)).toBe("posted");
		read.add(reply({ id: 2011, body: laneReplyBody("rev-000", "proceed") }));
		expect(await channel.poll(request.interaction_id)).toEqual({ state: "pending" });
	});

	it("ignores replies from a non-allowlisted author or the daemon identity", async () => {
		const request = approvalRequest({ plan_digest: PLAN_DIGEST });
		const { read, channel } = setup(request);
		expect(await channel.post(request)).toBe("posted");
		read.add(reply({ id: 2002, body: `/approve ${PLAN_DIGEST}`, author: "stranger", association: "COLLABORATOR" }));
		read.add(reply({ id: 2003, body: `/approve ${PLAN_DIGEST}`, author: DAEMON, association: "OWNER" }));
		expect(await channel.poll(request.interaction_id)).toEqual({ state: "pending" });
	});

	it("ignores an approval naming a different digest or edited after creation", async () => {
		const request = approvalRequest({ plan_digest: PLAN_DIGEST });
		const { read, channel } = setup(request);
		expect(await channel.post(request)).toBe("posted");
		read.add(reply({ id: 2004, body: `/approve sha256:other` }));
		read.add(reply({ id: 2005, body: `/approve ${PLAN_DIGEST}`, created_at: LATER, updated_at: EVEN_LATER }));
		expect(await channel.poll(request.interaction_id)).toEqual({ state: "pending" });
	});
});

describe("github channel: notice-only literal-user operations (S3-AC2)", () => {
	it("posts a stop, breaking Intent revision and authorization request as notice_only naming the local action", async () => {
		for (const operation of ["stop", "breaking_intent_revision", "authorization"] as const) {
			const notice = localOnlyNotice({
				interaction_id: `notice:${operation}:task-7`,
				operation,
				subject: { issue: ISSUE, task_id: "task-7", run_id: RUN_ID },
			});
			const { port, read, channel } = setup(notice);

			expect(channel.accepts(notice)).toBe(false);
			expect(await channel.post(notice)).toBe("notice_only");
			expect(port.comments).toHaveLength(1);
			expect(port.comments[0]!.body).toContain("run `drive`");
			expect(port.comments[0]!.body).toContain("Replies to this comment are not applied");
			expect(await channel.post(notice)).toBe("already_posted");

			// The owner replies on GitHub: nothing is applied.
			read.add(reply({ id: 3000, body: laneReplyBody(REVISION, "stop") }));
			expect(await channel.poll(notice.interaction_id)).toEqual({ state: "pending" });
		}
	});

	it("posts an escalation as notice_only, keyed by its escalation key, and never answers it", async () => {
		const escalation = escalationInteractionRequest({
			key: "repair-cap-key",
			message: "Repair stopped after two attempts on the same failing check.",
			issue_number: ISSUE,
		});
		expect(escalation.interaction_id).toBe("escalation:repair-cap-key");
		const { channel, read } = setup(escalation);
		expect(channel.accepts(escalation)).toBe(false);
		expect(await channel.post(escalation)).toBe("notice_only");
		expect(await channel.post(escalation)).toBe("already_posted");
		read.add(reply({ id: 3001, body: "use the other approach" }));
		expect(await channel.poll(escalation.interaction_id)).toEqual({ state: "pending" });
	});

	it("answers a clarify question with an allowlisted owner reply only", async () => {
		const clarify: InteractionRequest = {
			contract: INTERACTION_REQUEST_CONTRACT,
			interaction_id: "clarify:issue-42:v1",
			kind: "clarify_question",
			subject: { issue: ISSUE },
			binding: { issue_revision: "issue-1" },
			prompt: "Which package should the new command live in?",
			answer: "free_text",
			authority: "advisory",
		};
		const { channel, read } = setup(clarify);
		expect(channel.accepts(clarify)).toBe(true);
		expect(await channel.post(clarify)).toBe("posted");
		read.add(reply({ id: 3002, body: "package A", author: "stranger", association: "MEMBER" }));
		expect(await channel.poll(clarify.interaction_id)).toEqual({ state: "pending" });
		read.add(reply({ id: 3003, body: "package B, next to the existing one" }));
		expect(await channel.poll(clarify.interaction_id)).toEqual({
			state: "answered",
			value: "package B, next to the existing one",
			actor: OWNER,
			provenance: "github:comment:3003",
		});
	});
});

// S4-AC2: the context pack renders on the request's own subject, an advisory
// question supersedes the pending one instead of duplicating it, and a pending
// `literal_user` request is annotated in place — never withdrawn.
const CONTEXT = {
	blocked_on: "the merge conflict survived two repairs",
	tried: ["repaired the PR twice", "re-ran the failing check"],
	options: [{ id: "resume", label: "Resume", consequence: "the Lane continues on the same plan" }],
	evidence: [{ label: "run", ref: "https://example.test/runs/9" }],
};

const waitingRoots: string[] = [];
afterEach(() => {
	for (const root of waitingRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function waitingStateDir(): string {
	const root = mkdtempSync(join(tmpdir(), "imm-loop-waiting-"));
	waitingRoots.push(root);
	return join(root, ".imm/state/loop");
}

function channelFor(port: FakePort, read: { comments: () => readonly RawComment[] }, binding: InteractionBinding = {}) {
	return createGithubInteractionChannel({ port, comments: read.comments, binding: () => binding, guardFacts: OWNER_FACTS });
}

describe("interaction context pack and in-place questions (S4-AC2)", () => {
	it("posts one comment on the subject Issue with blocked-on, tried, options and evidence, and records its pointer", async () => {
		const port = fakePort();
		const read = reader(port);
		const stateDir = waitingStateDir();

		const result = await askOwnerQuestion(
			{ stateDir, now: TS, target: "issue-42", channel: channelFor(port, read), pending_literal_user: [] },
			{ subject: { issue: ISSUE }, context: CONTEXT },
		);

		expect(result.action).toBe("posted");
		expect(port.comments).toHaveLength(1);
		expect(port.comments[0]!.issue).toBe(ISSUE);
		const body = port.comments[0]!.body;
		expect(body).toContain("### Blocked on");
		expect(body).toContain(CONTEXT.blocked_on);
		expect(body).toContain("### Tried");
		expect(body).toContain("- repaired the PR twice");
		expect(body).toContain("### Options");
		expect(body).toContain("1. **Resume** (`resume`) — the Lane continues on the same plan");
		expect(body).toContain("### Evidence");
		expect(body).toContain("[run](https://example.test/runs/9)");

		// D4.6: status carries the pointer only, never the question text.
		expect(listWaitingStatus(stateDir)).toEqual([
			{ target: "issue-42", kind: "escalation", channel: "github", link: expect.any(String) },
		]);
		expect(JSON.stringify(listWaitingStatus(stateDir))).not.toContain(CONTEXT.blocked_on);
	});

	// RF-AC4 / BR-SCN-3: annotating a pending plan_approval makes the target wait on that comment.
	it("annotates a pending plan_approval in place and records its waiting pointer", async () => {
		const port = fakePort();
		const read = reader(port);
		const stateDir = waitingStateDir();
		const channel = channelFor(port, read, { plan_digest: PLAN_DIGEST });
		const approval = approvalRequest({ plan_digest: PLAN_DIGEST });
		expect(await channel.post(approval)).toBe("posted");
		// A stale pointer the target recorded for an older request is still cleared.
		recordWaitingPointer(stateDir, {
			interaction_id: "escalation:old",
			target: "issue-42",
			kind: "escalation",
			channel: "github",
			link: "https://github.com/example/repo/issues/42#issuecomment-1",
			recorded_at: TS,
		});

		const result = await askOwnerQuestion(
			{
				stateDir,
				now: TS,
				target: "issue-42",
				channel,
				pending_literal_user: [{ interaction_id: approval.interaction_id, kind: "plan_approval" }],
			},
			{ subject: { issue: ISSUE }, context: CONTEXT },
		);

		expect(result).toMatchObject({ action: "annotated", interaction_id: approval.interaction_id });
		expect(port.comments).toHaveLength(1);
		expect(port.comments[0]!.body).toContain(CONTEXT.blocked_on);
		expect(listWaitingStatus(stateDir)).toEqual([
			{
				target: "issue-42",
				kind: "plan_approval",
				channel: "github",
				link: `https://github.com/example/repo/issues/${ISSUE}#issuecomment-${port.comments[0]!.id}`,
			},
		]);
		expect(JSON.stringify(listWaitingStatus(stateDir))).not.toContain(CONTEXT.blocked_on);
	});

	it("records no pointer when the channel has no link for an annotated request", async () => {
		const port = fakePort();
		const read = reader(port);
		const stateDir = waitingStateDir();
		const channel = { ...channelFor(port, read, { plan_digest: PLAN_DIGEST }), link: () => null };
		const approval = approvalRequest({ plan_digest: PLAN_DIGEST });
		await channel.post(approval);

		const result = await askOwnerQuestion(
			{ stateDir, now: TS, target: "issue-42", channel, pending_literal_user: [{ interaction_id: approval.interaction_id, kind: "plan_approval" }] },
			{ subject: { issue: ISSUE }, context: CONTEXT },
		);

		expect(result.action).toBe("annotated");
		expect(listWaitingStatus(stateDir)).toEqual([]);
	});

	it("falls through to posting when the annotate finds no request", async () => {
		const port = fakePort();
		const read = reader(port);
		const stateDir = waitingStateDir();

		const result = await askOwnerQuestion(
			{ stateDir, now: TS, target: "issue-42", channel: channelFor(port, read), pending_literal_user: [{ interaction_id: "plan-approval:gone", kind: "plan_approval" }] },
			{ subject: { issue: ISSUE }, context: CONTEXT },
		);

		expect(result.action).toBe("posted");
		expect(listWaitingStatus(stateDir)).toHaveLength(1);
	});

	// RF-AC5 / BR-REQ-7: one byte cut, a valid UTF-8 prefix, within the cap.
	it("cuts a 256 KiB multi-byte blocked_on to the cap as a valid prefix of the original, marker rendered", () => {
		const unit = "阻塞原因：";
		const original = unit.repeat(Math.ceil((256 * 1024) / Buffer.byteLength(unit)));
		const pack = { blocked_on: original, tried: [], options: [], evidence: [] };

		const fitted = fitInteractionContext(pack);
		const rendered = renderInteractionContext(pack);

		expect(fitted.truncated).toBe(true);
		expect(fitted.context.blocked_on.length).toBeGreaterThan(0);
		expect(original.startsWith(fitted.context.blocked_on)).toBe(true);
		expect(fitted.context.blocked_on).not.toContain(String.fromCodePoint(0xfffd));
		expect(Buffer.byteLength(fitted.context.blocked_on, "utf8")).toBeLessThan(CONTEXT_MAX_BYTES);
		expect(Buffer.byteLength(rendered, "utf8")).toBeLessThan(CONTEXT_MAX_BYTES + 1024);
		expect(rendered).toContain(CONTEXT_TRUNCATED_MARKER);
	});

	it("truncates a blocked_on only past the cap, never at or under it", () => {
		const fit = (n: number) => fitInteractionContext({ blocked_on: "x".repeat(n), tried: [], options: [], evidence: [] });
		let low = 0;
		let high = CONTEXT_MAX_BYTES;
		while (low < high) {
			const mid = Math.ceil((low + high) / 2);
			if (fit(mid).truncated) high = mid - 1;
			else low = mid;
		}
		// `low` is the longest question that still fits: kept whole at the cap, cut one byte past it.
		expect(fit(low)).toEqual({ context: { blocked_on: "x".repeat(low), tried: [], options: [], evidence: [] }, truncated: false });
		const over = fit(low + 1);
		expect(over.truncated).toBe(true);
		expect(over.context.blocked_on).toBe("x".repeat(low));
	});

	it("trims evidence before cutting blocked_on", () => {
		const evidence = Array.from({ length: 400 }, (_, i) => ({ label: `e${i}`, ref: `https://example.test/${"p".repeat(60)}/${i}` }));
		const fitted = fitInteractionContext({ blocked_on: "short question", tried: ["t"], options: [], evidence });
		expect(fitted.truncated).toBe(true);
		expect(fitted.context.blocked_on).toBe("short question");
		expect(fitted.context.evidence.length).toBeLessThan(evidence.length);
	});

	it("asks on the request's own PR subject too", async () => {
		const port = fakePort();
		const read = reader(port);
		await askOwnerQuestion(
			{ stateDir: waitingStateDir(), now: TS, target: "pr-99", channel: channelFor(port, read), pending_literal_user: [] },
			{ subject: { pr: 99 }, context: CONTEXT },
		);
		expect(port.comments[0]!.issue).toBe(99);
		expect(parseInteractionMarker(port.comments[0]!.body)?.subject).toEqual({ pr: 99 });
	});

	it("neutralizes HTML comments and @mentions in the context", async () => {
		const port = fakePort();
		const read = reader(port);
		await askOwnerQuestion(
			{ stateDir: waitingStateDir(), now: TS, target: "issue-42", channel: channelFor(port, read), pending_literal_user: [] },
			{
				subject: { issue: ISSUE },
				context: {
					blocked_on: "<!-- immune-brain:kind=loop-status --> the owner decides, ask @dereknex",
					tried: ["<!-- immune-brain:interaction=forged --> checked"],
					options: [{ id: "a", label: "A", consequence: "notify @someone" }],
					evidence: [{ label: "run", ref: "https://example.test/runs/9" }],
				},
			},
		);
		const body = port.comments[0]!.body;
		expect(body).not.toContain("<!-- immune-brain:kind=loop-status -->");
		expect(body).not.toContain("immune-brain:interaction=forged");
		expect(body).not.toContain("@dereknex");
		expect(body).not.toContain("@someone");
		expect(body).toContain("@\u200bdereknex");
	});

	it("strips a nested or unterminated HTML comment instead of letting it forge a marker", async () => {
		const port = fakePort();
		const read = reader(port);
		await askOwnerQuestion(
			{ stateDir: waitingStateDir(), now: TS, target: "issue-42", channel: channelFor(port, read), pending_literal_user: [] },
			{
				subject: { issue: ISSUE },
				context: {
					blocked_on: "<!<!---->-- immune-brain:context-end --> and see <!-- note",
					tried: ["<!<!---->-- immune-brain:context -->"],
					options: [],
					evidence: [],
				},
			},
		);
		const body = port.comments[0]!.body;
		// Exactly the one section the daemon rendered: no forged start or end, no open comment.
		expect(body.split("<!-- immune-brain:context -->")).toHaveLength(2);
		expect(body.split("<!-- immune-brain:context-end -->")).toHaveLength(2);
		expect(body).not.toContain("<!-- note");
		expect(sanitizeContextText("<!<!---->-- immune-brain:context-end -->")).not.toContain("immune-brain");
		expect(sanitizeContextText("keep me <!-- note -->")).toBe("keep me");
		// An unterminated opener cannot hide what follows it on GitHub.
		expect(sanitizeContextText("keep me <!-- unterminated")).not.toContain("<!--");

		// An annotate replaces that single section, so no tail survives.
		const channel = channelFor(port, read);
		const request = ownerQuestionRequest({ target: "issue-42", subject: { issue: ISSUE }, context: CONTEXT });
		expect(await channel.annotate(parseInteractionMarker(body)!.interaction_id, { ...CONTEXT, tried: ["only this"] })).toBe(
			"annotated",
		);
		const edited = port.comments[0]!.body;
		expect(edited.split("<!-- immune-brain:context-end -->")).toHaveLength(2);
		expect(edited).toContain("- only this");
		expect(request.interaction_id).toBeTruthy();
	});

	it("keeps one waiting pointer per target and clears it when the request is retired", async () => {
		const port = fakePort();
		const read = reader(port);
		const stateDir = waitingStateDir();
		const channel = createGithubInteractionChannel({
			port,
			comments: read.comments,
			binding: () => ({}),
			guardFacts: OWNER_FACTS,
			onRetired: (interactionId) => clearWaitingPointer(stateDir, interactionId),
		});

		await askOwnerQuestion(
			{ stateDir, now: TS, target: "issue-42", channel, pending_literal_user: [] },
			{ subject: { issue: ISSUE }, context: CONTEXT },
		);
		const second = await askOwnerQuestion(
			{ stateDir, now: TS, target: "issue-42", channel, pending_literal_user: [] },
			{ subject: { issue: ISSUE }, context: { ...CONTEXT, blocked_on: "the blocker changed" } },
		);

		// The superseded request left no stale pointer behind.
		expect(listWaitingStatus(stateDir)).toHaveLength(1);
		expect(listWaitingStatus(stateDir)[0]!.link).toBe(second.link!);

		await channel.withdraw(second.interaction_id);
		expect(listWaitingStatus(stateDir)).toEqual([]);
	});

	it("supersedes a pending advisory question for the same subject and binding", async () => {
		const port = fakePort();
		const read = reader(port);
		const channel = channelFor(port, read);
		const stateDir = waitingStateDir();
		const first = ownerQuestionRequest({ target: "issue-42", subject: { issue: ISSUE }, context: CONTEXT });
		await channel.post(first);

		const second = ownerQuestionRequest({
			target: "issue-42",
			subject: { issue: ISSUE },
			context: { ...CONTEXT, blocked_on: "the blocker changed after the repair" },
		});
		expect(second.interaction_id).not.toBe(first.interaction_id);
		await channel.post(second);

		expect(port.comments).toHaveLength(2);
		expect(isWithdrawn(port.comments[0]!.body)).toBe(true);
		expect(port.comments[0]!.body).toContain(`Superseded by \`${second.interaction_id}\``);
		expect(isWithdrawn(port.comments[1]!.body)).toBe(false);
		expect(await channel.poll(first.interaction_id)).toEqual({ state: "withdrawn" });
		expect(stateDir).toBeTruthy();
	});

	it("annotates a pending plan_approval in place and still accepts the owner's /approve", async () => {
		const request = approvalRequest({ plan_digest: PLAN_DIGEST });
		const { port, read, channel } = setup(request);
		expect(await channel.post(request)).toBe("posted");

		const asked = await askOwnerQuestion(
			{
				stateDir: waitingStateDir(),
				now: TS,
				target: "issue-42",
				channel,
				pending_literal_user: [{ interaction_id: request.interaction_id, kind: "plan_approval" }],
			},
			{ subject: { issue: ISSUE }, context: CONTEXT },
		);

		expect(asked.action).toBe("annotated");
		expect(asked.interaction_id).toBe(request.interaction_id);
		// One comment, edited in place: same id, kind, binding, never withdrawn.
		expect(port.comments).toHaveLength(1);
		expect(isWithdrawn(port.comments[0]!.body)).toBe(false);
		expect(parseInteractionMarker(port.comments[0]!.body)).toMatchObject({
			interaction_id: request.interaction_id,
			kind: "plan_approval",
			binding: { plan_digest: PLAN_DIGEST },
		});
		expect(port.comments[0]!.body).toContain(CONTEXT.blocked_on);

		// The owner's later answer is still accepted on the same request.
		read.add(reply({ id: 4001, body: `/approve ${PLAN_DIGEST}` }));
		expect(await channel.poll(request.interaction_id)).toEqual({
			state: "answered",
			value: PLAN_DIGEST,
			actor: OWNER,
			provenance: "github:comment:4001",
		});
	});

	it("truncates a context over 8 KiB with a marker", async () => {
		const port = fakePort();
		const read = reader(port);
		const tried = Array.from({ length: 20 }, (_, index) => `${index}: ${"x".repeat(1000)}`);
		await askOwnerQuestion(
			{ stateDir: waitingStateDir(), now: TS, target: "issue-42", channel: channelFor(port, read), pending_literal_user: [] },
			{ subject: { issue: ISSUE }, context: { ...CONTEXT, tried } },
		);
		const body = port.comments[0]!.body;
		expect(body).toContain(CONTEXT_TRUNCATED_MARKER);
		const section = body.slice(body.indexOf(CONTEXT_SECTION_START), body.indexOf(CONTEXT_SECTION_END));
		expect(Buffer.byteLength(section, "utf8")).toBeLessThanOrEqual(CONTEXT_MAX_BYTES + CONTEXT_TRUNCATED_MARKER.length + 8);
	});

	it("reports a failed post without throwing, so local transitions stay unblocked", async () => {
		const stateDir = waitingStateDir();
		const port = fakePort();
		const read = reader(port);
		const failing = {
			...channelFor(port, read),
			post: async () => {
				throw new Error("gh: HTTP 502");
			},
		};
		const asked = await askOwnerQuestion(
			{ stateDir, now: TS, target: "issue-42", channel: failing, pending_literal_user: [] },
			{ subject: { issue: ISSUE }, context: CONTEXT },
		);
		expect(asked.action).toBe("failed");
		expect(asked.reason).toContain("HTTP 502");
		expect(listWaitingStatus(stateDir)).toEqual([]);
	});
});

describe("a Lane dialog is asked once (S5-AC2)", () => {
	it("posts one lane_entry_blocked comment per distinct dialog and annotates it for a leader ask_owner", async () => {
		const { port, read, channel } = setup(approvalRequest({ plan_digest: PLAN_DIGEST }));
		const dialog = { key: "dialog-key", message: "The Lane waits on a startup dialog.", label: "lane_entry_blocked" as const, issue_number: ISSUE };

		// The daemon's escalation path: post once, then skip every retry of the same dialog.
		const first = planEscalation(read.comments(), dialog);
		expect(first.action).toBe("post");
		await port.postComment(ISSUE, first.body);
		expect(planEscalation(read.comments(), dialog).action).toBe("skip");
		expect(port.comments).toHaveLength(1);

		const pending = pendingLaneEntryBlocked({ subject: { issue: ISSUE }, comments: read.comments() });
		expect(pending).toEqual([{ interaction_id: "escalation:lane_entry_blocked:dialog-key" }]);

		const asked = await askOwnerQuestion(
			{ stateDir: waitingStateDir(), now: TS, target: "issue-42", channel, pending_literal_user: [], pending_lane_entry_blocked: pending },
			{ subject: { issue: ISSUE }, context: CONTEXT },
		);

		expect(asked).toMatchObject({ action: "annotated", interaction_id: "escalation:lane_entry_blocked:dialog-key" });
		// Still one comment on the Issue: edited in place, never a second question.
		expect(port.comments).toHaveLength(1);
		expect(port.comments[0]!.body).toContain(CONTEXT.blocked_on);
		expect(isWithdrawn(port.comments[0]!.body)).toBe(false);
	});
});
