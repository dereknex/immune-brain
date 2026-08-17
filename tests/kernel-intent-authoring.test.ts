// P3 U2: host-neutral TaskIntent authoring through the canonical
// `imm-kernel intent author <path> --stdin --json` command. Covers bounded
// stdin, routing-policy/ownership gates, strict parsing, deterministic
// canonical bytes, exclusive no-overwrite creation, and destination-only
// byte deltas. Positive authoring tests install the exact active policy only
// inside isolated Git fixtures because the live P3 workspace still has v3
// ownership.

import { afterEach, describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runKernelCommand } from "../plugins/immune-brain/runtime/commands/kernel";
import { policyV1CanonicalBytes } from "../plugins/immune-brain/runtime/managed_task_routing_policy";

const roots: string[] = [];

function git(root: string, args: string[]): void {
	const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(result.stderr || `git ${args.join(" ")} failed`);
	}
}

function withRepo<T>(fn: (root: string) => T): T {
	const root = mkdtempSync(join(tmpdir(), "imm-intent-author-"));
	roots.push(root);
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	mkdirSync(join(root, ".imm", "memory"), { recursive: true });
	writeFileSync(join(root, ".gitignore"), ".imm/\n");
	git(root, ["init", "-q"]);
	git(root, ["config", "user.email", "fixture@example.com"]);
	git(root, ["config", "user.name", "Fixture"]);
	git(root, ["add", "."]);
	git(root, ["commit", "-qm", "fixture baseline"]);
	return fn(root);
}

function activateRetiredPolicy(root: string): void {
	writeFileSync(
		join(root, "docs", "plans", "managed-task-routing-policy.json"),
		policyV1CanonicalBytes(),
	);
	git(root, [
		"add",
		"docs/plans/managed-task-routing-policy.json",
	]);
}

function writeEmptyLedger(root: string): void {
	writeFileSync(
		join(root, ".imm", "memory", "current_iteration.json"),
		JSON.stringify(
			{
				schema_version: 3,
				plan_path: null,
				runtime_status: "idle",
				steps: {},
				history: [],
				closed_plan_history: [],
				plan_transition_history: [],
			},
			null,
			2,
		) + "\n",
	);
}

const GOOD_DESCRIPTOR = JSON.stringify({
	contract: "assurance_kernel/verification_descriptor/v1",
	runner_id: "bun",
	runner_version: "1.3.14",
	argv: ["test", "tests/fixture.test.ts"],
	cwd: ".",
	timeout_ms: 120000,
	max_output_bytes: 262144,
});

function candidate(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify(
		{
			contract: "assurance_kernel/task_intent/v1",
			task_id: "task-001-intent-author",
			owner: "user",
			goal: "Author a host-neutral TaskIntent draft.",
			acceptance: [
				{
					id: "A1",
					assertion: "draft exists",
					verification: GOOD_DESCRIPTOR,
				},
			],
			scope_hint: ["docs/plans/task-001-intent-author.intent.json"],
			risk: "routine",
			revision: 1,
			...overrides,
		},
		null,
		2,
	);
}

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const TS_RUNTIME = join(
	REPO_ROOT,
	"plugins",
	"immune-brain",
	"runtime",
	"v4_runtime.ts",
);

function author(
	root: string,
	path: string,
	stdin: string,
): { stdout: string; stderr: string; returncode: number } {
	// Feed the candidate through a real pipe so fd 0 is bounded and explicit.
	const result = spawnSync(
		"bun",
		[
			TS_RUNTIME,
			"cli",
			"imm-kernel",
			"intent",
			"author",
			path,
			"--stdin",
			"--json",
		],
		{ cwd: root, encoding: "utf8", input: stdin },
	);
	return { stdout: result.stdout, stderr: result.stderr, returncode: result.status ?? -1 };
}

afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

