import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deliverSingleTask } from "../plugins/immune-brain/runtime/unattended/checkout_delivery";

const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
function git(root: string, ...args: string[]) {
	return execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function fixture(mode: "manual" | "auto") {
	const root = mkdtempSync(join(tmpdir(), "single-delivery-")); roots.push(root);
	git(root, "init", "-q", "-b", "main");
	mkdirSync(join(root, ".imm"), { recursive: true });
	writeFileSync(join(root, ".imm/config.json"), JSON.stringify({ contract: "immune_brain/project_config/v1", git_integration: mode }));
	for (const file of ["changed", "renamed", "unrelated"]) writeFileSync(join(root, file), `base ${file}\n`);
	git(root, "add", "."); git(root, "commit", "-qm", "base");
	const base = git(root, "rev-parse", "HEAD");
	git(root, "checkout", "-qb", "delivery");
	writeFileSync(join(root, "changed"), "delivered\n");
	writeFileSync(join(root, "new"), "new delivery\n");
	mkdirSync(join(root, ".imm/audit/task/run"), { recursive: true });
	writeFileSync(join(root, ".imm/audit/task/run/task-record.json"), "record\n");
	writeFileSync(join(root, ".imm/audit/task/run/terminal-proof.json"), "proof\n");
	git(root, "add", "."); git(root, "commit", "-qm", "delivery");
	const head = git(root, "rev-parse", "HEAD"); git(root, "checkout", "-q", "main");
	return { root, base, head };
}
function snapshot(root: string) {
	return { head: git(root, "rev-parse", "HEAD"), status: git(root, "status", "--porcelain=v1", "--untracked-files=all"),
		index: git(root, "diff", "--cached", "--binary"), work: git(root, "diff", "--binary"),
		files: ["changed", "new", "renamed", "unrelated"].map(path => existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : null) };
}

describe("single-task checkout delivery", () => {
	for (const mode of ["manual", "auto"] as const) {
		test(`${mode} delivers alongside unrelated staged, unstaged and untracked files`, () => {
			const f = fixture(mode);
			writeFileSync(join(f.root, "unrelated"), "staged\n"); git(f.root, "add", "unrelated");
			writeFileSync(join(f.root, "unrelated"), "unstaged\n"); writeFileSync(join(f.root, "local"), "untracked\n");
			const priorIndex = git(f.root, "show", ":unrelated");
			const result = deliverSingleTask(f.root, f.base, f.head);
			expect(result).toEqual({ mode, status: mode === "auto" ? "fast_forwarded" : "staged", reason: null });
			expect(git(f.root, "rev-parse", "HEAD")).toBe(mode === "auto" ? f.head : f.base);
			expect(git(f.root, "rev-parse", "refs/heads/delivery")).toBe(f.head);
			expect(readFileSync(join(f.root, "unrelated"), "utf8")).toBe("unstaged\n");
			expect(git(f.root, "show", ":unrelated")).toBe(priorIndex);
			expect(readFileSync(join(f.root, "local"), "utf8")).toBe("untracked\n");
			for (const [path, content] of [["changed", "delivered\n"], [".imm/audit/task/run/task-record.json", "record\n"], [".imm/audit/task/run/terminal-proof.json", "proof\n"]]) {
				expect(readFileSync(join(f.root, path!), "utf8")).toBe(content!);
				if (mode === "manual") expect(git(f.root, "show", `:${path}`)).toBe(content!.trim());
			}
		});
		for (const kind of ["staged", "unstaged", "untracked", "deletion", "rename-source", "rename-target"] as const) {
			test(`${mode} parks overlapping ${kind} without changing the checkout`, () => {
				const f = fixture(mode);
				if (kind === "staged" || kind === "unstaged") {
					writeFileSync(join(f.root, "changed"), "user edit\n"); if (kind === "staged") git(f.root, "add", "changed");
				} else if (kind === "untracked") writeFileSync(join(f.root, "new"), "user file\n");
				else if (kind === "deletion") rmSync(join(f.root, "changed"));
				else if (kind === "rename-source") git(f.root, "mv", "changed", "elsewhere");
				else git(f.root, "mv", "renamed", "new");
				const before = snapshot(f.root);
				const result = deliverSingleTask(f.root, f.base, f.head);
				expect(result.status).toBe("blocked");
				expect(result.reason).toContain(`checkout_delivery_overlap: ${kind === "untracked" || kind === "rename-target" ? "new" : "changed"}`);
				expect(snapshot(f.root)).toEqual(before);
			});
		}
	}
	test("manual conflicts against a changed HEAD without writing", () => {
		const f = fixture("manual"); writeFileSync(join(f.root, "changed"), "different committed content\n");
		git(f.root, "add", "changed"); git(f.root, "commit", "-qm", "diverged");
		const before = snapshot(f.root); const result = deliverSingleTask(f.root, f.base, f.head);
		expect(result.reason).toContain("checkout_delivery_conflict"); expect(snapshot(f.root)).toEqual(before);
	});
	for (const kind of ["diverged", "detached"] as const) test(`auto refuses ${kind} HEAD without writing`, () => {
		const f = fixture("auto");
		if (kind === "detached") git(f.root, "checkout", "-q", "--detach");
		else { writeFileSync(join(f.root, "other"), "other\n"); git(f.root, "add", "other"); git(f.root, "commit", "-qm", "diverged"); }
		const before = snapshot(f.root); const result = deliverSingleTask(f.root, f.base, f.head);
		expect(result.reason).toBe(kind === "detached" ? "coordinator_branch_unavailable" : "coordinator_head_diverged");
		expect(snapshot(f.root)).toEqual(before);
	});
});
