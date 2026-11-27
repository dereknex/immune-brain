import { writeTestReviewPacket } from "./helpers/review-packet-fixture";
import { reviewerTranscripts } from "./helpers/claude-reviewer-transcript";
import { parseReviewPacketHandle } from "../plugins/immune-brain/runtime/assurance/review_packet";
import type { VerdictAuthority } from "../plugins/immune-brain/runtime/assurance/verdict_authority";
import { afterAll, describe, expect, mock, setDefaultTimeout, spyOn, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	appendPrivate,
	cacheDir,
	dropPrivate,
	ensurePrivateDir,
	ownedByUs,
	readPrivate,
	sessionHash,
	writePrivate,
} from "../plugins/immune-brain/runtime/host-core/private_file";
import {
	AssuranceCoordinator,
	snapshotDigest,
	type AssuranceCoordinatorPorts,
	type AssuranceVerdict,
	type SnapshotDescriptor,
} from "../plugins/immune-brain/runtime/assurance/coordinator";
import { readSettledTaskEvidence, revisionForContent } from "../plugins/immune-brain/runtime/kernel/storage";
import { readBackendClaim } from "../plugins/immune-brain/runtime/kernel/backend_claim";
import { PassThrough } from "node:stream";
import { ClaudeReviewHost, claudeHookEventLog } from "../plugins/immune-brain/runtime/claude/review_host";
import { AntigravityReviewHost, antigravityHookEventLog, type AntigravityHookEvent } from "../plugins/immune-brain/runtime/antigravity/review_host";
import { PiReviewHost, PI_VERIFIER_AGENT } from "../plugins/immune-brain/.pi-extension/pi-canary-assurance-progression.ts";
import { AntigravityRuntime } from "../plugins/immune-brain/runtime/antigravity/kernel_ports";
import { HostRuntime } from "../plugins/immune-brain/runtime/host-core/runtime";
import { NativeAuthorityError } from "../plugins/immune-brain/runtime/host-core/interaction";
import { MemoryHookEventLog, type HookEventLog } from "../plugins/immune-brain/runtime/host-core/hook_event_log";
import { CliReviewHost } from "../plugins/immune-brain/runtime/assurance/cli_review";
import { installCliReviewer, runReservedReview } from "./helpers/cli-reviewer";
import { ClaudeRuntime, settledKernelResult, type ToolMeta } from "../plugins/immune-brain/runtime/claude/kernel_ports";
import { enrollTaskForTest } from "./helpers/kernel-enroll";
import { MIN_CLAUDE_CODE_VERSION, probeHost } from "../plugins/immune-brain/runtime/claude/capability";
import { MIN_ANTIGRAVITY_VERSION } from "../plugins/immune-brain/runtime/antigravity/capability";
import { createAntigravityMcpRuntime } from "../plugins/immune-brain/runtime/antigravity/mcp_server";
import { createMcpRuntime as createMcpRuntimeUngated, handleJsonRpc, serveStdio } from "../plugins/immune-brain/runtime/claude/mcp_server";
import { PHASE_ENTRY_RECOVERY, RUN_ENTRY_REQUIRED } from "../plugins/immune-brain/runtime/assurance/phase_entry";
import { consumePhaseAdmission, phaseEntryGateHookOutput, recordPhaseEntryPrompt, type GatedTool } from "../plugins/immune-brain/runtime/claude/lane_guard";
import type { ReviewFacts } from "../plugins/immune-brain/runtime/assurance/review_evidence";
import type { AssuranceHostPort, HostReviewReservation } from "../plugins/immune-brain/runtime/assurance/host_port";
import {
	captureStagedIntent,
	restoreStagedIntent,
} from "../plugins/immune-brain/runtime/staged_intent";
import { deriveAuthorizationOperation } from "../plugins/immune-brain/runtime/authorization_operation";
import { projectTerminalTrackerState } from "../plugins/immune-brain/runtime/assurance/coordinator";
import { LITERAL_USER_ACTOR_ID, canonicalActorId, isLiteralUserActor } from "../plugins/immune-brain/runtime/kernel/actor_identity";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { enrollCanaryTask } from "../plugins/immune-brain/runtime/kernel/enrollment";
import {
	createEnrollmentAuthorityRegistry,
	type EnrollmentCapabilityBinding,
} from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { preparePiCanary } from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import { readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import { withKernelTransaction } from "../plugins/immune-brain/runtime/kernel/sqlite_store";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import { seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";
import { writeEnrollmentBaseline } from "../plugins/immune-brain/runtime/workspace_scope";

// The phase entry gate (ADR 0019) sits in front of
// `start_unattended_batch`. These tests exercise what lies behind it, so the
// session records a real run entry and each gated call is admitted through the
// real hook; tests/claude-phase-entry-gate.test.ts owns the refusals.
function withRunEntry(workspace?: string): { consumePhaseAdmission: (toolCallId: string, operation: GatedTool) => ReturnType<typeof consumePhaseAdmission> } {
	const root = mkdtempSync(join(tmpdir(), "imm-phase-entry-"));
	// The entry token binds the workspace the entry was typed in (ADR 0025).
	const session = { session_id: "phase-entry-test-session", cwd: workspace ?? root };
	recordPhaseEntryPrompt({ hook_event_name: "UserPromptSubmit", prompt: "/drive", ...session }, { root, home: root });
	return {
		consumePhaseAdmission(toolCallId, operation) {
			phaseEntryGateHookOutput({
				hook_event_name: "PreToolUse",
				tool_name: `mcp__plugin_immune-brain_immune-brain__${operation}`,
				tool_use_id: toolCallId,
				...session,
			}, { root });
			return consumePhaseAdmission(toolCallId, operation, root);
		},
	};
}
function createMcpRuntime(options: Parameters<typeof createMcpRuntimeUngated>[0] = {}) {
	return createMcpRuntimeUngated({ ...withRunEntry(options.cwd), ...options });
}

// The Kernel QA delivery workspace is a dependency-free checkout of the frozen
// tree: `typebox` and the Pi host packages belong to the running Host, not to
// this repository. Register the seams they provide only when they cannot be
// imported here, so an ordinary suite run keeps the real modules and never
// hands a Host-facing sibling test file a mocked Host package.
async function hostPackagesAvailable(): Promise<boolean> {
	for (const specifier of [
		"typebox",
		"@earendil-works/pi-coding-agent",
		"@earendil-works/pi-tui",
	]) {
		try {
			await import(specifier);
		} catch {
			return false;
		}
	}
	return true;
}

if (!(await hostPackagesAvailable())) {
	const hostClass = (): unknown => class {};
	mock.module("typebox", () => ({ Type: new Proxy({}, { get: () => () => ({}) }) }));
	mock.module("@earendil-works/pi-coding-agent", () => ({ DynamicBorder: hostClass() }));
	mock.module("@earendil-works/pi-tui", () => ({
		Container: hostClass(),
		SelectList: hostClass(),
		Text: hostClass(),
		sliceByColumn: () => "",
		truncateToWidth: (text: string) => text,
		visibleWidth: () => 0,
	}));
}

const { PiRuntime } = await import("../plugins/immune-brain/.pi-extension/pi-host-runtime");
const { createPiRuntimeDriver } = await import("./helpers/pi-canary-assurance-harness");
const { createPiAssuranceProgressionPorts } = await import("../plugins/immune-brain/.pi-extension/imm-canary-work");

// Registered seams are process-global; drop them when this file finishes so a
// later file in the same process starts from the real module registry.
afterAll(() => {
	mock.restore();
});

const FIXTURE_NOW = "2026-08-12T10:00:00.000Z";
// A Review is prepared only inside Herdr (Spec retire-process-review-transport D2).
const HOST_ENV = { CLAUDE_CODE_VERSION: "2.1.236", CLAUDE_CODE_PERMISSION_MODE: "manual", HERDR_ENV: "1", HERDR_WORKSPACE_ID: "w-parent" };

/**
 * Settle one Review through the CLI dispatcher (Spec review-cli-stage D11): the
 * fixture root carries a review profile and PATH carries the stand-in binary,
 * so the reserved script runs here and its bytes are the submitted verdict.
 */
function settleCli(coordinator: AssuranceCoordinator, ready: unknown, verdict: AssuranceVerdict) {
	runReservedReview(ready, verdict);
	return coordinator.submitReview(TASK, ctx, verdict);
}

/** One enrolled fixture repository both Host adapters drive below. */
installCliReviewer();

function enrolledHostFixture(taskId: string, extraScope: string[] = []): string {
	const root = mkdtempSync(join(tmpdir(), "imm-host-divergence-"));
	mkdirSync(join(root, ".imm/state"), { recursive: true });
	writeFileSync(join(root, ".imm/config.json"), JSON.stringify({
		contract: "immune_brain/project_config/v2",
		agents: { reviewer: "pi" },
	}) + "\n");
	mkdirSync(join(root, "docs/plans"), { recursive: true });
	mkdirSync(join(root, "docs/specs/archive"), { recursive: true });
	const intent = {
		contract: "assurance_kernel/task_intent/v1",
		task_id: taskId,
		owner: "user",
		goal: "exercise converged Host behaviour",
		acceptance: [{ id: "acc-1", assertion: "initial assertion", verification: "bun test" }],
		scope_hint: [
			`docs/plans/${taskId}.intent.json`,
			`docs/specs/${taskId}.spec.md`,
			`docs/specs/archive/${taskId}.spec.md`,
			...extraScope,
		],
		risk: "routine",
		revision: 1,
	};
	for (const path of extraScope) {
		mkdirSync(join(root, path, ".."), { recursive: true });
		writeFileSync(join(root, path), "export {};\n");
	}
	writeFileSync(join(root, "docs/plans", `${taskId}.intent.json`), `${JSON.stringify(intent, null, 2)}\n`);
	writeFileSync(join(root, "docs/specs", `${taskId}.spec.md`), `# ${taskId}\n`);
	execFileSync("git", ["init", "-q"], { cwd: root });
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-q", "-m", "fixture"], {
		cwd: root,
	});
	const registry = createEnrollmentAuthorityRegistry();
	const read = readTaskIntent(root, taskId, `docs/plans/${taskId}.intent.json`);
	const preparation = preparePiCanary(root, { task_id: taskId, now: FIXTURE_NOW });
	const binding: EnrollmentCapabilityBinding = {
		task_id: taskId,
		intent_path: `docs/plans/${taskId}.intent.json`,
		intent_revision: 1,
		intent_content_hash: read.content_hash,
		preparation_digest: preparation.digest,
		actor_id: "user",
		confirmation_ref: "c",
		nonce: "n",
	};
	enrollCanaryTask(
		root,
		{
			task_id: taskId,
			intent_path: binding.intent_path,
			intent_revision: 1,
			preparation_digest: preparation.digest,
			capability: registry.issue(binding, FIXTURE_NOW),
			capability_binding: binding,
			now: FIXTURE_NOW,
		},
		registry,
	);
	return root;
}

/** The breaking revision both Hosts are asked to apply in the drives below. */
function breakingRevisionOf(root: string, taskId: string): Record<string, unknown> {
	const read = readTaskIntent(root, taskId, `docs/plans/${taskId}.intent.json`);
	return {
		...read.intent,
		acceptance: [{ id: "acc-1", assertion: "revised assertion", verification: "bun test" }],
		revision: 2,
	};
}

