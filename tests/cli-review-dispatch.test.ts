import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import {
	AssuranceCoordinator,
	snapshotDigest,
	type AssuranceCoordinatorPorts,
	type AssuranceVerdict,
	type HostContext,
	type SnapshotDescriptor,
} from "../plugins/immune-brain/runtime/assurance/coordinator";
import { ClaudeRuntime } from "../plugins/immune-brain/runtime/claude/kernel_ports";
import { AntigravityRuntime } from "../plugins/immune-brain/runtime/antigravity/kernel_ports";
import { PiRuntime } from "../plugins/immune-brain/.pi-extension/pi-host-runtime";
import { runtimeClaudePluginDir } from "../plugins/immune-brain/runtime/plugin_source_skew";
import { CLAUDE_REVIEW_SETTINGS, CliReviewHost, REVIEW_GIT_ALLOWED_TOOLS, resolveReviewProfile, sessionHostArguments } from "../plugins/immune-brain/runtime/assurance/cli_review";
import type { AssuranceHostPort, HostReviewReservation, ReviewRequest, ReviewSessionSpec, VerificationRequest } from "../plugins/immune-brain/runtime/assurance/host_port";
import { submitMediatedReview } from "../plugins/immune-brain/runtime/assurance/review_mediation";
import { digestOfReviewerBytes } from "../plugins/immune-brain/runtime/assurance/review_mediation";
import type { ReviewBundle } from "../plugins/immune-brain/runtime/assurance/review_evidence";
import type { VerdictAuthority } from "../plugins/immune-brain/runtime/assurance/verdict_authority";
import { currentReviewContractHash } from "../plugins/immune-brain/runtime/role_prompt_bridge";
import { writeTestReviewPacket } from "./helpers/review-packet-fixture";
import { laneBatchReviewProfile, parseBatchReviewProfile, prepareBatchLaneRunState, reviewProfileFromArgs, writeBatchLaneRunState } from "../plugins/immune-brain/runtime/unattended/batch_state";
import { createLaneWorktree } from "../plugins/immune-brain/runtime/unattended/batch_worktrees";

setDefaultTimeout(120_000);

const TASK = "cli-review-task";
const ROOT_PATH = process.env.PATH ?? "";
const ROOT_XDG = process.env.XDG_CONFIG_HOME;
const scratch: string[] = [];

function scratchDir(label: string): string {
	const dir = mkdtempSync(join(tmpdir(), `imm-cli-dispatch-${label}-`));
	scratch.push(dir);
	return dir;
}

afterEach(() => {
	// Every case that needs a reviewer binary replaces PATH for its own run only.
	process.env.PATH = ROOT_PATH;
});

afterAll(() => {
	process.env.PATH = ROOT_PATH;
	if (ROOT_XDG === undefined) delete process.env.XDG_CONFIG_HOME;
	else process.env.XDG_CONFIG_HOME = ROOT_XDG;
	for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

beforeAll(() => {
	// The layered config resolves the user file from XDG_CONFIG_HOME; an empty one
	// keeps these cases independent of the developer's lane profile.
	process.env.XDG_CONFIG_HOME = scratchDir("xdg");
});

/** One real Git repository: the tree guard needs HEAD, an index and tracked bytes. */
function reviewRepo(reviewHost: "pi" | "claude-code" | "antigravity" | null = "pi", lanes: Record<string, string> = {}): string {
	const root = scratchDir("repo");
	execFileSync("git", ["init", "-q"], { cwd: root });
	execFileSync("git", ["config", "user.name", "test"], { cwd: root });
	execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
	mkdirSync(join(root, ".imm"), { recursive: true });
	writeFileSync(join(root, ".imm/config.json"), `${JSON.stringify({
		contract: "immune_brain/project_config/v1",
		...(reviewHost ? { lanes: { review_host: reviewHost, ...lanes } } : {}),
	})}\n`);
	writeFileSync(join(root, "src.ts"), "export const value = 1;\n");
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
	return root;
}

/** An `agents` role table in the user file the resolver reads; returns its cleanup. */
function homeAgents(agents: object): () => void {
	const dir = join(process.env.XDG_CONFIG_HOME!, "immune-brain");
	mkdirSync(dir, { recursive: true });
	const path = join(dir, "config.json");
	writeFileSync(path, JSON.stringify({ contract: "immune_brain/user_config/v1", agents }));
	return () => rmSync(path, { force: true });
}

/** A reviewer stand-in under the Host binary name, first on PATH (no model call). */
function fakeReviewer(body: string): string {
	const dir = scratchDir("bin");
	const file = join(dir, "pi");
	writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
	chmodSync(file, 0o755);
	return dir;
}

function onPath(dir: string | undefined): void {
	process.env.PATH = [dir, ROOT_PATH].filter(Boolean).join(":");
}

/** One admitted Herdr workspace: the only place an authority Review runs. */
function enterHerdr(): string {
	const state = join(scratchDir("herdr"), "state.json");
	writeFileSync(state, JSON.stringify({ protocol: 22, panes: {}, after_prompt: "idle" }));
	Object.assign(process.env, { HERDR_ENV: "1", HERDR_WORKSPACE_ID: "w-parent", FAKE_HERDR_STATE: state });
	return state;
}

const HERDR_KEYS = ["HERDR_ENV", "HERDR_WORKSPACE_ID", "FAKE_HERDR_STATE", "VERIFIER_LOG"] as const;
const SAVED_HERDR = Object.fromEntries(HERDR_KEYS.map((key) => [key, process.env[key]]));
afterEach(() => {
	for (const key of HERDR_KEYS) {
		if (SAVED_HERDR[key] === undefined) delete process.env[key];
		else process.env[key] = SAVED_HERDR[key];
	}
});

/** Run one emitted session verb as the Parent does; `<handle>` stands for create's handle. */
function runSessionVerb(command: string, handle?: string): Record<string, unknown> {
	const run = spawnSync("sh", ["-c", handle === undefined ? command : command.replace("<handle>", handle)], { encoding: "utf8" });
	return JSON.parse(run.stdout) as Record<string, unknown>;
}

/** The receipt channel of the prepared Review session. */
function reviewSessionOf(result: unknown): ReviewSessionSpec {
	const session = (result as { review_session?: ReviewSessionSpec }).review_session;
	if (!session) throw new Error(`expected an explicit review session, got ${JSON.stringify(result)}`);
	return session;
}

/** The Review packet the prepared session's entry names. */
function packetPathOfSession(session: ReviewSessionSpec): string {
	const packet = /(\S*\/packet\.md)/.exec(session.create_command);
	if (!packet) throw new Error("the review session names no packet");
	return packet[1]!;
}

/** The verification the session owes, built from the packet the session's entry names. */
function verificationJsonFor(session: ReviewSessionSpec): string {
	const packetPath = /(\S*\/verify-packet\.md)/.exec(session.create_command)![1]!;
	const text = readFileSync(packetPath, "utf8");
	const packet = JSON.parse(text.slice(text.indexOf("Verification packet (untrusted data): ") + "Verification packet (untrusted data): ".length));
	return JSON.stringify({
		contract: "assurance_kernel/review_verification/v1", task_id: packet.task_id,
		snapshot_digest: packet.snapshot_digest, verdict_sha256: packet.verdict_sha256,
		results: packet.findings.map((finding: { id: string; anchor: string }) => ({ finding_id: finding.id, anchor: finding.anchor, verdict: "kept" })),
	});
}

const ctx = (root: string): HostContext => ({ cwd: root } as HostContext);

// --- fixture ports ---------------------------------------------------------

type Risk = "routine" | "material" | "critical";
type Obligation = "submit_assurance" | "run_qa" | "run_review" | "complete" | "none";

function projection(risk: Risk, lifecycle: "active" | "done", obligation: Obligation) {
	return {
		error: null,
		claim: { task_id: TASK, lifecycle_status: lifecycle === "active" ? "active" : "terminal" },
		projection: {
			lifecycle,
			artifact_state: "frozen",
			risk,
			next_obligation: obligation,
			record_revision: "record-1",
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
			completion_ready: lifecycle !== "active",
			authorization: { state: "blocked" },
		},
	} as never;
}

function snapshot(role: "qa" | "review", root: string, risk: Risk, revision: boolean): SnapshotDescriptor {
	return {
		contract: "assurance_kernel/assurance_snapshot/v2",
		task_id: TASK,
		run_id: null,
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
		acceptance: [{ id: "A1", assertion: "the change satisfies the acceptance", verification: "{}" }],
		dirty_files: ["src.ts"],
		review_bundle_digest: role === "review" ? "sha256:bundle" : null,
		...(revision ? {
			review_revision: {
				contract: "assurance_kernel/review_revision_identity/v1",
				base_head: "a".repeat(40),
				review_commit: "b".repeat(40),
				review_tree: "c".repeat(40),
				manifest_digest: `sha256:${"d".repeat(64)}`,
			},
		} : {}),
		root,
	} as SnapshotDescriptor;
}

function reviewBundle(root: string): ReviewBundle {
	return {
		contract: "assurance_kernel/review_bundle/v4",
		root,
		head: "a".repeat(40),
		scope: ["src.ts"],
		diff_hash: "sha256:diff",
		dirty_files: {},
		outcomes: { A1: { status: "passed", summary: "fresh" } },
		bundle_digest: "sha256:bundle",
	} as unknown as ReviewBundle;
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
			...(s.role === "review" ? { inspected_paths: [...s.dirty_files] } : {}),
		},
	};
}

