// Host-neutral phase entry: which literal user input enters planning or
// execution, the per-session entry state, and whether an operation is admitted.
// Pure: a Host supplies its local names and owns where the state is stored.
// ADR 0025: a literal run entry mints the session's entry token, which stands in
// for the native gate of the run-internal authority operations. Only the Host
// input event writes it; no tool call or tool argument can.

export type PhaseEntry = "plan" | "run";

/** The Host this recognition runs for: Pi's `skill:` resolves a same-named local skill first. */
export type PhaseHost = "claude" | "pi";

/** The user's and project's local names that can shadow a packaged bare name (ADR 0031). */
export interface LocalNames {
	/** Body of a same-named user or project command alias (possibly empty), or nothing when it does not exist; throws when it exists but cannot be read. */
	alias(name: string): string | null | undefined;
	/** Whether a same-named user or project skill exists. */
	skill(name: string): boolean;
}

export const NO_LOCAL_NAMES: LocalNames = { alias: () => null, skill: () => false };

export const RUN_ENTRY_REQUIRED = "run_entry_required";
export const PHASE_ENTRY_REQUIRED = "phase_entry_required";

export const PHASE_ENTRY_RECOVERY: Record<typeof RUN_ENTRY_REQUIRED | typeof PHASE_ENTRY_REQUIRED, string> = {
	[RUN_ENTRY_REQUIRED]: "ask the user to enter /drive (or /immune-brain:drive on Claude Code) in the current Host",
	[PHASE_ENTRY_REQUIRED]: "ask the user to enter the Skill themselves in the current Host",
};

const PACKAGED: Record<string, PhaseEntry> = {
	"draw-up": "plan",
	"clarify": "plan",
	"drive": "run",
};
const PLUGIN_PREFIX = "immune-brain:";
const SKILL_PREFIX = "skill:";
const ALIAS_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
// ADR 0031: only a marked mention in an alias body names a phase Skill, never a bare prose word.
const SKILL_MENTION = /(?<![A-Za-z0-9_-])(?:\/(?:immune-brain:|skill:)?|immune-brain:|skill:)(draw-up|clarify|drive)(?![A-Za-z0-9_-])/g;
// The Host-expanded form of a slash command, anchored at the start of the prompt.
const EXPANDED = /^<command-message>[^<]*<\/command-message>\s*<command-name>\/([^\s<]+)<\/command-name>/;
const RAW = /^\/(\S+)/;

function stripPrefix(name: string): string {
	for (const prefix of [PLUGIN_PREFIX, SKILL_PREFIX]) if (name.startsWith(prefix)) return name.slice(prefix.length);
	return name;
}

/** The packaged phase Skill a Skill-tool name refers to, or null for any other Skill. */
export function packagedPhaseSkill(name: string): keyof typeof PACKAGED | null {
	// Trimmed first: a Host that resolves a padded Skill name must not skip the gate.
	const trimmed = name.trim();
	const bare = stripPrefix(trimmed.startsWith("/") ? trimmed.slice(1) : trimmed);
	return Object.hasOwn(PACKAGED, bare) ? bare : null;
}

function packaged(name: string): PhaseEntry | null {
	return Object.hasOwn(PACKAGED, name) ? PACKAGED[name] : null;
}

/** A local skill that cannot be read counts as present: the bare form then mints nothing. */
function localSkill(names: LocalNames, name: string): boolean {
	try { return names.skill(name); } catch { return true; }
}

function aliasEntry(body: string): PhaseEntry | null {
	const targets = new Set([...body.matchAll(SKILL_MENTION)].map((match) => match[1]));
	if (targets.size !== 1) return null;
	return PACKAGED[[...targets][0]];
}

/**
 * The phase a literal prompt enters, or null. Only a leading slash command
 * counts (ADR 0031): `immune-brain:<name>`; `skill:<name>` unless Pi resolves
 * it to a same-named local skill; a bare packaged name unless a same-named
 * local command (read as an alias) or skill shadows it; or a user alias whose
 * body marks exactly one phase Skill. A mention anywhere else is not an entry.
 */
export function recognizePhaseEntry(text: string, names: LocalNames, host: PhaseHost): PhaseEntry | null {
	const command = (RAW.exec(text) ?? EXPANDED.exec(text))?.[1];
	if (!command) return null;
	if (command.startsWith(PLUGIN_PREFIX)) return packaged(command.slice(PLUGIN_PREFIX.length));
	if (command.startsWith(SKILL_PREFIX)) {
		const name = command.slice(SKILL_PREFIX.length);
		const entry = packaged(name);
		return entry && host === "pi" && localSkill(names, name) ? null : entry;
	}
	if (!ALIAS_NAME.test(command)) return null;
	let body: string | null | undefined;
	try { body = names.alias(command); } catch { return null; }
	// An empty alias is still a local command: it shadows the packaged name.
	if (body !== null && body !== undefined) return aliasEntry(body);
	const entry = packaged(command);
	return entry && !localSkill(names, command) ? entry : null;
}

