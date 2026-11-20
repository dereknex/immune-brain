import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	buildLoopAction,
	buildLoopRoleDispatch,
	resolveLoopRoute,
} from "../plugins/immune-brain/runtime/loop_contract";
import {
	INTERNAL_ROLE_PROMPTS,
	loadRolePrompt,
	type InternalRole,
} from "../plugins/immune-brain/runtime/role_prompt_bridge";
import { ROLE_PROMPT_FILES } from "../scripts/dist-sync-manifest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROLES: InternalRole[] = [
	"qa",
	"code-review",
	"review-verifier",
	"ui-review",
	"executor",
	"test-fixer",
	"pr-fix",
	"arch-explorer",
	"advisory-reviewer",
	"compounder",
	"lane-steward",
];

function read(path: string): string {
	return readFileSync(resolve(ROOT, path), "utf8");
}

describe("internal role-prompt bridge", () => {
	it("keeps canonical and packaged prompt bytes identical for every Loop role", () => {
		expect([...ROLE_PROMPT_FILES]).toEqual(ROLES.map((role) => `${role}.md`));
		for (const role of ROLES) {
			const source = read(`plugins/immune-brain/runtime/prompts/${role}.md`);
			const packaged = read(`plugins/immune-brain/dist/role-prompts/${role}.md`);
			expect(packaged).toBe(source);
			expect(INTERNAL_ROLE_PROMPTS[role].file).toBe(`${role}.md`);
		}
	});

	it("loads a packaged role contract without discovering a public Skill", () => {
		for (const role of ROLES) {
			const prompt = loadRolePrompt(role);
			expect(prompt.toLowerCase()).toContain(`internal role: ${role}`);
			expect(prompt).not.toContain("skills/");
		}
	});

	it("routes exploration and advisory review through the internal role contract", () => {
		expect(
			resolveLoopRoute({
				ownership: "brainstorm",
				target: "architecture-exploration",
			}),
		).toEqual({ entry: "drive", next: "arch-explorer" });
		const archAction = buildLoopAction({
			ownership: "brainstorm",
			target: "architecture-exploration",
			context: { task_id: "task-7", focus_delta: { directories: ["plugins/"] } },
		});
		expect(archAction.next).toBe("arch-explorer");
		if (archAction.next === "arch-explorer") {
			expect(archAction.dispatch.packet.tool_policy).toBe("read-only tools");
			expect(archAction.dispatch.call.subagent_type).toBe("Explore");
		}

		const advisoryAction = buildLoopAction({
			ownership: "planner",
			target: "advisory-review",
			context: { task_id: "task-7", lens: "reliability" },
		});
		expect(advisoryAction.next).toBe("advisory-reviewer");
		if (advisoryAction.next === "advisory-reviewer") {
			expect(advisoryAction.dispatch.packet.tool_policy).toBe("no tools");
			expect(advisoryAction.dispatch.packet.prompt).toContain('"lens": "reliability"');
		}
		expect(() =>
			buildLoopAction({
				ownership: "planner",
				target: "advisory-review",
				context: { task_id: "task-7" },
			}),
		).toThrow("explicit lens");
	});

	it("dispatches Compounder only for closed Steps with reusable Learning evidence", () => {
		const context = {
			task_id: "task-7",
			workflow_phase: "complete" as const,
			assurance_complete: true,
			required_reviews_complete: true,
			closed_steps: [
				{
					step_id: "step-1",
					state: "closed",
					learning_evidence: {
						reusable: true,
						summary: "The role bridge keeps package prompts deterministic.",
						evidence_ref: "test:role-prompt-bridge",
					},
				},
			],
		};
		const action = buildLoopAction({
			ownership: "loop",
			target: "compounder",
			context,
		});
		expect(action.next).toBe("compounder");
		if (action.next === "compounder") {
			expect(action.dispatch.packet.role).toBe("compounder");
		}

		expect(
			buildLoopAction({
				ownership: "loop",
				target: "compounder",
				context: {
					task_id: "routine-no-learning",
					workflow_phase: "complete",
					assurance_complete: true,
					required_reviews_complete: true,
					closed_steps: [],
				},
			}),
		).toEqual({
			entry: "drive",
			next: "none",
			reason: "no_reusable_learning",
		});

		expect(
			buildLoopAction({
				ownership: "loop",
				target: "compounder",
				context: {
					task_id: "still-working",
					workflow_phase: "working",
					assurance_complete: true,
					required_reviews_complete: true,
					closed_steps: context.closed_steps,
				},
			}),
		).toEqual({
			entry: "drive",
			next: "none",
			reason: "no_reusable_learning",
		});
	});

	it("injects deterministic Parent context and preserves stable Review Gate identifiers", () => {
		const code = buildLoopRoleDispatch({
			role: "code-review",
			context: {
				task_id: "task-5",
				target_id: "step-1",
				changed_files_signature: "sha256:files",
			},
		}).packet;
		const ui = buildLoopRoleDispatch({
			role: "ui-review",
			context: {
				task_id: "task-5",
				target_id: "step-1",
				review_gate: "imm-ui-review",
				changed_files_signature: "sha256:files",
			},
		}).packet;
		const qa = buildLoopRoleDispatch({
			role: "qa",
			context: { task_id: "task-5", target_id: "step-1" },
		}).packet;

		expect(code.review_gate).toBe("imm-code-review");
		expect(ui.review_gate).toBe("imm-ui-review");
		expect(qa.review_gate).toBeUndefined();
		expect(code.prompt).toContain('"task_id": "task-5"');
		expect(code.tool_policy).toBe("read-only tools");
		expect(code.prompt).toContain("tool_policy: read-only tools");
		expect(code.prompt).toContain("do not discover or load Pi Skills");
		expect(code.prompt_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
	});

	it("injects the interaction language convention only when provided", () => {
		const plain = buildLoopRoleDispatch({
			role: "code-review",
			context: { task_id: "task-5", review_gate: "imm-code-review" },
		}).packet;
		expect(plain.prompt).not.toContain("interaction language:");

		const localized = buildLoopRoleDispatch({
			role: "code-review",
			context: {
				task_id: "task-5",
				review_gate: "imm-code-review",
				interaction_language: "中文",
			},
		}).packet;
		expect(localized.prompt).toContain("interaction language: 中文");
		expect(localized.prompt).toContain("keep machine contracts");
		expect(localized.prompt_digest).not.toBe(plain.prompt_digest);

		const blank = buildLoopRoleDispatch({
			role: "code-review",
			context: {
				task_id: "task-5",
				review_gate: "imm-code-review",
				interaction_language: "  ",
			},
		}).packet;
		expect(blank.prompt).not.toContain("interaction language:");
	});

	it("rejects a Review packet with a mismatched stable gate", () => {
		expect(() =>
			buildLoopRoleDispatch({
				role: "code-review",
				context: { task_id: "task-5", review_gate: "imm-ui-review" },
			}),
		).toThrow("review gate imm-ui-review does not match code-review");
	});

	it("builds foreground Agent calls for every internal Loop role", () => {
		for (const role of ROLES) {
			const dispatch = buildLoopRoleDispatch({
				role,
				context: { task_id: "task-5", target_id: "step-1" },
			});
			expect(dispatch.call.prompt).toBe(dispatch.packet.prompt);
			expect(dispatch.call.run_in_background).toBe(false);
			expect(dispatch.call.inherit_context).toBe(false);
			expect(dispatch.call.isolated).toBe(true);
			expect(dispatch.call).not.toHaveProperty("isolation");
		}
	});
	it("supersedes the standalone explorer decision with the internal routing ADR", () => {
		const retired = read("docs/adr/0001-dedicated-architecture-explorer-skill.md");
		expect(retired).toContain("status: superseded");
		expect(retired).toContain("superseded_by: docs/adr/0003-internal-role-prompt-routing.md");
		const current = read("docs/adr/0003-internal-role-prompt-routing.md");
		expect(current).toContain("read-only `arch-explorer`");
		expect(current).toContain("reusable Learning");
	});

	it("ships the bridge source and packaged prompts", () => {
		const pkg = JSON.parse(read("package.json")) as { files: string[] };
		expect(pkg.files).toContain("plugins/immune-brain/runtime/role_prompt_bridge.ts");
		expect(pkg.files).toContain("plugins/immune-brain/runtime/loop_contract.ts");
		expect(pkg.files).toContain("plugins/immune-brain/runtime/prompts");
		expect(pkg.files).toContain("plugins/immune-brain/dist");
	});
	it("keeps canonical Loop role dispatch on the internal bridge", () => {
		const content = read("plugins/immune-brain/dist/drive.md");
		expect(content.replace(/\s+/g, " ")).toContain("role-boundary route");
		expect(content.replace(/\s+/g, " ")).toContain("standalone `fix-pr`, `prune-docs`, `slim`, and `prune-tests` are host-native");
		expect(content).toContain("never dispatched as the Loop role");
		expect(content).not.toMatch(/public\s+Skills\s+remain available as rollback shims/);
		expect(content).not.toContain("dispatch an isolated read-only `imm-qa`");
	});
	it("loads internal role prompts independently from public Skill entries", () => {
		for (const role of [
			"qa",
			"code-review",
			"ui-review",
			"executor",
			"test-fixer",
			"pr-fix",
			"arch-explorer",
			"advisory-reviewer",
			"compounder",
		]) {
			expect(read(`plugins/immune-brain/runtime/prompts/${role}.md`)).toContain(
				"Internal role",
			);
			if (role !== "pr-fix") {
				expect(existsSync(resolve(ROOT, `plugins/immune-brain/skills/imm-${role}/SKILL.md`))).toBe(false);
			}
		}
		expect(existsSync(resolve(ROOT, "plugins/immune-brain/skills/fix-pr/SKILL.md"))).toBe(true);
	});
	it("keeps Executor Host launch with the runtime, not the Parent or the lane-steward", () => {
		const prompt = read("plugins/immune-brain/runtime/prompts/lane-steward.md").replace(/\s+/g, " ");
		expect(prompt).toContain("Start no Host session, in the Lane or anywhere else");
		expect(prompt).toContain("report every one the prepared Lane can run, not only the Host you are running in");
		expect(prompt).not.toContain("Start exactly one Executor Host");

		const loop = read("plugins/immune-brain/dist/drive-batch.md").replace(/\s+/g, " ");
		for (const fragment of [
			"The runtime owns every Lane session through `runtime/lane_sessions/`; the Parent never launches, polls, closes, or re-attaches a session itself",
			"The runtime opens each Lane session itself through `runtime/lane_sessions/`; the Parent never creates a session.",
			"A subagent that runs inside the Parent's process shares the Parent's root and is never a Lane Executor",
			"The Parent Host and the Executor Host are chosen independently",
			"the Parent substitutes nothing: no detached job, no in-process subagent, no serial in-place work",
			"never from the session's output or exit status",
			"Handles are not authority",
			"its Host session never re-enters the batch",
		]) {
			expect(loop).toContain(fragment);
		}
		// The standing rule the supervision section narrows stays in the main Loop contract.
		expect(read("plugins/immune-brain/dist/drive.md").replace(/\s+/g, " ")).toContain("Do not poll or create detached jobs");
		// Each supported Parent Host names its own waiting mechanism, plus the fallback Host.
		for (const row of ["(Claude Code) runs it as a Host background command, so its return re-invokes the Parent",
			"A Parent Host without that (Pi, whose bash tool is not woken when a background process ends, and any Host not known to re-invoke) runs it in the foreground with `--timeout-ms 600000`"]) expect(loop).toContain(row);
		expect(read("plugins/immune-brain/skills/drive/SKILL.md")).toContain("../../dist/drive-batch.md#lane-executor-supervision");
	});
	// Spec batch-resource-safety-s2 AC4: without trusted Executor exit evidence no contract
	// promises automatic Lane deletion or recreation, and the restoration gate stays recorded.
	it("aligns Lane lifecycle contracts with conservative retention", () => {
		const loop = read("plugins/immune-brain/dist/drive-batch.md").replace(/\s+/g, " ");
		for (const fragment of [
			"only a proven `exited` exit proof bound to `(handle, key)` plus clean-Lane Git checks removes that child's worktree",
			"Any failed proof or Git condition retains the Lane and reports `batch_lane_retained` naming it; parked, stopped and redo Lanes are never removed.",
			"its Lane is neither deleted nor recreated, and no redo grant is spent",
			"the child parks `needs_human` with `batch_lane_redo_retained`",
			// Delivery and cleanup stay apart: a kept Lane is the user's to read and close.
			"Every other tab (a parked, failed, stopped or not yet integrated child's, and any tab the Parent did not create) stays open for the user to read and close.",
		]) expect(loop).toContain(fragment);
		expect(loop).not.toContain("the runtime removes a clean, unoccupied Lane");
		expect(loop).not.toContain("spending one of the child's two redo grants");
		const steward = read("plugins/immune-brain/runtime/prompts/lane-steward.md").replace(/\s+/g, " ");
		expect(steward).toContain("keep them after integration until the user removes them");
		expect(steward).not.toContain("create and remove their own worktrees");
		const adr = read("docs/adr/0027-parent-branch-merge-queue.md").replace(/\s+/g, " ");
		expect(adr).toContain("## Amendment: retained Lanes (batch-resource-safety S2)");
		expect(adr).toContain("There is no time-based relaxation");
		expect(adr).not.toContain("resets it for a redo, and removes it with its branch");
		const context = read("CONTEXT.md").replace(/\s+/g, " ");
		expect(context).toContain("never removes or recreates one without trusted Executor exit evidence");
		// Legacy external-Lane ownership is unchanged.
		expect(context).toContain("legacy records admit offered Lanes and never create, switch or delete them");
		expect(loop).toContain("the Parent removes no Lane and dispatches no one to remove it");
	});
	it("drives Lane Executors through the session port, and never answers their dialogs", () => {
		const loop = read("plugins/immune-brain/dist/drive-batch.md").replace(/\s+/g, " ");
		for (const fragment of [
			// The D20 wake table is the Parent's whole re-entry vocabulary.
			"| Wake | `next_action` | Parent action |",
			"| settlement or idle/done/exited progress | `advance` |",
			"| startup or mid-run dialog (`entry_submitted: false`, `blocked`) | `relay_dialog` |",
			"| `interactive_host` child stalled idle | `ask_user` |",
			"| timeout with nothing pending | `wait` |",
			"| batch terminal | `complete` |",
			"The Parent waits read-only with `imm-session await --batch <batch_id>`",
			"Resolve `../bin/imm-session` from this packaged contract",
			"names it `/immune-brain:drive`",
			"Keep `task_id → handle` from the result; the handle is opaque and is not authority.",
			"The Parent may send one text instruction to a Lane session, and only while it is `idle` or `done` (a finished turn not yet seen) and its child is still running in the Lane",
			"only when accepted does the Parent submit it",
			"The Parent sends that tab no keys and no prompt, and never answers such a dialog for the user.",
			"a relaunch submits the entry again in the same tab instead of creating another",
			// Closing is the runtime's, with proof; the Parent only reports and reads.
			"The runtime closes each integrated child session with proof via `closeWithProof(handle, key)`; the Parent never closes a session",
			"Every other tab (a parked, failed, stopped or not yet integrated child's, and any tab the Parent did not create) stays open for the user to read and close.",
			"Closing a session removes no Lane and no branch beyond the proven per-child cleanup.",
			"The Parent stops no session",
			"the Parent removes no Lane and dispatches no one to remove it",
			"It splits no pane and creates no workspace",
			"The Parent never invokes `herdr` itself, and outside Herdr it never invokes `imm-session`",
			"A `timeout` return is no transition",
			"A wait that returns `exited` means the Host process is gone, never that the child finished.",
			// The tab path changes how a session is obtained, not what counts as progress.
			"never from the session's output or exit status",
		]) {
			expect(loop).toContain(fragment);
		}
		expect(read("plugins/immune-brain/skills/drive/SKILL.md")).toContain("../../dist/drive-batch.md#herdr-lane-tabs");
		// The steward still knows no workspace tool.
		expect(/herdr/i.test(read("plugins/immune-brain/runtime/prompts/lane-steward.md"))).toBe(false);
	});
	it("leaves Lane Preferences to the runtime and launches the frozen Executor profile from the handoff", () => {
		const loop = read("plugins/immune-brain/dist/drive-batch.md").replace(/\s+/g, " ");
		// ADR 0041 / #564: the Parent passes the literal request; the runtime resolves and freezes it.
		for (const fragment of [
			"#### Lane Preferences",
			"the Parent passes it verbatim as `agents: { executor?, reviewer? }` to the first `start_unattended_batch` call",
			"It never passes its own Host or a value it read from the configuration.",
			"It passes `max_parallel` only when the request states one.",
			"a resume keeps them and passes nothing again",
			"Every `executor` handoff carries the frozen Executor profile as `executor: { host, model?, effort? }`",
			"is refused as `lane_config_invalid` and starts no batch",
			"the Parent does not fall back to another one",
			"`claude-code`, `pi` or `antigravity`",
			"from the handoff's `executor.model` and `executor.effort` when present; the Parent never reads them from the configuration itself",
		]) {
			expect(loop).toContain(fragment);
		}
		for (const retired of ["`executor_host`", "imm-kernel config --json", "`not_applied`", "`lanes.active`", "Lane max parallel:", "Lane Executor Host:"])
			expect({ retired, present: loop.includes(retired) }).toEqual({ retired, present: false });
		expect(read("plugins/immune-brain/skills/drive/SKILL.md")).toContain("../../dist/drive-batch.md#lane-preferences");
	});
	it("resolves batch final verification from the request, project, repository prose, then none", () => {
		const loop = read("plugins/immune-brain/dist/drive-batch.md").replace(/\s+/g, " ");
		for (const fragment of [
			"take plain commands without shell syntax or quoting, at most 8, whatever their source",
			"1. commands the current request states literally; else",
			"2. project `batch.final_verification`; else",
			"3. the full test suite and type-check commands the repository instruction file names in prose",
			"4. none, and the completion report says nothing was run.",
			"The Parent never invents a command the repository does not name unless the request or project config supplies it.",
		])
			expect(loop).toContain(fragment);
		expect(loop).not.toContain("Batch final verification");
	});
	it("keeps lane preferences out of tracked instruction files and ignores the preset", () => {
		expect(read(".gitignore").split("\n")).toContain(".imm/lanes.local.json");
		for (const file of ["AGENTS.md", "IMMUNE.md", "README.md", "README.zh-CN.md"]) {
			const content = read(file);
			for (const retired of ["Lane max parallel", "Lane Executor Host:", "Lane Executor model:", "Lane Executor effort:", "Batch final verification"])
				expect({ file, retired, present: content.includes(retired) }).toEqual({ file, retired, present: false });
		}
		expect(read("AGENTS.md")).not.toContain("Initiative carrier default");
		// The project config is local-only: gitignored and untracked, so a fresh
		// clone resolves the carrier from the user config, then asks.
		expect(read(".gitignore").split("\n")).toContain(".imm/config.json");
		expect(spawnSync("git", ["ls-files", "--error-unmatch", ".imm/config.json"], { cwd: ROOT }).status).not.toBe(0);
	});
});
