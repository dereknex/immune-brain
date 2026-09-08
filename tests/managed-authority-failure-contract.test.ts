import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const CONTRACTS = [
	"plugins/immune-brain/skills/imm-brainstorm/SKILL.md",
	"plugins/immune-brain/skills/imm-planner/SKILL.md",
	"plugins/immune-brain/skills/imm-loop/SKILL.md",
	"plugins/immune-brain/dist/imm-brainstorm.md",
	"plugins/immune-brain/dist/imm-planner.md",
	"plugins/immune-brain/dist/imm-loop.md",
	"plugins/immune-brain/BASELINE.md",
	"plugins/immune-brain/dist/BASELINE.md",
];

const FORBIDDEN_FALLBACKS = [
	"fallback to Pi",
	"switch to Pi",
	"continue through Direct Path",
	"use Direct Path instead",
	"enroll from another worktree",
	"continue as unmanaged implementation",
];

describe("Managed native authority failure contract", () => {
	test("all Managed contracts retain the current Host authority boundary", () => {
		for (const path of CONTRACTS) {
			const contract = read(path).replace(/\s+/g, " ");
			expect(contract, path).toMatch(/current[- ]Host|current host/i);
		}
	});

	test("canonical contracts fail closed without cross-boundary fallback advice", () => {
		const canonical = CONTRACTS.map(read).join("\n").replace(/\s+/g, " ");
		expect(canonical).toContain("exactly one same-Host recovery action");
		expect(canonical).toContain("Never recommend another Host, worktree, Direct Path, unmanaged implementation, or automatic retry");
		for (const fallback of FORBIDDEN_FALLBACKS) expect(canonical).not.toContain(fallback);
	});

	test("retired Pi-only Enrollment wording stays absent", () => {
		const canonical = CONTRACTS.map(read).join("\n");
		expect(canonical).not.toContain("Planner's final `ctx.ui.custom` gate");
		expect(canonical).not.toContain("Pi host identity is implicit");
		expect(canonical).not.toContain("Enrollment remains a native TUI gate");
	});

	test("carrier prerequisite covers only identified GitHub-carried Initiatives", () => {
		const loop = read("plugins/immune-brain/dist/imm-loop.md").replace(/\s+/g, " ");
		expect(loop).toContain(
			"only when the candidate belongs to an identified GitHub-carried Initiative",
		);
		expect(loop).toContain(
			"Standalone TaskIntents and Local Initiatives carry no tracker prerequisite",
		);
		expect(loop).toContain(
			"resolve it against the Planner's carrier decision before treating the candidate as exempt",
		);
		expect(loop).toContain(
			"blocks that Enrollment until the same complete carrier batch succeeds",
		);
	});

	test("awaiting-user handling keeps one unambiguous owner and outcome", () => {
		const loop = read("plugins/immune-brain/dist/imm-loop.md").replace(/\s+/g, " ");
		expect(loop).toContain(
			"On `awaiting_user`, invoke `request_authorization` directly",
		);
		expect(loop).toContain(
			"invoke `imm_kernel_canary({ task_id, action: { op: \"request_stop\" } })` directly",
		);
		expect(loop).toContain("Cancellation is not task termination");
	});

	test("revision preparation preserves enrolled sidecars until Kernel applies it", () => {
		const loop = read("plugins/immune-brain/dist/imm-loop.md").replace(/\s+/g, " ");
		const planner = read("plugins/immune-brain/dist/imm-planner.md").replace(/\s+/g, " ");
		expect(loop).toContain(
			"Do not overwrite enrolled intent sidecars or ask for chat pre-confirmation",
		);
		expect(planner).toContain(
			"Preserve the prior on-disk sidecars until Kernel applies the revision",
		);
	});

	test("advisory scheduling distinguishes eligibility from the one-foreground-child limit", () => {
		const baseline = read("plugins/immune-brain/BASELINE.md").replace(/\s+/g, " ");
		const protocol = read("docs/reference/subagent-dispatch-protocol.md").replace(/\s+/g, " ");
		expect(baseline).toContain(
			"Pi schedules one foreground child at a time",
		);
		expect(protocol).toContain(
			"Read-only eligibility 与 Pi 的 one-foreground-child 调度限制是两回事",
		);
		expect(protocol).toContain("不得把多个 foreground Agent 假定为并发 batch");
	});
});