export interface PhaseEntryState {
	run_live: boolean;
	/** The entry token the live run entry minted; null without one, or for a pre-token log line. */
	token: string | null;
	/** The workspace realpath the token is bound to. */
	workspace: string | null;
}

export const NO_PHASE_ENTRY: PhaseEntryState = { run_live: false, token: null, workspace: null };

/** What a literal run entry mints: one token bound to the entry's workspace. */
export interface EntryTokenMint {
	token: string;
	workspace: string;
}

/** Why a live token stops admitting before a new literal entry. */
export type EntryTokenRevocation = "spent";

/** One literal prompt: a run entry goes live with its token, a plan entry revokes it. */
export function applyPrompt(state: PhaseEntryState, entry: PhaseEntry | null, mint?: EntryTokenMint): PhaseEntryState {
	if (entry === "run") return { run_live: true, token: mint?.token ?? null, workspace: mint?.workspace ?? null };
	if (entry === "plan") return NO_PHASE_ENTRY;
	return state;
}

export function phaseEntryLogLine(entry: PhaseEntry | null, mint?: EntryTokenMint): string {
	if (entry === "run" && mint) return `${JSON.stringify({ v: 2, entry, token: mint.token, workspace: mint.workspace })}\n`;
	return `${JSON.stringify({ v: 1, entry })}\n`;
}

/** The line that ends a token when its bound run is terminal. */
export function entryRevocationLogLine(reason: EntryTokenRevocation): string {
	return `${JSON.stringify({ v: 2, revoked: reason })}\n`;
}

const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/** Folds a session's entry log. Any malformed line makes the whole log unreadable. */
export function reducePhaseEntryLog(text: string): PhaseEntryState | null {
	let state = NO_PHASE_ENTRY;
	for (const line of text.split("\n")) {
		if (!line) continue;
		let record: unknown;
		try { record = JSON.parse(line); } catch { return null; }
		if (!record || typeof record !== "object") return null;
		const { v, entry, token, workspace, revoked } = record as Record<string, unknown>;
		if (v === 1) {
			if (entry !== null && entry !== "plan" && entry !== "run") return null;
			state = applyPrompt(state, entry);
		} else if (v === 2 && revoked === "spent" && entry === undefined) {
			state = NO_PHASE_ENTRY;
		} else if (v === 2 && entry === "run" && nonEmpty(token) && nonEmpty(workspace)) {
			state = applyPrompt(state, entry, { token, workspace });
		} else return null;
	}
	return state;
}

export type PhaseOperation =
	| { kind: "tool"; name: "enroll" | "start_unattended_batch" | "retire_stale_batch" }
	| { kind: "skill"; skill: keyof typeof PACKAGED };

export type PhaseAdmission =
	| { ok: true }
	| { ok: false; reason_code: typeof RUN_ENTRY_REQUIRED | typeof PHASE_ENTRY_REQUIRED; detail: string; recovery_action: string };

function refuse(reason_code: typeof RUN_ENTRY_REQUIRED | typeof PHASE_ENTRY_REQUIRED, detail: string): PhaseAdmission {
	return { ok: false, reason_code, detail, recovery_action: PHASE_ENTRY_RECOVERY[reason_code] };
}

/**
 * Whether the session's entry state admits one operation. `state` is null when
 * the store could not be read, which refuses `enroll`, `start_unattended_batch`,
 * `retire_stale_batch` and the `drive` Skill. The Planner and Brainstorm Skills are never refused.
 */
export function admitPhaseOperation(operation: PhaseOperation, state: PhaseEntryState | null): PhaseAdmission {
	if (operation.kind === "tool") {
		if (state?.run_live) return { ok: true };
		return refuse(RUN_ENTRY_REQUIRED, `${operation.name} needs a literal-user drive entry in this session`);
	}
	if (operation.skill !== "drive") return { ok: true };
	if (state?.run_live) return { ok: true };
	return refuse(PHASE_ENTRY_REQUIRED, "drive is entered by the user, not by a model Skill call");
}

/** The single-line message both Hosts return for a refusal. */
export function phaseRefusalMessage(refusal: Extract<PhaseAdmission, { ok: false }>): string {
	return `${refusal.reason_code}: ${refusal.detail}; recovery: ${refusal.recovery_action}`;
}
