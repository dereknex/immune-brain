// Host-neutral CLI Review dispatch (Spec review-cli-stage D3-D9, D12).
//
// The runtime prepares one packet, one receipt file and — per `lanes.review_transport` —
// either a POSIX sh script the Parent runs from its own shell, or one explicit
// supervised session the Parent creates, awaits and stops (Spec
// explicit-port-review-session D1). Either way the receipt is the out-of-tree
// JSON file, never terminal text. This is the only authority Review path (D11).
// The reviewer is trusted to return a verdict, not to stay read-only, so a tree
// guard over HEAD, the index and tracked content releases any round that
// changed the reviewed state (D6).

import { execFileSync } from "node:child_process";
import { accessSync, chmodSync, constants, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	chooseReviewer,
	resolveConfig,
	type ReviewProfile,
	type ReviewTransport,
} from "../config/layered_config";
import { runtimeClaudePluginDir } from "../plugin_source_skew";
import { laneBatchReviewProfile } from "../unattended/batch_state";
import { currentReviewContractHash } from "../role_prompt_bridge";
import {
	ReviewPreparationError,
	type AssuranceHostPort,
	type HostReviewReservation,
	type ReviewRequest,
	type ReviewSessionSpec,
	type VerificationReceipt,
	type VerificationRequest,
} from "./host_port";
import type { ReviewObservation } from "./review_mediation";

const REVIEW_PROFILE_RECOVERY =
	"Set `lanes.review_host` in the active user lane profile or in `.imm/config.json`, then call `advance_assurance`";

const REVIEW_BINARY: Record<ReviewProfile["host"], string> = {
	"claude-code": "claude",
	pi: "pi",
	antigravity: "agy",
};

/**
/**
 * The read-only git rules a claude-code reviewer and verifier may run (#426 D1). One list, so the
 * reviewer and verifier argv cannot drift. `-C`, pipes and redirection stay out: a prefix rule cannot
 * bind the subcommand after `-C`, and allowing a formatter admits non-git commands.
 */
export const REVIEW_GIT_ALLOWED_TOOLS: readonly string[] = Object.freeze([
	"Bash(git show:*)", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git cat-file:*)", "Bash(git rev-parse:*)", "Bash(git ls-tree:*)",
	"Bash(git --no-pager show:*)", "Bash(git --no-pager diff:*)", "Bash(git --no-pager log:*)",
	"Bash(git --no-pager cat-file:*)", "Bash(git --no-pager rev-parse:*)", "Bash(git --no-pager ls-tree:*)",
]);

/**
 * Claude Code reviewer and verifier settings: user hooks must not rewrite the allowlisted
 * git commands (a PreToolUse rewrite such as `rtk git show` no longer matches `--allowedTools`
 * and `dontAsk` denies it; #426 F11), and Bash output must hold a whole reviewed file. The
 * receipt is the output file, never a hook observation; user settings, plugins and skills still load.
 */
export const CLAUDE_REVIEW_SETTINGS = JSON.stringify({
	disableAllHooks: true,
	env: { BASH_MAX_OUTPUT_LENGTH: "150000" },
});

/**
 * Resolves the explicit absolute path to authority-review SKILL.md.
 * Resolves from the package root in both source and bundled layouts (Spec S7 D8).
 */
