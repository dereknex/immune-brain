/**
 * Loop Daemon: Configuration, Identity, Status Issue, Escalation & Owner Commands Tests (S3)
 *
 * Verifies S3-AC1 under docs/plans/loop-daemon-s3-config-comms.intent.json and
 * S3 / D3 in docs/specs/loop-daemon.spec.md (BR-REQ-3, BR-DEFER-1, BR-DEFER-2):
 * - Positive Control: a valid `loop` block parses, the single loop-status Issue
 *   is edited in place, and a verified owner `@imm-loop` command is accepted.
 * - Negative Control: `auto_enroll_max_risk: "material"` / `"critical"` fails
 *   config validation, and a command from a non-allowlisted actor or a low
 *   `author_association` is rejected.
 * - Boundary / Fault Control: same-UID detection degrades the posture and
 *   blocks `policy_auto`, and a duplicate escalation key updates the existing
 *   comment instead of posting a second one.
 */

import { afterAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	DEFAULT_LOOP_CONFIG,
	resolveConfig,
} from "../plugins/immune-brain/runtime/config/layered_config.ts";
import {
	escalationKey,
	parseEscalationKey,
	planEscalation,
	renderEscalationBody,
} from "../plugins/immune-brain/runtime/loop_daemon/escalation.ts";
import {
	type GuardFacts,
	evaluateGuards,
	firstBlock,
} from "../plugins/immune-brain/runtime/loop_daemon/guards.ts";
import type { LoopHandler } from "../plugins/immune-brain/runtime/loop_daemon/handlers.ts";
import {
	capabilityRefusal,
	detectIdentityPosture,
	inspectDaemonIdentity,
} from "../plugins/immune-brain/runtime/loop_daemon/identity.ts";
import { judgeEvent } from "../plugins/immune-brain/runtime/loop_daemon/judgement.ts";
import {
	OWNER_COMMAND_HANDLERS,
	resolveOwnerCommand,
} from "../plugins/immune-brain/runtime/loop_daemon/owner_commands.ts";
import {
	LOOP_STATUS_MARKER,
	planStatusIssue,
	renderStatusIssueBody,
	type LoopStatusSnapshot,
} from "../plugins/immune-brain/runtime/loop_daemon/status_issue.ts";
import {
	LOOP_DAEMON_EVENT_CONTRACT,
	type E3OwnerCommentEvent,
	type E5ReadyTaskEvent,
	type RawComment,
	type RawIssue,
} from "../plugins/immune-brain/runtime/loop_daemon/types.ts";

const TS = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-02T00:00:00.000Z";

