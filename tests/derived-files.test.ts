import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDerivedFiles, readDerivedFiles } from "../plugins/immune-brain/runtime/derived_files";
import { HOST_CAPABILITY_PATH } from "../scripts/render-host-capability";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function git(root: string, ...args: string[]): string {
	return execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@local", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
const declaration = () => ({ contract: "immune_brain/derived_files/v1", entries: [{ id: "bundle", sources: ["a.txt", "b.txt", "generate.ts"], outputs: ["bundle.txt"],
	generate: { executable: "bun", argv: ["generate.ts"] }, check: { executable: "bun", argv: ["generate.ts", "--check"] } }] });
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "derived-files-")); roots.push(root);
	git(root, "init", "-q", "-b", "main");
	mkdirSync(join(root, "docs/agents"), { recursive: true });
	writeFileSync(join(root, "docs/agents/derived-files.json"), JSON.stringify(declaration()));
	writeFileSync(join(root, "a.txt"), "a0"); writeFileSync(join(root, "b.txt"), "b0");
	writeFileSync(join(root, "bundle.txt"), "a0b0");
	writeFileSync(join(root, "generate.ts"), `import {readFileSync,writeFileSync} from 'node:fs';
const expected=readFileSync('a.txt','utf8')+readFileSync('b.txt','utf8');
if(process.argv.includes('--check')) process.exit(readFileSync('bundle.txt','utf8')===expected?0:1);
writeFileSync('bundle.txt',expected);`);
	git(root, "add", "-A"); git(root, "commit", "-qm", "base");
	return { root, base: git(root, "rev-parse", "HEAD") };
}
describe("derived files", () => {
	test("strict reader accepts declarations and rejects invalid fields", () => {
		expect(parseDerivedFiles(declaration())).toHaveLength(1);
		const cases: Array<[string, (value: any) => void]> = [
			["check", value => delete value.entries[0].check],
			["outputs", value => value.entries[0].outputs = ["../outside"]],
			["outputs", value => value.entries[0].outputs = ["/outside"]],
			["unknown", value => value.entries[0].unknown = true],
			["contract", value => value.contract = "other"],
		];
		for (const [field, mutate] of cases) { const value = declaration(); mutate(value); expect(() => parseDerivedFiles(value)).toThrow(field); }
		const fx = fixture(); expect(readDerivedFiles(fx.root)).toEqual(parseDerivedFiles(declaration()));
		rmSync(join(fx.root, "docs/agents/derived-files.json")); expect(readDerivedFiles(fx.root)).toEqual([]);
	});
	test("repository declares the Claude bundle generate and check", () => {
		const bundle = readDerivedFiles(process.cwd()).find(entry => entry.outputs.includes("plugins/immune-brain/dist/claude/mcp-server.mjs"));
		expect(bundle?.generate).toEqual({ executable: "bun", argv: ["scripts/build-claude-plugin.ts"] });
		expect(bundle?.check).toEqual({ executable: "bun", argv: ["scripts/build-claude-plugin.ts", "--check"] });
	});
	test("repository declares the host capability reference generate, check, and sources", () => {
		const matches = readDerivedFiles(process.cwd()).filter(entry => entry.outputs.includes(HOST_CAPABILITY_PATH));
		expect(matches).toHaveLength(1);
		const entry = matches[0]!;
		expect(entry.id).toBe("host-capability-reference");
		expect(entry.outputs).toEqual([HOST_CAPABILITY_PATH]);
		expect(entry.generate).toEqual({ executable: "bun", argv: ["scripts/render-host-capability.ts"] });
		expect(entry.check).toEqual({ executable: "bun", argv: ["scripts/render-host-capability.ts", "--check"] });
		for (const source of [
			"scripts/render-host-capability.ts",
			"plugins/immune-brain/runtime/host-core/capability.ts",
			"plugins/immune-brain/runtime/claude/capability.ts",
			"plugins/immune-brain/runtime/antigravity/capability.ts",
			"plugins/immune-brain/.pi-extension/pi-capability.ts",
		]) {
			expect(entry.sources).toContain(source);
		}
		const check = spawnSync(entry.check.executable, entry.check.argv, { cwd: process.cwd(), encoding: "utf8" });
		expect(check.status).toBe(0);
	});
});
