import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runEnrollmentRehearsal, enrollTask, EnrollmentRehearsalError, type EnrollCanaryInput } from "../plugins/immune-brain/runtime/kernel/enrollment";
import { preparePiCanary } from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import {
	createEnrollmentAuthorityRegistry,
	type EnrollmentCapabilityBinding,
} from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { readBackendClaim } from "../plugins/immune-brain/runtime/kernel/backend_claim";
import {
	readRunRowByTask,
	readWorkspaceRow,
	withKernelRead,
} from "../plugins/immune-brain/runtime/kernel/sqlite_store";
import { existsSync } from "node:fs";

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
		scope_hint: [
			`plugins/immune-brain/runtime/kernel/${taskId}.ts`,
			`docs/specs/${taskId}.spec.md`,
			`docs/specs/archive/${taskId}.spec.md`,
		],
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
		// Zero authority: no run row, an idle workspace, no derived claim and no
		// retired file. The rehearsal may open the empty store lock, nothing more.
		expect(withKernelRead(root, (db) => readRunRowByTask(db, taskId))).toBeNull();
		expect(withKernelRead(root, (db) => readWorkspaceRow(db))?.current_run_id ?? null).toBeNull();
		expect(readBackendClaim(root)).toBeNull();
		expect(existsSync(join(root, ".imm/state/workspace.json"))).toBe(false);
		expect(existsSync(join(root, ".imm/state/active-claim.json"))).toBe(false);
		expect(existsSync(join(root, ".imm/state/tasks"))).toBe(false);
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

describe("single enrollment entry (deepen-authority-seams D3)", () => {
	const registry = createEnrollmentAuthorityRegistry();

	// The rehearsal fixtures bind a placeholder content hash; the entry's commit
	// recomputes the preparation digest from the real repository, so the binding
	// must carry that digest.
	function entryBinding(root: string, taskId: string, overrides: Partial<Record<"task_id" | "nonce", string>> = {}) {
		const prep = preparePiCanary(root, { task_id: taskId, now: "2026-08-12T00:00:00.000Z" });
		return {
			...bindingFor(root, taskId),
			intent_content_hash: prep.intent?.content_hash ?? bindingFor(root, taskId).intent_content_hash,
			preparation_digest: prep.digest,
			...overrides,
		};
	}

	test("a ready rehearsal enrolls the Task atomically, issuing the capability inside the entry", async () => {
		const root = makeRoot();
		const taskId = "task-entry-ready";
		writeIntent(root, taskId);
		const result = await enrollTask(root, registry, {
			binding: entryBinding(root, taskId),
			now: "2026-08-12T00:00:00.000Z",
		});
		expect(result.record.task_id).toBe(taskId);
		expect(result.record.lifecycle).toBe("active");
		expect(result.record.artifact_state).toBe("active");
		// The durable owners the entry's commit step wrote atomically.
		expect(readBackendClaim(root)?.task_id).toBe(taskId);
		expect(withKernelRead(root, (db) => readRunRowByTask(db, taskId))?.state).toBe("active");
		expect(withKernelRead(root, (db) => readRunRowByTask(db, taskId))?.claim_status).toBe("active");
	});

	test("a not-ready rehearsal rejects through the single shared message and leaves zero Kernel writes", async () => {
		const root = makeRoot();
		const taskId = "task-entry-blocked";
		// No intent sidecar: the precondition fails before any commit.
		let thrown: unknown;
		try {
			await enrollTask(root, registry, {
				binding: entryBinding(root, taskId),
				now: "2026-08-12T00:00:00.000Z",
			});
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(EnrollmentRehearsalError);
		expect((thrown as Error).message).toMatch(/^Kernel enrollment rehearsal failed: /);
		expect((thrown as EnrollmentRehearsalError).blockers.length).toBeGreaterThan(0);
		// Zero authority: no run row, an idle workspace, no derived claim and no
		// retired file.
		expect(withKernelRead(root, (db) => readRunRowByTask(db, taskId))).toBeNull();
		expect(withKernelRead(root, (db) => readWorkspaceRow(db))?.current_run_id ?? null).toBeNull();
		expect(readBackendClaim(root)).toBeNull();
		expect(existsSync(join(root, ".imm/state/workspace.json"))).toBe(false);
		expect(existsSync(join(root, ".imm/state/active-claim.json"))).toBe(false);
	});

	test("a declined checkpoint returns cancelled with zero Kernel writes", async () => {
		const root = makeRoot();
		const taskId = "task-entry-declined";
		writeIntent(root, taskId);
		const outcome = await enrollTask(root, registry, {
			binding: entryBinding(root, taskId),
			now: "2026-08-12T00:00:00.000Z",
			checkpoint: () => false,
		});
		expect(outcome).toEqual({ outcome: "cancelled" });
		// The rehearsal issued a capability but the declined checkpoint stopped
		// before the commit: still zero authority.
		expect(withKernelRead(root, (db) => readRunRowByTask(db, taskId))).toBeNull();
		expect(withKernelRead(root, (db) => readWorkspaceRow(db))?.current_run_id ?? null).toBeNull();
		expect(readBackendClaim(root)).toBeNull();
	});

	test("an accepting checkpoint enrolls and returns the discriminated outcome", async () => {
		const root = makeRoot();
		const taskId = "task-entry-accepted";
		writeIntent(root, taskId);
		const binding = entryBinding(root, taskId);
		const outcome = await enrollTask(root, registry, {
			binding,
			now: "2026-08-12T00:00:00.000Z",
			checkpoint: () => true,
		});
		expect(outcome.outcome).toBe("enrolled");
		if (outcome.outcome !== "enrolled") throw new Error("unreachable");
		expect(outcome.result.record.task_id).toBe(taskId);
		expect(readBackendClaim(root)?.task_id).toBe(taskId);
	});

	test("an accepting checkpoint commits even when the caller's cancel flag flips at the checkpoint", async () => {
		const root = makeRoot();
		const taskId = "task-entry-late-cancel";
		writeIntent(root, taskId);
		const aborted = { value: false };
		const outcome = await enrollTask(root, registry, {
			binding: entryBinding(root, taskId),
			now: "2026-08-12T00:00:00.000Z",
			// The Pi Tool's gate aborts and returns false before beginCommit; a
			// caller that instead flips its flag and still accepts can no longer
			// withdraw the commit, because the checkpoint is the last cancellation
			// point before the durable write.
			checkpoint: () => { aborted.value = true; return true; },
		});
		expect(aborted.value).toBe(true);
		expect(outcome.outcome).toBe("enrolled");
		if (outcome.outcome !== "enrolled") throw new Error("unreachable");
		expect(outcome.result.record.task_id).toBe(taskId);
		expect(readBackendClaim(root)?.task_id).toBe(taskId);
	});

	test("a request without any checkpoint returns the plain durable result", async () => {
		const root = makeRoot();
		const taskId = "task-entry-plain";
		writeIntent(root, taskId);
		const result = await enrollTask(root, registry, {
			binding: entryBinding(root, taskId),
			now: "2026-08-12T00:00:00.000Z",
		});
		expect(result.record.task_id).toBe(taskId);
		expect("outcome" in result).toBe(false);
		expect(readBackendClaim(root)?.task_id).toBe(taskId);
	});
});
