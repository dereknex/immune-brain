// Supervised Session Port (ADR 0038, docs/reference/supervised-session-port.md).
//
// A capability contract for the session a Parent launches a Lane Executor in.
// It speaks only of session, handle, state and instruction; a provider's own
// vocabulary (tabs, panes, workspaces, sockets) stays inside its adapter. The
// Kernel and the batch runtime never import this module: the Parent's Loop
// contract consumes it through `imm-session`.

export const SUPERVISED_SESSION_PROTOCOL = 1 as const;

export const SESSION_STATES = ["working", "blocked", "idle", "done", "unknown"] as const;
export type SessionState = (typeof SESSION_STATES)[number];
/** Where a state came from: a provider's own detection, the session's own report, or nowhere. */
export type StateProvenance = "detected" | "reported" | "none";
/** A new provider adds a literal here; the port itself does not change. */
export type SessionProviderName = "herdr" | "herdr-core" | "fake";
/** Opaque to every caller. Only the adapter that minted a handle decodes it. */
export type SessionHandle = string;
/** The Executor Hosts the Lane configuration accepts (`executor_host`); tests/supervised-session-herdr.test.ts checks each against it. */
export const EXECUTOR_HOSTS = ["claude-code", "pi", "antigravity"] as const;
export type ExecutorHostKind = (typeof EXECUTOR_HOSTS)[number];
export type OutputSource = "visible" | "scrollback";

export type RefusalCode =
	| "invalid_input"
	| "provider_unavailable"
	| "protocol_mismatch"
	| "not_owned"
	| "state_refused"
	| "start_failed"
	| "close_unproven"
	| "provider_error";

/** A precise refusal: nothing beyond what `reason` states was done. */
export interface Refusal {
	ok: false;
	code: RefusalCode;
	reason: string;
	handle?: SessionHandle;
}

export interface Observation {
	state: SessionState;
	provenance: StateProvenance;
}

export interface CreateSessionInput {
	/** The Lane path; the session's working directory, so its Kernel root is the Lane's store. */
	cwd: string;
	/** A short human label, at most 32 characters. */
	label: string;
	host: ExecutorHostKind;
	/** Only the arguments that load the plugin and the resolved model and effort. */
	hostArgs: string[];
	/** The single explicit `drive` entry for the Lane's task, and nothing else. */
	entry: string;
	/**
	 * Submit the entry again in this existing session instead of creating
	 * another. A provider that can restarts an exited Host in the same place
	 * first; one that cannot refuses, and the caller creates a new session.
	 */
	resume?: SessionHandle;
	/** Extra environment for the Host, applied when the session is created; ignored on resume. */
	env?: Record<string, string>;
}

/**
 * `entry_submitted: false` means the session exists but needs the user before
 * its entry: a dialog, or a Host that has not reported yet. `attention` says
 * what the provider observed and how the user can look at the session.
 */
export type CreateSessionResult = ({ ok: true; handle: SessionHandle; entry_submitted: boolean; attention?: string; viewer?: ViewerResult } & Observation) | Refusal;

/** Whether a provider without a screen of its own opened a tab the user can watch the session in. */
export type ViewerResult = { opened: true } | { opened: false; reason: string };

/**
 * Opens, without taking focus, a tab in the Parent's workspace that runs one
 * viewing command (such as `hc attach <address>`). Not waited on, not a
 * session, and never a source of state. Supplied by the Herdr adapter, the
 * only module that spawns `herdr`.
 */
export type SessionViewer = (input: { cwd: string; label: string; argv: string[]; env?: Record<string, string> }) => Promise<StopResult>;
export type ObserveResult = ({ ok: true } & Observation) | Refusal;
export type InstructionResult = ({ ok: true } & Observation) | Refusal;
/**
 * `changed`: the session is no longer `working`. `exited`: the session's process
 * is gone. `timeout`: the bound elapsed and nothing is claimed about the state.
 * `events_lost`: the provider dropped events; reconcile before acting.
 */
export type Transition = "changed" | "exited" | "timeout" | "events_lost";
export interface RunCommandInput {
	cwd: string;
	/** A short human label, at most 32 characters. */
	label: string;
	argv: string[];
	env?: Record<string, string>;
}
export type RunCommandResult = { ok: true; handle: SessionHandle; exit_code: number } | Refusal;

