// Project-declared routine allowlist (ADR 0038): a `routine` declaration stands
// only while every changed path lies under a declared class; any other changed
// path raises the task to `material` (Review required, no gate). The list only
// raises; an untrusted list makes every task `critical`; its own path is
// always `critical`.

import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { captureReviewManifest } from "../plugins/immune-brain/runtime/assurance/review_evidence";
import { resolveProjectedRisk, routineAllowlistEscapes } from "../plugins/immune-brain/runtime/kernel/completion";
import { canonicalIntentHash, classifyTaskRisk, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import {
	applyScopeRiskFloor,
	NO_RISK_FLOOR,
	parseRiskFloor,
	readRiskFloor,
	type RiskFloor,
} from "../plugins/immune-brain/runtime/kernel/risk_floor";
import {
	parseRoutineClasses,
	ROUTINE_CLASSES_CONTRACT,
	ROUTINE_CLASSES_DECLARATION_PATH,
} from "../plugins/immune-brain/runtime/kernel/routine_classes";
import { taskRevisionIdentity, writeEnrollmentBaseline } from "../plugins/immune-brain/runtime/workspace_scope";

const DECLARATION = { contract: ROUTINE_CLASSES_CONTRACT, classes: [{ id: "docs-only", paths: ["docs/guide", "README.md"] }] };
const ALLOWLIST: RiskFloor = { ...NO_RISK_FLOOR, routine: parseRoutineClasses(DECLARATION) };

const BASE = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: "routine-task",
	owner: "user",
	goal: "One outcome",
	acceptance: [{ id: "A1", assertion: "a1", verification: "v1" }],
	scope_hint: ["docs/guide/intro.md"],
	risk: "routine",
	revision: 1,
} as const;
const intent = (overrides: Record<string, unknown> = {}) => parseTaskIntentV1({ ...BASE, ...overrides });

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(root: string, ...args: string[]): string {
	return execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@local", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function repo(files: Record<string, string>, commit = true): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "imm-routine-allowlist-")));
	roots.push(root);
	git(root, "init", "-q", "-b", "main");
	for (const [path, content] of Object.entries({ "README.md": "fixture\n", ...files })) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), content);
	}
	if (commit) {
		git(root, "add", "-A");
		git(root, "commit", "-qm", "fixture");
	}
	return root;
}

