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

import { spawn } from "node:child_process";
import {
	closeProofRefusal,
	instructionRefusal,
	isSessionState,
	refuse,
	resumeRefusal,
	SUPERVISED_SESSION_PROTOCOL,
	validateCreateInput,
	type AwaitResult,
	type CloseProof,
	type ExecutorHostKind,
	type Observation,
	type OutputSource,
	type Refusal,
	type SessionHandle,
	type SessionState,
	type SupervisedSessionPort,
} from "./supervised_session_port";

/** Herdr socket protocol versions this adapter is pinned to (Herdr TUI 0.9.x). */
export const SUPPORTED_HERDR_PROTOCOLS = [22] as const;
/** The bound for the entry and instruction submissions: until `working` or `blocked`. */
export const HERDR_PROMPT_TIMEOUT_MS = 30_000;

const HOST_KIND: Record<ExecutorHostKind, string> = { "claude-code": "claude", pi: "pi" };

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
	tabCreate: (workspace: string, cwd: string, label: string) => ["tab", "create", "--workspace", workspace, "--cwd", cwd, "--label", label, "--no-focus"],
	agentStart: (label: string, kind: string, pane: string, hostArgs: string[]) => ["agent", "start", label, "--kind", kind, "--pane", pane, "--", ...hostArgs],
	prompt: (pane: string, text: string, timeoutMs: number) => ["agent", "prompt", pane, text, "--wait", "--until", "working", "--until", "blocked", "--timeout", String(timeoutMs)],
	// Herdr's default wait ignores `unknown`; the port wakes on every non-working state.
	wait: (pane: string, timeoutMs?: number) => [
		"agent", "wait", pane, "--until", "idle", "--until", "done", "--until", "blocked", "--until", "unknown",
		...(timeoutMs ? ["--timeout", String(timeoutMs)] : []),
	],
	get: (pane: string) => ["agent", "get", pane],
	read: (pane: string, source: OutputSource) => ["pane", "read", pane, "--source", source === "visible" ? "visible" : "recent-unwrapped"],
	sendKeys: (pane: string, key: string) => ["agent", "send-keys", pane, key],
	paneClose: (pane: string) => ["pane", "close", pane],
	tabClose: (tab: string) => ["tab", "close", tab],
} as const;

export interface HerdrExecResult {
	code: number | null;
	stdout: string;
	stderr: string;
	/** The `herdr` executable was not found. */
	missing?: boolean;
}
export type HerdrExec = (args: string[]) => Promise<HerdrExecResult>;

export interface HerdrProviderOptions {
	env: Record<string, string | undefined>;
	exec?: HerdrExec;
	promptTimeoutMs?: number;
}

export function defaultHerdrExec(env: Record<string, string | undefined>): HerdrExec {
	return args => new Promise(resolve => {
		let stdout = "";
		let stderr = "";
		let settled = false;
		const finish = (result: HerdrExecResult) => { if (!settled) { settled = true; resolve(result); } };
		const child = spawn("herdr", args, { env: env as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] });
		child.stdout.on("data", chunk => { stdout += chunk; });
		child.stderr.on("data", chunk => { stderr += chunk; });
		child.once("error", (error: NodeJS.ErrnoException) => finish({ code: null, stdout, stderr: stderr || error.message, missing: error.code === "ENOENT" }));
		child.once("close", code => finish({ code, stdout, stderr }));
	});
}

interface HerdrIds { workspace: string; tab: string; pane: string }

export function encodeHerdrHandle(ids: HerdrIds): SessionHandle {
	return `herdr:${[ids.workspace, ids.tab, ids.pane].map(encodeURIComponent).join("/")}`;
}

export function decodeHerdrHandle(handle: SessionHandle): HerdrIds | null {
	if (!handle.startsWith("herdr:")) return null;
	const parts = handle.slice("herdr:".length).split("/");
	if (parts.length !== 3 || parts.some(part => part === "")) return null;
	try {
		const [workspace, tab, pane] = parts.map(decodeURIComponent);
		return { workspace, tab, pane };
	} catch {
		return null;
	}
}

