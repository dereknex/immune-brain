import { describe, expect, test } from "bun:test";
import {
	execFileSync,
} from "node:child_process";
import {
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
	parseTaskIntentV1,
	readTaskIntent,
} from "../plugins/immune-brain/runtime/kernel/intent";

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

	test("compatible: adds acceptance and updates verification with revision bump", () => {
		const next = parseTaskIntentV1({
			...INTENT_V1,
			revision: 3,
			acceptance: [
				...INTENT_V1.acceptance,
				{ id: "A2", assertion: "Extra", verification: "Check" },
			],
		});
		expect(classifyIntentRevision(prev, next)).toBe("compatible");
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
