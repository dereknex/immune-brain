// A stand-in herdr-core for Supervised Session Port tests: the adapter runs its
// real exec seam against tests/fixtures/fake-herdr-core/hc, whose state is a
// JSON file, and stand-in Executor Hosts that answer only `--version`.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { createHerdrCoreSessionProvider, encodeHerdrCoreHandle, type HerdrCoreProviderOptions } from "../../plugins/immune-brain/runtime/session/herdr_core_provider";
import type { SessionHandle } from "../../plugins/immune-brain/runtime/session/supervised_session_port";
import type { SessionSubject } from "./fake-herdr";

export const FAKE_HERDR_CORE_DIR = resolve(__dirname, "../fixtures/fake-herdr-core");

export function hcCalls(stateFile: string): string[][] {
	return JSON.parse(readFileSync(stateFile, "utf8")).calls ?? [];
}

export function herdrCoreSubject(extraState: Record<string, unknown> = {}, options: Partial<HerdrCoreProviderOptions> = {}, hostVersion = "2.1.322"):
	SessionSubject & { stateFile: string; env: Record<string, string> } {
	const dir = mkdtempSync(join(tmpdir(), "imm-fake-hc-"));
	const stateFile = join(dir, "state.json");
	writeFileSync(stateFile, JSON.stringify({ terminals: {}, ...extraState }));
	const env = {
		...process.env,
		PATH: `${FAKE_HERDR_CORE_DIR}${delimiter}${process.env.PATH ?? ""}`,
		FAKE_HC_STATE: stateFile,
		FAKE_HOST_VERSION: hostVersion,
	} as Record<string, string>;
	const read = () => JSON.parse(readFileSync(stateFile, "utf8"));
	const write = (state: unknown) => writeFileSync(stateFile, JSON.stringify(state));
	const addressOf = (handle: SessionHandle) => decodeURIComponent(handle.slice("herdr-core:".length).split("/")[0]);
	const update = (handle: SessionHandle, fn: (terminal: Record<string, unknown>) => void) => {
		const state = read();
		fn(state.terminals[addressOf(handle)]);
		write(state);
	};
	return {
		stateFile,
		env,
		port: createHerdrCoreSessionProvider({ env, pollMs: 10, ...options }),
		provenance: "reported",
		control: {
			// `unknown` on core is a program that reports nothing.
			setState: (handle, value) => update(handle, terminal => { terminal.status = value === "unknown" ? null : value; }),
			exit: handle => update(handle, terminal => { terminal.state = "finished"; terminal.status = null; }),
			setOutput: (handle, text) => update(handle, terminal => { terminal.output = text; }),
			submitted: handle => read().terminals[addressOf(handle)]?.sends ?? [],
			sessionCount: () => Object.keys(read().terminals).length,
			blockNextStart: () => { const state = read(); state.initial_status = "blocked"; write(state); },
			// A live terminal of the user's own, which carries no session token.
			foreignHandle: () => {
				const state = read();
				state.terminals.t99 = { name: "user-shell", labels: {}, state: "live", status: "idle", sends: [], keys: [], output: "" };
				write(state);
				return encodeHerdrCoreHandle({ address: "t99", token: "guessed" });
			},
		},
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}