const temp = mkdtempSync(join(tmpdir(), "loop-config-comms-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));
let counter = 0;

function fixture() {
	const root = join(temp, `repo-${counter++}`);
	const userPath = join(temp, `user-${counter}.json`);
	mkdirSync(join(root, ".imm"), { recursive: true });
	execFileSync("git", ["init", "-q", root]);
	writeFileSync(userPath, JSON.stringify({ contract: "immune_brain/user_config/v1" }));
	const project = (data: object) => {
		writeFileSync(join(root, ".imm/config.json"), JSON.stringify({ contract: "immune_brain/project_config/v1", ...data }));
		execFileSync("git", ["add", ".imm/config.json"], { cwd: root });
	};
	return { root, project, read: () => resolveConfig(root, { userConfigPath: userPath }) };
}

function issue(number: number, body: string): RawIssue {
	return {
		id: number,
		number,
		title: `Issue ${number}`,
		body,
		state: "open",
		created_at: TS,
		updated_at: TS,
		author: { login: "owner" },
	};
}

function comment(id: number, body: string): RawComment {
	return {
		id,
		body,
		user: { login: "owner" },
		author_association: "OWNER",
		created_at: TS,
		updated_at: TS,
	};
}

function snapshot(overrides: Partial<LoopStatusSnapshot> = {}): LoopStatusSnapshot {
	return {
		identity_posture: "degraded",
		paused: false,
		pause_reason: null,
		active_leases: 1,
		queue_depth: 2,
		open_daemon_prs: 0,
		budget_usage: { ticks_today: 3, dispatches_today: 1 },
		recent_escalations: [],
		updated_at: TS,
		...overrides,
	};
}

const OWNER_FACTS: GuardFacts = {
	allowed_actors: ["owner"],
	allowed_associations: ["OWNER", "MEMBER", "COLLABORATOR"],
};

function ownerComment(overrides: Partial<E3OwnerCommentEvent> = {}): E3OwnerCommentEvent {
	return {
		contract: LOOP_DAEMON_EVENT_CONTRACT,
		event_id: "evt-e3-10-900",
		kind: "E3_OWNER_COMMENT",
		timestamp: TS,
		issue_number: 10,
		comment_id: 900,
		author: "owner",
		author_association: "OWNER",
		body: "@imm-loop replan",
		created_at: TS,
		updated_at: TS,
		...overrides,
	};
}

function readyTaskEvent(): E5ReadyTaskEvent {
	return {
		contract: LOOP_DAEMON_EVENT_CONTRACT,
		event_id: "evt-e5-10",
		kind: "E5_READY_TASK",
		timestamp: TS,
		issue_number: 10,
		task_id: "widget-task",
	};
}

describe("loop configuration block", () => {
	it("admits a valid loop block, keeping defaults for unset keys", () => {
		const f = fixture();
		f.project({
			loop: {
				mode: "assist",
				interval_seconds: 30,
				max_concurrent: 3,
				auto_enroll_max_risk: "routine",
				allowed_actors: ["owner"],
				allowed_associations: ["OWNER", "MEMBER"],
				budget: { max_dispatches_per_day: 12 },
			},
		});
		const config = f.read();
		expect(config.loop.valid).toBe(true);
		expect(config.loop.source).toBe("project");
		expect(config.loop.value).toEqual({
			mode: "assist",
			interval_seconds: 30,
			max_concurrent: 3,
			max_ready_buffer: 5,
			max_pr_buffer: 5,
			auto_enroll_max_risk: "routine",
			allowed_actors: ["owner"],
			allowed_associations: ["OWNER", "MEMBER"],
			budget: { max_ticks_per_day: null, max_dispatches_per_day: 12 },
		});
	});

	it("falls back to the off-by-default loop configuration", () => {
		const f = fixture();
		f.project({});
		expect(f.read().loop).toEqual({ valid: true, value: DEFAULT_LOOP_CONFIG, source: "default" });
	});

	it("rejects auto_enroll_max_risk above routine", () => {
		for (const risk of ["material", "critical"]) {
			const f = fixture();
			f.project({ loop: { auto_enroll_max_risk: risk } });
			const config = f.read();
			expect(config.loop.valid).toBe(false);
			expect(config.loop.value).toBeNull();
			expect(config.diagnostics).toContainEqual(
				expect.objectContaining({ code: "config_invalid", key_path: "loop.auto_enroll_max_risk" }),
			);
		}
	});

	it("rejects values outside the declared ranges and unknown keys", () => {
		const invalid: Array<[string, object]> = [
			["loop.interval_seconds", { interval_seconds: 10 }],
			["loop.max_concurrent", { max_concurrent: 9 }],
			["loop.max_pr_buffer", { max_pr_buffer: 0 }],
			["loop.mode", { mode: "always" }],
			["loop.allowed_associations", { allowed_associations: ["NONE"] }],
			["loop.budget.max_ticks_per_day", { budget: { max_ticks_per_day: 0 } }],
			["loop.unknown", { unknown: true }],
		];
		for (const [keyPath, loop] of invalid) {
			const f = fixture();
			f.project({ loop });
			const config = f.read();
			expect(config.loop.valid).toBe(false);
			expect(config.diagnostics).toContainEqual(
				expect.objectContaining({ code: "config_invalid", key_path: keyPath }),
			);
		}
	});
});

describe("same-UID identity posture", () => {
	it("degrades on the same UID, withholding policy_auto and merge_pr but not publication", () => {
		const posture = detectIdentityPosture({
			daemon_uid: 501,
			worktree_uid: 501,
			isolated_runner_boundary: false,
			worktree_shares_credentials: false,
		});
		expect(posture).toBe("degraded");
		expect(capabilityRefusal(posture, "policy_auto")).toBe("same-UID degraded posture withholds policy_auto");
		expect(capabilityRefusal(posture, "merge_pr")).toBe("merge_pr is human-only in every posture");
		expect(capabilityRefusal(posture, "publish_plan")).toBeNull();
		expect(capabilityRefusal(posture, "publish_question")).toBeNull();
		expect(capabilityRefusal(posture, "observe")).toBeNull();
	});

	it("is isolated only behind a proven separate identity", () => {
		const separate = detectIdentityPosture({
			daemon_uid: 501,
			worktree_uid: 502,
			isolated_runner_boundary: true,
			worktree_shares_credentials: false,
		});
		expect(separate).toBe("isolated");
		expect(capabilityRefusal(separate, "policy_auto")).toBeNull();
		expect(capabilityRefusal(separate, "merge_pr")).not.toBeNull();

		const sharedCredentials = detectIdentityPosture({
			daemon_uid: 501,
			worktree_uid: 502,
			isolated_runner_boundary: true,
			worktree_shares_credentials: true,
		});
		expect(sharedCredentials).toBe("degraded");

		expect(
			detectIdentityPosture({
				daemon_uid: null,
				worktree_uid: null,
				isolated_runner_boundary: false,
				worktree_shares_credentials: false,
			}),
		).toBe("degraded");
	});

	it("reads the real process and worktree UIDs", () => {
		expect(detectIdentityPosture(inspectDaemonIdentity(process.cwd()))).toBe("degraded");
	});

	it("feeds the detected posture into guard G10 for policy_auto", () => {
		const posture = detectIdentityPosture({
			daemon_uid: 501,
			worktree_uid: 501,
			isolated_runner_boundary: false,
			worktree_shares_credentials: false,
		});
		const blocked = evaluateGuards(readyTaskEvent(), { identity_posture: posture, confirmation_source: "policy_auto" });
		expect(firstBlock(blocked)?.guard).toBe("G10");
		const allowed = evaluateGuards(readyTaskEvent(), { identity_posture: posture, confirmation_source: "tracker_approval" });
		expect(firstBlock(allowed)).toBeNull();
	});
});

describe("single status Issue", () => {
	it("creates the status Issue once and afterwards edits it in place", () => {
		const snap = snapshot();
		expect(planStatusIssue([], snap)).toMatchObject({ action: "create", issue_number: null });
		expect(planStatusIssue([issue(7, "unrelated body"), issue(42, `${LOOP_STATUS_MARKER}\nold status`)], snap)).toMatchObject({
			action: "update",
			issue_number: 42,
			duplicate_issue_numbers: [],
		});
		expect(planStatusIssue([issue(42, renderStatusIssueBody(snap))], snap)).toMatchObject({
			action: "noop",
			issue_number: 42,
		});
	});

	it("reports one canonical status Issue when the marker appears twice", () => {
		const issues = [issue(60, LOOP_STATUS_MARKER), issue(50, `${LOOP_STATUS_MARKER}\nstale`)];
		expect(planStatusIssue(issues, snapshot())).toMatchObject({
			action: "update",
			issue_number: 50,
			duplicate_issue_numbers: [60],
		});
	});

	it("renders the degraded posture and budget usage into the status body", () => {
		const body = renderStatusIssueBody(snapshot({ paused: true, pause_reason: "owner pause" }));
		expect(body.startsWith(LOOP_STATUS_MARKER)).toBe(true);
		expect(body).toContain("**degraded**");
		expect(body).toContain("yes (owner pause)");
		expect(body).toContain("3 ticks, 1 dispatches");
	});
});

describe("marker-keyed escalations", () => {
	it("posts once per key and updates the keyed comment in place", () => {
		const key = escalationKey({ kind: "escalate", target: "issue-10", detail: "repair cap reached" });
		expect(planEscalation([], { key, message: "Repair cap reached on #10" })).toMatchObject({
			action: "post",
			comment_id: null,
		});
		expect(parseEscalationKey(renderEscalationBody(key, "message"))).toBe(key);

		const unchanged = [comment(1, renderEscalationBody(key, "Repair cap reached on #10"))];
		expect(planEscalation(unchanged, { key, message: "Repair cap reached on #10" })).toMatchObject({
			action: "skip",
			comment_id: 1,
		});

		const duplicated = [comment(2, renderEscalationBody(key, "older")), comment(1, renderEscalationBody(key, "old"))];
		expect(planEscalation(duplicated, { key, message: "new detail" })).toMatchObject({
			action: "update",
			comment_id: 1,
		});
	});

	it("derives a distinct key per subject and one comment without a marker never matches", () => {
		expect(escalationKey({ kind: "escalate", target: "issue-10" })).not.toBe(
			escalationKey({ kind: "escalate", target: "issue-11" }),
		);
		const key = escalationKey({ kind: "escalate", target: "issue-10" });
		expect(planEscalation([comment(3, "an unrelated escalation")], { key, message: "detail" })).toMatchObject({
			action: "post",
		});
	});
});

describe("verified @imm-loop owner commands", () => {
	it("maps every accepted command to its handler", () => {
		const commands: Array<[string, LoopHandler]> = [
			["@imm-loop pause", "noop_record"],
			["@imm-loop resume", "noop_record"],
			["@imm-loop replan", "draft_plan"],
			["@imm-loop approve sha256:plan-a", "enroll_and_drive"],
			["@imm-loop retry", "repair_pr_ci"],
			["@imm-loop ignore", "noop_record"],
		];
		for (const [body, handler] of commands) {
			expect(OWNER_COMMAND_HANDLERS[body.split(" ")[1] as keyof typeof OWNER_COMMAND_HANDLERS]).toBe(handler);
			const decision = resolveOwnerCommand(ownerComment({ body }), OWNER_FACTS);
			expect(decision.accepted).toBe(true);
			expect(decision.handler).toBe(handler);
		}
	});

	it("rejects unverified actors, edited comments, and an approve without a digest", () => {
		expect(resolveOwnerCommand(ownerComment({ author_association: "NONE" }), OWNER_FACTS)).toMatchObject({
			accepted: false,
			handler: null,
			reason: "unverified actor",
		});
		expect(resolveOwnerCommand(ownerComment({ author_association: "CONTRIBUTOR" }), OWNER_FACTS)).toMatchObject({
			accepted: false,
			handler: null,
			reason: "unverified actor",
		});
		expect(resolveOwnerCommand(ownerComment({ author: "stranger" }), OWNER_FACTS)).toMatchObject({
			accepted: false,
			handler: null,
		});
		expect(resolveOwnerCommand(ownerComment({ updated_at: LATER }), OWNER_FACTS)).toMatchObject({
			accepted: false,
			handler: null,
			reason: "comment was edited after posting",
		});
		expect(resolveOwnerCommand(ownerComment({ body: "@imm-loop approve" }), OWNER_FACTS)).toMatchObject({
			accepted: false,
			handler: null,
			reason: "approve names no plan digest",
		});
		expect(resolveOwnerCommand(ownerComment({ body: "Looks good to me." }), OWNER_FACTS)).toMatchObject({
			accepted: false,
			command: null,
			handler: null,
		});
	});

	it("settles a rejected command at Tier 1 instead of letting Tier 2 classify it", async () => {
		const edited = await judgeEvent(ownerComment({ body: "@imm-loop approve sha256:plan-a", updated_at: LATER }), {
			facts: OWNER_FACTS,
		});
		expect(edited).toMatchObject({ tier: 1, handler: "noop_record" });
		expect(edited.reason).toContain("comment was edited after posting");

		const noDigest = await judgeEvent(ownerComment({ body: "@imm-loop approve" }), { facts: OWNER_FACTS });
		expect(noDigest).toMatchObject({ tier: 1, handler: "noop_record" });
		expect(noDigest.reason).toContain("approve names no plan digest");
	});

	it("routes a verified command through Tier 1 and blocks an unverified one at G7", async () => {
		const verified = await judgeEvent(ownerComment({ body: "@imm-loop pause" }), { facts: OWNER_FACTS });
		expect(verified).toMatchObject({ tier: 1, handler: "noop_record" });

		const unverified = await judgeEvent(ownerComment({ body: "@imm-loop pause", author_association: "NONE" }), {
			facts: OWNER_FACTS,
		});
		expect(unverified).toMatchObject({ tier: 0, handler: "noop_record" });
		expect(unverified.guard?.id).toBe("G7");
	});
});
