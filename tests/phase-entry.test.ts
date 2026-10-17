import { describe, expect, test } from "bun:test";
import {
	admitPhaseOperation,
	applyPrompt,
	entryRevocationLogLine,
	NO_PHASE_ENTRY,
	packagedPhaseSkill,
	phaseEntryLogLine,
	PHASE_ENTRY_REQUIRED,
	recognizePhaseEntry,
	reducePhaseEntryLog,
	RUN_ENTRY_REQUIRED,
	type PhaseEntry,
	type PhaseEntryState,
} from "../plugins/immune-brain/runtime/assurance/phase_entry";

const ALIASES: Record<string, string> = {
	loop: "Resume or execute an Immune-Brain task using the `imm-loop` skill.\n\nArguments: $ARGUMENTS\n",
	planner: "Plan a Spec or TaskIntent using the `imm-planner` skill.\n\nArguments: $ARGUMENTS\n",
	brain: "Clarify requirements using the `imm-brainstorm` skill.\n",
	go: "Execute using the `imm-run` skill.\n",
	both: "Use `imm-planner`, then `imm-run`.\n",
	fix: "Fix the failing check.\n",
	repeat: "Use the `imm-run` skill. imm-run resumes the task.\n",
	near: "Use the my-imm-run-helper skill.\n",
};
const readAlias = (name: string) => ALIASES[name] ?? null;
const recognize = (text: string) => recognizePhaseEntry(text, readAlias);

function after(...entries: Array<PhaseEntry | null>): PhaseEntryState {
	return entries.reduce((state, entry) => applyPrompt(state, entry), NO_PHASE_ENTRY);
}

const LIVE = { run_live: true, token: null, workspace: null };
const MINT = { token: "token-1", workspace: "/work/repo" };

describe("phase entry recognition", () => {
	test("packaged names enter their phase, bare or prefixed, with or without arguments", () => {
		expect(recognize("/imm-run")).toBe("run");
		expect(recognize("/imm-run explicit-phase-entry-s2")).toBe("run");
		expect(recognize("/immune-brain:imm-run task-a")).toBe("run");
		expect(recognize("/skill:imm-run task-a")).toBe("run");
		expect(recognize("/imm-planner")).toBe("plan");
		expect(recognize("/immune-brain:imm-planner add a gate")).toBe("plan");
		expect(recognize("/skill:imm-brainstorm")).toBe("plan");
		expect(recognize("/imm-brainstorm\nmore text")).toBe("plan");
	});

	test("a user alias enters the phase of the one Skill its body names", () => {
		expect(recognize("/loop task-a")).toBe("run");
		expect(recognize("/go")).toBe("run");
		expect(recognize("/planner")).toBe("plan");
		expect(recognize("/brain an idea")).toBe("plan");
		// Naming the same Skill twice is still exactly one Skill.
		expect(recognize("/repeat")).toBe("run");
	});

	test("the Host-expanded command form is recognized only at the start of the prompt", () => {
		const expanded = "<command-message>loop</command-message>\n<command-name>/loop</command-name>\n<command-args>task-a</command-args>";
		expect(recognize(expanded)).toBe("run");
		expect(recognize("<command-message>immune-brain:imm-planner</command-message>\n<command-name>/immune-brain:imm-planner</command-name>")).toBe("plan");
		expect(recognize(`A report quoted this:\n${expanded}`)).toBeNull();
		expect(recognize("<command-name>/loop</command-name>")).toBeNull();
	});

	test("a mention, an unknown command and an ambiguous alias are not entries", () => {
		expect(recognize("please run imm-run now")).toBeNull();
		expect(recognize("then enter /imm-run to continue")).toBeNull();
		expect(recognize(" /imm-run")).toBeNull();
		expect(recognize("confirm")).toBeNull();
		expect(recognize("")).toBeNull();
		expect(recognize("/run task-a")).toBeNull();
		expect(recognize("/fix")).toBeNull();
		expect(recognize("/both")).toBeNull();
		expect(recognize("/near")).toBeNull();
		expect(recognize("/imm-runner")).toBeNull();
		expect(recognize("/imm-loop")).toBeNull();
		expect(recognize("/other:imm-run")).toBeNull();
		expect(recognize("/Users/derek/imm-run")).toBeNull();
		expect(recognize("/../loop")).toBeNull();
	});

	test("an alias reader that throws is no entry", () => {
		expect(recognizePhaseEntry("/loop", () => { throw new Error("unreadable"); })).toBeNull();
	});

	test("only the three packaged phase Skills are phase Skills", () => {
		expect(packagedPhaseSkill("imm-run")).toBe("imm-run");
		expect(packagedPhaseSkill("immune-brain:imm-planner")).toBe("imm-planner");
		expect(packagedPhaseSkill("/immune-brain:imm-brainstorm")).toBe("imm-brainstorm");
		expect(packagedPhaseSkill(" imm-run\n")).toBe("imm-run");
		expect(packagedPhaseSkill("immune-brain:imm-retro")).toBeNull();
		expect(packagedPhaseSkill("planner")).toBeNull();
		expect(packagedPhaseSkill("imm-loop")).toBeNull();
	});
});

