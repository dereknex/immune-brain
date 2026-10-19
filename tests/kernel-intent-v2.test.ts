import { describe, expect, test } from "bun:test";
import {
	execFileSync,
} from "node:child_process";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	canonicalIntentHash,
	classifyIntentRevision,
	intentAuthorityHash,
	observeTaskIntent,
	parseProjectTaskIntent,
	parseTaskIntentV1,
	readTaskIntent,
} from "../plugins/immune-brain/runtime/kernel/intent";
import { parseRiskFloor, readRiskFloor } from "../plugins/immune-brain/runtime/kernel/risk_floor";
import { resolveProjectedRisk } from "../plugins/immune-brain/runtime/kernel/completion";

function git(root: string, args: string[]): void {
	execFileSync("git", args, { cwd: root, stdio: "pipe" });
}

function makeRepo(files: Record<string, string>, commit = true): string {
	const root = mkdtempSync(join(tmpdir(), "imm-intent-v2-"));
	git(root, ["init", "-q"]);
	git(root, ["config", "user.email", "test@example.com"]);
	git(root, ["config", "user.name", "Test"]);
	for (const [rel, content] of Object.entries(files)) {
		const target = join(root, rel);
		mkdirSync(target.slice(0, target.lastIndexOf("/")), { recursive: true });
		writeFileSync(target, content);
	}
	git(root, ["add", "-A"]);
	return root;
}

const INTENT_V1: Record<string, unknown> = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: "123-short-goal",
	goal: "One outcome statement",
	acceptance: [
		{
			id: "A1",
			assertion: "One observable acceptance condition",
			verification: "One deterministic verification description",
		},
	],
	scope_hint: ["path/or/domain"],
	risk: "routine",
	revision: 1,
	owner: "user",
};

function intentJson(intent: Record<string, unknown> = INTENT_V1): string {
	return `${JSON.stringify(intent, null, 2)}\n`;
}

describe("parseTaskIntentV1", () => {
	test("accepts the exact canonical wire", () => {
		const parsed = parseTaskIntentV1({ ...INTENT_V1 });
		expect(parsed.contract).toBe("assurance_kernel/task_intent/v1");
		expect(parsed.acceptance[0].assertion).toBe(
			"One observable acceptance condition",
		);
		expect(parsed.owner).toBe("user");
	});

	test("canonicalizes an equivalent scope envelope", () => {
		const parsed = parseTaskIntentV1({
			...INTENT_V1,
			scope_hint: ["src/feature/file.ts", "docs/**/*.md", "src", "src/", "docs/**/*.md"],
		});
		expect(parsed.scope_hint).toEqual(["docs/**/*.md", "src"]);
	});

	test("rejects unsafe or host-ambiguous scope envelopes", () => {
		for (const scope_hint of [
			[],
			["."],
			["/absolute"],
			["C:/drive"],
			["src/../secret"],
			["src\\file.ts"],
			["cafe\u0301/file.ts"],
			["bad\ud800/file.ts"],
			["Src/a.ts", "src/b.ts"],
			["Straße.ts", "STRASSE.ts"],
		]) {
			expect(() => parseTaskIntentV1({ ...INTENT_V1, scope_hint })).toThrow();
		}
	});

	test("rejects unknown fields at every level", () => {
		expect(() => parseTaskIntentV1({ ...INTENT_V1, extra: 1 })).toThrow();
		expect(() =>
			parseTaskIntentV1({
				...INTENT_V1,
				acceptance: [
					{ ...INTENT_V1.acceptance[0], extra: true },
				],
			}),
		).toThrow();
	});

	test("rejects wrong contract, empty acceptance, duplicate IDs, bad risk, bad owner, non-positive revision", () => {
		expect(() =>
			parseTaskIntentV1({ ...INTENT_V1, contract: "assurance_kernel/intent/v1" }),
		).toThrow();
		expect(() => parseTaskIntentV1({ ...INTENT_V1, acceptance: [] })).toThrow();
		expect(() =>
			parseTaskIntentV1({
				...INTENT_V1,
				acceptance: [
					{ id: "A1", assertion: "x", verification: "y" },
					{ id: "A1", assertion: "z", verification: "w" },
				],
			}),
		).toThrow();
		expect(() => parseTaskIntentV1({ ...INTENT_V1, risk: "extreme" })).toThrow();
		expect(() => parseTaskIntentV1({ ...INTENT_V1, owner: "agent" })).toThrow();
		expect(() => parseTaskIntentV1({ ...INTENT_V1, revision: 0 })).toThrow();
	});
});

