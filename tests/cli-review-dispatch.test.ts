import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
	AssuranceCoordinator,
	snapshotDigest,
	type AssuranceCoordinatorPorts,
	type AssuranceVerdict,
	type HostContext,
	type SnapshotDescriptor,
} from "../plugins/immune-brain/runtime/assurance/coordinator";
import { CliReviewHost, reviewArguments } from "../plugins/immune-brain/runtime/assurance/cli_review";
import type { AssuranceHostPort, HostReviewReservation, ReviewRequest, VerificationRequest } from "../plugins/immune-brain/runtime/assurance/host_port";
import { submitMediatedReview } from "../plugins/immune-brain/runtime/assurance/review_mediation";
import { digestOfReviewerBytes } from "../plugins/immune-brain/runtime/assurance/review_mediation";
import type { ReviewBundle } from "../plugins/immune-brain/runtime/assurance/review_evidence";
import type { VerdictAuthority } from "../plugins/immune-brain/runtime/assurance/verdict_authority";
import { currentReviewContractHash } from "../plugins/immune-brain/runtime/role_prompt_bridge";
import { writeTestReviewPacket } from "./helpers/review-packet-fixture";

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
function reviewRepo(reviewHost: "pi" | "claude-code" | "antigravity" | null = "pi"): string {
	const root = scratchDir("repo");
	execFileSync("git", ["init", "-q"], { cwd: root });
	execFileSync("git", ["config", "user.name", "test"], { cwd: root });
	execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
	mkdirSync(join(root, ".imm"), { recursive: true });
	writeFileSync(join(root, ".imm/config.json"), `${JSON.stringify({
		contract: "immune_brain/project_config/v1",
		...(reviewHost ? { lanes: { review_host: reviewHost } } : {}),
	})}\n`);
	writeFileSync(join(root, "src.ts"), "export const value = 1;\n");
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
	return root;
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

function heredoc(text: string): string {
	return `cat <<'IMM_VERDICT'\n${text}\nIMM_VERDICT`;
}

function reviewReadyCommand(result: { state: string; review_command?: string }): string {
	if (result.state !== "review_ready" || !result.review_command) throw new Error(`expected a CLI review_ready, got ${result.state}`);
	return result.review_command;
}

function reviewScriptPath(command: string): string {
	expect(command.startsWith("sh ")).toBe(true);
	return command.slice(3);
}

function packetPathOf(command: string): string {
	const script = readFileSync(reviewScriptPath(command), "utf8");
	const match = /authority-review ([^']*\/packet\.md)/.exec(script);
	if (!match) throw new Error("the review script names no packet");
	return match[1];
}

function runReview(command: string): void {
	spawnSync("sh", [reviewScriptPath(command)], { encoding: "utf8" });
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
}

interface WrappedCalls {
	prepareReview: number;
	prepareVerification: number;
	inspectVerification: number;
	released: number;
}

/** The wrapped Host: only findings verification may reach it under the CLI switch (BR-DEC-4). */
function wrappedHost(verifier: boolean): { host: AssuranceHostPort; calls: WrappedCalls } {
	const calls: WrappedCalls = { prepareReview: 0, prepareVerification: 0, inspectVerification: 0, released: 0 };
	const host: AssuranceHostPort = {
		host: "pi",
		prepareReview: () => {
			calls.prepareReview += 1;
			throw new Error("the in-process Review path must not run under the CLI switch");
		},
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

function kernelFor(root: string, options: { risk?: Risk; revision?: boolean; verifier?: boolean } = {}): Kernel {
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
				...(input.reviewer_verdict_sha256 ? { verdictSha256: input.reviewer_verdict_sha256 } : {}) });
			obligation = input.snapshot.role === "qa"
				? risk === "routine" ? "complete" : "run_review"
				: input.verdict.decision === "rework" ? "run_qa" : "complete";
		},
		applyOrdinaryOperation: async (_ctx: HostContext, input: { operation: { op: string } }) => {
			if (input.operation.op === "complete") { lifecycle = "done"; obligation = "none"; }
		},
		ensureReviewRevision: async () => current("review").review_revision!,
	} as AssuranceCoordinatorPorts;
	const coordinator = new AssuranceCoordinator(ports, ports as unknown as Partial<VerdictAuthority>);
	return { coordinator, cli, applied, calls, snapshot: current("review") };
}

function reviewsOf(kernel: Kernel): Applied[] {
	return kernel.applied.filter((entry) => entry.role === "review");
}

// --- AC1: reviewer argv ----------------------------------------------------

describe("review arguments", () => {
	const packet = "/tmp/imm-cli-review/packet.md";

	test("claude-code runs one fresh, read-only print session on the skill", () => {
		const argv = reviewArguments({ host: "claude-code", model: "m", effort: "high" }, packet, 12);
		expect(argv).toContain("--print");
		expect(argv).toContain("--no-session-persistence");
		expect(argv[argv.indexOf("--max-turns") + 1]).toBe("12");
		expect(argv[argv.indexOf("--tools") + 1]).toBe("Read,Grep,Glob,Bash");
		expect(argv[argv.indexOf("--permission-mode") + 1]).toBe("dontAsk");
		expect(argv[argv.indexOf("--model") + 1]).toBe("m");
		expect(argv[argv.indexOf("--effort") + 1]).toBe("high");
		expect(argv.at(-1)).toBe(`/immune-brain:authority-review ${packet}`);
		expect(argv[argv.indexOf("--tools") + 1]).not.toMatch(/Edit|Write/);
	});

	test("pi equals the documented fresh print session", () => {
		expect(reviewArguments({ host: "pi", model: "m", effort: "high" }, packet, 12)).toEqual([
			"--print", "--no-session", "--model", "m", "--thinking", "high", `/skill:authority-review ${packet}`,
		]);
		const argv = reviewArguments({ host: "pi", model: "m", effort: "high" }, packet, 12);
		for (const flag of ["--tools", "--no-extensions", "--no-skills", "--no-mcp"]) expect(argv).not.toContain(flag);
	});

	test("antigravity runs a print session and invokes the same skill", () => {
		const argv = reviewArguments({ host: "antigravity", model: "m", effort: "high" }, packet, 12);
		expect(argv).toContain("--print");
		expect(argv).toContain("--model");
		expect(argv.at(-1)).toBe(`/authority-review ${packet}`);
	});

	test("no Host carries a drive entry or a plugin dir", () => {
		for (const host of ["claude-code", "pi", "antigravity"] as const) {
			const argv = reviewArguments({ host, model: "m", effort: "high" }, packet, 12);
			for (const arg of argv) {
				expect(arg).not.toContain("drive");
				expect(arg).not.toContain("--plugin-dir");
			}
		}
	});

	test("a profile without model or effort omits those flags", () => {
		for (const host of ["claude-code", "pi", "antigravity"] as const) {
			const argv = reviewArguments({ host }, packet, 7);
			expect(argv).not.toContain("--model");
			expect(argv).not.toContain("--effort");
			expect(argv).not.toContain("--thinking");
		}
	});
});

// --- AC3: settlement and process failures ---------------------------------

describe("cli review settlement", () => {
	test("a pass verdict settles through the reviewer output bytes", async () => {
		const root = reviewRepo();
		const kernel = kernelFor(root);
		const verdict = passVerdict(kernel.snapshot);
		const bytes = `${JSON.stringify(verdict)}\n`;
		onPath(fakeReviewer(heredoc(JSON.stringify(verdict))));
		const ready = await kernel.coordinator.advance(TASK, ctx(root));
		const command = reviewReadyCommand(ready as { state: string; review_command?: string });

		expect(readFileSync(packetPathOf(command), "utf8")).toContain(`review_contract_hash: ${currentReviewContractHash()}`);
		runReview(command);

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
		onPath(fakeReviewer(heredoc(JSON.stringify(verdict))));
		const ready = await kernel.coordinator.advance(TASK, ctx(root));
		const command = reviewReadyCommand(ready as { state: string; review_command?: string });
		runReview(command);

		const settled = await submitMediatedReview(kernel.coordinator, ctx(root), TASK, undefined, () => kernel.cli.inspectReview(TASK));
		expect(settled.state).toBe("rework");
		expect(reviewsOf(kernel)).toHaveLength(1);
		expect(reviewsOf(kernel)[0].decision).toBe("rework");
	});

	test("a relayed verdict that differs from the output keeps the reservation", async () => {
		const root = reviewRepo();
		const kernel = kernelFor(root);
		const printed = passVerdict(kernel.snapshot);
		const relayed = reworkVerdict(kernel.snapshot);
		onPath(fakeReviewer(heredoc(JSON.stringify(printed))));
		const ready = await kernel.coordinator.advance(TASK, ctx(root));
		runReview(reviewReadyCommand(ready as { state: string; review_command?: string }));

		const settled = await submitMediatedReview(kernel.coordinator, ctx(root), TASK, relayed, () => kernel.cli.inspectReview(TASK));
		expect(settled).toMatchObject({ state: "blocked", reason: "parent verdict does not match reviewer receipt" });
		expect(kernel.coordinator.active(TASK)).toMatchObject({ state: "review_ready" });
		expect(reviewsOf(kernel)).toHaveLength(0);
	});

	test("submitting before the process exits keeps the reservation and records no round", async () => {
		const root = reviewRepo();
		const kernel = kernelFor(root);
		const verdict = passVerdict(kernel.snapshot);
		onPath(fakeReviewer(heredoc(JSON.stringify(verdict))));
		await kernel.coordinator.advance(TASK, ctx(root));

		const settled = await submitMediatedReview(kernel.coordinator, ctx(root), TASK, undefined, () => kernel.cli.inspectReview(TASK));
		expect(settled).toMatchObject({ state: "blocked" });
		expect((settled as { reason: string }).reason).toContain("still running");
		expect(kernel.coordinator.active(TASK)).toMatchObject({ state: "review_ready" });
		expect(reviewsOf(kernel)).toHaveLength(0);
	});

	test.each([
		["a non-zero exit", "exit 3", "review_process_failed"],
		["empty output", "exit 0", "review_process_failed"],
		["a contract mismatch line", `printf '%s\\n' 'REVIEW_CONTRACT_MISMATCH sha256:0'`, "review_contract_mismatch"],
		["output that is not a verdict", "printf '%s\\n' 'not json'", "reviewer receipt is not a valid verdict"],
	])("%s releases without a Review round", async (_label, body, reason) => {
		const root = reviewRepo();
		const kernel = kernelFor(root);
		onPath(fakeReviewer(body));
		const ready = await kernel.coordinator.advance(TASK, ctx(root));
		runReview(reviewReadyCommand(ready as { state: string; review_command?: string }));

		const settled = await submitMediatedReview(kernel.coordinator, ctx(root), TASK, undefined, () => kernel.cli.inspectReview(TASK));
		expect(settled).toMatchObject({ state: "blocked" });
		expect((settled as { reason: string }).reason).toContain(reason);
		if (reason === "review_contract_mismatch") {
			expect((settled as { reason: string }).reason).toContain("sha256:0");
			expect((settled as { reason: string }).reason).toContain(currentReviewContractHash());
		}
		expect(kernel.coordinator.active(TASK)).toBeNull();
		expect(reviewsOf(kernel)).toHaveLength(0);
	});
});

// --- AC4: tree guard -------------------------------------------------------

describe("review tree guard", () => {
	const verdictBody = (s: SnapshotDescriptor) => heredoc(JSON.stringify(passVerdict(s)));

	test.each([
		["editing a tracked file", "src.ts", (body: string) => `printf '%s\\n' 'mutated' >> src.ts\n${body}`],
		["creating a commit", "src.ts", (body: string) => `printf '%s\\n' 'mutated' >> src.ts\ngit commit -qam mutated\n${body}`],
		["staging a change", "src.ts", (body: string) => `printf '%s\\n' 'mutated' >> src.ts\ngit add src.ts\n${body}`],
	])("the reviewer %s releases with the touched path", async (_label, path, script) => {
		const root = reviewRepo();
		const kernel = kernelFor(root);
		onPath(fakeReviewer(script(verdictBody(kernel.snapshot))));
		const ready = await kernel.coordinator.advance(TASK, ctx(root));
		runReview(reviewReadyCommand(ready as { state: string; review_command?: string }));

		const settled = await submitMediatedReview(kernel.coordinator, ctx(root), TASK, undefined, () => kernel.cli.inspectReview(TASK));
		expect(settled).toMatchObject({ state: "blocked" });
		expect((settled as { reason: string }).reason).toContain("review_tree_changed");
		expect((settled as { reason: string }).reason).toContain(path);
		expect(kernel.coordinator.active(TASK)).toBeNull();
		expect(reviewsOf(kernel)).toHaveLength(0);
	});

	test("an untracked file alone settles normally", async () => {
		const root = reviewRepo();
		const kernel = kernelFor(root);
		onPath(fakeReviewer(`printf '%s\\n' 'untracked' > reviewer-scratch.txt\n${verdictBody(kernel.snapshot)}`));
		const ready = await kernel.coordinator.advance(TASK, ctx(root));
		runReview(reviewReadyCommand(ready as { state: string; review_command?: string }));

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
		expect((ready as { recovery_action: string }).recovery_action).toContain("lanes.review_host");
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
		expect(kernel.applied.filter((entry) => entry.role === "qa")).toHaveLength(1);
	});

	test("a routine task completes after QA without a profile", async () => {
		const root = reviewRepo(null);
		const kernel = kernelFor(root, { risk: "routine" });
		expect(await kernel.coordinator.advance(TASK, ctx(root))).toMatchObject({ state: "completed" });
		expect(kernel.applied.map((entry) => entry.role)).toEqual(["qa"]);
	});
});

// --- AC7: findings verification stays on the wrapped Host ------------------

describe("verifier stays on host", () => {
	test("verification_ready returns the wrapped Host's dispatch and submission reads its receipt", async () => {
		const root = reviewRepo();
		const kernel = kernelFor(root, { revision: true, verifier: true });
		const verdict = reworkVerdict(kernel.snapshot);
		onPath(fakeReviewer(heredoc(JSON.stringify(verdict))));
		const before = readdirSync(tmpdir()).filter((name) => name.startsWith("imm-cli-review-"));
		const ready = await kernel.coordinator.advance(TASK, ctx(root));
		runReview(reviewReadyCommand(ready as { state: string; review_command?: string }));

		const pending = await submitMediatedReview(kernel.coordinator, ctx(root), TASK, undefined, () => kernel.cli.inspectReview(TASK));
		expect(pending.state).toBe("verification_ready");
		expect((pending as { agent_params: { prompt: string } }).agent_params.prompt).toStartWith("verifier:");
		expect(kernel.calls.prepareVerification).toBe(1);

		// A verification operation writes no review packet or script of its own.
		const after = readdirSync(tmpdir()).filter((name) => name.startsWith("imm-cli-review-"));
		expect(after.sort()).toEqual(before.sort());

		expect((await kernel.coordinator.submitVerification(TASK, ctx(root))).state).toBe("rework");
		expect(kernel.calls.inspectVerification).toBeGreaterThan(0);
	});
});
