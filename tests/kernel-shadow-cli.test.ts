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

const roots: string[] = [];

function tempRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "imm-kernel-shadow-"));
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

function followUpState(
	state: "executing" | "ready_for_review" | "rework_needed" | "replanning",
): Record<string, unknown> {
	return {
		id: "follow-up-shadow",
		state,
		scope: ["plugins/immune-brain/runtime/kernel/legacy.ts"],
		change_goal: "Repair one review finding",
		verification_hint: "bun test tests/kernel-shadow-cli.test.ts",
		origin_review: {
			gate: "imm-code-review",
			evidence_ref: "review://shadow-finding",
		},
		execution_evidence: null,
		opened_at: "2026-08-11T00:00:00Z",
		round: 1,
	};
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("imm-kernel shadow status", () => {
	it("reports a matching active aggregate without changing v3 state", () => {
		const root = tempRoot();
		const before = writeState(root, activeState());
		const result = runKernelCommand(["status", "--json"], root);
		expect(result.returncode).toBe(0);
		const output = JSON.parse(result.stdout);
		expect(output.contract).toBe("assurance_kernel/shadow_status/v1");
		expect(output.shadow).toMatchObject({
			phase: "working",
			ambiguous: false,
		});
		expect(output.divergence).toEqual({ detected: false, fields: [] });
		expect(readFileSync(statePath(root), "utf8")).toBe(before);
		expect(existsSync(join(root, ".imm/state"))).toBe(false);
		expect(existsSync(join(root, ".imm", "workspace.json"))).toBe(false);
	});

	it("reports a normally finished aggregate as done without changing v3 state", () => {
		const root = tempRoot();
		const planPath = "docs/plans/finished.md";
		const before = writeState(root, {
			schema_version: 3,
			plan_path: planPath,
			plan_terminal: null,
			runtime_status: "idle",
			reset_reason: "intentional_reset",
			requires_replan: false,
			active_step: null,
			pending_follow_up: null,
			steps: {
				"1": { number: 1, step_id: "U1", state: "closed" },
			},
			history: [
				{
					at: "2026-08-11T03:00:02Z",
					action: "finish_reset",
					details: { plan_path: planPath },
				},
			],
		});
		const result = runKernelCommand(["status", "--json"], root);
		expect(result.returncode).toBe(0);
		expect(JSON.parse(result.stdout).shadow).toEqual({
			phase: "done",
			reason: "legacy-finished",
			ambiguous: false,
			source_states: ["closed"],
		});
		expect(readFileSync(statePath(root), "utf8")).toBe(before);
		expect(existsSync(join(root, ".imm/state"))).toBe(false);
		expect(existsSync(join(root, ".imm", "workspace.json"))).toBe(false);
	});

	it("surfaces the reproduced replanning divergence", () => {
		const root = tempRoot();
		writeState(root, {
			schema_version: 3,
			plan_path: "docs/plans/broken.md",
			runtime_status: "idle",
			requires_replan: false,
			active_step: null,
			steps: { "1": { number: 1, step_id: "U1", state: "replanning" } },
			next_action: { action: "activate", command: "imm-work activate broken.md 1" },
		});
		const result = runKernelCommand(["status", "--json"], root);
		expect(result.returncode).toBe(0);
		const output = JSON.parse(result.stdout);
		expect(output.shadow).toMatchObject({
			phase: "stopped",
			reason: "legacy-inconsistent",
			ambiguous: true,
		});
		expect(output.divergence.detected).toBe(true);
		expect(output.divergence.fields).toEqual([
			"requires_replan",
			"next_action",
		]);
	});

	it("distinguishes equivalent and conflicting follow-up replan signals", () => {
		const root = tempRoot();
		const replanning = {
			schema_version: 3,
			plan_path: "docs/plans/follow-up.md",
			runtime_status: "idle",
			requires_replan: true,
			active_step: null,
			steps: { "1": { number: 1, step_id: "U1", state: "closed" } },
			pending_follow_up: followUpState("replanning"),
			next_action: {
				action: "terminate_plan",
				command: "imm-plan --terminate-current --status superseded",
			},
		};
		writeState(root, replanning);
		const result = runKernelCommand(["status", "--json"], root);
		expect(result.returncode).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({
			shadow: {
				phase: "stopped",
				reason: "legacy-replan",
				ambiguous: false,
			},
			divergence: { detected: false, fields: [] },
		});

		writeState(root, { ...replanning, requires_replan: false });
		const missingFlag = JSON.parse(
			runKernelCommand(["status", "--json"], root).stdout,
		);
		expect(missingFlag.shadow).toMatchObject({
			phase: "stopped",
			reason: "legacy-inconsistent",
			ambiguous: true,
		});
		expect(missingFlag.divergence.fields).toEqual(["requires_replan"]);

		writeState(root, {
			...replanning,
			requires_replan: true,
			pending_follow_up: followUpState("executing"),
		});
		const extraFlag = JSON.parse(
			runKernelCommand(["status", "--json"], root).stdout,
		);
		expect(extraFlag.shadow).toMatchObject({
			phase: "stopped",
			reason: "legacy-inconsistent",
			ambiguous: true,
		});
		expect(extraFlag.divergence.fields).toEqual(["requires_replan"]);
	});

	it("projects follow-up ownership and reports concurrent owners", () => {
		const root = tempRoot();
		writeState(root, {
			...activeState(),
			active_step: null,
			steps: { "1": { number: 1, step_id: "U1", state: "closed" } },
			pending_follow_up: followUpState("executing"),
		});
		const valid = JSON.parse(
			runKernelCommand(["status", "--json"], root).stdout,
		);
		expect(valid.shadow).toMatchObject({ phase: "working", ambiguous: false });
		expect(valid.divergence).toEqual({ detected: false, fields: [] });

		writeState(root, {
			...activeState(),
			pending_follow_up: followUpState("executing"),
		});
		const conflicting = JSON.parse(
			runKernelCommand(["status", "--json"], root).stdout,
		);
		expect(conflicting.shadow).toMatchObject({
			phase: "stopped",
			reason: "legacy-inconsistent",
			ambiguous: true,
		});
		expect(conflicting.divergence.detected).toBe(true);
		expect(conflicting.divergence.fields).toContain("ownership");
	});

	it("rejects retired readiness and journal CLI without authority writes", () => {
		const root = tempRoot();
		const ledgerBefore = writeState(root, activeState());
		const result = runKernelCommand(["readiness", "--json"], root);
		expect(result.returncode).toBe(2);
		expect(JSON.parse(result.stdout)).toMatchObject({
			error: { code: "invalid_command" },
		});
		const journalCli = runKernelCommand(["journal", "--json"], root);
		expect(journalCli.returncode).toBe(2);
		expect(JSON.parse(journalCli.stdout)).toMatchObject({
			error: { code: "invalid_command" },
		});
		expect(readFileSync(statePath(root), "utf8")).toBe(ledgerBefore);
		expect(existsSync(join(root, ".imm/state"))).toBe(false);
		expect(existsSync(join(root, ".imm", "workspace.json"))).toBe(false);
	});

	it("journals rejected commands without mutating authoritative state", () => {
		const root = tempRoot();
		const before = writeState(root, activeState());
		const result = runKernelCommand(["delete-everything", "--json"], root);
		expect(result.returncode).toBe(2);
		const journalPath = join(root, ".imm/state/journal.jsonl");
		expect(existsSync(journalPath)).toBe(true);
		const entries = readFileSync(journalPath, "utf8")
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line));
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			contract: "assurance_kernel/journal/v1",
			command: "delete-everything",
			result: "rejected",
			reason_code: "invalid_command",
			planner_reentry: false,
			user_intervention: false,
		});
		expect(readFileSync(statePath(root), "utf8")).toBe(before);
	});

	it("status is strictly read-only and never touches the journal", () => {
		const root = tempRoot();
		writeState(root, activeState());
		const outside = mkdtempSync(join(tmpdir(), "imm-kernel-journal-outside-"));
		roots.push(outside);
		const outsideJournal = join(outside, "journal.jsonl");
		writeFileSync(outsideJournal, "outside\n");
		mkdirSync(join(root, ".imm/state"), { recursive: true });
		symlinkSync(outsideJournal, join(root, ".imm/state/journal.jsonl"));
		const result = runKernelCommand(["status", "--json"], root);
		expect(result.returncode).toBe(0);
		// Read-only status never appends the friction journal: no warning and
		// the symlinked target stays untouched.
		expect(result.stderr).toBe("");
		expect(readFileSync(outsideJournal, "utf8")).toBe("outside\n");
	});

	it("rejects a symlinked v3 Ledger path", () => {
		const root = tempRoot();
		const outside = mkdtempSync(join(tmpdir(), "imm-kernel-outside-"));
		roots.push(outside);
		writeFileSync(join(outside, "state.json"), JSON.stringify(activeState()));
		rmSync(statePath(root), { force: true });
		symlinkSync(join(outside, "state.json"), statePath(root));
		const result = runKernelCommand(["status", "--json"], root);
		expect(result.returncode).toBe(1);
		expect(JSON.parse(result.stdout)).toMatchObject({
			error: { code: "source_invalid" },
		});
	});
});
