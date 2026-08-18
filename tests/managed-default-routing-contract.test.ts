import { describe, expect, it } from "bun:test";
import {
	mkdtempSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
	classifyManagedRequest,
	inspectManagedBootstrap,
	routeManagedRequest,
} from "../plugins/immune-brain/runtime/managed_path_router";
import { runCli } from "../plugins/immune-brain/runtime/v4_runtime";

function tempRoot(): string {
	return mkdtempSync(join("/tmp", "immune-brain-route-"));
}

function remove(root: string): void {
	rmSync(root, { recursive: true, force: true });
}

describe("managed default request routing", () => {
	it("routes clear mutations to Planner without requiring a phrase", () => {
		expect(classifyManagedRequest("Implement the login form and add tests")).toMatchObject({
			phase: "planner",
			intent: "implementation",
			enrollment: "deferred",
		});
	});

	it("routes materially ambiguous mutations to Brainstorm", () => {
		expect(
			classifyManagedRequest(
				"I need to change the authentication flow, but I am not sure which behavior is correct",
			),
		).toMatchObject({
			phase: "brainstorm",
			intent: "ambiguous_mutation",
			enrollment: "none",
		});
	});

	it("keeps read-only, review-only, plan-only, and explicit no-modification requests out of Enrollment", () => {
		for (const request of [
			"Explain how the authentication flow works",
			"Review this change and do not modify any files",
			"Create a plan for improving the authentication flow",
			"Do not change anything; just tell me what is wrong",
		]) {
			const route = classifyManagedRequest(request);
			expect(route.enrollment).toBe("none");
			expect(route.phase).not.toBe("loop");
		}
		expect(classifyManagedRequest("Create a plan for improving the authentication flow")).toMatchObject({
			phase: "planner",
			intent: "planning",
		});
		expect(
			classifyManagedRequest("Explain how to update the authentication flow"),
		).toMatchObject({ phase: "none", enrollment: "none" });
		expect(
			classifyManagedRequest("Review the flow and update its error handling"),
		).toMatchObject({ phase: "planner", intent: "implementation" });
	});

	it("initializes absent state once and leaves complete state byte-stable", () => {
		const root = tempRoot();
		try {
			const first = routeManagedRequest({
				root,
				request: "Implement the login form",
			});
			expect(first.phase).toBe("planner");
			expect(first.bootstrap).toBe("initialized");
			expect(inspectManagedBootstrap(root).status).toBe("complete");
			expect(readFileSync(join(root, "IMMUNE.md"), "utf8")).toContain("Managed Path");

			const paths = [
				"AGENTS.md",
				"IMMUNE.md",
				"CONTEXT.md",
				".imm/memory/MEMORY.md",
				"docs/specs",
				"docs/brainstorms",
				"docs/plans",
				".imm/memory",
			];
			const before = paths.map((path) => [path, readOrList(root, path)] as const);
			const second = routeManagedRequest({
				root,
				request: "Implement the login form",
			});
			expect(second.bootstrap).toBe("complete");
			expect(paths.map((path) => [path, readOrList(root, path)] as const)).toEqual(before);
		} finally {
			remove(root);
		}
	});

	it("fails closed on partial or schema-incompatible state without overwriting it", () => {
		const partial = tempRoot();
		try {
			mkdirSync(join(partial, ".imm", "memory"), { recursive: true });
			expect(() =>
				routeManagedRequest({ root: partial, request: "Implement the login form" }),
			).toThrow(/partial/i);
			expect(readdirSync(partial)).toEqual([".imm"]);
		} finally {
			remove(partial);
		}

		const incompatible = tempRoot();
		try {
			for (const directory of [
				".imm/memory",
				"docs/specs",
				"docs/brainstorms",
				"docs/plans",
			]) mkdirSync(join(incompatible, directory), { recursive: true });
			for (const file of [
				"AGENTS.md",
				"IMMUNE.md",
				"CONTEXT.md",
				".imm/memory/MEMORY.md",
			]) writeFileSync(join(incompatible, file), "incompatible\n");
			expect(() =>
				routeManagedRequest({ root: incompatible, request: "Implement the login form" }),
			).toThrow(/schema|incompatible/i);
			expect(readFileSync(join(incompatible, "IMMUNE.md"), "utf8")).toBe("incompatible\n");
		} finally {
			remove(incompatible);
		}
	});

	it("resumes an enrolled task through Loop using the supplied Assurance projection", () => {
		const root = tempRoot();
		try {
			const route = routeManagedRequest({
				root,
				request: "Continue the enrolled task",
				assurance: {
					task_id: "task-1",
					phase: "review",
					next_action: "request_authorization",
				},
				task_id: "task-1",
			});
			expect(route).toMatchObject({
				phase: "loop",
				enrollment: "existing_authority",
				bootstrap: "initialized",
			});
			expect(route.assurance).toEqual({
				task_id: "task-1",
				phase: "review",
				next_action: "request_authorization",
			});
		} finally {
			remove(root);
		}
	});

	it("keeps Fast-Track inside Managed authority and never enrolls Planner output", () => {
		const root = tempRoot();
		try {
			const route = routeManagedRequest({
				root,
				request: "Implement the login form",
				fast_track: true,
			});
			expect(route).toMatchObject({
				phase: "planner",
				mode: "fast-track",
				enrollment: "deferred",
				authority: "preserved",
			});
			expect(readdirSync(join(root, ".imm"))).not.toContain("tasks");
		} finally {
			remove(root);
		}
	});

	it("fails closed when a bootstrap parent is a symlink", () => {
		const root = tempRoot();
		const target = tempRoot();
		try {
			symlinkSync(join(target, ".imm"), join(root, ".imm"), "dir");
			expect(() =>
				routeManagedRequest({ root, request: "Implement the login form" }),
			).toThrow(/symbolic link/i);
		} finally {
			remove(root);
			remove(target);
		}
	});
	it("rejects a mismatched task identity instead of switching authority", () => {
		expect(() =>
			routeManagedRequest({
				root: tempRoot(),
				request: "Continue the enrolled task",
				task_id: "task-2",
				assurance: { task_id: "task-1", phase: "working" },
			}),
		).toThrow(/task identity/i);
	});

	it("exposes the same contract through the canonical imm-route CLI", async () => {
		const root = tempRoot();
		try {
			const result = await runCli(
				"imm-route",
				["--json", "Implement", "the", "login", "form"],
				root,
			);
			expect(result.returncode).toBe(0);
			expect(JSON.parse(result.stdout)).toMatchObject({
				phase: "planner",
				intent: "implementation",
				enrollment: "deferred",
				bootstrap: "initialized",
			});
		} finally {
			remove(root);
		}
	});
});

function readOrList(root: string, relativePath: string): string {
	const path = join(root, relativePath);
	try {
		return readFileSync(path, "utf8");
	} catch {
		return readdirSync(path).join("\n");
	}
}