describe("canonicalIntentHash", () => {
	test("is formatting-independent and semantic-sensitive", () => {
		const a = canonicalIntentHash(INTENT_V1);
		expect(a).toMatch(/^sha256:[a-f0-9]{64}$/);
		const reordered = {
			owner: INTENT_V1.owner,
			risk: INTENT_V1.risk,
			revision: INTENT_V1.revision,
			scope_hint: INTENT_V1.scope_hint,
			acceptance: INTENT_V1.acceptance,
			goal: INTENT_V1.goal,
			task_id: INTENT_V1.task_id,
			contract: INTENT_V1.contract,
		};
		expect(canonicalIntentHash(reordered)).toBe(a);
		const semantic = { ...INTENT_V1, goal: "A different outcome" };
		expect(canonicalIntentHash(semantic)).not.toBe(a);
	});
});

describe("classifyIntentRevision", () => {
	const prev = parseTaskIntentV1({ ...INTENT_V1, revision: 2 });

	test("unchanged when canonical content is identical", () => {
		expect(classifyIntentRevision(prev, parseTaskIntentV1({ ...INTENT_V1, revision: 3 }))).toBe("unchanged");
	});

	test("unchanged when canonical scope order and redundancy are equivalent", () => {
		const equivalent = parseTaskIntentV1({
			...INTENT_V1,
			revision: 3,
			scope_hint: ["path/or/domain/file.ts", "path/or/domain", "path/or/domain"],
		});
		expect(classifyIntentRevision(prev, equivalent)).toBe("unchanged");
	});

	test("breaking: an added acceptance item is a new obligation (Spec branch-boundary D6)", () => {
		const next = parseTaskIntentV1({
			...INTENT_V1,
			revision: 3,
			acceptance: [
				...(INTENT_V1.acceptance as unknown[]),
				{ id: "A2", assertion: "Extra", verification: "Check" },
			],
		});
		expect(classifyIntentRevision(prev, next)).toBe("breaking");
	});

	test("breaking: any semantic scope expansion requires authority", () => {
		const expanded = parseTaskIntentV1({
			...INTENT_V1,
			revision: 3,
			scope_hint: ["path/or/domain", "more"],
		});
		expect(classifyIntentRevision(prev, expanded)).toBe("breaking");
	});

	test("breaking: goal/owner/task identity change, risk lowered, acceptance removed or assertion rewritten, revision not increased", () => {
		const goal = parseTaskIntentV1({ ...INTENT_V1, goal: "New goal", revision: 3 });
		expect(classifyIntentRevision(prev, goal)).toBe("breaking");
		const prevMaterial = parseTaskIntentV1({ ...INTENT_V1, risk: "material", revision: 2 });
		const lowered = parseTaskIntentV1({ ...INTENT_V1, risk: "routine", revision: 3 });
		expect(classifyIntentRevision(prevMaterial, lowered)).toBe("breaking");
		const rewritten = parseTaskIntentV1({
			...INTENT_V1,
			revision: 3,
			acceptance: [{ id: "A1", assertion: "Rewritten", verification: "v" }],
		});
		expect(classifyIntentRevision(prev, rewritten)).toBe("breaking");
		const removed = parseTaskIntentV1({
			...INTENT_V1,
			revision: 3,
			acceptance: [{ id: "B9", assertion: "Other", verification: "v" }],
		});
		expect(classifyIntentRevision(prev, removed)).toBe("breaking");
		const sameRevision = parseTaskIntentV1({
			...INTENT_V1,
			scope_hint: ["changed"],
		});
		expect(classifyIntentRevision(prev, sameRevision)).toBe("breaking");
	});
});