describe("phase entry state", () => {
	test("a run entry stays live across later prompts", () => {
		expect(after("run", null, null)).toEqual(LIVE);
	});

	test("a later plan entry revokes the run entry; a later run entry restores it", () => {
		expect(after("run", null, "plan")).toEqual(NO_PHASE_ENTRY);
		expect(after("run", "plan", null)).toEqual(NO_PHASE_ENTRY);
		expect(after("run", "plan", "run")).toEqual(LIVE);
	});

	test("a run entry's token survives later prompts until a plan entry, a newer entry or its spend", () => {
		const minted = applyPrompt(NO_PHASE_ENTRY, "run", MINT);
		expect(minted).toEqual({ run_live: true, ...MINT });
		expect(applyPrompt(minted, null)).toEqual(minted);
		expect(applyPrompt(minted, "plan")).toEqual(NO_PHASE_ENTRY);
		expect(applyPrompt(minted, "run", { ...MINT, token: "token-2" }).token).toBe("token-2");
		const log = [phaseEntryLogLine("run", MINT), phaseEntryLogLine(null)].join("");
		expect(reducePhaseEntryLog(log)).toEqual(minted);
		expect(reducePhaseEntryLog(log + entryRevocationLogLine("spent"))).toEqual(NO_PHASE_ENTRY);
		for (const line of [{ v: 2, entry: "run", token: "", workspace: "/w" }, { v: 2, entry: "run", token: "t" }, { v: 2, revoked: "paused" }, { v: 2, entry: "run", revoked: "spent" }])
			expect(reducePhaseEntryLog(`${JSON.stringify(line)}\n`)).toBeNull();
	});

	test("the log folds to the same state and any malformed line is unreadable", () => {
		const log = [phaseEntryLogLine("run"), phaseEntryLogLine(null), phaseEntryLogLine("plan"), phaseEntryLogLine("run")].join("");
		expect(reducePhaseEntryLog(log)).toEqual(after("run", null, "plan", "run"));
		expect(reducePhaseEntryLog("")).toEqual(NO_PHASE_ENTRY);
		expect(reducePhaseEntryLog(`${phaseEntryLogLine("run")}not json\n`)).toBeNull();
		expect(reducePhaseEntryLog(`${JSON.stringify({ v: 2, entry: "run" })}\n`)).toBeNull();
		expect(reducePhaseEntryLog(`${JSON.stringify({ v: 1, entry: "execute" })}\n`)).toBeNull();
		expect(reducePhaseEntryLog(`${JSON.stringify({ v: 1 })}\n`)).toBeNull();
		expect(reducePhaseEntryLog("null\n")).toBeNull();
		// A line written before the state lost its plan flag still reduces.
		expect(reducePhaseEntryLog(`${JSON.stringify({ v: 1, entry: "plan" })}\n${JSON.stringify({ v: 1, entry: "run" })}\n`)).toEqual(LIVE);
	});
});

describe("phase entry admission", () => {
	const enroll = { kind: "tool", name: "enroll" } as const;
	const batch = { kind: "tool", name: "start_unattended_batch" } as const;
	const retire = { kind: "tool", name: "retire_stale_batch" } as const;
	const skill = (name: "imm-run" | "imm-planner" | "imm-brainstorm") => ({ kind: "skill", skill: name }) as const;

	test("enroll, batch start and batch retirement need a live run entry", () => {
		for (const operation of [enroll, batch, retire]) {
			expect(admitPhaseOperation(operation, after("run"))).toEqual({ ok: true });
			expect(admitPhaseOperation(operation, after("run", null, null))).toEqual({ ok: true });
			for (const state of [NO_PHASE_ENTRY, after(null), after("plan"), after("run", "plan"), null]) {
				expect(admitPhaseOperation(operation, state)).toMatchObject({
					ok: false,
					reason_code: RUN_ENTRY_REQUIRED,
					recovery_action: "ask the user to enter imm-run in the current Host",
				});
			}
		}
	});

	test("the imm-run Skill is admitted on a live run entry, including after later prompts", () => {
		expect(admitPhaseOperation(skill("imm-run"), after("run"))).toEqual({ ok: true });
		expect(admitPhaseOperation(skill("imm-run"), after("run", null, null))).toEqual({ ok: true });
		expect(admitPhaseOperation(skill("imm-run"), after("run", "plan", "run", null))).toEqual({ ok: true });
	});

	test("the imm-run Skill is refused without a live run entry", () => {
		for (const state of [NO_PHASE_ENTRY, after(null), after("plan"), after("run", "plan"), after("run", null, "plan"), null]) {
			expect(admitPhaseOperation(skill("imm-run"), state)).toMatchObject({
				ok: false,
				reason_code: PHASE_ENTRY_REQUIRED,
				recovery_action: "ask the user to enter the Skill themselves in the current Host",
			});
		}
	});

	test("the Planner and Brainstorm Skills are never refused, for a fresh, a live, a revoked and an unreadable state", () => {
		for (const name of ["imm-planner", "imm-brainstorm"] as const) {
			for (const state of [NO_PHASE_ENTRY, after("run"), after("run", null, null), after("run", "plan"), after("plan"), null]) {
				expect(admitPhaseOperation(skill(name), state)).toEqual({ ok: true });
			}
		}
	});
});
