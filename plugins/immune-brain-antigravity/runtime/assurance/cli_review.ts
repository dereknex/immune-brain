// Host-neutral CLI Review dispatch (Spec review-cli-stage D3-D9, D12).
//
// The runtime prepares one result slot (a brief and a receipt file inside the
// task's own working directory, #565) and one explicit supervised session the
// Parent creates, awaits and stops (Spec explicit-port-review-session D1). The
// receipt is the slot's JSON file, never terminal text; the slot is ignored, so
// the session needs no extra directory and the tree guard never sees it. This is the
// only authority Review path (D11). The reviewer is trusted to return a verdict,
// not to stay read-only, so a tree guard over HEAD, the index and tracked content
// releases any round that changed the reviewed state (D6). The hidden background
// `--print` process transport is retired, so a Host outside Herdr fails closed
// instead of running an unobserved subprocess (Spec retire-process-review-transport
// D1, D2).

import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConfig, type ReviewProfile } from "../config/layered_config";
import { agentRole, type AgentsSection } from "../config/agent_roles";
import { runtimeClaudePluginDir } from "../plugin_source_skew";
import { laneBatchReviewProfile } from "../unattended/batch_state";
import { allocateResultSlot, isStrictJsonObject, readSlotResult, releaseResultSlot, type ResultSlot } from "../session_result_slot";
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
	"Set `agents.reviewer` (a user `agents.profiles` name, `host[:model][@effort]` or { host, model?, effort? }) in the user or project configuration, then call `advance_assurance`";

const REVIEW_BINARY: Record<ReviewProfile["host"], string> = {
	"claude-code": "claude",
	pi: "pi",
	antigravity: "agy",
};

/** The skill invocation that carries the review contract to a Host; one spelling per Host. */
export function reviewSkillPrompt(profile: ReviewProfile, briefPath: string): string {
	if (profile.host === "claude-code") return `/immune-brain:authority-review ${briefPath}`;
	if (profile.host === "pi") return `/skill:authority-review ${briefPath}`;
	return `/authority-review ${briefPath}`;
}

/** The verifier's single instruction: the packet carries the whole role contract. */
export function verificationInstruction(packetPath: string): string {
	return `Read ${packetPath} and do exactly what it says. Reply with only the JSON it asks for.`;
}

/** The model a Host runs on when the profile names none; never passed as `--model`. */
const HOST_DEFAULT_MODEL = "host-default";

/**
 * The read-only git rules a claude-code reviewer and verifier may run (#426 D1). One list, so the
 * reviewer and verifier argv cannot drift. `-C`, pipes and redirection stay out: a prefix rule cannot
 * bind the subcommand after `-C`, and allowing a formatter admits non-git commands.
 */
export const REVIEW_GIT_ALLOWED_TOOLS: readonly string[] = Object.freeze([
	"Bash(git show:*)", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git cat-file:*)", "Bash(git rev-parse:*)", "Bash(git ls-tree:*)", "Bash(git grep:*)",
	"Bash(git --no-pager show:*)", "Bash(git --no-pager diff:*)", "Bash(git --no-pager log:*)",
	"Bash(git --no-pager cat-file:*)", "Bash(git --no-pager rev-parse:*)", "Bash(git --no-pager ls-tree:*)", "Bash(git --no-pager grep:*)",
]);

/**
 * The one non-git rule a claude-code reviewer and verifier may use: the MCP tool
 * that writes the receipt into its result slot (Spec review-receipt-mcp-submission
 * D5). A Lane worktree lives under `.git/`, where Claude Code refuses agent file
 * writes, so the receipt leaves through the runtime instead.
 */
export const SESSION_RESULT_ALLOWED_TOOL = "mcp__plugin_immune-brain_immune-brain__submit_session_result";

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

/** Resolve the reviewer executable from PATH as the Lane supervisor does; absent means unavailable. */
function reviewBinary(host: ReviewProfile["host"]): string | null {
	const name = REVIEW_BINARY[host];
	return (process.env.PATH ?? "").split(delimiter)
		.map((dir) => join(dir || ".", name))
		.find((path) => {
			try { accessSync(path, constants.X_OK); return true; } catch { return false; }
		}) ?? null;
}

