import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import {
	inspectRoutingPolicy,
	policyV1CanonicalBytes,
} from "../plugins/immune-brain/runtime/managed_task_routing_policy";

const ROOT = resolve(import.meta.dir, "..");
const SOURCE_PLAN = resolve(ROOT, "plugins/immune-brain/bin/imm-plan");
const SOURCE_KERNEL = resolve(ROOT, "plugins/immune-brain/bin/imm-kernel");
const POLICY = "docs/plans/managed-task-routing-policy.json";
const roots: string[] = [];
let packedRoot = "";

const VALID_PLAN = `# Iteration Plan

## Task

- Summary: Control plane fixture
- Brainstorm manifest: BR-REQ-001; BR-DEFER-001

## Brainstorm Trace

| Item | Status | Target | Reason |
| --- | --- | --- | --- |
| BR-REQ-001 | covered_by_step | U1 | |
| BR-DEFER-001 | deferred | successor | Later boundary |

## Steps

### Step 1

- Step ID: U1
- Result: Control plane projection exists
- Verification: \`true\`
- Depends on: none
`;

function run(cwd: string, executable: string, args: string[]) {
	return spawnSync(executable, args, { cwd, encoding: "utf8" });
}

function git(root: string, args: string[]): string {
	const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
	if (result.status !== 0)
		throw new Error(result.stderr || `git ${args.join(" ")} failed`);
	return result.stdout.trim();
}

function withRepo<T>(fn: (root: string) => T): T {
	const root = mkdtempSync(join(tmpdir(), "imm-v4-plan-control-"));
	roots.push(root);
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	writeFileSync(join(root, ".gitignore"), ".imm/\n");
	writeFileSync(join(root, "docs", "plans", "fixture.md"), VALID_PLAN);
	git(root, ["init", "-q"]);
	git(root, ["config", "user.email", "fixture@example.com"]);
	git(root, ["config", "user.name", "Fixture"]);
	git(root, ["add", "."]);
	git(root, ["commit", "-qm", "fixture baseline"]);
	return fn(root);
}

function extractPackage(): string {
	const dir = mkdtempSync(join(tmpdir(), "imm-v4-plan-packed-"));
	roots.push(dir);
	const packed = spawnSync(
		"npm",
		["pack", "--silent", "--pack-destination", dir],
		{ cwd: ROOT, encoding: "utf8", timeout: 300_000 },
	);
	if (packed.status !== 0)
		throw new Error(`npm pack failed: ${packed.stderr || packed.stdout}`);
	const tarball = join(dir, packed.stdout.trim().split("\n").pop() ?? "");
	const extracted = spawnSync("tar", ["-xzf", tarball, "-C", dir], {
		encoding: "utf8",
	});
	if (extracted.status !== 0)
		throw new Error(`tar failed: ${extracted.stderr}`);
	return join(dir, "package");
}

function sourceAndPacked(relativeWrapper: string): string[] {
	return [
		resolve(ROOT, relativeWrapper),
		resolve(packedRoot, relativeWrapper),
	];
}

function snapshotTree(root: string): Map<string, string> {
	const snapshot = new Map<string, string>();
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.name === ".git") continue;
			const path = join(dir, entry.name);
			const rel = relative(root, path);
			if (entry.isDirectory()) walk(path);
			else if (entry.isSymbolicLink()) snapshot.set(rel, `link:${readlinkSync(path)}`);
			else snapshot.set(rel, readFileSync(path).toString("base64"));
		}
	};
	walk(root);
	return snapshot;
}

function assertNoWrites(root: string, before: Map<string, string>, index: string, status: string) {
	expect(snapshotTree(root)).toEqual(before);
	expect(git(root, ["ls-files", "-s"])).toBe(index);
	expect(git(root, ["status", "--porcelain=v1"])).toBe(status);
}

function installPolicyCase(root: string, kind: string): () => void {
	const path = join(root, POLICY);
	const restore = () => {};
	if (kind === "absent") return restore;
	if (kind === "active") {
		writeFileSync(path, policyV1CanonicalBytes());
		git(root, ["add", POLICY]);
		return restore;
	}
	if (kind === "malformed") {
		writeFileSync(path, "{ not json\n");
		git(root, ["add", POLICY]);
		return restore;
	}
	if (kind === "drifted") {
		writeFileSync(path, policyV1CanonicalBytes());
		git(root, ["add", POLICY]);
		writeFileSync(path, policyV1CanonicalBytes().replace('"revision": 1', '"revision": 1 '));
		return restore;
	}
	if (kind === "untracked") {
		writeFileSync(path, policyV1CanonicalBytes());
		return restore;
	}
	if (kind === "tracked-deleted") {
		writeFileSync(path, policyV1CanonicalBytes());
		git(root, ["add", POLICY]);
		git(root, ["commit", "-qm", "add policy"]);
		rmSync(path);
		return restore;
	}
	if (kind === "symlinked") {
		const target = join(root, "policy-target.json");
		writeFileSync(target, policyV1CanonicalBytes());
		symlinkSync(target, path);
		return restore;
	}
	if (kind === "oversize") {
		writeFileSync(path, "x".repeat(4097));
		git(root, ["add", POLICY]);
		return restore;
	}
	if (kind === "unreadable") {
		writeFileSync(path, policyV1CanonicalBytes());
		git(root, ["add", POLICY]);
		chmodSync(path, 0);
		return () => chmodSync(path, 0o600);
	}
	throw new Error(`unknown policy fixture: ${kind}`);
}

beforeAll(() => {
	packedRoot = extractPackage();
});

