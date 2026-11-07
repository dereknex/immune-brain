import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deliverSingleTask, deliveryAlreadyApplied } from "../plugins/immune-brain/runtime/unattended/checkout_delivery";

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
	for (const mode of ["manual", "auto"] as const) {
		test(`${mode} replay recognizes its own applied delivery without applying twice`, () => {
			const f = fixture(mode);
			expect(deliveryAlreadyApplied(f.root, f.base, f.head)).toBe(false);
			expect(deliverSingleTask(f.root, f.base, f.head).reason).toBeNull();
			const applied = snapshot(f.root);
			expect(deliveryAlreadyApplied(f.root, f.base, f.head)).toBe(true);
			expect(deliverSingleTask(f.root, f.base, f.head)).toEqual({ mode, status: mode === "auto" ? "fast_forwarded" : "staged", reason: null });
			expect(snapshot(f.root)).toEqual(applied);
		});
	}
	for (const change of ["bytes", "mode", "unstaged"] as const) {
		test(`manual replay parks a delivery whose ${change} changed after apply`, () => {
			const f = fixture("manual");
			deliverSingleTask(f.root, f.base, f.head);
			if (change === "bytes") { writeFileSync(join(f.root, "changed"), "user edit\n"); git(f.root, "add", "changed"); }
			else if (change === "mode") chmodSync(join(f.root, "changed"), 0o755);
			else writeFileSync(join(f.root, "new"), "different\n");
			const before = snapshot(f.root);
			expect(deliveryAlreadyApplied(f.root, f.base, f.head)).toBe(false);
			const result = deliverSingleTask(f.root, f.base, f.head);
			expect(result.status).toBe("blocked");
			expect(result.reason).toContain("checkout_delivery_overlap");
			expect(snapshot(f.root)).toEqual(before);
		});
	}
	describe("per-path identity (manual)", () => {
		const satisfy = (root: string) => { writeFileSync(join(root, "new"), "new delivery\n"); git(root, "add", "new"); };
		const delivered = (root: string) => [["changed", "delivered\n"], ["new", "new delivery\n"],
			[".imm/audit/task/run/task-record.json", "record\n"], [".imm/audit/task/run/terminal-proof.json", "proof\n"]]
			.every(([path, content]) => readFileSync(join(root, path!), "utf8") === content && git(root, "show", `:${path}`) === content!.trim());

		test("delivers the remaining paths around one already identical staged path", () => {
			const f = fixture("manual"); satisfy(f.root);
			const satisfiedIndex = git(f.root, "ls-files", "--stage", "new");
			expect(deliveryAlreadyApplied(f.root, f.base, f.head)).toBe(false);
			expect(deliverSingleTask(f.root, f.base, f.head)).toEqual({ mode: "manual", status: "staged", reason: null });
			expect(git(f.root, "ls-files", "--stage", "new")).toBe(satisfiedIndex);
			expect(delivered(f.root)).toBe(true);
			expect(git(f.root, "rev-parse", "HEAD")).toBe(f.base);
			expect(git(f.root, "status", "--porcelain=v1", "--untracked-files=all")).not.toMatch(/^.\S|^\?\?/m);
			expect(deliveryAlreadyApplied(f.root, f.base, f.head)).toBe(true);
		});

		test("a second call after a partial delivery reports the same success and changes nothing", () => {
			const f = fixture("manual"); satisfy(f.root);
			const first = deliverSingleTask(f.root, f.base, f.head);
			const applied = snapshot(f.root);
			expect(deliveryAlreadyApplied(f.root, f.base, f.head)).toBe(true);
			expect(deliverSingleTask(f.root, f.base, f.head)).toEqual(first);
			expect(snapshot(f.root)).toEqual(applied);
		});

		for (const shape of ["bytes", "mode", "deletion", "unrelated"] as const) {
			test(`still parks with checkout_delivery_overlap when the ${shape} differs`, () => {
				const f = shape === "deletion" ? deletionFixture() : fixture("manual");
				satisfy(f.root);
				if (shape === "bytes") writeFileSync(join(f.root, "new"), "different\n");
				else if (shape === "mode") chmodSync(join(f.root, "new"), 0o755);
				else if (shape === "deletion") { git(f.root, "rm", "-q", "--cached", "gone"); }
				else writeFileSync(join(f.root, "changed"), "user edit\n");
				const before = snapshot(f.root);
				const result = deliverSingleTask(f.root, f.base, f.head);
				expect(result.status).toBe("blocked");
				expect(result.reason).toBe(`checkout_delivery_overlap: ${{ bytes: "new", mode: "new", deletion: "gone", unrelated: "changed" }[shape]}`);
				expect(snapshot(f.root)).toEqual(before);
				expect(existsSync(join(f.root, ".imm/audit/task/run/task-record.json"))).toBe(false);
			});
		}
	});
	/** The standard delivery plus a deletion of the tracked `gone` file. */
	function deletionFixture() {
		const f = fixture("manual");
		git(f.root, "checkout", "-q", "main"); writeFileSync(join(f.root, "gone"), "gone\n");
		git(f.root, "add", "gone"); git(f.root, "commit", "-qm", "base with gone");
		const base = git(f.root, "rev-parse", "HEAD");
		git(f.root, "checkout", "-qb", "delivery-gone"); git(f.root, "merge", "-q", "--no-edit", f.head);
		git(f.root, "rm", "-q", "gone"); git(f.root, "commit", "-qm", "delete gone");
		const head = git(f.root, "rev-parse", "HEAD"); git(f.root, "checkout", "-q", "main");
		return { root: f.root, base, head };
	}
	test("auto replay does not treat an unrelated HEAD as the applied delivery", () => {
		const f = fixture("auto");
		expect(deliveryAlreadyApplied(f.root, f.base, f.head)).toBe(false);
		writeFileSync(join(f.root, "other"), "other\n"); git(f.root, "add", "other"); git(f.root, "commit", "-qm", "diverged");
		expect(deliveryAlreadyApplied(f.root, f.base, f.head)).toBe(false);
	});
});
