// A stand-in Herdr for Supervised Session Port tests: the adapter runs its real
// exec seam against tests/fixtures/fake-herdr/herdr, whose state is a JSON file.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { createHerdrSessionProvider, encodeHerdrHandle } from "../../plugins/immune-brain/runtime/session/herdr_provider";
import type { SessionHandle, SessionState, StateProvenance, SupervisedSessionPort } from "../../plugins/immune-brain/runtime/session/supervised_session_port";

export interface SessionControl {
	setState(handle: SessionHandle, state: SessionState): void;
	exit(handle: SessionHandle): void;
	setOutput(handle: SessionHandle, text: string): void;
	submitted(handle: SessionHandle): string[];
	sessionCount(): number;
	blockNextStart(): void;
	foreignHandle(): SessionHandle;
}
export interface SessionSubject {
	port: SupervisedSessionPort;
	control: SessionControl;
	/** Where this provider's states come from: its own detection, or the program's report. */
	provenance: StateProvenance;
	cleanup(): void;
}

export const FAKE_HERDR_DIR = resolve(__dirname, "../fixtures/fake-herdr");

/** The recorded argv of every `herdr` invocation, in order. */
export function herdrCalls(stateFile: string): string[][] {
	return JSON.parse(readFileSync(stateFile, "utf8")).calls ?? [];
}

export function herdrSubject(extraState: Record<string, unknown> = {}): SessionSubject & { stateFile: string; env: Record<string, string> } {
	const dir = mkdtempSync(join(tmpdir(), "imm-fake-herdr-"));
	const stateFile = join(dir, "state.json");
	writeFileSync(stateFile, JSON.stringify({ protocol: 22, panes: {}, ...extraState }));
	const env = {
		...process.env,
		PATH: `${FAKE_HERDR_DIR}${delimiter}${process.env.PATH ?? ""}`,
		FAKE_HERDR_STATE: stateFile,
		HERDR_ENV: "1",
		HERDR_WORKSPACE_ID: "w-parent",
	} as Record<string, string>;
	const read = () => JSON.parse(readFileSync(stateFile, "utf8"));
	const write = (state: unknown) => writeFileSync(stateFile, JSON.stringify(state));
	const paneOf = (handle: SessionHandle) => handle.split("/").pop()!;
	const update = (handle: SessionHandle, fn: (pane: Record<string, unknown>) => void) => {
		const state = read();
		fn(state.panes[paneOf(handle)]);
		write(state);
	};
	return {
		stateFile,
		env,
		port: createHerdrSessionProvider({ env }),
		provenance: "detected",
		control: {
			setState: (handle, value) => update(handle, pane => { pane.state = value; }),
			exit: handle => update(handle, pane => { pane.closed = true; }),
			setOutput: (handle, text) => update(handle, pane => { pane.output = text; }),
			submitted: handle => read().panes[paneOf(handle)]?.prompts ?? [],
			sessionCount: () => Object.keys(read().panes).length,
			blockNextStart: () => { const state = read(); state.not_ready_next = true; write(state); },
			foreignHandle: () => encodeHerdrHandle({ workspace: "w-user", tab: "t9", pane: "p9" }),
		},
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}

