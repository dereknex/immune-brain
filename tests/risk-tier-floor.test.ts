// Project-declared risk floor (ADR 0023): an intent declaring `routine` whose
// scope_hint touches a path this repository's declaration names is raised to
// at least `material`, derived solely from scope_hint (never from prose
// fields); a project with no declaration has no floor; an untrusted
// declaration raises every task to `critical`.

import { afterEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolveProjectedRisk } from "../plugins/immune-brain/runtime/kernel/completion";
import {
	classifyTaskRisk,
	parseProjectTaskIntent,
	parseTaskIntentV1,
	readTaskIntent,
} from "../plugins/immune-brain/runtime/kernel/intent";
import {
	applyScopeRiskFloor,
	NO_RISK_FLOOR,
	parseRiskFloor,
	readRiskFloor,
	RISK_FLOOR_DECLARATION_PATH,
	type RiskFloor,
} from "../plugins/immune-brain/runtime/kernel/risk_floor";

const DECLARATION_TEXT = readFileSync(join(process.cwd(), RISK_FLOOR_DECLARATION_PATH), "utf8");
// This repository's declaration, as a committed checkout reads it.
const FLOOR: RiskFloor = parseRiskFloor(JSON.parse(DECLARATION_TEXT));
const RISK_FLOOR_SCOPE_PREFIXES = FLOOR.material.paths;
const CHANGED_PATH_RISK_FLOOR_PREFIXES = [...FLOOR.material.paths, ...FLOOR.material.changed_only];

const BASE = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: "risk-floor-task",
	owner: "user",
	goal: "One outcome",
	acceptance: [
		{ id: "A1", assertion: "a1", verification: "v1" },
	],
	risk: "routine",
	revision: 1,
} as const;

const scopeRisk = (candidate: Record<string, unknown>, floor: RiskFloor = FLOOR) =>
	applyScopeRiskFloor(parseTaskIntentV1(candidate), floor).risk;

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function repo(files: Record<string, string>, commit = true): string {
	const root = mkdtempSync(join(tmpdir(), "imm-risk-floor-"));
	roots.push(root);
	const git = (args: string[]) => execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
	git(["init", "-q"]);
	git(["config", "user.email", "test@example.invalid"]);
	git(["config", "user.name", "Test"]);
	for (const [path, content] of Object.entries({ "README.md": "fixture\n", ...files })) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), content);
	}
	if (commit) {
		git(["add", "-A"]);
		git(["commit", "-q", "-m", "fixture"]);
	}
	return root;
}

