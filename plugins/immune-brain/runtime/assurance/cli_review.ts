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
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chooseReviewer, resolveConfig, type ReviewProfile } from "../config/layered_config";
import { currentReviewContractHash } from "../role_prompt_bridge";
import {
	ReviewPreparationError,
	type AssuranceHostPort,
	type HostReviewReservation,
	type ReviewRequest,
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
 * Claude Code reviewer settings: user hooks must not rewrite the allowlisted
 * git commands (a PreToolUse rewrite no longer matches `--allowedTools` and
 * `dontAsk` denies it), and Bash output must hold a whole reviewed file.
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

/**
 * The reviewer argv for one Host, model and effort applied only when the profile sets them (D5).
 * `readDirs` are the out-of-tree directories the reviewer must read (packet, evidence).
 */
export function reviewArguments(
	profile: ReviewProfile,
	packetPath: string,
	turnBudget: number,
	readDirs: string[] = [],
	skillPath?: string,
): string[] {
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
			"Bash(git show:*)",
			"Bash(git diff:*)",
			"Bash(git log:*)",
			"Bash(git cat-file:*)",
			"Bash(git rev-parse:*)",
			"Bash(git ls-tree:*)",
			"--permission-mode",
			"dontAsk",
			...model,
			...(profile.effort ? ["--effort", profile.effort] : []),
			`/immune-brain:authority-review ${packetPath}`,
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
			`/skill:authority-review ${packetPath}`,
		];
	}
	// Antigravity (`agy`) parses `--print <prompt>` as taking the very next
	// argument as the prompt, so option flags precede `--print` (verified on agy 1.5.8).
	return [
		...model,
		...(profile.effort ? ["--effort", profile.effort] : []),
		"--print",
		`/authority-review ${packetPath}`,
	];
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
	readonly prepareVerification?: AssuranceHostPort["prepareVerification"];
	readonly inspectVerification?: AssuranceHostPort["inspectVerification"];
	private readonly reservations = new Map<string, CliReviewReservation>();

	constructor(private readonly wrapped: AssuranceHostPort) {
		this.host = wrapped.host;
		if (wrapped.prepareVerification) this.prepareVerification = (request) => wrapped.prepareVerification!(request);
		if (wrapped.inspectVerification) this.inspectVerification = (reservation) => wrapped.inspectVerification!(reservation);
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
		writeFileSync(script, [
			"#!/bin/sh",
			`cd ${shellQuote(root)} || exit 1`,
			`out=${shellQuote(output)}`,
			`tmp="$out.part"`,
			`${[executable, ...argv].map(shellQuote).join(" ")} >"$tmp" 2>&1`,
			"status=$?",
			`mv -f "$tmp" "$out"`,
			`printf '%s\\n' "$status" > ${shellQuote(exitFile)}`,
			`exit "$status"`,
			"",
		].join("\n"), { encoding: "utf8", mode: 0o755 });
		chmodSync(script, 0o755);

		const actorId = `cli:${profile.host}:${request.operationId}`;
		this.reservations.set(request.operationId, {
			taskId: request.taskId, operationId: request.operationId, root,
			profile, actorId, directory, output, exitFile, tree,
		});
		return {
			id: request.operationId,
			dispatch: { review_command: `sh ${script}`, review_profile: profile },
			review_command: `sh ${script}`,
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
		return {
			ok: true,
			receipt: { actorId: reservation.actorId, result: bytes, model: reservation.profile.model ?? "host-default" },
		};
	}

	/** Review submission and verifier submission share this entry; see `review_mediation`. */
	inspectReviewForTask(taskId: string): ReviewObservation {
		return this.inspectReview(taskId);
	}

	releaseReview(reservation: HostReviewReservation): void {
		const owned = this.reservations.get(reservation.id);
		if (!owned) {
			this.wrapped.releaseReview(reservation);
			return;
		}
		this.reservations.delete(reservation.id);
		rmSync(owned.directory, { recursive: true, force: true });
	}
}
