// herdr-core adapter for the Supervised Session Port (ADR 0038).
//
// Drives the `hc` CLI with `--json`. Every spelling and response shape comes
// from herdr-core 0.1.19 (docs/commands.md, schema/released.openrpc.json,
// crates/herdr-core/src/cli.rs; docs/reports/issue-426-herdr-provider-probe.md):
// success prints the method result on stdout, an error prints
// `{"error":{"kind","message","hint"}}` on stderr with a non-zero exit.
//
// Core infers no status: a terminal's state is what its program reports
// through OSC 7501 (provenance `reported`). The Executor Hosts report it
// natively from Claude Code 2.1.295, Pi 1.1.0 and Antigravity CLI 1.4.0, so
// creation checks the Host version first. Ownership is a random token kept as
// the terminal label `imm-session` and carried in the handle; a terminal
// without it is never touched. `--force`, which may answer a dialog, is never
// sent.

import { randomBytes } from "node:crypto";
import { parseJson, parseVersion, pick, runCommand, versionAtLeast, type CommandExec, type ExecResult } from "./exec";
import {
	closeRecordRefusal,
	instructionRefusal,
	isSessionState,
	refuse,
	resumeRefusal,
	SUPERVISED_SESSION_PROTOCOL,
	validateCreateInput,
	type AwaitResult,
	type ExecutorHostKind,
	type Observation,
	type Refusal,
	type SessionHandle,
	type SessionState,
	type SessionViewer,
	type SupervisedSessionPort,
	type ViewerResult,
} from "./supervised_session_port";

export const HERDR_CORE_MIN_VERSION: [number, number, number] = [0, 1, 19];
export const HERDR_CORE_GENERATION = 1;
/** Methods this adapter calls; a core that lacks one is refused. */
export const HERDR_CORE_METHODS = [
	"terminal.run", "terminal.get", "terminal.list", "terminal.send", "terminal.wait",
	"terminal.read", "terminal.keys", "terminal.interrupt", "terminal.kill", "terminal.rm",
] as const;
/** The first Host versions that report OSC 7501 natively. */
export const HOST_STATUS_MINIMUM: Record<ExecutorHostKind, { binary: string; version: [number, number, number] }> = {
	"claude-code": { binary: "claude", version: [2, 1, 295] },
	pi: { binary: "pi", version: [1, 1, 0] },
	antigravity: { binary: "agy", version: [1, 4, 0] },
};
export const OWNER_LABEL = "imm-session";
/** Bound for the Host's first status report after start. */
export const HERDR_CORE_READY_TIMEOUT_MS = 30_000;
/** Lines of history above the screen for a `scrollback` read. */
export const SCROLLBACK_LINES = 200;

export const HC_CLI = {
	schema: () => ["schema", "--json"],
	status: () => ["server", "status", "--json"],
	run: (name: string, cwd: string, token: string, argv: string[]) => ["run", "--bg", "--json", "--no-parent", "--name", name, "--cwd", cwd, "--label", `${OWNER_LABEL}=${token}`, "--", ...argv],
	get: (address: string) => ["get", address, "--json"],
	send: (address: string, text: string, ifState?: "idle") => ["send", address, text, ...(ifState ? ["--if", ifState] : []), "--json"],
	wait: (address: string, timeoutSeconds?: number) => ["wait", address, ...(timeoutSeconds ? ["--timeout", String(timeoutSeconds)] : []), "--json"],
	read: (address: string, lines: number) => ["read", address, "--lines", String(lines), "--json"],
	keys: (address: string, key: string) => ["keys", address, key, "--json"],
	interrupt: (address: string) => ["interrupt", address, "--json"],
	kill: (address: string) => ["kill", address, "--json"],
	rm: (address: string) => ["rm", address, "--json"],
} as const;

export interface HerdrCoreProviderOptions {
	env: Record<string, string | undefined>;
	exec?: CommandExec;
	readyTimeoutMs?: number;
	pollMs?: number;
	sleep?: (ms: number) => Promise<void>;
	/** Opens a tab the user can watch a session in; absent outside Herdr. */
	viewer?: SessionViewer;
}

/** Variables that choose which core `hc` talks to; a viewer tab needs the Parent's. */
export const HC_SELECTION_ENV = ["HC_SESSION", "XDG_RUNTIME_DIR", "XDG_STATE_HOME", "XDG_CONFIG_HOME"] as const;

