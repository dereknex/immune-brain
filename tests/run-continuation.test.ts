import { describe, expect, test } from "bun:test";
import { bindRun, decideRunContinuation, releasesRunBinding, type TaskContinuationObservation, type ParentContinuationObservation } from "../plugins/immune-brain/runtime/assurance/run_continuation";
import type { StatusProjectionResult } from "../plugins/immune-brain/runtime/assurance/coordinator";

const session = { workspace: "/test/project", session_id: "session-a" };
const binding = { ...session, kind: "task" as const, task_id: "slice-a", run_id: "run-a" };
function status(): StatusProjectionResult {
	return { contract: "assurance_kernel/assurance_projection/v1", task_id: "slice-a", error: null,
		claim: { task_id: "slice-a", lifecycle_status: "active" },
		projection: { run_id: "run-a", record_revision: "record-a", workspace_revision: "workspace-a", intent_revision: 1,
			intent_content_hash: "intent-a", diff_hash: "diff-a", lifecycle: "active", artifact_state: "active", risk: "material",
			next_obligation: "submit_assurance", fresh_acceptance_ids: [], missing_acceptance_ids: ["A1"], stale_attestation_ids: [],
			fresh_approval_kinds: [], missing_approval_kinds: ["qa", "review"], blocking_finding_ids: [],
			unresolved_user_decision_ids: [], replan_required_ids: [], independence_violations: [], open_user_decision_count: 0,
			completion_ready: false, authorization: { state: "none", blocked: null } } };
}
function observation(boundary_id = "boundary-1"): TaskContinuationObservation {
	return { ...session, kind: "task", boundary_id, status: status(), source_digest: "source-a", review: "unobserved" };
}

