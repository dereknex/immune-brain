import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
	inspectRoutingPolicy,
	MANAGED_TASK_ROUTING_POLICY_V1_SHA256,
	policyV1CanonicalBytes,
	setRoutingPolicyReaderTestHook,
} from "../plugins/immune-brain/runtime/managed_task_routing_policy";

const roots: string[] = [];

function git(root: string, args: string[]): void {
	const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(result.stderr || `git ${args.join(" ")} failed`);
	}
}

function withRepo<T>(fn: (root: string) => T): T {
	const root = mkdtempSync(join(tmpdir(), "imm-routing-policy-"));
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

function policyPath(root: string): string {
	return join(root, "docs", "plans", "managed-task-routing-policy.json");
}

afterEach(() => {
	setRoutingPolicyReaderTestHook(null);
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

describe("managed task routing policy projection", () => {
	it("reports legacy_v3 when the policy is absent from worktree and index", () => {
		withRepo((root) => {
			const projection = inspectRoutingPolicy(root);
			expect(projection.policy_status).toBe("legacy_v3");
			expect(projection.route).toBeNull();
			expect(projection.v3_new_plan_sync).toBe("allowed");
			expect(projection.legacy_v3_mode).toBeNull();
			expect(projection.terminal_import).toBeNull();
			expect(projection.worktree_sha256).toBeNull();
			expect(projection.index_sha256).toBeNull();
			expect(projection.ownership).toBe("absent");
			expect(projection.reason_code).toBe("policy_absent");
		});
	});

	it("reports active for canonical bytes tracked byte-identically", () => {
		withRepo((root) => {
			const canonical = policyV1CanonicalBytes();
			writeFileSync(policyPath(root), canonical);
			git(root, ["add", "docs/plans/managed-task-routing-policy.json"]);
			const projection = inspectRoutingPolicy(root);
			expect(projection.policy_status).toBe("active");
			expect(projection.route).toBe("kernel_task_intent");
			expect(projection.v3_new_plan_sync).toBe("retired");
			expect(projection.legacy_v3_mode).toBe("drain_read_only");
			expect(projection.terminal_import).toBe("disabled");
			expect(projection.worktree_sha256).toBe(
				MANAGED_TASK_ROUTING_POLICY_V1_SHA256,
			);
			expect(projection.index_sha256).toBe(
				MANAGED_TASK_ROUTING_POLICY_V1_SHA256,
			);
			expect(projection.ownership).toBe("tracked_clean");
			expect(projection.reason_code).toBe("policy_active");
		});
	});

	it("fails closed on untracked present policy", () => {
		withRepo((root) => {
			writeFileSync(policyPath(root), policyV1CanonicalBytes());
			const projection = inspectRoutingPolicy(root);
			expect(projection.policy_status).toBe("invalid");
			expect(projection.reason_code).toBe("policy_untracked");
			expect(projection.ownership).toBe("untracked");
		});
	});

	it("fails closed on tracked-deleted policy", () => {
		withRepo((root) => {
			writeFileSync(policyPath(root), policyV1CanonicalBytes());
			git(root, ["add", "docs/plans/managed-task-routing-policy.json"]);
			// Remove only the worktree file; the index entry must survive.
			rmSync(policyPath(root));
			const projection = inspectRoutingPolicy(root);
			expect(projection.policy_status).toBe("invalid");
			expect(projection.reason_code).toBe("policy_tracked_deleted");
			expect(projection.ownership).toBe("tracked_deleted");
		});
	});

	it("fails closed on worktree/index drift", () => {
		withRepo((root) => {
			writeFileSync(policyPath(root), policyV1CanonicalBytes());
			git(root, ["add", "docs/plans/managed-task-routing-policy.json"]);
			writeFileSync(
				policyPath(root),
				policyV1CanonicalBytes().replace('"revision": 1', '"revision": 1 '),
			);
			const projection = inspectRoutingPolicy(root);
			expect(projection.policy_status).toBe("invalid");
			expect(projection.reason_code).toBe("policy_worktree_index_drift");
			expect(projection.ownership).toBe("worktree_index_drift");
		});
	});

	it("fails closed on malformed JSON", () => {
		withRepo((root) => {
			writeFileSync(policyPath(root), "{ not json\n");
			git(root, ["add", "docs/plans/managed-task-routing-policy.json"]);
			const projection = inspectRoutingPolicy(root);
			expect(projection.policy_status).toBe("invalid");
			expect(projection.reason_code).toBe("policy_invalid_json");
		});
	});

	it("fails closed on unknown fields", () => {
		withRepo((root) => {
			const altered = policyV1CanonicalBytes().replace(
				'"terminal_import": "disabled"',
				'"terminal_import": "disabled",\n  "extra": true',
			);
			writeFileSync(policyPath(root), altered);
			git(root, ["add", "docs/plans/managed-task-routing-policy.json"]);
			const projection = inspectRoutingPolicy(root);
			expect(projection.policy_status).toBe("invalid");
			expect(projection.reason_code).toBe("policy_unknown_field");
		});
	});

	it("fails closed on duplicate JSON keys", () => {
		withRepo((root) => {
			const canonical = policyV1CanonicalBytes();
			const altered = canonical.replace(
				'  "revision": 1,\n',
				'  "revision": 1,\n  "revision": 1,\n',
			);
			writeFileSync(policyPath(root), altered);
			git(root, ["add", "docs/plans/managed-task-routing-policy.json"]);
			const projection = inspectRoutingPolicy(root);
			expect(projection.policy_status).toBe("invalid");
			expect(projection.reason_code).toBe("policy_duplicate_key");
		});
	});

	it("fails closed on unsupported values", () => {
		withRepo((root) => {
			const altered = policyV1CanonicalBytes().replace(
				'"new_task_route": "kernel_task_intent"',
				'"new_task_route": "v3"',
			);
			writeFileSync(policyPath(root), altered);
			git(root, ["add", "docs/plans/managed-task-routing-policy.json"]);
			const projection = inspectRoutingPolicy(root);
			expect(projection.policy_status).toBe("invalid");
			expect(projection.reason_code).toBe("policy_unsupported_value");
		});
	});

	it("fails closed on non-canonical serialization", () => {
		withRepo((root) => {
			const parsed = JSON.parse(policyV1CanonicalBytes());
			const reordered = JSON.stringify(
				{
					terminal_import: parsed.terminal_import,
					contract: parsed.contract,
					revision: parsed.revision,
					new_task_route: parsed.new_task_route,
					v3_new_plan_sync: parsed.v3_new_plan_sync,
					legacy_v3_mode: parsed.legacy_v3_mode,
				},
				null,
				2,
			) + "\n";
			writeFileSync(policyPath(root), reordered);
			git(root, ["add", "docs/plans/managed-task-routing-policy.json"]);
			const projection = inspectRoutingPolicy(root);
			expect(projection.policy_status).toBe("invalid");
			expect(projection.reason_code).toBe("policy_non_canonical_bytes");
		});
	});

	it("fails closed on symlinked policy", () => {
		withRepo((root) => {
			const target = join(root, "docs", "plans", "real-policy.json");
			writeFileSync(target, policyV1CanonicalBytes());
			git(root, ["add", "docs/plans/real-policy.json"]);
			symlinkSync(target, policyPath(root));
			const projection = inspectRoutingPolicy(root);
			expect(projection.policy_status).toBe("invalid");
			expect(projection.reason_code).toBe("policy_symlink");
		});
	});

	it("fails closed on oversized policy", () => {
		withRepo((root) => {
			const padded =
				policyV1CanonicalBytes() + " ".repeat(4096);
			writeFileSync(policyPath(root), padded);
			git(root, ["add", "docs/plans/managed-task-routing-policy.json"]);
			const projection = inspectRoutingPolicy(root);
			expect(projection.policy_status).toBe("invalid");
			expect(projection.reason_code).toBe("policy_oversize");
		});
	});

	it("fails closed on read-time replacement", () => {
		withRepo((root) => {
			writeFileSync(policyPath(root), policyV1CanonicalBytes());
			git(root, ["add", "docs/plans/managed-task-routing-policy.json"]);
			setRoutingPolicyReaderTestHook({
				onBeforeDescriptorRead: () => {
					writeFileSync(
						policyPath(root),
						policyV1CanonicalBytes().replace(
							'"revision": 1',
							'"revision": 2',
						),
					);
				},
			});
			const projection = inspectRoutingPolicy(root);
			expect(projection.policy_status).toBe("invalid");
			expect(projection.reason_code).toBe("policy_read_drift");
		});
	});

	it("does not create or mutate any project file", () => {
		withRepo((root) => {
			const before = git(root, ["status", "--porcelain"]).length;
			expect(before).toBe(0);
			inspectRoutingPolicy(root);
			expect(git(root, ["status", "--porcelain"]).length).toBe(0);
			expect(existsSync(join(root, ".imm"))).toBe(false);
		});
	});
});

function git(root: string, args: string[]): string {
	const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(result.stderr || `git ${args.join(" ")} failed`);
	}
	return result.stdout;
}