interface CoreIds { address: string; token: string }

export function encodeHerdrCoreHandle(ids: CoreIds): SessionHandle {
	return `herdr-core:${encodeURIComponent(ids.address)}/${encodeURIComponent(ids.token)}`;
}

export function decodeHerdrCoreHandle(handle: SessionHandle): CoreIds | null {
	if (!handle.startsWith("herdr-core:")) return null;
	const parts = handle.slice("herdr-core:".length).split("/");
	if (parts.length !== 2 || parts.some(part => part === "")) return null;
	try {
		const [address, token] = parts.map(decodeURIComponent);
		return { address, token };
	} catch {
		return null;
	}
}

/**
 * Core's names are 1-32 of a-z 0-9 - _; salt with a 12-hex slice of the
 * session's ownership token so concurrent live terminals with identical labels
 * never collide on `--name`.
 */
export function herdrCoreName(label: string, token: string): string {
	const suffix = token.toLowerCase().replace(/[^a-z0-9_-]+/g, "").slice(0, 12);
	const folded = label.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "lane";
	if (!suffix) return folded.slice(0, 32).replace(/[-_]+$/g, "") || "lane";
	const prefixBudget = 32 - 1 - suffix.length;
	const prefix = folded.slice(0, prefixBudget).replace(/[-_]+$/g, "") || "lane".slice(0, prefixBudget);
	return `${prefix}-${suffix}`;
}

/** A status word as reported; `error` and anything unnamed are `unknown`. */
export function coreState(word: unknown): Observation {
	if (typeof word === "string" && word !== "error" && isSessionState(word) && word !== "unknown") return { state: word, provenance: "reported" };
	return { state: "unknown", provenance: "none" };
}

export function hcErrorKind(result: ExecResult): string | undefined {
	for (const text of [result.stderr, result.stdout]) {
		const kind = pick(parseJson(text.trim()), ["error", "kind"]);
		if (typeof kind === "string") return kind;
	}
	return undefined;
}

function failure(result: ExecResult): string {
	return (result.stderr || result.stdout).trim().slice(0, 500) || `hc exited ${result.code}`;
}

function newToken(): string {
	return randomBytes(12).toString("hex");
}

