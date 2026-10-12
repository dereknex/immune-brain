// Host-neutral phase entry: which literal user input enters planning or
// execution, the per-session entry state, and whether an operation is admitted.
// Pure: a Host supplies the alias reader and owns where the state is stored.
// A live entry mints no authority; it only lets the existing native gate open.

export type PhaseEntry = "plan" | "run";

/** Returns the body of a user command alias, or nothing when it does not exist. */
export type AliasReader = (name: string) => string | null | undefined;

export const RUN_ENTRY_REQUIRED = "run_entry_required";
export const PHASE_ENTRY_REQUIRED = "phase_entry_required";

export const PHASE_ENTRY_RECOVERY: Record<typeof RUN_ENTRY_REQUIRED | typeof PHASE_ENTRY_REQUIRED, string> = {
	[RUN_ENTRY_REQUIRED]: "ask the user to enter imm-run in the current Host",
	[PHASE_ENTRY_REQUIRED]: "ask the user to enter the Skill themselves in the current Host",
};

const PACKAGED: Record<string, PhaseEntry> = {
	"imm-planner": "plan",
	"imm-brainstorm": "plan",
	"imm-run": "run",
};
// An alias body may still name the retired Loop skill.
const ALIAS_TARGETS: Record<string, PhaseEntry> = { ...PACKAGED, "imm-loop": "run" };
const PREFIXES = ["immune-brain:", "skill:"];
const ALIAS_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const SKILL_MENTION = /(?<![A-Za-z0-9_-])imm-(?:planner|brainstorm|run|loop)(?![A-Za-z0-9_-])/g;
// The Host-expanded form of a slash command, anchored at the start of the prompt.
const EXPANDED = /^<command-message>[^<]*<\/command-message>\s*<command-name>\/([^\s<]+)<\/command-name>/;
const RAW = /^\/(\S+)/;

function stripPrefix(name: string): string {
	for (const prefix of PREFIXES) if (name.startsWith(prefix)) return name.slice(prefix.length);
	return name;
}

/** The packaged phase Skill a Skill-tool name refers to, or null for any other Skill. */
export function packagedPhaseSkill(name: string): keyof typeof PACKAGED | null {
	// Trimmed first: a Host that resolves a padded Skill name must not skip the gate.
	const trimmed = name.trim();
	const bare = stripPrefix(trimmed.startsWith("/") ? trimmed.slice(1) : trimmed);
	return Object.hasOwn(PACKAGED, bare) ? bare : null;
}

/**
 * The phase a literal prompt enters, or null. Only a leading slash command
 * counts: a packaged name, a prefixed packaged name, or a user alias whose body
 * names exactly one phase Skill. A mention anywhere else is not an entry.
 */
export function recognizePhaseEntry(text: string, readAlias: AliasReader): PhaseEntry | null {
	const command = (RAW.exec(text) ?? EXPANDED.exec(text))?.[1];
	if (!command) return null;
	const packaged = packagedPhaseSkill(command);
	if (packaged) return PACKAGED[packaged];
	if (!ALIAS_NAME.test(command)) return null;
	let body: string | null | undefined;
	try { body = readAlias(command); } catch { return null; }
	if (!body) return null;
	const targets = new Set(body.match(SKILL_MENTION) ?? []);
	if (targets.size !== 1) return null;
	return ALIAS_TARGETS[[...targets][0]] ?? null;
}

export interface PhaseEntryState {
	run_live: boolean;
	/** The latest literal entry was a plan entry; the revision-owner guard reads it. */
	plan_latest: boolean;
}

export const NO_PHASE_ENTRY: PhaseEntryState = { run_live: false, plan_latest: false };

/** One literal prompt: a run entry goes live, a plan entry revokes it. */
export function applyPrompt(state: PhaseEntryState, entry: PhaseEntry | null): PhaseEntryState {
	if (entry === "run") return { run_live: true, plan_latest: false };
	if (entry === "plan") return { run_live: false, plan_latest: true };
	return state;
}

export function phaseEntryLogLine(entry: PhaseEntry | null): string {
	return `${JSON.stringify({ v: 1, entry })}\n`;
}

/** Folds a session's entry log. Any malformed line makes the whole log unreadable. */
export function reducePhaseEntryLog(text: string): PhaseEntryState | null {
	let state = NO_PHASE_ENTRY;
	for (const line of text.split("\n")) {
		if (!line) continue;
		let record: unknown;
		try { record = JSON.parse(line); } catch { return null; }
		if (!record || typeof record !== "object") return null;
		const { v, entry } = record as { v?: unknown; entry?: unknown };
		if (v !== 1 || (entry !== null && entry !== "plan" && entry !== "run")) return null;
		state = applyPrompt(state, entry);
	}
	return state;
}

export type PhaseOperation =
	| { kind: "tool"; name: "enroll" | "start_unattended_batch" }
	| { kind: "skill"; skill: keyof typeof PACKAGED };

export type PhaseAdmission =
	| { ok: true }
	| { ok: false; reason_code: typeof RUN_ENTRY_REQUIRED | typeof PHASE_ENTRY_REQUIRED; detail: string; recovery_action: string };

function refuse(reason_code: typeof RUN_ENTRY_REQUIRED | typeof PHASE_ENTRY_REQUIRED, detail: string): PhaseAdmission {
	return { ok: false, reason_code, detail, recovery_action: PHASE_ENTRY_RECOVERY[reason_code] };
}

/**
 * Whether the session's entry state admits one operation. `state` is null when
 * the store could not be read, which refuses `enroll`, `start_unattended_batch`
 * and the `imm-run` Skill. The Planner and Brainstorm Skills are never refused.
 * `context` is accepted for Host callers; admission no longer depends on it.
 */
export function admitPhaseOperation(
	operation: PhaseOperation,
	state: PhaseEntryState | null,
	context?: { activeClaim: boolean },
): PhaseAdmission {
	void context;
	if (operation.kind === "tool") {
		if (state?.run_live) return { ok: true };
		return refuse(RUN_ENTRY_REQUIRED, `${operation.name} needs a literal-user imm-run entry in this session`);
	}
	if (operation.skill !== "imm-run") return { ok: true };
	if (state?.run_live) return { ok: true };
	return refuse(PHASE_ENTRY_REQUIRED, "imm-run is entered by the user, not by a model Skill call");
}

/** The single-line message both Hosts return for a refusal. */
export function phaseRefusalMessage(refusal: Extract<PhaseAdmission, { ok: false }>): string {
	return `${refusal.reason_code}: ${refusal.detail}; recovery: ${refusal.recovery_action}`;
}
