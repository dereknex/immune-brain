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
import { ClaudeRuntime } from "../plugins/immune-brain/runtime/claude/kernel_ports";
import { AntigravityRuntime } from "../plugins/immune-brain/runtime/antigravity/kernel_ports";
import { AssuranceProgression } from "../plugins/immune-brain/.pi-extension/pi-canary-assurance-progression";
import { CliReviewHost, reviewArguments, verificationArguments } from "../plugins/immune-brain/runtime/assurance/cli_review";
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
	if (result.state !== "review_ready" || !result.review_command) throw new Error(`expected a CLI review_ready, got ${JSON.stringify(result)}`);
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

	test("claude-code reviewer ignores user hooks and keeps a whole file of Bash output", () => {
		const argv = reviewArguments({ host: "claude-code" }, packet, 12);
		const settings = JSON.parse(argv[argv.indexOf("--settings") + 1]);
		expect(settings.disableAllHooks).toBe(true);
		expect(Number(settings.env.BASH_MAX_OUTPUT_LENGTH)).toBeGreaterThanOrEqual(100_000);
		expect(argv).not.toContain("--add-dir");
	});

	test("claude-code reads the packet and evidence directories without taking the prompt as one", () => {
		const dirs = ["/tmp/imm-cli-review-x", "/tmp/imm-canary-native-review-y"];
		const argv = reviewArguments({ host: "claude-code", model: "m" }, packet, 12, dirs);
		const at = argv.indexOf("--add-dir");
		expect(argv.slice(at + 1, at + 1 + dirs.length)).toEqual(dirs);
		expect(argv[at + 1 + dirs.length]).toMatch(/^--/);
		expect(argv.at(-1)).toBe(`/immune-brain:authority-review ${packet}`);
	});

	test("pi and antigravity take no out-of-tree directory flags", () => {
		for (const host of ["pi", "antigravity"] as const) {
			expect(reviewArguments({ host }, packet, 12, ["/tmp/d"])).toEqual(reviewArguments({ host }, packet, 12));
		}
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

// --- #426 A1: the claude-code git allow-list -------------------------------

describe("#426 reviewer and verifier git allow-list", () => {
	const packet = "/tmp/imm-cli-review/packet.md";
	const expected = [
		"Bash(git show:*)", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git cat-file:*)", "Bash(git rev-parse:*)", "Bash(git ls-tree:*)",
		"Bash(git --no-pager show:*)", "Bash(git --no-pager diff:*)", "Bash(git --no-pager log:*)",
		"Bash(git --no-pager cat-file:*)", "Bash(git --no-pager rev-parse:*)", "Bash(git --no-pager ls-tree:*)",
	];
	const rulesOf = (argv: string[]) => argv.slice(argv.indexOf("--allowedTools") + 1, argv.indexOf("--permission-mode"));
	const claudeArgv = () => [
		reviewArguments({ host: "claude-code" }, packet, 12),
		verificationArguments({ host: "claude-code" }, "model", packet, 12),
	];

	test("both claude-code argv carry the same twelve git rules", () => {
		for (const argv of claudeArgv()) {
			expect(rulesOf(argv)).toEqual(expected);
			expect(argv[argv.indexOf("--tools") + 1]).toBe("Read,Grep,Glob,Bash");
			expect(argv[argv.indexOf("--permission-mode") + 1]).toBe("dontAsk");
		}
	});

	test("#426 F11: both claude-code argv turn every hook off so no rewrite hides git from the rules", () => {
		for (const argv of claudeArgv()) {
			const settings = argv[argv.indexOf("--settings") + 1]!;
			expect(JSON.parse(settings).disableAllHooks).toBe(true);
			expect(argv.filter((arg) => arg === "--settings")).toHaveLength(1);
			expect(argv).not.toContain("--setting-sources");
		}
		for (const host of ["pi", "antigravity"] as const) {
			expect(reviewArguments({ host }, packet, 12)).not.toContain("--settings");
			expect(verificationArguments({ host }, "model", packet, 12)).not.toContain("--settings");
		}
	});

	test("#426 F12: the claude-code verifier may read its out-of-tree packet directory", () => {
		const argv = verificationArguments({ host: "claude-code" }, "model", packet, 12);
		expect(argv[argv.indexOf("--add-dir") + 1]).toBe("/tmp/imm-cli-review");
		expect(argv[argv.indexOf("--add-dir") + 2]).toBe("--max-turns");
		expect(argv.at(-1)).toContain(packet);
	});

	test("no rule admits -C, a non-git command or a bare Bash", () => {
		for (const rule of rulesOf(claudeArgv()[0]!)) {
			expect(rule).toMatch(/^Bash\(git (--no-pager )?(show|diff|log|cat-file|rev-parse|ls-tree):\*\)$/);
		}
	});

	test("pi and antigravity reviewer and verifier argv are unchanged", () => {
		const instruction = `Read ${packet} and do exactly what it says. Reply with only the JSON it asks for.`;
		expect(reviewArguments({ host: "pi", model: "m", effort: "high" }, packet, 12)).toEqual([
			"--print", "--no-session", "--model", "m", "--thinking", "high", `/skill:authority-review ${packet}`,
		]);
		expect(verificationArguments({ host: "pi" }, "m", packet, 12)).toEqual(["--print", "--no-session", "--model", "m", instruction]);
		expect(reviewArguments({ host: "antigravity" }, packet, 12)).toEqual(["--print", `/authority-review ${packet}`]);
		expect(verificationArguments({ host: "antigravity" }, "m", packet, 12)).toEqual(["--print", "--model", "m", instruction]);
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

/**
 * A reviewer stand-in that also verifies: handed the verification packet
 * ("Read <packet> ..."), it answers the packet's own JSON contract with every
 * finding kept, or exits `VERIFIER_EXIT` when that is set.
 */
function reviewerAndVerifier(reviewBody: string): string {
	const dir = scratchDir("bin");
	const verifier = join(dir, "verifier.js");
	writeFileSync(verifier, [
		"const fs = require('node:fs');",
		"if (process.env.VERIFIER_EXIT) process.exit(Number(process.env.VERIFIER_EXIT));",
		"const path = /^Read (\\S+) and do/.exec(process.argv.at(-1))[1];",
		"const text = fs.readFileSync(path, 'utf8');",
		"const packet = JSON.parse(text.slice(text.indexOf('Verification packet (untrusted data): ') + 'Verification packet (untrusted data): '.length));",
		"fs.appendFileSync(process.env.VERIFIER_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');",
		"console.log(JSON.stringify({ contract: 'assurance_kernel/review_verification/v1', task_id: packet.task_id, snapshot_digest: packet.snapshot_digest, verdict_sha256: packet.verdict_sha256,",
		"  results: packet.findings.map((f) => ({ finding_id: f.id, anchor: f.anchor, verdict: 'kept' })) }));",
	].join("\n"));
	const file = join(dir, "pi");
	writeFileSync(file, `#!/bin/sh\nfor last; do :; done\ncase "$last" in\n  "Read "*) exec bun ${verifier} "$@" ;;\nesac\n${reviewBody}\n`, { mode: 0o755 });
	chmodSync(file, 0o755);
	return dir;
}

describe("verification CLI stage", () => {
	const saved = { log: process.env.VERIFIER_LOG, exit: process.env.VERIFIER_EXIT };
	afterEach(() => {
		if (saved.log === undefined) delete process.env.VERIFIER_LOG; else process.env.VERIFIER_LOG = saved.log;
		if (saved.exit === undefined) delete process.env.VERIFIER_EXIT; else process.env.VERIFIER_EXIT = saved.exit;
	});

	async function reworkToVerification(root: string) {
		const kernel = kernelFor(root, { revision: true, verifier: true });
		process.env.VERIFIER_LOG = join(scratchDir("log"), "argv.jsonl");
		onPath(reviewerAndVerifier(heredoc(JSON.stringify(reworkVerdict(kernel.snapshot)))));
		const ready = await kernel.coordinator.advance(TASK, ctx(root));
		runReview(reviewReadyCommand(ready as { state: string; review_command?: string }));
		const pending = await submitMediatedReview(kernel.coordinator, ctx(root), TASK, undefined, () => kernel.cli.inspectReview(TASK));
		return { kernel, pending: pending as { state: string; verification_command?: string } };
	}

	test("a verification after a CLI Review runs as a CLI process whose bytes are the bound receipt", async () => {
		const root = reviewRepo();
		const { kernel, pending } = await reworkToVerification(root);
		expect(pending.state).toBe("verification_ready");
		expect(pending.verification_command).toMatch(/^sh \S+imm-cli-verify-\S+\/verify\.sh$/);
		expect(kernel.calls.prepareVerification).toBe(0);
		// Still running: the reservation is kept and nothing is applied.
		expect(await kernel.coordinator.submitVerification(TASK, ctx(root))).toMatchObject({ state: "blocked", reason: "verification result pending" });

		spawnSync("sh", ["-c", pending.verification_command!], { encoding: "utf8" });
		const settled = await kernel.coordinator.submitVerification(TASK, ctx(root));
		expect(settled.state).toBe("rework");
		const review = reviewsOf(kernel).at(-1)!;
		expect(review.decision).toBe("rework");
		expect(review.verification).toMatchObject({ verifier_actor: expect.stringMatching(/^cli-verifier:pi:/), result_sha256: expect.stringMatching(/^sha256:/), model_relation: "same" });
		expect(review.verification).not.toHaveProperty("failure");
		expect(kernel.calls.inspectVerification).toBe(0);
		expect(readdirSync(tmpdir()).filter((name) => pending.verification_command!.includes(name))).toEqual([]);
	});

	test("a failed verifier process keeps every finding and never weakens Review", async () => {
		const root = reviewRepo();
		const { kernel, pending } = await reworkToVerification(root);
		process.env.VERIFIER_EXIT = "3";
		spawnSync("sh", ["-c", pending.verification_command!], { encoding: "utf8" });
		expect((await kernel.coordinator.submitVerification(TASK, ctx(root))).state).toBe("rework");
		expect(reviewsOf(kernel).at(-1)!.verification).toMatchObject({ failure: "dispatch_failed", verifier_actor: null, result_sha256: null });
	});

	test("a configured verifier model is offered and used, so the verifier runs on a different model (#284 D1)", async () => {
		const root = reviewRepo("pi", { review_model: "reviewer-m", review_verifier_model: "verifier-m" });
		const { kernel, pending } = await reworkToVerification(root);
		spawnSync("sh", ["-c", pending.verification_command!], { encoding: "utf8" });
		await kernel.coordinator.submitVerification(TASK, ctx(root));
		const argv = JSON.parse(readFileSync(process.env.VERIFIER_LOG!, "utf8").trim().split("\n").at(-1)!);
		expect(argv.slice(0, 4)).toEqual(["--print", "--no-session", "--model", "verifier-m"]);
		expect(reviewsOf(kernel).at(-1)!.verification).toMatchObject({ reviewer_model: "reviewer-m", verifier_model: "verifier-m", model_relation: "different", verifier_actor: expect.stringMatching(/^cli-verifier:/) });
	});

	test("a verification that follows no CLI Review still goes to the wrapped Host", () => {
		const { host, calls } = wrappedHost(true);
		const cli = new CliReviewHost(host);
		const reservation = cli.prepareVerification({ taskId: "other", operationId: "op-1", prompt: "p", model: "m", writePacket: writeTestReviewPacket });
		expect(reservation.verification_command).toBeUndefined();
		expect(calls.prepareVerification).toBe(1);
		expect(cli.inspectVerification(reservation)).toMatchObject({ ok: false, release: true });
		expect(calls.inspectVerification).toBe(1);
	});
});

// --- S3 AC1/AC2: the composition root's default ----------------------------

/** The Claude composition root is where the dispatch default is read (D8). */
const ROOT_ENV = { CLAUDE_CODE_VERSION: "2.1.236", CLAUDE_CODE_PERMISSION_MODE: "manual" };

async function claudeAdvance(
	root: string,
	env: Record<string, string | undefined>,
	risk: Risk = "material",
): Promise<{ state: string; review_command?: string; review_profile?: { host: string; model?: string }; agent_params?: unknown; code?: string; recovery_action?: string }> {
	const fixture = fixtureFor(root, { risk });
	const runtime = new ClaudeRuntime({ cwd: root, env, ports: fixture.ports, authorityOverrides: fixture.ports as never });
	return await runtime.advance(TASK) as never;
}

describe("default cli dispatch", () => {
	test("an unset environment reserves the project's CLI reviewer and names its profile", async () => {
		const root = reviewRepo("pi", { review_model: "model-x" });
		onPath(fakeReviewer("exit 0"));
		const ready = await claudeAdvance(root, ROOT_ENV);

		expect(ready).toMatchObject({ state: "review_ready", review_profile: { host: "pi", model: "model-x" } });
		// One command, not a dispatch list: the Parent runs this exact `sh <script>`.
		expect(typeof ready.review_command).toBe("string");
		const script = reviewScriptPath(ready.review_command!);
		expect(existsSync(script)).toBe(true);
		expect(readFileSync(script, "utf8").match(/authority-review/g)).toHaveLength(1);
		expect(ready).not.toHaveProperty("agent_params");
	});
});

// --- S4 AC4: the CLI is the only authority Review path (D11) --------------

/**
 * The retired switch, spelled so no live source names it: S4 deletes it, and a
 * value an operator still has exported must not re-enable an Agent dispatch.
 */
const RETIRED_SWITCH = ["IMMUNE_BRAIN", "REVIEW", "DISPATCH"].join("_");

const piAdvance = async (root: string, risk: Risk = "material") => {
	const fixture = fixtureFor(root, { risk });
	const progression = new AssuranceProgression({ ...fixture.ports, authorityOverrides: fixture.ports as never });
	return await progression.advance(TASK, ctx(root)) as never;
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
		for (const ready of [await piAdvance(root), await claudeAdvance(root, env), await antigravityAdvance(root, env)]) {
			expect(ready).toMatchObject({ state: "review_ready", review_profile: { host: "pi", model: "model-x" } });
			expect(typeof ready.review_command).toBe("string");
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
		expect(ready.recovery_action).toContain("lanes.review_host");
	});

	test("a routine task completes after QA without a profile", async () => {
		const root = reviewRepo(null);
		onPath(fakeReviewer("exit 0"));
		expect((await claudeAdvance(root, ROOT_ENV, "routine")).state).toBe("completed");
	});
});

// --- #426 S4: the review script in a supervised session ------------------

describe("review transport (#426 S4)", () => {
	const HERDR_KEYS = ["HERDR_ENV", "HERDR_WORKSPACE_ID", "FAKE_HERDR_STATE", "VERIFIER_LOG"] as const;
	const saved = Object.fromEntries(HERDR_KEYS.map((key) => [key, process.env[key]]));
	afterEach(() => { for (const key of HERDR_KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });

	test("outside Herdr a herdr transport fails closed with one recovery action, after QA", async () => {
		const root = reviewRepo("pi", { review_transport: "herdr" });
		const kernel = kernelFor(root);
		onPath(fakeReviewer(heredoc(JSON.stringify(passVerdict(kernel.snapshot)))));
		delete process.env.HERDR_ENV;
		const ready = await kernel.coordinator.advance(TASK, ctx(root));
		expect(ready).toMatchObject({ state: "review_preparation_failed", code: "review_transport_unavailable" });
		expect((ready as { recovery_action: string }).recovery_action).toContain("lanes.review_transport");
		expect(kernel.applied.filter((entry) => entry.role === "qa")).toHaveLength(1);
		expect(reviewsOf(kernel)).toHaveLength(0);
	});

	test("inside Herdr the same script runs in a tab and its output bytes settle the Review", async () => {
		const root = reviewRepo("pi", { review_transport: "herdr" });
		const kernel = kernelFor(root);
		const verdict = passVerdict(kernel.snapshot);
		const state = join(scratchDir("herdr"), "state.json");
		writeFileSync(state, JSON.stringify({ protocol: 22, panes: {} }));
		Object.assign(process.env, { HERDR_ENV: "1", HERDR_WORKSPACE_ID: "w-parent", FAKE_HERDR_STATE: state });
		onPath([fakeReviewer(heredoc(JSON.stringify(verdict))), join(__dirname, "fixtures/fake-herdr")].join(":"));
		const ready = await kernel.coordinator.advance(TASK, ctx(root));
		const command = reviewReadyCommand(ready as { state: string; review_command?: string });
		expect(command).toMatch(/bin\/imm-session' 'run' '--provider' 'herdr' '--cwd' '\S+' '--label' 'review cli-review-task' '--' 'sh' '\S+review\.sh'$/);

		const ran = spawnSync("sh", ["-c", command], { encoding: "utf8" });
		expect(JSON.parse(ran.stdout)).toMatchObject({ ok: true, exit_code: 0 });
		const herdr = JSON.parse(readFileSync(state, "utf8"));
		expect(herdr.calls.map((call: string[]) => call.slice(0, 2).join(" "))).toEqual(["api schema", "tab create", "pane run", "pane wait-output"]);
		expect(herdr.calls.some((call: string[]) => call[0] === "pane" && call[1] === "run")).toBe(true);

		const settled = await submitMediatedReview(kernel.coordinator, ctx(root), TASK, undefined, () => kernel.cli.inspectReview(TASK));
		expect(settled).toMatchObject({ state: "completed" });
		expect(reviewsOf(kernel)).toHaveLength(1);
	});

	test("S3: the findings verifier runs in a Herdr session too, and its bound bytes settle the verification", async () => {
		const root = reviewRepo("pi", { review_transport: "herdr" });
		const kernel = kernelFor(root, { revision: true, verifier: true });
		const state = join(scratchDir("herdr"), "state.json");
		writeFileSync(state, JSON.stringify({ protocol: 22, panes: {} }));
		Object.assign(process.env, { HERDR_ENV: "1", HERDR_WORKSPACE_ID: "w-parent", FAKE_HERDR_STATE: state, VERIFIER_LOG: join(scratchDir("log"), "argv.jsonl") });
		onPath([reviewerAndVerifier(heredoc(JSON.stringify(reworkVerdict(kernel.snapshot)))), join(__dirname, "fixtures/fake-herdr")].join(":"));
		const ready = await kernel.coordinator.advance(TASK, ctx(root));
		spawnSync("sh", ["-c", reviewReadyCommand(ready as { state: string; review_command?: string })], { encoding: "utf8" });
		const pending = await submitMediatedReview(kernel.coordinator, ctx(root), TASK, undefined, () => kernel.cli.inspectReview(TASK)) as { state: string; verification_command?: string };
		expect(pending.state).toBe("verification_ready");
		expect(pending.verification_command).toMatch(/bin\/imm-session' 'run' '--provider' 'herdr' '--cwd' '\S+' '--label' 'verify cli-review-task' '--' 'sh' '\S+verify\.sh'$/);
		const ran = spawnSync("sh", ["-c", pending.verification_command!], { encoding: "utf8" });
		expect(JSON.parse(ran.stdout)).toMatchObject({ ok: true, exit_code: 0 });
		expect((await kernel.coordinator.submitVerification(TASK, ctx(root))).state).toBe("rework");
		expect(reviewsOf(kernel).at(-1)!.verification).toMatchObject({ verifier_actor: expect.stringMatching(/^cli-verifier:pi:/) });
		const tabs = JSON.parse(readFileSync(state, "utf8")).calls.filter((call: string[]) => call[0] === "tab" && call[1] === "create").map((call: string[]) => call[7]);
		expect(tabs.map((label: string) => label.replace(/ \[imm:[0-9a-f]+\]$/, ""))).toEqual(["review cli-review-task", "verify cli-review-task"]);
	});
});