interface RegisteredCanaryTool {
	execute: (id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<unknown>;
}

/** The Pi Host's registered canary tool, with its test-only failure hook. */
function piCanaryTool(dependencies: { authorizationAfterSidecarStage?: () => Promise<void> }): RegisteredCanaryTool {
	const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
	let tool: RegisteredCanaryTool | undefined;
	const pi = {
		on: () => {},
		registerMessageRenderer: () => {},
		registerCommand: () => undefined,
		registerTool: (registered: { name: string } & RegisteredCanaryTool) => {
			if (registered.name === "imm_kernel_canary") tool = registered;
		},
	} as unknown as ExtensionAPI;
	(mod.default as (pi: ExtensionAPI, dependencies?: unknown) => void)(pi, dependencies);
	if (!tool) throw new Error("imm_kernel_canary tool not registered");
	return tool;
}

function piCanaryCtx(root: string) {
	return {
		mode: "tui",
		cwd: root,
		signal: new AbortController().signal,
		ui: {
			notify: () => {},
			custom: async (factory: any) => {
				let selected: string | undefined;
				const component = factory(
					{ requestRender: () => undefined },
					{ fg: (_color: string, text: string) => text, bold: (text: string) => text },
					{},
					(result: string | undefined) => { selected = result; },
				);
				component.handleInput?.("d");
				component.handleInput?.("\r");
				return selected;
			},
		},
	};
}

test.each(["claude", "pi"] as const)("%s in-place enroll refuses a dirty workspace before its native gate, then commits in this workspace through one confirmation", async (host) => {
	const taskId = `inplace-enroll-${host}`;
	const root = mkdtempSync(join(tmpdir(), "imm-inplace-enroll-"));
	const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
	try {
		mkdirSync(join(root, "docs/plans"), { recursive: true });
		writeFileSync(join(root, ".gitignore"), ".imm/state/\n");
		writeFileSync(join(root, "docs/plans", `${taskId}.intent.json`), `${JSON.stringify({
			contract: "assurance_kernel/task_intent/v1", task_id: taskId, owner: "user", goal: "enroll in place",
			acceptance: [{ id: "acc-1", assertion: "enrolled", verification: "bun test" }],
			scope_hint: [`docs/plans/${taskId}.intent.json`], risk: "routine", revision: 1,
		})}\n`);
		git("init", "-q");
		git("add", "-A");
		git("-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture");

		let gates = 0;
		let enroll: () => Promise<string>;
		if (host === "claude") {
			const mcp = createMcpRuntime({ cwd: root, env: HOST_ENV, interactive: true,
				requestConfirmation: async () => ({ decision: "accept", requestId: `gate-${++gates}` }) });
			mcp.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });
			enroll = () => mcp.callTool("enroll", { task_id: taskId }, { toolCallId: "toolu_enroll" })
				.then(JSON.stringify, (error: Error) => error.message);
		} else {
			const ctx = piCanaryCtx(root);
			const dialog = ctx.ui.custom;
			ctx.ui.custom = async (factory: any) => { gates++; return dialog(factory); };
			Object.assign(ctx, { sessionManager: { getSessionId: () => taskId } });
			require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts")
				.recordPiPhaseInput({ text: "/skill:drive", source: "interactive" }, ctx);
			const tool = piCanaryTool({});
			enroll = () => tool.execute("enroll-call", { task_id: taskId, action: { op: "enroll" } }, undefined, undefined, ctx)
				.then(JSON.stringify, (error: Error) => error.message);
		}

		writeFileSync(join(root, "stray.txt"), "unrelated\n");
		expect(await enroll()).toContain("workspace_not_clean: stray.txt");
		expect(gates).toBe(0);
		expect(readBackendClaim(root)).toBeNull();

		rmSync(join(root, "stray.txt"));
		expect(await enroll()).toContain("enrolled");
		expect(gates).toBe(1);
		expect(readBackendClaim(root)?.task_id).toBe(taskId);
		expect(git("worktree", "list").split("\n")).toHaveLength(1);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("layered config is identical on Claude and Pi status and errors appear as warnings", async () => {
	const taskId = "layered-config-status", root = enrolledHostFixture(taskId);
	try {
		const path = join(root, ".imm/config.json");
		// An invalid batch key is an error diagnostic; its value must never leak.
		writeFileSync(path, JSON.stringify({ contract: "immune_brain/project_config/v2", initiative_carrier: "github", batch: { max_parallel: 3, token_env: "sk-live-123" } }));
		const claude = await new ClaudeRuntime({ cwd: root, env: HOST_ENV }).status(taskId);
		const pi = await piCanaryTool({}).execute("config-status", { task_id: taskId, action: { op: "status" } }, undefined, undefined, piCanaryCtx(root)) as { content: Array<{ text: string }> };
		const piStatus = JSON.parse(pi.content[0]!.text);
		expect(piStatus.config).toEqual(claude.config);
		expect(claude.config?.initiative_carrier).toEqual({ value: "github", source: "project" });
		expect(claude.warnings?.some(w => w.code === "config_invalid")).toBe(true);
		expect(piStatus.warnings.some((w: { code: string }) => w.code === "config_invalid")).toBe(true);
		expect(JSON.stringify([claude, piStatus])).not.toContain("sk-live-123");
	} finally { rmSync(root, { recursive: true, force: true }); }
});

/** The Pi Host's message when a post-stage failure tries to undo the staging. */
async function piBreakingFailure(root: string, taskId: string): Promise<string> {
	const tool = piCanaryTool({
		authorizationAfterSidecarStage: async () => {
			throw new Error("simulated precommit failure");
		},
	});
	return tool
		.execute(
			`${taskId}-breaking`,
			{ task_id: taskId, action: { op: "approve_breaking_intent_revision", next_intent: breakingRevisionOf(root, taskId) } },
			undefined,
			undefined,
			piCanaryCtx(root),
		)
		.then(
			() => "",
			(error: unknown) => (error instanceof Error ? error.message : String(error)),
		);
}

/** What the Pi Host answers when it is asked to authorize on a claim whose
 * projection names no authorization state. */
async function piAuthorizationFailure(root: string, taskId: string): Promise<string> {
	const tool = piCanaryTool({});
	return tool
		.execute(
			`${taskId}-authorize`,
			{ task_id: taskId, action: { op: "request_authorization" } },
			undefined,
			undefined,
			piCanaryCtx(root),
		)
		.then(
			(value: unknown) => JSON.stringify(value),
			(error: unknown) => (error instanceof Error ? error.message : String(error)),
		);
}

/** The Claude Host's message for the same failure, through its own entry point. */
async function claudeBreakingFailure(root: string, taskId: string): Promise<string> {
	const runtime = new ClaudeRuntime({
		cwd: root,
		env: HOST_ENV,
		host: new ClaudeReviewHost(),
		interactive: true,
		permissionMode: "manual",
		requestConfirmation: async () => {
			throw new Error("simulated precommit failure");
		},
	});
	const meta: ToolMeta = {
		taskId,
		sessionId: "s",
		toolCallId: "breaking",
		requiresUserInteraction: true,
		interactive: true,
		permissionMode: "manual",
	};
	return runtime
		.authorize(taskId, "approve_breaking_intent_revision", meta, { next_intent: breakingRevisionOf(root, taskId) })
		.then(
			() => "",
			(error: unknown) => (error instanceof Error ? error.message : String(error)),
		);
}

/** Seed one active run: ownership is derived, so the claim is real state. */
function seedInFlightOwner(
	root: string,
	taskId: string,
	identity: { enrollment_event_id?: string; created_at?: string; updated_at?: string } = {},
): void {
	const intent = {
		contract: "assurance_kernel/task_intent/v1",
		task_id: taskId,
		goal: "in-flight fixture",
		acceptance: [{ id: "A1", assertion: "a1", verification: "bun test tests/x.test.ts" }],
		scope_hint: ["docs/plans"],
		risk: "routine" as const,
		revision: 1,
		owner: "user",
	};
	seedKernelRunForTest(root, {
		task_id: taskId,
		enrollment_event_id: identity.enrollment_event_id,
		created_at: identity.created_at,
		updated_at: identity.updated_at,
		record: {
			contract: "assurance_kernel/task_record/v4",
			task_id: taskId,
			intent_snapshot: intent,
			intent_ref: {
				path: `docs/plans/${taskId}.intent.json`,
				content_hash: canonicalIntentHash(parseTaskIntentV1(intent)),
			},
			lifecycle: "active",
			artifact_state: "active",
			baseline: `sha256:${"a".repeat(64)}`,
			git_base_head: "a".repeat(40),
			attestations: [],
			findings: [],
			history: [],
		},
	});
}

/** Release the workspace: the owner settles and no active run remains. */
function releaseWorkspaceForTest(root: string): void {
	withKernelTransaction(root, (db) => {
		db.prepare("UPDATE workspace SET current_run_id = NULL WHERE id = 1").run();
		db.prepare("DELETE FROM runs WHERE state = 'active'").run();
	});
}

// Every test here drives a real host runtime and temporary Git repositories, so
// the per-test bound must clear bun's 5s default even under the Kernel QA
// minimal environment (which is slower than an interactive session).
// Deterministic QA runs these files in a dependency-free delivery checkout (no
// node_modules), which is roughly 1.5x slower than an interactive session. The three end-to-end integration tests below drive real
// QA and Review through the shared coordinator and already exceed 25s here, so
// 60s leaves no headroom for a slower machine and turns a slow pass into a
// timeout failure.
setDefaultTimeout(120_000);

const TASK = "dual-host-task";
const ROOT = mkdtempSync(join(tmpdir(), "dual-host-assurance-"));
// The shared fixture cwd is a real repository with the project's review profile
// committed, so the CLI dispatcher can read the tree it guards (D5, D6).
mkdirSync(join(ROOT, ".imm"), { recursive: true });
writeFileSync(join(ROOT, ".imm/config.json"), JSON.stringify({
	contract: "immune_brain/project_config/v2",
	agents: { reviewer: "pi" },
}) + "\n");
// A half-created fixture (an aborted run leaves `.git` without a commit) is
// repaired here instead of failing every Review preparation on an unborn HEAD.
const fixtureHasHead = existsSync(join(ROOT, ".git")) && spawnSync("git", ["rev-parse", "--verify", "--quiet", "HEAD"], { cwd: ROOT }).status === 0;
if (!fixtureHasHead) {
	execFileSync("git", ["init", "-q"], { cwd: ROOT });
	writeFileSync(join(ROOT, "tracked.ts"), "export const value = 1;\n");
	execFileSync("git", ["add", "-A"], { cwd: ROOT });
}
try {
	execFileSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.com", "commit", "-qm", "fixture"], { cwd: ROOT, stdio: "ignore" });
} catch { /* already committed */ }

// Reviewer transcripts are local 0600 files under the system temp directory;
// they stand in for the bytes a synchronous `Agent` result points at.
const transcripts = reviewerTranscripts();
afterAll(() => transcripts.cleanup());
const ctx = { cwd: ROOT };

type Risk = "routine" | "material" | "critical";
type Obligation = "submit_assurance" | "run_qa" | "run_review" | "complete" | "none";

function projection(
	state: {
		lifecycle: "active" | "done" | "stopped";
		artifactState: "active" | "frozen";
		nextObligation: Obligation;
		risk: Risk;
		recordRevision?: string;
		contract?: string;
	},
) {
	return {
		error:
			state.contract?.startsWith("assurance_kernel/task_record/v99") ||
			state.contract === "assurance_kernel/task_record/v3"
				? "unsupported TaskRecord contract"
				: null,
		claim: state.lifecycle === "active" ? { task_id: TASK, lifecycle_status: "active" } : { task_id: TASK, lifecycle_status: "terminal" },
		projection: {
			lifecycle: state.lifecycle,
			artifact_state: state.artifactState,
			risk: state.risk,
			next_obligation: state.nextObligation,
			record_revision: state.recordRevision ?? "record-1",
			workspace_revision: "workspace-1",
			intent_revision: 1,
			intent_content_hash: "sha256:intent",
			diff_hash: "sha256:diff",
			fresh_acceptance_ids: ["A1"],
			missing_acceptance_ids: [],
			stale_attestation_ids: [],
			blocking_finding_ids: [],
			unresolved_user_decision_ids: [],
			replan_required_ids: [],
			completion_ready: state.lifecycle !== "active",
			authorization: { state: "blocked" },
		},
	} as never;
}

function snapshot(role: "qa" | "review", risk: Risk = "material"): SnapshotDescriptor {
	return {
		contract: "assurance_kernel/assurance_snapshot/v2",
		task_id: TASK,
		role,
		record_revision: "record-1",
		workspace_revision: "workspace-1",
		intent_revision: 1,
		intent_content_hash: "sha256:intent",
		diff_hash: "sha256:diff",
		lifecycle: "active",
		artifact_state: "frozen",
		risk,
		fresh_acceptance_ids: ["A1"],
		missing_acceptance_ids: [],
		stale_attestation_ids: [],
		acceptance: [{ id: "A1", assertion: "the contract holds", verification: "{}" }],
		dirty_files: ["src/change.ts"],
		...(role === "review" ? { review_revision: { contract: "assurance_kernel/review_revision_identity/v2" as const, base_head: "a".repeat(40), review_commit: "b".repeat(40) } } : {}),
		root: ROOT,
	};
}

function reviewFacts(path = "src/change.ts"): ReviewFacts {
	return {
		revision: { contract: "assurance_kernel/review_revision/v1", base_head: "a".repeat(40), review_tree: "c".repeat(40),
			review_commit: "b".repeat(40), review_ref: `refs/imm/review/${TASK}`, diff_hash: "sha256:diff" },
		changed_paths: [path],
		beyond_estimate: [],
		outside_routine_allowlist: [],
		outcomes: { A1: { status: "passed", summary: "fresh" } },
	} as unknown as ReviewFacts;
}

function passVerdict(s: SnapshotDescriptor): AssuranceVerdict {
	return {
		contract: "assurance_kernel/assurance_verdict/v2",
		role: s.role,
		task_id: TASK,
		snapshot_digest: snapshotDigest(s),
		decision: "pass",
		approval: {
			kind: s.role === "qa" ? "qa" : "review",
			authority_role: s.role === "qa" ? "qa" : "reviewer",
			summary: "passed",
			// A review pass claims the reviewed change set (BR-DEC-3); QA never carries it.
			...(s.role === "review" ? { inspected_paths: [...s.dirty_files] } : {}),
		},
	};
}

function sharedKernel(
	risk: Risk,
	start: Obligation = "run_qa",
	hooks: {
		onQaStart?: () => void;
		onProject?: () => Promise<void>;
		holdQa?: (signal?: AbortSignal) => Promise<void>;
		failQaCommit?: boolean;
	} = {},
) {
	let lifecycle: "active" | "done" | "stopped" = "active";
	let artifactState: "active" | "frozen" = start === "submit_assurance" ? "active" : "frozen";
	let nextObligation: Obligation = start;
	let recordRevision = "record-1";
	let contract: string | undefined;
	let locked = false;
	let holder: object | null = null;
	const applyCounts = { value: 0 };
	const appliedVerdicts: AssuranceVerdict[] = [];
	const executionCounts = { qa: 0, completion: 0 };
	const portsFor = (host: AssuranceCoordinatorPorts["host"]): AssuranceCoordinatorPorts => {
	const token = {};
	return {
		host,
		confirmationReference: ({ actorId }) => `fixture:${actorId}`,
		projectTask: async () => {
			await hooks.onProject?.();
			if (holder && holder !== token) {
				return { error: "concurrent continuation rejected", claim: null, projection: projection({ lifecycle, artifactState, nextObligation, risk, recordRevision, contract }).projection };
			}
			holder = token;
			return projection({ lifecycle, artifactState, nextObligation, risk, recordRevision, contract });
		},
		readTaskRecord: async () => ({ revision: recordRevision, record: { ...(contract ? { contract } : {}), findings: [] } }),
		readTaskIntent: async () => ({ token: "intent-token" }),
		buildAssurance: async (_root, _task, role) => ({
			snapshot: snapshot(role, risk),
			descriptors: new Map([[
				"A1",
				{ contract: "assurance_kernel/verification_descriptor/v2", command: { executable: "bun", argv: ["test"], cwd: ".", timeout_ms: 1000, max_output_bytes: 1024 }, environment: { prepare: null, writable_paths: [] } },
			]] as never),
			reviewFacts: role === "review" ? reviewFacts() : null,
		}),
		ensureReviewRevision: async () => reviewFacts().revision,
		runQa: async (s, _descriptors, options) => {
			executionCounts.qa += 1;
			hooks.onQaStart?.();
			if (hooks.holdQa) await hooks.holdQa(options?.signal);
			return passVerdict(s);
		},
		applyVerdict: async (_ctx, input) => {
			if (locked) throw new Error("concurrent continuation rejected");
			locked = true;
			applyCounts.value += 1;
			appliedVerdicts.push(input.verdict);
			await input.hooks?.beforeCommit?.();
			input.hooks?.onCommit?.();
			if (input.snapshot.role === "qa") nextObligation = risk === "routine" ? "complete" : "run_review";
			else nextObligation = input.verdict.decision === "rework" ? "resolve_findings" : "complete";
			if (input.snapshot.role === "qa" && hooks.failQaCommit) {
				locked = false;
				throw new Error("host reply lost after authority commit");
			}
			await input.hooks?.afterCommit?.();
			locked = false;
		},
		applyOrdinaryOperation: async (_ctx, input) => {
			if (locked) throw new Error("concurrent continuation rejected");
			if (input.operation.op === "freeze_artifacts") {
				artifactState = "frozen";
				nextObligation = "run_qa";
			}
			if (input.operation.op === "complete") {
				executionCounts.completion += 1;
				lifecycle = "done";
				nextObligation = "none";
			}
		},
	};
	};
	return {
		applyCounts,
		executionCounts,
		appliedVerdicts,
		releaseClaim() { holder = null; },
		claude() {
			const host = new ClaudeReviewHost();
			const review = new CliReviewHost(host);
			return { host, review, coordinator: new AssuranceCoordinator(portsFor(review), portsFor(review)) };
		},
		pi() {
			const { host: _ignored, ...rest } = portsFor(new ClaudeReviewHost());
			return createPiRuntimeDriver({ ...rest, authorityOverrides: rest }, ROOT);
		},
		stale() { recordRevision = "stale"; },
		future() { contract = "assurance_kernel/task_record/v99"; },
		v3() { contract = "assurance_kernel/task_record/v3"; },
		done() {
			lifecycle = "done";
			artifactState = "frozen";
			nextObligation = "none";
		},
	};
}

function projectVerificationFixture(taskId: string, mode: "pass" | "prepare-fail" | "sleep" | "v1" | "drift",
	options: { risk?: "routine" | "material"; gitIntegration?: "auto" | "manual" } = {}): string {
	const root = mkdtempSync(join(tmpdir(), "imm-project-verification-"));
	mkdirSync(join(root, ".imm/state"), { recursive: true });
	writeFileSync(join(root, ".imm/config.json"), JSON.stringify({
		contract: "immune_brain/project_config/v2",
		agents: { reviewer: "pi" },
		...(options.gitIntegration ? { git_integration: options.gitIntegration } : {}),
	}) + "\n");
	mkdirSync(join(root, "docs/plans"), { recursive: true });
	mkdirSync(join(root, "tools"), { recursive: true });
	const tool = join(root, "tools/future-pm");
	writeFileSync(tool, `#!/bin/sh
case "$1" in
  prepare) [ "$2" != "fail" ] || { echo "install failed: registry unreachable" >&2; exit 7; }; mkdir -p generated; printf ready > generated/ready ;;
  check) test -f generated/ready ;;
  sleep) sleep 10 ;;
  drift) echo rewritten >> tools/notes.txt ;;
esac
`);
	chmodSync(tool, 0o755);
	writeFileSync(join(root, "tools/notes.txt"), "notes\n");
	const command = (argv: string[]) => ({ executable: "./tools/future-pm", argv, cwd: ".", timeout_ms: 5_000, max_output_bytes: 8_192 });
	const verification = mode === "v1"
		? JSON.stringify({ contract: "assurance_kernel/verification_descriptor/v1", runner_id: "bun", runner_version: "1.4.2", argv: ["test"], cwd: ".", timeout_ms: 5_000, max_output_bytes: 8_192 })
		: JSON.stringify({
			contract: "assurance_kernel/verification_descriptor/v2",
			command: command([mode === "sleep" ? "sleep" : mode === "drift" ? "drift" : "check"]),
			environment: { prepare: command(["prepare", ...(mode === "prepare-fail" ? ["fail"] : [])]), writable_paths: ["generated"] },
		});
	const intent = {
		contract: "assurance_kernel/task_intent/v1", task_id: taskId, owner: "user",
		goal: "exercise project-owned verification through the real host port",
		acceptance: [{ id: "acc-1", assertion: "project command passes", verification }],
		scope_hint: [`docs/plans/${taskId}.intent.json`, "tools/future-pm", "tools/notes.txt"], risk: options.risk ?? "material", revision: 1,
	};
	writeFileSync(join(root, "docs/plans", `${taskId}.intent.json`), `${JSON.stringify(intent, null, 2)}\n`);
	// A tracked user file the routine-settle cases stage and edit as unrelated work.
	if (options.gitIntegration) writeFileSync(join(root, "AGENTS.md"), "# Agent Instructions\n");
	execFileSync("git", ["init", "-q"], { cwd: root });
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-q", "-m", "fixture"], { cwd: root });
	const read = readTaskIntent(root, taskId, `docs/plans/${taskId}.intent.json`);
	seedKernelRunForTest(root, {
		task_id: taskId,
		record: {
			contract: "assurance_kernel/task_record/v4", task_id: taskId,
			intent_snapshot: read.intent,
			intent_ref: { path: `docs/plans/${taskId}.intent.json`, content_hash: read.content_hash },
			lifecycle: "active", artifact_state: "active",
			baseline: `sha256:${"b".repeat(64)}`, git_base_head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
			attestations: [], findings: [], history: [],
		},
	});
	// The task's own work: a Review revision that carries no in-scope change is refused.
	writeFileSync(tool, `${readFileSync(tool, "utf8")}# delivered\n`);
	execFileSync("git", ["add", "--", "tools/future-pm"], { cwd: root });
	return root;
}

function projectVerificationCoordinator(root: string, host: "pi" | "claude") {
	if (host === "pi") {
		const ports = createPiAssuranceProgressionPorts();
		const driver = createPiRuntimeDriver(ports, root);
		return { coordinator: driver.coordinator, ports };
	}
	const ports = new ClaudeRuntime({ cwd: root, env: HOST_ENV, host: new ClaudeReviewHost(), interactive: true }).kernelPorts();
	return {
		coordinator: new AssuranceCoordinator(ports, ports),
		ports,
	};
}

describe("project-owned-verification", () => {
	test.each([
		["pi", "auto"], ["pi", "manual"], ["claude", "auto"], ["claude", "manual"],
	] as const)("%s real routine completion respects Git integration %s and preserves unrelated work", async (host, gitIntegration) => {
		const taskId = `routine-settle-${host}-${gitIntegration}`;
		const root = projectVerificationFixture(taskId, "pass", { risk: "routine", gitIntegration });
		const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
		const driver = host === "pi"
			? createPiRuntimeDriver(createPiAssuranceProgressionPorts(), root).piRuntime
			: new ClaudeRuntime({ cwd: root, env: HOST_ENV, host: new ClaudeReviewHost(), interactive: true });
		try {
			const baseHead = git("rev-parse", "HEAD");
			const staged = `${readFileSync(join(root, "AGENTS.md"), "utf8")}# unrelated staged work\n`;
			writeFileSync(join(root, "AGENTS.md"), staged);
			git("add", "--", "AGENTS.md");
			const unstaged = `${staged}# unrelated unstaged work\n`;
			writeFileSync(join(root, "AGENTS.md"), unstaged);
			writeFileSync(join(root, "unrelated.txt"), "untracked user content\n");
			writeFileSync(join(root, ".git/info/exclude"), "generated/\n");
			// Model unrelated dirt present at enrollment, without claiming the task's delivered change.
			writeEnrollmentBaseline(root, ["tools/future-pm"]);
			const outsideIndex = git("diff", "--cached", "--", "AGENTS.md");
			const outsideWorktree = git("diff", "--", "AGENTS.md");
			const result = await driver.advance(taskId);
			expect(result).toMatchObject({ state: "completed" });
			expect(readSettledTaskEvidence(root, taskId)).toMatchObject({
				record: { lifecycle: "done" }, proof: { terminal_lifecycle: "done" },
			});
			expect(readFileSync(join(root, "generated/ready"), "utf8")).toBe("ready");
			if (gitIntegration === "auto") {
				const commit = git("rev-parse", "HEAD");
				expect(commit).not.toBe(baseHead);
				expect(result).toMatchObject({ settle_commit: { mode: "auto", committed: true, commit, paths: ["tools/future-pm"] } });
				expect(git("rev-parse", "HEAD^")).toBe(baseHead);
				expect(git("diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD")).toBe("tools/future-pm");
				expect(git("diff", "--cached", "--name-only")).toBe("AGENTS.md");
			} else {
				expect(git("rev-parse", "HEAD")).toBe(baseHead);
				expect(result).not.toHaveProperty("settle_commit");
				expect(git("diff", "--cached", "--name-only").split("\n")).toEqual(["AGENTS.md", "tools/future-pm"]);
			}
			expect(git("diff", "--cached", "--", "AGENTS.md")).toBe(outsideIndex);
			expect(git("diff", "--", "AGENTS.md")).toBe(outsideWorktree);
			expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe(unstaged);
			expect(readFileSync(join(root, "unrelated.txt"), "utf8")).toBe("untracked user content\n");
			expect(git("ls-files", "--others", "--exclude-standard", "--", "unrelated.txt")).toBe("unrelated.txt");
		} finally {
			await driver.shutdown();
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("Pi and Claude actual ports execute the same unknown project command and record evidence", async () => {
		for (const host of ["pi", "claude"] as const) {
			const taskId = `project-command-${host}`, root = projectVerificationFixture(taskId, "pass");
			try {
				const driven = projectVerificationCoordinator(root, host);
				const deliveries = () => readdirSync(tmpdir()).filter(name => name.startsWith("imm-delivery")).sort();
				const before = deliveries();
				const result = await driven.coordinator.advance(taskId, { cwd: root } as never);
				expect(result.state).toBe("review_ready");
				// In place: prepare wrote into the working directory and no delivery copy exists.
				expect(readFileSync(join(root, "generated/ready"), "utf8")).toBe("ready");
				expect(deliveries()).toEqual(before);
				const record = await driven.ports.readTaskRecord(root, taskId);
				expect(JSON.stringify(record)).toContain("execution=sha256:");
				await driven.coordinator.onSessionShutdown();
			} finally { rmSync(root, { recursive: true, force: true }); }
		}
	});

	test("Pi and Claude return the paths a check rewrote and store none of them", async () => {
		for (const host of ["pi", "claude"] as const) {
			const taskId = `check-drift-${host}`, root = projectVerificationFixture(taskId, "drift");
			try {
				const driven = projectVerificationCoordinator(root, host);
				const result = await driven.coordinator.advance(taskId, { cwd: root } as never) as any;
				expect(result).toMatchObject({ state: "failed", operation: "qa" });
				expect(result.reason).toContain("protected_input_or_output_drift");
				expect(result.prepare_observation.drift_paths).toEqual(["tools/notes.txt"]);
				expect(JSON.stringify(result.diagnostics ?? [])).not.toContain("drift_paths");
				expect(JSON.stringify(await driven.ports.readTaskRecord(root, taskId))).not.toContain("drift_paths");
				// Nothing under the task's state mentions the returned paths.
				const stored = spawnSync("grep", ["-rl", "drift_paths", ".imm"], { cwd: root, encoding: "utf8" });
				expect({ status: stored.status, files: stored.stdout }).toEqual({ status: 1, files: "" });
				await driven.coordinator.onSessionShutdown();
			} finally { rmSync(root, { recursive: true, force: true }); }
		}
	});

	test("Pi and Claude actual ports preserve preparation and v1 migration failures", async () => {
		const results: unknown[] = [];
		for (const host of ["pi", "claude"] as const) {
			const taskId = `prepare-failure-${host}`, root = projectVerificationFixture(taskId, "prepare-fail");
			try {
				const driven = projectVerificationCoordinator(root, host);
				const result = await driven.coordinator.advance(taskId, { cwd: root } as never);
				const fresh = await driven.ports.projectTask(root, taskId);
				expect(result.recovery).toMatchObject({ category: "environment", task_id: taskId,
					run_id: fresh.projection.run_id, record_revision: fresh.projection.record_revision, next_obligation: "run_qa" });
				expect(result.diagnostics![0]!.elapsed_ms).toBeGreaterThanOrEqual(0);
				results.push(result);
			} finally { rmSync(root, { recursive: true, force: true }); }
		}
		const comparable = (results as Array<any>).map(({ operation_id: _operationId, recovery, diagnostics, ...result }) => ({
			...result, recovery: (({ task_id, run_id, record_revision, ...rest }) => rest)(recovery),
			diagnostics: diagnostics.map(({ elapsed_ms, ...rest }) => rest),
		}));
		expect(comparable[0]).toEqual(comparable[1]);
		expect(comparable[0]).toMatchObject({ state: "failed", operation: "qa" });
		expect(JSON.stringify(comparable[0])).toContain("QA prepare failed");
		// Both Hosts return the same prepare observation, beside the diagnostics.
		expect(comparable[0].prepare_observation).toEqual({
			conditions: { delivery: "working_directory" },
			declared_timeout_ms: 5_000,
			stderr_tail: "install failed: registry unreachable\n",
		});
		expect(JSON.stringify(comparable[0].diagnostics)).not.toContain("registry unreachable");
		for (const host of ["pi", "claude"] as const) {
			const taskId = `v1-migration-${host}`, root = projectVerificationFixture(taskId, "v1");
			try {
				const result = await projectVerificationCoordinator(root, host).coordinator.advance(taskId, { cwd: root } as never);
				expect(result).toMatchObject({ state: "failed", operation: "qa" });
				expect(JSON.stringify(result)).toContain("verification_contract_migration_required");
				expect(result.recovery).toMatchObject({ category: "authorization", task_id: taskId, next_action: expect.stringContaining("native gate") });
			} finally { rmSync(root, { recursive: true, force: true }); }
		}
	});

	test("Pi and Claude actual ports cancel project verification before authority settlement", async () => {
		for (const host of ["pi", "claude"] as const) {
			const taskId = `cancel-command-${host}`, root = projectVerificationFixture(taskId, "sleep");
			try {
				const controller = new AbortController();
				setTimeout(() => controller.abort(), 100);
				const result = await projectVerificationCoordinator(root, host).coordinator.advance(taskId, { cwd: root } as never, controller.signal);
				expect(result.state).toBe("cancelled");
				expect(existsSync(join(root, ".imm/audit", taskId))).toBe(false);
			} finally { rmSync(root, { recursive: true, force: true }); }
		}
	});
});

describe("dual-host assurance conformance", () => {
	test("Claude independently completes routine, material, and critical projections", async () => {
		const routine = sharedKernel("routine");
		const r = routine.claude();
		expect(await r.coordinator.advance(TASK, ctx)).toMatchObject({ state: "completed" });

		const material = sharedKernel("material");
		const m = material.claude();
		const ready = await m.coordinator.advance(TASK, ctx);
		expect(ready.state).toBe("review_ready");
		expect(await settleCli(m.coordinator, ready, passVerdict(snapshot("review", "material")))).toMatchObject({ state: "completed" });

		const critical = sharedKernel("critical");
		const c = critical.claude();
		const critReady = await c.coordinator.advance(TASK, ctx);
		expect(await settleCli(c.coordinator, critReady, passVerdict(snapshot("review", "critical")))).toMatchObject({ state: "completed" });
	});

	test("Pi resumes a Claude-frozen run_review task without handoff state", async () => {
		const kernel = sharedKernel("material");
		const claude = kernel.claude();
		const ready = await claude.coordinator.advance(TASK, ctx);
		expect(ready.state).toBe("review_ready");
		await claude.coordinator.onSessionShutdown();
		kernel.releaseClaim();
		const pi = kernel.pi();
		const resumed = await pi.advance(TASK, ctx as never);
		expect(resumed.state).toBe("review_ready");
		expect(await pi.submitReview(TASK, ctx, passVerdict(snapshot("review")))).toMatchObject({ state: "completed" });
		expect(kernel.executionCounts).toEqual({ qa: 1, completion: 1 });
	});

	test("Claude resumes a Pi run_review task without handoff state", async () => {
		const kernel = sharedKernel("material");
		const pi = kernel.pi();
		const ready = await pi.advance(TASK, ctx as never);
		expect(ready.state).toBe("review_ready");
		await pi.onSessionShutdown();
		kernel.releaseClaim();
		const claude = kernel.claude();
		const resumed = await claude.coordinator.advance(TASK, ctx);
		expect(resumed.state).toBe("review_ready");
		expect(await settleCli(claude.coordinator, resumed as { operation_id: string }, passVerdict(snapshot("review", "material")))).toMatchObject({ state: "completed" });
		expect(kernel.executionCounts).toEqual({ qa: 1, completion: 1 });
	});

	test("Claude resumes a Pi-active submit_assurance task and freezes artifacts cross-host", async () => {
		const kernel = sharedKernel("material", "submit_assurance");
		const pi = kernel.pi();
		await pi.onSessionShutdown(); // Pi disconnects before touching the task
		kernel.releaseClaim();
		const claude = kernel.claude();
		const ready = await claude.coordinator.advance(TASK, ctx); // freezes artifacts, runs QA
		expect(ready.state).toBe("review_ready");
		expect(await settleCli(claude.coordinator, ready as { operation_id: string }, passVerdict(snapshot("review", "material")))).toMatchObject({ state: "completed" });
		expect(kernel.applyCounts.value).toBe(2);
	});

	test("host cancellation during QA leaves frozen run_qa that the other host resumes", async () => {
		let qaStarted!: () => void;
		const started = new Promise<void>((resolve) => { qaStarted = resolve; });
		const kernel = sharedKernel("material", "run_qa", {
			onQaStart: qaStarted,
			holdQa: (signal) => {
				if (!signal || qaHolds-- <= 0) return Promise.resolve();
				return new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
			},
		});
		let qaHolds = 1;
		const claude = kernel.claude();
		const controller = new AbortController();
		const pending = claude.coordinator.advance(TASK, ctx, controller.signal);
		await started;
		controller.abort(new Error("user cancelled"));
		expect(await pending).toMatchObject({ state: "cancelled" });
		expect(kernel.applyCounts.value).toBe(0); // zero QA attestation
		kernel.releaseClaim();
		const pi = kernel.pi();
		const resumed = await pi.advance(TASK, ctx as never);
		expect(resumed.state).toBe("review_ready");
		expect(await pi.submitReview(TASK, ctx, passVerdict(snapshot("review")))).toMatchObject({ state: "completed" });
	});

	test("session disconnect mid-QA aborts in-flight work and the other host resumes", async () => {
		let qaStarted!: () => void;
		const started = new Promise<void>((resolve) => { qaStarted = resolve; });
		const kernel = sharedKernel("material", "run_qa", {
			onQaStart: qaStarted,
			holdQa: (signal) => {
				if (!signal || qaHolds-- <= 0) return Promise.resolve();
				return new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
			},
		});
		let qaHolds = 1;
		const claude = kernel.claude();
		const pending = claude.coordinator.advance(TASK, ctx);
		await started;
		await claude.coordinator.onSessionShutdown(); // disconnect aborts cancellable in-flight work
		expect(await pending).toMatchObject({ state: "cancelled" });
		expect(kernel.applyCounts.value).toBe(0);
		kernel.releaseClaim();
		const pi = kernel.pi();
		const resumed = await pi.advance(TASK, ctx as never);
		expect(resumed.state).toBe("review_ready");
		expect(await pi.submitReview(TASK, ctx, passVerdict(snapshot("review")))).toMatchObject({ state: "completed" });
	});

	test("critical Review completes on the originating host", async () => {
		const kernel = sharedKernel("critical");
		const claude = kernel.claude();
		const ready = await claude.coordinator.advance(TASK, ctx);
		expect(await settleCli(claude.coordinator, ready, passVerdict(snapshot("review", "critical")))).toMatchObject({ state: "completed" });
		expect(kernel.applyCounts.value).toBe(2);
	});

	test("terminal projections reconcile idempotently on both hosts", async () => {
		const kernel = sharedKernel("material");
		kernel.done();
		expect(await kernel.pi().advance(TASK, ctx as never)).toMatchObject({ state: "completed" });
		kernel.releaseClaim();
		expect(await kernel.claude().coordinator.advance(TASK, ctx)).toMatchObject({ state: "completed" });
		expect(kernel.applyCounts.value).toBe(0); // no re-settlement of a terminal task
		expect(kernel.executionCounts).toEqual({ qa: 0, completion: 0 });
	});

	test("postcommit ambiguity reconciles through the Kernel projection across hosts", async () => {
		const kernel = sharedKernel("material", "run_qa", { failQaCommit: true });
		const claude = kernel.claude();
		expect(await claude.coordinator.advance(TASK, ctx)).toMatchObject({ state: "settlement_unknown" });
		expect(kernel.applyCounts.value).toBe(1); // committed exactly once, reply lost
		kernel.releaseClaim();
		const pi = kernel.pi();
		const resumed = await pi.advance(TASK, ctx as never); // reconciles run_review without re-running QA
		expect(resumed.state).toBe("review_ready");
		expect(kernel.applyCounts.value).toBe(1);
		expect(await pi.submitReview(TASK, ctx, passVerdict(snapshot("review")))).toMatchObject({ state: "completed" });
		expect(kernel.executionCounts).toEqual({ qa: 1, completion: 1 });
	});

	for (const host of ["pi", "claude"] as const) {
		test(`${host} recovers an unknown QA commit in the same session without replay`, async () => {
			const kernel = sharedKernel("material", "run_qa", { failQaCommit: true });
			const coordinator = host === "pi" ? kernel.pi() : kernel.claude().coordinator;
			expect((await coordinator.advance(TASK, ctx)).state).toBe("settlement_unknown");
			expect((await coordinator.advance(TASK, ctx)).state).toBe("review_ready");
			expect(kernel.executionCounts.qa).toBe(1);
			expect(kernel.applyCounts.value).toBe(1);
			await coordinator.onSessionShutdown();
		});
	}

	test("v3 identity, vFuture, stale identity, and concurrent continuation all fail closed", async () => {
		const v3 = sharedKernel("routine");
		v3.v3();
		expect(await v3.claude().coordinator.advance(TASK, ctx)).toMatchObject({ state: "blocked" });
		const v3pi = sharedKernel("material");
		v3pi.v3();
		const v3piHost = v3pi.pi();
		expect(await v3piHost.advance(TASK, ctx as never)).toMatchObject({ state: "blocked" });
		const future = sharedKernel("routine");
		future.future();
		expect(await future.claude().coordinator.advance(TASK, ctx)).toMatchObject({ state: "blocked" });

		const stale = sharedKernel("material");
		const first = stale.claude();
		const ready = await first.coordinator.advance(TASK, ctx);
		stale.stale();
		expect(await settleCli(first.coordinator, ready as { operation_id: string }, passVerdict(snapshot("review", "material")))).toMatchObject({ state: "blocked" });

		expect(probeHost({ CLAUDE_CODE_VERSION: "9.0.0" }).ok).toBe(true);
		expect(probeHost({ CLAUDE_CODE_VERSION: "2.0.0" }).ok).toBe(false);
	});

	test("concurrent continuation fails closed", async () => {
		const kernel = sharedKernel("material");
		const a = kernel.claude();
		const b = kernel.claude();
		const results = await Promise.all([a.coordinator.advance(TASK, ctx), b.coordinator.advance(TASK, ctx)]);
		const states = results.map((item) => item.state).sort();
		expect(states).toEqual(["blocked", "review_ready"]);
		expect(kernel.applyCounts.value).toBe(1);
	});

	test("stdin end waits for in-flight tools/call, then shuts down", async () => {
		const input = new PassThrough();
		const output = new PassThrough();
		let shutdowns = 0;
		let release!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const mcp = createMcpRuntime({ env: { CLAUDE_CODE_VERSION: "2.1.236" }, interactive: true });
		mcp.callTool = async () => {
			await gate;
			return { ok: true };
		};
		const originalShutdown = mcp.shutdown.bind(mcp);
		mcp.shutdown = async () => {
			shutdowns += 1;
			return originalShutdown();
		};
		let exited = false;
		const done = serveStdio({ input, output, runtime: mcp, exit: () => { exited = true; } });
		const body = JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name: "status", arguments: { task_id: TASK } },
		});
		input.write(`${body}\n`);
		input.end();
		await Promise.resolve();
		await Promise.resolve();
		expect(shutdowns).toBe(0);
		expect(exited).toBe(false);
		release();
		await done;
		expect(shutdowns).toBe(1);
		expect(exited).toBe(true);
		expect(output.read()?.toString()).toContain("ok");
	});

	// Converged divergences (S11). Each of these fails if either Host regresses to
	// its previous branch: Pi restored without verifying, and Claude re-derived the
	// authorization operation inline.
	describe("converged host divergences", () => {
		test("restores a staged intent through the shared verifying implementation", async () => {
			// The restore is shared, so the verification is one implementation: a git
			// that silently no-ops update-index must fail the restore closed, which is
			// exactly what stopping at update-index used to miss.
			const root = mkdtempSync(join(tmpdir(), "imm-restore-verify-"));
			const shimDir = mkdtempSync(join(tmpdir(), "imm-git-shim-"));
			const previousPath = process.env.PATH;
			try {
				execFileSync("git", ["init", "-q"], { cwd: root });
				execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: root });
				execFileSync("git", ["config", "user.name", "T"], { cwd: root });
				mkdirSync(join(root, "docs/plans"), { recursive: true });
				const sidecar = "docs/plans/restore.intent.json";
				writeFileSync(join(root, sidecar), '{"revision":1}\n');
				execFileSync("git", ["add", sidecar], { cwd: root });
				execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });

				const snapshot = captureStagedIntent(root, sidecar);
				writeFileSync(join(root, sidecar), '{"revision":2}\n');
				execFileSync("git", ["add", sidecar], { cwd: root });

				const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
				writeFileSync(
					join(shimDir, "git"),
					`#!/bin/sh\nif [ "$1" = "update-index" ]; then exit 0; fi\nexec ${realGit} "$@"\n`,
					{ mode: 0o755 },
				);
				process.env.PATH = `${shimDir}:${previousPath}`;
				expect(() => restoreStagedIntent(root, snapshot)).toThrow(
					/failed to restore prior intent git index entry/,
				);

				// Both adapters route through that one implementation rather than keeping
				// their own restore body: each Host is driven through its own entry point
				// with the same lying git and the same post-stage failure while it is still
				// on PATH, and the shared restore failure is what the caller sees.
				for (const host of ["pi", "claude"] as const) {
					const taskId = `${host}-restore`;
					const fixture = enrolledHostFixture(taskId);
					try {
						const message =
							host === "pi"
								? await piBreakingFailure(fixture, taskId)
								: await claudeBreakingFailure(fixture, taskId);
						expect({ host, shared: message.includes("failed to restore prior intent git index entry") }).toEqual({
							host,
							shared: true,
						});
					} finally {
						rmSync(fixture, { recursive: true, force: true });
					}
				}
			} finally {
				process.env.PATH = previousPath;
				rmSync(shimDir, { recursive: true, force: true });
				rmSync(root, { recursive: true, force: true });
			}
		});

		test("allows an in-scope file edit from a plan-entry session on both Hosts (BR-SCN-5)", async () => {
			const taskId = "owner-parity";
			const fixture = enrolledHostFixture(taskId, ["src/mod/a.ts"]);
			const store = mkdtempSync(join(tmpdir(), "imm-owner-parity-"));
			try {
				// Claude Code: the plan entry is recorded by the real UserPromptSubmit hook.
				const locations = { root: store, home: store };
				const base = { session_id: "owner-parity-session", cwd: fixture };
				recordPhaseEntryPrompt({ hook_event_name: "UserPromptSubmit", prompt: "/immune-brain:draw-up revise", ...base }, locations);
				// Every Claude PreToolUse decision that sees a file-edit tool answers "no denial".
				for (const tool_name of ["Edit", "Write", "MultiEdit"]) {
					const payload = { hook_event_name: "PreToolUse", tool_name, tool_input: { file_path: "src/mod/a.ts" }, ...base };
					expect(phaseEntryGateHookOutput(payload, locations)).toBeNull();
				}

				// Pi: the registered input and tool_call handlers over the same claim.
				const handlers = new Map<string, (event: any, ctx: any) => unknown>();
				const piModule = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
				(piModule.default as (pi: ExtensionAPI) => void)({
					on: (name: string, handler: (event: any, ctx: any) => unknown) => { if (!handlers.has(name)) handlers.set(name, handler); },
					registerMessageRenderer: () => {},
					registerCommand: () => undefined,
					registerTool: () => {},
					events: { on() {}, emit() {} },
				} as unknown as ExtensionAPI);
				const ctx = {
					cwd: fixture,
					mode: "tui",
					hasUI: true,
					isIdle: () => true,
					sessionManager: { getSessionId: () => "owner-parity-pi" },
					ui: { setWidget() {}, setStatus() {}, notify() {}, custom: async () => undefined },
				};
				await handlers.get("input")!({ type: "input", text: "/skill:draw-up revise", source: "interactive" }, ctx);
				for (const toolName of ["edit", "write"]) {
					const piDecision = (await handlers.get("tool_call")!({ toolName, input: { path: "src/mod/a.ts" } }, ctx)) as
						| { block?: boolean }
						| undefined;
					expect(piDecision?.block).toBeUndefined();
				}
			} finally {
				rmSync(fixture, { recursive: true, force: true });
				rmSync(store, { recursive: true, force: true });
			}
		});

		test("derives the authorization operation from the shared export on both Hosts", async () => {
			// The Pi Host's registered surface carries the shared derivation itself, so
			// the function the tool runs is the same object the Claude adapter imports.
			const piSurface = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts") as {
				deriveAuthorizationOperation: unknown;
			};
			expect(piSurface.deriveAuthorizationOperation).toBe(deriveAuthorizationOperation);
			// One derivation over Kernel readiness, identical for both Hosts.
			expect(deriveAuthorizationOperation({ readiness: { state: "resolve_user_decision", blocked: null } })).toEqual({
				operation: "resolve-user-decision",
			});
			expect(deriveAuthorizationOperation({ readiness: { state: "authorize_rework", blocked: null } })).toEqual({
				operation: "authorize-rework",
			});
			expect(deriveAuthorizationOperation({ readiness: { state: "none", blocked: "claim is draining" } })).toEqual({
				blocked: "claim is draining",
			});
			expect(deriveAuthorizationOperation({ readiness: { state: "none", blocked: null } })).toEqual({
				blocked: "no unique host-derived authorization operation",
			});
			// A Host that maps Kernel readiness inline is the drift this forbids, so the
			// Claude entry point is driven against a real claim: whatever its Kernel
			// projection reports, the authorization call answers with the shared result.
			const taskId = "authorization-derivation";
			const root = enrolledHostFixture(taskId);
			try {
				const runtime = new ClaudeRuntime({
					cwd: root,
					env: HOST_ENV,
					host: new ClaudeReviewHost(),
					interactive: true,
					permissionMode: "manual",
					requestConfirmation: async () => ({ decision: "accept", requestId: "r-derive" }),
				});
				const projection = await runtime.status(taskId);
				const derived = deriveAuthorizationOperation({ readiness: projection.projection.authorization });
				const meta: ToolMeta = {
					taskId,
					sessionId: "s",
					toolCallId: "derive",
					requiresUserInteraction: true,
					interactive: true,
					permissionMode: "manual",
				};
				const claudeOutcome = await runtime.authorize(taskId, "request_authorization", meta).then(
					() => null,
					(error: unknown) => (error instanceof Error ? error.message : String(error)),
				);
				// Both Hosts are driven through their own authorization entry point, and
				// each answers with the shared derivation rather than an inline mapping of
				// its own.
				const piOutcome = await piAuthorizationFailure(root, taskId);
				expect({
					derived,
					pi: piOutcome.includes("no unique host-derived authorization operation"),
					claude: claudeOutcome,
				}).toEqual({
					derived: { blocked: "no unique host-derived authorization operation" },
					pi: true,
					claude: "no unique host-derived authorization operation",
				});
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});
	});

	// ADR 0019: the phase entry gate has one refusal contract. Each Host is driven
	// at its real tool boundary in a session that never entered drive.
	test("both Hosts refuse Enrollment without a run entry with one code and one recovery action", async () => {
		const root = mkdtempSync(join(tmpdir(), "imm-phase-entry-conformance-"));
		try {
			let claudeGates = 0;
			const mcp = createMcpRuntimeUngated({
				cwd: root, env: HOST_ENV,
				requestConfirmation: async () => { claudeGates++; return { decision: "decline" as const, requestId: "never" }; },
				consumePhaseAdmission: (toolCallId: string, operation: GatedTool) => consumePhaseAdmission(toolCallId, operation, root),
			});
			await handleJsonRpc({
				jsonrpc: "2.0", id: 1, method: "initialize",
				params: { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code", version: "2.1.236" }, capabilities: { elicitation: {} } },
			}, mcp);
			const claude = async (name: GatedTool, args: Record<string, unknown>) => {
				const reply = await handleJsonRpc({
					jsonrpc: "2.0", id: 2, method: "tools/call",
					params: { name, arguments: args, _meta: { "claudecode/toolUseId": `toolu_${name}` } },
				}, mcp);
				expect(reply?.result).toBeUndefined();
				return reply?.error?.data as { reason_code: string; recovery_action: string };
			};

			let piDialogs = 0;
			const ctx = { ...piCanaryCtx(root), sessionManager: { getSessionId: () => "conformance-session-without-entry" },
				ui: { setWidget() {}, setStatus() {}, notify() {}, custom: async () => { piDialogs++; return "decline"; } } };
			const piRefusal = async (taskId: string) => {
				try {
					await piCanaryTool({}).execute("call-1", { task_id: taskId, action: { op: "enroll" } }, undefined, undefined, ctx);
				} catch (error) {
					const failure = JSON.parse((error as Error).message) as { state: string; code: string; next_action: string };
					expect(failure.state).toBe("blocked");
					return { reason_code: failure.code, recovery_action: failure.next_action };
				}
				throw new Error("enroll was not refused");
			};

			const expected = { reason_code: RUN_ENTRY_REQUIRED, recovery_action: PHASE_ENTRY_RECOVERY[RUN_ENTRY_REQUIRED] };
			const refusals = [
				await claude("enroll", { task_id: "conformance-task" }),
				await piRefusal("conformance-task"),
			];
			for (const refusal of refusals) expect(refusal).toEqual(expected);
			expect(claudeGates).toBe(0);
			expect(piDialogs).toBe(0);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	// S12 ACT-3: the literal-user identity is one value for both Hosts. The
	// retired extension stub's mirrored copy is gone; both host adapters now
	// import the single kernel constant, so drift is structurally impossible.
	test("records one literal-user identity across both Hosts", () => {
		// The Hosts' two spellings are one identity; the recorded value is canonical.
		expect(canonicalActorId("user")).toBe(LITERAL_USER_ACTOR_ID);
		expect(canonicalActorId(LITERAL_USER_ACTOR_ID)).toBe(LITERAL_USER_ACTOR_ID);
		// A non literal-user actor is never absorbed into the literal user.
		for (const actor of ["executor", "deterministic-qa", "parent-mediated-review", "reviewer"]) {
			expect({ actor, canonical: canonicalActorId(actor) }).toEqual({ actor, canonical: actor });
			expect({ actor, literalUser: isLiteralUserActor(actor) }).toEqual({ actor, literalUser: false });
		}
		// Both adapters mint the canonical spelling rather than a second one: the
		// Enrollment binding mints it once in the shared HostRuntime both adapters
		// call through, and neither adapter spells it itself.
		const sharedRuntime = readFileSync(
			resolve("plugins/immune-brain/runtime/host-core/runtime.ts"),
			"utf8",
		);
		expect(sharedRuntime.includes("actor_id: LITERAL_USER_ACTOR_ID")).toBe(true);
		for (const path of [
			"plugins/immune-brain/.pi-extension/pi-host-runtime.ts",
			"plugins/immune-brain/.pi-extension/imm-canary-work.ts",
			"plugins/immune-brain/runtime/claude/kernel_ports.ts",
			"plugins/immune-brain/runtime/antigravity/kernel_ports.ts",
			"plugins/immune-brain/runtime/host-core/runtime.ts",
		]) {
			const source = readFileSync(resolve(path), "utf8");
			expect({ path, hardcoded: /actor_id:\s*"user"/.test(source) }).toEqual({ path, hardcoded: false });
		}
	});

	// S13 GHP-3: the post-settlement tracker projection reports beside the
	// authoritative result. A tracker failure never becomes evidence, a blocker,
	// or a reason to repeat the settling Kernel mutation.
	test("pays for the terminal tracker projection only after a settling call", async () => {
		const root = mkdtempSync(join(tmpdir(), "imm-terminal-tracker-gate-"));
		try {
			execFileSync("git", ["init", "-q"], { cwd: root });
			const runtime = new ClaudeRuntime({
				cwd: root,
				env: HOST_ENV,
				host: new ClaudeReviewHost(),
				interactive: true,
				permissionMode: "manual",
				requestConfirmation: async () => ({ decision: "accept", requestId: "r-tracker-gate" }),
			});
			const reads: string[] = [];
			const status = runtime.runtime.status.bind(runtime.runtime);
			runtime.runtime.status = async (taskId: string) => {
				reads.push(taskId);
				return status(taskId);
			};
			// A call that settles nothing cannot have produced the claimless terminal
			// projection the tracker step needs, so it must not read the Kernel for it
			// and must return the same result it would have returned before.
			const blocked = await runtime.submitReview("tracker-gate-task", { nonsense: true });
			expect({ state: blocked.state, reads: [...reads], tracker: "tracker" in blocked }).toEqual({
				state: "blocked",
				reads: [],
				tracker: false,
			});
			// The gate admits exactly the shapes a settling call produces: the
			// coordinator's terminal outcomes and a committed terminal lifecycle.
			expect([
				settledKernelResult({ state: "completed" }),
				settledKernelResult({ state: "stopped" }),
				settledKernelResult({ record: { lifecycle: "done" } }),
				settledKernelResult({ record: { lifecycle: "stopped" } }),
			]).toEqual([true, true, true, true]);
			expect([
				settledKernelResult({ state: "review_ready" }),
				settledKernelResult({ state: "rework" }),
				settledKernelResult({ state: "blocked" }),
				settledKernelResult({ state: "cancelled" }),
				settledKernelResult({ record: { lifecycle: "active" } }),
			]).toEqual([false, false, false, false, false]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("reports a tracker failure beside settlement without touching Kernel state", async () => {
		const root = mkdtempSync(join(tmpdir(), "imm-terminal-tracker-"));
		try {
			execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
			mkdirSync(join(root, ".imm", "state"), { recursive: true });
			const settled = {
				claim: null,
				projection: { lifecycle: "done" },
			} as never;
			const tombstone = {
				task_id: "terminal-tracker-task",
				lifecycle_status: "terminal",
				terminal_lifecycle: "done",
				terminal_event_id: "evt-terminal-tracker",
			} as never;
			const stateBefore = readdirSync(join(root, ".imm", "state")).sort();

			const tracker = await projectTerminalTrackerState({
				root,
				task_id: "terminal-tracker-task",
				projection: settled,
				tombstone,
				markTerminal: async () => {
					throw new Error("gh transport unavailable");
				},
			});
			// Reported, not thrown: the settlement result stays authoritative.
			expect(tracker).toMatchObject({
				operation: "mark-terminal",
				status: "retryable_failure",
				association_found: false,
			});
			// Nothing was written, replayed, or reconciled: zero Kernel writes.
			expect(readdirSync(join(root, ".imm", "state")).sort()).toEqual(stateBefore);
			expect(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim()).toBe("");

			// A non-settled projection projects nothing at all, so the step cannot
			// become a blocker for a task that is still active.
			let calls = 0;
			const absent = await projectTerminalTrackerState({
				root,
				task_id: "terminal-tracker-task",
				projection: { claim: { task_id: "terminal-tracker-task" }, projection: { lifecycle: "active" } } as never,
				tombstone,
				markTerminal: async () => {
					calls += 1;
					throw new Error("must not be called");
				},
			});
			expect(absent).toBeUndefined();
			expect(calls).toBe(0);

			// Both Hosts settle through the one shared step in HostRuntime.
			expect({
				path: "plugins/immune-brain/runtime/host-core/runtime.ts",
				shared: readFileSync(resolve("plugins/immune-brain/runtime/host-core/runtime.ts"), "utf8").includes("projectTerminalTrackerState"),
			}).toEqual({
				path: "plugins/immune-brain/runtime/host-core/runtime.ts",
				shared: true,
			});
			for (const path of [
				"plugins/immune-brain/runtime/claude/kernel_ports.ts",
				"plugins/immune-brain/.pi-extension/pi-host-runtime.ts",
			]) {
				const source = readFileSync(resolve(path), "utf8");
				expect({ path, delegates: source.includes("this.runtime.advance") && source.includes("this.runtime.submitReview") }).toEqual({
					path,
					delegates: true,
				});
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

// Spec host-owned-environment D9 / SCN-6: a status read is not a freeze. With
// an unstaged file inside the scope of an active task, both Hosts return the
// task projection plus one warning naming the path, and both still refuse to
// advance assurance on the same state.
describe("status stays readable with unstaged scope paths on both Hosts", () => {
	test("status returns the projection and a warning; advance_assurance still refuses", async () => {
		const taskId = "status-unstaged-scope";
		const claudeRoot = enrolledHostFixture(taskId, ["src/impl.ts"]);
		const piRoot = enrolledHostFixture(taskId, ["src/impl.ts"]);
		try {
			for (const root of [claudeRoot, piRoot]) writeFileSync(join(root, "src/impl.ts"), "export const impl = 2; // unstaged\n");
			const warning = {
				code: "unstaged_scope_paths",
				paths: ["src/impl.ts"],
				message: "task scope contains unstaged or untracked changes: src/impl.ts; advance_assurance refuses until they are staged or removed",
			};

			const claude = createMcpRuntime({ cwd: claudeRoot, env: HOST_ENV });
			const claudeStatus = await claude.callTool("status", { task_id: taskId }, { toolCallId: "toolu-status" }) as Record<string, any>;
			const pi = piCanaryTool({});
			const piStatus = (await pi.execute("status", { task_id: taskId, action: { op: "status" } }, undefined, undefined, piCanaryCtx(piRoot)) as { details: Record<string, any> }).details;

			expect(claudeStatus.error).toBeNull();
			expect(claudeStatus.warnings).toEqual([warning]);
			expect(claudeStatus.projection).toMatchObject({ lifecycle: "active", artifact_state: "active", next_obligation: "submit_assurance" });
			expect(piStatus.state).toBe("status");
			expect(piStatus.warnings).toEqual([warning]);
			expect(piStatus.task_state).toMatchObject({ lifecycle: "active", artifact_state: "active", next_obligation: "submit_assurance" });
			expect(piStatus.result).toContain(warning.message);
			// Both report the resolved Git integration preference (ADR 0024); the fixture declares none.
			expect(claudeStatus.git_integration).toEqual({ mode: "manual", source: null });
			expect(piStatus.git_integration).toEqual({ mode: "manual", source: null });

			const refused = /task scope contains unstaged or untracked changes: src\/impl\.ts/;
			// The MCP wire needs a negotiated Host version for a mutation, so the
			// Claude advance is driven through the runtime the Tool dispatches to.
			const claudeRuntime = new ClaudeRuntime({
				cwd: claudeRoot,
				env: HOST_ENV,
				host: new ClaudeReviewHost(),
				interactive: true,
				permissionMode: "manual",
				requestConfirmation: async () => ({ decision: "accept", requestId: "r-status" }),
			});
			const claudeAdvance = await claudeRuntime.advance(taskId).then(
				(value: unknown) => JSON.stringify(value),
				(error: unknown) => (error instanceof Error ? error.message : String(error)),
			);
			const piAdvance = await pi.execute("advance", { task_id: taskId, action: { op: "advance_assurance" } }, undefined, undefined, piCanaryCtx(piRoot)).then(
				(value: unknown) => JSON.stringify(value),
				(error: unknown) => (error instanceof Error ? error.message : String(error)),
			);
			expect(claudeAdvance).toMatch(refused);
			expect(piAdvance).toMatch(refused);
		} finally {
			rmSync(claudeRoot, { recursive: true, force: true });
			rmSync(piRoot, { recursive: true, force: true });
		}
	});
});

/**
 * S2 AC2: the CLI switch is read at each composition root. The Host wiring is
 * real — Pi's `PiRuntime`, `ClaudeRuntime` and `AntigravityRuntime` —
 * and only the Kernel ports are the same synthetic fixtures the conformance
 * drives above, because the reservation shape is what the switch changes.
 */
const { AntigravityRuntime } = await import("../plugins/immune-brain/runtime/antigravity/kernel_ports.ts");

function cliReviewRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "imm-cli-dispatch-root-"));
	execFileSync("git", ["init", "-q"], { cwd: root });
	execFileSync("git", ["config", "user.name", "test"], { cwd: root });
	execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
	mkdirSync(join(root, ".imm"), { recursive: true });
	writeFileSync(join(root, ".imm/config.json"), JSON.stringify({ contract: "immune_brain/project_config/v2", agents: { reviewer: "pi" } }) + "\n");
	writeFileSync(join(root, "src.ts"), "export const value = 1;\n");
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
	return root;
}

function cliReviewPorts(root: string): { ports: AssuranceCoordinatorPorts; applied: string[] } {
	let obligation: "run_qa" | "run_review" = "run_qa";
	const applied: string[] = [];
	const snapshotFor = (role: "qa" | "review"): SnapshotDescriptor => ({
		...snapshot(role, "material"), dirty_files: ["src.ts"], root,
	} as SnapshotDescriptor);
	const ports: AssuranceCoordinatorPorts = {
		host: { host: "pi", prepareReview: () => { throw new Error("the composition root owns the Host"); }, releaseReview: () => undefined },
		reviewVerifierMode: () => "off",
		confirmationReference: ({ actorId }) => `fixture:${actorId}`,
		projectTask: async () => projection({ lifecycle: "active", artifactState: "frozen", nextObligation: obligation, risk: "material" }),
		readTaskRecord: async () => ({ revision: "record-1", record: { findings: [], history: [] } }),
		readTaskIntent: async () => ({ token: "intent-token" }),
		buildAssurance: async (_root: string, _task: string, role: "qa" | "review") => ({
			snapshot: snapshotFor(role),
			descriptors: new Map([["A1", {
				contract: "assurance_kernel/verification_descriptor/v2",
				command: { executable: "bun", argv: ["test"], cwd: ".", timeout_ms: 1000, max_output_bytes: 1024 },
				environment: { prepare: null, writable_paths: [] },
			}]] as never),
			reviewFacts: role === "review" ? reviewFacts("src.ts") : null,
		}),
		ensureReviewRevision: async () => reviewFacts("src.ts").revision,
		runQa: async (s: SnapshotDescriptor) => passVerdict(s),
		applyVerdict: async (_ctx: HostContext, input: { snapshot: { role: string } }) => {
			applied.push(input.snapshot.role);
			if (input.snapshot.role === "qa") obligation = "run_review";
		},
		applyOrdinaryOperation: async () => undefined,
	} as unknown as AssuranceCoordinatorPorts;
	return { ports, applied };
}

// Spec docs/specs/tri-host-capability-alignment.spec.md S2 AC1 (D3; BR-REQ-2):
// shared private helpers accept an owned 0700 directory and regular owned 0600
// files and reject planted symlinks, foreign-owned files, non-regular files and
// wrong-mode files without ordinary-read fallback.
describe("shared private file helpers (D3; S2 AC1)", () => {
	function scratchRoot(): string {
		return mkdtempSync(join(tmpdir(), "shared-private-file-"));
	}

	test("ensurePrivateDir: creates owned 0700 directory and accepts existing", () => {
		const root = scratchRoot();
		try {
			const target = join(root, "sub-dir");
			expect(ensurePrivateDir(target)).toBe(true);
			const stat = lstatSync(target);
			expect(stat.isDirectory()).toBe(true);
			expect((stat.mode & 0o777)).toBe(0o700);
			expect(ownedByUs(stat)).toBe(true);
			// Idempotent: accepts existing
			expect(ensurePrivateDir(target)).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("ensurePrivateDir: rejects directory with wrong mode (0755, 0777)", () => {
		const root = scratchRoot();
		try {
			const target = join(root, "mode-dir");
			mkdirSync(target, 0o755);
			chmodSync(target, 0o755);
			expect(ensurePrivateDir(target)).toBe(false);
			chmodSync(target, 0o777);
			expect(ensurePrivateDir(target)).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("ensurePrivateDir: rejects planted symlink directory", () => {
		const root = scratchRoot();
		const outside = scratchRoot();
		try {
			chmodSync(outside, 0o700);
			const link = join(root, "sym-dir");
			symlinkSync(outside, link);
			expect(ensurePrivateDir(link)).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
			rmSync(outside, { recursive: true, force: true });
		}
	});

	test("ensurePrivateDir: rejects foreign-owned directory", () => {
		const root = scratchRoot();
		try {
			const target = join(root, "foreign-dir");
			mkdirSync(target, 0o700);
			chmodSync(target, 0o700);
			const spy = spyOn(process, "getuid").mockReturnValue((process.getuid?.() ?? 0) + 9999);
			try {
				expect(ensurePrivateDir(target)).toBe(false);
			} finally {
				spy.mockRestore();
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("ensurePrivateDir: rejects a regular file at the directory path", () => {
		const root = scratchRoot();
		try {
			const target = join(root, "file-not-dir");
			writeFileSync(target, "not a dir", { mode: 0o700 });
			chmodSync(target, 0o700);
			expect(ensurePrivateDir(target)).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("writePrivate: positive round-trip and overwrite with readPrivate", () => {
		const root = scratchRoot();
		try {
			const dir = join(root, "cache");
			const file = join(dir, "grant.json");
			expect(writePrivate(file, dir, JSON.stringify({ grant: "first", n: 1 }))).toBe(true);
			const stat = lstatSync(file);
			expect(stat.isFile()).toBe(true);
			expect((stat.mode & 0o777)).toBe(0o600);
			expect(readPrivate(file)).toBe(JSON.stringify({ grant: "first", n: 1 }));

			// Overwriting existing owned 0600 file succeeds
			expect(writePrivate(file, dir, JSON.stringify({ grant: "second" }))).toBe(true);
			expect(readPrivate(file)).toBe(JSON.stringify({ grant: "second" }));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("writePrivate: rejects writing when directory fails ensurePrivateDir", () => {
		const root = scratchRoot();
		try {
			const dir = join(root, "bad-dir");
			mkdirSync(dir, 0o755);
			chmodSync(dir, 0o755);
			const file = join(dir, "grant.json");
			expect(writePrivate(file, dir, "content")).toBe(false);
			expect(existsSync(file)).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("writePrivate: rejects planted symlink file and preserves target", () => {
		const root = scratchRoot();
		try {
			const dir = join(root, "cache");
			ensurePrivateDir(dir);
			const outsideTarget = join(root, "innocent.txt");
			writeFileSync(outsideTarget, "original-content", { mode: 0o600 });
			const link = join(dir, "sym-grant.json");
			symlinkSync(outsideTarget, link);

			expect(writePrivate(link, dir, "malicious-write")).toBe(false);
			// Target must be completely untouched
			expect(readFileSync(outsideTarget, "utf8")).toBe("original-content");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("writePrivate: rejects file with wrong mode (0644, 0666, 0700) and preserves content", () => {
		const root = scratchRoot();
		try {
			const dir = join(root, "cache");
			ensurePrivateDir(dir);
			for (const mode of [0o644, 0o666, 0o700]) {
				const file = join(dir, `mode-${mode.toString(8)}.json`);
				writeFileSync(file, "initial-bytes");
				chmodSync(file, mode);
				expect(writePrivate(file, dir, "overwritten")).toBe(false);
				expect(readFileSync(file, "utf8")).toBe("initial-bytes");
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("writePrivate: rejects foreign-owned file", () => {
		const root = scratchRoot();
		try {
			const dir = join(root, "cache");
			ensurePrivateDir(dir);
			const file = join(dir, "foreign.json");
			expect(writePrivate(file, dir, "first")).toBe(true);

			const spy = spyOn(process, "getuid").mockReturnValue((process.getuid?.() ?? 0) + 9999);
			try {
				expect(writePrivate(file, dir, "foreign-update")).toBe(false);
			} finally {
				spy.mockRestore();
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("writePrivate: rejects non-regular file (directory and FIFO)", () => {
		const root = scratchRoot();
		try {
			const dir = join(root, "cache");
			ensurePrivateDir(dir);
			// Subdirectory at the file path
			const subDir = join(dir, "file-is-dir");
			mkdirSync(subDir, 0o700);
			chmodSync(subDir, 0o700);
			expect(writePrivate(subDir, dir, "data")).toBe(false);

			// FIFO
			const fifo = join(dir, "file.fifo");
			try {
				execFileSync("mkfifo", [fifo]);
				chmodSync(fifo, 0o600);
				expect(writePrivate(fifo, dir, "data")).toBe(false);
			} catch {}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("appendPrivate: positive round-trip and negative attacks", () => {
		const root = scratchRoot();
		try {
			const dir = join(root, "cache");
			const file = join(dir, "log.jsonl");
			expect(appendPrivate(file, dir, "line1\n")).toBe(true);
			expect(appendPrivate(file, dir, "line2\n")).toBe(true);
			expect(readPrivate(file)).toBe("line1\nline2\n");

			// Rejects planted symlink
			const target = join(root, "target.txt");
			writeFileSync(target, "safe", { mode: 0o600 });
			const link = join(dir, "sym-log.jsonl");
			symlinkSync(target, link);
			expect(appendPrivate(link, dir, "attack\n")).toBe(false);
			expect(readFileSync(target, "utf8")).toBe("safe");

			// Rejects wrong mode
			const wrongMode = join(dir, "wrong-mode.jsonl");
			writeFileSync(wrongMode, "existing\n");
			chmodSync(wrongMode, 0o644);
			expect(appendPrivate(wrongMode, dir, "extra\n")).toBe(false);
			expect(readFileSync(wrongMode, "utf8")).toBe("existing\n");

			// Rejects foreign-owned
			const spy = spyOn(process, "getuid").mockReturnValue((process.getuid?.() ?? 0) + 9999);
			try {
				expect(appendPrivate(file, dir, "foreign\n")).toBe(false);
			} finally {
				spy.mockRestore();
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("readPrivate: positive and rejects attacks without fallback ordinary read", () => {
		const root = scratchRoot();
		try {
			const dir = join(root, "cache");
			ensurePrivateDir(dir);
			const file = join(dir, "good.txt");
			writeFileSync(file, "hello-world", { mode: 0o600 });
			chmodSync(file, 0o600);
			expect(readPrivate(file)).toBe("hello-world");

			// Returns undefined on nonexistent file
			expect(readPrivate(join(dir, "absent.txt"))).toBeUndefined();

			// Rejects planted symlink (never falls back to ordinary readFileSync)
			const outside = join(root, "outside.txt");
			writeFileSync(outside, "secret-data");
			const link = join(dir, "planted-link.txt");
			symlinkSync(outside, link);
			expect(readPrivate(link)).toBeUndefined();

			// Rejects wrong mode files
			for (const mode of [0o644, 0o666, 0o700, 0o777]) {
				const wrongFile = join(dir, `mode-${mode.toString(8)}.txt`);
				writeFileSync(wrongFile, "secret", { mode });
				chmodSync(wrongFile, mode);
				expect(readPrivate(wrongFile)).toBeUndefined();
			}

			// Rejects foreign-owned file
			const spy = spyOn(process, "getuid").mockReturnValue((process.getuid?.() ?? 0) + 9999);
			try {
				expect(readPrivate(file)).toBeUndefined();
			} finally {
				spy.mockRestore();
			}

			// Rejects maxBytes overflow
			expect(readPrivate(file, 5)).toBeUndefined();

			// Rejects non-regular file (directory)
			const subDir = join(dir, "subdir");
			mkdirSync(subDir, 0o700);
			expect(readPrivate(subDir)).toBeUndefined();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("dropPrivate: removes owned regular file but preserves symlinks and directories", () => {
		const root = scratchRoot();
		try {
			const file = join(root, "remove-me.txt");
			writeFileSync(file, "temp", { mode: 0o600 });
			chmodSync(file, 0o600);
			dropPrivate(file);
			expect(existsSync(file)).toBe(false);

			// Planted symlink is preserved, target is preserved
			const target = join(root, "target-keep.txt");
			writeFileSync(target, "keep");
			const link = join(root, "sym-link.txt");
			symlinkSync(target, link);
			dropPrivate(link);
			expect(existsSync(link)).toBe(true);
			expect(existsSync(target)).toBe(true);

			// Directory is preserved
			const subDir = join(root, "keep-dir");
			mkdirSync(subDir, 0o700);
			dropPrivate(subDir);
			expect(existsSync(subDir)).toBe(true);

			// Foreign-owned file is preserved
			const foreignFile = join(root, "foreign-keep.txt");
			writeFileSync(foreignFile, "foreign", { mode: 0o600 });
			chmodSync(foreignFile, 0o600);
			const spy = spyOn(process, "getuid").mockReturnValue((process.getuid?.() ?? 0) + 9999);
			try {
				dropPrivate(foreignFile);
			} finally {
				spy.mockRestore();
			}
			expect(existsSync(foreignFile)).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

// Spec docs/specs/host-neutral-adapter-core.spec.md S1 AC3 (D3): one event log
// implementation, constructed by each adapter over its own cache directory.
describe("shared hook event log", () => {
	interface LogEvent {
		type: "SubagentStart" | "PostToolUse";
		sessionId: string;
		agent?: string;
		agentId: string;
		toolName?: string;
		result?: string;
	}

	/** The two Host vocabularies both carry these variants, so one fixture drives both. */
	const HOSTS: Array<{ host: string; cacheName: string; make: (root: string) => HookEventLog<LogEvent> }> = [
		{ host: "claude-code", cacheName: "immune-brain-claude", make: (root) => claudeHookEventLog(root) as unknown as HookEventLog<LogEvent> },
		{ host: "antigravity", cacheName: "immune-brain-antigravity", make: (root) => antigravityHookEventLog(root) as unknown as HookEventLog<LogEvent> },
	];

	const start = (sessionId: string, agentId: string): LogEvent => ({ type: "SubagentStart", sessionId, agentId, agent: "immune-brain-review-verifier" });
	const result = (sessionId: string, agentId: string, text: string): LogEvent => ({ type: "PostToolUse", sessionId, agentId, toolName: "invoke_subagent", result: text });

	function scratchRoot(): string {
		return mkdtempSync(join(tmpdir(), "shared-hook-log-"));
	}

	for (const { host, cacheName, make } of HOSTS) {
		test(`${host}: events list per session in append order under its own cache directory`, () => {
			const root = scratchRoot();
			try {
				const log = make(root);
				expect(log.append(start("s1", "a1"))).toBe(true);
				expect(log.append(result("s1", "a1", "first"))).toBe(true);
				expect(log.append(start("s2", "a2"))).toBe(true);
				expect(log.list("s1").map((event) => event.agentId)).toEqual(["a1", "a1"]);
				expect(log.list("s2").map((event) => event.agentId)).toEqual(["a2"]);
				expect(log.sessions().sort()).toEqual(["s1", "s2"]); // order across sessions is unspecified (directory order)
				expect(existsSync(join(root, cacheName))).toBe(true);
				expect(readdirSync(root)).toEqual([cacheName]);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});

		test(`${host}: clear removes only the named session`, () => {
			const root = scratchRoot();
			try {
				const log = make(root);
				log.append(start("s1", "a1"));
				log.append(result("s1", "a1", "first"));
				log.append(start("s2", "a2"));
				log.clear("s1");
				expect(log.list("s1")).toEqual([]);
				expect(log.list("s2").map((event) => event.agentId)).toEqual(["a2"]);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});

		test(`${host}: append refuses a cache directory that is a symlink to another directory`, () => {
			const root = scratchRoot();
			const outside = mkdtempSync(join(tmpdir(), "shared-hook-log-outside-"));
			try {
				symlinkSync(outside, join(root, cacheName));
				const log = make(root);
				expect(log.append(start("s1", "a1"))).toBe(false);
				expect(readdirSync(outside)).toEqual([]);
				expect(log.list("s1")).toEqual([]);
			} finally {
				rmSync(root, { recursive: true, force: true });
				rmSync(outside, { recursive: true, force: true });
			}
		});

		test(`${host}: a session file with a non-private mode lists no events`, () => {
			const root = scratchRoot();
			try {
				const log = make(root);
				expect(log.append(start("s1", "a1"))).toBe(true);
				const dir = join(root, cacheName);
				const file = join(dir, readdirSync(dir)[0] ?? "");
				chmodSync(file, 0o644);
				expect(log.list("s1")).toEqual([]);
				expect(log.sessions()).toEqual([]);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});
	}

	test("the in-memory log lists what the file log lists for the same append and clear sequence", () => {
		const root = scratchRoot();
		try {
			const memory = new MemoryHookEventLog<LogEvent>();
			const file = claudeHookEventLog(root) as unknown as HookEventLog<LogEvent>;
			for (const log of [memory, file]) {
				log.append(start("s1", "a1"));
				log.append(result("s1", "a1", "first"));
				log.append(start("s2", "a2"));
				log.clear("s1");
			}
			expect(memory.list()).toEqual(file.list());
			expect(memory.sessions()).toEqual(file.sessions());
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

// Spec docs/specs/host-neutral-adapter-core.spec.md S2 AC1 (BR-REQ-2, BR-REQ-6;
// D5): both Hosts settle a verifier receipt through one state machine, so the
// same evidence produces the same outcomes on either Host.
describe("verifier observation", () => {
	const TRANSCRIPTS = reviewerTranscripts();
	afterAll(() => TRANSCRIPTS.cleanup());

	const TASK = "verifier-task";
	const OPERATION = "verifier-operation";
	const MODEL = "verifier-model";
	const RESULT = "reviewer result bytes";

	interface Driver {
		host: AssuranceHostPort;
		start(sessionId: string, agentId: string, prompt: string, agent?: string): void;
		result(sessionId: string, agentId: string, text: string, prompt: string, model?: string): void;
		stop(sessionId: string, agentId: string, agent?: string): void;
		end(sessionId: string): void;
	}

	interface HostSpec {
		label: string;
		prefix: string;
		verifier: string;
		make(): Driver;
		dispatchPrompt(reservation: HostReviewReservation): string;
		/** This Host's terminal events for one correlated dispatch. */
		terminate(driver: Driver, sessionId: string, agentId: string, prompt: string, model?: string): void;
	}

	function claudeHost(): Driver {
		const host = new ClaudeReviewHost();
		const verifier = "immune-brain-review-verifier";
		return {
			host,
			start: (sessionId, agentId, prompt, agent = verifier) => host.observe({ type: "SubagentStart", sessionId, agent, agentId, prompt, operationId: OPERATION }),
			result: (sessionId, agentId, text, prompt, model = MODEL) => host.observe({
				type: "PostToolUse", sessionId, agentId, toolName: "Agent", result: text, model, prompt, operationId: OPERATION,
				transcriptPath: TRANSCRIPTS.sessionTranscriptPath(agentId, text),
			}),
			stop: (sessionId, agentId, agent = verifier) => host.observe({ type: "SubagentStop", sessionId, agent, agentId, operationId: OPERATION }),
			end: (sessionId) => host.observe({ type: "SessionEnd", sessionId }),
		};
	}

	function antigravityHost(): Driver {
		const host = new AntigravityReviewHost();
		const verifier = "immune-brain-review-verifier";
		return {
			host,
			start: (sessionId, agentId, prompt, agent = verifier) => host.observe({ type: "start", sessionId, agentId, agent, prompt }),
			result: (sessionId, agentId, text, prompt, model = MODEL) => host.observe({ type: "result", sessionId, agentId, result: text, model, prompt }),
			stop: (sessionId, agentId, agent = verifier) => host.observe({ type: "stop", sessionId, agentId, agent }),
			end: (sessionId) => host.observe({ type: "session_end", sessionId }),
		};
	}

	function piHost(): Driver {
		const host = new PiReviewHost();
		const verifier = PI_VERIFIER_AGENT;
		return {
			host,
			start: (sessionId, agentId, prompt, agent = verifier) => host.observe({ type: "start", sessionId, agentId, agent, prompt }),
			result: (sessionId, agentId, text, prompt, model = MODEL) => host.observe({ type: "result", sessionId, agentId, result: text, model, prompt }),
			stop: (sessionId, agentId, agent = verifier) => host.observe({ type: "stop", sessionId, agentId, agent }),
			end: (sessionId) => host.observe({ type: "session_end", sessionId }),
		};
	}

	const HOST_SPECS: HostSpec[] = [
		{
			label: "claude-code", prefix: "claude", verifier: "immune-brain-review-verifier", make: claudeHost,
			dispatchPrompt: (reservation) => (reservation.dispatch as { prompt: string }).prompt,
			// PostToolUse carries the result and SubagentStop ends the dispatch.
			terminate: (driver, sessionId, agentId, prompt, model) => {
				driver.result(sessionId, agentId, RESULT, prompt, model);
				driver.stop(sessionId, agentId);
			},
		},
		{
			label: "antigravity", prefix: "antigravity", verifier: "immune-brain-review-verifier", make: antigravityHost,
			dispatchPrompt: (reservation) => (reservation.dispatch as { Prompt: string }).Prompt,
			// BR-SCN-1: PostToolUse is terminal here, so no stop event follows.
			terminate: (driver, sessionId, agentId, prompt, model) => driver.result(sessionId, agentId, RESULT, prompt, model),
		},
		{
			label: "pi", prefix: "pi", verifier: PI_VERIFIER_AGENT, make: piHost,
			dispatchPrompt: (reservation) => (reservation.dispatch as { prompt: string }).prompt,
			// BR-REQ-6 / D4: terminal is "result", so no stop event follows.
			terminate: (driver, sessionId, agentId, prompt, model) => driver.result(sessionId, agentId, RESULT, prompt, model),
		},
	];

	for (const spec of HOST_SPECS) {
		const prepare = (driver: Driver): HostReviewReservation => {
			expect(driver.host.prepareVerification).toBeDefined();
			return driver.host.prepareVerification!({
				taskId: TASK, operationId: OPERATION, prompt: "verifier prompt", model: MODEL, writePacket: writeTestReviewPacket,
			});
		};
		const inspect = (driver: Driver, reservation: HostReviewReservation) => {
			expect(driver.host.inspectVerification).toBeDefined();
			return driver.host.inspectVerification!(reservation);
		};

		test(`${spec.label}: a bound start and its terminal events settle one receipt`, () => {
			const driver = spec.make();
			const reservation = prepare(driver);
			const prompt = spec.dispatchPrompt(reservation);
			expect(prompt).toContain(OPERATION);

			driver.start("session-1", "agent-1", prompt);
			spec.terminate(driver, "session-1", "agent-1", prompt);

			expect(inspect(driver, reservation)).toEqual({
				ok: true,
				receipt: { actorId: `${spec.prefix}:agent-1`, result: RESULT, model: MODEL },
			});
		});

		test(`${spec.label}: no start event leaves the reservation unobserved and releases it`, () => {
			const driver = spec.make();
			const reservation = prepare(driver);
			const prompt = spec.dispatchPrompt(reservation);

			spec.terminate(driver, "session-1", "agent-1", prompt);

			expect(inspect(driver, reservation)).toEqual({ ok: false, reason: "reserved foreground Agent was not observed", release: true });
		});

		test(`${spec.label}: a start naming another agent leaves the reservation unobserved`, () => {
			const driver = spec.make();
			const reservation = prepare(driver);
			const prompt = spec.dispatchPrompt(reservation);

			spec.terminate(driver, "session-1", "agent-1", prompt);
			// Appended last: the evidence is complete before the foreign start lands.
			driver.start("session-1", "agent-1", prompt, "immune-brain-reviewer");

			expect(inspect(driver, reservation)).toEqual({ ok: false, reason: "reserved foreground Agent was not observed", release: true });
		});

		test(`${spec.label}: a terminal event whose model differs from the reservation is refused`, () => {
			const driver = spec.make();
			const reservation = prepare(driver);
			const prompt = spec.dispatchPrompt(reservation);

			driver.start("session-1", "agent-1", prompt);
			spec.terminate(driver, "session-1", "agent-1", prompt, "other-model");

			expect(inspect(driver, reservation)).toEqual({ ok: false, reason: "verifier model differs from reservation", release: true });
		});

		test(`${spec.label}: a second distinct result is a duplicate`, () => {
			const driver = spec.make();
			const reservation = prepare(driver);
			const prompt = spec.dispatchPrompt(reservation);

			driver.start("session-1", "agent-1", prompt);
			spec.terminate(driver, "session-1", "agent-1", prompt);
			driver.result("session-1", "agent-1", "a second reviewer result", prompt);

			const refused = inspect(driver, reservation);
			expect(refused.ok).toBe(false);
			if (refused.ok) throw new Error("a duplicate result settled a receipt");
			expect(refused.reason).toContain("duplicate");
			expect(refused.release).toBe(true);
		});

		test(`${spec.label}: a SessionEnd for the bound session retires the reservation`, () => {
			const driver = spec.make();
			const reservation = prepare(driver);
			const prompt = spec.dispatchPrompt(reservation);

			driver.start("session-1", "agent-1", prompt);
			spec.terminate(driver, "session-1", "agent-1", prompt);
			driver.end("session-1");

			expect(inspect(driver, reservation)).toEqual({ ok: false, reason: "reserved foreground Agent was not observed", release: true });
		});

		test(`${spec.label}: a start without its terminal keeps the reservation until the terminal lands`, () => {
			const driver = spec.make();
			const reservation = prepare(driver);
			const prompt = spec.dispatchPrompt(reservation);

			driver.start("session-1", "agent-1", prompt);
			expect(inspect(driver, reservation)).toEqual({
				ok: false, reason: "foreground Agent terminal event order is incomplete", release: false,
			});

			spec.terminate(driver, "session-1", "agent-1", prompt);
			expect(inspect(driver, reservation)).toMatchObject({ ok: true, receipt: { actorId: `${spec.prefix}:agent-1` } });
		});

		test(`${spec.label}: a corrupted packet handle refuses and releases the reservation`, () => {
			const driver = spec.make();
			let packetPath = "";
			const reservation = driver.host.prepareVerification!({
				taskId: TASK, operationId: OPERATION, prompt: "verifier prompt", model: MODEL,
				writePacket: (op, prompt) => {
					const pkt = writeTestReviewPacket(op, prompt);
					packetPath = pkt.path;
					return pkt;
				},
			});
			writeFileSync(packetPath, "corrupted content");
			const prompt = spec.dispatchPrompt(reservation);
			driver.start("session-1", "agent-1", prompt);
			spec.terminate(driver, "session-1", "agent-1", prompt);

			const inspected = inspect(driver, reservation);
			expect(inspected.ok).toBe(false);
			expect(inspected.release).toBe(true);
		});

		test(`${spec.label}: releasing the reservation removes it and refuses subsequent inspection`, () => {
			const driver = spec.make();
			const reservation = prepare(driver);
			const prompt = spec.dispatchPrompt(reservation);

			driver.start("session-1", "agent-1", prompt);
			spec.terminate(driver, "session-1", "agent-1", prompt);
			expect(inspect(driver, reservation)).toMatchObject({ ok: true });

			driver.host.releaseReview!(reservation);
			expect(inspect(driver, reservation)).toEqual({ ok: false, reason: "reserved foreground Agent was not observed", release: true });
		});
	}
});

describe("runtime composition", () => {
	/** An isolated repository with one scripted TaskIntent whose check passes. */
	function compositionRepo(taskId: string): string {
		const root = mkdtempSync(join(tmpdir(), "imm-runtime-composition-"));
		mkdirSync(join(root, "docs/plans"), { recursive: true });
		mkdirSync(join(root, "src"), { recursive: true });
		mkdirSync(join(root, ".imm/state"), { recursive: true });
		const intent = {
			contract: "assurance_kernel/task_intent/v1", task_id: taskId, owner: "user",
			goal: "share one runtime between two Hosts",
			acceptance: [{
				id: "acc-1", assertion: "the scripted check passes",
				verification: JSON.stringify({
					contract: "assurance_kernel/verification_descriptor/v2",
					command: { executable: "sh", argv: ["-c", "true"], cwd: ".", timeout_ms: 30_000, max_output_bytes: 8_192 },
					environment: { prepare: null, writable_paths: [] },
				}),
			}],
			scope_hint: [`docs/plans/${taskId}.intent.json`, "src/task.ts"],
			risk: "material", revision: 1,
		};
		writeFileSync(join(root, "docs/plans", `${taskId}.intent.json`), `${JSON.stringify(intent, null, 2)}\n`);
		writeFileSync(join(root, "src/task.ts"), "export const delivered = false;\n");
		writeFileSync(join(root, ".gitignore"), ".imm/state/\n");
		// D11: the Review CLI dispatcher needs a resolved review profile, exactly as
		// the project-owned-verification fixture does.
		writeFileSync(join(root, ".imm/config.json"), `${JSON.stringify({ contract: "immune_brain/project_config/v2", agents: { reviewer: "pi" } })}\n`);
		execFileSync("git", ["init", "-q"], { cwd: root });
		execFileSync("git", ["add", "-A"], { cwd: root });
		execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-q", "-m", "fixture"], { cwd: root });
		return root;
	}

	/** Enroll, deliver the in-scope change, freeze and run QA through the runtime itself. */
	async function driveToReview(taskId: string, root: string, runtime: ClaudeRuntime | AntigravityRuntime) {
		await enrollTaskForTest(root, taskId);
		writeFileSync(join(root, "src/task.ts"), "export const delivered = true;\n");
		execFileSync("git", ["add", "--", "src/task.ts"], { cwd: root });
		const advanced = await runtime.advance(taskId);
		if (advanced.state !== "review_ready") throw new Error(`expected review_ready, got ${JSON.stringify(advanced)}`);
		const status = await runtime.status(taskId);
		if (status.error) throw new Error(`status failed: ${status.error}`);
		return status;
	}

	test("both Hosts compose one HostRuntime and yield the same Kernel projection", async () => {
		const taskId = "composition-task";
		const claudeRoot = compositionRepo(taskId);
		const antigravityRoot = compositionRepo(taskId);
		const claude = new ClaudeRuntime({ cwd: claudeRoot, env: { CLAUDE_CODE_VERSION: "2.1.236", HERDR_ENV: "1", HERDR_WORKSPACE_ID: "w-parent" }, interactive: true });
		const antigravity = new AntigravityRuntime({ cwd: antigravityRoot, env: { ANTIGRAVITY_VERSION: "0.2.0", HERDR_ENV: "1", HERDR_WORKSPACE_ID: "w-parent" }, interactive: true });
		try {
			// One implementation, two profiles: the same class carries both Hosts.
			expect(claude.runtime).toBeInstanceOf(HostRuntime);
			expect(antigravity.runtime).toBeInstanceOf(HostRuntime);
			expect(claude.runtime.profile.hostId).toBe("claude-code");
			expect(antigravity.runtime.profile.hostId).toBe("antigravity");
			expect(claude.host.host).toBe("claude-code");
			expect(antigravity.host.host).toBe("antigravity");

			const claudeStatus = await driveToReview(taskId, claudeRoot, claude);
			const antigravityStatus = await driveToReview(taskId, antigravityRoot, antigravity);

			// The repository-identity fields differ (two checkouts, two Git bases); every
			// Kernel fact derived from the scripted task is identical.
			const neutral = (projection: Record<string, unknown>) => {
				const { run_id: _run, record_revision: _record, workspace_revision: _workspace, diff_hash: _diff, ...rest } = projection;
				return rest;
			};
			expect(claudeStatus.projection.next_obligation).toBe("run_review");
			expect(claudeStatus.projection.artifact_state).toBe("frozen");
			expect(neutral(antigravityStatus.projection)).toEqual(neutral(claudeStatus.projection));

			// Each Host records its own native confirmation reference.
			const facts = { connectionId: "s", toolCallId: "t", requestId: "nested", operation: "stop", taskId };
			expect(claude.runtime.profile.confirmationRef(facts)).toMatch(/^claude-confirm-[0-9a-f]{16}$/);
			expect(antigravity.runtime.profile.confirmationRef(facts)).toMatch(/^antigravity-confirm-[0-9a-f]{16}$/);
		} finally {
			await claude.shutdown();
			await antigravity.shutdown();
			rmSync(claudeRoot, { recursive: true, force: true });
			rmSync(antigravityRoot, { recursive: true, force: true });
		}
	}, 120_000);

	test("an Antigravity verifier event reaches that runtime's ReviewHost", () => {
		const log = new MemoryHookEventLog<AntigravityHookEvent>();
		const runtime = new AntigravityRuntime({ cwd: process.cwd(), host: new AntigravityReviewHost(log), interactive: false });
		runtime.observeAntigravity({ type: "start", sessionId: "conv-1", agent: "agent-7", agentId: "1", prompt: "dispatch" });
		expect(log.list("conv-1")).toMatchObject([{ type: "start", sessionId: "conv-1", agent: "agent-7", agentId: "1" }]);
	});

	test("a native refusal from either runtime is the shared NativeAuthorityError", async () => {
		const root = enrolledHostFixture("probe-task");
		const claude = new ClaudeRuntime({ cwd: root, env: { CLAUDE_CODE_VERSION: "2.1.236" }, interactive: true });
		const antigravity = new AntigravityRuntime({ cwd: root, env: { ANTIGRAVITY_VERSION: "0.2.0" }, interactive: true });
		try {
			const meta = (toolCallId: string): ToolMeta => ({ taskId: "probe-task", sessionId: "s", toolCallId, interactive: true });
			for (const [host, runtime] of [["claude-code", claude], ["antigravity", antigravity]] as const) {
				const refusal = await runtime.authorize("probe-task", "stop", meta("probe-call")).catch((error: unknown) => error);
				expect({ host, shared: refusal instanceof NativeAuthorityError, code: (refusal as NativeAuthorityError).reasonCode })
					.toEqual({ host, shared: true, code: "interaction_not_opened" });
			}
			// Bound: one declaration serves both adapters.
			const declaring = readdirSync(join(process.cwd(), "plugins/immune-brain/runtime"), { recursive: true })
				.map(String).map((path) => path.split("\\").join("/"))
				.filter((path) => path.endsWith(".ts") && readFileSync(join(process.cwd(), "plugins/immune-brain/runtime", path), "utf8").includes("class NativeAuthorityError"));
			expect(declaring).toEqual(["host-core/interaction.ts"]);
		} finally {
			await claude.shutdown();
			await antigravity.shutdown();
			rmSync(root, { recursive: true, force: true });
		}
	});
});


// Spec docs/specs/host-neutral-adapter-core.spec.md S4 AC2 (BR-REQ-4; D8). One
// MCP stdio runtime answers both Hosts, each through its own profile: the
// profile supplies the identity, the trusted client names, the correlation key
// and the probe, so no adapter machinery is duplicated.
describe("MCP host profile", () => {
	const initialize = (
		mcp: ReturnType<typeof createMcpRuntimeUngated> | ReturnType<typeof createAntigravityMcpRuntime>,
		clientInfo: { name: string; version: string },
	) => handleJsonRpc({
		jsonrpc: "2.0",
		id: "init",
		method: "initialize",
		params: { protocolVersion: "2025-06-18", clientInfo, capabilities: { elicitation: {} } },
	}, mcp as ReturnType<typeof createMcpRuntimeUngated>);

	const initializeInfo = async (
		mcp: ReturnType<typeof createMcpRuntimeUngated> | ReturnType<typeof createAntigravityMcpRuntime>,
		clientInfo: { name: string; version: string },
	): Promise<Record<string, unknown>> => {
		const reply = await initialize(mcp, clientInfo);
		return (reply?.result as { serverInfo: Record<string, unknown> }).serverInfo;
	};

	const refusal = async (
		mcp: ReturnType<typeof createMcpRuntimeUngated> | ReturnType<typeof createAntigravityMcpRuntime>,
		name: string,
	): Promise<Record<string, unknown> | undefined> => {
		const reply = await handleJsonRpc({ jsonrpc: "2.0", id: name, method: "tools/call", params: { name, arguments: { task_id: "profile-task" } } }, mcp as ReturnType<typeof createMcpRuntimeUngated>);
		return reply?.error?.data;
	};

	test("each Host's profile answers initialize with its own serverInfo", async () => {
		const claude = createMcpRuntimeUngated({ cwd: process.cwd(), env: {}, interactive: true, consumePhaseAdmission: () => false });
		expect(await initializeInfo(claude, { name: "claude-code", version: "2.1.236" }))
			.toMatchObject({ name: "claude-code", minimumHostVersion: MIN_CLAUDE_CODE_VERSION });

		for (const clientInfo of [{ name: "antigravity-client", version: "v1.0.0" }, { name: "antigravity", version: "1.0.0" }]) {
			const antigravity = createAntigravityMcpRuntime({ cwd: process.cwd(), env: {}, interactive: true, consumePhaseAdmission: () => false });
			expect(await initializeInfo(antigravity, clientInfo))
				.toMatchObject({ name: "antigravity", minimumHostVersion: MIN_ANTIGRAVITY_VERSION });
		}
	});

	test("each Host binds the negotiated version for its own probe", async () => {
		const claude = createMcpRuntimeUngated({ cwd: process.cwd(), env: {}, interactive: true, consumePhaseAdmission: () => false });
		await initialize(claude, { name: "claude-code", version: "2.1.100" });
		expect(await refusal(claude, "advance_assurance")).toMatchObject({ reason_code: "unsupported_host" });
		expect((await handleJsonRpc({ jsonrpc: "2.0", id: "below", method: "tools/call", params: { name: "advance_assurance", arguments: { task_id: "profile-task" } } }, claude))?.error?.message)
			.toStartWith("unsupported_host: Claude Code 2.1.100 is below the minimum supported 2.1.236");

		const antigravity = createAntigravityMcpRuntime({ cwd: process.cwd(), env: {}, interactive: true, consumePhaseAdmission: () => false });
		await initialize(antigravity, { name: "antigravity-client", version: "v0.0.9" });
		expect((await handleJsonRpc({ jsonrpc: "2.0", id: "below", method: "tools/call", params: { name: "advance_assurance", arguments: { task_id: "profile-task" } } }, antigravity))?.error?.message)
			.toStartWith("unsupported_host: Antigravity version v0.0.9 is older than minimum supported 0.1.0");
	});

	test("an untrusted client name binds no version, so each Host refuses with its own probe reason", async () => {
		const claude = createMcpRuntimeUngated({ cwd: process.cwd(), env: { CLAUDE_CODE_VERSION: "2.1.236" }, interactive: true, consumePhaseAdmission: () => false });
		await initialize(claude, { name: "untrusted-client", version: "2.1.236" });
		expect((await handleJsonRpc({ jsonrpc: "2.0", id: "untrusted", method: "tools/call", params: { name: "advance_assurance", arguments: { task_id: "profile-task" } } }, claude))?.error?.message)
			.toStartWith("unsupported_host: Claude Code version is unavailable");

		const antigravity = createAntigravityMcpRuntime({ cwd: process.cwd(), env: { ANTIGRAVITY_VERSION: "1.0.0" }, interactive: true, consumePhaseAdmission: () => false });
		await initialize(antigravity, { name: "untrusted-client", version: "v1.0.0" });
		expect((await handleJsonRpc({ jsonrpc: "2.0", id: "untrusted", method: "tools/call", params: { name: "advance_assurance", arguments: { task_id: "profile-task" } } }, antigravity))?.error?.message)
			.toStartWith("unsupported_host: Antigravity version is unavailable");
	});

	test("a Claude gated call without claudecode/toolUseId metadata is refused as correlation_missing", async () => {
		const claude = createMcpRuntimeUngated({ cwd: process.cwd(), env: { CLAUDE_CODE_VERSION: "2.1.236" }, interactive: true, consumePhaseAdmission: () => false });
		await initialize(claude, { name: "claude-code", version: "2.1.236" });
		const reply = await handleJsonRpc({
			jsonrpc: "2.0",
			id: "gated",
			method: "tools/call",
			params: { name: "enroll", arguments: { task_id: "profile-task" } },
		}, claude);
		expect(reply?.error?.data).toEqual({ reason_code: "correlation_missing", recovery_action: "retry through a fresh native gate in the current Host" });
	});
});
