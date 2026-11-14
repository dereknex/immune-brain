// #426 S2: an advisory child run in a supervised session returns its result
// through the session output, read and extracted deterministically.

import { afterEach, describe, expect, it } from "bun:test";
import { runSessionCli } from "../plugins/immune-brain/runtime/session/cli";
import { ADVISORY_RESULT_INSTRUCTION, extractMarkedResult } from "../plugins/immune-brain/runtime/session/marked_result";
import { herdrCalls, herdrSubject } from "./helpers/fake-herdr";

let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); cleanup = undefined; });

describe("advisory result extraction", () => {
	it("takes the last complete marked block from decorated TUI output", () => {
		const screen = [
			"> Review src/a.ts for regressions. " + ADVISORY_RESULT_INSTRUCTION,
			"⏺ Looking at the file.",
			"⏺ IMM-ADVISORY-BEGIN",
			"  draft that was superseded",
			"  IMM-ADVISORY-END",
			"⏺ IMM-ADVISORY-BEGIN",
			"  - src/a.ts:12 drops the error.",
			"    It is swallowed in the catch.",
			"  IMM-ADVISORY-END",
			"",
		].join("\n");
		expect(extractMarkedResult(screen)).toBe("- src/a.ts:12 drops the error.\n  It is swallowed in the catch.");
	});

	it("never takes the echoed dispatch text for a result", () => {
		expect(ADVISORY_RESULT_INSTRUCTION).not.toContain("IMM-ADVISORY-BEGIN");
		expect(ADVISORY_RESULT_INSTRUCTION).not.toContain("IMM-ADVISORY-END");
		expect(extractMarkedResult(`> ${ADVISORY_RESULT_INSTRUCTION}\nthinking...`)).toBeNull();
	});

	it("is null without a closing marker or with a marker inside a word", () => {
		expect(extractMarkedResult("IMM-ADVISORY-BEGIN\npartial answer, cut off")).toBeNull();
		expect(extractMarkedResult("XIMM-ADVISORY-BEGIN\nx\nIMM-ADVISORY-END")).toBeNull();
	});
});

describe("imm-session read for an advisory session", () => {
	it("reads the requested scrollback and returns the extracted result, or null as result_untrusted", async () => {
		const made = herdrSubject();
		cleanup = made.cleanup;
		const created = await made.port.createSession({ cwd: "/repo", label: "advisory", host: "claude-code", hostArgs: [], entry: `Review it. ${ADVISORY_RESULT_INSTRUCTION}` });
		if (!created.ok) throw new Error(created.reason);
		made.control.setOutput(created.handle, "⏺ IMM-ADVISORY-BEGIN\n  no blocking issue\n  IMM-ADVISORY-END\n");
		const out = await runSessionCli(["read", created.handle, "--provider", "herdr", "--source", "scrollback", "--lines", "2000", "--extract", "advisory"], made.env);
		expect(JSON.parse(out.stdout)).toMatchObject({ ok: true, source: "scrollback", result: "no blocking issue" });
		expect(herdrCalls(made.stateFile).at(-1)).toEqual(["pane", "read", "p1", "--source", "recent-unwrapped", "--lines", "2000"]);

		made.control.setOutput(created.handle, "still thinking");
		const untrusted = await runSessionCli(["read", created.handle, "--provider", "herdr", "--extract", "advisory"], made.env);
		expect(JSON.parse(untrusted.stdout)).toMatchObject({ ok: true, result: null });
		expect((await runSessionCli(["read", created.handle, "--provider", "herdr", "--extract", "verdict"], made.env)).returncode).toBe(2);
		expect((await runSessionCli(["read", created.handle, "--provider", "herdr", "--lines", "0"], made.env)).returncode).toBe(2);
	});
});
