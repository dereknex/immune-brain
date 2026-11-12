/**
 * Loop Daemon: Enrollment Confirmation Sources, Composition Root, Executor Exit
 * Record and PR Opening (S5)
 *
 * Verifies S5-AC1 under docs/plans/loop-daemon-s5-drive-pr.intent.json and S5 /
 * D5, D6 in docs/specs/loop-daemon.spec.md:
 * - Positive Control (BR-SCN-2, BR-SCN-3): `tracker_approval` accepts a
 *   verified, unedited, non-daemon owner comment naming the published
 *   `plan_digest`; `policy_auto` accepts a genuine routine task under
 *   `loop.mode: "autonomous"`, `loop.auto_enroll_max_risk: "routine"` and an
 *   isolated identity; the daemon drives a Lane as the 4th composition root,
 *   records the Executor exit and opens the PR on `imm/<slug>`.
 * - Negative Control: `policy_auto` refuses a declared, risk-floor-elevated or
 *   `critical` task, a same-UID `degraded` posture, a `none` cap and a scope
 *   touching `docs/agents/no-touch.json` (BR-OUT-3); `tracker_approval` refuses
 *   a daemon-authored, unlisted, unedited-violating or digest-mismatched
 *   comment.
 * - Boundary Control: `user_session` stays the default and writes no
 *   `confirmation_source`; an unknown batch actor is still refused.
 */

import { afterAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
	isCompositionRootActor,
	isUnattendedCompositionRoot,
	LOOP_DAEMON_ACTOR_ID,
	LITERAL_USER_ACTOR_ID,
} from "../plugins/immune-brain/runtime/kernel/actor_identity.ts";
import {
	computeBatchPlanDigest,
	createBatchAuthorityRegistry,
	type BatchPlanChild,
} from "../plugins/immune-brain/runtime/kernel/batch_authority.ts";
import {
	verifyEnrollmentConfirmation,
	type EnrollmentConfirmationInput,
	type PolicyAutoPolicy,
	type TrackerApprovalPolicy,
	type TrackerApprovalProof,
} from "../plugins/immune-brain/runtime/kernel/enrollment_authority.ts";
import { readTaskRecordRaw } from "../plugins/immune-brain/runtime/kernel/storage.ts";
import {
	dispatchLoopDrive,
	LOOP_DAEMON_BATCH_ACTOR,
	LOOP_DAEMON_COMPOSITION_ROOT,
} from "../plugins/immune-brain/runtime/loop_daemon/drive_dispatcher.ts";
import {
	executorExitPath,
	EXECUTOR_EXIT_RECORD_CONTRACT,
	loopStateDir,
	readExecutorExit,
	recordExecutorExit,
	verificationEvidenceDigest,
} from "../plugins/immune-brain/runtime/loop_daemon/exit_recorder.ts";
import {
	LOOP_PR_MARKER,
	loopPullRequestBody,
	openLoopPullRequest,
	prBranchName,
	type LoopPullRequestPort,
} from "../plugins/immune-brain/runtime/loop_daemon/pr_opener.ts";
import { enrollTaskForTest } from "./helpers/kernel-enroll.ts";

const TS = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-01T00:10:00.000Z";
const PLAN_DIGEST = "sha256:plan-a";

const roots: string[] = [];
afterAll(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(prefix = "loop-drive-pr-"): string {
	const root = mkdtempSync(join(tmpdir(), prefix));
	roots.push(root);
	return root;
}

function write(root: string, path: string, content: string): void {
	mkdirSync(dirname(join(root, path)), { recursive: true });
	writeFileSync(join(root, path), content);
}

/** A committed git fixture, so tracked declarations are trusted the way a checkout makes them. */
function gitFixture(files: Record<string, string> = {}): string {
	const root = tempRoot();
	const git = (args: string[]) =>
		execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], {
			cwd: root,
			stdio: ["ignore", "pipe", "pipe"],
		});
	git(["init", "-q"]);
	for (const [path, content] of Object.entries({ "README.md": "fixture\n", ".gitignore": ".imm/state/\n", ...files }))
		write(root, path, content);
	git(["add", "-A"]);
	git(["commit", "-q", "-m", "fixture"]);
	return root;
}

