// Herdr TUI adapter for the Supervised Session Port (ADR 0038).
//
// The only runtime module that spells a `herdr` command. It translates port
// verbs into the `herdr` CLI that the Parent's Loop contract drove directly
// before this port existed: a tab per session in the Parent's own workspace,
// created without taking focus; the pane ID addresses the session and the tab
// ID closes it. `HERDR_CLI` holds every command spelling in one place. Each
// spelling and response shape is checked against the Herdr 0.9.5 CLI reference
// and API schema (docs/reports/issue-426-herdr-provider-probe.md): a success
// prints `{"id","result":{...}}` on stdout, a server error prints
// `{"id","error":{"code","message"}}` on stderr and exits 1, and `pane read`
// prints terminal text directly.
//
// Ownership: a random token is written into the tab label at creation
// (`<label> [imm:<token>]`) and carried in the handle. Every verb first reads
// the pane (`pane get`: same workspace, same tab) and the tab (`tab get`: label
// carries the token); any other pane, including the Parent's own, is
// `not_owned`. A session whose pane is gone can only be observed, awaited,
// stopped or closed; nothing is sent to it.

import { randomBytes } from "node:crypto";
import { parseJson, pick, runCommand, type ExecResult } from "./exec";
import {
	closeRecordRefusal,
	instructionRefusal,
	isSessionState,
	refuse,
	resumeRefusal,
	SUPERVISED_SESSION_PROTOCOL,
	validateCreateInput,
	type AwaitResult,
	type CloseRecord,
	type ExecutorHostKind,
	type RunCommandInput,
	type RunCommandResult,
	type Observation,
	type OutputSource,
	type Refusal,
	type SessionHandle,
	type SessionState,
	type SupervisedSessionPort,
	type CreateSessionResult,
} from "./supervised_session_port";

/** Herdr socket protocol versions this adapter is pinned to (Herdr TUI 0.9.x). */
export const SUPPORTED_HERDR_PROTOCOLS = [22] as const;
/** The bound for the entry and instruction submissions: until `working` or `blocked`. */
export const HERDR_PROMPT_TIMEOUT_MS = 30_000;

/** Herdr agent kinds (CLI reference, `agent start --kind`). */
const HOST_KIND: Record<ExecutorHostKind, string> = { "claude-code": "claude", pi: "pi", antigravity: "agy" };

/**
 * Herdr agent names must match `[a-z][a-z0-9_-]{0,31}`; a tab label has no such
 * rule, so a label like a Slice ID is folded into a valid name.
 */
export function herdrAgentName(label: string): string {
	const folded = label.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[^a-z]+/, "");
	return (folded || "lane").slice(0, 32);
}

export const HERDR_CLI = {
	schema: () => ["api", "schema", "--json"],
	tabCreate: (workspace: string, cwd: string, label: string, env: Record<string, string> = {}) => [
		"tab", "create", "--workspace", workspace, "--cwd", cwd, "--label", label,
		...Object.entries(env).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
		"--no-focus",
	],
	tabGet: (tab: string) => ["tab", "get", tab],
	paneGet: (pane: string) => ["pane", "get", pane],
	agentStart: (label: string, kind: string, pane: string, hostArgs: string[]) => ["agent", "start", label, "--kind", kind, "--pane", pane, "--", ...hostArgs],
	prompt: (pane: string, text: string, timeoutMs: number) => ["agent", "prompt", pane, text, "--wait", "--until", "working", "--until", "blocked", "--timeout", String(timeoutMs)],
	// Herdr's default wait ignores `unknown`; the port wakes on every non-working state.
	wait: (pane: string, timeoutMs?: number) => [
		"agent", "wait", pane, "--until", "idle", "--until", "done", "--until", "blocked", "--until", "unknown",
		...(timeoutMs ? ["--timeout", String(timeoutMs)] : []),
	],
	get: (pane: string) => ["agent", "get", pane],
	read: (pane: string, source: OutputSource, lines?: number) => ["pane", "read", pane, "--source", source === "visible" ? "visible" : "recent-unwrapped", ...(lines ? ["--lines", String(lines)] : [])],
	sendKeys: (pane: string, key: string) => ["agent", "send-keys", pane, key],
	paneClose: (pane: string) => ["pane", "close", pane],
	tabClose: (tab: string) => ["tab", "close", tab],
	// `pane run` submits a command line to the pane's shell; `pane wait-output`
	// returns once the unwrapped recent output matches (CLI reference 0.9.5).
	paneRun: (pane: string, command: string) => ["pane", "run", pane, command],
	waitOutput: (pane: string, regex: string) => ["pane", "wait-output", pane, "--regex", regex, "--source", "recent", "--lines", "400"],
} as const;

