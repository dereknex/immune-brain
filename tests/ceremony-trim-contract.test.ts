import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PACKAGED_CONTRACT_ENTRIES } from "../scripts/dist-sync-manifest.ts";

/**
 * Contract-text conformance for the r647 ceremony trim, Slice S4: Delivery
 * Evidence is rework-only, and the batch, Lane and Herdr sections live in their
 * own packaged contract.
 */

const ROOT = resolve(import.meta.dir, "..");
const PLUGIN = "plugins/immune-brain";

function read(rel: string): string {
	return readFileSync(resolve(ROOT, rel), "utf8");
}

function flat(rel: string): string {
	return read(rel).replace(/\s+/g, " ");
}

const LOOP = `${PLUGIN}/dist/imm-run.md`;
const BATCH = `${PLUGIN}/dist/imm-run-batch.md`;
const LOADER = `${PLUGIN}/skills/imm-run/SKILL.md`;
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

describe("batch, Lane and Herdr sections live in their own contract (CT-S4-A3)", () => {
	test("each section heading is in the batch contract exactly once and absent from the Loop contract", () => {
		const batch = read(BATCH);
		const loop = read(LOOP);
		for (const heading of BATCH_HEADINGS) {
			const pattern = new RegExp(`^#{2,6} ${heading}$`, "gm");
			expect({ heading, inBatch: (batch.match(pattern) ?? []).length }).toEqual({ heading, inBatch: 1 });
			expect({ heading, inLoop: (loop.match(pattern) ?? []).length }).toEqual({ heading, inLoop: 0 });
		}
	});

	test("the batch contract is a packaged owned contract routed from the imm-run Skill", () => {
		const entry = PACKAGED_CONTRACT_ENTRIES.find((candidate) => candidate.packaged === "imm-run-batch.md");
		expect(entry?.kind).toBe("owned");
		expect(entry?.source).toBeNull();
		expect(entry?.skill).toBe("imm-run");
		expect(read(LOADER)).toContain("../../dist/imm-run-batch.md#");
	});

	test("every loader route anchor resolves in the file that now holds it", () => {
		const loader = read(LOADER);
		for (const heading of BATCH_HEADINGS) {
			expect(loader).toContain(`../../dist/imm-run-batch.md#${anchorOf(heading)}`);
			expect(loader).not.toContain(`../../dist/imm-run.md#${anchorOf(heading)}`);
		}
		expect(unresolvedLoopAnchors(loader, LOADER)).toEqual([]);
	});

	test("no Loop, batch or documentation link names an anchor that is not a heading of its target", () => {
		for (const file of [
			LOOP,
			BATCH,
			LOADER,
			`${PLUGIN}/README.md`,
			"docs/reference/immune-brain-config.md",
			`${PLUGIN}/dist/docs/reference/immune-brain-config.md`,
		]) {
			expect(unresolvedLoopAnchors(read(file), file)).toEqual([]);
		}
		// The two documentation pages name the config anchor by path, not by link.
		for (const file of ["docs/reference/immune-brain-config.md", `${PLUGIN}/dist/docs/reference/immune-brain-config.md`]) {
			expect(read(file)).toContain("plugins/immune-brain/dist/imm-run-batch.md#lane-preferences");
			expect(read(file)).not.toContain("plugins/immune-brain/dist/imm-run.md#lane-preferences");
		}
	});

	test("the anchor check fails for a link into the file a section moved out of", () => {
		const stale = "see [Lane Preferences](../../dist/imm-run.md#lane-preferences)";
		expect(unresolvedLoopAnchors(stale, LOADER)).toEqual([`${LOADER} -> ../../dist/imm-run.md#lane-preferences`]);
	});

	test("the Loop contract still states the supervision exception and links it in the batch contract", () => {
		expect(flat(LOOP)).toContain("[Lane Executor Supervision](imm-run-batch.md#lane-executor-supervision)");
	});
});