const ROUTINE = { risk: "routine" as const, scope_hint: ["src/mod/a.ts"] };

function proof(overrides: Partial<TrackerApprovalProof> = {}): TrackerApprovalProof {
	return {
		issue_number: 458,
		comment_id: 9001,
		actor_login: "dereknex",
		author_association: "OWNER",
		created_at: LATER,
		updated_at: LATER,
		plan_digest: PLAN_DIGEST,
		...overrides,
	};
}

function approvalPolicy(overrides: Partial<TrackerApprovalPolicy> = {}): TrackerApprovalPolicy {
	return {
		allowed_actors: ["dereknex"],
		allowed_associations: ["OWNER", "MEMBER", "COLLABORATOR"],
		daemon_identity: "imm-loop-bot",
		plan_digest: PLAN_DIGEST,
		plan_published_at: TS,
		...overrides,
	};
}

function policyAuto(
	overrides: Partial<PolicyAutoPolicy> = {},
): EnrollmentConfirmationInput {
	return {
		source: "policy_auto",
		policy_auto: {
			mode: "autonomous",
			auto_enroll_max_risk: "routine",
			identity_posture: "isolated",
			...overrides,
		},
	};
}

function trackerApproval(
	proofOverrides: Partial<TrackerApprovalProof> = {},
	policyOverrides: Partial<TrackerApprovalPolicy> = {},
): EnrollmentConfirmationInput {
	return {
		source: "tracker_approval",
		tracker_approval: { proof: proof(proofOverrides), policy: approvalPolicy(policyOverrides) },
	};
}

const evaluate = (root: string, input: EnrollmentConfirmationInput, intent = ROUTINE) =>
	verifyEnrollmentConfirmation(root, input, intent);

describe("S5 tracker_approval enrollment (BR-SCN-2)", () => {
	it("accepts a verified, unedited, non-daemon owner comment naming the published digest", () => {
		expect(evaluate(tempRoot(), trackerApproval())).toEqual({ ok: true });
	});

	it("refuses a daemon-authored comment even when its login is allowlisted", () => {
		const verdict = evaluate(
			tempRoot(),
			trackerApproval({ actor_login: "imm-loop-bot" }, { allowed_actors: ["dereknex", "imm-loop-bot"] }),
		);
		expect(verdict.ok).toBe(false);
		expect(verdict.ok === false && verdict.reason).toContain("tracker_approval_daemon_authored");
	});

	it("refuses a comment from an actor outside loop.allowed_actors", () => {
		const verdict = evaluate(tempRoot(), trackerApproval({ actor_login: "stranger" }));
		expect(verdict.ok === false && verdict.reason).toContain("tracker_approval_actor_not_allowed");
	});

	it("refuses a comment whose association is outside loop.allowed_associations", () => {
		const verdict = evaluate(tempRoot(), trackerApproval({ author_association: "CONTRIBUTOR" }));
		expect(verdict.ok === false && verdict.reason).toContain("tracker_approval_association_not_allowed");
	});

	it("refuses a comment created before or at the plan publication instant", () => {
		for (const created_at of ["2025-12-31T23:59:59.000Z", TS]) {
			const verdict = evaluate(tempRoot(), trackerApproval({ created_at, updated_at: created_at }));
			expect(verdict.ok === false && verdict.reason).toContain("tracker_approval_predates_plan");
		}
	});

	it("refuses a comment that was edited after it was created", () => {
		const verdict = evaluate(tempRoot(), trackerApproval({ updated_at: "2026-01-01T00:20:00.000Z" }));
		expect(verdict.ok === false && verdict.reason).toContain("tracker_approval_comment_edited");
	});

	it("refuses an approval naming a different plan_digest", () => {
		const verdict = evaluate(tempRoot(), trackerApproval({ plan_digest: "sha256:plan-b" }));
		expect(verdict.ok === false && verdict.reason).toContain("tracker_approval_digest_mismatch");
	});

	it("refuses a tracker approval that carries no comment proof", () => {
		const verdict = evaluate(tempRoot(), { source: "tracker_approval" });
		expect(verdict.ok === false && verdict.reason).toContain("tracker_approval_missing_proof");
	});
});

