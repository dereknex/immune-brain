#!/usr/bin/env bun
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { stampPluginManifest, validateManifests } from "./plugin_versioning";

const SRC = "plugins/immune-brain/runtime/claude/mcp_server.ts";
const OUT = "plugins/immune-brain/dist/claude/mcp-server.mjs";

function compile(root: string, outfile: string): void {
	mkdirSync(dirname(outfile), { recursive: true });
	const result = spawnSync("bun", ["build", SRC, "--target=node", "--outfile", outfile, "--packages=bundle"], {
		cwd: root,
		encoding: "utf8",
	});
	if (result.status !== 0) throw new Error(result.stderr || result.stdout || "bun build failed");
}

export function buildClaudePlugin(root = resolve(import.meta.dir, "..")): { out: string; version: string } {
	const { version } = stampPluginManifest(root);
	const out = resolve(root, OUT);
	compile(root, out);
	return { out, version };
}

export function checkClaudePlugin(root = resolve(import.meta.dir, "..")): void {
	validateManifests(root);
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