function reworkVerdict(s: SnapshotDescriptor): AssuranceVerdict {
	return {
		contract: "assurance_kernel/assurance_verdict/v2",
		role: "review",
		task_id: TASK,
		snapshot_digest: snapshotDigest(s),
		decision: "rework",
		findings: [{
			id: "review-1", kind: "blocking", acceptance_id: "A1", summary: "the delivery violates its acceptance",
			evidence: { trigger: "src.ts returns a stale value → the acceptance assertion fails", caller_chain: ["src.ts"], violated: { kind: "acceptance", ref: "A1" } },
		}],
	} as AssuranceVerdict;
}

interface Applied {
	actorId: string;
	role: "qa" | "review";
	decision: string;
	verdictSha256?: string;
	verification?: Record<string, unknown>;
}

interface WrappedCalls {
	prepareVerification: number;
	inspectVerification: number;
	released: number;
}

/** The wrapped Host: only findings verification may reach it (BR-DEC-4). */
function wrappedHost(verifier: boolean): { host: AssuranceHostPort; calls: WrappedCalls } {
	const calls: WrappedCalls = { prepareVerification: 0, inspectVerification: 0, released: 0 };
	const host: AssuranceHostPort = {
		host: "pi",
		releaseReview: () => { calls.released += 1; },
		...(verifier ? {
			prepareVerification: (request: VerificationRequest): HostReviewReservation => {
				calls.prepareVerification += 1;
				return { id: request.operationId, dispatch: { prompt: `verifier:${request.operationId}`, model: request.model } };
			},
			inspectVerification: () => {
				calls.inspectVerification += 1;
				return { ok: false as const, release: true, reason: "the verifier was not observed in this fixture" };
			},
		} : {}),
	};
	return { host, calls };
}

interface Kernel {
	coordinator: AssuranceCoordinator;
	cli: CliReviewHost;
	applied: Applied[];
	calls: WrappedCalls;
	snapshot: SnapshotDescriptor;
}

/** The fixture ports, shared by the direct coordinator and the composition-root cases. */
function fixtureFor(root: string, options: { risk?: Risk; revision?: boolean; verifier?: boolean } = {}): {
	ports: AssuranceCoordinatorPorts; cli: CliReviewHost; applied: Applied[]; calls: WrappedCalls;
	snapshot: SnapshotDescriptor; current: (role: "qa" | "review") => SnapshotDescriptor;
} {
	const risk = options.risk ?? "material";
	let lifecycle: "active" | "done" = "active";
	let obligation: Obligation = "run_qa";
	const applied: Applied[] = [];
	const { host, calls } = wrappedHost(options.verifier ?? false);
	const cli = new CliReviewHost(host);
	const current = (role: "qa" | "review") => snapshot(role, root, risk, options.revision ?? false);
	const ports: AssuranceCoordinatorPorts = {
		host: cli,
		reviewVerifierMode: () => options.verifier ? "on" : "off",
		confirmationReference: ({ actorId }) => `fixture:${actorId}`,
		projectTask: async () => projection(risk, lifecycle, obligation),
		readTaskRecord: async () => ({ revision: "record-1", record: { findings: [], history: [] } }),
		readTaskIntent: async () => ({ token: "intent-token" }),
		buildAssurance: async (_root: string, _task: string, role: "qa" | "review") => ({
			snapshot: current(role),
			descriptors: new Map([["A1", {
				contract: "assurance_kernel/verification_descriptor/v2",
				command: { executable: "bun", argv: ["test"], cwd: ".", timeout_ms: 1000, max_output_bytes: 1024 },
				environment: { prepare: null, writable_paths: [] },
			}]] as never),
			reviewBundle: role === "review" ? reviewBundle(root) : null,
		}),
		runQa: async (s: SnapshotDescriptor) => passVerdict(s),
		writeReviewEvidence: () => {
			const dir = scratchDir("evidence");
			const path = join(dir, "evidence.json");
			writeFileSync(path, "{}");
			return { path, writePacket: writeTestReviewPacket, remove: () => rmSync(dir, { recursive: true, force: true }) };
		},
		applyVerdict: async (_ctx: HostContext, input: Parameters<VerdictAuthority["applyVerdict"]>[1]) => {
			applied.push({ actorId: input.actorId, role: input.snapshot.role as "qa" | "review", decision: input.verdict.decision,
				...(input.reviewer_verdict_sha256 ? { verdictSha256: input.reviewer_verdict_sha256 } : {}),
				...(input.verification ? { verification: input.verification.facts as unknown as Record<string, unknown> } : {}) });
			obligation = input.snapshot.role === "qa"
				? risk === "routine" ? "complete" : "run_review"
				: input.verdict.decision === "rework" ? "run_qa" : "complete";
		},
		applyOrdinaryOperation: async (_ctx: HostContext, input: { operation: { op: string } }) => {
			if (input.operation.op === "complete") { lifecycle = "done"; obligation = "none"; }
		},
		ensureReviewRevision: async () => current("review").review_revision!,
	} as AssuranceCoordinatorPorts;
	return { ports, cli, applied, calls, snapshot: current("review"), current };
}

function kernelFor(root: string, options: { risk?: Risk; revision?: boolean; verifier?: boolean } = {}): Kernel {
	const { ports, cli, applied, calls, snapshot } = fixtureFor(root, options);
	const coordinator = new AssuranceCoordinator(ports, ports as unknown as Partial<VerdictAuthority>);
	return { coordinator, cli, applied, calls, snapshot };
}

function reviewsOf(kernel: Kernel): Applied[] {
	return kernel.applied.filter((entry) => entry.role === "review");
}

// --- AC1: the reviewer runs the skill from the runtime's own plugin ------