function requireReviewBinary(profile: ReviewProfile): void {
	if (reviewBinary(profile.host)) return;
	throw new ReviewPreparationError("review_host_unavailable",
		`review_host ${profile.host} executable ${REVIEW_BINARY[profile.host]} is not on PATH`,
		`Install ${REVIEW_BINARY[profile.host]} on PATH or bind another host in \`agents.profiles\` in the user config, then call \`advance_assurance\``);
}

interface ReviewTreeState {
	head: string;
	index: string;
	worktree: string;
}

/**
 * The `imm-session` wrapper every Authority Review and findings Verification runs
 * in. It names its provider; outside Herdr preparation fails closed, because the
 * hidden `--print` process transport is retired.
 */
function reviewSessionRunner(env: NodeJS.ProcessEnv = process.env): string {
	if (env.HERDR_ENV !== "1" || !env.HERDR_WORKSPACE_ID) {
		throw new ReviewPreparationError("review_transport_unavailable",
			"an Authority Review or findings Verification needs an explicit Herdr session and this Host is not inside Herdr",
			"Run this Lane inside Herdr, then call `advance_assurance`");
	}
	let dir = dirname(fileURLToPath(import.meta.url));
	for (let level = 0; level < 5; level++) {
		const candidate = join(dir, "bin", "imm-session");
		if (existsSync(candidate)) return candidate;
		dir = dirname(dir);
	}
	throw new ReviewPreparationError("review_transport_unavailable",
		"imm-session is not shipped beside this runtime", "Reinstall the plugin, then call `advance_assurance`");
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
 * model and effort (#426 F14), else the resolved `code-review` role (Spec
 * loop-agent-scheduling D1). The only transport a round runs on is Herdr (D3).
 */
export function resolveReviewProfile(root: string): ReviewProfile | null {
	const batch = laneBatchReviewProfile(root);
	if (batch) return { ...batch, transport: "herdr" };
	return agentReviewProfile(resolveConfig(root).agents);
}

/** The `code-review` role's own profile, or null while no preset binds one. */
function agentReviewProfile(agents: AgentsSection): ReviewProfile | null {
	const role = agentRole(agents, "reviewer");
	if (!role) return null;
	return { host: role.host, ...(role.model ? { model: role.model } : {}), ...(role.effort ? { effort: role.effort } : {}), transport: "herdr" };
}

/** A diagnostic key path under an `agents` table, in any layer (Spec review-config-invalid D1). */
function isAgentKeyPath(keyPath: string): boolean {
	return keyPath === "agents" || keyPath.startsWith("agents.");
}

/**
 * One supervised session a round runs in: `create` prints the `handle` that
 * `await` and `stop` take. The Parent runs all three from its own shell, so this
 * module still imports nothing from `runtime/session/` (BR-OUT-1, D1). `await`
 * also copies its result beside the receipt, so a round can tell a session that
 * stopped without writing its file from one still running (D5).
 */
/** A slot whose session cannot be described is released, never left behind. */
function withSlot<T>(slot: ResultSlot, build: () => T): T {
	try {
		return build();
	} catch (error) {
		releaseResultSlot(slot);
		throw error;
	}
}

function sessionSpec(runner: string, label: string, input: {
	root: string;
	host: ReviewProfile["host"];
	entry: string;
	hostArgs: string[];
	output: string;
	awaitRecord: string;
}): ReviewSessionSpec {
	const command = (verb: string, ...argv: string[]) =>
		[runner, verb, "--provider", "herdr", ...argv].map(shellQuote).join(" ");
	const create = (...resume: string[]) => command("create", "--cwd", input.root, "--label", label, "--host", input.host,
		"--entry", input.entry, ...resume, ...(input.hostArgs.length ? ["--", ...input.hostArgs] : []));
	return {
		transport: "herdr",
		output_path: input.output,
		create_command: create(),
		resume_command: create("--resume", "<handle>"),
		await_command: `${command("await", "<handle>")} | tee ${shellQuote(input.awaitRecord)}`,
		stop_command: command("stop", "<handle>"),
	};
}

/**
 * What the Parent's recorded `await` says about a session that has not written its
 * receipt. It `ended` when its process is gone (`exited`) or the agent stopped
 * working (`changed` to `idle` or `done`): it will never write. A `blocked` session
 * waits on a dialog the user answers in its tab, so the round stays open. A missing
 * record, a `timeout`, lost events or a refusal claim nothing, so the round keeps waiting.
 */
type SessionAwaitOutcome = { ended: string } | { blocked: true } | null;

function sessionAwaitOutcome(awaitRecord: string): SessionAwaitOutcome {
	let record: unknown;
	try { record = JSON.parse(readFileSync(awaitRecord, "utf8")); } catch { return null; }
	if (!record || typeof record !== "object") return null;
	const { ok, transition, state } = record as { ok?: unknown; transition?: unknown; state?: unknown };
	if (ok !== true) return null;
	if (transition === "exited") return { ended: `exited, state ${typeof state === "string" ? state : "unknown"}` };
	if (transition !== "changed") return null;
	if (state === "idle" || state === "done") return { ended: `changed, state ${state}` };
	return state === "blocked" ? { blocked: true } : null;
}

/** The pending reason for a session that is still running or waits on its user. */
function sessionPending(outcome: SessionAwaitOutcome, role: "reviewer" | "verifier", submit: string): string {
	if (outcome && "blocked" in outcome)
		return `${role} session is blocked on a dialog: relay it to the user; once they answered it in the session's tab, run \`resume_command\` once if \`create_command\` printed \`entry_submitted: false\` (the entry was never delivered), then \`await_command\` again, then ${submit} once`;
	return `${role === "reviewer" ? "review" : "verification"} session still running; await it with \`imm-session await\`, then ${submit} once`;
}

/** The reason a session that ended without its receipt releases its round (D8). */
function sessionAborted(code: string, ended: string): string {
	return `${code}: the session ended (${ended}) without submitting its receipt; inspect its tab for a denied or failed tool call before dispatching another session`;
}

/** The one sentence that turns any role instruction into a file-only receipt on Pi (D2). */
function writeToOutput(output: string): string {
	return `Write the one JSON object you owe to ${output} as that file's whole content, in a single write, then stop.`
		+ " It is the ignored result slot of this session and the only path you may create; print no verdict.";
}

/** The same sentence on the hosts whose receipt leaves through the runtime (D5). */
function submitToOutput(slotId: string): string {
	return `Call the MCP tool submit_session_result with slot_id ${JSON.stringify(slotId)} and result set to the one JSON object you owe, then stop.`
		+ " Create no file; print no verdict.";
}

/** Claude Code and Antigravity submit; Pi writes. */
function receiptInstruction(host: ReviewProfile["host"], slotId: string, output: string): string {
	return host === "pi" ? writeToOutput(output) : submitToOutput(slotId);
}

/**
 * The Host arguments one supervised session starts with: the profile's model and
 * effort and the reviewer tool boundary. The slot lives in the session cwd, so no
 * extra directory is added and no trust dialog opens (#565).
 * On Claude Code that is the read-only tool set, the git allowlist, the one receipt
 * tool and `dontAsk`, with user hooks off so no rewrite escapes the allowlist
 * (D5, #426 F11). Pi gets its read-only tools plus `write`; the D6 tree guard still
 * backs every Host.
 */
export function sessionHostArguments(
	profile: ReviewProfile,
	options: { model?: string; pluginDir?: string | null },
): string[] {
	const model = options.model ?? profile.model;
	// The sentinel is not a model name; never pass it as one.
	const modelFlag = model && model !== HOST_DEFAULT_MODEL ? ["--model", model] : [];
	if (profile.host === "claude-code")
		return [
			"--settings", CLAUDE_REVIEW_SETTINGS,
			// The skill must come from the plugin the Kernel runs, not an older user install (#426 F13).
			...(options.pluginDir ? ["--plugin-dir", options.pluginDir] : []),
			"--tools", "Read,Grep,Glob,Bash",
			"--allowedTools", ...REVIEW_GIT_ALLOWED_TOOLS, SESSION_RESULT_ALLOWED_TOOL,
			"--permission-mode", "dontAsk",
			...modelFlag,
			...(profile.effort ? ["--effort", profile.effort] : []),
		];
	if (profile.host === "pi")
		return ["--tools", "read,grep,find,ls,bash,write", ...modelFlag, ...(profile.effort ? ["--thinking", profile.effort] : [])];
	return [...modelFlag, ...(profile.effort ? ["--effort", profile.effort] : [])];
}

interface CliVerificationReservation {
	taskId: string;
	actorId: string;
	/** The selected verifier model, exactly as the coordinator asked for it. */
	model: string;
	slot: ResultSlot;
	/** Where the session's `await_command` copies its result. */
	awaitRecord: string;
}

interface CliReviewReservation {
	taskId: string;
	operationId: string;
	root: string;
	profile: ReviewProfile;
	actorId: string;
	/** The brief in, the receipt out: the slot's result file. */
	slot: ResultSlot;
	/** Where the session's `await_command` copies its result. */
	awaitRecord: string;
	tree: ReviewTreeState;
}

/**
 * The review-profile CLI dispatcher: one reservation writes the packet and the
 * session spec, and `inspectReview` reads the finished receipt back (D3, D4).
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
	 * more explicit supervised session, in the same working directory and with the
	 * same reviewer Host, and its result-slot JSON bytes are the receipt (ADR 0017
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
		// The transport comes first: outside Herdr nothing can run, whatever is installed.
		const sessionRunner = reviewSessionRunner(this.env);
		requireReviewBinary(profile);
		const slotId = `verify-${request.operationId}`;
		const slot = allocateResultSlot(review.root, slotId, request.prompt, "verify-packet.md");
		const awaitRecord = join(slot.directory, "session-await.json");
		const label = `verify ${request.taskId}`.slice(0, 32);
		const actorId = `cli-verifier:${profile.host}:${request.operationId}`;
		const session = withSlot(slot, () => sessionSpec(sessionRunner, label, {
			root: review.root,
			host: profile.host,
			entry: `${verificationInstruction(slot.brief)}\n\n${receiptInstruction(profile.host, slotId, slot.result)}`,
			hostArgs: sessionHostArguments(profile, { model: request.model, pluginDir: runtimeClaudePluginDir() }),
			output: slot.result,
			awaitRecord,
		}));
		this.verifications.set(request.operationId, { taskId: request.taskId, actorId, model: request.model, slot, awaitRecord });
		return {
			id: request.operationId,
			dispatch: { verification_session: session, verifier_model: request.model },
			verification_session: session,
			review_profile: profile,
			review_actor_id: actorId,
		};
	}

	/**
	 * A session that has not written its file keeps the reservation; a receipt that
	 * is not one strict JSON object releases it with no receipt (D2).
	 */
	inspectVerification(reservation: HostReviewReservation): VerificationReceipt {
		const owned = this.verifications.get(reservation.id);
		if (!owned) {
			if (!this.wrapped.inspectVerification) return { ok: false, release: true, reason: "no verification reservation" };
			return this.wrapped.inspectVerification(reservation);
		}
		const bytes = readSlotResult(owned.slot);
		if (bytes === null) {
			const outcome = sessionAwaitOutcome(owned.awaitRecord);
			if (outcome && "ended" in outcome)
				return { ok: false, release: true,
					reason: sessionAborted("verification_session_aborted", outcome.ended) };
			return { ok: false, release: false, reason: sessionPending(outcome, "verifier", "submit_verification") };
		}
		// The session's file is the authority channel, so it must be strict JSON (D2).
		if (!isStrictJsonObject(bytes))
			return { ok: false, release: true, reason: "verification_output_invalid: the verifier's output is not one strict JSON object" };
		return { ok: true, receipt: { actorId: owned.actorId, result: bytes, model: owned.model } };
	}

	prepareReview(request: ReviewRequest): HostReviewReservation {
		if (!request.root) throw new Error("CLI Review requires the task's working directory");
		const root: string = request.root;
		const config = resolveConfig(root);
		// A Lane Review runs on the profile its batch fixed at confirmation, so a
		// request-selected Lane profile reaches Review (#426 F14).
		const batch = request.profile ? null : laneBatchReviewProfile(root);
		const configured = request.profile || batch ? null : agentReviewProfile(config.agents);
		const profile = request.profile ?? (batch ? { ...batch, transport: "herdr" } : configured);
		const agentErrors = config.diagnostics.filter((item) => item.severity === "error" && isAgentKeyPath(item.key_path));
		if (!profile) {
			// D1: the user's own `agents` table is why nothing resolved, so name it.
			if (!config.agents.valid && agentErrors.length) throw new ReviewPreparationError("review_config_invalid",
				`the \`agents\` configuration is invalid: ${agentErrors.map((item) => `${item.file}: ${item.key_path} (${item.message})`).join("; ")}`,
				`Fix ${agentErrors.map((item) => `\`${item.key_path}\` in ${item.file}`).join(", ")}, then call \`advance_assurance\``);
			throw new ReviewPreparationError("review_profile_required",
				"Review dispatch requires a review profile and none resolves", REVIEW_PROFILE_RECOVERY);
		}
		// The transport comes first: outside Herdr nothing can run, whatever is installed.
		const sessionRunner = reviewSessionRunner(this.env);
		requireReviewBinary(profile);
		const tree = reviewTreeState(root);

		const slotId = `review-${request.operationId}`;
		const slot = allocateResultSlot(root, slotId, request.snapshotPrompt);
		const awaitRecord = join(slot.directory, "session-await.json");
		const actorId = `cli:${profile.host}:${request.operationId}`;
		// D1: an explicit interactive session the user can watch; its verdict comes
		// only from the slot's JSON file, never from the terminal.
		const session = withSlot(slot, () => sessionSpec(sessionRunner, `review ${request.taskId}`.slice(0, 32), {
			root,
			host: profile.host,
			entry: `${reviewSkillPrompt(profile, slot.brief)}\n\n${receiptInstruction(profile.host, slotId, slot.result)}`,
			hostArgs: sessionHostArguments(profile, { pluginDir: runtimeClaudePluginDir() }),
			output: slot.result,
			awaitRecord,
		}));
		this.reservations.set(request.operationId, {
			taskId: request.taskId, operationId: request.operationId, root,
			profile, actorId, slot, awaitRecord, tree,
		});
		return {
			id: request.operationId,
			dispatch: { review_session: session, review_profile: profile },
			review_session: session,
			review_profile: profile,
			review_actor_id: actorId,
		};
	}

	/**
	 * D4: a session that has not written its file keeps the reservation unless its
	 * recorded `await` shows it stopped (`review_session_aborted`); a changed tree
	 * or a non-JSON receipt releases it; otherwise the file
	 * bytes are the receipt.
	 */
	inspectReview(taskId: string): ReviewObservation {
		const reservation = [...this.reservations.values()].reverse().find((item) => item.taskId === taskId);
		if (!reservation) return { ok: false, release: true, reason: "no CLI Review reservation for this task" };
		let changed: string[];
		try {
			changed = treeChanged(reservation.root, reservation.tree);
		} catch (error) {
			return { ok: false, release: true, reason: `review_tree_changed: the reviewed tree is unreadable (${(error as Error).message})` };
		}
		if (changed.length)
			return { ok: false, release: true,
				reason: `review_tree_changed: ${changed.join(", ")}. Restore these paths to the reviewed state, then call advance_assurance.` };
		const bytes = readSlotResult(reservation.slot);
		if (bytes === null) {
			const outcome = sessionAwaitOutcome(reservation.awaitRecord);
			if (outcome && "ended" in outcome)
				return { ok: false, release: true,
					reason: sessionAborted("review_session_aborted", outcome.ended) };
			return { ok: false, release: false, reason: sessionPending(outcome, "reviewer", "submit_review") };
		}
		// The session's file is the authority channel, so it must be strict JSON (D2).
		if (!isStrictJsonObject(bytes))
			return { ok: false, release: true, reason: "review_output_invalid: the reviewer's receipt is not one strict JSON object" };
		// The verifier runs on the reviewer's own profile (ADR 0041 retires #284 D1's separate model).
		return { ok: true, receipt: { actorId: reservation.actorId, result: bytes, model: reservation.profile.model ?? HOST_DEFAULT_MODEL } };
	}

	/** Review submission and verifier submission share this entry; see `review_mediation`. */
	inspectReviewForTask(taskId: string): ReviewObservation {
		return this.inspectReview(taskId);
	}

	releaseReview(reservation: HostReviewReservation): void {
		const verification = this.verifications.get(reservation.id);
		if (verification) {
			this.verifications.delete(reservation.id);
			releaseResultSlot(verification.slot);
			return;
		}
		const owned = this.reservations.get(reservation.id);
		if (!owned) {
			this.wrapped.releaseReview(reservation);
			return;
		}
		this.reservations.delete(reservation.id);
		releaseResultSlot(owned.slot);
	}
}
