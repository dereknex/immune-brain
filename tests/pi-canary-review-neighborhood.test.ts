import { execFileSync } from "node:child_process";
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	captureReviewBundle,
	verifyReviewBundle,
} from "../plugins/immune-brain/.pi-extension/pi-canary-review-bundle.ts";
import {
	reservedAgentParams,
	semanticNeighborhoodReviewPrompt,
} from "../plugins/immune-brain/.pi-extension/pi-canary-native-review.ts";
import { taskDiffHash } from "../plugins/immune-brain/runtime/workspace_scope.ts";

function git(root: string, args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function repo(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "canary-review-neighborhood-"));
	git(root, ["init", "-q"]);
	git(root, ["config", "user.email", "test@example.com"]);
	git(root, ["config", "user.name", "Test"]);
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(join(root, path, ".."), { recursive: true });
		writeFileSync(join(root, path), content);
	}
	git(root, ["add", "."]);
	git(root, ["commit", "-qm", "fixture"]);
	return root;
}

const outcomes = { "acc-neighborhood": { status: "passed" as const, summary: "focused checks pass" } };

describe("review semantic neighborhood", () => {
	test("captures unchanged scoped siblings with explicit diff/context provenance", () => {
		const root = repo({
			"src/machine.ts": "export const state = 'idle';\n",
			"src/settle.ts": "export const settle = () => 'terminal';\n",
			"outside.ts": "export const unrelated = true;\n",
		});
		try {
			writeFileSync(join(root, "src/machine.ts"), "export const state = 'settling';\n");
			git(root, ["add", "src/machine.ts"]);
			const scope = ["src/machine.ts", "src/settle.ts"];
			const bundle = captureReviewBundle(root, scope, taskDiffHash(root, scope), outcomes);

			expect(Object.keys(bundle.dirty_files)).toEqual(["src/machine.ts"]);
			expect(Object.keys(bundle.neighborhood_files ?? {})).toEqual(["src/settle.ts"]);
			expect(bundle.path_provenance).toEqual({
				"src/machine.ts": "diff",
				"src/settle.ts": "neighborhood",
			});
			expect(bundle.path_provenance).not.toHaveProperty("outside.ts");
			const sibling = bundle.neighborhood_files!["src/settle.ts"];
			expect(sibling.base_oid).toBe(git(root, ["rev-parse", "HEAD:src/settle.ts"]));
			expect(sibling.oid).toBe(sibling.base_oid);
			expect(sibling.current_content).toContain("terminal");

			const tampered = structuredClone(bundle);
			tampered.neighborhood_files!["src/settle.ts"].current_content = "tampered";
			expect(() => verifyReviewBundle(tampered)).toThrow(/digest mismatch/i);

			writeFileSync(join(root, "src/settle.ts"), "mutated after capture\n");
			rmSync(join(root, ".git"), { recursive: true, force: true });
			expect(bundle.neighborhood_files!["src/settle.ts"].current_content).toContain("terminal");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("supports directory scope but never captures tracked files outside it", () => {
		const root = repo({
			"state/change.ts": "export const change = 1;\n",
			"state/cancel.ts": "export const cancel = 1;\n",
			"other/race.ts": "export const race = 1;\n",
		});
		try {
			writeFileSync(join(root, "state/change.ts"), "export const change = 2;\n");
			git(root, ["add", "state/change.ts"]);
			const scope = ["state"];
			const bundle = captureReviewBundle(root, scope, taskDiffHash(root, scope), outcomes);
			expect(Object.keys(bundle.neighborhood_files ?? {})).toEqual(["state/cancel.ts"]);
			expect(bundle.path_provenance).not.toHaveProperty("other/race.ts");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("fails closed when a neighborhood file exceeds 256 KiB", () => {
		const root = repo({
			"state/change.ts": "export const change = 1;\n",
			"state/large.ts": "x".repeat(256 * 1024 + 1),
		});
		try {
			writeFileSync(join(root, "state/change.ts"), "export const change = 2;\n");
			git(root, ["add", "state/change.ts"]);
			const scope = ["state"];
			expect(() => captureReviewBundle(root, scope, taskDiffHash(root, scope), outcomes))
				.toThrow(/bounded size/i);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("keeps the unchanged 2 MiB total bundle limit", () => {
		const files: Record<string, string> = { "state/change.ts": "export const change = 1;\n" };
		for (let index = 0; index < 9; index += 1) files[`state/context-${index}.txt`] = "x".repeat(240 * 1024);
		const root = repo(files);
		try {
			writeFileSync(join(root, "state/change.ts"), "export const change = 2;\n");
			git(root, ["add", "state/change.ts"]);
			const scope = ["state"];
			expect(() => captureReviewBundle(root, scope, taskDiffHash(root, scope), outcomes))
				.toThrow(/bounded output limit/i);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("reserved prompt requires provenance checks and full settlement-path enumeration", () => {
		const base = "Review the immutable evidence bundle.";
		const prompt = semanticNeighborhoodReviewPrompt(base);
		expect(prompt).toContain("neighborhood_files entry");
		expect(prompt).toContain("path_provenance is authoritative");
		expect(prompt).toContain("terminal, cancellation, timeout, and race path");
		expect(prompt).toContain("Reference a bundle path at the start of each finding summary");
		const params = reservedAgentParams({ taskId: "task-1", operationId: "op-1", prompt: base });
		expect(params.prompt).toBe(prompt);
	});
});
