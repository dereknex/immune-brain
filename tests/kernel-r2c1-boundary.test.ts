import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as kernel from "../plugins/immune-brain/runtime/kernel/index";

const REPO_ROOT = join(__dirname, "..");

describe("legacy API retirement", () => {
	test("versioned mutation entry points are absent from the public index", () => {
		const exported = new Set<string>(Object.keys(kernel));
		for (const legacy of [
			"parseTaskIntent",
			"parseTaskRecord",
			"reduceTaskV2",
			"writeTaskRecord",
			"applyTaskActionV2",
		]) {
			expect(exported.has(legacy)).toBe(false);
		}
	});
});

describe("additive export surface", () => {
	test("new identity/v2 read APIs are exported", () => {
		expect(typeof kernel.readTaskIntent).toBe("function");
		expect(typeof kernel.parseTaskIntentV1).toBe("function");
		expect(typeof kernel.canonicalIntentHash).toBe("function");
		expect(typeof kernel.classifyIntentRevision).toBe("function");
		expect(typeof kernel.parseTaskRecordV2).toBe("function");
		expect(typeof kernel.completionDecision).toBe("function");
		expect(typeof kernel.projectTask).toBe("function");
		expect(typeof kernel.assertKernelInvariantsV2).toBe("function");
	});

	test("no mutation, issuer, import, token consumer, or dispatcher surface is exported", () => {
		const exported = new Set<string>(Object.keys(kernel));
		const forbidden = [
			"mintAuthority",
			"createAuthority",
			"issueAuthority",
			"mintTaskIntentToken",
			"createTaskIntentToken",
			"consumeTaskIntentToken",
			"importTaskRecord",
			"importLegacyTask",
			"applyTaskAction",
			"writeTaskRecordV2",
			"dispatchTaskAction",
			"routeTaskAction",
		];
		for (const name of forbidden) {
			expect(exported.has(name)).toBe(false);
		}
	});

	test("intent module exposes no token constructor", () => {
		const intentModule = kernel as Record<string, unknown>;
		expect("createToken" in intentModule).toBe(false);
		expect("TaskIntentIdentityToken" in intentModule).toBe(false);
	});
});

describe("canonical command surface", () => {
	test("imm-kernel subcommand set adds only bounded intent author/validate", () => {
		const source = readFileSync(
			join(REPO_ROOT, "plugins/immune-brain/runtime/commands/kernel.ts"),
			"utf8",
		);
		expect(source).not.toMatch(/task-action/);
		expect(source).not.toMatch(/task-status/);
		expect(source).not.toMatch(/task-record/);
		expect(source).not.toMatch(/begin-drain/);
		expect(source).not.toMatch(/\benroll\b/);
		expect(source).toMatch(/intent author/);
		expect(source).toMatch(/intent validate/);
		expect(source).toMatch(/--stdin/);
	});

	test("canonical runtime manifest carries only the bounded intent surface", () => {
		const source = readFileSync(
			join(REPO_ROOT, "plugins/immune-brain/runtime/commands/kernel.ts"),
			"utf8",
		);
		expect(source).not.toMatch(/task-action/);
		expect(source).not.toMatch(/task-status/);
		expect(source).not.toMatch(/task-record/);
		expect(source).not.toMatch(/begin-drain/);
		expect(source).not.toMatch(/["']enroll["']/);
		expect(source).toMatch(/intent author/);
		expect(source).toMatch(/intent validate/);
	});
});

describe("P2C1 boundary invariants", () => {
	test("index exports the current pure reducer and record reader", () => {
		expect(typeof (kernel as Record<string, unknown>).writeTaskRecord).toBe("undefined");
		expect(typeof (kernel as Record<string, unknown>).applyTaskAction).toBe("undefined");
		expect(typeof (kernel as Record<string, unknown>).reduceTask).toBe("function");
		expect(typeof kernel.readTaskRecord).toBe("function");
	});

	test("v3 routing, readiness, receipt, and observation files untouched by intent module", () => {
		// The intent module must not import storage/reducer/observation/runtime.
		const source = readFileSync(
			join(REPO_ROOT, "plugins/immune-brain/runtime/kernel/intent.ts"),
			"utf8",
		);
		expect(source).not.toMatch(/from "\.\/storage"/);
		expect(source).not.toMatch(/from "\.\/reducer"/);
		expect(source).not.toMatch(/from "\.\/observation"/);
		expect(source).not.toMatch(/from "\.\/automatic_observations"/);
		expect(source).not.toMatch(/from "\.\/readiness"/);
	});
});