describe("reviewer plugin directory", () => {
	test("#426 F13: the runtime resolves the Claude plugin it was loaded from", () => {
		const root = join(import.meta.dir, "..", "plugins", "immune-brain");
		expect(runtimeClaudePluginDir(join(root, "runtime", "assurance"))).toBe(realpathSync(root));
		expect(runtimeClaudePluginDir(join(root, "dist", "claude"))).toBe(realpathSync(root));
		expect(runtimeClaudePluginDir(join(import.meta.dir, "..", "plugins", "immune-brain-antigravity", "runtime", "assurance"))).toBeNull();
	});
});

// --- #426 A2: the plain-cwd git instruction --------------------------------

describe("#426 plain-cwd git instruction", () => {
	const instruction = "Run one Git command at a time from the current working directory, with no `-C`, no pipes and no redirection, and `--no-pager` only as the first argument.";
	const read = (rel: string) => readFileSync(join(import.meta.dir, "..", rel), "utf8").replace(/\s+/g, " ");

	test.each([
		"plugins/immune-brain/skills/authority-review/SKILL.md",
		"plugins/immune-brain/runtime/prompts/code-review.md",
		"plugins/immune-brain/runtime/prompts/review-verifier.md",
		"plugins/immune-brain/dist/role-prompts/code-review.md",
		"plugins/immune-brain/dist/role-prompts/review-verifier.md",
	])("%s tells the role how to run git", (rel) => {
		expect(read(rel)).toContain(instruction);
	});
});

// --- AC3: settlement and session failures ---------------------------------

describe("cli review settlement", () => {
	test("a pass verdict settles through the reviewer's out-of-tree receipt", async () => {
		const root = reviewRepo();
		const kernel = kernelFor(root);
		const verdict = passVerdict(kernel.snapshot);
		const bytes = `${JSON.stringify(verdict)}\n`;
		onPath(fakeReviewer("exit 0"));
		enterHerdr();
		const ready = await kernel.coordinator.advance(TASK, ctx(root));
		const session = reviewSessionOf(ready);

		expect(readFileSync(packetPathOfSession(session), "utf8")).toContain(`review_contract_hash: ${currentReviewContractHash()}`);
		writeFileSync(session.output_path, bytes);

		const settled = await submitMediatedReview(kernel.coordinator, ctx(root), TASK, undefined, () => kernel.cli.inspectReview(TASK));
		expect(settled).toMatchObject({ state: "completed" });
		expect(reviewsOf(kernel)).toEqual([{
			actorId: `cli:pi:${(ready as { operation_id: string }).operation_id}`,
			role: "review",
			decision: "pass",
			verdictSha256: digestOfReviewerBytes(bytes),
		}]);
	});

	test("a rework verdict records one round", async () => {
		const root = reviewRepo();
		const kernel = kernelFor(root);
		const verdict = reworkVerdict(kernel.snapshot);
		onPath(fakeReviewer("exit 0"));
		enterHerdr();
		const ready = await kernel.coordinator.advance(TASK, ctx(root));
		writeFileSync(reviewSessionOf(ready).output_path, JSON.stringify(verdict));

		const settled = await submitMediatedReview(kernel.coordinator, ctx(root), TASK, undefined, () => kernel.cli.inspectReview(TASK));
		expect(settled.state).toBe("rework");
		expect(reviewsOf(kernel)).toHaveLength(1);
		expect(reviewsOf(kernel)[0].decision).toBe("rework");
	});

	test("a relayed verdict that differs from the receipt keeps the reservation", async () => {
		const root = reviewRepo();
		const kernel = kernelFor(root);
		const printed = passVerdict(kernel.snapshot);
		const relayed = reworkVerdict(kernel.snapshot);
		onPath(fakeReviewer("exit 0"));
		enterHerdr();
		const ready = await kernel.coordinator.advance(TASK, ctx(root));
		writeFileSync(reviewSessionOf(ready).output_path, JSON.stringify(printed));

		const settled = await submitMediatedReview(kernel.coordinator, ctx(root), TASK, relayed, () => kernel.cli.inspectReview(TASK));
		expect(settled).toMatchObject({ state: "blocked", reason: "parent verdict does not match reviewer receipt" });
		expect(kernel.coordinator.active(TASK)).toMatchObject({ state: "review_ready" });
		expect(reviewsOf(kernel)).toHaveLength(0);
	});

	test("submitting before the session writes its receipt keeps the reservation and records no round", async () => {
		const root = reviewRepo();
		const kernel = kernelFor(root);
		onPath(fakeReviewer("exit 0"));
		enterHerdr();
		await kernel.coordinator.advance(TASK, ctx(root));

		const settled = await submitMediatedReview(kernel.coordinator, ctx(root), TASK, undefined, () => kernel.cli.inspectReview(TASK));
		expect(settled).toMatchObject({ state: "blocked" });
		expect((settled as { reason: string }).reason).toContain("still running");
		// A pending round names the wait, never a repeat submit.
		expect((settled as { reason: string }).reason).not.toContain("submit_review again");
		expect((settled as { recovery_action: string }).recovery_action).not.toContain("submit_review again");
		expect(kernel.coordinator.active(TASK)).toMatchObject({ state: "review_ready" });
		expect(reviewsOf(kernel)).toHaveLength(0);
	});

	test.each([
		["an empty receipt", "", "review_output_invalid"],
		["a receipt that is not one JSON object", "not json\n", "review_output_invalid"],
		["surrounding lines around the verdict", "thinking out loud\n{}\n", "review_output_invalid"],
	])("%s releases without a Review round", async (_label, bytes, reason) => {
		const root = reviewRepo();
		const kernel = kernelFor(root);
		onPath(fakeReviewer("exit 0"));
		enterHerdr();
		const ready = await kernel.coordinator.advance(TASK, ctx(root));
		writeFileSync(reviewSessionOf(ready).output_path, bytes);

		const settled = await submitMediatedReview(kernel.coordinator, ctx(root), TASK, undefined, () => kernel.cli.inspectReview(TASK));
		expect(settled).toMatchObject({ state: "blocked" });
		expect((settled as { reason: string }).reason).toContain(reason);
		expect(kernel.coordinator.active(TASK)).toBeNull();
		expect(reviewsOf(kernel)).toHaveLength(0);
	});

	test("a contract mismatch in the receipt ends the round", async () => {
		const root = reviewRepo();
		const kernel = kernelFor(root);
		onPath(fakeReviewer("exit 0"));
		enterHerdr();
		const ready = await kernel.coordinator.advance(TASK, ctx(root));
		writeFileSync(reviewSessionOf(ready).output_path, "REVIEW_CONTRACT_MISMATCH sha256:0\n");

		const settled = await submitMediatedReview(kernel.coordinator, ctx(root), TASK, undefined, () => kernel.cli.inspectReview(TASK));
		expect(settled).toMatchObject({ state: "blocked" });
		expect((settled as { reason: string }).reason).toContain("review_contract_mismatch");
		expect((settled as { reason: string }).reason).toContain("sha256:0");
		expect((settled as { reason: string }).reason).toContain(currentReviewContractHash());
		expect(kernel.coordinator.active(TASK)).toBeNull();
		expect(reviewsOf(kernel)).toHaveLength(0);
	});
});

// --- AC4: tree guard -------------------------------------------------------

