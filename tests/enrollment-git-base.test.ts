import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import enrollExtension from "../plugins/immune-brain/.pi-extension/imm-canary-enroll";
import { recordPiPhaseInput } from "../plugins/immune-brain/.pi-extension/imm-canary-work";
import { ClaudeRuntime } from "../plugins/immune-brain/runtime/claude/kernel_ports";
import { inspectEnrollmentGitBase, initializeEnrollmentGitBase } from "../plugins/immune-brain/runtime/assurance/enrollment_git_base";
import { preparePiCanary } from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import { readTaskRecordRaw } from "../plugins/immune-brain/runtime/kernel/storage";

// The phase entry gate (ADR 0019) sits in front of this Tool. These tests
// exercise what lies behind it, so their session records a real run entry
// through the function the input handler calls;
// tests/pi-phase-entry-gate.test.ts owns the refusals.
const RUN_ENTRY_SESSION = { getSessionId: () => "enrollment-git-base-tests" };
recordPiPhaseInput({ text: "/skill:imm-run", source: "interactive" }, { sessionManager: RUN_ENTRY_SESSION });

const roots: string[] = [];
const taskId = "unborn-enrollment";
const intentPath = `docs/plans/${taskId}.intent.json`;
const git = (root: string, ...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "imm-unborn-"));
	roots.push(root);
	git(root, "init", "-q", "-b", "main");
	git(root, "config", "user.name", "Project Author");
	git(root, "config", "user.email", "author@example.test");
	mkdirSync(join(root, "docs/plans"), { recursive: true });
	writeFileSync(join(root, intentPath), JSON.stringify({
		contract: "assurance_kernel/task_intent/v1", task_id: taskId, owner: "user", goal: "enroll a new repository",
		risk: "routine", revision: 1, scope_hint: [intentPath],
		acceptance: [{ id: "A1", assertion: "fixture check", verification: "bun test tests/fixture.test.ts" }],
	}));
	writeFileSync(join(root, "unrelated.txt"), "staged\n");
	git(root, "add", "--", intentPath, "unrelated.txt");
	writeFileSync(join(root, "unrelated.txt"), "unstaged\n");
	return root;
}
const specPath = `docs/specs/${taskId}.spec.md`;
const PRECONDITION_SUBJECT = `chore(imm): commit Enrollment preconditions for ${taskId}`;
const TASK_PATHS = [intentPath, specPath, "src/new.ts", "src/task.ts"];
/**
 * The state a Planner leaves behind (BR-SCN-2): a Spec and TaskIntent that are
 * not committed, edits inside the scope, and staged, unstaged and untracked
 * dirt outside it. An unborn HEAD keeps the TaskIntent staged, which is what
 * the empty-base initialization requires; the in-scope edits there are
 * committed by the precondition commit, because the gate could not list them.
 */