// ADR 0021 / spec D3: a scope revision is compatible only when it contains every
// previous entry and adds concrete files whose directory already holds a previous
// concrete entry, outside every risk-floor prefix, docs/specs and docs/plans.
// A v2 verification descriptor whose command and run parameters a case can vary.
function descriptor(command: Record<string, unknown> = {}, environment: Record<string, unknown> = {}): string {
	return JSON.stringify({
		contract: "assurance_kernel/verification_descriptor/v2",
		command: { executable: "bun", argv: ["test", "tests/a.test.ts"], cwd: ".", timeout_ms: 60000, max_output_bytes: 8192, ...command },
		environment: { prepare: null, writable_paths: [], ...environment },
	});
}

const AUTHORITY_BASE: Record<string, unknown> = {
	...INTENT_V1,
	scope_hint: ["docs/specs/feature.spec.md", "src/mod/a.ts"],
	acceptance: [
		{ id: "A1", assertion: "One observable acceptance condition", verification: descriptor() },
		{ id: "A2", assertion: "A second condition", verification: descriptor({ argv: ["test", "tests/b.test.ts"] }) },
	],
	revision: 2,
};
const withAcceptance = (index: number, item: Record<string, unknown>) => ({
	acceptance: (AUTHORITY_BASE.acceptance as Record<string, unknown>[]).map((prior, i) => (i === index ? { ...prior, ...item } : prior)),
});

describe("intentAuthorityHash (Spec branch-boundary D5)", () => {
	const base = intentAuthorityHash(parseTaskIntentV1(AUTHORITY_BASE));
	const hashOf = (change: Record<string, unknown>) => intentAuthorityHash(parseTaskIntentV1({ ...AUTHORITY_BASE, ...change }));

	test.each([
		["a scope entry outside docs/specs", { scope_hint: ["docs/specs/feature.spec.md", "src/mod/a.ts", "src/mod/b.ts"] }],
		["revision", { revision: 9 }],
		["risk", { risk: "critical" }],
		["a descriptor timeout_ms", withAcceptance(0, { verification: descriptor({ timeout_ms: 300000 }) })],
		["a descriptor max_output_bytes", withAcceptance(0, { verification: descriptor({ max_output_bytes: 131072 }) })],
		["a descriptor environment", withAcceptance(0, { verification: descriptor({}, { writable_paths: ["tmp"] }) })],
		["the acceptance order", { acceptance: [...(AUTHORITY_BASE.acceptance as unknown[])].reverse() }],
	])("unchanged when only %s changes", (_label, change) => {
		expect(hashOf(change)).toBe(base);
	});

	test.each([
		["goal", { goal: "A different outcome" }],
		["an acceptance assertion", withAcceptance(1, { assertion: "A rewritten condition" })],
		["a descriptor executable", withAcceptance(0, { verification: descriptor({ executable: "node" }) })],
		["a descriptor argv", withAcceptance(0, { verification: descriptor({ argv: ["test", "tests/other.test.ts"] }) })],
		["a descriptor cwd", withAcceptance(0, { verification: descriptor({ cwd: "plugins" }) })],
		["the acceptance id set", withAcceptance(1, { id: "A3" })],
		["an added acceptance item", { acceptance: [...(AUTHORITY_BASE.acceptance as unknown[]), { id: "A3", assertion: "Extra", verification: descriptor() }] }],
		["the bound Spec path", { scope_hint: ["docs/specs/other.spec.md", "src/mod/a.ts"] }],
	])("changes when %s changes", (_label, change) => {
		expect(hashOf(change)).not.toBe(base);
	});

	test("changes when owner changes", () => {
		// The parser accepts only owner "user", so the subject is pinned on the parsed shape.
		expect(intentAuthorityHash({ ...parseTaskIntentV1(AUTHORITY_BASE), owner: "agent" } as never)).not.toBe(base);
	});
});