describe("S5 policy_auto enrollment (BR-SCN-3, BR-OUT-3)", () => {
	it("accepts a genuine routine task under autonomous mode, a routine cap and an isolated identity", () => {
		expect(evaluate(gitFixture(), policyAuto())).toEqual({ ok: true });
	});

	it("refuses a declared material or critical task", () => {
		for (const risk of ["material", "critical"] as const) {
			const verdict = evaluate(gitFixture(), policyAuto(), { risk, scope_hint: ["src/mod/a.ts"] });
			expect(verdict.ok === false && verdict.reason).toContain(`policy_auto_requires_routine_risk: declared ${risk}`);
		}
	});

	it("refuses a routine task the risk floor raises to material", () => {
		const root = gitFixture({
			".imm/risk-floor.json": JSON.stringify({
				contract: "assurance_kernel/risk_floor/v1",
				material: { paths: ["plugins/immune-brain/runtime/kernel"] },
				critical: { paths: [] },
			}),
		});
		const verdict = evaluate(root, policyAuto(), {
			risk: "routine",
			scope_hint: ["plugins/immune-brain/runtime/kernel/enrollment.ts"],
		});
		expect(verdict.ok === false && verdict.reason).toContain(
			"policy_auto_requires_routine_risk: elevated material",
		);
	});

	it("fails closed on a risk floor declaration that is not committed", () => {
		const root = gitFixture();
		write(
			root,
			".imm/risk-floor.json",
			JSON.stringify({ contract: "assurance_kernel/risk_floor/v1", material: { paths: [] }, critical: { paths: [] } }),
		);
		const verdict = evaluate(root, policyAuto());
		expect(verdict.ok === false && verdict.reason).toContain(
			"policy_auto_requires_routine_risk: elevated critical",
		);
	});

	it("refuses the same-UID degraded posture", () => {
		const verdict = evaluate(gitFixture(), policyAuto({ identity_posture: "degraded" }));
		expect(verdict.ok === false && verdict.reason).toContain("policy_auto_requires_isolated_identity");
	});

	it("refuses a none cap and a mode other than autonomous", () => {
		const capped = evaluate(gitFixture(), policyAuto({ auto_enroll_max_risk: "none" }));
		expect(capped.ok === false && capped.reason).toContain("policy_auto_disabled");
		for (const mode of ["off", "observe", "assist"]) {
			const verdict = evaluate(gitFixture(), policyAuto({ mode }));
			expect(verdict.ok === false && verdict.reason).toContain("policy_auto_mode_not_autonomous");
		}
	});

	it("refuses a scope that touches the no-touch declaration itself or a declared path", () => {
		const ownDeclaration = evaluate(gitFixture(), policyAuto(), {
			risk: "routine",
			scope_hint: ["docs/agents/no-touch.json"],
		});
		expect(ownDeclaration.ok === false && ownDeclaration.reason).toContain("policy_auto_touches_no_touch");

		const root = gitFixture({ "docs/agents/no-touch.json": JSON.stringify({ contract: "immune_brain/no_touch/v1", paths: ["infra/secrets"] }) });
		for (const scope_hint of [["infra/secrets"], ["infra"], ["infra/secrets/deploy.key"]]) {
			const verdict = evaluate(root, policyAuto(), { risk: "routine", scope_hint });
			expect(verdict.ok === false && verdict.reason).toContain("policy_auto_touches_no_touch");
		}
		expect(evaluate(root, policyAuto(), { risk: "routine", scope_hint: ["infra/app.ts"] })).toEqual({ ok: true });
	});
});

