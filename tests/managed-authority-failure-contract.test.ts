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
			"invoke the Kernel stop operation through the invoking Host directly",
		);
		expect(loop).toContain("Cancellation is not task termination");
		expect(loop).toContain("An unresolved decision pauses only dependent execution");
		expect(loop).toContain("invoke `request_authorization` directly before ending the turn");
		expect(loop).not.toContain("Stop on terminal `done` or `stopped`, unresolved user decisions");
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
		expect(planner).toContain("except a Loop-requested revision follows Enrolled Intent Revision");
		expect(planner).toContain("Planner prepares the complete proposed revision");
		expect(planner).toContain("Return the proposal to the current Loop owner");
		expect(loop).toContain("Planner prepares the complete proposed revision without replacing the active owner");
	});

	test("Planner and Loop own exact delivery preparation without widening Git authority", () => {
		const baseline = read("plugins/immune-brain/BASELINE.md").replace(/\s+/g, " ");
		const loop = read("plugins/immune-brain/dist/imm-loop.md").replace(/\s+/g, " ");
		const planner = read("plugins/immune-brain/dist/imm-planner.md").replace(/\s+/g, " ");
		expect(baseline).toContain("This staging authority does not grant commit, push, broad staging, or authority over pre-existing user changes");
		expect(loop).toContain("Before `advance_assurance`, inspect ownership and stage only the exact task-owned paths needed for delivery");
		expect(loop).toContain("Do not hand routine task-owned staging to the user");
		expect(planner).toContain("stage only the exact Planner-produced Spec and TaskIntent paths before validation and handoff");
		expect(planner).toContain("whether its executable is provided by the QA host or by tracked delivery content");
		expect(planner).toContain("A dependency found only in the Planner's live worktree");
		expect(planner).toContain("only a completed deterministic QA result proves that a descriptor executed and passed");
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

	test("a post-settlement tracker failure is not a managed authority failure", () => {
		// The tracker is transport: its failure block is a tracker result carried
		// beside the authoritative settlement, never a Managed authority failure
		// kind, and never advice to repeat a Kernel mutation.
		const contract = read("plugins/immune-brain/runtime/assurance/coordinator.ts");
		expect(contract).toContain("tracker observation failed after authoritative settlement");
		expect(contract).not.toMatch(/tracker[^\n]*authority_kind/);
		// The contract the agent actually reads states the separation, and no
		// contract turns a tracker failure into a blocker or into advice to repeat
		// the settling mutation.
		expect(read("plugins/immune-brain/dist/imm-loop.md")).toContain("distinct from the post-settlement tracker");
		for (const path of CONTRACTS) {
			expect({ path, repeats: /tracker[^\n]{0,80}(retry the (mutation|settlement)|is a blocker)/i.test(read(path)) }).toEqual({
				path,
				repeats: false,
			});
		}
	});

});
