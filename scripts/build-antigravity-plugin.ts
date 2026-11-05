#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const SRC = "plugins/immune-brain/runtime/antigravity/mcp_server.ts";
const OUT = "plugins/immune-brain/dist/antigravity/mcp-server.mjs";
const MANIFEST = "plugins/immune-brain/plugin.json";

function packageVersion(root: string): string {
	const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
	return manifest.version;
}

function stampManifest(root: string, version: string): void {
	const path = resolve(root, MANIFEST);
	if (existsSync(path)) {
		const manifest = JSON.parse(readFileSync(path, "utf8"));
		manifest.version = version;
		writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n", "utf8");
	}
}

function compile(root: string, outfile: string): void {
	mkdirSync(dirname(outfile), { recursive: true });
	const result = spawnSync("bun", ["build", SRC, "--target=node", "--outfile", outfile, "--packages=bundle"], {
		cwd: root,
		encoding: "utf8",
	});
	if (result.status !== 0) throw new Error(result.stderr || result.stdout || "bun build failed");
}

export function buildAntigravityPlugin(root = resolve(import.meta.dir, "..")): { out: string; version: string } {
	const version = packageVersion(root);
	stampManifest(root, version);
	const out = resolve(root, OUT);
	compile(root, out);
	return { out, version };
}

export function checkAntigravityPlugin(root = resolve(import.meta.dir, "..")): void {
	const committed = resolve(root, OUT);
	if (!existsSync(committed)) {
		throw new Error(`Missing built artifact: ${OUT}`);
	}
	const tmp = join(tmpdir(), `antigravity-mcp-server-check-${randomUUID()}.mjs`);
	compile(root, tmp);
	const expected = readFileSync(committed);
	const actual = readFileSync(tmp);
	if (!expected.equals(actual)) {
		throw new Error(`${OUT} drifted from a fresh bun build of ${SRC}`);
	}
}

if (import.meta.main) {
	if (process.argv.includes("--check")) {
		checkAntigravityPlugin();
		console.log("antigravity plugin bundle is current");
	} else {
		const built = buildAntigravityPlugin();
		console.log(`built ${built.out} @ ${built.version}`);
	}
}
