import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runEnrollmentRehearsal, type EnrollCanaryInput } from "../plugins/immune-brain/runtime/kernel/enrollment";
import {
	createEnrollmentAuthorityRegistry,
	type EnrollmentCapabilityBinding,
} from "../plugins/immune-brain/runtime/kernel/enrollment_authority";

function makeRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "p2b0-rehearsal-"));
	mkdirSync(join(root, ".imm/state"), { recursive: true });
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	return root;
}

function bindingFor(root: string, taskId: string): EnrollmentCapabilityBinding {
	return {
		task_id: taskId,
		intent_path: `docs/plans/${taskId}.intent.json`,
		intent_revision: 1,
		intent_content_hash: "sha256:intent",
		actor_id: "user",
		confirmation_ref: "pi-confirm-001",
		expires_at: "2099-01-01T00:00:00.000Z",
		nonce: "nonce-001",
	};
}

function writeIntent(root: string, taskId: string) {
	const intent = {
		contract: "assurance_kernel/task_intent/v1",
		task_id: taskId,
		owner: "user",
		goal: `goal ${taskId}`,
		acceptance: [{ id: "acc-1", assertion: "a", verification: "bun test" }],
		scope_hint: [`plugins/immune-brain/runtime/kernel/${taskId}.ts`],
		risk: "routine",
		revision: 1,
	};
	writeFileSync(join(root, "docs", "plans", `${taskId}.intent.json`), `${JSON.stringify(intent, null, 2)}\n`);
	gitInitAndCommit(root);
}

function gitInitAndCommit(root: string): void {
	const { execFileSync } = require("node:child_process");
	try {
		execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
		execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
		execFileSync("git", ["commit", "-q", "-m", "fixture"], {
			cwd: root,
			stdio: "ignore",
			env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
		});
	} catch {
		// git may be unavailable in sandbox
	}
}

function inputFor(root: string, taskId: string): EnrollCanaryInput {
	return {
		task_id: taskId,
		intent_path: `docs/plans/${taskId}.intent.json`,
		intent_revision: 1,
		capability_binding: bindingFor(root, taskId),
		now: "2026-08-12T00:00:00.000Z",
	};
}

describe("enrollment rehearsal", () => {
	const registry = createEnrollmentAuthorityRegistry();
	test("full rehearsal emits strict evidence without writing any authority file", () => {
		const root = makeRoot();
		const taskId = "task-001";
		writeIntent(root, taskId);
		const cap = registry.issue(bindingFor(root, taskId));
		const result = runEnrollmentRehearsal(root, inputFor(root, taskId), cap, registry);
		expect(result.rehearsed).toBe(true);
		expect(result.writes_performed).toBe(false);
		expect(result.evidence.contract).toBe("assurance_kernel/enrollment_rehearsal/v1");
		expect(result.evidence.task_id).toBe(taskId);
		expect(result.evidence.outcome).toBe("ready");
		// no TaskRecord / workspace / backend claim written
		// Only the ignored locks directory may exist; zero authority bytes are written.
		const stateEntries = readdirSync(join(root, ".imm/state")).filter((entry) => entry !== "locks");
		expect(stateEntries).toEqual([]);
	});

	test("rehearsal with missing intent reports not-ready without throwing", () => {
		const root = makeRoot();
		const taskId = "task-002";
		const cap = registry.issue(bindingFor(root, taskId));
		const result = runEnrollmentRehearsal(root, inputFor(root, taskId), cap, registry);
		expect(result.rehearsed).toBe(true);
		expect(result.writes_performed).toBe(false);
		expect(result.evidence.outcome).toBe("not_ready");
		expect(result.evidence.blockers.length).toBeGreaterThan(0);
	});

	test("rehearsal never consumes the capability", () => {
		const root = makeRoot();
		const taskId = "task-003";
		writeIntent(root, taskId);
		const cap = registry.issue(bindingFor(root, taskId));
		runEnrollmentRehearsal(root, inputFor(root, taskId), cap, registry);
		// capability still usable for a second rehearsal / actual enrollment
		const second = runEnrollmentRehearsal(root, inputFor(root, taskId), cap, registry);
		expect(second.evidence.outcome).toBe("ready");
	});
});
