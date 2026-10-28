import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_ALIAS_BYTES } from "../plugins/immune-brain/runtime/assurance/alias_file";
import {
	admitPhaseOperation,
	applyPrompt,
	entryRevocationLogLine,
	NO_PHASE_ENTRY,
	packagedPhaseSkill,
	phaseEntryLogLine,
	PHASE_ENTRY_REQUIRED,
	recognizePhaseEntry,
	type LocalNames,
	type PhaseHost,
	reducePhaseEntryLog,
	RUN_ENTRY_REQUIRED,
	type PhaseEntry,
	type PhaseEntryState,
} from "../plugins/immune-brain/runtime/assurance/phase_entry";
import { claudeLocalNames } from "../plugins/immune-brain/runtime/claude/lane_guard";

const ALIASES: Record<string, string> = {
	planner: "Plan a Spec or TaskIntent using `/draw-up`.\n\nArguments: $ARGUMENTS\n",
	brain: "Clarify requirements with immune-brain:clarify.\n",
	go: "Execute with `/drive`.\n",
	pi: "/skill:drive ${@:-resume}\n",
	both: "Use `/draw-up`, then `/drive`.\n",
	fix: "Fix the failing check.\n",
	repeat: "Use `/drive`. /immune-brain:drive resumes the task.\n",
	near: "Use the /my-drive-helper skill.\n",
	prose: "drive the build to green.\n",
	path: "Read docs/drive and notes/drive.md.\n",
	old: "Resume using the `imm-run` skill, or /imm-loop.\n",
	oldslash: "/imm-run $ARGUMENTS\n",
};
const SKILLS = new Set<string>();
const NAMES: LocalNames = { alias: (name) => ALIASES[name] ?? null, skill: (name) => SKILLS.has(name) };
const recognize = (text: string, host: PhaseHost = "claude") => recognizePhaseEntry(text, NAMES, host);
const withSkill = (name: string, check: () => void) => {
	SKILLS.add(name);
	try { check(); } finally { SKILLS.delete(name); }
};

function after(...entries: Array<PhaseEntry | null>): PhaseEntryState {
	return entries.reduce((state, entry) => applyPrompt(state, entry), NO_PHASE_ENTRY);
}

const LIVE = { run_live: true, token: null, workspace: null };
const MINT = { token: "token-1", workspace: "/work/repo" };