describe("deterministic risk-tier floor", () => {
	it("protects every authority prefix in both scope and concrete changes", () => {
		for (const prefix of RISK_FLOOR_SCOPE_PREFIXES) {
			expect(scopeRisk({ ...BASE, scope_hint: [prefix] })).toBe("material");
			expect(classifyTaskRisk([prefix], "routine", FLOOR)).toBe("material");
		}
		for (const path of ["plugins/immune-brain/runtime/plugin_version.ts", "plugins/immune-brain/runtime/claude/README.md"]) {
			expect(scopeRisk({ ...BASE, scope_hint: [path] })).toBe("routine");
			expect(classifyTaskRisk([path], "routine", FLOOR)).toBe("routine");
		}
	});
	it("promotes routine to material when scope_hint touches the kernel runtime", () => {
		for (const scope_hint of [
			["plugins/immune-brain/runtime/kernel"],
			["plugins/immune-brain/runtime/kernel/intent.ts"],
			["plugins/immune-brain/runtime/kernel/"],
			["plugins/immune-brain/runtime/kernel", "docs/**"],
			["plugins/immune-brain/runtime/kernel/*"],
		]) {
			expect(scopeRisk({ ...BASE, scope_hint })).toBe("material");
		}
	});

	it("promotes routine to material when scope_hint touches authority paths", () => {
		for (const scope_hint of [
			["plugins/immune-brain/runtime/authority_commit_receipts.ts"],
			["plugins/immune-brain/.pi-extension"],
			["plugins/immune-brain/.pi-extension/imm-canary-enroll.ts"],
			["plugins/immune-brain/.pi-extension/imm-canary-work.ts"],
			["plugins/immune-brain/.pi-extension/"],
			["plugins/immune-brain/.pi-extension/imm-canary-*"]
		]) {
			expect(scopeRisk({ ...BASE, scope_hint })).toBe("material");
		}
	});

	it("promotes routine to material when scope_hint covers the whole plugin (kernel subtree included)", () => {
		expect(scopeRisk({ ...BASE, scope_hint: ["plugins/immune-brain"] })).toBe("material");
	});

	it("promotes routine even with wildcard-leading or glob patterns touching kernel paths", () => {
		for (const scope_hint of [
			["**/kernel/**"],
			["plugins/imm*/runtime/kernel"],
			["plugins/immune-brain/runtime/*/kernel"],
		]) {
			expect(scopeRisk({ ...BASE, scope_hint })).toBe("material");
		}
	});

	it("keeps a routine task routine when only its own active Spec changed", () => {
		const parsed = applyScopeRiskFloor(parseTaskIntentV1({
			...BASE,
			scope_hint: [`docs/specs/${BASE.task_id}.spec.md`],
		}), FLOOR);
		expect(parsed.risk).toBe("routine");
		expect(resolveProjectedRisk(parsed, [`docs/specs/${BASE.task_id}.spec.md`], FLOOR)).toBe("routine");
	});

	it("keeps the declared tier for documentation-only scope", () => {
		for (const scope_hint of [
			["docs/plans/risk-floor-task.intent.json"],
			["docs/**"],
			["docs", "tests/ordinary.test.ts"],
			["tests/risk-tier-floor.test.ts"],
		]) {
			expect(scopeRisk({ ...BASE, scope_hint })).toBe("routine");
		}
	});

	it("keeps material and critical tiers untouched over kernel scope", () => {
		expect(scopeRisk({ ...BASE, scope_hint: ["plugins/immune-brain/runtime/kernel"], risk: "material" })).toBe("material");
		expect(scopeRisk({ ...BASE, scope_hint: ["plugins/immune-brain/runtime/kernel"], risk: "critical" })).toBe("critical");
	});

	it("carries the prefixes the runtime used to hard-code", () => {
		expect(RISK_FLOOR_SCOPE_PREFIXES).toContain(
			"plugins/immune-brain/runtime/kernel",
		);
		expect(RISK_FLOOR_SCOPE_PREFIXES).toContain(
			"plugins/immune-brain/runtime/authority_commit_receipts.ts",
		);
		expect(RISK_FLOOR_SCOPE_PREFIXES).toContain(
			"plugins/immune-brain/.pi-extension",
		);
	});
});

describe("changed-path task-tier classification", () => {
	it("forces configured prefixes and descendants to material without near-prefix matches", () => {
		for (const prefix of CHANGED_PATH_RISK_FLOOR_PREFIXES) {
			expect(classifyTaskRisk([prefix], "routine", FLOOR)).toBe("material");
			expect(classifyTaskRisk([`${prefix}/nested/file.ts`], "routine", FLOOR)).toBe("material");
			expect(classifyTaskRisk([`${prefix}-old/file.ts`], "routine", FLOOR)).toBe("routine");
		}
	});

	it("keeps ordinary routine paths routine and allows declared critical to escalate", () => {
		for (const [declared, expected] of [["routine", "routine"], ["critical", "critical"]] as const) {
			expect(classifyTaskRisk(["src/feature.ts"], declared, FLOOR)).toBe(expected);
		}
	});

	it("does not allow declared routine to de-escalate a material path", () => {
		for (const [path, declared] of [["docs/plans/other-task.intent.json", "routine"], ["docs/specs/other-task.spec.md", "material"]] as const) {
			expect(classifyTaskRisk([path], declared, FLOOR)).toBe("material");
		}
	});
});