describe("classifyIntentRevision: verification commands (Spec branch-boundary D6)", () => {
	const prev = parseTaskIntentV1(AUTHORITY_BASE);
	const next = (change: Record<string, unknown>) => parseTaskIntentV1({ ...AUTHORITY_BASE, revision: 3, ...change });

	test.each([
		["a descriptor executable", withAcceptance(0, { verification: descriptor({ executable: "node" }) })],
		["a descriptor argv", withAcceptance(0, { verification: descriptor({ argv: ["test", "tests/other.test.ts"] }) })],
		["a descriptor cwd", withAcceptance(0, { verification: descriptor({ cwd: "plugins" }) })],
		["an added acceptance item", { acceptance: [...(AUTHORITY_BASE.acceptance as unknown[]), { id: "A3", assertion: "Extra", verification: descriptor() }] }],
	])("breaking: a revision that changes only %s", (_label, change) => {
		expect(classifyIntentRevision(prev, next(change))).toBe("breaking");
	});

	test.each([
		["a descriptor timeout_ms", withAcceptance(0, { verification: descriptor({ timeout_ms: 300000 }) })],
		["a descriptor max_output_bytes", withAcceptance(0, { verification: descriptor({ max_output_bytes: 131072 }) })],
		["a descriptor environment", withAcceptance(0, { verification: descriptor({}, { writable_paths: ["tmp"] }) })],
		["a same-directory scope entry", { scope_hint: ["docs/specs/feature.spec.md", "src/mod/a.ts", "src/mod/b.ts"] }],
	])("compatible: a revision that changes only %s", (_label, change) => {
		expect(classifyIntentRevision(prev, next(change))).toBe("compatible");
	});
});

describe("classifyIntentRevision: same-directory scope additions", () => {
	const scoped = (scope: string[], extra: Record<string, unknown> = {}) =>
		parseTaskIntentV1({ ...INTENT_V1, scope_hint: scope, ...extra });
	const base = scoped(["src/mod/a.ts", "src/mod/sub/d.ts"], { revision: 2 });
	const revised = (scope: string[], extra: Record<string, unknown> = {}) =>
		scoped(scope, { revision: 3, ...extra });

	test("compatible: concrete sibling files of an anchored directory", () => {
		expect(classifyIntentRevision(base, revised(["src/mod/a.ts", "src/mod/sub/d.ts", "src/mod/b.ts"]))).toBe("compatible");
		expect(classifyIntentRevision(base, revised(["src/mod/a.ts", "src/mod/sub/d.ts", "src/mod/sub/e.ts", "src/mod/b.ts"]))).toBe("compatible");
	});

	test.each([
		["a glob entry", ["src/mod/a.ts", "src/mod/sub/d.ts", "src/mod/*.ts"]],
		["a new directory", ["src/mod/a.ts", "src/mod/sub/d.ts", "src/other/c.ts"]],
		["an entry that swallows a previous one", ["src/mod/a.ts", "src/mod/sub/d.ts", "src/mod/sub"]],
		["an unanchored parent", ["src/mod/a.ts", "src/mod/sub/d.ts", "src/c.ts"]],
	])("breaking: %s", (_label, scope) => {
		expect(classifyIntentRevision(base, revised(scope))).toBe("breaking");
	});

	// Spec host-owned-environment D10: narrowing removes authority, so a next
	// scope made only of previous entries needs no confirmation. Replaces the
	// former "breaking: a removed entry" case.
	test("compatible: a strict subset of the previous scope", () => {
		expect(classifyIntentRevision(base, revised(["src/mod/a.ts"]))).toBe("compatible");
		expect(classifyIntentRevision(base, revised(["src/mod/sub/d.ts"]))).toBe("compatible");
	});

	test("a subset keeps its previous result once anything else changes", () => {
		// One added entry is still judged by the same-directory rule (I6).
		expect(classifyIntentRevision(base, revised(["src/mod/a.ts", "src/other/c.ts"]))).toBe("breaking");
		expect(classifyIntentRevision(base, revised(["src/mod/a.ts", "src/mod/b.ts"]))).toBe("breaking");
		expect(classifyIntentRevision(base, revised(["src/mod/a.ts"], { goal: "A different goal" }))).toBe("breaking");
		// An empty scope is not a narrowing.
		expect(classifyIntentRevision(base, { ...base, scope_hint: [], revision: 3 })).toBe("breaking");
		// A subset without a revision bump is not a revision.
		expect(classifyIntentRevision(base, scoped(["src/mod/a.ts"], { revision: 2 }))).toBe("breaking");
	});

	test("breaking: a glob previous entry does not anchor a sibling", () => {
		const globbed = scoped(["src/mod/*.ts"], { revision: 2 });
		expect(classifyIntentRevision(globbed, revised(["src/mod/*.ts", "src/mod/b.ts"]))).toBe("breaking");
	});

	// The same-directory rule never self-serves an addition on a path the
	// project's risk floor names (ADR 0021, ADR 0023).
	const REPOSITORY_FLOOR = parseRiskFloor(JSON.parse(readFileSync(join(process.cwd(), ".imm/risk-floor.json"), "utf8")));
	test.each([...REPOSITORY_FLOOR.material.paths, ...REPOSITORY_FLOOR.material.changed_only])("breaking: a sibling under the %s floor prefix", (prefix) => {
		const floor = { risk: "critical" };
		const previous = scoped([`${prefix}/a.ts`], { revision: 2, ...floor });
		const next = revised([`${prefix}/a.ts`, `${prefix}/b.ts`], floor);
		expect(classifyIntentRevision(previous, next, REPOSITORY_FLOOR)).toBe("breaking");
		// A project that declares no floor has no such path.
		expect(classifyIntentRevision(previous, next)).toBe("compatible");
	});

	test("breaking: adding the declaration file beside an anchored sibling, declared or not", () => {
		const floor = { risk: "critical" };
		const previous = scoped([".imm/notes.md"], { revision: 2, ...floor });
		const next = revised([".imm/notes.md", ".imm/risk-floor.json"], floor);
		expect(classifyIntentRevision(previous, next)).toBe("breaking");
		expect(classifyIntentRevision(previous, next, REPOSITORY_FLOOR)).toBe("breaking");
	});

	test("breaking: a compatible scope addition combined with any other breaking field", () => {
		const scope = ["src/mod/a.ts", "src/mod/sub/d.ts", "src/mod/b.ts"];
		expect(classifyIntentRevision(base, revised(scope, { goal: "A different goal" }))).toBe("breaking");
		expect(classifyIntentRevision(base, revised(scope, { acceptance: [{ id: "B9", assertion: "Other", verification: "v" }] }))).toBe("breaking");
	});
});