afterAll(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("v4 imm-plan control plane", () => {
	it("ships the pure validator closure without either legacy dispatcher", () => {
		expect(existsSync(join(packedRoot, "plugins/immune-brain/runtime/plan_core.ts"))).toBe(true);
		expect(existsSync(join(packedRoot, "plugins/immune-brain/runtime/immune_brain_runtime.ts"))).toBe(false);
		expect(existsSync(join(packedRoot, "plugins/immune-brain/runtime/commands/plan.ts"))).toBe(false);
	});

	for (const kind of [
		"absent",
		"active",
		"malformed",
		"drifted",
		"untracked",
		"tracked-deleted",
		"symlinked",
		"oversize",
		"unreadable",
	]) {
		it(`passes through the complete ${kind} routing projection in source and package`, () => {
			withRepo((root) => {
				const restore = installPolicyCase(root, kind);
				try {
					let expected;
					try {
						expected = inspectRoutingPolicy(root);
					} catch {
						expected = {
							policy_status: "invalid",
							route: null,
							v3_new_plan_sync: "allowed",
							legacy_v3_mode: null,
							terminal_import: null,
							worktree_sha256: null,
							index_sha256: null,
							ownership: "unavailable",
							reason_code: "policy_read_unavailable",
						};
					}
					for (const wrapper of sourceAndPacked("plugins/immune-brain/bin/imm-plan")) {
						const result = run(root, wrapper, ["--routing-status", "--json"]);
						expect(result.status).toBe(0);
						expect(JSON.parse(result.stdout)).toEqual(expected);
						expect(result.stdout).not.toContain("legacy_validation/v1");
					}
				} finally {
					restore();
				}
			});
		});
	}

	it("validates an explicit Plan with dynamic coverage through source and package", () => {
		withRepo((root) => {
			for (const wrapper of sourceAndPacked("plugins/immune-brain/bin/imm-plan")) {
				const result = run(root, wrapper, ["docs/plans/fixture.md", "--json"]);
				expect(result.status).toBe(0);
				const payload = JSON.parse(result.stdout);
				expect(payload.summary).toBe("Control plane fixture");
				expect(payload.steps).toHaveLength(1);
				expect(payload.origin_coverage).toEqual({
					applicable: true,
					declared_items: 2,
					mapped_items: 2,
					unmapped_items: 0,
					reason_required_without_reason: 0,
					deferred_or_out_of_scope_without_reason: 0,
					complete: true,
				});
			}
		});
	});

	it("rejects missing, malformed, and semantically invalid Plans", () => {
		withRepo((root) => {
			writeFileSync(join(root, "docs/plans/malformed.md"), "# no steps\n");
			writeFileSync(
				join(root, "docs/plans/invalid.md"),
				VALID_PLAN.replace("- Verification: `true`", ""),
			);
			for (const wrapper of sourceAndPacked("plugins/immune-brain/bin/imm-plan")) {
				for (const path of ["docs/plans/missing.md", "docs/plans/malformed.md", "docs/plans/invalid.md"]) {
					const result = run(root, wrapper, [path, "--json"]);
					expect(result.status).toBe(1);
					expect(result.stdout).toBe("");
					expect(result.stderr).toContain("plan_validation_rejected");
				}
			}
		});
	});

	it("rejects ambiguous arguments before state I/O and keeps retired forms write-free", () => {
		withRepo((root) => {
			mkdirSync(join(root, ".imm", "memory"), { recursive: true });
			writeFileSync(join(root, ".imm", "memory", "current_iteration.json"), "{ corrupt\n");
			for (const wrapper of sourceAndPacked("plugins/immune-brain/bin/imm-plan")) {
				const before = snapshotTree(root);
				const index = git(root, ["ls-files", "-s"]);
				const status = git(root, ["status", "--porcelain=v1"]);
				const invalid = run(root, wrapper, ["--wat", "--json"]);
				expect(invalid.status).toBe(2);
				expect(invalid.stderr).toContain("invalid_plan_command");
				assertNoWrites(root, before, index, status);
				const retired = run(root, wrapper, ["docs/plans/fixture.md", "--sync"]);
				expect(retired.status).toBe(1);
				expect(retired.stderr).toContain("v3_storage_retired");
				assertNoWrites(root, before, index, status);
			}
		});
	});

	it("keeps Plan validation advisory and TaskIntent validation independent", () => {
		withRepo((root) => {
			writeFileSync(join(root, POLICY), policyV1CanonicalBytes());
			git(root, ["add", POLICY]);
			writeFileSync(join(root, "docs/plans/invalid.intent.json"), "{}\n");
			for (const [plan, kernel] of [
				[SOURCE_PLAN, SOURCE_KERNEL],
				[
					join(packedRoot, "plugins/immune-brain/bin/imm-plan"),
					join(packedRoot, "plugins/immune-brain/bin/imm-kernel"),
				],
			]) {
				const before = snapshotTree(root);
				const valid = run(root, plan, ["docs/plans/fixture.md", "--json"]);
				expect(valid.status).toBe(0);
				expect(existsSync(join(root, ".imm", "tasks"))).toBe(false);
				const invalidIntent = run(root, kernel, [
					"intent",
					"validate",
					"docs/plans/invalid.intent.json",
					"--json",
				]);
				expect(invalidIntent.status).toBe(0);
				const intentProjection = JSON.parse(invalidIntent.stdout);
				expect(intentProjection.valid).toBe(false);
				expect(intentProjection.reason).toContain(
					"strict task_intent/v1 parsing failed",
				);
				expect(existsSync(join(root, ".imm", "tasks"))).toBe(false);
				expect(snapshotTree(root)).toEqual(before);
			}
		});
	});
});