describe("routine allowlist declaration", () => {
	it("parses classes strictly", () => {
		expect(parseRoutineClasses(DECLARATION)).toEqual([{ id: "docs-only", paths: ["docs/guide", "README.md"] }]);
		expect(parseRoutineClasses({ contract: ROUTINE_CLASSES_CONTRACT, classes: [] })).toEqual([]);
		for (const raw of [
			[],
			{ classes: [] },
			{ contract: ROUTINE_CLASSES_CONTRACT },
			{ contract: ROUTINE_CLASSES_CONTRACT, classes: [], extra: true },
			{ contract: ROUTINE_CLASSES_CONTRACT, classes: [{ id: "docs-only", paths: ["docs"], note: "x" }] },
			{ contract: ROUTINE_CLASSES_CONTRACT, classes: [{ id: "Docs Only", paths: ["docs"] }] },
			{ contract: ROUTINE_CLASSES_CONTRACT, classes: [{ id: "a", paths: ["docs"] }, { id: "a", paths: ["src"] }] },
			{ contract: ROUTINE_CLASSES_CONTRACT, classes: [{ id: "a", paths: "docs" }] },
			{ contract: ROUTINE_CLASSES_CONTRACT, classes: [{ id: "a", paths: ["docs/*"] }] },
			{ contract: ROUTINE_CLASSES_CONTRACT, classes: [{ id: "a", paths: ["/docs"] }] },
			{ contract: ROUTINE_CLASSES_CONTRACT, classes: [{ id: "a", paths: ["docs/../src"] }] },
		])
			expect(() => parseRoutineClasses(raw)).toThrow();
	});

	it("a project with no allowlist keeps every routine declaration", () => {
		const root = repo({});
		expect(readRiskFloor(root)).toEqual(NO_RISK_FLOOR);
		expect(resolveProjectedRisk(intent(), ["src/feature.ts"], readRiskFloor(root))).toBe("routine");
		expect(routineAllowlistEscapes(intent(), ["src/feature.ts"], readRiskFloor(root))).toEqual([]);
	});

	it("a committed allowlist is read beside the risk floor", () => {
		const root = repo({ [ROUTINE_CLASSES_DECLARATION_PATH]: JSON.stringify(DECLARATION) });
		expect(readRiskFloor(root)).toEqual(ALLOWLIST);
	});

	it("an untrusted allowlist makes every task critical", () => {
		const untrusted: Array<[string, () => string]> = [
			["invalid JSON", () => repo({ [ROUTINE_CLASSES_DECLARATION_PATH]: "{ not json" })],
			["an unknown field", () => repo({ [ROUTINE_CLASSES_DECLARATION_PATH]: JSON.stringify({ ...DECLARATION, extra: 1 }) })],
			["an uncommitted edit", () => {
				const root = repo({ [ROUTINE_CLASSES_DECLARATION_PATH]: JSON.stringify(DECLARATION) });
				writeFileSync(join(root, ROUTINE_CLASSES_DECLARATION_PATH), JSON.stringify({ ...DECLARATION, classes: [{ id: "all", paths: ["src"] }] }));
				return root;
			}],
			["an untracked file", () => {
				const root = repo({});
				mkdirSync(join(root, ".imm"), { recursive: true });
				writeFileSync(join(root, ROUTINE_CLASSES_DECLARATION_PATH), JSON.stringify(DECLARATION));
				return root;
			}],
		];
		for (const [label, build] of untrusted) {
			const floor = readRiskFloor(build());
			expect([label, floor.invalid?.startsWith(ROUTINE_CLASSES_DECLARATION_PATH)]).toEqual([label, true]);
			expect([label, resolveProjectedRisk(intent(), ["docs/guide/intro.md"], floor)]).toEqual([label, "critical"]);
			expect([label, applyScopeRiskFloor(intent(), floor).risk]).toEqual([label, "critical"]);
		}
	});

	it("the allowlist file itself is critical in scope and in changed paths, declared or not", () => {
		for (const floor of [NO_RISK_FLOOR, ALLOWLIST]) {
			for (const scope_hint of [[ROUTINE_CLASSES_DECLARATION_PATH], [".imm/**"], [".imm/routine-*"]])
				expect(applyScopeRiskFloor(intent({ scope_hint }), floor).risk).toBe("critical");
			expect(classifyTaskRisk([ROUTINE_CLASSES_DECLARATION_PATH], "routine", floor)).toBe("critical");
			expect(classifyTaskRisk([ROUTINE_CLASSES_DECLARATION_PATH], "material", floor)).toBe("critical");
		}
	});
});

describe("routine verification against the actual diff", () => {
	it("keeps routine while every changed path is allowlisted", () => {
		const paths = ["docs/guide/intro.md", "docs/guide/deep/page.md", "README.md"];
		expect(resolveProjectedRisk(intent(), paths, ALLOWLIST)).toBe("routine");
		expect(routineAllowlistEscapes(intent(), paths, ALLOWLIST)).toEqual([]);
		expect(resolveProjectedRisk(intent(), [], ALLOWLIST)).toBe("routine");
	});

	it("raises routine to material and names every path outside the allowlist, without near-prefix matches", () => {
		const paths = ["docs/guide/intro.md", "docs/guide-old/page.md", "src/feature.ts", "README.md.bak"];
		expect(resolveProjectedRisk(intent(), paths, ALLOWLIST)).toBe("material");
		expect(routineAllowlistEscapes(intent(), paths, ALLOWLIST)).toEqual(["docs/guide-old/page.md", "src/feature.ts", "README.md.bak"]);
		expect(intent().risk).toBe("routine");
	});

	it("an empty allowlist lets no routine declaration stand on a change", () => {
		const floor: RiskFloor = { ...NO_RISK_FLOOR, routine: [] };
		expect(resolveProjectedRisk(intent(), ["docs/guide/intro.md"], floor)).toBe("material");
		expect(resolveProjectedRisk(intent(), [], floor)).toBe("routine");
	});

	it("only raises: material and critical declarations and floors are untouched", () => {
		expect(resolveProjectedRisk(intent({ risk: "material" }), ["docs/guide/intro.md"], ALLOWLIST)).toBe("material");
		expect(resolveProjectedRisk(intent({ risk: "critical" }), ["src/feature.ts"], ALLOWLIST)).toBe("critical");
		const floor: RiskFloor = { ...parseRiskFloor({ contract: "assurance_kernel/risk_floor/v1", critical: { paths: ["docs/guide/secret"] } }), routine: ALLOWLIST.routine };
		expect(resolveProjectedRisk(intent(), ["docs/guide/secret/key.md"], floor)).toBe("critical");
		expect(routineAllowlistEscapes(intent({ risk: "material" }), ["src/feature.ts"], ALLOWLIST)).toEqual([]);
	});

	it("excludes the task's own planning sidecars", () => {
		const own = ["docs/plans/routine-task.intent.json", "docs/plans/archive/routine-task.intent.json"];
		expect(resolveProjectedRisk(intent(), [...own, "docs/guide/intro.md"], ALLOWLIST)).toBe("routine");
		expect(resolveProjectedRisk(intent(), ["docs/plans/other.intent.json"], ALLOWLIST)).toBe("material");
	});
});