export function resolveAuthorityReviewSkillPath(moduleDir: string = dirname(fileURLToPath(import.meta.url))): string {
	const candidates = [
		resolve(moduleDir, "../../skills/authority-review/SKILL.md"),
		resolve(moduleDir, "../skills/authority-review/SKILL.md"),
		resolve(moduleDir, "skills/authority-review/SKILL.md"),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	throw new Error(`authority-review skill not found from ${moduleDir}`);
}

/** The skill invocation that carries the review contract to a Host; one spelling per Host. */
export function reviewSkillPrompt(profile: ReviewProfile, packetPath: string): string {
	if (profile.host === "claude-code") return `/immune-brain:authority-review ${packetPath}`;
	if (profile.host === "pi") return `/skill:authority-review ${packetPath}`;
	return `/authority-review ${packetPath}`;
}

/** The verifier's single instruction: the packet carries the whole role contract. */
export function verificationInstruction(packetPath: string): string {
	return `Read ${packetPath} and do exactly what it says. Reply with only the JSON it asks for.`;
}

/**
 * The reviewer argv for one Host, model and effort applied only when the profile sets them (D5).
 * `readDirs` are the out-of-tree directories the reviewer must read (packet, evidence).
 */
export function reviewArguments(
	profile: ReviewProfile,
	packetPath: string,
	turnBudget: number,
	readDirs: string[] = [],
	pluginDir: string | null = null,
	skillPath?: string,
): string[] {
	const model = profile.model ? ["--model", profile.model] : [];
	if (profile.host === "claude-code") {
		return [
			"--print",
			"--no-session-persistence",
			"--settings",
			CLAUDE_REVIEW_SETTINGS,
			// The skill must come from the plugin the Kernel runs, not an older user install (#426 F13).
			...(pluginDir ? ["--plugin-dir", pluginDir] : []),
			// Variadic: keep a flag after it so the prompt is never taken as a directory.
			...(readDirs.length ? ["--add-dir", ...readDirs] : []),
			"--max-turns",
			String(turnBudget),
			"--tools",
			"Read,Grep,Glob,Bash",
			"--allowedTools",
			...REVIEW_GIT_ALLOWED_TOOLS,
			"--permission-mode",
			"dontAsk",
			...model,
			...(profile.effort ? ["--effort", profile.effort] : []),
			reviewSkillPrompt(profile, packetPath),
		];
	}
	if (profile.host === "pi") {
		const explicitSkill = skillPath ?? resolveAuthorityReviewSkillPath();
		return [
			"--print",
			"--no-session",
			"--no-extensions",
			"--no-skills",
			"--no-mcp",
			"--skill",
			explicitSkill,
			"--tools",
			"read,grep,find,ls,bash",
			...model,
			...(profile.effort ? ["--thinking", profile.effort] : []),
			reviewSkillPrompt(profile, packetPath),
		];
	}
	// Antigravity (`agy`) parses `--print <prompt>` as taking the very next
	// argument as the prompt, so option flags precede `--print` (verified on agy 1.5.8; #426 F15).
	return [
		...model,
		...(profile.effort ? ["--effort", profile.effort] : []),
		"--print",
		reviewSkillPrompt(profile, packetPath),
	];
}

/** The model a Host runs on when the profile names none; never passed as `--model`. */
const HOST_DEFAULT_MODEL = "host-default";

/**
 * The verifier argv (verification CLI stage): the same fresh, read-only print
 * session as the reviewer's, on the selected verifier model, told to read the
 * verification packet. The packet carries the whole `review-verifier` role
 * contract, so no packaged skill is needed.
 */
export function verificationArguments(profile: ReviewProfile, model: string, packetPath: string, turnBudget: number): string[] {
	const modelFlag = model && model !== HOST_DEFAULT_MODEL ? ["--model", model] : [];
	const instruction = verificationInstruction(packetPath);
	if (profile.host === "claude-code") {
		return [
			// The packet lives outside the reviewed tree; `dontAsk` denies a Read outside it (#426 F12).
			// Variadic: a flag follows it so the instruction is never taken as a directory.
			"--print", "--no-session-persistence", "--add-dir", dirname(packetPath), "--max-turns", String(turnBudget),
			"--tools", "Read,Grep,Glob,Bash",
			"--allowedTools", ...REVIEW_GIT_ALLOWED_TOOLS,
			"--permission-mode", "dontAsk", "--settings", CLAUDE_REVIEW_SETTINGS, ...modelFlag, instruction,
		];
	}
	if (profile.host === "pi") return ["--print", "--no-session", ...modelFlag, instruction];
	return [...modelFlag, "--print", instruction];
}

/** Resolve the reviewer executable from PATH as the Lane supervisor does; absent means unavailable. */
function reviewBinary(host: ReviewProfile["host"]): string | null {
	const name = REVIEW_BINARY[host];
	return (process.env.PATH ?? "").split(delimiter)
		.map((dir) => join(dir || ".", name))
		.find((path) => {
			try { accessSync(path, constants.X_OK); return true; } catch { return false; }
		}) ?? null;
}

interface ReviewTreeState {
	head: string;
	index: string;
	worktree: string;
}

/**
 * The `imm-session` wrapper for `lanes.review_transport: herdr`. It names its
 * provider; outside Herdr it fails closed rather than falling back to a process.
 */
function reviewSessionRunner(env: NodeJS.ProcessEnv = process.env): string {
	if (env.HERDR_ENV !== "1" || !env.HERDR_WORKSPACE_ID) {
		throw new ReviewPreparationError("review_transport_unavailable",
			"lanes.review_transport is herdr but this Review is not prepared inside Herdr",
			"Run the Lane inside Herdr, or set `lanes.review_transport` to `process`, then call `advance_assurance`");
	}
	let dir = dirname(fileURLToPath(import.meta.url));
	for (let level = 0; level < 5; level++) {
		const candidate = join(dir, "bin", "imm-session");
		if (existsSync(candidate)) return candidate;
		dir = dirname(dir);
	}
	throw new ReviewPreparationError("review_transport_unavailable",
		"imm-session is not shipped beside this runtime", "Reinstall the plugin, or set `lanes.review_transport` to `process`, then call `advance_assurance`");
}

function git(root: string, argv: string[]): string {
	return execFileSync("git", argv, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
}

function digest(bytes: string): string {
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** HEAD, the index and tracked content identity, the three states the guard compares (D6). */
function reviewTreeState(root: string): ReviewTreeState {
	return {
		head: git(root, ["rev-parse", "HEAD"]).trim(),
		index: digest(git(root, ["ls-files", "-s"])),
		worktree: digest(git(root, ["diff", "--binary", "HEAD"])),
	};
}

function treeChanged(root: string, recorded: ReviewTreeState): string[] {
	const current = reviewTreeState(root);
	if (current.head === recorded.head && current.index === recorded.index && current.worktree === recorded.worktree) return [];
	const listed = (argv: string[]) => git(root, argv).split("\n").filter(Boolean);
	return [...new Set([
		...listed(["diff", "--name-only", recorded.head]),
		...listed(["diff", "--cached", "--name-only", recorded.head]),
	])];
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The Review profile this task's round runs on: the Lane batch's recorded host,
 * model and effort (#426 F14), carried with the layered transport setting that
 * decides whether the round is a process or an explicit session (D3).
 */
export function resolveReviewProfile(root: string): ReviewProfile | null {
	const lanes = resolveConfig(root).lanes as Parameters<typeof chooseReviewer>[0];
	const batch = laneBatchReviewProfile(root);
	if (!batch) return chooseReviewer(lanes);
	const transport = lanes.review_transport?.value as ReviewTransport | null | undefined;
	return { ...batch, ...(transport ? { transport } : {}) };
}

/** The transport a prepared profile names; an unset one keeps the CLI process. */
function profileTransport(profile: ReviewProfile): ReviewTransport {
	return profile.transport ?? "process";
}

/**
 * One supervised session a round runs in: `create` prints the `handle` that
 * `await` and `stop` take. The Parent runs all three from its own shell, so this
 * module still imports nothing from `runtime/session/` (BR-OUT-1, D1).
 */
function sessionSpec(runner: string, label: string, input: {
	root: string;
	host: ReviewProfile["host"];
	entry: string;
	hostArgs: string[];
	output: string;
}): ReviewSessionSpec {
	const command = (verb: string, ...argv: string[]) =>
		[runner, verb, "--provider", "herdr", ...argv].map(shellQuote).join(" ");
	return {
		transport: "herdr",
		output_path: input.output,
		create_command: command("create", "--cwd", input.root, "--label", label, "--host", input.host,
			"--entry", input.entry, ...(input.hostArgs.length ? ["--", ...input.hostArgs] : [])),
		await_command: command("await", "<handle>"),
		stop_command: command("stop", "<handle>"),
	};
}

/** The one sentence that turns any role instruction into a file-only receipt (D2). */
function writeToOutput(output: string, mismatchLine = false): string {
	return `Write the one JSON object you owe to ${output} as that file's whole content, then stop.`
		+ (mismatchLine ? " A review contract mismatch goes there instead, as the whole content, in the exact form the instruction names." : "")
		+ " It is outside the reviewed worktree and is the only path you may create; print no verdict.";
}

/**
 * The Host arguments one supervised session starts with: the profile's model and
 * effort, the out-of-tree directories it reads, and — on Claude Code — a write
 * allowlist for the reservation's single output file (D2).
 */
export function sessionHostArguments(
	profile: ReviewProfile,
	options: { outputPath: string; model?: string; readDirs?: string[]; pluginDir?: string | null },
): string[] {
	const model = options.model ?? profile.model;
	// The sentinel is not a model name; never pass it as one.
	const modelFlag = model && model !== HOST_DEFAULT_MODEL ? ["--model", model] : [];
	if (profile.host === "claude-code")
		return [
			...(options.pluginDir ? ["--plugin-dir", options.pluginDir] : []),
			...(options.readDirs?.length ? ["--add-dir", ...options.readDirs] : []),
			"--allowedTools", `Write(${options.outputPath})`,
			...modelFlag,
			...(profile.effort ? ["--effort", profile.effort] : []),
		];
	if (profile.host === "pi") return [...modelFlag, ...(profile.effort ? ["--thinking", profile.effort] : [])];
	return [...modelFlag, ...(profile.effort ? ["--effort", profile.effort] : [])];
}

/** A receipt is one strict JSON object: no prose, fences or surrounding lines (D2). */
function strictJsonObject(bytes: string): Record<string, unknown> | null {
	const trimmed = bytes.trim();
	if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
	try {
		const parsed: unknown = JSON.parse(trimmed);
		return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
	} catch { return null; }
}

interface CliVerificationReservation {
	taskId: string;
	actorId: string;
	/** The selected verifier model, exactly as the coordinator asked for it. */
	model: string;
	directory: string;
	output: string;
	/** The process transport's completion marker; null for a supervised session. */
	exitFile: string | null;
	/** Set when the round runs as an explicit supervised session (D1). */
	session: ReviewSessionSpec | null;
}

/** Turn budget of one verifier process: it reads one packet and the revision, nothing else. */
const VERIFICATION_TURNS = 16;

/** The script both CLI stages run: output under a temporary name, the exit status last (ADR 0037 D2). */
function writeProcessScript(script: string, root: string, command: string[], output: string, exitFile: string): void {
	writeFileSync(script, [
		"#!/bin/sh",
		`cd ${shellQuote(root)} || exit 1`,
		`out=${shellQuote(output)}`,
		`tmp="$out.part"`,
		`${command.map(shellQuote).join(" ")} >"$tmp" 2>&1`,
		"status=$?",
		`mv -f "$tmp" "$out"`,
		`printf '%s\\n' "$status" > ${shellQuote(exitFile)}`,
		`exit "$status"`,
		"",
	].join("\n"), { encoding: "utf8", mode: 0o755 });
	chmodSync(script, 0o755);
}

interface CliReviewReservation {
	taskId: string;
	operationId: string;
	root: string;
	profile: ReviewProfile;
	actorId: string;
	directory: string;
	/** The receipt: the process's captured output, or the session's JSON file. */
	output: string;
	/** The process transport's completion marker; null for a supervised session. */
	exitFile: string | null;
	/** Set when the round runs as an explicit supervised session (D1). */
	session: ReviewSessionSpec | null;
	tree: ReviewTreeState;
}

/**
 * The review-profile CLI dispatcher: one reservation writes the packet and the
 * script, and `inspectReview` reads the finished pair back (D3, D4).
 */
export class CliReviewHost implements AssuranceHostPort {
	readonly host: AssuranceHostPort["host"];
	private readonly reservations = new Map<string, CliReviewReservation>();
	private readonly verifications = new Map<string, CliVerificationReservation>();
	private readonly env: NodeJS.ProcessEnv;

	constructor(private readonly wrapped: AssuranceHostPort, options: { env?: NodeJS.ProcessEnv } = {}) {
		this.host = wrapped.host;
		this.env = options.env ?? process.env;
	}

	/**
	 * Verification CLI stage: a verification that follows a CLI Review runs as one
	 * more CLI process or supervised session, in the same working directory and
	 * with the same reviewer Host, and its output bytes are the receipt (ADR 0017
	 * binds them by reading twice). One that follows no CLI Review goes to the
	 * wrapped Host as before.
	 */
	prepareVerification(request: VerificationRequest): HostReviewReservation {
		const review = [...this.reservations.values()].reverse().find((item) => item.taskId === request.taskId);
		if (!review) {
			if (!this.wrapped.prepareVerification) throw new Error("host verifier dispatch is unavailable");
			return this.wrapped.prepareVerification(request);
		}
		// The Lane profile the coordinator forwards from the Review reservation, else the one that round ran on.
		const profile = request.profile ?? review.profile;
		const executable = reviewBinary(profile.host);
		if (!executable) throw new ReviewPreparationError("review_host_unavailable",
			`review_host ${profile.host} executable ${REVIEW_BINARY[profile.host]} is not on PATH`,
			`Install ${REVIEW_BINARY[profile.host]} on PATH or set another \`lanes.review_host\`, then call \`advance_assurance\``);
		const transport = profileTransport(profile);
		const sessionRunner = transport === "herdr" ? reviewSessionRunner(this.env) : null;
		const directory = realpathSync(mkdtempSync(join(tmpdir(), "imm-cli-verify-")));
		chmodSync(directory, 0o755);
		const packet = join(directory, "verify-packet.md");
		const output = join(directory, `verify-output-${request.operationId}.json`);
		const label = `verify ${request.taskId}`.slice(0, 32);
		writeFileSync(packet, request.prompt, { encoding: "utf8", mode: 0o644 });
		const actorId = `cli-verifier:${profile.host}:${request.operationId}`;
		if (sessionRunner) {
			const session = sessionSpec(sessionRunner, label, {
				root: review.root,
				host: profile.host,
				entry: `${verificationInstruction(packet)}\n\n${writeToOutput(output)}`,
				hostArgs: sessionHostArguments(profile, { outputPath: output, model: request.model, readDirs: [directory] }),
				output,
			});
			this.verifications.set(request.operationId, { taskId: request.taskId, actorId, model: request.model, directory, output, exitFile: null, session });
			return {
				id: request.operationId,
				dispatch: { verification_session: session, verifier_model: request.model },
				verification_session: session,
				review_profile: profile,
				review_actor_id: actorId,
			};
		}
		const script = join(directory, "verify.sh");
		const exitFile = join(directory, `verify-exit-${request.operationId}`);
		writeProcessScript(script, review.root, [executable, ...verificationArguments(profile, request.model, packet, VERIFICATION_TURNS)], output, exitFile);
		const command = `sh ${script}`;
		this.verifications.set(request.operationId, { taskId: request.taskId, actorId, model: request.model, directory, output, exitFile, session: null });
		return {
			id: request.operationId,
			dispatch: { verification_command: command, verifier_model: request.model },
			verification_command: command,
			review_profile: profile,
			review_actor_id: actorId,
		};
	}

	/**
	 * A process without its exit file keeps the reservation; a session without its
	 * file does too. A failed process, a silent one, or a session receipt that is
	 * not one strict JSON object releases it with no receipt (D2).
	 */
	inspectVerification(reservation: HostReviewReservation): VerificationReceipt {
		const owned = this.verifications.get(reservation.id);
		if (!owned) {
			if (!this.wrapped.inspectVerification) return { ok: false, release: true, reason: "no verification reservation" };
			return this.wrapped.inspectVerification(reservation);
		}
		if (owned.exitFile && !existsSync(owned.exitFile))
			return { ok: false, release: false, reason: "verification process still running; wait for its exit, then submit_verification once — do not poll submit_verification" };
		const status = owned.exitFile ? Number.parseInt(readFileSync(owned.exitFile, "utf8").trim(), 10) : 0;
		if (status !== 0) return { ok: false, release: true, reason: `verification_process_failed: verifier exited ${status}` };
		if (!existsSync(owned.output))
			return owned.session
				? { ok: false, release: false,
					reason: `verification session still running; the verifier writes ${owned.output} when it finishes — await it with \`imm-session await\`, then submit_verification once` }
				: { ok: false, release: true, reason: "verification_process_failed: verifier produced no output" };
		const bytes = readFileSync(owned.output, "utf8");
		if (!bytes.trim()) return { ok: false, release: true, reason: "verification_process_failed: verifier produced no output" };
		// The session's file is the authority channel, so it must be strict JSON (D2).
		if (owned.session && !strictJsonObject(bytes))
			return { ok: false, release: true, reason: "verification_output_invalid: the verifier's output is not one strict JSON object" };
		return { ok: true, receipt: { actorId: owned.actorId, result: bytes, model: owned.model } };
	}

	prepareReview(request: ReviewRequest): HostReviewReservation {
		if (!request.root) throw new Error("CLI Review requires the task's working directory");
		const root: string = request.root;
		// A Lane Review runs on the profile its batch fixed at confirmation, so a
		// request-selected Lane profile reaches Review (#426 F14).
		const profile = request.profile ?? resolveReviewProfile(root);
		if (!profile) throw new ReviewPreparationError("review_profile_required",
			"Review dispatch requires a review profile and none resolves", REVIEW_PROFILE_RECOVERY);
		const executable = reviewBinary(profile.host);
		if (!executable) throw new ReviewPreparationError("review_host_unavailable",
			`review_host ${profile.host} executable ${REVIEW_BINARY[profile.host]} is not on PATH`,
			`Install ${REVIEW_BINARY[profile.host]} on PATH or set another \`lanes.review_host\`, then call \`advance_assurance\``);
		const sessionRunner = profileTransport(profile) === "herdr" ? reviewSessionRunner(this.env) : null;
		const tree = reviewTreeState(root);

		const directory = realpathSync(mkdtempSync(join(tmpdir(), "imm-cli-review-")));
		chmodSync(directory, 0o755);
		const packet = join(directory, "packet.md");
		const output = join(directory, `review-output-${request.operationId}.json`);
		const contractHash = currentReviewContractHash();
		writeFileSync(packet, `review_contract_hash: ${contractHash}\n\n${request.snapshotPrompt}`, { encoding: "utf8", mode: 0o644 });
		const readDirs = [...new Set([directory, dirname(request.evidencePath)])];
		const actorId = `cli:${profile.host}:${request.operationId}`;
		if (sessionRunner) {
			// D1: an explicit interactive session the user can watch; its verdict comes
			// only from the out-of-tree JSON file, never from the terminal.
			const session = sessionSpec(sessionRunner, `review ${request.taskId}`.slice(0, 32), {
				root,
				host: profile.host,
				entry: `${reviewSkillPrompt(profile, packet)}\n\n${writeToOutput(output, true)}`,
				hostArgs: sessionHostArguments(profile, { outputPath: output, readDirs, pluginDir: runtimeClaudePluginDir() }),
				output,
			});
			this.reservations.set(request.operationId, {
				taskId: request.taskId, operationId: request.operationId, root,
				profile, actorId, directory, output, exitFile: null, session, tree,
			});
			return {
				id: request.operationId,
				dispatch: { review_session: session, review_profile: profile },
				review_session: session,
				review_profile: profile,
				review_actor_id: actorId,
			};
		}
		const script = join(directory, "review.sh");
		const exitFile = join(directory, `review-exit-${request.operationId}`);
		const argv = reviewArguments(profile, packet, request.maxTurns, readDirs, runtimeClaudePluginDir());
		writeProcessScript(script, root, [executable, ...argv], output, exitFile);
		const reviewCommand = `sh ${script}`;
		this.reservations.set(request.operationId, {
			taskId: request.taskId, operationId: request.operationId, root,
			profile, actorId, directory, output, exitFile, session: null, tree,
		});
		return {
			id: request.operationId,
			dispatch: { review_command: reviewCommand, review_profile: profile },
			review_command: reviewCommand,
			review_profile: profile,
			review_actor_id: actorId,
		};
	}

	/**
	 * D4: a process that has not exited, or a session that has not written its
	 * file, keeps the reservation; a failed process, a changed tree, a contract
	 * mismatch or a non-JSON receipt releases it; otherwise the file bytes are the
	 * receipt.
	 */
	inspectReview(taskId: string): ReviewObservation {
		const reservation = [...this.reservations.values()].reverse().find((item) => item.taskId === taskId);
		if (!reservation) return { ok: false, release: true, reason: "no CLI Review reservation for this task" };
		if (reservation.exitFile && !existsSync(reservation.exitFile))
			return { ok: false, release: false, reason: "review process still running; wait for its exit, then submit_review once — do not poll submit_review" };
		let changed: string[];
		try {
			changed = treeChanged(reservation.root, reservation.tree);
		} catch (error) {
			return { ok: false, release: true, reason: `review_tree_changed: the reviewed tree is unreadable (${(error as Error).message})` };
		}
		if (changed.length)
			return { ok: false, release: true,
				reason: `review_tree_changed: ${changed.join(", ")}. Restore these paths to the reviewed state, then call advance_assurance.` };
		const status = reservation.exitFile ? Number.parseInt(readFileSync(reservation.exitFile, "utf8").trim(), 10) : 0;
		if (status !== 0) return { ok: false, release: true, reason: `review_process_failed: reviewer exited ${status}` };
		if (!existsSync(reservation.output))
			return reservation.session
				? { ok: false, release: false,
					reason: `review session still running; the reviewer writes ${reservation.output} when it finishes — await it with \`imm-session await\`, then submit_review once` }
				: { ok: false, release: true, reason: "review_process_failed: reviewer produced no output" };
		const bytes = readFileSync(reservation.output, "utf8");
		if (!bytes.trim()) return { ok: false, release: true, reason: "review_process_failed: reviewer produced no output" };
		const mismatch = /^REVIEW_CONTRACT_MISMATCH (\S+)\s*$/.exec(bytes.trim());
		if (mismatch)
			return { ok: false, release: true, reason: `review_contract_mismatch: reviewer ${mismatch[1]} vs current ${currentReviewContractHash()}` };
		// The session's file is the authority channel, so it must be strict JSON (D2).
		if (reservation.session && !strictJsonObject(bytes))
			return { ok: false, release: true, reason: "review_output_invalid: the reviewer's receipt is not one strict JSON object" };		// A configured verifier model is offered, so the verifier runs on a different
		// model from the reviewer's whenever one is set (#284 D1).
		const verifierModel = resolveConfig(reservation.root).lanes.review_verifier_model?.value as string | null | undefined;
		return {
			ok: true,
			receipt: {
				actorId: reservation.actorId, result: bytes, model: reservation.profile.model ?? HOST_DEFAULT_MODEL,
				...(verifierModel ? { offered_models: [verifierModel] } : {}),
			},
		};
	}

	/** Review submission and verifier submission share this entry; see `review_mediation`. */
	inspectReviewForTask(taskId: string): ReviewObservation {
		return this.inspectReview(taskId);
	}

	releaseReview(reservation: HostReviewReservation): void {
		const verification = this.verifications.get(reservation.id);
		if (verification) {
			this.verifications.delete(reservation.id);
			rmSync(verification.directory, { recursive: true, force: true });
			return;
		}
		const owned = this.reservations.get(reservation.id);
		if (!owned) {
			this.wrapped.releaseReview(reservation);
			return;
		}
		this.reservations.delete(reservation.id);
		rmSync(owned.directory, { recursive: true, force: true });
	}
}
