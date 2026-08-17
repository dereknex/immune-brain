import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as kernel from "../plugins/immune-brain/runtime/kernel/index";
import {
	completionDecision,
	projectTask,
} from "../plugins/immune-brain/runtime/kernel/completion";
import { parseTaskIntent, parseTaskRecord } from "../plugins/immune-brain/runtime/kernel/validation";
import { reduceTask } from "../plugins/immune-brain/runtime/kernel/reducer";
import { writeTaskRecord, applyTaskAction, readTaskRecord } from "../plugins/immune-brain/runtime/kernel/storage";

const REPO_ROOT = join(__dirname, "..");

describe("v1 public API compatibility", () => {
	test("v1 signatures remain exported and functional", () => {
		expect(typeof parseTaskRecord).toBe("function");
		expect(typeof parseTaskIntent).toBe("function");
		expect(typeof completionDecision).toBe("function");
		expect(typeof projectTask).toBe("function");
		expect(typeof reduceTask).toBe("function");
		expect(typeof writeTaskRecord).toBe("function");
		expect(typeof applyTaskAction).toBe("function");
		expect(typeof readTaskRecord).toBe("function");
	});

	test("no v2 record can enter v1 production writers", () => {
		const v2Shape = {
			contract: "assurance_kernel/task_record/v2",
			task_id: "123-short-goal",
		};
		expect(() => parseTaskRecord(v2Shape)).toThrow();
	});
});

describe("additive export surface", () => {
	test("new identity/v2 read APIs are exported", () => {
		expect(typeof kernel.readTaskIntent).toBe("function");
		expect(typeof kernel.parseTaskIntentV1).toBe("function");
		expect(typeof kernel.canonicalIntentHash).toBe("function");
		expect(typeof kernel.classifyIntentRevision).toBe("function");
		expect(typeof kernel.parseTaskRecordV2).toBe("function");
		expect(typeof kernel.completionDecisionV2).toBe("function");
		expect(typeof kernel.projectTaskV2).toBe("function");
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
			"applyTaskActionV2",
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
	test("index exports are v4-only: v1 mutation helpers are absent", () => {
		expect(typeof (kernel as Record<string, unknown>).writeTaskRecord).toBe("undefined");
		expect(typeof (kernel as Record<string, unknown>).applyTaskAction).toBe("undefined");
		expect(typeof kernel.reduceTask).toBe("function");
		expect(typeof kernel.readTaskRecordV2).toBe("function");
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
