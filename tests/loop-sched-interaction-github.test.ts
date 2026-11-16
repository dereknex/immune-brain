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

import { describe, expect, it } from "bun:test";

import { parseLaneDecisionQuestion, renderLaneDecisionQuestion } from "../plugins/immune-brain/runtime/loop_daemon/decision_relay.ts";
import { escalationInteractionRequest } from "../plugins/immune-brain/runtime/loop_daemon/escalation.ts";
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
	type InteractionBinding,
	type InteractionRequest,
} from "../plugins/immune-brain/runtime/loop_daemon/interaction/protocol.ts";
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
			return { id };
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