function scopedFixture(base: "committed" | "unborn" = "committed", candidateId = taskId) {
	const intentPath = `docs/plans/${candidateId}.intent.json`;
	const specPath = `docs/specs/${candidateId}.spec.md`;
	const root = mkdtempSync(join(tmpdir(), "imm-precondition-"));
	roots.push(root);
	git(root, "init", "-q", "-b", "main");
	git(root, "config", "user.name", "Project Author");
	git(root, "config", "user.email", "author@example.test");
	// A machine-wide core.hooksPath would hide the hook one test installs.
	git(root, "config", "core.hooksPath", ".git/hooks");
	for (const dir of ["src", "other", "docs/plans", "docs/specs"]) mkdirSync(join(root, dir), { recursive: true });
	writeFileSync(join(root, "src/task.ts"), "export const value = 1;\n");
	writeFileSync(join(root, "other/loose.txt"), "loose 0\n");
	writeFileSync(join(root, "other/staged.txt"), "staged 0\n");
	if (base === "committed") { git(root, "add", "-A"); git(root, "commit", "-qm", "base"); }
	writeFileSync(join(root, intentPath), JSON.stringify({
		contract: "assurance_kernel/task_intent/v1", task_id: candidateId, owner: "user", goal: "enroll over uncommitted planning artifacts",
		risk: "routine", revision: 1, scope_hint: ["src", intentPath, specPath],
		acceptance: [{ id: "A1", assertion: "fixture check", verification: "bun test tests/fixture.test.ts" }],
	}));
	writeFileSync(join(root, specPath), "# Fixture Spec\n");
	writeFileSync(join(root, "src/task.ts"), "export const value = 2;\n");
	writeFileSync(join(root, "src/new.ts"), "export const added = true;\n");
	writeFileSync(join(root, "other/staged.txt"), "staged 1\n");
	git(root, "add", "--", "other/staged.txt");
	writeFileSync(join(root, "other/staged.txt"), "staged 2\n");
	writeFileSync(join(root, "other/loose.txt"), "loose 1\n");
	writeFileSync(join(root, "other/scratch.txt"), "scratch\n");
	if (base === "unborn") git(root, "add", "--", intentPath);
	return root;
}
/** Everything observable about the paths outside the task scope. */
const outsideScope = (root: string) => ({
	index: git(root, "ls-files", "--stage", "--", "other"),
	status: execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all", "--", "other"], { cwd: root, encoding: "utf8" }),
	files: ["loose.txt", "staged.txt", "scratch.txt"].map((name) => readFileSync(join(root, "other", name), "utf8")),
});
const committedPaths = (root: string, rev = "HEAD") => git(root, "show", "--name-only", "--format=", rev).split("\n").filter(Boolean).sort();
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