describe("review tree guard", () => {
	const gitIn = (root: string, argv: string[]) =>
		execFileSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.com", ...argv], { cwd: root, encoding: "utf8" });

	test.each([
		["edits a tracked file", (root: string) => writeFileSync(join(root, "src.ts"), "export const value = 2;\n")],
		["creates a commit", (root: string) => { writeFileSync(join(root, "src.ts"), "export const value = 2;\n"); gitIn(root, ["commit", "-qam", "mutated"]); }],
		["stages a change", (root: string) => { writeFileSync(join(root, "src.ts"), "export const value = 2;\n"); gitIn(root, ["add", "src.ts"]); }],
	])("a round whose tree %s releases with the touched path", async (_label, mutate) => {
		const root = reviewRepo();
		const kernel = kernelFor(root);
		onPath(fakeReviewer("exit 0"));
		enterHerdr();
		const ready = await kernel.coordinator.advance(TASK, ctx(root));
		mutate(root);
		writeFileSync(reviewSessionOf(ready).output_path, JSON.stringify(passVerdict(kernel.snapshot)));

		const settled = await submitMediatedReview(kernel.coordinator, ctx(root), TASK, undefined, () => kernel.cli.inspectReview(TASK));
		expect(settled).toMatchObject({ state: "blocked" });
		expect((settled as { reason: string }).reason).toContain("review_tree_changed");
		expect((settled as { reason: string }).reason).toContain("src.ts");
		expect(kernel.coordinator.active(TASK)).toBeNull();
		expect(reviewsOf(kernel)).toHaveLength(0);
	});

	test("an untracked file alone settles normally", async () => {
		const root = reviewRepo();
		const kernel = kernelFor(root);
		onPath(fakeReviewer("exit 0"));
		enterHerdr();
		const ready = await kernel.coordinator.advance(TASK, ctx(root));
		writeFileSync(join(root, "reviewer-scratch.txt"), "untracked\n");
		writeFileSync(reviewSessionOf(ready).output_path, JSON.stringify(passVerdict(kernel.snapshot)));

		const settled = await submitMediatedReview(kernel.coordinator, ctx(root), TASK, undefined, () => kernel.cli.inspectReview(TASK));
		expect(settled).toMatchObject({ state: "completed" });
		expect(reviewsOf(kernel)).toHaveLength(1);
	});
});

// --- AC5: a missing profile fails closed ----------------------------------

describe("review profile required", () => {
	test("a material task without review_host stops with one recovery action", async () => {
		const root = reviewRepo(null);
		const kernel = kernelFor(root);
		const ready = await kernel.coordinator.advance(TASK, ctx(root));
		expect(ready).toMatchObject({ state: "review_preparation_failed", code: "review_profile_required" });
		const recovery = (ready as { recovery_action: string }).recovery_action;
		expect(recovery).toContain("agents.profiles");
		expect(recovery).not.toContain("lanes.review_host");
		expect(kernel.applied.filter((entry) => entry.role === "qa")).toHaveLength(1);
		expect(reviewsOf(kernel)).toHaveLength(0);
	});

	test("a configured review_host without its executable fails closed", async () => {
		const root = reviewRepo("claude-code");
		const kernel = kernelFor(root);
		// The reviewer binary must be absent from PATH; the layered config still needs git.
		const bin = scratchDir("bin-no-claude");
		const gitBinary = ROOT_PATH.split(delimiter).map((dir) => join(dir || ".", "git")).find((path) => existsSync(path));
		if (!gitBinary) throw new Error("git is not on PATH");
		symlinkSync(gitBinary, join(bin, "git"));
		process.env.PATH = bin;
		const ready = await kernel.coordinator.advance(TASK, ctx(root));
		expect(ready).toMatchObject({ state: "review_preparation_failed", code: "review_host_unavailable" });
		const recovery = (ready as { recovery_action: string }).recovery_action;
		expect(recovery).toContain("agents.profiles");
		expect(recovery).not.toContain("lanes.review_host");
		expect(kernel.applied.filter((entry) => entry.role === "qa")).toHaveLength(1);
	});

	test("a routine task completes after QA without a profile", async () => {
		const root = reviewRepo(null);
		const kernel = kernelFor(root, { risk: "routine" });
		expect(await kernel.coordinator.advance(TASK, ctx(root))).toMatchObject({ state: "completed" });
		expect(kernel.applied.map((entry) => entry.role)).toEqual(["qa"]);
	});
});

// --- review-config-invalid: an invalid `agents` table ----------------------

const userConfigPath = () => join(process.env.XDG_CONFIG_HOME!, "immune-brain", "config.json");
/** The S1-AC3 table shape, with one code-review host the user got wrong. */
const invalidAgents = { profiles: { review: { host: "codex" } }, presets: { default: { roles: { "*": "review" } } } };
const validAgents = { profiles: { review: { host: "pi" } }, presets: { default: { roles: { "*": "review" } } } };

describe("invalid agents configuration", () => {
	test("an invalid user agents table names the file and key path instead of review_profile_required (RCI-A1)", async () => {
		const root = reviewRepo(null);
		const kernel = kernelFor(root);
		const cleanup = homeAgents(invalidAgents);
		try {
			const ready = await kernel.coordinator.advance(TASK, ctx(root));
			expect(ready).toMatchObject({ state: "review_preparation_failed", code: "review_config_invalid" });
			const failure = ready as { reason: string; recovery_action: string };
			expect(failure.reason).toContain(userConfigPath());
			expect(failure.reason).toContain("agents.profiles.review.host");
			expect(failure.recovery_action).toContain("agents.profiles.review.host");
			expect(failure.recovery_action).toContain("advance_assurance");
			// QA stays earned: the same revision resumes once the table is fixed.
			expect(kernel.applied.filter((entry) => entry.role === "qa")).toHaveLength(1);
			expect(reviewsOf(kernel)).toHaveLength(0);
		} finally { cleanup(); }
	});

	test("the same table with a valid host reaches review_ready without warnings (RCI-A1 control)", async () => {
		const root = reviewRepo(null);
		const kernel = kernelFor(root);
		onPath(fakeReviewer("exit 0"));
		enterHerdr();
		const cleanup = homeAgents(validAgents);
		try {
			const ready = await kernel.coordinator.advance(TASK, ctx(root));
			expect(ready).toMatchObject({ state: "review_ready", review_profile: { host: "pi" } });
			expect(ready).not.toHaveProperty("warnings");
		} finally { cleanup(); }
	});

	test("the legacy lanes profile still reviews, and review_ready says why (RCI-A2)", async () => {
		const root = reviewRepo("pi");
		const kernel = kernelFor(root);
		onPath(fakeReviewer("exit 0"));
		enterHerdr();
		const cleanup = homeAgents(invalidAgents);
		try {
			const ready = await kernel.coordinator.advance(TASK, ctx(root));
			expect(ready).toMatchObject({ state: "review_ready", review_profile: { host: "pi" } });
			const warnings = (ready as { warnings: Array<{ code: string; paths: string[]; message: string }> }).warnings;
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toMatchObject({ code: "review_legacy_profile", paths: [userConfigPath()] });
			expect(warnings[0]!.message).toContain("lanes");
			expect(warnings[0]!.message).toContain("agents");
		} finally { cleanup(); }
	});

	test("a legacy-only config reviews without a warning (RCI-A2 control)", async () => {
		const root = reviewRepo("pi");
		const kernel = kernelFor(root);
		const ready = await kernel.coordinator.advance(TASK, ctx(root));
		expect(ready).toMatchObject({ state: "review_ready", review_profile: { host: "pi" } });
		expect(ready).not.toHaveProperty("warnings");
	});
});

// --- AC7: findings verification runs as its own session --------------------

