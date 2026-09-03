#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const PLUGIN_JSON = "plugins/immune-brain/.claude-plugin/plugin.json";
const SRC = "plugins/immune-brain/runtime/claude/mcp_server.ts";
const OUT = "plugins/immune-brain/dist/claude/mcp-server.mjs";

export function stampPluginVersion(root: string, version: string): void {
	const path = resolve(root, PLUGIN_JSON);
	const manifest = JSON.parse(readFileSync(path, "utf8")) as { version?: string };
	manifest.version = version;
	writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

function compile(root: string, outfile: string): void {
	mkdirSync(dirname(outfile), { recursive: true });
	const result = spawnSync("bun", ["build", SRC, "--target=node", "--outfile", outfile, "--packages=bundle"], {
		cwd: root,
		encoding: "utf8",
	});
	if (result.status !== 0) throw new Error(result.stderr || result.stdout || "bun build failed");
}

export function buildClaudePlugin(root = resolve(import.meta.dir, "..")): { out: string; version: string } {
	const version = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version as string;
	stampPluginVersion(root, version);
	const out = resolve(root, OUT);
	compile(root, out);
	return { out, version };
}

export function checkClaudePlugin(root = resolve(import.meta.dir, "..")): void {
	const committed = resolve(root, OUT);
	const tmp = join(tmpdir(), `mcp-server-check-${randomUUID()}.mjs`);
	compile(root, tmp);
	const expected = readFileSync(committed);
	const actual = readFileSync(tmp);
	if (!expected.equals(actual)) {
		throw new Error(`${OUT} drifted from a fresh bun build of ${SRC}`);
	}
}

if (import.meta.main) {
	if (process.argv.includes("--check")) {
		checkClaudePlugin();
		console.log("claude plugin bundle is current");
	} else {
		const built = buildClaudePlugin();
		console.log(`built ${built.out} @ ${built.version}`);
	}
}