for (const host of ["Pi", "Claude"] as const) describe(`${host} unborn enrollment`, () => {
	async function enroll(root: string, decision: "accept" | "decline" | "cancel", beforeConfirm?: () => void, signal?: AbortSignal, afterInitialize?: () => void, candidateId = taskId) {
		const prompts: string[] = [];
		let result: unknown;
		try {
			if (host === "Claude") {
				const runtime = new ClaudeRuntime({ cwd: root, env: { CLAUDE_CODE_VERSION: "2.1.236", CLAUDE_CODE_PERMISSION_MODE: "manual" }, requestConfirmation: async (input) => {
					prompts.push(JSON.stringify(input)); beforeConfirm?.(); return { decision, requestId: "approval" };
				} });
				result = await runtime.enroll(candidateId, { taskId: candidateId, sessionId: "test", toolCallId: "enroll", signal });
			} else {
				let tool: any;
				enrollExtension({ registerTool: (value: unknown) => { tool = value; }, on: () => {}, events: { emit: () => {} } } as never);
				result = await tool.execute("enroll", { action: "new", task_id: candidateId }, signal, (update: any) => {
					if (update.details.stage === "rehearsing") afterInitialize?.();
				}, {
					cwd: root, mode: "tui", hasUI: true, isIdle: () => true, sessionManager: RUN_ENTRY_SESSION,
					ui: { setWidget: () => {}, custom: async (factory: any) => {
						let selection: unknown;
						const component = factory({ requestRender: () => {} }, { fg: (_: string, text: string) => text, bold: (text: string) => text }, {}, (value: unknown) => { selection = value; });
						component.handleInput("d"); prompts.push(component.render(160).join("\n")); beforeConfirm?.();
						if (decision !== "accept") component.handleInput("\u001b[B");
						component.handleInput("\r"); return selection;
					} },
				});
			}
			return { result, prompts, error: "" };
		} catch (error) { return { result, prompts, error: String(error) }; }
	}
	test("one confirmation bootstraps an empty root commit and preserves index/worktree/config", async () => {
		const root = fixture();
		const index = readFileSync(join(root, ".git/index"));
		const config = readFileSync(join(root, ".git/config"));
		const result = await enroll(root, "accept");
		expect(result.error).toBe("");
		expect(result.prompts).toHaveLength(1);
		expect(result.prompts[0]).toMatch(/empty initial commit/i);
		const head = git(root, "rev-parse", "HEAD");
		expect(git(root, "ls-tree", "-r", head)).toBe("");
		expect(git(root, "rev-list", "--count", "HEAD")).toBe("1");
		expect(git(root, "show", "-s", "--format=%an <%ae>", "HEAD")).toBe("Project Author <author@example.test>");
		expect(readFileSync(join(root, ".git/index"))).toEqual(index);
		expect(readFileSync(join(root, ".git/config"))).toEqual(config);
		expect(readFileSync(join(root, "unrelated.txt"), "utf8")).toBe("unstaged\n");
		expect(readTaskRecordRaw(root, taskId).record?.git_base_head).toBe(head);
	});
	test("an existing committed HEAD is reused without an initialization notice", async () => {
		const root = fixture(); git(root, "commit", "-qm", "existing base");
		const head = git(root, "rev-parse", "HEAD");
		const result = await enroll(root, "accept");
		expect(result.error).toBe("");
		expect(result.prompts).toHaveLength(1);
		expect(result.prompts[0]).not.toMatch(/empty initial commit/i);
		expect(git(root, "rev-parse", "HEAD")).toBe(head);
		expect(readTaskRecordRaw(root, taskId).record?.git_base_head).toBe(head);
	});
	for (const decision of ["decline", "cancel"] as const) test(`${decision} leaves HEAD unborn`, async () => {
		const root = fixture();
		await enroll(root, decision);
		expect(spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: root }).status).not.toBe(0);
		expect(readTaskRecordRaw(root, taskId).record).toBeNull();
	});
	test("host cancellation after accept leaves HEAD unborn", async () => {
		const root = fixture(); const controller = new AbortController();
		await enroll(root, "accept", () => controller.abort(), controller.signal);
		expect(spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: root }).status).not.toBe(0);
		expect(readTaskRecordRaw(root, taskId).record).toBeNull();
	});
	if (host === "Pi") for (const outcome of ["cancel", "rehearsal failure"] as const) test(`reports the remaining empty commit on post-initialization ${outcome}`, async () => {
		const root = fixture(); const controller = new AbortController();
		const result = await enroll(root, "accept", undefined, controller.signal, () => {
			if (outcome === "cancel") controller.abort();
			else writeFileSync(join(root, intentPath), "invalid intent");
		});
		const terminal = result.result as { details: { state: string; summary: string } } | undefined;
		if (outcome === "cancel") expect(terminal?.details.state).toBe("cancelled");
		const message = result.error || terminal?.details.summary;
		expect(message).toContain("empty initial commit");
		expect(message).toContain("remains");
		expect(git(root, "ls-tree", "-r", "HEAD")).toBe("");
		expect(readTaskRecordRaw(root, taskId).record).toBeNull();
	});
	for (const drift of ["branch", "head", "intent"] as const) test(`rejects ${drift} drift during confirmation`, async () => {
		const root = fixture();
		const result = await enroll(root, "accept", () => {
			if (drift === "branch") git(root, "symbolic-ref", "HEAD", "refs/heads/other");
			if (drift === "head") git(root, "commit", "--allow-empty", "-qm", "external");
			if (drift === "intent") { const path = join(root, intentPath); const intent = JSON.parse(readFileSync(path, "utf8")); intent.goal = "changed"; writeFileSync(path, JSON.stringify(intent)); git(root, "add", "--", intentPath); }
		});
		expect(result.error).not.toBe("");
		expect(readTaskRecordRaw(root, taskId).record).toBeNull();
		if (drift !== "head") expect(spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: root }).status).not.toBe(0);
	});
	test("uncommitted Spec and TaskIntent are committed once, in-scope edits are claimed, and the confirmation binds that HEAD (BR-SCN-2)", async () => {
		const root = scopedFixture();
		const base = git(root, "rev-parse", "HEAD");
		const outside = outsideScope(root);
		let headAtConfirmation = "";
		const result = await enroll(root, "accept", () => { headAtConfirmation = git(root, "rev-parse", "HEAD"); });
		expect(result.error).toBe("");
		const head = git(root, "rev-parse", "HEAD");
		expect(git(root, "rev-parse", "HEAD~1")).toBe(base);
		expect(git(root, "log", "-1", "--format=%s")).toBe(PRECONDITION_SUBJECT);
		expect(committedPaths(root)).toEqual([intentPath, specPath]);
		// One native confirmation, shown after the commit and silent about it.
		expect(result.prompts).toHaveLength(1);
		expect(result.prompts[0]).not.toMatch(/precondition|commit Enrollment/i);
		// The gate lists the in-scope edits and confirmation claims them as task work.
		expect(result.prompts[0]).toContain("src/new.ts");
		const baseline = JSON.parse(readFileSync(join(root, ".imm/state/enrollment-baseline.json"), "utf8"));
		expect(Object.keys(baseline.dirty_files)).not.toContain("src/new.ts");
		expect(Object.keys(baseline.dirty_files)).not.toContain("src/task.ts");
		expect(headAtConfirmation).toBe(head);
		expect(readTaskRecordRaw(root, taskId).record?.git_base_head).toBe(head);
		// Dirt outside the scope neither blocks nor moves.
		expect(outsideScope(root)).toEqual(outside);
	});
	test("legal mixed-case task IDs commit exactly the candidate paths and enroll", async () => {
		const candidateId = "Demo_Task.1";
		const root = scopedFixture("committed", candidateId);
		const base = git(root, "rev-parse", "HEAD");
		const outside = outsideScope(root);
		let confirmedHead = "";
		const result = await enroll(root, "accept", () => { confirmedHead = git(root, "rev-parse", "HEAD"); }, undefined, undefined, candidateId);
		expect(result.error).toBe("");
		expect(result.prompts).toHaveLength(1);
		expect(git(root, "rev-parse", "HEAD~1")).toBe(base);
		expect(git(root, "log", "-1", "--format=%s")).toBe(`chore(imm): commit Enrollment preconditions for ${candidateId}`);
		expect(committedPaths(root)).toEqual([`docs/plans/${candidateId}.intent.json`, `docs/specs/${candidateId}.spec.md`]);
		expect(readTaskRecordRaw(root, candidateId).record?.git_base_head).toBe(confirmedHead);
		expect(outsideScope(root)).toEqual(outside);
	});
	for (const invalid of ["file symlink", "parent symlink", "oversized", "directory", "wrong identity"] as const)
		test(`invalid TaskIntent (${invalid}) is refused before Git effects on ${host}`, async () => {
			const root = scopedFixture();
			const path = join(root, intentPath);
			const original = readFileSync(path);
			if (invalid === "file symlink" || invalid === "parent symlink") {
				const external = mkdtempSync(join(tmpdir(), "imm-external-intent-"));
				roots.push(external);
				writeFileSync(join(external, `${taskId}.intent.json`), original);
				if (invalid === "file symlink") {
					rmSync(path); symlinkSync(join(external, `${taskId}.intent.json`), path);
				} else {
					rmSync(join(root, "docs/plans"), { recursive: true }); symlinkSync(external, join(root, "docs/plans"));
				}
			} else if (invalid === "oversized") writeFileSync(path, original.toString() + " ".repeat(65536));
			else if (invalid === "directory") { rmSync(path); mkdirSync(path); }
			else writeFileSync(path, JSON.stringify({ ...JSON.parse(original.toString()), task_id: "different-task" }));
			const head = git(root, "rev-parse", "HEAD");
			const status = git(root, "status", "--porcelain=v1", "--untracked-files=all", "--", "src", "docs", "other");
			const index = readFileSync(join(root, ".git/index"));
			const result = await enroll(root, "accept");
			const terminal = result.result as { details: { summary: string } } | undefined;
			expect(result.error || terminal?.details.summary).toMatch(/symlink|64 KiB|regular file|does not match|Git-tracked TaskIntent|not Git-tracked/);
			expect(result.prompts).toHaveLength(0);
			expect(git(root, "rev-parse", "HEAD")).toBe(head);
			expect(readFileSync(join(root, ".git/index"))).toEqual(index);
			expect(git(root, "status", "--porcelain=v1", "--untracked-files=all", "--", "src", "docs", "other")).toBe(status);
			expect(readTaskRecordRaw(root, taskId).record).toBeNull();
		});
	for (const binding of ["ambiguous", "archive only"] as const) test(`invalid ${binding} Spec binding causes no Git effects`, async () => {
		const root = scopedFixture();
		const intent = JSON.parse(readFileSync(join(root, intentPath), "utf8"));
		intent.scope_hint = ["src", intentPath, ...(binding === "ambiguous"
			? [specPath, "docs/specs/second.spec.md"] : [`docs/specs/archive/${taskId}.spec.md`])];
		writeFileSync(join(root, intentPath), JSON.stringify(intent));
		// Tracking isolates the Spec binding rejection from the sidecar tracking check.
		git(root, "add", "--", intentPath);
		const head = git(root, "rev-parse", "HEAD");
		const status = git(root, "status", "--porcelain=v1", "--untracked-files=all", "--", "src", "docs", "other");
		const index = readFileSync(join(root, ".git/index"));
		const result = await enroll(root, "accept");
		const terminal = result.result as { details: { summary: string } } | undefined;
		expect(result.error || terminal?.details.summary).toMatch(/at most one scope-bound Spec|binding is incomplete/);
		expect(git(root, "rev-parse", "HEAD")).toBe(head);
		expect(readFileSync(join(root, ".git/index"))).toEqual(index);
		expect(git(root, "status", "--porcelain=v1", "--untracked-files=all", "--", "src", "docs", "other")).toBe(status);
		expect(readTaskRecordRaw(root, taskId).record).toBeNull();
	});
	test("a concurrent session cannot enter the Enrollment transaction during the Git commit", async () => {
		const root = scopedFixture();
		const probe = join(root, ".git/concurrent-enrollment.ts");
		const marker = join(root, ".git/concurrent-result");
		writeFileSync(probe, `import { withKernelTransaction } from ${JSON.stringify(resolve("plugins/immune-brain/runtime/kernel/sqlite_store.ts"))};\nimport { writeFileSync } from "node:fs";\ntry {\n  withKernelTransaction(${JSON.stringify(root)}, () => writeFileSync(${JSON.stringify(marker)}, "entered"), { busyTimeoutMs: 1 });\n} catch (error) {\n  if (!String(error).includes("another writer holds the store lock")) throw error;\n  writeFileSync(${JSON.stringify(marker)}, "blocked");\n}\n`);
		const quote = (path: string) => `'${path.replaceAll("'", "'\\''")}'`;
		const hook = join(root, ".git/hooks/pre-commit");
		writeFileSync(hook, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(probe)}\n`);
		chmodSync(hook, 0o755);
		const result = await enroll(root, "accept");
		expect(result.error).toBe("");
		expect(readTaskRecordRaw(root, taskId).record?.lifecycle).toBe("active");
		expect(readFileSync(marker, "utf8")).toBe("blocked");
		// The same second-session transaction works after the first session releases the lock.
		execFileSync(process.execPath, [probe], { cwd: root, stdio: "pipe" });
		expect(readFileSync(marker, "utf8")).toBe("entered");
	});
	for (const drift of ["intent", "head"] as const) test(`confirmation-time ${drift} drift reports the precondition commit that remains`, async () => {
		const root = scopedFixture();
		let preconditionHead = "";
		const result = await enroll(root, "accept", () => {
			preconditionHead = git(root, "rev-parse", "HEAD");
			if (drift === "head") git(root, "commit", "--allow-empty", "-qm", "concurrent commit");
			else {
				const intent = JSON.parse(readFileSync(join(root, intentPath), "utf8"));
				writeFileSync(join(root, intentPath), JSON.stringify({ ...intent, goal: "changed during confirmation" }));
			}
		});
		const terminal = result.result as { details: { summary: string } } | undefined;
		const message = result.error || terminal?.details.summary;
		expect(message).toMatch(/changed|aborted/i);
		expect(message).toContain(`Enrollment precondition commit ${preconditionHead} remains`);
		expect(committedPaths(root, preconditionHead)).toEqual([intentPath, specPath]);
		expect(readTaskRecordRaw(root, taskId).record).toBeNull();
	});
	test("Enrollment preserves a staged TaskIntent restored to HEAD in the worktree", async () => {
		const root = scopedFixture();
		git(root, "add", "--", ...TASK_PATHS);
		git(root, "commit", "-qm", "planning artifacts");
		const bytes = readFileSync(join(root, intentPath), "utf8");
		writeFileSync(join(root, intentPath), JSON.stringify({ ...JSON.parse(bytes), goal: "staged user goal" }));
		git(root, "add", "--", intentPath);
		writeFileSync(join(root, intentPath), bytes);
		writeFileSync(join(root, "src/task.ts"), "new executor candidate\n");
		const head = git(root, "rev-parse", "HEAD");
		const entry = git(root, "ls-files", "--stage", "--", intentPath);
		const result = await enroll(root, "accept");
		expect(result.error).toBe("");
		expect(readTaskRecordRaw(root, taskId).record?.lifecycle).toBe("active");
		// A staged TaskIntent over tracked artifacts fails no precondition: no
		// commit is made and the in-scope edit is claimed through the gate.
		expect(git(root, "rev-parse", "HEAD")).toBe(head);
		const baseline = JSON.parse(readFileSync(join(root, ".imm/state/enrollment-baseline.json"), "utf8"));
		expect(Object.keys(baseline.dirty_files)).not.toContain("src/task.ts");
		expect(git(root, "ls-files", "--stage", "--", intentPath)).toBe(entry);
		expect(readFileSync(join(root, intentPath), "utf8")).toBe(bytes);
	});

	test("a TaskIntent that is only staged over a clean scope makes no commit", async () => {
		const root = scopedFixture();
		git(root, "add", "--", ...TASK_PATHS); git(root, "commit", "-qm", "planning artifacts");
		const intent = JSON.parse(readFileSync(join(root, intentPath), "utf8"));
		writeFileSync(join(root, intentPath), JSON.stringify({ ...intent, goal: "restaged goal" }));
		git(root, "add", "--", intentPath);
		const head = git(root, "rev-parse", "HEAD");
		const result = await enroll(root, "accept");
		expect(result.error).toBe("");
		expect(git(root, "rev-parse", "HEAD")).toBe(head);
		expect(git(root, "diff", "--cached", "--name-only", "--", intentPath)).toBe(intentPath);
	});
	test("an unborn HEAD receives its empty root commit first and the precondition commit second", async () => {
		const root = scopedFixture("unborn");
		const result = await enroll(root, "accept");
		expect(result.error).toBe("");
		expect(result.prompts).toHaveLength(1);
		expect(result.prompts[0]).toMatch(/empty initial commit/i);
		expect(git(root, "rev-list", "--count", "HEAD")).toBe("2");
		expect(git(root, "ls-tree", "-r", "HEAD~1")).toBe("");
		expect(git(root, "log", "-1", "--format=%s")).toBe(PRECONDITION_SUBJECT);
		expect(committedPaths(root)).toEqual(TASK_PATHS);
		expect(readTaskRecordRaw(root, taskId).record?.git_base_head).toBe(git(root, "rev-parse", "HEAD"));
		expect(git(root, "diff", "--cached", "--name-only")).toBe("other/staged.txt");
		expect(readFileSync(join(root, "other/staged.txt"), "utf8")).toBe("staged 2\n");
	});
	for (const decision of ["decline", "cancel"] as const) test(`${decision} after the precondition commit names the commit that remains and a retry adds none`, async () => {
		const root = scopedFixture();
		const result = await enroll(root, decision);
		const head = git(root, "rev-parse", "HEAD");
		expect(git(root, "log", "-1", "--format=%s")).toBe(PRECONDITION_SUBJECT);
		const terminal = result.result as { details: { summary: string } } | undefined;
		expect(result.error || terminal?.details.summary).toContain(`Enrollment precondition commit ${head} remains`);
		expect(readTaskRecordRaw(root, taskId).record).toBeNull();
		const retry = await enroll(root, "accept");
		expect(retry.error).toBe("");
		expect(git(root, "rev-parse", "HEAD")).toBe(head);
	});
	test("enroll against a workspace an active task owns commits nothing and leaves its undelivered work alone", async () => {
		const root = scopedFixture();
		expect((await enroll(root, "accept")).error).toBe("");
		// The owner's Executor work: tracked, staged and untracked edits in scope.
		writeFileSync(join(root, "src/task.ts"), "export const value = 3;\n");
		writeFileSync(join(root, "src/new.ts"), "export const added = false;\n");
		git(root, "add", "--", "src/new.ts");
		writeFileSync(join(root, "src/draft.ts"), "export const draft = true;\n");
		const head = git(root, "rev-parse", "HEAD");
		const index = git(root, "ls-files", "--stage");
		const status = git(root, "status", "--porcelain=v1", "--untracked-files=all");
		const record = JSON.stringify(readTaskRecordRaw(root, taskId).record);
		const result = await enroll(root, "accept");
		const terminal = result.result as { details: { state: string; summary: string } } | undefined;
		expect(result.error || terminal?.details.state).not.toBe("");
		expect(`${result.error}${terminal?.details.summary ?? ""}`).not.toContain("precondition commit");
		expect(git(root, "rev-parse", "HEAD")).toBe(head);
		expect(git(root, "ls-files", "--stage")).toBe(index);
		expect(git(root, "status", "--porcelain=v1", "--untracked-files=all")).toBe(status);
		expect(JSON.stringify(readTaskRecordRaw(root, taskId).record)).toBe(record);
	});
	test("a TaskIntent changed while the unborn-HEAD precondition commit runs is refused and never enrolled", async () => {
		const root = scopedFixture("unborn");
		// The empty root commit runs no hook; the precondition commit does.
		const hook = join(root, ".git/hooks/pre-commit");
		writeFileSync(hook, `#!/bin/sh\nsed 's/enroll over/changed during/' ${intentPath} > ${intentPath}.tmp && mv ${intentPath}.tmp ${intentPath}\n`); chmodSync(hook, 0o755);
		const result = await enroll(root, "accept");
		const terminal = result.result as { details: { summary: string } } | undefined;
		const message = result.error || terminal?.details.summary;
		expect(message).toContain("Workspace changed during the Enrollment precondition commit");
		expect(message).toContain(`Enrollment precondition commit ${git(root, "rev-parse", "HEAD")} remains`);
		expect(message).toContain("empty initial commit");
		expect(JSON.parse(readFileSync(join(root, intentPath), "utf8")).goal).toContain("changed during");
		expect(readTaskRecordRaw(root, taskId).record).toBeNull();
	});
	test("a commit refused by a Git hook fails Enrollment with Git's message before any confirmation", async () => {
		const root = scopedFixture();
		const hook = join(root, ".git/hooks/pre-commit");
		writeFileSync(hook, "#!/bin/sh\necho 'policy says no' >&2\nexit 1\n"); chmodSync(hook, 0o755);
		const head = git(root, "rev-parse", "HEAD");
		const outside = outsideScope(root);
		const result = await enroll(root, "accept");
		const terminal = result.result as { details: { summary: string } } | undefined;
		expect(result.error || terminal?.details.summary).toContain("policy says no");
		expect(result.prompts).toHaveLength(0);
		expect(git(root, "rev-parse", "HEAD")).toBe(head);
		expect(git(root, "ls-files", "--", "src/new.ts", intentPath, specPath)).toBe("");
		expect(outsideScope(root)).toEqual(outside);
		expect(readTaskRecordRaw(root, taskId).record).toBeNull();
	});
	test("corrupt branch ref is rejected before confirmation", async () => {
		const root = fixture(); writeFileSync(join(root, ".git/refs/heads/main"), `${"a".repeat(40)}\n`);
		const result = await enroll(root, "accept");
		expect(result.error).not.toBe("");
		expect(result.prompts).toHaveLength(0);
		expect(readFileSync(join(root, ".git/refs/heads/main"), "utf8")).toBe(`${"a".repeat(40)}\n`);
	});
});

