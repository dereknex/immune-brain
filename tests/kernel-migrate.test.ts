import { afterEach, describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runKernelCommand } from "../plugins/immune-brain/runtime/commands/kernel";
import * as kernelPublic from "../plugins/immune-brain/runtime/kernel";
import { createUserAuthorityContextForTest } from "../plugins/immune-brain/runtime/kernel/reducer";
import {
	KernelInvariantError,
} from "../plugins/immune-brain/runtime/kernel";
import {
	KernelStoreConflictError,
	applyTaskAction,
	readTaskRecord,
	readWorkspaceState,
	setAfterTaskTransactionWriteForTest,
	writeTaskRecord,
	type TaskRecord,
} from "../plugins/immune-brain/runtime/kernel/storage";

const roots: string[] = [];

function tempRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "imm-kernel-migrate-"));
	roots.push(root);
	mkdirSync(join(root, ".imm", "memory"), { recursive: true });
	return root;
}

function statePath(root: string): string {
	return join(root, ".imm", "memory", "current_iteration.json");
}

function writeState(root: string, state: Record<string, unknown>): string {
	const content = `${JSON.stringify(state, null, 2)}\n`;
	writeFileSync(statePath(root), content);
	return content;
}

function activeState(): Record<string, unknown> {
	return {
		schema_version: 3,
		plan_path: "docs/plans/example.md",
		plan_signature: "sha256:plan",
		runtime_status: "idle",
		requires_replan: false,
		active_step: 2,
		steps: {
			"1": { number: 1, step_id: "U1", state: "closed" },
			"2": { number: 2, step_id: "U2", state: "active" },
			"3": { number: 3, step_id: "U3", state: "pending" },
		},
	};
}

function taskRecord(
	taskId = "task-1",
	phase: TaskRecord["phase"] = "working",
): TaskRecord {
	return {
		contract: "assurance_kernel/task_record/v1",
		task_id: taskId,
		intent_revision: 1,
		phase,
		baseline: "sha256:baseline",
		evidence: [],
		findings: [],
		approvals: [],
		history: [],
	};
}