describe("verification CLI stage", () => {
	async function reworkToVerification(root: string) {
		const kernel = kernelFor(root, { revision: true, verifier: true });
		onPath(fakeReviewer("exit 0"));
		enterHerdr();
		const ready = await kernel.coordinator.advance(TASK, ctx(root));
		const review = reviewSessionOf(ready);
		writeFileSync(review.output_path, JSON.stringify(reworkVerdict(kernel.snapshot)));
		const pending = await submitMediatedReview(kernel.coordinator, ctx(root), TASK, undefined, () => kernel.cli.inspectReview(TASK));
		return { kernel, review, pending: pending as { state: string; verification_session?: ReviewSessionSpec } };
	}

	test("a verification after a CLI Review runs as one explicit session whose receipt is the bound bytes", async () => {
		const root = reviewRepo();
		const { kernel, review, pending } = await reworkToVerification(root);
		expect(pending.state).toBe("verification_ready");
		const session = pending.verification_session!;
		expect(session.create_command).toMatch(/'create' '--provider' 'herdr' '--cwd' '\S+' '--label' 'verify cli-review-task' '--host' 'pi' '--entry'/);
		expect(session.output_path).not.toBe(review.output_path);
		expect((pending as { verification_command?: string }).verification_command).toBeUndefined();
		expect(kernel.calls.prepareVerification).toBe(0);
		// Still running: the reservation is kept and nothing is applied.
		expect(await kernel.coordinator.submitVerification(TASK, ctx(root))).toMatchObject({ state: "blocked", reason: "verification result pending" });

		writeFileSync(session.output_path, verificationJsonFor(session));
		const settled = await kernel.coordinator.submitVerification(TASK, ctx(root));
		expect(settled.state).toBe("rework");
		const reviewRound = reviewsOf(kernel).at(-1)!;
		expect(reviewRound.decision).toBe("rework");
		expect(reviewRound.verification).toMatchObject({
			verifier_actor: expect.stringMatching(/^cli-verifier:pi:/), result_sha256: expect.stringMatching(/^sha256:/), model_relation: "same",
		});
		expect(reviewRound.verification).not.toHaveProperty("failure");
		expect(kernel.calls.inspectVerification).toBe(0);
		// A consumed verification releases its session directory with the receipt.
		expect(existsSync(dirname(session.output_path))).toBe(false);
	});

	test("a verifier output that is not the JSON contract keeps every finding and never weakens Review", async () => {
		const root = reviewRepo();
		const { kernel, pending } = await reworkToVerification(root);
		writeFileSync(pending.verification_session!.output_path, "not json\n");
		expect((await kernel.coordinator.submitVerification(TASK, ctx(root))).state).toBe("rework");
		expect(reviewsOf(kernel).at(-1)!.verification).toMatchObject({ failure: "dispatch_failed", verifier_actor: null, result_sha256: null });
	});

	test("a verifier session that stopped without writing its receipt keeps every finding instead of reading as pending", async () => {
		const root = reviewRepo();
		const { kernel, pending } = await reworkToVerification(root);
		const session = pending.verification_session!;
		// The Parent's await recorded that the session ended; no output file exists.
		writeFileSync(join(dirname(session.output_path), "session-await.json"), JSON.stringify({ ok: true, transition: "exited" }));
		expect((await kernel.coordinator.submitVerification(TASK, ctx(root))).state).toBe("rework");
		expect(reviewsOf(kernel).at(-1)!.verification).toMatchObject({ failure: "dispatch_failed", verifier_actor: null });
	});

	test("agents roles: the Review profile and the verifier model come from the resolved roles (S1-AC3)", async () => {
		const root = reviewRepo(null);
		const cleanup = homeAgents({
			profiles: { review: { host: "pi", model: "agent-reviewer-m" }, verify: { host: "pi", model: "agent-verifier-m" }, other: { host: "pi" } },
			presets: { default: { roles: { "*": "other", "code-review": "review", "review-verifier": "verify" } } },
		});
		try {
			const { kernel, pending } = await reworkToVerification(root);
			const session = pending.verification_session!;
			expect(session.create_command).toContain("'--model' 'agent-verifier-m'");
			writeFileSync(session.output_path, verificationJsonFor(session));
			await kernel.coordinator.submitVerification(TASK, ctx(root));
			expect(reviewsOf(kernel).at(-1)!.verification).toMatchObject({ reviewer_model: "agent-reviewer-m", verifier_model: "agent-verifier-m", model_relation: "different" });
		} finally { cleanup(); }
	});

	test("a configured verifier model is offered and used, so the verifier runs on a different model (#284 D1)", async () => {
		const root = reviewRepo("pi", { review_model: "reviewer-m", review_verifier_model: "verifier-m" });
		const { kernel, pending } = await reworkToVerification(root);
		const session = pending.verification_session!;
		// The model reaches the session's Host arguments; the sentinel never does.
		expect(session.create_command).toContain("'--model' 'verifier-m'");
		writeFileSync(session.output_path, verificationJsonFor(session));
		await kernel.coordinator.submitVerification(TASK, ctx(root));
		expect(reviewsOf(kernel).at(-1)!.verification).toMatchObject({
			reviewer_model: "reviewer-m", verifier_model: "verifier-m", model_relation: "different",
			verifier_actor: expect.stringMatching(/^cli-verifier:/),
		});
	});

	test("outside Herdr a Verification preparation fails closed instead of falling back to a process", async () => {
		const root = reviewRepo();
		const kernel = kernelFor(root, { revision: true, verifier: true });
		onPath(fakeReviewer("exit 0"));
		enterHerdr();
		const ready = await kernel.coordinator.advance(TASK, ctx(root));
		writeFileSync(reviewSessionOf(ready).output_path, JSON.stringify(reworkVerdict(kernel.snapshot)));
		delete process.env.HERDR_ENV;

		// The stage itself refuses: no temp directory, no hidden `--print` process.
		expect(() => kernel.cli.prepareVerification({ taskId: TASK, operationId: "op-outside-herdr", prompt: "p", model: "m", writePacket: writeTestReviewPacket }))
			.toThrow(expect.objectContaining({ code: "review_transport_unavailable" }) as never);

		// So the round keeps every finding and approves nothing.
		const settled = await submitMediatedReview(kernel.coordinator, ctx(root), TASK, undefined, () => kernel.cli.inspectReview(TASK));
		expect(settled.state).toBe("rework");
		expect(reviewsOf(kernel)).toHaveLength(1);
		expect(reviewsOf(kernel).at(-1)!.verification).toMatchObject({ failure: "dispatch_failed", verifier_actor: null, result_sha256: null });
	});

	test("a verification that follows no CLI Review still goes to the wrapped Host", () => {
		const { host, calls } = wrappedHost(true);
		const cli = new CliReviewHost(host);
		const reservation = cli.prepareVerification({ taskId: "other", operationId: "op-1", prompt: "p", model: "m", writePacket: writeTestReviewPacket });
		expect(reservation.verification_command).toBeUndefined();
		expect(reservation.verification_session).toBeUndefined();
		expect(calls.prepareVerification).toBe(1);
		expect(cli.inspectVerification(reservation)).toMatchObject({ ok: false, release: true });
		expect(calls.inspectVerification).toBe(1);
	});
});

// --- S3 AC1/AC2: the composition root's default ----------------------------

/** The Claude composition root is where the dispatch default is read (D8). */
const ROOT_ENV = { CLAUDE_CODE_VERSION: "2.1.236", CLAUDE_CODE_PERMISSION_MODE: "manual", HERDR_ENV: "1", HERDR_WORKSPACE_ID: "w-parent" };