describe("readTaskIntent secure reader", () => {
	test("reads a tracked dirty intent and returns normalized identity", () => {
		const root = makeRepo({
			"docs/plans/123-short-goal.intent.json": intentJson(),
		});
		writeFileSync(
			join(root, "docs/plans/123-short-goal.intent.json"),
			intentJson({ ...INTENT_V1, scope_hint: ["dirty-change"] }),
		);
		const result = readTaskIntent(root, "123-short-goal");
		expect(result.intent.task_id).toBe("123-short-goal");
		expect(result.intent_ref.path).toBe("docs/plans/123-short-goal.intent.json");
		expect(result.intent_ref.revision).toBe(1);
		expect(result.content_hash).toBe(canonicalIntentHash(result.intent));
		expect(result.intent_ref.content_hash).toBe(result.content_hash);
	});

	test("observes the same canonical intent without issuing an authority token", () => {
		const root = makeRepo({
			"docs/plans/123-short-goal.intent.json": intentJson(),
		});
		const observed = observeTaskIntent(root, "123-short-goal");
		expect(observed.intent.task_id).toBe("123-short-goal");
		expect(observed.content_hash).toBe(canonicalIntentHash(observed.intent));
		expect("token" in observed).toBe(false);
	});

	test("accepts staged tracked intent", () => {
		const root = makeRepo({
			"docs/plans/123-short-goal.intent.json": intentJson(),
		});
		writeFileSync(
			join(root, "docs/plans/123-short-goal.intent.json"),
			intentJson({ ...INTENT_V1, revision: 2 }),
		);
		git(root, ["add", "-A"]);
		expect(readTaskIntent(root, "123-short-goal").intent.revision).toBe(2);
	});

	test("rejects untracked, missing, and wrong filename binding", () => {
		const root = makeRepo({});
		mkdirSync(join(root, "docs/plans"), { recursive: true });
		writeFileSync(join(root, "docs/plans/123-short-goal.intent.json"), intentJson());
		expect(() => readTaskIntent(root, "123-short-goal")).toThrow(/tracked/);
		expect(() => readTaskIntent(root, "missing-task")).toThrow();
		expect(() =>
			readTaskIntent(root, "123-short-goal"),
		).toThrow();
		writeFileSync(
			join(root, "docs/plans/123-short-goal.intent.json"),
			intentJson({ ...INTENT_V1, task_id: "other-task" }),
		);
		git(root, ["add", "-A"]);
		expect(() => readTaskIntent(root, "123-short-goal")).toThrow(/task_id/);
	});

	test("rejects root symlink and sidecar symlink", () => {
		const root = makeRepo({
			"docs/plans/123-short-goal.intent.json": intentJson(),
		});
		const alias = `${root}-alias`;
		symlinkSync(root, alias);
		expect(() => readTaskIntent(alias, "123-short-goal")).toThrow(/symlink/);
		const target = join(root, "docs/plans/123-short-goal.intent.json");
		rmSync(target);
		writeFileSync(join(root, "docs/other.json"), intentJson());
		symlinkSync(join(root, "docs/other.json"), target);
		expect(() => readTaskIntent(root, "123-short-goal")).toThrow(/symlink/);
	});

	test("rejects traversal task IDs and oversize and malformed content", () => {
		const root = makeRepo({
			"docs/plans/123-short-goal.intent.json": intentJson(),
		});
		expect(() => readTaskIntent(root, "../evil")).toThrow();
		expect(() => readTaskIntent(root, "a/b")).toThrow();
		writeFileSync(join(root, "docs/plans/123-short-goal.intent.json"), "x".repeat(70 * 1024));
		git(root, ["add", "-A"]);
		expect(() => readTaskIntent(root, "123-short-goal")).toThrow(/64 KiB/);
		writeFileSync(join(root, "docs/plans/123-short-goal.intent.json"), "{not json");
		git(root, ["add", "-A"]);
		expect(() => readTaskIntent(root, "123-short-goal")).toThrow();
	});

	test("file replacement, A→B→A, and parent replacement are rejected via read hook", () => {
		const root = makeRepo({
			"docs/plans/123-short-goal.intent.json": intentJson(),
		});
		const target = join(root, "docs/plans/123-short-goal.intent.json");
		const hook = require("../plugins/immune-brain/runtime/kernel/intent") as {
			setIntentReaderTestHook: (hook: { onBeforeDescriptorRead?: () => void } | null) => void;
		};
		try {
			// File replacement: swap the file after the descriptor is opened.
			hook.setIntentReaderTestHook({
				onBeforeDescriptorRead: () => {
					writeFileSync(target, intentJson({ ...INTENT_V1, revision: 9 }));
				},
			});
			expect(() => readTaskIntent(root, "123-short-goal")).toThrow();

			// A→B→A: replace twice so the final content matches the original
			// but the inode differs; identity re-verification must still fail.
			hook.setIntentReaderTestHook({
				onBeforeDescriptorRead: () => {
					writeFileSync(target, intentJson({ ...INTENT_V1, revision: 9 }));
					writeFileSync(target, intentJson());
				},
			});
			expect(() => readTaskIntent(root, "123-short-goal")).toThrow();

			// Parent replacement: replace docs/plans with a symlink after open.
			const plans = join(root, "docs/plans");
			hook.setIntentReaderTestHook({
				onBeforeDescriptorRead: () => {
					rmSync(plans, { recursive: true });
					mkdirSync(join(root, "docs"));
					symlinkSync(join(root, "docs/plans"), plans);
				},
			});
			expect(() => readTaskIntent(root, "123-short-goal")).toThrow();
		} finally {
			hook.setIntentReaderTestHook(null);
		}
	});

	test("token is opaque, non-enumerable, non-serializable, and unconstructable", () => {
		const root = makeRepo({
			"docs/plans/123-short-goal.intent.json": intentJson(),
		});
		const { token } = readTaskIntent(root, "123-short-goal");
		expect(Object.keys(token as object)).toHaveLength(0);
		expect({ ...(token as object) }).toEqual({});
		expect(JSON.stringify(token)).toBe("{}");
		const second = readTaskIntent(root, "123-short-goal");
		expect(second.token).not.toBe(token);
	});

	test("all tracked TaskIntent sidecars use canonical scope envelopes", () => {
		const plans = join(process.cwd(), "docs", "plans");
		const sidecars = readdirSync(plans).filter((name) => name.endsWith(".intent.json"));
		expect(sidecars.length).toBeGreaterThan(0);
		for (const name of sidecars) {
			expect(() => parseTaskIntentV1(JSON.parse(readFileSync(join(plans, name), "utf8")))).not.toThrow();
		}
	});
});