export function createHerdrCoreSessionProvider(options: HerdrCoreProviderOptions): SupervisedSessionPort {
	const exec: CommandExec = options.exec ?? ((command, args, signal) => runCommand(options.env, command, args, signal));
	const readyTimeoutMs = options.readyTimeoutMs ?? HERDR_CORE_READY_TIMEOUT_MS;
	const pollMs = options.pollMs ?? 250;
	const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
	const isRefusal = (value: unknown): value is Refusal => typeof value === "object" && value !== null && (value as Refusal).ok === false;

	const hc = async (args: string[], signal?: AbortSignal): Promise<ExecResult | Refusal> => {
		const result = await exec("hc", args, signal);
		if (result.missing) return refuse("provider_unavailable", "the hc executable is not on PATH");
		return result;
	};
	/** The terminal, only when it carries this session's token. */
	const owned = async (handle: SessionHandle): Promise<{ ids: CoreIds; terminal: unknown } | Refusal> => {
		const ids = decodeHerdrCoreHandle(handle);
		if (!ids) return refuse("not_owned", "handle is not a herdr-core session handle", handle);
		const result = await hc(HC_CLI.get(ids.address));
		if (isRefusal(result)) return result;
		if (result.code !== 0) {
			if (hcErrorKind(result) === "not_found") return refuse("not_owned", "no such terminal on this core", handle);
			return refuse("provider_error", `hc get failed: ${failure(result)}`, handle);
		}
		const terminal = parseJson(result.stdout);
		if (pick(terminal, ["labels", OWNER_LABEL]) !== ids.token) return refuse("not_owned", "terminal was not created for this session", handle);
		return { ids, terminal };
	};
	const observed = (terminal: unknown): Observation =>
		pick(terminal, ["state"]) === "finished" ? { state: "unknown", provenance: "none" } : coreState(pick(terminal, ["status", "state"]));

	const send = async (handle: SessionHandle, address: string, text: string, ifState?: "idle"): Promise<Observation | Refusal> => {
		const result = await hc(HC_CLI.send(address, text, ifState));
		if (isRefusal(result)) return result;
		if (result.code !== 0) {
			const kind = hcErrorKind(result);
			if (kind === "status_mismatch") return refuse("state_refused", "session is not idle; core sent nothing", handle);
			if (kind === "blocked") return refuse("state_refused", "session is blocked; core sent nothing", handle);
			return refuse("provider_error", `hc send failed; inspect the session state before repeating: ${failure(result)}`, handle);
		}
		const json = parseJson(result.stdout);
		if (pick(json, ["started"]) === true) return { state: "working", provenance: "reported" };
		return coreState(pick(json, ["status"]));
	};

	const selection = Object.fromEntries(HC_SELECTION_ENV.flatMap(key => (options.env[key] ? [[key, options.env[key]!]] : [])));
	/** Core draws nothing; `hc attach` would take over the caller's own terminal, so it runs in a new unfocused tab. */
	const openViewer = async (address: string, name: string, cwd: string): Promise<ViewerResult> => {
		if (!options.viewer) return { opened: false, reason: `not inside Herdr; watch it with \`hc attach ${address}\` in another terminal` };
		const opened = await options.viewer({ cwd, label: `${name} (hc ${address})`, argv: ["hc", "attach", address], env: selection });
		return opened.ok ? { opened: true } : { opened: false, reason: opened.reason };
	};

	const hostVersionRefusal = async (host: ExecutorHostKind): Promise<Refusal | null> => {
		const { binary, version } = HOST_STATUS_MINIMUM[host];
		const result = await exec(binary, ["--version"]);
		if (result.missing) return refuse("provider_unavailable", `the ${binary} executable is not on PATH`);
		const found = parseVersion(`${result.stdout}\n${result.stderr}`);
		if (result.code !== 0 || !found) return refuse("provider_unavailable", `${binary} --version reported no version`);
		if (!versionAtLeast(found, version)) {
			return refuse("provider_unavailable", `${binary} ${found.join(".")} does not report OSC 7501; ${version.join(".")} or newer is required on herdr-core`);
		}
		return null;
	};

	return {
		provider: "herdr-core",
		protocolVersion: SUPERVISED_SESSION_PROTOCOL,
		async probe() {
			const schema = await hc(HC_CLI.schema());
			if (isRefusal(schema)) return schema;
			if (schema.code !== 0) return refuse("provider_unavailable", `hc schema failed: ${failure(schema)}`);
			const json = parseJson(schema.stdout);
			const version = parseVersion(String(pick(json, ["info", "version"]) ?? ""));
			if (!version || !versionAtLeast(version, HERDR_CORE_MIN_VERSION)) {
				return refuse("protocol_mismatch", `herdr-core ${HERDR_CORE_MIN_VERSION.join(".")} or newer is required`);
			}
			const generation = /Protocol generation (\d+)/.exec(String(pick(json, ["info", "description"]) ?? ""));
			if (!generation || Number(generation[1]) !== HERDR_CORE_GENERATION) {
				return refuse("protocol_mismatch", `herdr-core protocol generation ${HERDR_CORE_GENERATION} is required`);
			}
			const methods = new Set((Array.isArray(pick(json, ["methods"])) ? pick(json, ["methods"]) as unknown[] : []).map(method => pick(method, ["name"])));
			const missing = HERDR_CORE_METHODS.filter(method => !methods.has(method));
			if (missing.length > 0) return refuse("protocol_mismatch", `herdr-core lacks ${missing.join(", ")}`);
			const status = await hc(HC_CLI.status());
			if (isRefusal(status)) return status;
			if (status.code !== 0) return refuse("provider_unavailable", `no herdr-core server answered: ${failure(status)}`);
			return { ok: true };
		},
		async createSession(input) {
			const invalid = validateCreateInput(input);
			if (invalid) return invalid;
			if (input.resume !== undefined) {
				const found = await owned(input.resume);
				if (isRefusal(found)) return found;
				// Core cannot restart a finished terminal in place; the caller creates a new session.
				if (pick(found.terminal, ["state"]) === "finished") {
					return refuse("state_refused", "the session's terminal finished; core cannot restart it in place; nothing was sent; create a new session", input.resume);
				}
				const current = observed(found.terminal);
				const refused = resumeRefusal(input.resume, current);
				if (refused) return refused;
				const after = await send(input.resume, found.ids.address, input.entry, current.state === "idle" ? "idle" : undefined);
				if (isRefusal(after)) return after;
				return { ok: true, handle: input.resume, entry_submitted: true, ...after };
			}
			const tooOld = await hostVersionRefusal(input.host);
			if (tooOld) return tooOld;
			const token = newToken();
			const name = herdrCoreName(input.label, token);
			// `hc run` takes no environment; `env` sets it for the Host alone.
			const envPrefix = Object.entries(input.env ?? {}).map(([key, value]) => `${key}=${value}`);
			const argv = [...(envPrefix.length > 0 ? ["env", ...envPrefix] : []), HOST_STATUS_MINIMUM[input.host].binary, ...input.hostArgs];
			const started = await hc(HC_CLI.run(name, input.cwd, token, argv));
			if (isRefusal(started)) return started;
			if (started.code !== 0) return refuse("start_failed", `hc run failed: ${failure(started)}`);
			const address = pick(parseJson(started.stdout), ["address"]);
			if (typeof address !== "string" || !address) return refuse("start_failed", "hc run returned no address");
			const handle = encodeHerdrCoreHandle({ address, token });
			// Open the viewer before anything can need the user: a startup dialog shows there.
			const viewer = options.viewer ? await openViewer(address, name, input.cwd) : undefined;
			const shown = viewer ? { viewer } : {};
			// Wait for the Host's first status report; before it, core cannot tell idle from a dialog.
			const deadline = Date.now() + readyTimeoutMs;
			for (;;) {
				const found = await owned(handle);
				if (isRefusal(found)) return { ...found, handle };
				if (pick(found.terminal, ["state"]) === "finished") return refuse("start_failed", "the Executor Host exited before it reported a status", handle);
				const current = observed(found.terminal);
				if (current.state === "blocked") return { ok: true, handle, entry_submitted: false, ...current, ...shown };
				if (current.state === "idle") {
					const after = await send(handle, address, input.entry, "idle");
					if (isRefusal(after)) return after;
					return { ok: true, handle, entry_submitted: true, ...after, ...shown };
				}
				if (Date.now() >= deadline) {
					// Silence is observed, not a dialog guessed: Claude Code 2.1.322 shows its
					// workspace trust dialog without any OSC 7501 report. Keep the terminal so
					// the user can look and answer; `--resume` then submits the entry.
					return {
						ok: true, handle, entry_submitted: false, state: "unknown", provenance: "none",
						attention: `The Executor Host reported no status within ${readyTimeoutMs} ms and the entry was not submitted. It may be waiting on a startup dialog (such as workspace trust) or report no status at all; look ${viewer?.opened ? "in its viewer tab" : `with \`hc attach ${address}\` in another terminal`}, answer it there, then resume this session.`,
						...shown,
					};
				}
				await sleep(pollMs);
			}
		},
		async sendInstruction(handle, text) {
			if (!text.trim()) return refuse("invalid_input", "instruction text is empty", handle);
			const found = await owned(handle);
			if (isRefusal(found)) return found;
			const current = observed(found.terminal);
			const refused = instructionRefusal(handle, current);
			if (refused) return refused;
			// `--if idle` makes core itself refuse any other state. `--if` cannot name
			// `done`, so a done session is sent to plainly; core still refuses `blocked`.
			const after = await send(handle, found.ids.address, text, current.state === "idle" ? "idle" : undefined);
			if (isRefusal(after)) return after;
			return { ok: true, ...after };
		},
		async awaitTransition(handle, waitOptions): Promise<AwaitResult> {
			const found = await owned(handle);
			if (isRefusal(found)) return found;
			const bounded = waitOptions?.timeoutMs !== undefined && waitOptions.timeoutMs > 0;
			for (;;) {
				const result = await hc(HC_CLI.wait(found.ids.address, bounded ? waitOptions!.timeoutMs! / 1000 : undefined), waitOptions?.signal);
				if (isRefusal(result)) return result;
				if (result.aborted) return { ok: true, transition: "timeout", state: "unknown", provenance: "none" };
				if (result.code !== 0) {
					if (hcErrorKind(result) === "finished") return { ok: true, transition: "exited", state: "unknown", provenance: "none" };
					return refuse("provider_error", `hc wait failed: ${failure(result)}`, handle);
				}
				const json = parseJson(result.stdout);
				const reason = pick(json, ["reason"]);
				if (reason === "exit") return { ok: true, transition: "exited", state: "unknown", provenance: "none" };
				if (reason === "timeout") {
					// Core checks in after its own default when no bound was asked; keep waiting.
					if (!bounded) continue;
					return { ok: true, transition: "timeout", state: "unknown", provenance: "none" };
				}
				// A message typed to the waiting Parent ends core's wait but is no transition of this session.
				if (reason === "message") continue;
				return { ok: true, transition: "changed", ...coreState(pick(json, ["status"])) };
			}
		},
		async readOutput(handle, source, readOptions) {
			const found = await owned(handle);
			if (isRefusal(found)) return found;
			const result = await hc(HC_CLI.read(found.ids.address, source === "visible" ? 0 : readOptions?.lines ?? SCROLLBACK_LINES));
			if (isRefusal(result)) return result;
			if (result.code !== 0) return refuse("provider_error", `hc read failed: ${failure(result)}`, handle);
			const text = pick(parseJson(result.stdout), ["text"]);
			return { ok: true, text: typeof text === "string" ? text : "", source };
		},
		async observeState(handle) {
			const found = await owned(handle);
			if (isRefusal(found)) return found;
			return { ok: true, ...observed(found.terminal) };
		},
		/** Opens another viewer tab, for instance after the user closed the first one. */
		async attachSession(handle) {
			const found = await owned(handle);
			if (isRefusal(found)) return found;
			if (pick(found.terminal, ["state"]) === "finished") return refuse("state_refused", "the session's terminal finished; there is nothing to watch", handle);
			const name = String(pick(found.terminal, ["name"]) ?? "lane");
			const cwd = String(pick(found.terminal, ["cwd"]) ?? options.env.PWD ?? process.cwd());
			const viewer = await openViewer(found.ids.address, name, cwd);
			return viewer.opened ? { ok: true } : refuse("provider_unavailable", viewer.reason, handle);
		},
		async stopSession(handle) {
			const found = await owned(handle);
			if (isRefusal(found)) return found;
			if (pick(found.terminal, ["state"]) === "finished") return { ok: true };
			// Soft interrupt first; its outcome does not prevent the hard stop.
			await hc(HC_CLI.interrupt(found.ids.address));
			const killed = await hc(HC_CLI.kill(found.ids.address));
			if (isRefusal(killed)) return killed;
			if (killed.code !== 0 && hcErrorKind(killed) !== "finished") return refuse("provider_error", `hc kill failed: ${failure(killed)}`, handle);
			return { ok: true };
		},
		async closeSession(handle, record) {
			const found = await owned(handle);
			if (isRefusal(found)) return found;
			const unproven = closeRecordRefusal(handle, record);
			if (unproven) return unproven;
			if (pick(found.terminal, ["state"]) !== "finished") {
				const killed = await hc(HC_CLI.kill(found.ids.address));
				if (isRefusal(killed)) return killed;
				if (killed.code !== 0 && hcErrorKind(killed) !== "finished") return refuse("provider_error", `hc kill failed: ${failure(killed)}`, handle);
			}
			const removed = await hc(HC_CLI.rm(found.ids.address));
			if (isRefusal(removed)) return removed;
			if (removed.code !== 0) return refuse("provider_error", `hc rm failed: ${failure(removed)}`, handle);
			return { ok: true };
		},
		async reconcile(handles) {
			const sessions = [];
			for (const handle of handles) {
				const found = await owned(handle);
				if (isRefusal(found)) {
					if (found.code === "provider_unavailable") return found;
					sessions.push({ handle, state: "unknown" as SessionState, provenance: "none" as const, ...(found.code === "not_owned" ? { refused: found.code } : {}) });
					continue;
				}
				sessions.push({ handle, ...observed(found.terminal) });
			}
			return { ok: true, sessions };
		},
		async sendKeys(handle, key) {
			const found = await owned(handle);
			if (isRefusal(found)) return found;
			const result = await hc(HC_CLI.keys(found.ids.address, key));
			if (isRefusal(result)) return result;
			if (result.code !== 0) return refuse("provider_error", `hc keys failed: ${failure(result)}`, handle);
			return { ok: true };
		},
	};
}