describe("shared Enrollment Git initialization", () => {
	const input = () => ({ task_id: taskId, now: new Date().toISOString() });
	test("missing identity uses explicit automation identity without config writes", () => {
		const root = fixture(); git(root, "config", "--unset", "user.name"); git(root, "config", "--unset", "user.email");
		const keys = ["GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"];
		const previous = keys.map(key => process.env[key]);
		try {
			for (const key of keys) delete process.env[key];
			process.env.GIT_CONFIG_GLOBAL = "/dev/null"; process.env.GIT_CONFIG_NOSYSTEM = "1";
			const config = readFileSync(join(root, ".git/config")); const request = input();
			initializeEnrollmentGitBase(root, request, preparePiCanary(root, request), inspectEnrollmentGitBase(root));
			expect(git(root, "show", "-s", "--format=%an <%ae>", "HEAD")).toBe("Immune-Brain Enrollment <enrollment@immune-brain.local>");
			expect(readFileSync(join(root, ".git/config"))).toEqual(config);
		} finally { keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; }); }
	});
	for (const race of ["symbolic HEAD", "existing branch"] as const) test(`CAS detects concurrent ${race} changes without writing the new target`, () => {
		const root = fixture(); const request = input();
		const before = preparePiCanary(root, request); const base = inspectEnrollmentGitBase(root);
		const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
		const tree = execFileSync("git", ["hash-object", "-t", "tree", "-w", "--stdin"], { cwd: root, input: "", encoding: "utf8" }).trim();
		const otherCommit = git(root, "commit-tree", tree, "-m", "concurrent");
		const bin = join(root, "bin"); mkdirSync(bin);
		const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
		writeFileSync(join(bin, "git"), `#!/bin/sh\nif [ "$1" = "update-ref" ]; then\n${quote(realGit)} ${race === "symbolic HEAD" ? "symbolic-ref HEAD refs/heads/other" : `update-ref refs/heads/main ${otherCommit}`}\nfi\nexec ${quote(realGit)} "$@"\n`, { mode: 0o755 });
		const path = process.env.PATH;
		try {
			process.env.PATH = `${bin}:${path}`;
			expect(() => initializeEnrollmentGitBase(root, request, before, base)).toThrow(race === "symbolic HEAD" ? /empty initial commit .* remains/ : /cannot lock ref/);
		} finally { process.env.PATH = path; }
		if (race === "symbolic HEAD") {
			expect(git(root, "symbolic-ref", "HEAD")).toBe("refs/heads/other");
			expect(spawnSync("git", ["show-ref", "--verify", "--quiet", "refs/heads/other"], { cwd: root }).status).toBe(1);
			expect(git(root, "ls-tree", "-r", "refs/heads/main")).toBe("");
		} else expect(git(root, "rev-parse", "HEAD")).toBe(otherCommit);
		expect(readTaskRecordRaw(root, taskId).record).toBeNull();
	});
	test("missing repository and invalid detached HEAD are not initialization candidates", () => {
		const root = mkdtempSync(join(tmpdir(), "imm-not-git-")); roots.push(root);
		expect(() => inspectEnrollmentGitBase(root)).toThrow();
		git(root, "init", "-q"); writeFileSync(join(root, ".git/HEAD"), `${"a".repeat(40)}\n`);
		expect(() => inspectEnrollmentGitBase(root)).toThrow();
	});
});
