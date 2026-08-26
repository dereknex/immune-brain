// P3 U2: read-only TaskIntent validation through the canonical
// `imm-kernel intent validate <path> --json` command. Zero writes: no
// friction journal, migration, lock, receipt, observation, TaskRecord,
// backend claim, State Ledger, Git index, or session-state write.

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

const roots: string[] = [];

function git(root: string, args: string[]): void {
	const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(result.stderr || `git ${args.join(" ")} failed`);
	}
}

function withRepo<T>(fn: (root: string) => T): T {
	const root = mkdtempSync(join(tmpdir(), "imm-intent-validate-"));
	roots.push(root);
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	writeFileSync(join(root, ".gitignore"), ".imm/\n");
	git(root, ["init", "-q"]);
	git(root, ["config", "user.email", "fixture@example.com"]);
	git(root, ["config", "user.name", "Fixture"]);
	git(root, ["add", "."]);
	git(root, ["commit", "-qm", "fixture baseline"]);
	return fn(root);
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

function intentBytes(
	taskId = "task-002-intent-validate",
	overrides: Record<string, unknown> = {},
): string {
	return JSON.stringify(
		{
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskId,
			owner: "user",
			goal: "Validate a host-neutral TaskIntent draft.",
			acceptance: [
				{
					id: "A1",
					assertion: "draft is valid",
					verification: GOOD_DESCRIPTOR,
				},
			],
			scope_hint: [`docs/plans/${taskId}.intent.json`],
			risk: "material",
			revision: 1,
			...overrides,
		},
		null,
		2,
	) + "\n";
}

function validate(
	root: string,
	path: string,
): { stdout: string; stderr: string; returncode: number } {
	const result = runKernelCommand(["intent", "validate", path, "--json"], root);
	return result;
}

afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

describe("imm-kernel intent validate", () => {
	it("returns a bounded projection for a valid untracked draft", () => {
		withRepo((root) => {
			const path = "docs/plans/task-002-intent-validate.intent.json";
			writeFileSync(join(root, path), intentBytes());
			const result = validate(root, path);
			expect(result.returncode).toBe(0);
			const output = JSON.parse(result.stdout);
			expect(output.contract).toBe("assurance_kernel/intent_validation/v1");
			expect(output.valid).toBe(true);
			expect(output.path).toBe(path);
			expect(output.task_id).toBe("task-002-intent-validate");
			expect(output.content_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
			expect(output.risk).toBe("material");
			expect(output.acceptance_ids).toEqual(["A1"]);
			expect(output.verification).toEqual([
				{ id: "A1", eligible: true, reason: null },
			]);
			expect(output.git_ownership).toBe("untracked");
			expect(output.enrollment_ready).toBe(false);
		});
	});

	it("reports enrollment_ready for a tracked fully eligible intent", () => {
		withRepo((root) => {
			const path = "docs/plans/task-002-intent-validate.intent.json";
			writeFileSync(join(root, path), intentBytes());
			git(root, ["add", path]);
			const result = validate(root, path);
			const output = JSON.parse(result.stdout);
			expect(output.valid).toBe(true);
			expect(output.git_ownership).toBe("tracked");
			expect(output.enrollment_ready).toBe(true);
			expect(output).not.toHaveProperty("descriptor_rehearsal");
		});
	});

	it("reports ineligible verification items without rejecting the intent", () => {
		withRepo((root) => {
			const path = "docs/plans/task-002-intent-validate.intent.json";
			writeFileSync(
				join(root, path),
				intentBytes("task-002-intent-validate", {
					acceptance: [
						{
							id: "A1",
							assertion: "x",
							verification: "bun test",
						},
					],
				}),
			);
			const result = validate(root, path);
			expect(result.returncode).toBe(0);
			const output = JSON.parse(result.stdout);
			expect(output.valid).toBe(true);
			expect(output.verification[0].eligible).toBe(false);
			expect(output.verification[0].reason).toContain(
				"not valid JSON",
			);
			expect(output.enrollment_ready).toBe(false);
		});
	});

	it("reports invalid for strict parser violations with valid:false", () => {
		withRepo((root) => {
			const path = "docs/plans/task-002-intent-validate.intent.json";
			writeFileSync(
				join(root, path),
				intentBytes("task-002-intent-validate", { risk: "unknown" }),
			);
			const result = validate(root, path);
			expect(result.returncode).toBe(0);
			const output = JSON.parse(result.stdout);
			expect(output.valid).toBe(false);
			expect(output.reason).toContain("strict task_intent/v1 parsing failed");
		});
	});

	it("reports invalid for task/path mismatch", () => {
		withRepo((root) => {
			const path = "docs/plans/task-002-intent-validate.intent.json";
			writeFileSync(join(root, path), intentBytes("task-other"));
			const result = validate(root, path);
			const output = JSON.parse(result.stdout);
			expect(output.valid).toBe(false);
			expect(output.reason).toContain("does not match the sidecar filename");
		});
	});

	it("performs zero writes including no friction journal", () => {
		withRepo((root) => {
			const path = "docs/plans/task-002-intent-validate.intent.json";
			writeFileSync(join(root, path), intentBytes());
			const ledgerPath = join(root, ".imm", "memory", "current_iteration.json");
			const ledgerBefore = existsSync(ledgerPath)
				? readFileSync(ledgerPath, "utf8")
				: null;
			const result = validate(root, path);
			expect(result.returncode).toBe(0);
			expect(existsSync(join(root, ".imm", "journal.jsonl"))).toBe(false);
			expect(existsSync(join(root, ".imm", "tasks"))).toBe(false);
			expect(existsSync(join(root, ".imm", "kernel"))).toBe(false);
			if (ledgerBefore === null) {
				expect(existsSync(ledgerPath)).toBe(false);
			} else {
				expect(readFileSync(ledgerPath, "utf8")).toBe(ledgerBefore);
			}
			// Git index unchanged.
			const staged = spawnSync(
				"git",
				["diff", "--cached", "--name-only"],
				{ cwd: root, encoding: "utf8" },
			).stdout;
			expect(staged).toBe("");
		});
	});

	it("rejects paths outside docs/plans and malformed JSON", () => {
		withRepo((root) => {
			const badPath = "src/not-an-intent.json";
			const result = validate(root, badPath);
			expect(result.returncode).toBe(1);
			expect(JSON.parse(result.stdout).error.code).toBe("path_invalid");

			const path = "docs/plans/task-002-intent-validate.intent.json";
			writeFileSync(join(root, path), "{ not json\n");
			const malformed = validate(root, path);
			const output = JSON.parse(malformed.stdout);
			expect(output.valid).toBe(false);
			expect(output.reason).toContain("not valid JSON");
		});
	});

	it("reports missing intent as valid:false without writes", () => {
		withRepo((root) => {
			const result = validate(
				root,
				"docs/plans/task-002-intent-validate.intent.json",
			);
			expect(result.returncode).toBe(0);
			const output = JSON.parse(result.stdout);
			expect(output.valid).toBe(false);
			expect(output.reason).toBeTruthy();
		});
	});
});
