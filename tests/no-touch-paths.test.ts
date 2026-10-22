import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { assertNoTouch, NO_TOUCH_PATH, parseNoTouch, readNoTouch } from "../plugins/immune-brain/runtime/no_touch";
import { parseProjectTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import { changedPathRiskFloor, NO_RISK_FLOOR } from "../plugins/immune-brain/runtime/kernel/risk_floor";
import { taskDeliveryIdentity } from "../plugins/immune-brain/runtime/workspace_scope";
import { integrateLaneCommit, BatchIntegrationError } from "../plugins/immune-brain/runtime/unattended/batch_integration";
import { runKernelCommand } from "../plugins/immune-brain/runtime/commands/kernel";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function git(root: string, ...args: string[]): string {
	return execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@local", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function put(root: string, path: string, value = "changed\n") {
	mkdirSync(dirname(join(root, path)), { recursive: true });
	writeFileSync(join(root, path), value);
}
function repo(additions: string[] = []) {
	const root = mkdtempSync(join(tmpdir(), "no-touch-")); roots.push(root);
	git(root, "init", "-q");
	put(root, "README.md", "base\n");
	put(root, NO_TOUCH_PATH, JSON.stringify({ contract: "immune_brain/no_touch/v1", paths: additions }));
	git(root, "add", "."); git(root, "commit", "-qm", "base");
	return { root, base: git(root, "rev-parse", "HEAD") };
}
const forbidden = [".imm/state/x", ".env", "nested/.env.local", "cert.pem", "private.key", "nested/id_rsa.pub", "id_ed25519", ".npmrc", ".netrc", ".github/workflows/ci.yml", ".changeset/config.json"];
const candidate = {
	contract: "assurance_kernel/task_intent/v1", task_id: "fixture", owner: "user", goal: "test",
	acceptance: [{ id: "AC1", assertion: "works", verification: JSON.stringify({ contract: "assurance_kernel/verification_descriptor/v2",
		command: { executable: "bun", argv: ["-e", ""], cwd: ".", timeout_ms: 1000, max_output_bytes: 4096 }, environment: { prepare: null, writable_paths: [] } }) }],
	scope_hint: ["src"], risk: "routine", revision: 1,
};

test("single-task delivery refuses every hard no-touch change before filtering authority state", () => {
	for (const path of forbidden) {
		const { root, base } = repo(); put(root, path); git(root, "add", "-f", "--", path);
		const record = { contract: "assurance_kernel/task_record/v4", task_id: "fixture", git_base_head: base, intent_snapshot: { scope_hint: [path] } };
		expect(() => taskDeliveryIdentity(root, record)).toThrow(`no_touch_path_changed: ${path}`);
		git(root, "commit", "-qm", "delivery");
		expect(() => taskDeliveryIdentity(root, record)).toThrow(`no_touch_path_changed: ${path}`);
	}
});

test("ordinary changesets remain deliverable", () => {
	const { root, base } = repo(); put(root, ".changeset/feature.md"); git(root, "add", ".");
	expect(taskDeliveryIdentity(root, { contract: "assurance_kernel/task_record/v4", task_id: "fixture", git_base_head: base,
		intent_snapshot: { scope_hint: [".changeset/feature.md"] } }).changed_paths).toEqual([".changeset/feature.md"]);
});

test("batch rebuilt candidate refuses no-touch changes and leaves Parent unmoved", () => {
	for (const path of [...forbidden, "protected/config.json"]) {
		const { root, base } = repo(["protected"]);
		git(root, "update-ref", "refs/heads/imm/test", base);
		put(root, path); git(root, "add", "-f", "--", path); git(root, "commit", "-qm", "lane");
		const lane = git(root, "rev-parse", "HEAD");
		git(root, "reset", "--hard", base); put(root, "sibling.txt"); git(root, "add", "."); git(root, "commit", "-qm", "sibling");
		const head = git(root, "rev-parse", "HEAD"); git(root, "update-ref", "refs/heads/imm/test", head);
		try {
			integrateLaneCommit({ root, branch: "refs/heads/imm/test", batch_head: head, lane_base: base, lane_commit: lane });
			throw new Error("integration should refuse");
		} catch (error) {
			expect(error).toBeInstanceOf(BatchIntegrationError);
			expect((error as BatchIntegrationError).reason).toBe("no_touch_path_changed");
			expect((error as Error).message).toContain(path);
		}
		expect(git(root, "rev-parse", "refs/heads/imm/test")).toBe(head);
	}
});

test("repository additions apply to intent validation and cannot remove defaults", () => {
	const { root } = repo(["protected"]);
	for (const path of [...forbidden, "protected/config.json"]) {
		expect(() => parseProjectTaskIntent(root, { ...candidate, scope_hint: [path] })).toThrow(`no_touch_path_changed: ${path}`);
		put(root, "docs/plans/fixture.intent.json", JSON.stringify({ ...candidate, scope_hint: [path] }));
		const result = runKernelCommand(["intent", "validate", "docs/plans/fixture.intent.json", "--json"], root);
		expect(result.stdout).toContain("no_touch_path_changed");
		expect(JSON.parse(result.stdout).valid).toBe(false);
	}
	expect(() => assertNoTouch([".env"], [])).toThrow("no_touch_path_changed");
});

test("ancestor compaction cannot hide a named no-touch path from intent validation", () => {
	const { root } = repo(["protected/config.json"]);
	for (const scope_hint of [["nested", "nested/.env"], ["protected", "protected/config.json"], ["nested/", "nested/.env/"], [".github", ".github/workflows/**"]]) {
		expect(() => parseProjectTaskIntent(root, { ...candidate, scope_hint })).toThrow("no_touch_path_changed");
		put(root, "docs/plans/fixture.intent.json", JSON.stringify({ ...candidate, scope_hint }));
		const result = runKernelCommand(["intent", "validate", "docs/plans/fixture.intent.json", "--json"], root);
		expect(JSON.parse(result.stdout).valid).toBe(false);
		expect(result.stdout).toContain("no_touch_path_changed");
	}
});

test("deleting additions during a task cannot authorize a forbidden delivery", () => {
	const { root, base } = repo(["protected"]);
	put(root, NO_TOUCH_PATH, JSON.stringify({ contract: "immune_brain/no_touch/v1", paths: [] }));
	put(root, "protected/config.json"); git(root, "add", ".");
	expect(() => taskDeliveryIdentity(root, { contract: "assurance_kernel/task_record/v4", task_id: "fixture", git_base_head: base,
		intent_snapshot: { scope_hint: ["protected", NO_TOUCH_PATH] } })).toThrow("no_touch_path_changed: protected/config.json");
});

test("strict declarations name malformed fields and changing the declaration raises critical risk", () => {
	for (const [value, field] of [
		[{ contract: "wrong", paths: [] }, "contract"], [{ contract: "immune_brain/no_touch/v1", paths: "x" }, "paths"],
		[{ contract: "immune_brain/no_touch/v1", paths: ["../x"] }, "paths[0]"],
		[{ contract: "immune_brain/no_touch/v1", paths: [], remove: [".env"] }, "remove"],
	] as const) expect(() => parseNoTouch(value)).toThrow(`no_touch.${field}`);
	const { root } = repo(); put(root, NO_TOUCH_PATH, "{broken");
	expect(() => readNoTouch(root)).toThrow();
	expect(changedPathRiskFloor([NO_TOUCH_PATH], NO_RISK_FLOOR)).toBe("critical");
});