async function claudeAdvance(
	root: string,
	env: Record<string, string | undefined>,
	risk: Risk = "material",
): Promise<{ state: string; review_session?: ReviewSessionSpec; review_profile?: { host: string; model?: string }; agent_params?: unknown; code?: string; recovery_action?: string }> {
	const fixture = fixtureFor(root, { risk });
	const runtime = new ClaudeRuntime({ cwd: root, env, ports: fixture.ports, authorityOverrides: fixture.ports as never });
	return await runtime.advance(TASK) as never;
}

describe("default cli dispatch", () => {
	test("an unset environment reserves the project's CLI reviewer as one explicit session", async () => {
		const root = reviewRepo("pi", { review_model: "model-x" });
		onPath(fakeReviewer("exit 0"));
		const ready = await claudeAdvance(root, ROOT_ENV);

		expect(ready).toMatchObject({ state: "review_ready", review_profile: { host: "pi", model: "model-x" } });
		// One explicit session, not a dispatch list: the Parent creates, awaits and stops it.
		const session = reviewSessionOf(ready);
		expect(session.create_command).toContain("'--host' 'pi'");
		expect(session.create_command).toContain("'--model' 'model-x'");
		expect(session.create_command).toContain("authority-review");
		expect(session.await_command).toContain("'await'");
		expect(ready).not.toHaveProperty("review_command");
		expect(ready).not.toHaveProperty("agent_params");
	});
});

// --- S4 AC4: the CLI is the only authority Review path (D11) --------------

/**
 * The retired switch, spelled so no live source names it: S4 deletes it, and a
 * value an operator still has exported must not re-enable an Agent dispatch.
 */
const RETIRED_SWITCH = ["IMMUNE_BRAIN", "REVIEW", "DISPATCH"].join("_");

const piAdvance = async (root: string, env: Record<string, string | undefined>, risk: Risk = "material") => {
	const fixture = fixtureFor(root, { risk });
	const runtime = new PiRuntime({ cwd: root, env, ports: fixture.ports, authorityOverrides: fixture.ports as never });
	return await runtime.advance(TASK) as never;
};

const antigravityAdvance = async (root: string, env: Record<string, string | undefined>, risk: Risk = "material") => {
	const fixture = fixtureFor(root, { risk });
	const runtime = new AntigravityRuntime({ cwd: root, env, ports: fixture.ports, authorityOverrides: fixture.ports as never });
	return await runtime.advance(TASK) as never;
};

describe("cli only dispatch", () => {
	test("the retired switch value leaves the CLI dispatch and no Agent parameters on every composition root", async () => {
		const root = reviewRepo("pi", { review_model: "model-x" });
		onPath(fakeReviewer("exit 0"));
		const env = { ...ROOT_ENV, [RETIRED_SWITCH]: "subagent" };
		for (const ready of [await piAdvance(root, env), await claudeAdvance(root, env), await antigravityAdvance(root, env)]) {
			expect(ready).toMatchObject({ state: "review_ready", review_profile: { host: "pi", model: "model-x" } });
			expect(reviewSessionOf(ready).transport).toBe("herdr");
			expect(ready).not.toHaveProperty("agent_params");
		}
	});
});

describe("default profile required", () => {
	test("an unset environment without lanes.review_host stops with one recovery action", async () => {
		const root = reviewRepo(null);
		onPath(fakeReviewer("exit 0"));
		const ready = await claudeAdvance(root, ROOT_ENV);

		expect(ready).toMatchObject({ state: "review_preparation_failed", code: "review_profile_required" });
		expect(typeof ready.recovery_action).toBe("string");
		expect(ready.recovery_action).toContain("agents.profiles");
		expect(ready.recovery_action).not.toContain("lanes.review_host");
	});

	test("a routine task completes after QA without a profile", async () => {
		const root = reviewRepo(null);
		onPath(fakeReviewer("exit 0"));
		expect((await claudeAdvance(root, ROOT_ENV, "routine")).state).toBe("completed");
	});
});

// --- Spec explicit-port-review-session D1/D2/D3: the explicit session ------

