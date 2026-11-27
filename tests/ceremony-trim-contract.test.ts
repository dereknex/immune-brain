import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PACKAGED_CONTRACT_ENTRIES } from "../scripts/dist-sync-manifest.ts";

/**
 * Contract-text conformance for the r647 ceremony trim, Slice S4: Delivery
 * Evidence is rework-only. The batch, Lane and Herdr sections it moved into
 * their own packaged contract are retired with that contract
 * (retire-unattended-batch).
 */

const ROOT = resolve(import.meta.dir, "..");
const PLUGIN = "plugins/immune-brain";

function read(rel: string): string {
	return readFileSync(resolve(ROOT, rel), "utf8");
}

function flat(rel: string): string {
	return read(rel).replace(/\s+/g, " ");
}

const LOOP = `${PLUGIN}/dist/drive.md`;
const BATCH = `${PLUGIN}/dist/drive-batch.md`;
const BATCH_MIRROR = "plugins/immune-brain-antigravity/dist/drive-batch.md";
const LOADER = `${PLUGIN}/skills/drive/SKILL.md`;
const EXECUTOR_SOURCE = `${PLUGIN}/runtime/prompts/executor.md`;
const EXECUTOR_MIRROR = `${PLUGIN}/dist/role-prompts/executor.md`;

const BATCH_HEADINGS = [
	"Unattended Batch Opt-In",
	"Parallel Batch Opt-In",
	"Lane Preferences",
	"Lane Executor Supervision",
	"Herdr Lane Tabs",
];

/** GitHub-style anchor for a heading, as the loader tests compute it. */
function anchorOf(heading: string): string {
	return heading.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s/g, "-");
}

function anchorsIn(text: string): Set<string> {
	return new Set([...text.matchAll(/^#{1,6} (.+)$/gm)].map((match) => anchorOf(match[1])));
}

/**
 * Every markdown link in `text` that names a heading anchor, resolved against
 * `from` (the repo-relative file holding the link). Returns the links whose
 * target file is a packaged Loop contract and whose anchor is not a heading
 * there. Links to other files are not this contract's concern.
 */
function unresolvedLoopAnchors(text: string, from: string): string[] {
	const bad: string[] = [];
	for (const [, target] of text.matchAll(/\]\(([^)\s]*#[^)\s]+)\)/g)) {
		const [path, anchor] = target.split("#");
		const file = path === "" ? from : resolve(dirname(resolve(ROOT, from)), path);
		const rel = file.startsWith(ROOT) ? file.slice(ROOT.length + 1) : file;
		if (rel !== LOOP && rel !== BATCH) continue;
		if (!existsSync(resolve(ROOT, rel)) || !anchorsIn(read(rel)).has(anchor)) bad.push(`${from} -> ${target}`);
	}
	return bad;
}

describe("Delivery Evidence is rework-only (CT-S4-A1)", () => {
	test("Executor prompt and Loop contract require the table for rework only", () => {
		const executor = flat(EXECUTOR_SOURCE);
		expect(executor).toContain("Return one compact row per violated acceptance or invariant only when handling rework");
		expect(executor).toContain("a first delivery needs no table");
		expect(flat(LOOP)).toContain("table for rework only; a first delivery needs no table");
	});

	test("no file still requires the table before the first Assurance attempt", () => {
		for (const file of [LOOP, EXECUTOR_SOURCE, EXECUTOR_MIRROR]) {
			expect({ file, text: flat(file).includes("before the first Assurance attempt") }).toEqual({ file, text: false });
			expect({ file, text: flat(file).includes("update affected rows after repair") }).toEqual({ file, text: false });
		}
	});

	test("the Executor prompt keeps the rework contract the table exists for", () => {
		const executor = flat(EXECUTOR_SOURCE);
		expect(executor).toContain("name the violated invariant, all known trigger classes and their controls in Finding coverage");
		expect(executor).toContain("| Acceptance / invariant | Entry and consumers |");
	});

	test("the packaged Executor mirror is byte-identical to its source", () => {
		expect(read(EXECUTOR_MIRROR)).toBe(read(EXECUTOR_SOURCE));
	});
});

describe("batch, Lane and Herdr sections are retired with their contract (retire-unattended-batch D4)", () => {
	test("the batch contract is neither shipped nor routed from the drive Skill", () => {
		expect(existsSync(resolve(ROOT, BATCH))).toBe(false);
		expect(existsSync(resolve(ROOT, BATCH_MIRROR))).toBe(false);
		expect(PACKAGED_CONTRACT_ENTRIES.find((candidate) => candidate.packaged === "drive-batch.md")).toBeUndefined();
		expect(read(LOADER)).not.toContain("drive-batch.md");
		expect(read(LOOP)).not.toContain("drive-batch.md");
	});

	test("no retired section heading or loader route survives in the Loop contract or loader", () => {
		const loop = read(LOOP);
		const loader = read(LOADER);
		for (const heading of BATCH_HEADINGS) {
			const pattern = new RegExp(`^#{2,6} ${heading}$`, "gm");
			expect({ heading, inLoop: (loop.match(pattern) ?? []).length }).toEqual({ heading, inLoop: 0 });
			expect({ heading, routed: loader.includes(`#${anchorOf(heading)}`) }).toEqual({ heading, routed: false });
		}
	});

	test("no Loop or documentation link names an anchor that is not a heading of its target", () => {
		for (const file of [
			LOOP,
			LOADER,
			"docs/reference/immune-brain-config.md",
			`${PLUGIN}/dist/docs/reference/immune-brain-config.md`,
		]) {
			expect(unresolvedLoopAnchors(read(file), file)).toEqual([]);
		}
		for (const file of ["docs/reference/immune-brain-config.md", `${PLUGIN}/dist/docs/reference/immune-brain-config.md`]) {
			expect(read(file)).not.toContain("drive-batch.md#lane-preferences");
		}
	});

	test("the anchor check fails for a link into a retired section or contract", () => {
		const stale = "see [Lane Preferences](../../dist/drive.md#lane-preferences)";
		expect(unresolvedLoopAnchors(stale, LOADER)).toEqual([`${LOADER} -> ../../dist/drive.md#lane-preferences`]);
		const retired = "see [Unattended Batch Opt-In](../../dist/drive-batch.md#unattended-batch-opt-in)";
		expect(unresolvedLoopAnchors(retired, LOADER)).toEqual([`${LOADER} -> ../../dist/drive-batch.md#unattended-batch-opt-in`]);
	});
});
