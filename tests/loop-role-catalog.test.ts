/**
 * Loop Leader: Project Role Catalog (S1)
 *
 * Verifies S1-AC1 under docs/plans/loop-leader-s1-role-catalog.intent.json and
 * D1 of docs/specs/loop-leader.spec.md (BR-REQ-1, BR-DEC-6, BR-DEC-8).
 *
 * - Positive control: `loop.roles` with a `leader`, a `planner` on base `plan`
 *   and a `security-analyst` on base `analyze` resolves under `loop.value.roles`
 *   with base, host, model, effort, when, instructions, limits and source, and an
 *   absent `loop.roles` yields one built-in role per base on `claude-code`.
 * - Negative control: every rejected role is reported once and absent from the
 *   catalog; the daemon's own `loop.valid` stays true, so one broken role never
 *   stops the Loop.
 * - Boundary control: the limit ranges are closed — `max_parallel: 9` and
 *   `timeout_s: 59` are refused while `max_parallel: 8` is accepted — and the
 *   catalog is project-only.
 */

import { afterAll, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { resolveConfig } from "../plugins/immune-brain/runtime/config/layered_config.ts";
import { runLoopDaemonCli } from "../plugins/immune-brain/runtime/loop_daemon/cli.ts";
import {
	DEFAULT_LOOP_ROLE_LIMITS,
	LOOP_ROLE_BASES,
	resolveLoopRoles,
} from "../plugins/immune-brain/runtime/loop_daemon/role_catalog.ts";

const temp = mkdtempSync(join(tmpdir(), "loop-role-catalog-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));
let counter = 0;
function fixture() {
	const root = join(temp, `repo-${counter++}`), userPath = join(temp, `user-${counter}.json`);
	mkdirSync(join(root, ".imm"), { recursive: true });
	execFileSync("git", ["init", "-q", root]);
	// A user file that is never written: the catalog is project-only.
	writeFileSync(join(root, "role-notes.md"), "Read the auth module first.\n");
	const user = (data: object) => writeFileSync(userPath, JSON.stringify({ contract: "immune_brain/user_config/v2", ...data }));
	const project = (data: object) => writeFileSync(join(root, ".imm/config.json"), JSON.stringify({ contract: "immune_brain/project_config/v2", ...data }));
	const read = () => resolveConfig(root, { userConfigPath: userPath });
	return { root, userPath, projectPath: join(realpathSync(root), ".imm/config.json"), user, project, read };
}

const CATALOG = {
	leader: { base: "leader", when: "always", limits: { turn_budget: 60 } },
	planner: { base: "plan", host: "pi", model: "auto/deepseek-v4.1-flash", effort: "high", instructions: "role-notes.md", limits: { max_parallel: 2 } },
	"security-analyst": { base: "analyze", host: "claude-code", model: "claude-opus-5-5" },
};

test("a project catalog resolves one role per base with base, host, model, effort, when, instructions, limits and source", () => {
	const f = fixture();
	f.project({ loop: { roles: CATALOG } });
	const c = f.read();
	expect(c.diagnostics).toEqual([]);
	expect(c.loop.value.roles.map((role) => [role.name, role.base, role.source])).toEqual([
		["leader", "leader", "project"],
		["clarify", "clarify", "default"],
		["planner", "plan", "project"],
		["execute", "execute", "default"],
		["repair", "repair", "default"],
		["security-analyst", "analyze", "project"],
	]);
	expect(c.loop.value.roles[0]).toEqual({
		name: "leader",
		base: "leader",
		host: "claude-code",
		model: null,
		effort: null,
		when: "always",
		instructions: null,
		limits: { ...DEFAULT_LOOP_ROLE_LIMITS, turn_budget: 60 },
		source: "project",
	});
	expect(c.loop.value.roles[2]).toEqual({
		name: "planner",
		base: "plan",
		host: "pi",
		model: "auto/deepseek-v4.1-flash",
		effort: "high",
		when: null,
		instructions: "role-notes.md",
		limits: { ...DEFAULT_LOOP_ROLE_LIMITS, max_parallel: 2 },
		source: "project",
	});
	// A base with no configured role keeps the documented default.
	expect(c.loop.value.roles[1]).toEqual({
		name: "clarify",
		base: "clarify",
		host: "claude-code",
		model: null,
		effort: null,
		when: null,
		instructions: null,
		limits: DEFAULT_LOOP_ROLE_LIMITS,
		source: "default",
	});
});

test("imm-kernel config --json shows the resolved catalog under loop.value.roles", () => {
	const f = fixture();
	f.project({ loop: { roles: CATALOG } });
	const result = spawnSync(resolve("plugins/immune-brain/bin/imm-kernel"), ["config", "--json"], {
		cwd: f.root,
		encoding: "utf8",
		env: { ...process.env, XDG_CONFIG_HOME: join(temp, "xdg") },
	});
	expect(result.status).toBe(0);
	const parsed = JSON.parse(result.stdout);
	expect(parsed.loop.value.roles.map((role: { name: string }) => role.name)).toEqual(["leader", "clarify", "planner", "execute", "repair", "security-analyst"]);
	expect(parsed.loop.value.roles[5]).toMatchObject({ base: "analyze", host: "claude-code", model: "claude-opus-5-5", source: "project" });
});

test("an absent loop.roles yields one built-in role per base on claude-code with 40 turns, 900 s and 1 slot", () => {
	const f = fixture();
	const c = f.read();
	expect(c.diagnostics).toEqual([]);
	expect(c.loop.value.roles.map((role) => role.name)).toEqual([...LOOP_ROLE_BASES]);
	for (const role of c.loop.value.roles) {
		expect(role).toEqual({
			name: role.base,
			base: role.base,
			host: "claude-code",
			model: null,
			effort: null,
			when: null,
			instructions: null,
			limits: { turn_budget: 40, timeout_s: 900, max_parallel: 1 },
			source: "default",
		});
	}
});

/** One rejected role, reported once, absent from the catalog. */
function rejected(roles: Record<string, unknown>, code: string, extra: { key_path?: string; file?: string } = {}) {
	const { roles: resolved, errors } = resolveLoopRoles({ roles, root: temp });
	expect(errors).toEqual([expect.objectContaining({ code, ...(extra.key_path ? { key_path: extra.key_path } : {}) })]);
	return resolved;
}

test("an unknown base is reported as role_base_unknown and the role never enters the catalog", () => {
	const roles = rejected({ "perf-check": { base: "review" } }, "role_base_unknown", { key_path: "loop.roles.perf-check.base" });
	expect(roles.map((role) => role.name)).toEqual([...LOOP_ROLE_BASES]);
});

test("an invalid name is reported as role_name_invalid", () => {
	const roles = rejected({ "Bad_Name": { base: "plan" } }, "role_name_invalid", { key_path: "loop.roles.Bad_Name" });
	expect(roles.map((role) => role.name)).toEqual([...LOOP_ROLE_BASES]);
});

test("instructions outside the repository are refused, never read", () => {
	rejected({ planner: { base: "plan", instructions: "../x.md" } }, "role_instructions_outside_repo", { key_path: "loop.roles.planner.instructions" });
	rejected({ planner: { base: "plan", instructions: "/etc/passwd" } }, "role_instructions_outside_repo", { key_path: "loop.roles.planner.instructions" });
});

test("a missing instructions file is reported as role_instructions_missing", () => {
	rejected({ planner: { base: "plan", instructions: "notes/absent.md" } }, "role_instructions_missing", { key_path: "loop.roles.planner.instructions" });
});

test("two leader roles are both reported as leader_role_duplicate and the built-in leader returns", () => {
	const { roles, errors } = resolveLoopRoles({
		roles: { chief: { base: "leader" }, deputy: { base: "leader", host: "pi" } },
		root: temp,
	});
	expect(errors.map((error) => [error.code, error.key_path])).toEqual([
		["leader_role_duplicate", "loop.roles.chief"],
		["leader_role_duplicate", "loop.roles.deputy"],
	]);
	expect(roles.map((role) => [role.name, role.source])).toEqual([["leader", "default"], ...LOOP_ROLE_BASES.slice(1).map((base) => [base, "default"])]);
});

test.each([
	["turn_budget", 0],
	["turn_budget", 201],
	["timeout_s", 59],
	["timeout_s", 3601],
	["max_parallel", 0],
	["max_parallel", 9],
] as const)("a limit out of range (%s: %p) is role_limit_out_of_range", (key, value) => {
	rejected({ planner: { base: "plan", limits: { [key]: value } } }, "role_limit_out_of_range", { key_path: `loop.roles.planner.limits.${key}` });
});

test.each([
	["max_parallel", 1],
	["max_parallel", 8],
	["turn_budget", 200],
	["timeout_s", 60],
	["timeout_s", 3600],
] as const)("a limit on the boundary (%s: %p) is accepted", (key, value) => {
	const { roles, errors } = resolveLoopRoles({ roles: { planner: { base: "plan", limits: { [key]: value } } }, root: temp });
	expect(errors).toEqual([]);
	expect(roles[2]!.limits[key]).toBe(value);
});

test("a rejected role is one error diagnostic and the daemon's loop keeps running", async () => {
	const f = fixture();
	f.project({ loop: { roles: { broken: { base: "review" }, planner: { base: "plan", limits: { turn_budget: 0 } }, "security-analyst": { base: "analyze" } } } });
	const c = f.read();
	expect(c.diagnostics).toContainEqual(expect.objectContaining({ code: "role_base_unknown", severity: "error", file: f.projectPath, key_path: "loop.roles.broken.base" }));
	expect(c.diagnostics).toContainEqual(expect.objectContaining({ code: "role_limit_out_of_range", severity: "error", file: f.projectPath, key_path: "loop.roles.planner.limits.turn_budget" }));
	// The excluded roles are gone; the accepted one and the per-base defaults remain.
	expect(c.loop.value.roles.map((role) => role.name)).toEqual(["leader", "clarify", "plan", "execute", "repair", "security-analyst"]);
	// A rejected role is excluded, not a reason to stop the daemon.
	expect(c.loop.valid).toBe(true);
	const result = spawnSync(resolve("plugins/immune-brain/bin/imm-kernel"), ["config", "--json"], {
		cwd: f.root,
		encoding: "utf8",
		env: { ...process.env, XDG_CONFIG_HOME: join(temp, "xdg") },
	});
	expect(result.status).toBe(1);

	// ADR 0042: because loop.valid stays true, `imm-loop status` surfaces the rejected
	// role diagnostics explicitly in both JSON and text output.
	const statusJson = await runLoopDaemonCli(["status", "--json"], f.root, { userConfigPath: f.userPath });
	expect(statusJson.returncode).toBe(0);
	const parsed = JSON.parse(statusJson.stdout);
	expect(parsed.role_catalog_diagnostics).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ code: "role_base_unknown", severity: "error", key_path: "loop.roles.broken.base" }),
			expect.objectContaining({ code: "role_limit_out_of_range", severity: "error", key_path: "loop.roles.planner.limits.turn_budget" }),
		]),
	);
	const statusText = await runLoopDaemonCli(["status"], f.root, { userConfigPath: f.userPath });
	expect(statusText.returncode).toBe(0);
	expect(statusText.stdout).toContain("Role Catalog Diagnostics:");
	expect(statusText.stdout).toContain("role_base_unknown");
});

test("the catalog is project-only: a user-file loop.roles is config_invalid", () => {
	const f = fixture();
	f.user({ loop: { roles: { planner: { base: "plan" } } } });
	const c = f.read();
	expect(c.diagnostics).toContainEqual(expect.objectContaining({ code: "config_invalid", severity: "error", file: f.userPath, key_path: "loop.roles" }));
	expect(c.loop.value.roles.map((role) => role.name)).toEqual([...LOOP_ROLE_BASES]);
});