afterEach(() => {
	setAfterTaskTransactionWriteForTest(null);
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("imm-kernel migrate is retired", () => {
	it("rejects migrate with invalid_command and zero writes", () => {
		const root = tempRoot();
		const before = writeState(root, activeState());
		const first = runKernelCommand(["migrate", "--dry-run", "--json"], root);
		const second = runKernelCommand(["migrate", "--dry-run", "--json"], root);
		expect(first.returncode).toBe(2);
		expect(second.returncode).toBe(2);
		expect(JSON.parse(first.stdout)).toEqual(JSON.parse(second.stdout));
		expect(JSON.parse(first.stdout)).toMatchObject({
			error: { code: "invalid_command" },
		});
		expect(readFileSync(statePath(root), "utf8")).toBe(before);
		expect(existsSync(join(root, ".imm", "tasks"))).toBe(false);
		expect(existsSync(join(root, ".imm", "workspace.json"))).toBe(false);
	});

	it("rejects migrate regardless of ledger shape with zero journal writes", () => {
		const root = tempRoot();
		const before = writeState(root, {
			schema_version: 3,
			plan_path: "docs/plans/broken.md",
			runtime_status: "idle",
			requires_replan: false,
			active_step: null,
			steps: { "1": { state: "replanning" } },
		});
		const result = runKernelCommand(["migrate", "--dry-run", "--json"], root);
		expect(result.returncode).toBe(2);
		expect(JSON.parse(result.stdout)).toMatchObject({
			error: { code: "invalid_command" },
		});
		expect(readFileSync(statePath(root), "utf8")).toBe(before);
		expect(existsSync(join(root, ".imm", "journal.jsonl"))).toBe(false);
		expect(existsSync(join(root, ".imm", "tasks"))).toBe(false);
	});

	it("rejects migrate without --dry-run through the same retired path", () => {
		const root = tempRoot();
		const before = writeState(root, activeState());
		const result = runKernelCommand(["migrate", "--json"], root);
		expect(result.returncode).toBe(2);
		expect(JSON.parse(result.stdout)).toMatchObject({
			error: { code: "invalid_command" },
		});
		expect(readFileSync(statePath(root), "utf8")).toBe(before);
		expect(existsSync(join(root, ".imm", "tasks"))).toBe(false);
	});
});

describe("worktree-local kernel storage", () => {
	it("admits only an empty working TaskRecord through canonical creation", () => {
		const invalidRecords: TaskRecord[] = [
			taskRecord("review-task", "review"),
			taskRecord("done-task", "done"),
			taskRecord("stopped-task", "stopped"),
			{
				...taskRecord("evidence-task"),
				evidence: [
					{
						id: "E1",
						acceptance_id: "A1",
						task_revision: 1,
						diff_hash: "sha256:diff",
						status: "passed",
						actor_id: "executor",
						summary: "pre-populated",
					},
				],
			},
			{
				...taskRecord("finding-task"),
				findings: [
					{
						id: "F1",
						kind: "blocking",
						status: "open",
						acceptance_id: null,
						source: "kernel",
						review_round: null,
						summary: "pre-populated",
					},
				],
			},
			{
				...taskRecord("approval-task"),
				approvals: [
					{
						id: "P1",
						kind: "review",
						authority_role: "reviewer",
						task_revision: 1,
						diff_hash: "sha256:diff",
						actor_id: "reviewer",
						summary: "pre-populated",
					},
				],
			},
			{
				...taskRecord("history-task"),
				history: [
					{
						id: "H1",
						at: "2026-08-10T00:00:00Z",
						type: "submit_review",
						from_phase: "working",
						to_phase: "review",
						reason: null,
					},
				],
			},
		];
		for (const candidate of invalidRecords) {
			const root = tempRoot();
			const workspace = readWorkspaceState(root);
			expect(() =>
				writeTaskRecord(
					root,
					candidate,
					"missing",
					workspace.revision,
				),
			).toThrow("canonical TaskRecord creation requires");
			expect(readTaskRecord(root, candidate.task_id).record).toBeNull();
			expect(readWorkspaceState(root).state.current_working).toBeNull();
		}
	});

	it("binds privileged storage retries to the same authority descriptor", () => {
		expect("createUserAuthorityContextForTest" in kernelPublic).toBe(false);
		const root = tempRoot();
		const created = writeTaskRecord(
			root,
			taskRecord(),
			"missing",
			readWorkspaceState(root).revision,
		);
		const action = {
			type: "stop" as const,
			event_id: "store-authorized-stop",
			at: "2026-08-10T02:30:00Z",
			reason: "literal user cancelled",
		};
		expect(() =>
			applyTaskAction(
				root,
				"task-1",
				action,
				created.revision,
				created.workspace.revision,
			),
		).toThrow("stop requires user authority context");
		const authority = createUserAuthorityContextForTest({
			actor_id: "user-1",
			source: "literal_user",
			confirmation_ref: "prompt-42",
		});
		const stopped = applyTaskAction(
			root,
			"task-1",
			action,
			created.revision,
			created.workspace.revision,
			authority,
		);
		expect(stopped.record.phase).toBe("stopped");
		expect(
			applyTaskAction(
				root,
				"task-1",
				action,
				created.revision,
				created.workspace.revision,
				authority,
			),
		).toEqual(stopped);
		const changedAuthority = createUserAuthorityContextForTest({
			actor_id: "user-2",
			source: "literal_user",
			confirmation_ref: "prompt-43",
		});
		expect(() =>
			applyTaskAction(
				root,
				"task-1",
				action,
				created.revision,
				created.workspace.revision,
				changedAuthority,
			),
		).toThrow("event_id store-authorized-stop conflicts");
	});

	it("enforces reducer updates and coordinates the working claim", () => {
		const root = tempRoot();
		const initialWorkspace = readWorkspaceState(root);
		const created = writeTaskRecord(
			root,
			taskRecord(),
			"missing",
			initialWorkspace.revision,
		);
		expect(created.revision).toStartWith("sha256:");
		expect(created.workspace.state.current_working).toBe("task-1");
		expect(readTaskRecord(root, "task-1")).toMatchObject({
			revision: created.revision,
			record: { task_id: "task-1", phase: "working" },
		});

		const beforeIllegal = readFileSync(
			join(root, ".imm", "tasks", "task-1.json"),
			"utf8",
		);
		for (const illegal of [
			{ ...created.record, phase: "done" as const },
			{ ...created.record, history: [] },
		]) {
			expect(() =>
				writeTaskRecord(
					root,
					illegal,
					created.revision,
					created.workspace.revision,
				),
			).toThrow(KernelInvariantError);
			expect(
				readFileSync(join(root, ".imm", "tasks", "task-1.json"), "utf8"),
			).toBe(beforeIllegal);
		}

		const action = {
			type: "submit_review" as const,
			event_id: "store-submit",
			at: "2026-08-10T02:00:00Z",
		};
		const reviewed = applyTaskAction(
			root,
			"task-1",
			action,
			created.revision,
			created.workspace.revision,
		);
		expect(reviewed.record.phase).toBe("review");
		expect(reviewed.workspace.state.current_working).toBeNull();
		expect(reviewed.record.history).toHaveLength(1);
		expect(
			applyTaskAction(
				root,
				"task-1",
				action,
				created.revision,
				created.workspace.revision,
			),
		).toEqual(reviewed);

		const reviewedBytes = readFileSync(
			join(root, ".imm", "tasks", "task-1.json"),
			"utf8",
		);
		for (const illegal of [
			{ ...reviewed.record, history: [] },
			{
				...reviewed.record,
				history: [{ ...reviewed.record.history[0], reason: "rewritten" }],
			},
		]) {
			expect(() =>
				writeTaskRecord(
					root,
					illegal,
					reviewed.revision,
					reviewed.workspace.revision,
				),
			).toThrow(KernelInvariantError);
			expect(
				readFileSync(join(root, ".imm", "tasks", "task-1.json"), "utf8"),
			).toBe(reviewedBytes);
		}

		const transferred = writeTaskRecord(
			root,
			taskRecord("task-2"),
			"missing",
			reviewed.workspace.revision,
		);
		expect(transferred.workspace.state.current_working).toBe("task-2");
		expect(() =>
			applyTaskAction(
				root,
				"task-1",
				{
					type: "request_rework",
					event_id: "blocked-reclaim",
					at: "2026-08-10T02:01:00Z",
					findings: [
						{
							id: "blocked-reclaim-finding",
							kind: "blocking",
							acceptance_id: null,
							summary: "task-2 owns the workspace",
						},
					],
				},
				reviewed.revision,
				transferred.workspace.revision,
			),
		).toThrow(KernelStoreConflictError);
		expect(readTaskRecord(root, "task-1").record?.phase).toBe("review");
		expect(readWorkspaceState(root).state.current_working).toBe("task-2");
	});

	it("admits exactly one working claim from the same workspace snapshot", () => {
		const root = tempRoot();
		const snapshot = readWorkspaceState(root);
		const first = writeTaskRecord(
			root,
			taskRecord("task-1"),
			"missing",
			snapshot.revision,
		);
		expect(() =>
			writeTaskRecord(
				root,
				taskRecord("task-2"),
				"missing",
				snapshot.revision,
			),
		).toThrow(KernelStoreConflictError);
		expect(readTaskRecord(root, "task-2").record).toBeNull();
		expect(readWorkspaceState(root)).toEqual(first.workspace);
	});

	it("recovers a transaction failure without exposing partial state", () => {
		const root = tempRoot();
		const created = writeTaskRecord(
			root,
			taskRecord(),
			"missing",
			readWorkspaceState(root).revision,
		);
		setAfterTaskTransactionWriteForTest(() => {
			throw new Error("injected transaction interruption");
		});
		const reviewed = applyTaskAction(
			root,
			"task-1",
			{
				type: "submit_review",
				event_id: "recover-submit",
				at: "2026-08-10T03:00:00Z",
			},
			created.revision,
			created.workspace.revision,
		);
		expect(reviewed.record.phase).toBe("review");
		expect(reviewed.workspace.state.current_working).toBeNull();
		expect(readTaskRecord(root, "task-1").record?.phase).toBe("review");
		expect(existsSync(join(root, ".imm", "tasks", ".workspace-transaction.json"))).toBe(false);
	});

	it("recovers a stale process lock before reading storage", () => {
		const root = tempRoot();
		mkdirSync(join(root, ".imm", "tasks"), { recursive: true });
		writeFileSync(
			join(root, ".imm", "tasks", ".workspace.lock"),
			`${JSON.stringify({ pid: 99_999_999, started_at: "2026-08-10T00:00:00Z" })}\n`,
		);
		expect(readWorkspaceState(root).state.current_working).toBeNull();
		expect(existsSync(join(root, ".imm", "tasks", ".workspace.lock"))).toBe(
			false,
		);
	});

	it("rejects symlinked storage segments", () => {
		const root = tempRoot();
		const outside = mkdtempSync(join(tmpdir(), "imm-kernel-store-outside-"));
		roots.push(outside);
		symlinkSync(outside, join(root, ".imm", "tasks"));
		expect(() =>
			writeTaskRecord(
				root,
				taskRecord(),
				"missing",
				readWorkspaceState(root).revision,
			),
		).toThrow(
			"symlink",
		);
	});

	it("keeps execution state out of git", () => {
		const gitignore = readFileSync(join(process.cwd(), ".gitignore"), "utf8");
		expect(gitignore).toContain(".imm/tasks/");
		expect(gitignore).toContain(".imm/workspace.json");
		expect(gitignore).toContain(".imm/journal.jsonl");
	});
});