describe("S5 confirmation source boundary", () => {
	it("keeps user_session the always-permitted default", () => {
		expect(evaluate(tempRoot(), { source: "user_session" }, { risk: "critical", scope_hint: [] })).toEqual({
			ok: true,
		});
	});

	it("refuses a policy_auto request that states no policy", () => {
		const verdict = evaluate(tempRoot(), { source: "policy_auto" });
		expect(verdict.ok === false && verdict.reason).toContain("policy_auto_missing_policy");
	});

	it("records confirmation_source only for an unattended source", async () => {
		const auto = await enrollUnattended("policy-auto-task");
		expect(auto).toBe("policy_auto");
		const interactive = await enrollUnattended("user-session-task", { source: "user_session" });
		expect(interactive).toBe(null);
	});

	it("refuses the Enrollment itself when policy_auto does not hold", async () => {
		const taskId = "refused-policy-auto-task";
		const root = fixtureRoot(taskId);
		await expect(
			enrollTaskForTest(root, taskId, { confirmation: policyAuto({ identity_posture: "degraded" }) }),
		).rejects.toThrow(/policy_auto_requires_isolated_identity/);
		expect(readTaskRecordRaw(root, taskId).record).toBeNull();
	});
});

function fixtureRoot(taskId: string): string {
	const root = tempRoot();
	write(
		root,
		`docs/plans/${taskId}.intent.json`,
		`${JSON.stringify(
			{
				contract: "assurance_kernel/task_intent/v1",
				task_id: taskId,
				owner: "user",
				goal: "exercise an unattended enrollment",
				acceptance: [{ id: "acc-1", assertion: "the record exists", verification: "bun test" }],
				scope_hint: [`docs/plans/${taskId}.intent.json`, "src/mod/a.ts"],
				risk: "routine",
				revision: 1,
			},
			null,
			2,
		)}\n`,
	);
	mkdirSync(join(root, ".imm", "state"), { recursive: true });
	write(root, "src/mod/a.ts", "export const a = 1;\n");
	write(root, ".gitignore", ".imm/state/\n");
	const git = (args: string[]) =>
		execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], {
			cwd: root,
			stdio: ["ignore", "pipe", "pipe"],
		});
	git(["init", "-q"]);
	git(["add", "-A"]);
	git(["commit", "-q", "-m", "fixture"]);
	return root;
}

async function enrollUnattended(
	taskId: string,
	confirmation: EnrollmentConfirmationInput = policyAuto(),
): Promise<string | null> {
	const root = fixtureRoot(taskId);
	await enrollTaskForTest(root, taskId, { confirmation });
	return readTaskRecordRaw(root, taskId).record?.confirmation_source ?? null;
}

describe("S5 4th composition root", () => {
	it("registers the daemon as the one unattended composition root", () => {
		expect(LOOP_DAEMON_COMPOSITION_ROOT).toBe("loop_daemon");
		expect(LOOP_DAEMON_BATCH_ACTOR).toBe(LOOP_DAEMON_ACTOR_ID);
		expect(isUnattendedCompositionRoot(LOOP_DAEMON_ACTOR_ID)).toBe(true);
		expect(isUnattendedCompositionRoot("github-actions")).toBe(false);
		expect(isCompositionRootActor(LITERAL_USER_ACTOR_ID)).toBe(true);
		expect(isCompositionRootActor("user")).toBe(true);
		expect(isCompositionRootActor(LOOP_DAEMON_ACTOR_ID)).toBe(true);
		expect(isCompositionRootActor("github-actions")).toBe(false);
	});

	it("binds a batch authorization for the daemon and still refuses an unknown actor", () => {
		const registry = createBatchAuthorityRegistry();
		const children: BatchPlanChild[] = [
			{
				task_id: "loop-daemon-s5-drive-pr",
				intent_path: "docs/plans/loop-daemon-s5-drive-pr.intent.json",
				intent_revision: 1,
				intent_content_hash: "sha256:intent",
				blocked_by: [],
			},
		];
		const binding = (actor_id: string) => ({
			batch_id: "batch-s5",
			initiative_slug: "loop-daemon-s5-drive-pr",
			plan_digest: computeBatchPlanDigest(children),
			branch: "imm/loop-daemon-s5-drive-pr",
			base_head: "a".repeat(40),
			budget: { max_children: 1, qa_failure_limit: 1 },
			actor_id,
			confirmation_ref: "policy-auto:458",
			nonce: "nonce-s5",
		});
		expect(() => registry.issue(binding(LOOP_DAEMON_ACTOR_ID), children)).not.toThrow();
		expect(() => registry.issue(binding("github-actions"), children)).toThrow(
			/loop-daemon composition root/,
		);
	});
});