describe("imm-kernel intent author", () => {
	it("creates exactly one untracked draft with deterministic canonical bytes", () => {
		withRepo((root) => {
			writeEmptyLedger(root);
			activateRetiredPolicy(root);
			const path = "docs/plans/task-001-intent-author.intent.json";
			const result = author(root, path, candidate());
			expect(result.returncode).toBe(0);
			const output = JSON.parse(result.stdout);
			expect(output.contract).toBe("assurance_kernel/intent_author/v1");
			expect(output.path).toBe(path);
			expect(output.task_id).toBe("task-001-intent-author");
			expect(output.content_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
			expect(output.git_tracked).toBe(false);
			expect(output.enrollment_ready).toBe(false);
			const written = JSON.parse(
				readFileSync(join(root, path), "utf8"),
			);
			expect(written.acceptance[0].verification).toBe(
				JSON.stringify(JSON.parse(GOOD_DESCRIPTOR), null, 2) + "\n",
			);
			// No journal, no workflow state, no Git mutation.
			expect(existsSync(join(root, ".imm", "journal.jsonl"))).toBe(false);
			expect(existsSync(join(root, ".imm", "tasks"))).toBe(false);
			expect(
				readFileSync(
					join(root, ".imm", "memory", "current_iteration.json"),
					"utf8",
				),
			).toContain('"plan_path": null');
			const gitStatus = spawnSync(
				"git",
				["status", "--porcelain"],
				{ cwd: root, encoding: "utf8" },
			).stdout;
			expect(gitStatus).toContain("?? docs/plans/task-001-intent-author.intent.json");
			// The draft must never be staged.
			const staged = spawnSync(
				"git",
				["diff", "--cached", "--name-only"],
				{ cwd: root, encoding: "utf8" },
			).stdout;
			expect(staged).not.toContain(path);
		});
	});

	it("rejects authoring without an active kernel_task_intent policy", () => {
		withRepo((root) => {
			writeEmptyLedger(root);
			const result = author(
				root,
				"docs/plans/task-001-intent-author.intent.json",
				candidate(),
			);
			expect(result.returncode).toBe(1);
			expect(JSON.parse(result.stdout).error.code).toBe(
				"intent_authoring_not_routed",
			);
			expect(
				existsSync(
					join(root, "docs", "plans", "task-001-intent-author.intent.json"),
				),
			).toBe(false);
		});
	});

	it("rejects invalid routing policy with routing_policy_invalid", () => {
		withRepo((root) => {
			writeEmptyLedger(root);
			writeFileSync(
				join(root, "docs", "plans", "managed-task-routing-policy.json"),
				"{ not json\n",
			);
			git(root, ["add", "docs/plans/managed-task-routing-policy.json"]);
			const result = author(
				root,
				"docs/plans/task-001-intent-author.intent.json",
				candidate(),
			);
			expect(result.returncode).toBe(1);
			expect(JSON.parse(result.stdout).error.code).toBe(
				"routing_policy_invalid",
			);
		});
	});

	it("rejects a nonterminal v3 owner before opening the destination", () => {
		withRepo((root) => {
			activateRetiredPolicy(root);
			writeFileSync(
				join(root, ".imm", "memory", "current_iteration.json"),
				JSON.stringify(
					{
						schema_version: 3,
						plan_path: "docs/plans/other.md",
						runtime_status: "running",
						steps: {},
						history: [],
						closed_plan_history: [],
						plan_transition_history: [],
					},
					null,
					2,
				) + "\n",
			);
			const result = author(
				root,
				"docs/plans/task-001-intent-author.intent.json",
				candidate(),
			);
			expect(result.returncode).toBe(1);
			expect(JSON.parse(result.stdout).error.code).toBe(
				"v3_owner_nonterminal",
			);
		});
	});

	it("rejects strict parser violations", () => {
		withRepo((root) => {
			writeEmptyLedger(root);
			activateRetiredPolicy(root);
			const result = author(
				root,
				"docs/plans/task-001-intent-author.intent.json",
				candidate({ risk: "unknown" }),
			);
			expect(result.returncode).toBe(1);
			expect(JSON.parse(result.stdout).error.code).toBe("intent_invalid");
		});
	});

	it("rejects task/path mismatch", () => {
		withRepo((root) => {
			writeEmptyLedger(root);
			activateRetiredPolicy(root);
			const result = author(
				root,
				"docs/plans/wrong-name.intent.json",
				candidate(),
			);
			expect(result.returncode).toBe(1);
			expect(JSON.parse(result.stdout).error.code).toBe(
				"task_path_mismatch",
			);
		});
	});

	it("rejects non-canonical verification descriptors", () => {
		withRepo((root) => {
			writeEmptyLedger(root);
			activateRetiredPolicy(root);
			const bad = candidate({
				acceptance: [
					{
						id: "A1",
						assertion: "x",
						verification: "bun test",
					},
				],
			});
			const result = author(
				root,
				"docs/plans/task-001-intent-author.intent.json",
				bad,
			);
			expect(result.returncode).toBe(1);
			const error = JSON.parse(result.stdout).error;
			expect(error.code).toBe("intent_invalid");
			expect(
				existsSync(
					join(root, "docs", "plans", "task-001-intent-author.intent.json"),
				),
			).toBe(false);
		});
	});

	it("never overwrites an existing destination", () => {
		withRepo((root) => {
			writeEmptyLedger(root);
			activateRetiredPolicy(root);
			const path = "docs/plans/task-001-intent-author.intent.json";
			writeFileSync(join(root, path), "original bytes\n");
			git(root, ["add", path]);
			const before = readFileSync(join(root, path), "utf8");
			const result = author(root, path, candidate());
			expect(result.returncode).toBe(1);
			expect(JSON.parse(result.stdout).error.code).toBe(
				"destination_exists",
			);
			expect(readFileSync(join(root, path), "utf8")).toBe(before);
		});
	});

	it("rejects stdin oversize before JSON parsing or destination access", () => {
		withRepo((root) => {
			writeEmptyLedger(root);
			activateRetiredPolicy(root);
			const big = JSON.stringify(
				candidate({ goal: "x".repeat(80 * 1024) }),
			);
			const result = author(
				root,
				"docs/plans/task-001-intent-author.intent.json",
				big,
			);
			expect(result.returncode).toBe(1);
			expect(JSON.parse(result.stdout).error.code).toBe(
				"candidate_oversize",
			);
		});
	});

	it("does not read stdin for help or other subcommands", () => {
		withRepo((root) => {
			writeEmptyLedger(root);
			activateRetiredPolicy(root);
			// Non-author commands must be stdin-independent: an empty stdin
			// pipe must not hang or fail them. The v4 router rejects unknown
			// imm-kernel subcommands with invalid_kernel_command.
			const help = spawnSync(
				"bun",
				[TS_RUNTIME, "cli", "imm-kernel", "--help"],
				{ cwd: root, encoding: "utf8", input: "" },
			);
			expect(help.status).toBe(2);
			expect(help.stderr).toContain("invalid_kernel_command");
			const authorNoStdin = spawnSync(
				"bun",
				[
					TS_RUNTIME,
					"cli",
					"imm-kernel",
					"intent",
					"author",
					"docs/plans/task-001-intent-author.intent.json",
					"--json",
				],
				{ cwd: root, encoding: "utf8", input: "" },
			);
			expect(authorNoStdin.status).toBe(2);
			expect(JSON.parse(authorNoStdin.stdout).error.code).toBe(
				"stdin_required",
			);
		});
	});
});