// Characterization, written before the floor left parseTaskIntentV1 (Spec
// host-owned-environment D14, I8): the canonical hash of an enrolled intent is
// the hash the secure reader returns, under this repository's declaration.
describe("enrolled intent hash across the risk-floor move", () => {
	const DECLARATION = ".imm/risk-floor.json";
	const enrolled = (taskId: string, scope: string) => {
		const files: Record<string, string> = {
			[`docs/plans/${taskId}.intent.json`]: intentJson({ ...INTENT_V1, task_id: taskId, scope_hint: [scope] }),
		};
		const declaration = join(process.cwd(), DECLARATION);
		if (existsSync(declaration)) files[DECLARATION] = readFileSync(declaration, "utf8");
		const root = makeRepo(files);
		git(root, ["commit", "-q", "-m", "fixture"]);
		return readTaskIntent(root, taskId);
	};

	test.each([
		["an intent the floor raised keeps its hash and its floored risk", "floored-intent", "plugins/immune-brain/runtime/kernel/intent.ts", "material", "sha256:8da4ac58eebf0629cda9d21dc7bfe74ca458920f0e8b703b864700a8ed6bdaf0"],
		["an intent the floor did not raise keeps its hash and its declared risk", "unfloored-intent", "src/feature.ts", "routine", "sha256:5a7b125533b3dbb036e1211800c80c5ba00bd30559361db70b143a3cb762685d"],
	])("%s", (_title, taskId, scope, risk, hash) => {
		const read = enrolled(taskId, scope);
		expect(read.intent.risk).toBe(risk);
		expect(read.content_hash).toBe(hash);
	});

	test.each(["material", "routine"] as const)("recorded %s identity survives policy changes", (risk) => {
		const taskId = `recorded-${risk}`;
		const path = `docs/plans/${taskId}.intent.json`;
		const raw = { ...INTENT_V1, task_id: taskId, scope_hint: ["plugins/immune-brain/runtime/kernel/intent.ts"] };
		const recorded = parseTaskIntentV1({ ...raw, risk });
		const hash = canonicalIntentHash(recorded);
		const root = makeRepo({ [path]: intentJson(raw) });
		git(root, ["commit", "-qm", "legacy enrolled sidecar"]);
		try {
			const read = () => readTaskIntent(root, taskId, path, recorded);
			expect(read().content_hash).toBe(hash);
			mkdirSync(join(root, ".imm"), { recursive: true });
			writeFileSync(join(root, DECLARATION), JSON.stringify({
				contract: "assurance_kernel/risk_floor/v1", material: { paths: ["plugins/immune-brain/runtime/kernel"] },
			}));
			git(root, ["add", DECLARATION]);
			git(root, ["commit", "-qm", "new project policy"]);
			expect(read().content_hash).toBe(hash);
			expect(resolveProjectedRisk(read().intent, [], readRiskFloor(root))).toBe("material");
			writeFileSync(join(root, DECLARATION), "[]");
			expect(read().content_hash).toBe(hash);
			expect(read().intent.risk).toBe(risk);
			expect(resolveProjectedRisk(read().intent, [], readRiskFloor(root))).toBe("critical");
			// Candidate and new revisions still use the current fail-closed policy.
			expect(parseProjectTaskIntent(root, raw).risk).toBe("critical");
			expect(parseProjectTaskIntent(root, { ...raw, revision: 2 }, recorded).risk).toBe("critical");
			writeFileSync(join(root, path), intentJson({ ...raw, goal: "Changed goal" }));
			expect(read().content_hash).not.toBe(hash);
			writeFileSync(join(root, path), intentJson({ ...raw, risk: "critical" }));
			expect(read().content_hash).not.toBe(hash);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

});
