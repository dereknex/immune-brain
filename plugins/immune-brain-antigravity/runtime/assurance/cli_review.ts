// Host-neutral CLI Review dispatch (Spec review-cli-stage D3-D9, D12).
//
// The runtime prepares one packet, one POSIX sh script and one output pair; the
// Parent runs the script from its own shell and submits the result through the
// existing mediation path. This is the only authority Review path (D11). The reviewer process is trusted to return a verdict,
// not to stay read-only, so a tree guard over HEAD, the index and tracked
// content releases any round that changed the reviewed state (D6).
//
// Findings verification is untouched: prepareVerification/inspectVerification
// delegate to the wrapped Host (BR-DEC-4).

import { execFileSync } from "node:child_process";
import { accessSync, chmodSync, constants, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chooseReviewer, resolveConfig, type ReviewProfile } from "../config/layered_config";
import { currentReviewContractHash } from "../role_prompt_bridge";
import {
	ReviewPreparationError,
	type AssuranceHostPort,
	type HostReviewReservation,
	type ReviewRequest,
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
 * The reviewer argv for one Host, model and effort applied only when the profile sets them (D5).
 * `readDirs` are the out-of-tree directories the reviewer must read (packet, evidence).
 */
export function reviewArguments(profile: ReviewProfile, packetPath: string, turnBudget: number, readDirs: string[] = []): string[] {
	const model = profile.model ? ["--model", profile.model] : [];
	if (profile.host === "claude-code") {
		return [
			"--print",
			"--no-session-persistence",
			"--settings",
			CLAUDE_REVIEW_SETTINGS,
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
			`/immune-brain:authority-review ${packetPath}`,
		];
	}
	if (profile.host === "pi") {
		return [
			"--print",
			"--no-session",
			...model,
			...(profile.effort ? ["--thinking", profile.effort] : []),
			`/skill:authority-review ${packetPath}`,
		];
	}
	return [
		"--print",
		...model,
		...(profile.effort ? ["--effort", profile.effort] : []),
		`/authority-review ${packetPath}`,
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
	const instruction = `Read ${packetPath} and do exactly what it says. Reply with only the JSON it asks for.`;
	if (profile.host === "claude-code") {
		return [
			"--print", "--no-session-persistence", "--max-turns", String(turnBudget),
			"--tools", "Read,Grep,Glob,Bash",
			"--allowedTools", ...REVIEW_GIT_ALLOWED_TOOLS,
			"--permission-mode", "dontAsk", "--settings", CLAUDE_REVIEW_SETTINGS, ...modelFlag, instruction,
		];
	}
	if (profile.host === "pi") return ["--print", "--no-session", ...modelFlag, instruction];
	return ["--print", ...modelFlag, instruction];
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

interface CliVerificationReservation {
	taskId: string;
	actorId: string;
	/** The selected verifier model, exactly as the coordinator asked for it. */
	model: string;
	directory: string;
	output: string;
	exitFile: string;
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
	output: string;
	exitFile: string;
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

	constructor(private readonly wrapped: AssuranceHostPort) {
		this.host = wrapped.host;
	}

	/**
	 * Verification CLI stage: a verification that follows a CLI Review runs as one
	 * more CLI process, in the same working directory and with the same reviewer
	 * Host, and its output bytes are the receipt (ADR 0017 binds them by reading
	 * twice). One that follows no CLI Review goes to the wrapped Host as before.
	 */
	prepareVerification(request: VerificationRequest): HostReviewReservation {
		const review = [...this.reservations.values()].reverse().find((item) => item.taskId === request.taskId);
		if (!review) {
			if (!this.wrapped.prepareVerification) throw new Error("host verifier dispatch is unavailable");
			return this.wrapped.prepareVerification(request);
		}
		const executable = reviewBinary(review.profile.host);
		if (!executable) throw new ReviewPreparationError("review_host_unavailable",
			`review_host ${review.profile.host} executable ${REVIEW_BINARY[review.profile.host]} is not on PATH`,
			`Install ${REVIEW_BINARY[review.profile.host]} on PATH or set another \`lanes.review_host\`, then call \`advance_assurance\``);
		const transport = resolveConfig(review.root).lanes.review_transport?.value ?? "process";
		const sessionRunner = transport === "herdr" ? reviewSessionRunner() : null;
		const directory = mkdtempSync(join(tmpdir(), "imm-cli-verify-"));
		chmodSync(directory, 0o755);
		const packet = join(directory, "verify-packet.md");
		const script = join(directory, "verify.sh");
		const output = join(directory, `verify-output-${request.operationId}.txt`);
		const exitFile = join(directory, `verify-exit-${request.operationId}`);
		writeFileSync(packet, request.prompt, { encoding: "utf8", mode: 0o644 });
		writeProcessScript(script, review.root, [executable, ...verificationArguments(review.profile, request.model, packet, VERIFICATION_TURNS)], output, exitFile);
		// S3 (#426): with a session transport the verifier runs in a watched tab too.
		const command = sessionRunner
			? [sessionRunner, "run", "--provider", "herdr", "--cwd", review.root, "--label", `verify ${request.taskId}`.slice(0, 32), "--", "sh", script].map(shellQuote).join(" ")
			: `sh ${script}`;
		const actorId = `cli-verifier:${review.profile.host}:${request.operationId}`;
		this.verifications.set(request.operationId, { taskId: request.taskId, actorId, model: request.model, directory, output, exitFile });
		return {
			id: request.operationId,
			dispatch: { verification_command: command, verifier_model: request.model },
			verification_command: command,
			review_profile: review.profile,
			review_actor_id: actorId,
		};
	}

	/** No exit file keeps the reservation; a failed or silent process releases it with no receipt. */
	inspectVerification(reservation: HostReviewReservation): VerificationReceipt {
		const owned = this.verifications.get(reservation.id);
		if (!owned) {
			if (!this.wrapped.inspectVerification) return { ok: false, release: true, reason: "no verification reservation" };
			return this.wrapped.inspectVerification(reservation);
		}
		if (!existsSync(owned.exitFile))
			return { ok: false, release: false, reason: "verification process still running; wait for it to exit, then call submit_verification again" };
		const status = Number.parseInt(readFileSync(owned.exitFile, "utf8").trim(), 10);
		if (status !== 0) return { ok: false, release: true, reason: `verification_process_failed: verifier exited ${status}` };
		const bytes = existsSync(owned.output) ? readFileSync(owned.output, "utf8") : "";
		if (!bytes.trim()) return { ok: false, release: true, reason: "verification_process_failed: verifier produced no output" };
		return { ok: true, receipt: { actorId: owned.actorId, result: bytes, model: owned.model } };
	}

	prepareReview(request: ReviewRequest): HostReviewReservation {
		if (!request.root) throw new Error("CLI Review requires the task's working directory");
		const root: string = request.root;
		const profile = chooseReviewer(resolveConfig(root).lanes as Parameters<typeof chooseReviewer>[0]);
		if (!profile) throw new ReviewPreparationError("review_profile_required",
			"Review dispatch requires a review profile and none resolves", REVIEW_PROFILE_RECOVERY);
		const executable = reviewBinary(profile.host);
		if (!executable) throw new ReviewPreparationError("review_host_unavailable",
			`review_host ${profile.host} executable ${REVIEW_BINARY[profile.host]} is not on PATH`,
			`Install ${REVIEW_BINARY[profile.host]} on PATH or set another \`lanes.review_host\`, then call \`advance_assurance\``);
		const transport = resolveConfig(root).lanes.review_transport?.value ?? "process";
		const sessionRunner = transport === "herdr" ? reviewSessionRunner() : null;
		const tree = reviewTreeState(root);

		const directory = realpathSync(mkdtempSync(join(tmpdir(), "imm-cli-review-")));
		chmodSync(directory, 0o755);
		const packet = join(directory, "packet.md");
		const script = join(directory, "review.sh");
		const output = join(directory, `review-output-${request.operationId}.txt`);
		const exitFile = join(directory, `review-exit-${request.operationId}`);
		const contractHash = currentReviewContractHash();
		writeFileSync(packet, `review_contract_hash: ${contractHash}\n\n${request.snapshotPrompt}`, { encoding: "utf8", mode: 0o644 });
		const readDirs = [...new Set([directory, dirname(request.evidencePath)])];
		const argv = reviewArguments(profile, packet, request.maxTurns, readDirs);
		writeProcessScript(script, root, [executable, ...argv], output, exitFile);

		// S4 (#426): the same script, in a Herdr tab the user can watch; the verdict
		// still comes from the output and exit files, never from the tab.
		const reviewCommand = sessionRunner
			? [sessionRunner, "run", "--provider", "herdr", "--cwd", root, "--label", `review ${request.taskId}`.slice(0, 32), "--", "sh", script].map(shellQuote).join(" ")
			: `sh ${script}`;
		const actorId = `cli:${profile.host}:${request.operationId}`;
		this.reservations.set(request.operationId, {
			taskId: request.taskId, operationId: request.operationId, root,
			profile, actorId, directory, output, exitFile, tree,
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
	 * D4: no exit file keeps the reservation; a failed process, a changed tree or
	 * a contract mismatch releases it; otherwise the output bytes are the receipt.
	 */
	inspectReview(taskId: string): ReviewObservation {
		const reservation = [...this.reservations.values()].reverse().find((item) => item.taskId === taskId);
		if (!reservation) return { ok: false, release: true, reason: "no CLI Review reservation for this task" };
		if (!existsSync(reservation.exitFile))
			return { ok: false, release: false, reason: "review process still running; wait for it to exit, then call submit_review again" };
		let changed: string[];
		try {
			changed = treeChanged(reservation.root, reservation.tree);
		} catch (error) {
			return { ok: false, release: true, reason: `review_tree_changed: the reviewed tree is unreadable (${(error as Error).message})` };
		}
		if (changed.length)
			return { ok: false, release: true,
				reason: `review_tree_changed: ${changed.join(", ")}. Restore these paths to the reviewed state, then call advance_assurance.` };
		const status = Number.parseInt(readFileSync(reservation.exitFile, "utf8").trim(), 10);
		if (status !== 0) return { ok: false, release: true, reason: `review_process_failed: reviewer exited ${status}` };
		const bytes = existsSync(reservation.output) ? readFileSync(reservation.output, "utf8") : "";
		if (!bytes.trim()) return { ok: false, release: true, reason: "review_process_failed: reviewer produced no output" };
		const mismatch = /^REVIEW_CONTRACT_MISMATCH (\S+)\s*$/.exec(bytes.trim());
		if (mismatch)
			return { ok: false, release: true, reason: `review_contract_mismatch: reviewer ${mismatch[1]} vs current ${currentReviewContractHash()}` };
		// A configured verifier model is offered, so the verifier runs on a different
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