describe("goal-driven continuation", () => {
	test("ordinary questions preserve binding; cancellation and planning release it", () => {
		for (const prompt of ["目前进展如何", "为什么停止了？", "Explain the failure", "修改这个函数的错误处理"])
			expect(releasesRunBinding(prompt, null)).toBe(false);
		for (const prompt of ["停止执行", "取消任务", "stop", "Cancel this run."])
			expect(releasesRunBinding(prompt, null)).toBe(true);
		expect(releasesRunBinding("/draw-up", "planner")).toBe(true);
		expect(() => bindRun({ ...binding, run_id: "" })).toThrow("exact session");
	});

	test("claim, run and session mismatch fail closed", () => {
		for (const corrupt of [
			(o: TaskContinuationObservation) => { o.status.error = "invalid storage"; },
			(o: TaskContinuationObservation) => { o.status.claim = null; },
			(o: TaskContinuationObservation) => { o.status.projection.run_id = "other-run"; },
			(o: TaskContinuationObservation) => { o.status.task_id = "other-task"; },
		]) {
			const o = observation(); corrupt(o);
			expect(decideRunContinuation(bindRun(binding), o).action).toBe("pause");
		}
		expect(decideRunContinuation(bindRun(binding), { ...observation(), session_id: "other-session" }).action).toBe("unbound");
	});

	test("only Kernel terminal settlement completes a task", () => {
		const o = observation();
		expect(decideRunContinuation(bindRun(binding), o).action).toBe("continue");
		o.status.projection.completion_ready = true;
		expect(decideRunContinuation(bindRun(binding), o).action).toBe("continue");
		o.status.projection.lifecycle = "done"; o.status.claim = null;
		expect(decideRunContinuation(bindRun(binding), o).action).toBe("settled");
	});

	test("unstaged source edits remain observable and cannot mint assurance", () => {
		const o = observation();
		o.status.warnings = [{ code: "unstaged_scope_paths", paths: ["src/a.ts"], message: "stage before assurance" }];
		const first = decideRunContinuation(bindRun(binding), o);
		expect(first.next_action).toContain("stage task-owned");
		const unchanged = decideRunContinuation(first.state, { ...o, boundary_id: "boundary-2" });
		expect(unchanged.state.unchanged_observations).toBe(1);
		expect(unchanged.action).toBe("pause");
		const changed = decideRunContinuation(unchanged.state, { ...o, boundary_id: "boundary-3", source_digest: "edited-source" });
		expect(changed.action).toBe("continue");
		expect(changed.state.unchanged_observations).toBe(0);
		expect(o.status.projection.fresh_acceptance_ids).toEqual([]);
	});

	test("status reads, record revisions and duplicate boundaries do not reset stalls", () => {
		const first = decideRunContinuation(bindRun(binding), observation());
		const duplicate = decideRunContinuation(first.state, observation());
		expect(duplicate.action).toBe("wait");
		expect(duplicate.state).toBe(first.state);
		const o = observation("boundary-2"); o.status.projection.record_revision = "status-only-revision";
		const second = decideRunContinuation(first.state, o);
		expect(second.state.unchanged_observations).toBe(1);
		expect(second.action).toBe("pause");
		expect(decideRunContinuation(second.state, observation("boundary-3")).action).toBe("pause");
	});

	test("each Review state selects the right action without duplicate dispatch", () => {
		const o = observation(); o.status.projection.next_obligation = "run_review"; o.status.projection.artifact_state = "frozen";
		for (const [review, action, expected] of [
			["unobserved", "continue", "advance_assurance"], ["ready", "continue", "reserved foreground reviewer once"],
			["running", "wait", "do not dispatch another"], ["returned", "continue", "submit_review immediately"],
		] as const) {
			const result = decideRunContinuation(bindRun(binding), { ...o, review });
			expect(result.action).toBe(action); expect(result.next_action).toContain(expected);
		}
		expect(decideRunContinuation(bindRun(binding), { ...o, review: "rejected" }).action).toBe("pause");
		expect(decideRunContinuation(bindRun(binding), { ...o, review: "rejected", recovery_action: "run QA again" }).next_action).toBe("run QA again");
		let state = bindRun(binding);
		for (let i = 0; i < 5; i++) state = decideRunContinuation(state, { ...o, review: "running", boundary_id: String(i) }).state;
		expect(decideRunContinuation(state, { ...o, review: "returned", boundary_id: "returned" }).action).toBe("continue");
	});

	test("failed native gates and user decisions pause without retry", () => {
		expect(decideRunContinuation(bindRun(binding), { ...observation(), host_failure: "Enrollment cancelled" }).action).toBe("pause");
		const o = observation(); o.status.projection.unresolved_user_decision_ids = ["decision-a"];
		expect(decideRunContinuation(bindRun(binding), o).action).toBe("pause");
	});

	test("Parent completes only with all required integrations and final verification", () => {
		const state = bindRun({ ...session, kind: "parent", initiative_slug: "initiative-a", batch_id: "batch-a", plan_digest: "plan-a" });
		const o: ParentContinuationObservation = { ...session, kind: "parent", boundary_id: "parent-1", initiative_slug: "initiative-a",
			batch_id: "batch-a", plan_digest: "plan-a", progress_digest: "progress-a", all_required_integrated: false,
			final_passed: false, pending_repair: false, runnable: true, executors_running: false, next_action: "Dispatch the next ready child" };
		expect(decideRunContinuation(state, o).action).toBe("continue");
		expect(decideRunContinuation(state, { ...o, runnable: false, executors_running: true }).action).toBe("wait");
		expect(decideRunContinuation(state, { ...o, runnable: false, all_required_integrated: true }).action).toBe("pause");
		expect(decideRunContinuation(state, { ...o, all_required_integrated: true, final_passed: true, pending_repair: true }).action).toBe("continue");
		expect(decideRunContinuation(state, { ...o, all_required_integrated: true, final_passed: true }).action).toBe("settled");
		expect(decideRunContinuation(state, { ...o, plan_digest: "another-plan" }).action).toBe("pause");
	});
});
