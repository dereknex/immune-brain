// P3 U2: imm-planner Kernel TaskIntent contract. The Planner skill must teach
// deterministic routing from the host-neutral routing-status projection and
// must never write the TaskIntent artifact directly.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectRoutingPolicy, policyV1CanonicalBytes } from "../plugins/immune-brain/runtime/managed_task_routing_policy";

const REPO_ROOT = join(__dirname, "..");

const DIST_PATH = join(
	REPO_ROOT,
	"plugins/immune-brain/dist/imm-planner.md",
);
const PLANNER_CONTRACTS = [DIST_PATH];

describe("imm-planner kernel intent contract", () => {
	test("Planner resolves packaged wrappers without assuming shell PATH", () => {
		for (const path of PLANNER_CONTRACTS) {
			const contract = readFileSync(path, "utf8").replace(/\s+/g, " ");
			expect(contract).toContain("declared Skill location");
			expect(contract).toContain("../../bin/imm-plan");
			expect(contract).toContain("../../bin/imm-kernel");
			expect(contract).toContain(
				"Do not assume either bare command is available on shell `PATH`",
			);
		}
	});

	test("Planner keeps workflow facts on Kernel authority sources", () => {
		for (const path of PLANNER_CONTRACTS) {
			const contract = readFileSync(path, "utf8").replace(/\s+/g, " ");
			expect(contract).toContain("Assurance projection and TaskRecord");
			expect(contract).toContain(
				"non-authoritative vocabulary and architecture navigation",
			);
			expect(contract).toContain("report stale documentation");
			expect(contract).toContain("preserve projection-based routing");
			expect(contract).toContain("do not automatically synchronize");
		}
	});

	test("canonical contract teaches routing-status-first deterministic routing", () => {
		const skill = readFileSync(DIST_PATH, "utf8");
		expect(skill).toContain("imm-plan --routing-status --json");
		expect(skill).toContain("kernel_task_intent");
		expect(skill).toContain("routing_policy_invalid");
		expect(skill).toContain("imm-loop");
		expect(skill).not.toContain("imm-canary-work");
		expect(skill).not.toContain("no Planner path enrolls a task");
		expect(skill).not.toContain("it never enrolls a task");
		expect(skill).toContain("Planner may request the native Enrollment gate");
		expect(skill).toContain("only that gate grants execution authority");
	});

	test("Planner activates only an absent policy before authoring without another approval", () => {
		const contract = readFileSync(DIST_PATH, "utf8").replace(/\s+/g, " ");
		expect(contract).toContain("including for plan-only requests");
		expect(contract).toContain("policy_status: legacy_v3");
		expect(contract).toContain("ownership: absent");
		expect(contract).toContain("neither Kernel nor nonterminal v3 ownership exists");
		expect(contract).toContain("without a separate enablement question");
		expect(contract).toContain("fail if it already exists");
		expect(contract).toContain("git add -- docs/plans/managed-task-routing-policy.json");
		expect(contract).toContain("An already active policy needs no write or staging");
		expect(contract).toContain("preserve it and report `routing_policy_invalid`");
		expect(contract).toContain("stop before authoring");
		expect(contract).not.toContain("no routing policy preserves the legacy v3 Planner behavior");
	});

	test("documented policy activates in an unborn Git repository without staging unrelated work", () => {
		const skill = readFileSync(DIST_PATH, "utf8");
		const bytes = skill.match(/```json\n([\s\S]*?)```/)?.[1];
		expect(bytes).toBe(policyV1CanonicalBytes());
		const root = mkdtempSync(join(tmpdir(), "imm-planner-activation-"));
		const git = (...args: string[]) => {
			const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
			expect(result.status).toBe(0);
			return result.stdout;
		};
		try {
			git("init", "-q");
			writeFileSync(join(root, "staged.txt"), "original\n");
			git("add", "staged.txt");
			writeFileSync(join(root, "staged.txt"), "local edit\n");
			writeFileSync(join(root, "untracked.txt"), "user draft\n");
			expect(inspectRoutingPolicy(root).ownership).toBe("absent");
			mkdirSync(join(root, "docs/plans"), { recursive: true });
			writeFileSync(join(root, "docs/plans/managed-task-routing-policy.json"), bytes!, { flag: "wx" });
			git("add", "--", "docs/plans/managed-task-routing-policy.json");
			expect(inspectRoutingPolicy(root)).toMatchObject({
				policy_status: "active", route: "kernel_task_intent", ownership: "tracked_clean",
			});
			expect(git("show", ":staged.txt")).toBe("original\n");
			expect(readFileSync(join(root, "staged.txt"), "utf8")).toBe("local edit\n");
			expect(git("ls-files", "untracked.txt")).toBe("");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("canonical contract forbids direct artifact writes and names the canonical author command", () => {
		const skill = readFileSync(DIST_PATH, "utf8");
		expect(skill).toContain("never writes");
		expect(skill).toContain("docs/plans/<task-id>.intent.json");
		expect(skill).toContain("imm-kernel intent author");
		expect(skill).toContain("--stdin --json");
		expect(skill).toContain("imm-kernel intent validate");
		expect(skill).toContain("revise_intent");
	});

	test("Planner keeps Enrollment authority on the current Host native gate", () => {
		const skill = readFileSync(DIST_PATH, "utf8");
		expect(skill).toContain("current Host's native Enrollment Tool");
		expect(skill).toContain("literal-user confirmation");
		expect(skill).not.toContain("/imm-canary-new");
		expect(skill).not.toContain("/imm-canary-enroll");
		expect(skill).not.toContain("Pi host identity is implicit");
		expect(skill).toContain("production boundary");
		expect(skill).not.toContain("Other hosts");
	});

	test("Planner distinguishes simple TaskIntent-only work from a complex Spec binding", () => {
		const skill = readFileSync(DIST_PATH, "utf8");
		expect(skill).toContain("Simple tasks are TaskIntent-only");
		expect(skill).toContain("Add a Spec only for complex work");
		expect(skill).toContain("simple TaskIntent-only work records them in `scope_hint`");
		expect(skill).toContain("otherwise on the TaskIntent");
		expect(skill).not.toContain("Record every upstream `BR-*` item in a Spec `Brainstorm Trace`, mapped to TaskIntent acceptance");
		expect(skill).not.toContain("Record `test-first` or `characterization-first` in the Spec when explicitly requested");
		expect(skill).not.toContain("A Brainstorm manifest lacks a complete Spec `Brainstorm Trace`.");
		expect(skill).toContain("immutable content identity");
		expect(skill).not.toContain("Include bound active and archive Spec paths needed for artifact freeze");
		expect(skill).toContain("do not relocate artifacts");
		expect(skill).toContain("current Host's native Enrollment Tool");
	});

	test("Planner opens one native Enrollment gate without chat pre-confirmation", () => {
		for (const path of PLANNER_CONTRACTS) {
			const contract = readFileSync(path, "utf8").replace(/\s+/g, " ");
			expect(contract).toContain("Explicit Plan-only requests stop");
			expect(contract).toContain("non-authoritative execution trigger");
			expect(contract).toContain("clear mutation request that already includes execution");
			expect(contract).toContain("without asking for chat pre-confirmation");
			expect(contract).toContain("Literal-user confirmation in the current Host's native gate remains the authority boundary");
		}
	});

	test("dist mirror carries the same contract", () => {
		const dist = readFileSync(DIST_PATH, "utf8");
		expect(dist).toContain("imm-plan --routing-status --json");
		expect(dist).toContain("imm-kernel intent author");
		expect(dist).toContain("current Host's native Enrollment Tool");
		expect(dist).not.toContain("/imm-canary-new");
		expect(dist).not.toContain("/imm-canary-enroll");
		expect(dist).toContain("routing_policy_invalid");
	});
});