describe("S5 executor exit record", () => {
	it("writes the canonical record binding run, final commit and evidence digest", () => {
		const stateDir = join(tempRoot(), ".imm/state/loop");
		const record = recordExecutorExit(stateDir, {
			run_id: "run-458",
			task_id: "loop-daemon-s5-drive-pr",
			batch_id: "batch-s5",
			lane: {
				repository: "/repo",
				lane_path: "/repo/lane",
				generation: 3,
				pid: 4242,
				code: 0,
				signal: null,
			},
			state: "exited",
			final_commit_sha: "b".repeat(40),
			verification_evidence: "{\"passed\":true}",
			recorded_at: TS,
		});

		expect(record.contract).toBe(EXECUTOR_EXIT_RECORD_CONTRACT);
		expect(record.run_id).toBe("run-458");
		expect(record.final_commit_sha).toBe("b".repeat(40));
		expect(record.verification_evidence_digest).toBe(verificationEvidenceDigest("{\"passed\":true}"));

		const path = executorExitPath(stateDir, "loop-daemon-s5-drive-pr");
		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(record);
		expect(statSync(path).mode & 0o777).toBe(0o600);
		expect(readExecutorExit(stateDir, "loop-daemon-s5-drive-pr")).toEqual(record);
		expect(readExecutorExit(stateDir, "never-recorded")).toBeNull();
	});

	it("records null evidence rather than inventing a digest", () => {
		const stateDir = loopStateDir(tempRoot());
		const record = recordExecutorExit(stateDir, {
			run_id: "run-458",
			task_id: "task",
			batch_id: "batch",
			lane: { repository: "/repo", lane_path: "/repo/lane", generation: 1, pid: 1, code: null, signal: "SIGTERM" },
			state: "interrupted",
			final_commit_sha: null,
			verification_evidence: null,
			recorded_at: TS,
		});
		expect(record.verification_evidence_digest).toBeNull();
		expect(record.state).toBe("interrupted");
	});
});

describe("S5 PR opening", () => {
	it("opens on imm/<slug> with the marker, closing reference, verification and risk", async () => {
		const calls: Array<{ head: string; base: string; draft: boolean; body: string }> = [];
		const port: LoopPullRequestPort = {
			async upsert(input) {
				calls.push(input);
				return { number: 501, url: "https://example.invalid/pull/501", created: true };
			},
		};
		const opened = await openLoopPullRequest(
			{
				slug: "loop-daemon-s5-drive-pr",
				task_id: "loop-daemon-s5-drive-pr",
				issue_number: 466,
				risk: "routine",
				base: "main",
				title: "imm(loop-daemon-s5-drive-pr): deliver S5",
				verification_summary: "bun test tests/loop-daemon-drive-pr.test.ts",
			},
			port,
		);
		expect(opened.branch).toBe(prBranchName("loop-daemon-s5-drive-pr"));
		expect(opened.branch).toBe("imm/loop-daemon-s5-drive-pr");
		expect(opened.draft).toBe(false);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.head).toBe("imm/loop-daemon-s5-drive-pr");
		expect(calls[0]?.body).toContain(LOOP_PR_MARKER);
		expect(calls[0]?.body).toContain("Closes #466");
		expect(calls[0]?.body).toContain("bun test tests/loop-daemon-drive-pr.test.ts");
		expect(calls[0]?.body).toContain("- **Risk**: routine");
	});

	it("opens a non-routine delivery as a draft", () => {
		expect(loopPullRequestBody({ task_id: "t", issue_number: 1, risk: "critical", verification_summary: "v" })).toContain(
			"- **Risk**: critical",
		);
		for (const risk of ["material", "critical"] as const) {
			const opened = openLoopPullRequest(
				{
					slug: "task",
					task_id: "task",
					issue_number: 1,
					risk,
					base: "main",
					title: "t",
					verification_summary: "v",
				},
				{ async upsert() { return { number: 1, url: "u", created: true }; } },
			);
			expect(opened).resolves.toMatchObject({ draft: true });
		}
	});
});