export interface AwaitOptions { timeoutMs?: number; signal?: AbortSignal }
export type AwaitResult = ({ ok: true; transition: Transition } & Observation) | Refusal;
export type ReadResult = { ok: true; text: string; source: OutputSource } | Refusal;
export type StopResult = { ok: true } | Refusal;
export type CloseResult = { ok: true } | Refusal;
export type ReconcileEntry = { handle: SessionHandle } & Observation & { refused?: RefusalCode };
export type ReconcileResult = { ok: true; sessions: ReconcileEntry[] } | Refusal;

/**
 * The Executor close rule's record. The batch runner decides the rule from
 * Kernel and batch facts (the child is integrated, its audit pair is reachable
 * from the batch head) and records the close in `session_closes` at the tick
 * that integrates the child. `imm-session close` checks these two fields
 * against that record before calling the provider; the provider adds the third
 * fact: the handle is its own, so only a session the Parent created closes.
 */
export interface CloseRecord {
	task_id: string;
	/** `session_closes[].at` from the batch record. */
	recorded_at: string;
}

export interface SupervisedSessionPort {
	readonly provider: SessionProviderName;
	readonly protocolVersion: number;
	/** Admission probe: the provider is installed, reachable and speaks a supported protocol. */
	probe(): Promise<{ ok: true } | Refusal>;

	// ── required capabilities ──
	createSession(input: CreateSessionInput): Promise<CreateSessionResult>;
	/** Sends one text instruction only to an owned session observed `idle` or `done`; otherwise sends nothing. */
	sendInstruction(handle: SessionHandle, text: string): Promise<InstructionResult>;
	/**
	 * Returns once the session is not `working` (at once if it already is not),
	 * or at the timeout. An aborted `signal` ends the wait early as `timeout`
	 * and leaves no provider process behind.
	 */
	awaitTransition(handle: SessionHandle, options?: AwaitOptions): Promise<AwaitResult>;
	/** For people to read. Never Kernel progress evidence. */
	readOutput(handle: SessionHandle, source: OutputSource, options?: { lines?: number }): Promise<ReadResult>;
	/** Reports `unknown` when no state is available; never invents `idle` or `done`. */
	observeState(handle: SessionHandle): Promise<ObserveResult>;
	stopSession(handle: SessionHandle): Promise<StopResult>;
	closeSession(handle: SessionHandle, record: CloseRecord): Promise<CloseResult>;
	/** Lists only the handles the caller owns; there is no "all sessions" listing. */
	reconcile(owned: SessionHandle[]): Promise<ReconcileResult>;

	// ── optional capabilities: absent means the documented degrade path ──
	waitForState?(handle: SessionHandle, states: SessionState[], options?: { timeoutMs?: number }): Promise<AwaitResult>;
	sendKeys?(handle: SessionHandle, key: "esc" | "ctrl+c"): Promise<StopResult>;
	subscribeEvents?(handle: SessionHandle, onEvent: (event: { kind: "state" | "exited" | "events_lost"; state?: SessionState }) => void): () => void;
	snapshot?(owned: SessionHandle[]): Promise<ReconcileResult>;
	manageWorktree?(action: "create" | "open" | "remove", path: string): Promise<StopResult>;
	reportState?(handle: SessionHandle, state: SessionState): Promise<StopResult>;
	attachSession?(handle: SessionHandle): Promise<StopResult>;
	/**
	 * Runs one command (not an agent) in a new session the user can watch, and
	 * returns once it has finished, with its exit status. The command's own
	 * files are the result; the session's output is for people only.
	 */
	runCommand?(input: RunCommandInput): Promise<RunCommandResult>;
	/** Reserved and unfilled: verdicts return through the file protocol. */
	readonly structuredResult?: never;
}

export const REQUIRED_CAPABILITIES = [
	"createSession",
	"sendInstruction",
	"awaitTransition",
	"readOutput",
	"observeState",
	"stopSession",
	"closeSession",
	"reconcile",
] as const;

export const OPTIONAL_CAPABILITIES = [
	"waitForState",
	"sendKeys",
	"subscribeEvents",
	"snapshot",
	"manageWorktree",
	"reportState",
	"attachSession",
	"runCommand",
] as const;