export type HerdrExecResult = ExecResult;
export type HerdrExec = (args: string[], signal?: AbortSignal) => Promise<HerdrExecResult>;

export interface HerdrProviderOptions {
	env: Record<string, string | undefined>;
	exec?: HerdrExec;
	promptTimeoutMs?: number;
}

export function defaultHerdrExec(env: Record<string, string | undefined>): HerdrExec {
	return (args, signal) => runCommand(env, "herdr", args, signal);
}

interface HerdrIds { workspace: string; tab: string; pane: string; token: string }

export function encodeHerdrHandle(ids: HerdrIds): SessionHandle {
	return `herdr:${[ids.workspace, ids.tab, ids.pane, ids.token].map(encodeURIComponent).join("/")}`;
}

export function decodeHerdrHandle(handle: SessionHandle): HerdrIds | null {
	if (!handle.startsWith("herdr:")) return null;
	const parts = handle.slice("herdr:".length).split("/");
	if (parts.length !== 4 || parts.some(part => part === "")) return null;
	try {
		const [workspace, tab, pane, token] = parts.map(decodeURIComponent);
		return { workspace, tab, pane, token };
	} catch {
		return null;
	}
}

/** The tab label suffix that marks a session's tab as this session's. */
export function herdrTokenMark(token: string): string {
	return `[imm:${token}]`;
}