describe("Review evidence", () => {
	function manifestFor(risk: "routine" | "material", delivered: Record<string, string>) {
		const root = repo({ [ROUTINE_CLASSES_DECLARATION_PATH]: JSON.stringify(DECLARATION), "docs/guide/intro.md": "base\n", ".gitignore": ".imm/state/\n" });
		const baseHead = git(root, "rev-parse", "HEAD");
		// A clean-start single task delivers its whole Enrollment delta.
		writeEnrollmentBaseline(root, [], true);
		for (const [path, content] of Object.entries(delivered)) {
			mkdirSync(dirname(join(root, path)), { recursive: true });
			writeFileSync(join(root, path), content);
		}
		git(root, "add", ...Object.keys(delivered));
		const taskIntent = intent({ risk });
		const identity = taskRevisionIdentity(root, taskIntent.scope_hint, baseHead, taskIntent.task_id);
		return captureReviewManifest(root, { taskId: taskIntent.task_id, baseHead, scopeHint: taskIntent.scope_hint,
			expectedDiffHash: identity.diff_hash, intentRevision: 1, intentContentHash: canonicalIntentHash(taskIntent),
			recordRevision: "record", workspaceRevision: "workspace", lifecycle: "active", artifactState: "frozen",
			risk, intent: taskIntent, outcomes: {} });
	}

	it("names the paths that raised a routine declaration beside beyond_estimate", () => {
		const manifest = manifestFor("routine", { "docs/guide/intro.md": "changed\n", "src/feature.ts": "export {};\n" });
		expect(manifest.beyond_estimate).toEqual(["src/feature.ts"]);
		expect(manifest.outside_routine_allowlist).toEqual(["src/feature.ts"]);
	});

	it("omits the field when nothing escapes or the declaration is not routine", () => {
		expect("outside_routine_allowlist" in manifestFor("routine", { "docs/guide/intro.md": "changed\n" })).toBe(false);
		expect("outside_routine_allowlist" in manifestFor("material", { "src/feature.ts": "export {};\n" })).toBe(false);
	});
});

describe("this repository's allowlist", () => {
	const declared = parseRoutineClasses(JSON.parse(readFileSync(join(process.cwd(), ROUTINE_CLASSES_DECLARATION_PATH), "utf8")));
	const floor: RiskFloor = { ...parseRiskFloor(JSON.parse(readFileSync(join(process.cwd(), ".imm/risk-floor.json"), "utf8"))), routine: declared };

	it("pilots the docs-only class with descriptive documentation", () => {
		expect(declared.map((item) => item.id)).toEqual(["docs-only"]);
		for (const path of ["README.md", "README.zh-CN.md", "CHANGELOG.md", "docs/solutions/example.md"])
			expect([path, resolveProjectedRisk(intent({ scope_hint: [path] }), [path], floor)]).toEqual([path, "routine"]);
	});

	it("keeps agent instructions, decisions, planning artifacts and prompts out of the routine lane", () => {
		for (const path of ["docs/agents/domain.md", "docs/adr/0001-x.md", "docs/reference/code-quality-guard.md", "docs/specs/x.spec.md", "docs/plans/x.intent.json",
			"plugins/immune-brain/dist/draw-up.md", "AGENTS.md", "CLAUDE.md", "CONTEXT.md", "src/feature.ts"])
			expect([path, resolveProjectedRisk(intent(), [path], floor)]).toEqual([path, "material"]);
	});
});