describe("phase entry recognition", () => {
	test("packaged names enter their phase, bare or prefixed, with or without arguments, on both Hosts", () => {
		for (const host of ["claude", "pi"] as const) {
			expect(recognize("/drive", host)).toBe("run");
			expect(recognize("/drive explicit-phase-entry-s2", host)).toBe("run");
			expect(recognize("/immune-brain:drive task-a", host)).toBe("run");
			expect(recognize("/skill:drive task-a", host)).toBe("run");
			expect(recognize("/draw-up", host)).toBe("plan");
			expect(recognize("/immune-brain:draw-up add a gate", host)).toBe("plan");
			expect(recognize("/skill:clarify", host)).toBe("plan");
			expect(recognize("/clarify\nmore text", host)).toBe("plan");
		}
	});

	test("a user alias enters the phase of the one Skill its body marks", () => {
		expect(recognize("/go")).toBe("run");
		expect(recognize("/pi task-a")).toBe("run");
		expect(recognize("/planner")).toBe("plan");
		expect(recognize("/brain an idea")).toBe("plan");
		// Marking the same Skill twice, in two forms, is still exactly one Skill.
		expect(recognize("/repeat")).toBe("run");
	});

	test("an alias body's bare prose word or path segment is not a mention", () => {
		expect(recognize("/prose")).toBeNull();
		expect(recognize("/path")).toBeNull();
		expect(recognize("/near")).toBeNull();
	});

	test("a same-named local command is read as an alias, never as the packaged name", () => {
		const shadow: Record<string, string> = { drive: "Ship it with `/immune-brain:drive`.\n", clarify: "No phase mention here.\n" };
		const names: LocalNames = { alias: (name) => shadow[name] ?? null, skill: () => false };
		expect(recognizePhaseEntry("/drive", names, "claude")).toBe("run");
		expect(recognizePhaseEntry("/clarify", names, "pi")).toBeNull();
		expect(recognizePhaseEntry("/immune-brain:clarify", names, "claude")).toBe("plan");
	});

	test("a same-named local skill shadows the bare name on both Hosts and skill: on Pi only", () => {
		withSkill("draw-up", () => {
			expect(recognize("/draw-up", "claude")).toBeNull();
			expect(recognize("/draw-up", "pi")).toBeNull();
			expect(recognize("/skill:draw-up", "pi")).toBeNull();
			expect(recognize("/skill:draw-up", "claude")).toBe("plan");
			expect(recognize("/immune-brain:draw-up", "claude")).toBe("plan");
		});
	});

	test("the Host-expanded command form is recognized only at the start of the prompt", () => {
		const expanded = "<command-message>go</command-message>\n<command-name>/go</command-name>\n<command-args>task-a</command-args>";
		expect(recognize(expanded)).toBe("run");
		expect(recognize("<command-message>immune-brain:draw-up</command-message>\n<command-name>/immune-brain:draw-up</command-name>")).toBe("plan");
		expect(recognize(`A report quoted this:\n${expanded}`)).toBeNull();
		expect(recognize("<command-name>/go</command-name>")).toBeNull();
	});

	test("retired names, a mention, an unknown command and an ambiguous alias are not entries", () => {
		for (const retired of ["/imm-run", "/imm-loop", "/immune-brain:imm-run", "/skill:imm-run", "/imm-planner", "/imm-brainstorm", "/old", "/oldslash"])
			expect(recognize(retired)).toBeNull();
		expect(recognize("please run drive now")).toBeNull();
		expect(recognize("then enter /drive to continue")).toBeNull();
		expect(recognize(" /drive")).toBeNull();
		expect(recognize("confirm")).toBeNull();
		expect(recognize("")).toBeNull();
		expect(recognize("/run task-a")).toBeNull();
		expect(recognize("/fix")).toBeNull();
		expect(recognize("/both")).toBeNull();
		expect(recognize("/driver")).toBeNull();
		expect(recognize("/immune-brain:revisit")).toBeNull();
		expect(recognize("/other:drive")).toBeNull();
		expect(recognize("/Users/derek/drive")).toBeNull();
		expect(recognize("/../go")).toBeNull();
	});

	test("a same-named command that is empty, oversized or not a file shadows the bare name", () => {
		const home = mkdtempSync(join(tmpdir(), "imm-phase-entry-home-"));
		const cwd = mkdtempSync(join(tmpdir(), "imm-phase-entry-cwd-"));
		try {
			const commands = join(home, ".claude", "commands");
			mkdirSync(commands, { recursive: true });
			const names = claudeLocalNames(cwd, home);
			expect(recognizePhaseEntry("/drive", names, "claude")).toBe("run");
			writeFileSync(join(commands, "drive.md"), "");
			expect(recognizePhaseEntry("/drive", names, "claude")).toBeNull();
			writeFileSync(join(commands, "drive.md"), "x".repeat(MAX_ALIAS_BYTES + 1));
			expect(recognizePhaseEntry("/drive", names, "claude")).toBeNull();
			rmSync(join(commands, "drive.md"));
			mkdirSync(join(commands, "drive.md"));
			expect(recognizePhaseEntry("/drive", names, "claude")).toBeNull();
			expect(recognizePhaseEntry("/immune-brain:drive", names, "claude")).toBe("run");
		} finally {
			rmSync(home, { recursive: true, force: true });
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("a reader that throws enters nothing", () => {
		const aliasThrows: LocalNames = { alias: () => { throw new Error("unreadable"); }, skill: () => false };
		expect(recognizePhaseEntry("/go", aliasThrows, "claude")).toBeNull();
		const skillThrows: LocalNames = { alias: () => null, skill: () => { throw new Error("unreadable"); } };
		expect(recognizePhaseEntry("/drive", skillThrows, "claude")).toBeNull();
		expect(recognizePhaseEntry("/skill:drive", skillThrows, "pi")).toBeNull();
		expect(recognizePhaseEntry("/immune-brain:drive", skillThrows, "claude")).toBe("run");
	});

	test("only the three packaged phase Skills are phase Skills", () => {
		expect(packagedPhaseSkill("drive")).toBe("drive");
		expect(packagedPhaseSkill("immune-brain:draw-up")).toBe("draw-up");
		expect(packagedPhaseSkill("/immune-brain:clarify")).toBe("clarify");
		expect(packagedPhaseSkill(" drive\n")).toBe("drive");
		expect(packagedPhaseSkill("immune-brain:revisit")).toBeNull();
		expect(packagedPhaseSkill("planner")).toBeNull();
		for (const retired of ["imm-run", "imm-loop", "immune-brain:imm-planner"]) expect(packagedPhaseSkill(retired)).toBeNull();
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
	const skill = (name: "drive" | "draw-up" | "clarify") => ({ kind: "skill", skill: name }) as const;

	test("enroll, batch start and batch retirement need a live run entry", () => {
		for (const operation of [enroll, batch, retire]) {
			expect(admitPhaseOperation(operation, after("run"))).toEqual({ ok: true });
			expect(admitPhaseOperation(operation, after("run", null, null))).toEqual({ ok: true });
			for (const state of [NO_PHASE_ENTRY, after(null), after("plan"), after("run", "plan"), null]) {
				expect(admitPhaseOperation(operation, state)).toMatchObject({
					ok: false,
					reason_code: RUN_ENTRY_REQUIRED,
					recovery_action: "ask the user to enter /drive (or /immune-brain:drive on Claude Code) in the current Host",
				});
			}
		}
	});

	test("the drive Skill is admitted on a live run entry, including after later prompts", () => {
		expect(admitPhaseOperation(skill("drive"), after("run"))).toEqual({ ok: true });
		expect(admitPhaseOperation(skill("drive"), after("run", null, null))).toEqual({ ok: true });
		expect(admitPhaseOperation(skill("drive"), after("run", "plan", "run", null))).toEqual({ ok: true });
	});

	test("the drive Skill is refused without a live run entry", () => {
		for (const state of [NO_PHASE_ENTRY, after(null), after("plan"), after("run", "plan"), after("run", null, "plan"), null]) {
			expect(admitPhaseOperation(skill("drive"), state)).toMatchObject({
				ok: false,
				reason_code: PHASE_ENTRY_REQUIRED,
				recovery_action: "ask the user to enter the Skill themselves in the current Host",
			});
		}
	});

	test("the Planner and Brainstorm Skills are never refused, for a fresh, a live, a revoked and an unreadable state", () => {
		for (const name of ["draw-up", "clarify"] as const) {
			for (const state of [NO_PHASE_ENTRY, after("run"), after("run", null, null), after("run", "plan"), after("plan"), null]) {
				expect(admitPhaseOperation(skill(name), state)).toEqual({ ok: true });
			}
		}
	});
});
