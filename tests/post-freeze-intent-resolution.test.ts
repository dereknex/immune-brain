// Regression guard for the post-freeze TaskIntent settlement path.
//
// `freeze_artifacts` relocates the sidecar from `docs/plans/<task-id>.intent.json`
// into `docs/plans/archive/`. A Host adapter that reads the intent at the
// pre-freeze default path can never settle QA after a freeze. The Claude Code
// adapter carried that defect from the day the Host was added; no test covered
// the boundary because every settled task in this repository had run on Pi.

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";

const TASK_ID = "123-short-goal";
const ACTIVE_PATH = `docs/plans/${TASK_ID}.intent.json`;
const ARCHIVED_PATH = `docs/plans/archive/${TASK_ID}.intent.json`;

const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: TASK_ID,
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

function git(root: string, args: string[]): void {
	execFileSync("git", args, { cwd: root, stdio: "pipe" });
}

function makeRepo(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "imm-post-freeze-"));
	git(root, ["init", "-q"]);
	git(root, ["config", "user.email", "test@example.com"]);
	git(root, ["config", "user.name", "Test"]);
	for (const [rel, content] of Object.entries(files)) {
		const target = join(root, rel);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, content);
	}
	git(root, ["add", "-A"]);
	return root;
}

const intentJson = `${JSON.stringify(INTENT, null, 2)}\n`;

describe("post-freeze TaskIntent resolution", () => {
	test("resolves the archived sidecar when the active path is gone", () => {
		const root = makeRepo({ [ARCHIVED_PATH]: intentJson });
		try {
			const read = readTaskIntent(root, TASK_ID);
			expect(read.intent_ref.path).toBe(ARCHIVED_PATH);
			expect(read.intent.task_id).toBe(TASK_ID);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("still resolves the active sidecar before freeze", () => {
		const root = makeRepo({ [ACTIVE_PATH]: intentJson });
		try {
			expect(readTaskIntent(root, TASK_ID).intent_ref.path).toBe(ACTIVE_PATH);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("honours an explicitly requested archived path", () => {
		const root = makeRepo({ [ARCHIVED_PATH]: intentJson });
		try {
			expect(readTaskIntent(root, TASK_ID, ARCHIVED_PATH).intent_ref.path).toBe(ARCHIVED_PATH);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("reports a stable contract failure instead of a raw ENOENT", () => {
		const root = makeRepo({ "docs/plans/.keep": "" });
		try {
			expect(() => readTaskIntent(root, TASK_ID)).toThrow(
				`TaskIntent sidecar is missing at ${ACTIVE_PATH}`,
			);
			expect(() => readTaskIntent(root, TASK_ID, ARCHIVED_PATH)).toThrow(
				`TaskIntent sidecar is missing at ${ARCHIVED_PATH}`,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("the active sidecar wins when both paths exist", () => {
		// A leftover archived sidecar from an earlier task reusing this id must not
		// shadow the live one, so a path-less read only consults the archive once
		// the active path is gone.
		const stale = `${JSON.stringify({ ...INTENT, goal: "Stale archived outcome" }, null, 2)}\n`;
		const root = makeRepo({ [ACTIVE_PATH]: intentJson, [ARCHIVED_PATH]: stale });
		try {
			const read = readTaskIntent(root, TASK_ID);
			expect(read.intent_ref.path).toBe(ACTIVE_PATH);
			expect(read.intent.goal).toBe(INTENT.goal);
			// The record is still the authority: an explicit path reaches the archive.
			expect(readTaskIntent(root, TASK_ID, ARCHIVED_PATH).intent.goal).toBe("Stale archived outcome");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("Host adapter intent resolution parity", () => {
	// Both Hosts must resolve the sidecar through the TaskRecord's
	// `intent_ref.path`. A bare `readTaskIntent(root, taskId)` in an adapter is the
	// exact shape of the original defect, so it stays banned at the source level.
	const adapters = [
		"plugins/immune-brain/runtime/claude/kernel_ports.ts",
		"plugins/immune-brain/.pi-extension/runtime-stub.ts",
	];

	for (const relativePath of adapters) {
		test(`${relativePath} never reads the intent at the default path`, () => {
			const source = readFileSync(resolve(relativePath), "utf8");
			const bare = source.match(/readTaskIntent\(\s*[A-Za-z_.]+\s*,\s*[A-Za-z_.]+\s*\)/g) ?? [];
			expect({ relativePath, bare }).toEqual({ relativePath, bare: [] });
		});

		test(`${relativePath} resolves the sidecar from the TaskRecord`, () => {
			const source = readFileSync(resolve(relativePath), "utf8");
			expect(source).toContain("intent_ref");
		});
	}
});