describe("explicit review session", () => {
	test("outside Herdr any Review fails closed with one same-Host recovery action, after QA", async () => {
		const root = reviewRepo();
		const kernel = kernelFor(root);
		onPath(fakeReviewer("exit 0"));
		delete process.env.HERDR_ENV;
		const ready = await kernel.coordinator.advance(TASK, ctx(root));
		expect(ready).toMatchObject({ state: "review_preparation_failed", code: "review_transport_unavailable" });
		const recovery = (ready as { recovery_action: string }).recovery_action;
		expect(recovery).toContain("Herdr");
		// The retired process fallback is never offered again.
		expect(recovery).not.toContain("lanes.review_transport");
		expect(recovery).not.toContain("process");
		// QA stays earned: the round resumes from it once the Host is inside Herdr.
		expect(kernel.applied.filter((entry) => entry.role === "qa")).toHaveLength(1);
		expect(reviewsOf(kernel)).toHaveLength(0);
	});

	test("inside Herdr the reviewer runs as an explicit session whose out-of-tree JSON settles the Review", async () => {
		const root = reviewRepo("pi", { review_transport: "herdr" });
		const kernel = kernelFor(root);
		const verdict = passVerdict(kernel.snapshot);
		const state = enterHerdr();
		onPath([fakeReviewer("exit 0"), join(__dirname, "fixtures/fake-herdr")].join(":"));
		const ready = await kernel.coordinator.advance(TASK, ctx(root)) as { state: string; review_session?: ReviewSessionSpec; review_command?: string; review_profile?: { transport?: string } };

		expect(ready.state).toBe("review_ready");
		expect(ready).not.toHaveProperty("review_command");
		expect(ready.review_profile).toMatchObject({ host: "pi", transport: "herdr" });
		const session = ready.review_session!;
		expect(session.transport).toBe("herdr");
		expect(session.create_command).toMatch(/bin\/imm-session' 'create' '--provider' 'herdr' '--cwd' '\S+' '--label' 'review cli-review-task' '--host' 'pi' '--entry' /);
		// `await` copies its result beside the receipt, so a stopped session is told from a running one.
		expect(session.await_command).toMatch(/'await' '--provider' 'herdr' '<handle>' \| tee '\S+\/session-await\.json'$/);
		// A startup dialog holds the entry back; resume submits it in the same session, before the Host arguments.
		expect(session.resume_command).toBe(session.create_command.replace(" '--' ", " '--resume' '<handle>' '--' "));
		expect(session.stop_command).toMatch(/'stop' '--provider' 'herdr' '<handle>'$/);
		// The receipt channel is out of tree and is one JSON file.
		expect(session.output_path.endsWith(".json")).toBe(true);
		expect(session.output_path.startsWith(realpathSync(root))).toBe(false);

		// A session that has not written its file retains the reservation and names the wait.
		const pending = await submitMediatedReview(kernel.coordinator, ctx(root), TASK, undefined, () => kernel.cli.inspectReview(TASK));
		expect(pending).toMatchObject({ state: "blocked" });
		const recovery = (pending as { reason: string; recovery_action: string });
		for (const text of [recovery.reason, recovery.recovery_action]) {
			expect(text).toContain("await");
			expect(text).not.toContain("submit_review again");
		}

		const created = runSessionVerb(session.create_command);
		writeFileSync(session.output_path, `${JSON.stringify(verdict)}\n`);
		expect(runSessionVerb(session.await_command, String(created.handle))).toMatchObject({ ok: true });

		const settled = await submitMediatedReview(kernel.coordinator, ctx(root), TASK, undefined, () => kernel.cli.inspectReview(TASK));
		expect(settled).toMatchObject({ state: "completed" });
		expect(reviewsOf(kernel)).toHaveLength(1);
		expect(reviewsOf(kernel)[0]).toMatchObject({ decision: "pass", verdictSha256: digestOfReviewerBytes(`${JSON.stringify(verdict)}\n`) });
		const herdr = JSON.parse(readFileSync(state, "utf8"));
		expect(herdr.calls.map((call: string[]) => call.slice(0, 2).join(" "))).toContain("agent start");
		expect(herdr.calls.some((call: string[]) => call[0] === "pane" && call[1] === "run")).toBe(false);
	});

	test("a failed round keeps the session open and runs no stop", async () => {
		const root = reviewRepo("pi", { review_transport: "herdr" });
		const kernel = kernelFor(root);
		const state = enterHerdr();
		onPath([fakeReviewer("exit 0"), join(__dirname, "fixtures/fake-herdr")].join(":"));
		const ready = await kernel.coordinator.advance(TASK, ctx(root)) as { review_session?: ReviewSessionSpec };
		const session = ready.review_session!;
		writeFileSync(session.output_path, "not json\n");

		const settled = await submitMediatedReview(kernel.coordinator, ctx(root), TASK, undefined, () => kernel.cli.inspectReview(TASK));
		expect(settled).toMatchObject({ state: "blocked" });
		expect((settled as { reason: string }).reason).toContain("review_output_invalid");
		expect(settled).not.toHaveProperty("stop_command");
		expect(kernel.coordinator.active(TASK)).toBeNull();
		expect(reviewsOf(kernel)).toHaveLength(0);
		// Preparation launches nothing itself (BR-OUT-1), and a failed round runs no stop.
		expect(JSON.parse(readFileSync(state, "utf8")).calls ?? []).toEqual([]);
	});

	test("a review contract mismatch written to the session's file ends the round", async () => {
		const root = reviewRepo("pi", { review_transport: "herdr" });
		const kernel = kernelFor(root);
		const state = enterHerdr();
		onPath([fakeReviewer("exit 0"), join(__dirname, "fixtures/fake-herdr")].join(":"));
		const ready = await kernel.coordinator.advance(TASK, ctx(root)) as { review_session?: ReviewSessionSpec };
		const session = ready.review_session!;
		// The reviewer's own contract differs: the skill's answer is the file's whole content.
		writeFileSync(session.output_path, "REVIEW_CONTRACT_MISMATCH sha256:0\n");

		const settled = await submitMediatedReview(kernel.coordinator, ctx(root), TASK, undefined, () => kernel.cli.inspectReview(TASK));
		expect(settled).toMatchObject({ state: "blocked" });
		expect((settled as { reason: string }).reason).toContain("review_contract_mismatch");
		expect((settled as { reason: string }).reason).toContain(currentReviewContractHash());
		expect(kernel.coordinator.active(TASK)).toBeNull();
		expect(reviewsOf(kernel)).toHaveLength(0);
		expect(JSON.parse(readFileSync(state, "utf8")).calls ?? []).toEqual([]);
	});

	test("after a consumed receipt the Parent's stop closes the single round", async () => {
		const root = reviewRepo("pi", { review_transport: "herdr" });
		const kernel = kernelFor(root);
		const verdict = reworkVerdict(kernel.snapshot);
		const state = enterHerdr();
		onPath([fakeReviewer("exit 0"), join(__dirname, "fixtures/fake-herdr")].join(":"));
		const ready = await kernel.coordinator.advance(TASK, ctx(root)) as { review_session?: ReviewSessionSpec };
		const session = ready.review_session!;
		const created = runSessionVerb(session.create_command);
		writeFileSync(session.output_path, `${JSON.stringify(verdict)}\n`);
		runSessionVerb(session.await_command, String(created.handle));
		const consumed = await submitMediatedReview(kernel.coordinator, ctx(root), TASK, undefined, () => kernel.cli.inspectReview(TASK));
		// The consumed result itself names the stop, so the Parent need not carry it from review_ready.
		expect(consumed).toMatchObject({ state: "rework", stop_command: session.stop_command });
		expect(runSessionVerb(consumed.stop_command!, String(created.handle))).toMatchObject({ ok: true });
		const panes = Object.values(JSON.parse(readFileSync(state, "utf8")).panes) as Array<{ closed: boolean }>;
		expect(panes.every((pane) => pane.closed)).toBe(true);
	});

	test("a session that stopped without writing its receipt ends the round instead of reading as still running", async () => {
		const root = reviewRepo("pi", { review_transport: "herdr" });
		const kernel = kernelFor(root);
		const state = enterHerdr();
		onPath([fakeReviewer("exit 0"), join(__dirname, "fixtures/fake-herdr")].join(":"));
		const ready = await kernel.coordinator.advance(TASK, ctx(root)) as { review_session?: ReviewSessionSpec };
		const session = ready.review_session!;
		const created = runSessionVerb(session.create_command);
		// The agent goes idle without writing output_path; the Parent's await returns.
		expect(runSessionVerb(session.await_command, String(created.handle))).toMatchObject({ ok: true, transition: "changed" });

		const settled = await submitMediatedReview(kernel.coordinator, ctx(root), TASK, undefined, () => kernel.cli.inspectReview(TASK));
		expect(settled).toMatchObject({ state: "blocked" });
		expect((settled as { reason: string }).reason).toContain("review_session_aborted");
		expect((settled as { reason: string }).reason).not.toContain("still running");
		expect(settled).not.toHaveProperty("stop_command");
		// The reservation is released, so the next advance prepares a fresh round; the tab is left open.
		expect(kernel.coordinator.active(TASK)).toBeNull();
		expect(reviewsOf(kernel)).toHaveLength(0);
		const panes = Object.values(JSON.parse(readFileSync(state, "utf8")).panes) as Array<{ closed: boolean }>;
		expect(panes.some((pane) => !pane.closed)).toBe(true);
	});

	test("a session blocked on a dialog keeps the round open and points at the user instead of aborting", async () => {
		const root = reviewRepo("pi", { review_transport: "herdr" });
		const kernel = kernelFor(root);
		enterHerdr();
		onPath([fakeReviewer("exit 0"), join(__dirname, "fixtures/fake-herdr")].join(":"));
		const ready = await kernel.coordinator.advance(TASK, ctx(root)) as { review_session?: ReviewSessionSpec };
		const session = ready.review_session!;
		// A startup dialog (workspace trust) ends the await with `changed` to `blocked`.
		writeFileSync(join(dirname(session.output_path), "session-await.json"), JSON.stringify({ ok: true, transition: "changed", state: "blocked" }));

		const pending = await submitMediatedReview(kernel.coordinator, ctx(root), TASK, undefined, () => kernel.cli.inspectReview(TASK));
		expect((pending as { reason: string }).reason).toContain("blocked on a dialog");
		expect((pending as { reason: string }).reason).not.toContain("review_session_aborted");
		expect(kernel.coordinator.active(TASK)).not.toBeNull();
	});

	test("outside Herdr the transport is refused before the reviewer executable is looked up", async () => {
		const root = reviewRepo();
		const kernel = kernelFor(root);
		onPath(scratchDir("empty-path"));
		delete process.env.HERDR_ENV;
		const ready = await kernel.coordinator.advance(TASK, ctx(root));
		expect(ready).toMatchObject({ state: "review_preparation_failed", code: "review_transport_unavailable" });
		expect((ready as { recovery_action: string }).recovery_action).toContain("Herdr");
	});

});

// --- Spec D1/D3: the session's Host arguments and profile -------------------

describe("explicit session launch arguments", () => {
	const output = "/tmp/imm-cli-review-x/review-output-op-1.json";

	test("claude-code keeps the read-only reviewer boundary and allows one write: the reservation's out-of-tree file", () => {
		const argv = sessionHostArguments({ host: "claude-code", model: "m", effort: "high" }, { outputPath: output, readDirs: ["/tmp/imm-cli-review-x"] });
		// Hooks off, so no user rewrite (`rtk git ...`) escapes the git allowlist (#426 F11).
		expect(argv[argv.indexOf("--settings") + 1]).toBe(CLAUDE_REVIEW_SETTINGS);
		expect(JSON.parse(CLAUDE_REVIEW_SETTINGS)).toMatchObject({ disableAllHooks: true });
		expect(argv[argv.indexOf("--tools") + 1]).toBe("Read,Grep,Glob,Bash,Write");
		expect(argv[argv.indexOf("--permission-mode") + 1]).toBe("dontAsk");
		// Variadic allowlist: the git rules, then the single write rule, then the next flag.
		const allowed = argv.slice(argv.indexOf("--allowedTools") + 1, argv.indexOf("--permission-mode"));
		// Claude Code governs Write through Edit rules, and an absolute path takes a leading `//`.
		expect(allowed).toEqual([...REVIEW_GIT_ALLOWED_TOOLS, `Edit(/${output})`]);
		expect(allowed.filter((rule) => !rule.startsWith("Bash(git "))).toEqual([`Edit(//tmp/imm-cli-review-x/review-output-op-1.json)`]);
		expect(argv.slice(argv.indexOf("--add-dir") + 1, argv.indexOf("--add-dir") + 2)).toEqual(["/tmp/imm-cli-review-x"]);
		expect(argv[argv.indexOf("--model") + 1]).toBe("m");
		expect(argv[argv.indexOf("--effort") + 1]).toBe("high");
		expect(argv).not.toContain("--print");
	});

	test("pi runs its read-only tools plus write, and antigravity carries only the profile's model and effort", () => {
		expect(sessionHostArguments({ host: "pi", model: "m", effort: "high" }, { outputPath: output }))
			.toEqual(["--tools", "read,grep,find,ls,bash,write", "--model", "m", "--thinking", "high"]);
		expect(sessionHostArguments({ host: "antigravity", model: "m", effort: "high" }, { outputPath: output }))
			.toEqual(["--model", "m", "--effort", "high"]);
		expect(sessionHostArguments({ host: "pi" }, { outputPath: output, model: "verifier-m" }))
			.toEqual(["--tools", "read,grep,find,ls,bash,write", "--model", "verifier-m"]);
		// A host with no configured model keeps its own default; the sentinel is never a model flag.
		expect(sessionHostArguments({ host: "pi" }, { outputPath: output, model: "host-default" })).toEqual(["--tools", "read,grep,find,ls,bash,write"]);
		expect(sessionHostArguments({ host: "claude-code" }, { outputPath: output, model: "host-default" })).not.toContain("--model");
	});

	test("the layered transport reaches the profile, and a Lane batch keeps it", () => {
		expect(resolveReviewProfile(reviewRepo("pi", { review_transport: "herdr" }))).toMatchObject({ host: "pi", transport: "herdr" });
		expect(resolveReviewProfile(reviewRepo("pi"))).toMatchObject({ host: "pi", transport: "herdr" });
		const { lane } = laneBatch({ review_profile: { host: "pi", model: "model-x" }, lanes: { review_transport: "herdr" } });
		expect(resolveReviewProfile(lane)).toEqual({ host: "pi", model: "model-x", transport: "herdr" });
		// A batch carries no transport of its own, so no recorded batch can select the retired process.
		expect(resolveReviewProfile(laneBatch({ review_profile: { host: "pi" } }).lane)).toEqual({ host: "pi", transport: "herdr" });
		expect(() => parseBatchReviewProfile({ host: "pi", transport: "process" })).toThrow("invalid review_profile");
	});
});

// --- #426 F14: a Lane Review runs on its batch's recorded profile ----------

const F14_TIME = "2026-11-12T00:00:00.000Z";

/** A coordinator repo whose config names antigravity, one Lane, and a lane batch bound to it. */
function laneBatch(options: { state?: string; review_profile?: { host: "pi" | "claude-code" | "antigravity"; model?: string }; batchId?: string; lane?: string; lanes?: Record<string, string> } = {}) {
	const root = options.lane ? dirname(dirname(dirname(dirname(dirname(options.lane))))) : realpathSync(reviewRepo("antigravity", { review_model: "config-model", ...options.lanes }));
	const head = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
	const lane = options.lane ?? createLaneWorktree(root, "f14", TASK, head);
	const child = { task_id: TASK, slice_id: "S1", status: "enrollable" as const, reason: null, blocked_by: [],
		intent_path: `docs/plans/${TASK}.intent.json`, intent_revision: 1, intent_content_hash: `sha256:${"0".repeat(64)}` };
	const record = prepareBatchLaneRunState({ batch_id: options.batchId ?? "f14-batch", initiative_slug: "f14", children: [child],
		plan_digest: `sha256:${"1".repeat(64)}`, base_head: head, confirmation_time: F14_TIME, now: F14_TIME,
		budget: { max_children: 1, qa_failure_limit: 2 }, max_parallel: 1,
		...(options.review_profile ? { review_profile: options.review_profile } : {}) });
	record.batch_state = "running" as never;
	record.children = [{ ...record.children[0]!, state: (options.state ?? "enrolled") as never,
		reason: options.state === "needs_human" ? "parked" : null,
		lane: { path: lane, branch: `imm-lane/f14/${TASK}`, base_head: head, lane_commit: null } }];
	writeBatchLaneRunState(root, record);
	return { root, lane };
}

describe("#426 F14 batch review profile", () => {
	test("a Lane Review runs on the profile its batch recorded, not the layered config", async () => {
		const { lane } = laneBatch({ review_profile: { host: "pi", model: "model-x" } });
		onPath(fakeReviewer("exit 0"));
		const ready = await claudeAdvance(lane, ROOT_ENV);
		expect(ready).toMatchObject({ state: "review_ready", review_profile: { host: "pi", model: "model-x" } });
	});

	test("without a recorded profile, or once the child left the Lane, the layered config applies", () => {
		expect(laneBatchReviewProfile(laneBatch().lane)).toBeUndefined();
		expect(laneBatchReviewProfile(laneBatch({ state: "needs_human", review_profile: { host: "pi" } }).lane)).toBeUndefined();
	});

	test("a checkout that is not a runtime-owned Lane reads no batch profile", () => {
		const { root } = laneBatch({ review_profile: { host: "pi" } });
		expect(laneBatchReviewProfile(root)).toBeUndefined();
	});

	test("two in-flight batches with different profiles on one Lane fail closed", () => {
		const { lane } = laneBatch({ review_profile: { host: "pi" } });
		laneBatch({ lane, batchId: "f14-other", review_profile: { host: "claude-code", model: "m" } });
		expect(() => laneBatchReviewProfile(lane)).toThrow("review_profile_ambiguous");
	});

	test("start arguments map to one profile and refuse a model without a host", () => {
		expect(reviewProfileFromArgs({})).toBeUndefined();
		expect(reviewProfileFromArgs({ review_host: "claude-code", review_model: "sonnet", review_effort: "low" }))
			.toEqual({ host: "claude-code", model: "sonnet", effort: "low" });
		expect(() => reviewProfileFromArgs({ review_model: "sonnet" })).toThrow("require review_host");
		expect(() => reviewProfileFromArgs({ review_host: "codex" })).toThrow("invalid review_profile");
	});
});