export type OptionalCapability = (typeof OPTIONAL_CAPABILITIES)[number];

/**
 * Admission: a missing required capability or a different protocol version
 * refuses the provider outright; it is never a degrade. The result names the
 * optional capabilities the provider lacks, so each degrade can be reported.
 */
export function admitSessionProvider(port: SupervisedSessionPort): { ok: true; missing_optional: OptionalCapability[] } | Refusal {
	if (port.protocolVersion !== SUPERVISED_SESSION_PROTOCOL) {
		return refuse("protocol_mismatch", `provider ${port.provider} implements port protocol ${port.protocolVersion}; ${SUPERVISED_SESSION_PROTOCOL} is required`);
	}
	const record = port as unknown as Record<string, unknown>;
	const missing = REQUIRED_CAPABILITIES.filter(name => typeof record[name] !== "function");
	if (missing.length > 0) return refuse("provider_unavailable", `provider ${port.provider} lacks required capabilities: ${missing.join(", ")}`);
	if (record.structuredResult !== undefined) return refuse("protocol_mismatch", "structuredResult is reserved and must stay unfilled");
	return { ok: true, missing_optional: OPTIONAL_CAPABILITIES.filter(name => typeof record[name] !== "function") };
}

export function refuse(code: RefusalCode, reason: string, handle?: SessionHandle): Refusal {
	return handle === undefined ? { ok: false, code, reason } : { ok: false, code, reason, handle };
}

/**
 * The instruction rule shared by every adapter: only a session ready for input
 * receives text. `done` is ready too: it is idle with a finished turn not yet
 * seen, and on providers without a "seen" action it never becomes `idle`.
 */
export function instructionRefusal(handle: SessionHandle, observed: Observation): Refusal | null {
	if (observed.state === "idle" || observed.state === "done") return null;
	return refuse("state_refused", `session is ${observed.state}; an instruction is sent only to an idle or done session and nothing was sent`, handle);
}

/** The resume rule: the entry is submitted again only to a session that has stopped working without a dialog. */
export function resumeRefusal(handle: SessionHandle, observed: Observation): Refusal | null {
	if (observed.state === "idle" || observed.state === "done") return null;
	return refuse("state_refused", `session is ${observed.state}; the entry is resubmitted only to an idle or done session and nothing was sent`, handle);
}

/** The close record must be the runner's: a task id and a canonical timestamp. */
export function closeRecordRefusal(handle: SessionHandle, record: CloseRecord | undefined): Refusal | null {
	const unmet: string[] = [];
	if (typeof record?.task_id !== "string" || !/^[a-z0-9][a-z0-9._-]*$/i.test(record.task_id)) unmet.push("task_id");
	const at = record?.recorded_at;
	if (typeof at !== "string" || !Number.isFinite(Date.parse(at)) || new Date(Date.parse(at)).toISOString() !== at) unmet.push("recorded_at");
	if (unmet.length === 0) return null;
	return refuse("close_unproven", `no recorded session close: ${unmet.join(", ")}; take task_id and at from the batch report's session_closes`, handle);
}

export function validateCreateInput(input: CreateSessionInput): Refusal | null {
	if (!input.cwd) return refuse("invalid_input", "cwd is required");
	if (!input.label || input.label.length > 32) return refuse("invalid_input", "label must be 1 to 32 characters");
	if (!(EXECUTOR_HOSTS as readonly string[]).includes(input.host)) return refuse("invalid_input", `host must be one of ${EXECUTOR_HOSTS.join(", ")}`);
	if (!input.entry || input.entry.trim() === "") return refuse("invalid_input", "entry is required");
	for (const [key, value] of Object.entries(input.env ?? {})) {
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return refuse("invalid_input", `env name ${JSON.stringify(key)} is not a valid variable name`);
		if (typeof value !== "string" || /[\0\n\r]/.test(value)) return refuse("invalid_input", `env ${key} must be a single-line string`);
	}
	return null;
}

export function isSessionState(value: unknown): value is SessionState {
	return typeof value === "string" && (SESSION_STATES as readonly string[]).includes(value);
}