describe("S5 daemon drive dispatch", () => {
	it("composes a single-task startBatch call with the Lane supervisor and records the exit", async () => {
		const stateDir = join(tempRoot(), ".imm/state/loop");
		const seen: Array<Record<string, unknown>> = [];
		const exit = {
			repository: "/repo",
			lane_path: "/repo/lane",
			generation: 7,
			pid: 4242,
			code: 0,
			signal: null,
		};

		const result = await dispatchLoopDrive({
			root: "/repo",
			batch_id: "batch-s5",
			initiative_slug: "loop-daemon-s5-drive-pr",
			registry: createBatchAuthorityRegistry(),
			capability: {},
			children: [],
			plan_digest: PLAN_DIGEST,
			base_head: "c".repeat(40),
			confirmation_time: TS,
			budget: { max_children: 1, qa_failure_limit: 1 },
			now: TS,
			kernel: {} as never,
			supervision: { parent_host: "pi", plugin_dir: "/plugin", wait_ms: 1000, stop: false },
			run_id: "run-458",
			final_commit_sha: "d".repeat(40),
			verification_evidence: "{\"passed\":true}",
			state_dir: stateDir,
			async start_batch(input) {
				seen.push(input as unknown as Record<string, unknown>);
				return {
					contract: "assurance_kernel/batch_run_report/v1",
					batch_id: input.batch_id,
					initiative_slug: input.initiative_slug,
					batch_state: "running",
					max_parallel: 1,
					children: [],
					commits: [],
					reason: null,
					handoffs: [],
					lane_supervision: { state: "exited", generation: 7, exit, not_applied: [] },
					next_action: "",
					created_at: TS,
				} as never;
			},
		});

		expect(seen).toHaveLength(1);
		const input = seen[0]!;
		expect(input.plan_source).toBe("single_task");
		expect(input.initiative_slug).toBe("loop-daemon-s5-drive-pr");
		expect(input.base_head).toBe("c".repeat(40));
		expect(input.supervision).toMatchObject({ parentHost: "pi", pluginDir: "/plugin", waitMs: 1000 });
		expect((input.supervision as { supervisor: unknown }).supervisor).toBeDefined();
		expect(result.exit_record).toMatchObject({
			contract: EXECUTOR_EXIT_RECORD_CONTRACT,
			run_id: "run-458",
			task_id: "loop-daemon-s5-drive-pr",
			generation: 7,
			final_commit_sha: "d".repeat(40),
			state: "exited",
		});
		expect(readExecutorExit(stateDir, "loop-daemon-s5-drive-pr")?.run_id).toBe("run-458");
	});

	it("records no exit when the call observed no Executor exit", async () => {
		const stateDir = join(tempRoot(), ".imm/state/loop");
		const result = await dispatchLoopDrive({
			root: "/repo",
			batch_id: "batch-s5",
			initiative_slug: "task",
			registry: createBatchAuthorityRegistry(),
			capability: {},
			children: [],
			plan_digest: PLAN_DIGEST,
			base_head: "c".repeat(40),
			confirmation_time: TS,
			budget: { max_children: 1, qa_failure_limit: 1 },
			now: TS,
			kernel: {} as never,
			supervision: { parent_host: "pi", plugin_dir: "/plugin", wait_ms: 1000, stop: false },
			run_id: "run-458",
			state_dir: stateDir,
			async start_batch(input) {
				return {
					contract: "assurance_kernel/batch_run_report/v1",
					batch_id: input.batch_id,
					initiative_slug: input.initiative_slug,
					batch_state: "running",
					max_parallel: 1,
					children: [],
					commits: [],
					reason: null,
					handoffs: [],
					lane_supervision: { state: "running", generation: 7, exit: null, not_applied: [] },
					next_action: "",
					created_at: TS,
				} as never;
			},
		});
		expect(result.exit_record).toBeNull();
		expect(readExecutorExit(stateDir, "task")).toBeNull();
	});
});
