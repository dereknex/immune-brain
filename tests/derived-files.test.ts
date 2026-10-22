import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDerivedFiles, readDerivedFiles } from "../plugins/immune-brain/runtime/derived_files";
import { buildCandidate, findIntegratedCandidate, integrateLaneCommit, laneCandidateMatches } from "../plugins/immune-brain/runtime/unattended/batch_integration";
import { parseFinalVerificationReport, prepareFinalRepairCandidate, runFinalVerification } from "../plugins/immune-brain/runtime/unattended/batch_final_verification";

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
function diverge(options: { mixed?: boolean; fail?: boolean; undeclaredWrite?: boolean; expandDeclaration?: boolean; replaceCheck?: boolean; indexOnly?: "blob" | "mode" } = {}) {
	const fx = fixture(); const { root, base } = fx;
	if (options.mixed || options.expandDeclaration) { writeFileSync(join(root, "ordinary.txt"), "base"); git(root, "add", "-A"); git(root, "commit", "-qm", "ordinary"); fx.base = git(root, "rev-parse", "HEAD"); }
	if (options.replaceCheck) {
		const value = declaration(); value.entries[0]!.check = { executable: "bun", argv: ["-e", "process.exit(1)"] };
		writeFileSync(join(root, "docs/agents/derived-files.json"), JSON.stringify(value));
		git(root, "add", "-A"); git(root, "commit", "-qm", "frozen check"); fx.base = git(root, "rev-parse", "HEAD");
	}
	if (options.fail || options.undeclaredWrite) {
		writeFileSync(join(root, "generate.ts"), options.fail ? "process.exit(process.argv.includes('--check')?1:0)" : "require('node:fs').writeFileSync('a.txt','corrupted')");
		git(root, "add", "-A"); git(root, "commit", "-qm", "generator"); fx.base = git(root, "rev-parse", "HEAD");
	}
	writeFileSync(join(root, "a.txt"), "a1"); writeFileSync(join(root, "bundle.txt"), "a1b0");
	if (options.mixed || options.expandDeclaration) writeFileSync(join(root, "ordinary.txt"), "parent");
	git(root, "add", "-A"); git(root, "commit", "-qm", "parent"); const head = git(root, "rev-parse", "HEAD");
	git(root, "checkout", "-qb", "lane", fx.base);
	writeFileSync(join(root, "b.txt"), "b1"); writeFileSync(join(root, "bundle.txt"), "a0b1");
	if (options.mixed || options.expandDeclaration) writeFileSync(join(root, "ordinary.txt"), "lane");
	if (options.expandDeclaration || options.replaceCheck) {
		const value = declaration();
		if (options.expandDeclaration) {
			value.entries[0]!.outputs.push("ordinary.txt");
			value.entries[0]!.generate = { executable: "bun", argv: ["-e", "require('node:fs').writeFileSync('ordinary.txt','overwritten')"] };
			value.entries[0]!.check = { executable: "bun", argv: ["-e", "process.exit(0)"] };
		}
		writeFileSync(join(root, "docs/agents/derived-files.json"), JSON.stringify(value));
	}
	if (options.indexOnly) {
		const payload = options.indexOnly === "blob"
			? `const blob=cp.execFileSync('git',['hash-object','-w','--stdin'],{input:'tampered'}).toString().trim(); cp.execFileSync('git',['update-index','--cacheinfo','100644',blob,'a.txt']);`
			: `cp.execFileSync('git',['update-index','--chmod=+x','a.txt']);`;
		writeFileSync(join(root, "generate.ts"), readFileSync(join(root, "generate.ts"), "utf8") +
			`\nif(!process.argv.includes('--check')) { const cp=require('node:child_process'); ${payload} }`);
	}
	git(root, "add", "-A"); git(root, "commit", "-qm", "imm(child): deliver\n\nImmune-Brain-Batch: batch");
	const lane = git(root, "rev-parse", "HEAD"); git(root, "checkout", "-q", "main");
	return { ...fx, head, lane, input: { root, branch: "main", batch_head: head, lane_base: fx.base, lane_commit: lane } };
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
	test("regenerates the merged sources, integrates and recovers the exact candidate", () => {
		const fx = diverge();
		const result = integrateLaneCommit(fx.input);
		expect(git(fx.root, "show", `${result.commit}:bundle.txt`)).toBe("a1b1");
		execFileSync("bun", ["generate.ts", "--check"], { cwd: fx.root });
		expect(findIntegratedCandidate({ root: fx.root, task_id: "child", batch_id: "batch", from_head: fx.head, lane_base: fx.base, lane_commit: fx.lane })).toBe(result.commit);
		writeFileSync(join(fx.root, "a.txt"), "tampered"); git(fx.root, "add", "-A"); git(fx.root, "commit", "-qm", "tampered");
		expect(laneCandidateMatches({ ...fx.input, candidate: git(fx.root, "rev-parse", "HEAD") })).toBe(false);
	});
	for (const [name, options] of [["mixed source conflicts", { mixed: true }], ["failing check", { fail: true }], ["undeclared generated edits", { undeclaredWrite: true }],
		["Lane-expanded outputs", { expandDeclaration: true }], ["Lane-replaced check", { replaceCheck: true }],
		["index-only source bytes", { indexOnly: "blob" }], ["index-only source mode", { indexOnly: "mode" }]] as const)
		test(`rejects ${name} without advancing the Parent`, () => {
			const fx = diverge(options);
			expect(() => buildCandidate(fx.input)).toThrow("indexOnly" in options ? "undeclared tree entry" : "batch_integration_conflict");
			expect(git(fx.root, "rev-parse", "HEAD")).toBe(fx.head);
			expect(git(fx.root, "status", "--porcelain")).toBe("");
		});
	test("keeps batch-start declaration authority after the Lane base advances", () => {
		const fx = diverge({ expandDeclaration: true });
		writeFileSync(join(fx.root, "docs/agents/derived-files.json"), git(fx.root, "show", `${fx.lane}:docs/agents/derived-files.json`));
		git(fx.root, "add", "-A"); git(fx.root, "commit", "-qm", "sibling changes declaration");
		const advancedBase = git(fx.root, "rev-parse", "HEAD");
		writeFileSync(join(fx.root, "ordinary.txt"), "new parent");
		git(fx.root, "add", "-A"); git(fx.root, "commit", "-qm", "new parent");
		const head = git(fx.root, "rev-parse", "HEAD");
		git(fx.root, "checkout", "-qb", "redo-lane", advancedBase);
		writeFileSync(join(fx.root, "ordinary.txt"), "new lane");
		git(fx.root, "add", "-A"); git(fx.root, "commit", "-qm", "redo lane");
		const lane = git(fx.root, "rev-parse", "HEAD"); git(fx.root, "checkout", "-q", "main");
		expect(() => buildCandidate({ root: fx.root, lane_base: advancedBase, batch_head: head, lane_commit: lane, declaration_head: fx.base })).toThrow("undeclared outputs");
	});
	test("final verification runs every structured check and retains failed checks for repair", async () => {
		const fx = fixture();
		const value = declaration();
		value.entries.push({ ...value.entries[0]!, id: "second", outputs: ["other.txt"], check: { executable: "bun", argv: ["-e", "process.exit(1)"] } });
		writeFileSync(join(fx.root, "docs/agents/derived-files.json"), JSON.stringify(value));
		git(fx.root, "add", "-A"); git(fx.root, "commit", "-qm", "checks");
		const report = await runFinalVerification(fx.root, ["bun --version"]);
		expect(report.passed).toBe(false);
		expect(report.derived_checks?.map(check => [check.id, check.passed])).toEqual([["bundle", true], ["second", false]]);
		expect(parseFinalVerificationReport(report, ["bun --version"])).toEqual(report);
		expect(prepareFinalRepairCandidate({ initiative_slug: "derived", original_goal: "delivery", scope_hint: ["a.txt"], failure: report, prior_repairs: 0 }).candidate.acceptance).toHaveLength(3);
		const frozen = await runFinalVerification(fx.root, [], { declaration_head: fx.base });
		expect(frozen.passed).toBe(true);
		expect(frozen.derived_checks?.map(check => check.id)).toEqual(["bundle"]);
		expect(parseFinalVerificationReport(frozen)).toEqual(frozen);
	});
	test("repository declares the Claude bundle generate and check", () => {
		const bundle = readDerivedFiles(process.cwd()).find(entry => entry.outputs.includes("plugins/immune-brain/dist/claude/mcp-server.mjs"));
		expect(bundle?.generate).toEqual({ executable: "bun", argv: ["scripts/build-claude-plugin.ts"] });
		expect(bundle?.check).toEqual({ executable: "bun", argv: ["scripts/build-claude-plugin.ts", "--check"] });
	});
});