function parseJson(text: string): unknown {
	try { return JSON.parse(text); } catch { return undefined; }
}

function pick(value: unknown, path: string[]): unknown {
	let current = value;
	for (const key of path) {
		if (current === null || typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[key];
	}
	return current;
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

	const run = async (args: string[]): Promise<HerdrExecResult | Refusal> => {
		const result = await exec(args);
		if (result.missing) return refuse("provider_unavailable", "the herdr executable is not on PATH");
		return result;
	};
	/** Ownership: the handle decodes and names the Parent's own workspace. */
	const own = (handle: SessionHandle): HerdrIds | Refusal => {
		const ids = decodeHerdrHandle(handle);
		if (!ids) return refuse("not_owned", "handle is not a Herdr session handle", handle);
		if (!workspace || ids.workspace !== workspace) return refuse("not_owned", "session is not in the Parent's own Herdr workspace", handle);
		return ids;
	};
	const isRefusal = (value: unknown): value is Refusal => typeof value === "object" && value !== null && (value as Refusal).ok === false;

	const observe = async (handle: SessionHandle, pane: string): Promise<Observation | Refusal> => {
		const result = await run(HERDR_CLI.get(pane));
		if (isRefusal(result)) return result;
		// No readable state is `unknown`, never a guess; every rule treats it as not idle.
		if (result.code !== 0) return { state: "unknown", provenance: "none" };
		return detected(parseHerdrState(result.stdout));
	};
	const submit = async (handle: SessionHandle, pane: string, text: string): Promise<Observation | Refusal> => {
		const result = await run(HERDR_CLI.prompt(pane, text, promptTimeoutMs));
		if (isRefusal(result)) return result;
		// Herdr itself refuses a blocked agent before writing anything.
		if (herdrErrorCode(result) === "agent_blocked") return refuse("state_refused", "session is blocked; Herdr sent nothing", handle);
		// A failed, stalled or timed-out submission proves nothing about delivery.
		if (result.code !== 0) return refuse("provider_error", `herdr agent prompt failed; inspect the session state before repeating: ${failure(result)}`, handle);
		return detected(parseHerdrState(result.stdout));
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
				const ids = own(input.resume);
				if (isRefusal(ids)) return ids;
				const current = await observe(input.resume, ids.pane);
				if (isRefusal(current)) return current;
				const refused = resumeRefusal(input.resume, current);
				if (refused) return refused;
				const after = await submit(input.resume, ids.pane, input.entry);
				if (isRefusal(after)) return after;
				return { ok: true, handle: input.resume, entry_submitted: true, ...after };
			}
			if (!workspace) return refuse("provider_unavailable", "HERDR_WORKSPACE_ID is not set");
			const created = await run(HERDR_CLI.tabCreate(workspace, input.cwd, input.label));
			if (isRefusal(created)) return created;
			if (created.code !== 0) return refuse("start_failed", `herdr tab create failed: ${failure(created)}`);
			const json = parseJson(created.stdout);
			const tab = pick(json, ["result", "tab", "tab_id"]);
			const pane = pick(json, ["result", "root_pane", "pane_id"]);
			if (typeof tab !== "string" || typeof pane !== "string" || !tab || !pane) {
				return refuse("start_failed", "herdr tab create returned no result.tab.tab_id and result.root_pane.pane_id");
			}
			const handle = encodeHerdrHandle({ workspace, tab, pane });
			const started = await run(HERDR_CLI.agentStart(herdrAgentName(input.label), HOST_KIND[input.host], pane, input.hostArgs));
			if (isRefusal(started)) return { ...started, handle };
			if (started.code !== 0) {
				// The tab shows a dialog only the user may answer; the entry was never submitted.
				if (herdrErrorCode(started) === "agent_not_ready") {
					return { ok: true, handle, entry_submitted: false, state: "blocked", provenance: "detected" };
				}
				return refuse("start_failed", `herdr agent start failed: ${failure(started)}`, handle);
			}
			const after = await submit(handle, pane, input.entry);
			if (isRefusal(after)) return after;
			return { ok: true, handle, entry_submitted: true, ...after };
		},
		async sendInstruction(handle, text) {
			const ids = own(handle);
			if (isRefusal(ids)) return ids;
			if (!text.trim()) return refuse("invalid_input", "instruction text is empty", handle);
			const current = await observe(handle, ids.pane);
			if (isRefusal(current)) return current;
			const refused = instructionRefusal(handle, current);
			if (refused) return refused;
			const after = await submit(handle, ids.pane, text);
			if (isRefusal(after)) return after;
			return { ok: true, ...after };
		},
		async awaitTransition(handle, waitOptions): Promise<AwaitResult> {
			const ids = own(handle);
			if (isRefusal(ids)) return ids;
			const result = await run(HERDR_CLI.wait(ids.pane, waitOptions?.timeoutMs));
			if (isRefusal(result)) return result;
			if (result.code === 0) {
				const state = parseHerdrState(result.stdout);
				return { ok: true, transition: "changed", ...detected(state) };
			}
			const code = herdrErrorCode(result);
			if (code === "timeout") return { ok: true, transition: "timeout", state: "unknown", provenance: "none" };
			if (code && EXITED_CODES.has(code)) return { ok: true, transition: "exited", state: "unknown", provenance: "none" };
			return refuse("provider_error", `herdr agent wait failed: ${failure(result)}`, handle);
		},
		async readOutput(handle, source) {
			const ids = own(handle);
			if (isRefusal(ids)) return ids;
			const result = await run(HERDR_CLI.read(ids.pane, source));
			if (isRefusal(result)) return result;
			if (result.code !== 0) return refuse("provider_error", `herdr pane read failed: ${failure(result)}`, handle);
			// `pane read` prints the terminal text itself, not JSON.
			return { ok: true, text: result.stdout, source };
		},
		async observeState(handle) {
			const ids = own(handle);
			if (isRefusal(ids)) return ids;
			const current = await observe(handle, ids.pane);
			if (isRefusal(current)) return current;
			return { ok: true, ...current };
		},
		async stopSession(handle) {
			const ids = own(handle);
			if (isRefusal(ids)) return ids;
			// Soft interrupt first; its failure does not prevent the hard stop.
			await run(HERDR_CLI.sendKeys(ids.pane, "ctrl+c"));
			const closed = await run(HERDR_CLI.paneClose(ids.pane));
			if (isRefusal(closed)) return closed;
			if (closed.code !== 0) return refuse("provider_error", `herdr pane close failed: ${failure(closed)}`, handle);
			return { ok: true };
		},
		async closeSession(handle, proof: CloseProof) {
			const ids = own(handle);
			if (isRefusal(ids)) return ids;
			const unproven = closeProofRefusal(handle, proof);
			if (unproven) return unproven;
			const closed = await run(HERDR_CLI.tabClose(ids.tab));
			if (isRefusal(closed)) return closed;
			if (closed.code !== 0) return refuse("provider_error", `herdr tab close failed: ${failure(closed)}`, handle);
			return { ok: true };
		},
		async reconcile(handles) {
			const sessions = [];
			for (const handle of handles) {
				const ids = own(handle);
				if (isRefusal(ids)) { sessions.push({ handle, state: "unknown" as const, provenance: "none" as const, refused: ids.code }); continue; }
				const current = await observe(handle, ids.pane);
				if (isRefusal(current)) return current;
				sessions.push({ handle, ...current });
			}
			return { ok: true, sessions };
		},
		async sendKeys(handle, key) {
			const ids = own(handle);
			if (isRefusal(ids)) return ids;
			const result = await run(HERDR_CLI.sendKeys(ids.pane, key));
			if (isRefusal(result)) return result;
			if (result.code !== 0) return refuse("provider_error", `herdr agent send-keys failed: ${failure(result)}`, handle);
			return { ok: true };
		},
	};
}
