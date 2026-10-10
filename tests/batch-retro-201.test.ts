// #201: machine-checked scope overlap, full verification after a lane batch
// completes, and a Host notice for an active Managed task.
import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { projectScopeOverlap } from "../plugins/immune-brain/runtime/unattended/batch_schedule";
import { parseFinalVerification, runFinalVerification } from "../plugins/immune-brain/runtime/unattended/batch_final_verification";
import { activeTaskNotice } from "../plugins/immune-brain/runtime/assurance/active_task_notice";
import { activeTaskHookOutput } from "../plugins/immune-brain/runtime/claude/lane_guard";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import { seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const flat = (rel: string) => readFileSync(resolve(REPO_ROOT, rel), "utf8").replace(/\s+/g, " ");

describe("machine-checked scope overlap", () => {
	const s2 = "docs/plans/user-scenarios-s2-tracker-projection.intent.json";
	const s3 = "docs/plans/user-scenarios-s3-reviewer-coverage.intent.json";
	const read = (rel: string) => JSON.parse(readFileSync(resolve(REPO_ROOT, rel), "utf8")) as { task_id: string; scope_hint: string[] };

	it("reports the Spec path the #187 S2 and S3 Intents share and orders them serially", () => {
		const children = [read(s2), read(s3)].map((intent) => ({ task_id: intent.task_id, blocked_by: [], scope_hint: intent.scope_hint }));
		const report = projectScopeOverlap(children);
		expect(report.overlaps).toHaveLength(1);
		expect(report.overlaps[0]!.entries).toContainEqual(["docs/specs/user-acceptance-scenarios.spec.md", "docs/specs/user-acceptance-scenarios.spec.md"]);
		expect(report.parallel_groups).toEqual([[children[0]!.task_id], [children[1]!.task_id]]);
	});

	it("is exposed read-only as imm-kernel intent overlap", () => {
		const out = execFileSync(join(REPO_ROOT, "plugins/immune-brain/bin/imm-kernel"), ["intent", "overlap", s2, s3, "--json"], { cwd: REPO_ROOT, encoding: "utf8" });
		const report = JSON.parse(out);
		expect(report.contract).toBe("assurance_kernel/intent_scope_overlap/v1");
		expect(report.overlaps[0].entries[0][0]).toBe("docs/specs/user-acceptance-scenarios.spec.md");
	});

	it("reports nothing for disjoint scopes", () => {
		const report = projectScopeOverlap([
			{ task_id: "a", blocked_by: [], scope_hint: ["src/a.ts"] },
			{ task_id: "b", blocked_by: [], scope_hint: ["src/b.ts"] },
		]);
		expect(report.overlaps).toEqual([]);
		expect(report.parallel_groups).toEqual([["a", "b"]]);
	});

	it("is required by the Planner contract instead of a hand-written verified", () => {
		const planner = flat("plugins/immune-brain/dist/imm-planner.md");
		expect(planner).toContain("run `imm-kernel intent overlap <path> <path>... --json`");
		expect(planner).toContain('Never write "disjoint" or "verified" for scopes by hand');
	});
});

describe("final verification after a lane batch completes", () => {
	it("accepts the project's commands as plain argv and refuses shell syntax", () => {
		expect(parseFinalVerification(undefined)).toBeUndefined();
		expect(parseFinalVerification(["bun test", "bun  run   typecheck"])).toEqual(["bun test", "bun run typecheck"]);
		expect(() => parseFinalVerification(["bun test && rm -rf /"])).toThrow(/shell/);
		expect(() => parseFinalVerification([])).toThrow();
		expect(() => parseFinalVerification(["a\nb"])).toThrow();
		// Quoting would be split on spaces and passed literally, so it is refused up front.
		expect(() => parseFinalVerification(['bun test --test-name-pattern "lane batch"'])).toThrow(/quoting/);
		expect(() => parseFinalVerification(["bun test --test-name-pattern 'x'"])).toThrow(/quoting/);
	});

	it("records command, exit status and timing, and marks a failing run as not passed", async () => {
		const dir = realpathSync(mkdtempSync(join(tmpdir(), "imm-final-")));
		try {
			execFileSync("git", ["-C", dir, "init", "-q"]);
			const passing = await runFinalVerification(dir, ["git status"]);
			expect(passing.passed).toBe(true);
			expect(passing.results[0]).toMatchObject({ command: "git status", exit_code: 0, passed: true });
			const failing = await runFinalVerification(dir, ["git status", "git no-such-subcommand"]);
			// Asynchronous: a running suite never blocks the Host's event loop.
			let ticked = false;
			const pending = runFinalVerification(dir, ["sleep 1"]);
			setTimeout(() => { ticked = true; }, 10);
			expect((await pending).passed).toBe(true);
			expect(ticked).toBe(true);
			expect((await runFinalVerification(dir, ["sleep 5"], { timeoutMs: 200 })).results[0]).toMatchObject({ passed: false, signal: "timeout" });
			expect(failing.passed).toBe(false);
			expect(failing.results.map((r) => r.passed)).toEqual([true, false]);
			expect(failing.results[1]!.exit_code).not.toBe(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("active task notice", () => {
	function seeded(): { root: string; taskId: string } {
		const root = realpathSync(mkdtempSync(join(tmpdir(), "imm-notice-")));
		const taskId = "notice-task";
		const intent = parseTaskIntentV1({ contract: "assurance_kernel/task_intent/v1", task_id: taskId, owner: "user", goal: "g", risk: "material", revision: 1,
			scope_hint: ["src/work.ts"], acceptance: [{ id: "A1", assertion: "a", verification: JSON.stringify({ contract: "assurance_kernel/verification_descriptor/v2", command: { executable: "bun", argv: ["test"], cwd: ".", timeout_ms: 1000, max_output_bytes: 1024 }, environment: { prepare: null, writable_paths: [] } }) }] });
		mkdirSync(join(root, "docs/plans"), { recursive: true });
		writeFileSync(join(root, `docs/plans/${taskId}.intent.json`), JSON.stringify(intent));
		execFileSync("git", ["-C", root, "init", "-q"]);
		execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "base"]);
		const base = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
		const hash = canonicalIntentHash(intent);
		seedKernelRunForTest(root, { task_id: taskId, record: { contract: "assurance_kernel/task_record/v4", task_id: taskId, intent_snapshot: intent,
			intent_ref: { path: `docs/plans/${taskId}.intent.json`, content_hash: hash }, lifecycle: "active", artifact_state: "active",
			baseline: hash, git_base_head: base, attestations: [], findings: [], history: [] } });
		return { root, taskId };
	}

	it("names the active task, its obligation and scope, and says ordinary input does not resume it", async () => {
		const { root, taskId } = seeded();
		try {
			const notice = await activeTaskNotice(root);
			expect(notice).toContain(`Managed task ${taskId} is active`);
			expect(notice).toContain("which obligation it is waiting on");
			expect(notice).toContain("src/work.ts");
			expect(notice).toContain("Ordinary input does not resume it");
			expect(notice).toContain("Only an explicit imm-run entry continues it.");
			const hook = JSON.parse((await activeTaskHookOutput({ hook_event_name: "UserPromptSubmit", cwd: root }))!);
			expect(hook.hookSpecificOutput).toMatchObject({ hookEventName: "UserPromptSubmit" });
			expect(hook.hookSpecificOutput.additionalContext).toBe(notice);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("is silent in a workspace without an active task", async () => {
		const root = realpathSync(mkdtempSync(join(tmpdir(), "imm-notice-empty-")));
		try {
			execFileSync("git", ["-C", root, "init", "-q"]);
			expect(await activeTaskNotice(root)).toBeNull();
			expect(await activeTaskHookOutput({ hook_event_name: "UserPromptSubmit", cwd: root })).toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
