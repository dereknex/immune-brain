import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import enrollExtension from "../plugins/immune-brain/.pi-extension/imm-canary-enroll";
import { ClaudeRuntime } from "../plugins/immune-brain/runtime/claude/kernel_ports";
import { inspectEnrollmentGitBase, initializeEnrollmentGitBase } from "../plugins/immune-brain/runtime/assurance/enrollment_git_base";
import { preparePiCanary } from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import { readTaskRecordRaw } from "../plugins/immune-brain/runtime/kernel/storage";

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
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

for (const host of ["Pi", "Claude"] as const) describe(`${host} unborn enrollment`, () => {
	async function enroll(root: string, decision: "accept" | "decline" | "cancel", beforeConfirm?: () => void, signal?: AbortSignal, afterInitialize?: () => void) {
		const prompts: string[] = [];
		let result: unknown;
		try {
			if (host === "Claude") {
				const runtime = new ClaudeRuntime({ cwd: root, env: { CLAUDE_CODE_VERSION: "2.1.236", CLAUDE_CODE_PERMISSION_MODE: "manual" }, requestConfirmation: async (input) => {
					prompts.push(JSON.stringify(input)); beforeConfirm?.(); return { decision, requestId: "approval" };
				} });
				result = await runtime.enroll(taskId, { taskId, sessionId: "test", toolCallId: "enroll", signal });
			} else {
				let tool: any;
				enrollExtension({ registerTool: (value: unknown) => { tool = value; }, on: () => {}, events: { emit: () => {} } } as never);
				result = await tool.execute("enroll", { action: "new", task_id: taskId }, signal, (update: any) => {
					if (update.details.stage === "rehearsing") afterInitialize?.();
				}, {
					cwd: root, mode: "tui", hasUI: true, isIdle: () => true,
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
