// Supervised Session Port boundary (ADR 0038).
//
// 1. The port lives in runtime/session/ and depends on nothing but itself and
//    Node builtins: no Kernel, no batch runtime, no Host adapter.
// 2. Nothing in the runtime imports runtime/session/ except the CLI router,
//    so the Kernel and the batch runtime stay unaware that a provider exists.
// 3. Only the Herdr adapter spawns `herdr`; the packaged Loop contract drives
//    sessions through `imm-session` alone, and only the port reference
//    documents the Herdr command mapping.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { collectImportSpecifiers } from "./helpers/import_specifiers";

const ROOT = resolve(__dirname, "..");
const PLUGIN = "plugins/immune-brain";
const RUNTIME = `${PLUGIN}/runtime`;
const SESSION = `${RUNTIME}/session`;
const ROUTER = `${RUNTIME}/v4_runtime.ts`;
const HERDR_ADAPTER = `${SESSION}/herdr_provider.ts`;
/** The port reference documents the provider mapping; it is the one packaged text allowed to name Herdr commands. */
const PORT_REFERENCE = `${PLUGIN}/dist/docs/reference/supervised-session-port.md`;

function files(base: string, extensions: string[]): Array<{ path: string; source: string }> {
	return readdirSync(join(ROOT, base), { recursive: true })
		.map(entry => `${base}/${String(entry).split("\\").join("/")}`)
		.filter(path => extensions.some(extension => path.endsWith(extension)))
		.map(path => ({ path, source: readFileSync(join(ROOT, path), "utf8") }));
}

function targets(path: string, source: string): string[] {
	return collectImportSpecifiers(source)
		.map(({ specifier }) => specifier)
		.filter((specifier): specifier is string => specifier !== null)
		.map(specifier => (specifier.startsWith(".") ? posix.normalize(posix.join(posix.dirname(path), specifier)) : specifier));
}

const HERDR_COMMAND = /\bherdr\s+(?:tab|agent|pane|api|worktree)\s+[a-z]|(?:spawn|runCommand)\([^)]*["']herdr["']/;

describe("Supervised Session Port boundary", () => {
	const runtime = [...files(RUNTIME, [".ts"]), ...files(`${PLUGIN}/.pi-extension`, [".ts"])];

	test("runtime/session imports only its own modules and Node builtins", () => {
		const session = runtime.filter(file => file.path.startsWith(`${SESSION}/`));
		expect(session.map(file => file.path).sort()).toEqual([
			`${SESSION}/cli.ts`,
			`${SESSION}/exec.ts`,
			`${SESSION}/fake_provider.ts`,
			`${SESSION}/herdr_core_provider.ts`,
			`${SESSION}/herdr_provider.ts`,
			`${SESSION}/supervised_session_port.ts`,
		]);
		const outside = session.flatMap(file => targets(file.path, file.source)
			.filter(target => !target.startsWith("node:") && !target.startsWith(`${SESSION}/`))
			.map(target => `${file.path} -> ${target}`));
		expect(outside).toEqual([]);
	});

	test("only the CLI router imports runtime/session", () => {
		const importers = runtime
			.filter(file => !file.path.startsWith(`${SESSION}/`))
			.filter(file => targets(file.path, file.source).some(target => target === SESSION || target.startsWith(`${SESSION}/`)))
			.map(file => file.path);
		expect(importers).toEqual([ROUTER]);
	});

	test("only the Herdr adapter spawns herdr, and no packaged contract spells a herdr command", () => {
		const spelled = [
			...runtime,
			...files(`${RUNTIME}/prompts`, [".md"]),
			...files(`${PLUGIN}/dist`, [".md"]),
			...files(`${PLUGIN}/skills`, [".md"]),
		].filter(file => file.path !== PORT_REFERENCE && HERDR_COMMAND.test(file.source)).map(file => file.path);
		expect(spelled).toEqual([HERDR_ADAPTER]);
	});
});