describe("project declaration", () => {
	const KERNEL = "plugins/immune-brain/runtime/kernel/intent.ts";
	const sidecar = (taskId: string, scope: string[], risk = "routine") =>
		`${JSON.stringify({ ...BASE, task_id: taskId, scope_hint: scope, risk }, null, 2)}\n`;

	it("parsing alone returns the declared risk", () => {
		expect(parseTaskIntentV1({ ...BASE, scope_hint: [KERNEL] }).risk).toBe("routine");
	});

	it("a project with no declaration keeps the declared risk for a Kernel-named scope and for docs/plans", () => {
		const root = repo({
			"docs/plans/kernel-named.intent.json": sidecar("kernel-named", [KERNEL]),
			"docs/plans/plans-scope.intent.json": sidecar("plans-scope", ["docs/plans/plans-scope.intent.json"]),
		});
		expect(readRiskFloor(root)).toEqual(NO_RISK_FLOOR);
		expect(readTaskIntent(root, "kernel-named").intent.risk).toBe("routine");
		expect(readTaskIntent(root, "plans-scope").intent.risk).toBe("routine");
		expect(classifyTaskRisk([KERNEL, "docs/plans/other.intent.json"], "routine", readRiskFloor(root))).toBe("routine");
	});

	it("this repository's declaration raises a routine Kernel scope to material and leaves docs/plans scope routine", () => {
		const root = repo({
			[RISK_FLOOR_DECLARATION_PATH]: DECLARATION_TEXT,
			"docs/plans/kernel-named.intent.json": sidecar("kernel-named", [KERNEL]),
			"docs/plans/kernel-glob.intent.json": sidecar("kernel-glob", ["**/kernel/**"]),
			"docs/plans/plans-scope.intent.json": sidecar("plans-scope", ["docs/plans/plans-scope.intent.json"]),
		});
		expect(readRiskFloor(root)).toEqual(FLOOR);
		expect(readTaskIntent(root, "kernel-named").intent.risk).toBe("material");
		expect(readTaskIntent(root, "kernel-glob").intent.risk).toBe("material");
		expect(readTaskIntent(root, "plans-scope").intent.risk).toBe("routine");
		expect(parseProjectTaskIntent(root, { ...BASE, scope_hint: [KERNEL] }).risk).toBe("material");
	});

	it("an empty declaration behaves as no declaration", () => {
		const root = repo({
			[RISK_FLOOR_DECLARATION_PATH]: `${JSON.stringify({ contract: "assurance_kernel/risk_floor/v1" })}\n`,
			"docs/plans/kernel-named.intent.json": sidecar("kernel-named", [KERNEL]),
		});
		expect(readRiskFloor(root)).toEqual(NO_RISK_FLOOR);
		expect(readTaskIntent(root, "kernel-named").intent.risk).toBe("routine");
		expect(classifyTaskRisk(["docs/plans/other.intent.json"], "routine", readRiskFloor(root))).toBe("routine");
	});

	it("the declaration file itself is critical in scope and in changed paths, declared or not", () => {
		for (const floor of [NO_RISK_FLOOR, FLOOR]) {
			for (const scope_hint of [[RISK_FLOOR_DECLARATION_PATH], [".imm/**"], ["**/*.json"], [".imm"], [".imm/risk-*"]])
				expect(scopeRisk({ ...BASE, scope_hint }, floor)).toBe("critical");
			for (const scope_hint of [[".imm/audit/**"], ["**/*.ts"], [".imm/risk-floor.json.bak"]])
				expect(scopeRisk({ ...BASE, scope_hint }, floor)).toBe(floor === FLOOR && scope_hint[0] === "**/*.ts" ? "material" : "routine");
			expect(classifyTaskRisk([RISK_FLOOR_DECLARATION_PATH], "routine", floor)).toBe("critical");
			expect(classifyTaskRisk([RISK_FLOOR_DECLARATION_PATH], "material", floor)).toBe("critical");
			expect(classifyTaskRisk([".imm/risk-floor.json.bak"], "routine", floor)).toBe("routine");
		}
	});

	it("a critical list raises scope and changed paths to critical", () => {
		const floor = parseRiskFloor({
			contract: "assurance_kernel/risk_floor/v1",
			critical: { paths: ["infra/prod"], changed_only: ["migrations"] },
		});
		expect(scopeRisk({ ...BASE, scope_hint: ["infra/**"], risk: "material" }, floor)).toBe("critical");
		expect(scopeRisk({ ...BASE, scope_hint: ["migrations/001.sql"] }, floor)).toBe("routine");
		expect(classifyTaskRisk(["migrations/001.sql"], "routine", floor)).toBe("critical");
		expect(classifyTaskRisk(["infra/prod/main.tf"], "material", floor)).toBe("critical");
	});

	it("a declaration that cannot be trusted makes every task critical", () => {
		const untrusted: Array<[string, () => string]> = [
			["invalid JSON", () => repo({ [RISK_FLOOR_DECLARATION_PATH]: "{ not json" })],
			["a wrong type", () => repo({ [RISK_FLOOR_DECLARATION_PATH]: JSON.stringify({ contract: "assurance_kernel/risk_floor/v1", material: { paths: "src" } }) })],
			["an unknown field", () => repo({ [RISK_FLOOR_DECLARATION_PATH]: JSON.stringify({ contract: "assurance_kernel/risk_floor/v1", routine: {} }) })],
			["a missing contract", () => repo({ [RISK_FLOOR_DECLARATION_PATH]: JSON.stringify({ material: { paths: ["src"] } }) })],
			["a glob prefix", () => repo({ [RISK_FLOOR_DECLARATION_PATH]: JSON.stringify({ contract: "assurance_kernel/risk_floor/v1", material: { paths: ["src/*"] } }) })],
			["a directory in the file's place", () => repo({ [`${RISK_FLOOR_DECLARATION_PATH}/keep`]: "x\n" })],
			["a symlink", () => {
				const root = repo({ "elsewhere.json": DECLARATION_TEXT, ".imm/keep": "x\n" });
				symlinkSync("../elsewhere.json", join(root, RISK_FLOOR_DECLARATION_PATH));
				execFileSync("git", ["add", "-A"], { cwd: root });
				execFileSync("git", ["commit", "-q", "-m", "link"], { cwd: root });
				return root;
			}],
			["an uncommitted edit", () => {
				const root = repo({ [RISK_FLOOR_DECLARATION_PATH]: DECLARATION_TEXT });
				writeFileSync(join(root, RISK_FLOOR_DECLARATION_PATH), `${JSON.stringify({ contract: "assurance_kernel/risk_floor/v1" })}\n`);
				return root;
			}],
			["an uncommitted deletion", () => {
				const root = repo({ [RISK_FLOOR_DECLARATION_PATH]: DECLARATION_TEXT });
				rmSync(join(root, RISK_FLOOR_DECLARATION_PATH));
				return root;
			}],
			...(["--assume-unchanged", "--skip-worktree"] as const).flatMap((flag): Array<[string, () => string]> =>
				["edit", "delete"].map((change) => [`${flag} hides an uncommitted ${change}`, () => {
					const root = repo({ [RISK_FLOOR_DECLARATION_PATH]: DECLARATION_TEXT });
					execFileSync("git", ["update-index", flag, RISK_FLOOR_DECLARATION_PATH], { cwd: root });
					if (change === "edit") writeFileSync(join(root, RISK_FLOOR_DECLARATION_PATH), JSON.stringify({ contract: "assurance_kernel/risk_floor/v1" }));
					else rmSync(join(root, RISK_FLOOR_DECLARATION_PATH));
					expect(execFileSync("git", ["status", "--porcelain", "--", RISK_FLOOR_DECLARATION_PATH], { cwd: root, encoding: "utf8" })).toBe("");
					return root;
				}])),
			["an untracked file", () => {
				const root = repo({});
				mkdirSync(join(root, ".imm"), { recursive: true });
				writeFileSync(join(root, RISK_FLOOR_DECLARATION_PATH), `${JSON.stringify({ contract: "assurance_kernel/risk_floor/v1" })}\n`);
				return root;
			}],
		];
		for (const [label, build] of untrusted) {
			const floor = readRiskFloor(build());
			expect([label, floor.invalid === null]).toEqual([label, false]);
			expect([label, scopeRisk({ ...BASE, scope_hint: ["src/feature.ts"] }, floor)]).toEqual([label, "critical"]);
			expect([label, classifyTaskRisk([], "routine", floor)]).toEqual([label, "critical"]);
			expect([label, classifyTaskRisk(["src/feature.ts"], "material", floor)]).toEqual([label, "critical"]);
		}
	});

	it("a committed valid declaration fails closed on an actual reader error", () => {
		const root = repo({ [RISK_FLOOR_DECLARATION_PATH]: DECLARATION_TEXT });
		expect(readRiskFloor(root).invalid).toBeNull();
		const failure = Object.assign(new Error("fixture read denied"), { code: "EACCES" });
		const reader = spyOn(fs, "readFileSync").mockImplementation(() => { throw failure; });
		let floor: RiskFloor;
		try {
			floor = readRiskFloor(root);
			expect(reader).toHaveBeenCalledWith(join(fs.realpathSync(root), RISK_FLOOR_DECLARATION_PATH));
			expect(reader.mock.results[0]).toEqual({ type: "throw", value: failure });
		} finally {
			reader.mockRestore();
		}
		expect(floor.invalid).toBe(failure.message);
		expect(scopeRisk({ ...BASE, scope_hint: ["src/feature.ts"] }, floor)).toBe("critical");
		expect(classifyTaskRisk([], "routine", floor)).toBe("critical");
	});

	it("an untrusted declaration raises a sidecar read through the secure reader", () => {
		const root = repo({
			[RISK_FLOOR_DECLARATION_PATH]: "[]",
			"docs/plans/ordinary.intent.json": sidecar("ordinary", ["src/feature.ts"]),
		});
		expect(readTaskIntent(root, "ordinary").intent.risk).toBe("critical");
	});
});