/** POSIX single-quoting for one shell word. */
export function shellWord(value: string): string {
	return /^[A-Za-z0-9_./:=@%+-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The command line typed into the pane: the command, then a sentinel with its
 * exit status. `printf` assembles the sentinel at run time, so the echoed
 * command line never contains `IMM_<token>_DONE` and cannot match the wait.
 */
export function sentinelCommand(argv: string[], token: string): { line: string; regex: string } {
	return {
		line: `${argv.map(shellWord).join(" ")}; printf 'IMM_%s_%s_%s\\n' ${token} DONE "$?"`,
		regex: `IMM_${token}_DONE_[0-9]+`,
	};
}

/**
 * Reads `.result.agent.agent_status`, which `agent get`, `agent prompt --wait`
 * and `agent wait` return. Herdr's AgentStatus vocabulary is the port's own;
 * anything else is `unknown`, never a guess.
 */
export function parseHerdrState(stdout: string): SessionState {
	const value = pick(parseJson(stdout.trim()), ["result", "agent", "agent_status"]);
	return isSessionState(value) ? value : "unknown";
}

/** The `error.code` of a Herdr error response, read from stderr or stdout. */
export function herdrErrorCode(result: HerdrExecResult): string | undefined {
	for (const text of [result.stderr, result.stdout]) {
		const code = pick(parseJson(text.trim()), ["error", "code"]);
		if (typeof code === "string") return code;
	}
	return undefined;
}

const EXITED_CODES = new Set(["pane_not_found", "agent_not_running", "agent_not_found"]);
/** An entry Herdr typed but the agent never took up (`agent_prompt_stalled`). */
const STALLED = Symbol("entry stalled");
/** `agent get` on a pane whose shell no longer hosts the agent. */
const HOST_GONE_CODES = new Set(["agent_not_running", "agent_not_found"]);

function detected(state: SessionState): Observation {
	return { state, provenance: state === "unknown" ? "none" : "detected" };
}

function failure(result: HerdrExecResult): string {
	return (result.stderr || result.stdout).trim().slice(0, 500) || `herdr exited ${result.code}`;
}

function protocolOf(schema: unknown): number | undefined {
	for (const path of [["protocol"], ["protocol_version"], ["version", "protocol"], ["info", "protocol"]]) {
		const value = pick(schema, path);
		if (typeof value === "number") return value;
		if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
	}
	return undefined;
}

export function createHerdrSessionProvider(options: HerdrProviderOptions): SupervisedSessionPort {
	const exec = options.exec ?? defaultHerdrExec(options.env);
	const promptTimeoutMs = options.promptTimeoutMs ?? HERDR_PROMPT_TIMEOUT_MS;
	const workspace = options.env.HERDR_WORKSPACE_ID ?? "";

	const run = async (args: string[], signal?: AbortSignal): Promise<HerdrExecResult | Refusal> => {
		const result = await exec(args, signal);
		if (result.missing) return refuse("provider_unavailable", "the herdr executable is not on PATH");
		return result;
	};
	const isRefusal = (value: unknown): value is Refusal => typeof value === "object" && value !== null && (value as Refusal).ok === false;
	/**
	 * Ownership: the handle names the Parent's workspace, its pane lives in its
	 * tab, and the tab label carries its token. `gone` means the pane no longer
	 * exists; such a session is never sent anything.
	 */
	const own = async (handle: SessionHandle): Promise<{ ids: HerdrIds; gone: boolean } | Refusal> => {
		const ids = decodeHerdrHandle(handle);
		if (!ids) return refuse("not_owned", "handle is not a Herdr session handle", handle);
		if (!workspace || ids.workspace !== workspace) return refuse("not_owned", "session is not in the Parent's own Herdr workspace", handle);
		const pane = await run(HERDR_CLI.paneGet(ids.pane));
		if (isRefusal(pane)) return pane;
		const tab = await run(HERDR_CLI.tabGet(ids.tab));
		if (isRefusal(tab)) return tab;
		const marked = tab.code === 0 && String(pick(parseJson(tab.stdout), ["result", "tab", "label"]) ?? "").endsWith(herdrTokenMark(ids.token));
		if (pane.code !== 0) {
			if (herdrErrorCode(pane) !== "pane_not_found") return refuse("provider_error", `herdr pane get failed: ${failure(pane)}`, handle);
			// The pane is gone. A surviving tab must still carry the token.
			if (tab.code === 0 && !marked) return refuse("not_owned", "tab was not created for this session", handle);
			return { ids, gone: true };
		}
		const info = pick(parseJson(pane.stdout), ["result", "pane"]);
		if (pick(info, ["workspace_id"]) !== ids.workspace || pick(info, ["tab_id"]) !== ids.tab) {
			return refuse("not_owned", "pane is not in this session's tab", handle);
		}
		if (tab.code !== 0) return refuse("provider_error", `herdr tab get failed: ${failure(tab)}`, handle);
		if (!marked) return refuse("not_owned", "tab was not created for this session", handle);
		return { ids, gone: false };
	};
	const goneRefusal = (handle: SessionHandle) => refuse("state_refused", "the session's pane is gone; nothing was sent; create a new session", handle);

	const observe = async (handle: SessionHandle, pane: string): Promise<Observation | Refusal> => {
		const result = await run(HERDR_CLI.get(pane));
		if (isRefusal(result)) return result;
		// No readable state is `unknown`, never a guess; every rule treats it as not idle.
		if (result.code !== 0) return { state: "unknown", provenance: "none" };
		return detected(parseHerdrState(result.stdout));
	};
	function submit(handle: SessionHandle, pane: string, text: string): Promise<Observation | Refusal>;
	function submit(handle: SessionHandle, pane: string, text: string, entry: true): Promise<Observation | Refusal | typeof STALLED>;
	async function submit(handle: SessionHandle, pane: string, text: string, entry = false): Promise<Observation | Refusal | typeof STALLED> {
		const result = await run(HERDR_CLI.prompt(pane, text, promptTimeoutMs));
		if (isRefusal(result)) return result;
		if (entry && herdrErrorCode(result) === "agent_prompt_stalled") return STALLED;
		// Herdr itself refuses a blocked agent before writing anything.
		if (herdrErrorCode(result) === "agent_blocked") return refuse("state_refused", "session is blocked; Herdr sent nothing", handle);
		// A failed, stalled or timed-out submission proves nothing about delivery.
		if (result.code !== 0) return refuse("provider_error", `herdr agent prompt failed; inspect the session state before repeating: ${failure(result)}`, handle);
		return detected(parseHerdrState(result.stdout));
	}
	/**
	 * Submits a new or resumed session's entry. A sign-in or selection dialog is
	 * not reported as `blocked` (#426 F1): Herdr sees the agent idle, types the
	 * entry into the dialog and then reports `agent_prompt_stalled`. That is not a
	 * failed session, so it keeps its tab and says what the user must look at;
	 * the entry is not proven delivered and must not be sent again unseen.
	 */
	const submitEntry = async (handle: SessionHandle, pane: string, text: string): Promise<CreateSessionResult> => {
		const after = await submit(handle, pane, text, true);
		if (after === STALLED) return { ok: true, handle, entry_submitted: false, state: "unknown", provenance: "none",
			attention: "The Executor Host never started working on its entry: a dialog (such as sign-in or a selection) may hold the terminal, and the entry text may now sit in it. Ask the user to look at this tab and answer the dialog, then resume this session; do not send the entry again before the user has seen it." };
		if (isRefusal(after)) return after;
		return { ok: true, handle, entry_submitted: true, ...after };
	};
	/** Starts the Host in the pane; a result means stop here (dialog or failure), null means go on to submit. */
	const startHost = async (handle: SessionHandle, pane: string, label: string, host: ExecutorHostKind, hostArgs: string[]) => {
		const started = await run(HERDR_CLI.agentStart(herdrAgentName(label), HOST_KIND[host], pane, hostArgs));
		if (isRefusal(started)) return { ...started, handle };
		if (started.code === 0) return null;
		// The tab shows a dialog only the user may answer; the entry was never submitted.
		if (herdrErrorCode(started) === "agent_not_ready") {
			return { ok: true as const, handle, entry_submitted: false, state: "blocked" as const, provenance: "detected" as const };
		}
		return refuse("start_failed", `herdr agent start failed: ${failure(started)}`, handle);
	};

	return {
		provider: "herdr",
		protocolVersion: SUPERVISED_SESSION_PROTOCOL,
		async probe() {
			if (options.env.HERDR_ENV !== "1") return refuse("provider_unavailable", "not running inside Herdr (HERDR_ENV is not 1)");
			if (!workspace) return refuse("provider_unavailable", "HERDR_WORKSPACE_ID is not set");
			const result = await run(HERDR_CLI.schema());
			if (isRefusal(result)) return result;
			if (result.code !== 0) return refuse("provider_unavailable", `herdr api schema failed: ${failure(result)}`);
			const protocol = protocolOf(parseJson(result.stdout));
			if (protocol === undefined) return refuse("protocol_mismatch", "herdr api schema did not state a protocol version");
			if (!(SUPPORTED_HERDR_PROTOCOLS as readonly number[]).includes(protocol)) {
				return refuse("protocol_mismatch", `herdr protocol ${protocol} is not one of ${SUPPORTED_HERDR_PROTOCOLS.join(", ")}`);
			}
			return { ok: true };
		},
		async createSession(input) {
			const invalid = validateCreateInput(input);
			if (invalid) return invalid;
			if (input.resume !== undefined) {
				const handle = input.resume;
				const found = await own(handle);
				if (isRefusal(found)) return found;
				if (found.gone) return goneRefusal(handle);
				const pane = found.ids.pane;
				const got = await run(HERDR_CLI.get(pane));
				if (isRefusal(got)) return got;
				const code = got.code === 0 ? undefined : herdrErrorCode(got);
				if (code && HOST_GONE_CODES.has(code)) {
					// The Host exited and its shell is back: start it again in the same pane.
					const restarted = await startHost(handle, pane, input.label, input.host, input.hostArgs);
					if (restarted) return restarted;
				} else {
					const current: Observation = got.code === 0 ? detected(parseHerdrState(got.stdout)) : { state: "unknown", provenance: "none" };
					const refused = resumeRefusal(handle, current);
					if (refused) return refused;
				}
				return submitEntry(handle, pane, input.entry);
			}
			if (!workspace) return refuse("provider_unavailable", "HERDR_WORKSPACE_ID is not set");
			const token = randomBytes(6).toString("hex");
			const created = await run(HERDR_CLI.tabCreate(workspace, input.cwd, `${input.label} ${herdrTokenMark(token)}`, input.env));
			if (isRefusal(created)) return created;
			if (created.code !== 0) return refuse("start_failed", `herdr tab create failed: ${failure(created)}`);
			const json = parseJson(created.stdout);
			const tab = pick(json, ["result", "tab", "tab_id"]);
			const pane = pick(json, ["result", "root_pane", "pane_id"]);
			if (typeof tab !== "string" || typeof pane !== "string" || !tab || !pane) {
				return refuse("start_failed", "herdr tab create returned no result.tab.tab_id and result.root_pane.pane_id");
			}
			const handle = encodeHerdrHandle({ workspace, tab, pane, token });
			const started = await startHost(handle, pane, input.label, input.host, input.hostArgs);
			if (started) return started;
			return submitEntry(handle, pane, input.entry);
		},
		async sendInstruction(handle, text) {
			if (!text.trim()) return refuse("invalid_input", "instruction text is empty", handle);
			const found = await own(handle);
			if (isRefusal(found)) return found;
			if (found.gone) return goneRefusal(handle);
			const ids = found.ids;
			const current = await observe(handle, ids.pane);
			if (isRefusal(current)) return current;
			const refused = instructionRefusal(handle, current);
			if (refused) return refused;
			const after = await submit(handle, ids.pane, text);
			if (isRefusal(after)) return after;
			return { ok: true, ...after };
		},
		async awaitTransition(handle, waitOptions): Promise<AwaitResult> {
			const found = await own(handle);
			if (isRefusal(found)) return found;
			if (found.gone) return { ok: true, transition: "exited", state: "unknown", provenance: "none" };
			const ids = found.ids;
			const result = await run(HERDR_CLI.wait(ids.pane, waitOptions?.timeoutMs), waitOptions?.signal);
			if (isRefusal(result)) return result;
			if (result.aborted) return { ok: true, transition: "timeout", state: "unknown", provenance: "none" };
			if (result.code === 0) {
				const state = parseHerdrState(result.stdout);
				return { ok: true, transition: "changed", ...detected(state) };
			}
			const code = herdrErrorCode(result);
			if (code === "timeout") return { ok: true, transition: "timeout", state: "unknown", provenance: "none" };
			if (code && EXITED_CODES.has(code)) return { ok: true, transition: "exited", state: "unknown", provenance: "none" };
			return refuse("provider_error", `herdr agent wait failed: ${failure(result)}`, handle);
		},
		async readOutput(handle, source, readOptions) {
			const found = await own(handle);
			if (isRefusal(found)) return found;
			if (found.gone) return refuse("state_refused", "the session's pane is gone; there is no output to read", handle);
			const ids = found.ids;
			const result = await run(HERDR_CLI.read(ids.pane, source, readOptions?.lines));
			if (isRefusal(result)) return result;
			if (result.code !== 0) return refuse("provider_error", `herdr pane read failed: ${failure(result)}`, handle);
			// `pane read` prints the terminal text itself, not JSON.
			return { ok: true, text: result.stdout, source };
		},
		async observeState(handle) {
			const found = await own(handle);
			if (isRefusal(found)) return found;
			if (found.gone) return { ok: true, state: "unknown", provenance: "none" };
			const ids = found.ids;
			const current = await observe(handle, ids.pane);
			if (isRefusal(current)) return current;
			return { ok: true, ...current };
		},
		async stopSession(handle) {
			const found = await own(handle);
			if (isRefusal(found)) return found;
			if (found.gone) return { ok: true };
			const ids = found.ids;
			// Soft interrupt first; its failure does not prevent the hard stop.
			await run(HERDR_CLI.sendKeys(ids.pane, "ctrl+c"));
			const closed = await run(HERDR_CLI.paneClose(ids.pane));
			if (isRefusal(closed)) return closed;
			if (closed.code !== 0) return refuse("provider_error", `herdr pane close failed: ${failure(closed)}`, handle);
			return { ok: true };
		},
		async closeSession(handle, record: CloseRecord) {
			const found = await own(handle);
			if (isRefusal(found)) return found;
			const unproven = closeRecordRefusal(handle, record);
			if (unproven) return unproven;
			const closed = await run(HERDR_CLI.tabClose(found.ids.tab));
			if (isRefusal(closed)) return closed;
			// Closing the root pane may already have closed its tab.
			if (closed.code !== 0 && found.gone) return { ok: true };
			if (closed.code !== 0) return refuse("provider_error", `herdr tab close failed: ${failure(closed)}`, handle);
			return { ok: true };
		},
		async reconcile(handles) {
			const sessions = [];
			for (const handle of handles) {
				const found = await own(handle);
				if (isRefusal(found)) {
					if (found.code !== "not_owned") return found;
					sessions.push({ handle, state: "unknown" as const, provenance: "none" as const, refused: found.code });
					continue;
				}
				if (found.gone) { sessions.push({ handle, state: "unknown" as const, provenance: "none" as const }); continue; }
				const current = await observe(handle, found.ids.pane);
				if (isRefusal(current)) return current;
				sessions.push({ handle, ...current });
			}
			return { ok: true, sessions };
		},
		async runCommand(input: RunCommandInput): Promise<RunCommandResult> {
			if (!input.cwd) return refuse("invalid_input", "cwd is required");
			if (!input.label || input.label.length > 32) return refuse("invalid_input", "label must be 1 to 32 characters");
			if (input.argv.length === 0) return refuse("invalid_input", "argv is empty");
			if (!workspace) return refuse("provider_unavailable", "HERDR_WORKSPACE_ID is not set");
			const token = randomBytes(6).toString("hex");
			const created = await run(HERDR_CLI.tabCreate(workspace, input.cwd, `${input.label} ${herdrTokenMark(token)}`, input.env));
			if (isRefusal(created)) return created;
			if (created.code !== 0) return refuse("start_failed", `herdr tab create failed: ${failure(created)}`);
			const json = parseJson(created.stdout);
			const tab = pick(json, ["result", "tab", "tab_id"]);
			const pane = pick(json, ["result", "root_pane", "pane_id"]);
			if (typeof tab !== "string" || typeof pane !== "string" || !tab || !pane) {
				return refuse("start_failed", "herdr tab create returned no result.tab.tab_id and result.root_pane.pane_id");
			}
			const handle = encodeHerdrHandle({ workspace, tab, pane, token });
			const { line, regex } = sentinelCommand(input.argv, token);
			const ran = await run(HERDR_CLI.paneRun(pane, line));
			if (isRefusal(ran)) return { ...ran, handle };
			if (ran.code !== 0) return refuse("start_failed", `herdr pane run failed: ${failure(ran)}`, handle);
			const waited = await run(HERDR_CLI.waitOutput(pane, regex));
			if (isRefusal(waited)) return { ...waited, handle };
			if (waited.code !== 0) return refuse("provider_error", `herdr pane wait-output failed; the command may still run in its tab: ${failure(waited)}`, handle);
			const matched = String(pick(parseJson(waited.stdout), ["result", "matched_line"]) ?? waited.stdout);
			const status = new RegExp(`IMM_${token}_DONE_([0-9]+)`).exec(matched);
			if (!status) return refuse("provider_error", "herdr pane wait-output returned no exit status", handle);
			return { ok: true, handle, exit_code: Number(status[1]) };
		},
		async sendKeys(handle, key) {
			const found = await own(handle);
			if (isRefusal(found)) return found;
			if (found.gone) return goneRefusal(handle);
			const result = await run(HERDR_CLI.sendKeys(found.ids.pane, key));
			if (isRefusal(result)) return result;
			if (result.code !== 0) return refuse("provider_error", `herdr agent send-keys failed: ${failure(result)}`, handle);
			return { ok: true };
		},
	};
}
