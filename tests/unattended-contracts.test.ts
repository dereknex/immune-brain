import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Contract-text conformance for the unattended batch run.
 *
 * Every sentence these documents add about batched execution must be true of the
 * shipped code, so this suite reads both the text and the implementation. A prose
 * claim with no matching code fact fails here, and a shipped restriction that the
 * text does not state fails too.
 */

const REPO_ROOT = resolve(import.meta.dir, "..");

function read(rel: string): string {
	return readFileSync(resolve(REPO_ROOT, rel), "utf8");
}

const LOOP_CONTRACT = read("plugins/immune-brain/dist/imm-loop.md");
const LOOP_LOADER = read("plugins/immune-brain/skills/imm-loop/SKILL.md");
const CONSTITUTION = read("IMMUNE.md");
const CONTEXT = read("CONTEXT.md");
const ADR = read("docs/adr/0005-unattended-initiative-batch-run.md");

const BATCH_TOOL = "start_unattended_batch";

/** Prose assertions must survive line wrapping, so compare collapsed whitespace. */
function normalized(text: string): string {
	return text.replace(/\s+/g, " ");
}

function section(document: string, heading: string): string {
	const start = document.indexOf(heading);
	expect(start).toBeGreaterThanOrEqual(0);
	const rest = document.slice(start + heading.length);
	const next = rest.search(/\n## /);
	return next === -1 ? rest : rest.slice(0, next);
}

describe("unattended batch contract text", () => {
	it("documents the opt-in entry, the single parameter, and the unchanged default", () => {
		const optIn = section(LOOP_CONTRACT, "## Unattended Batch Opt-In");
		expect(optIn).toContain(BATCH_TOOL);
		expect(optIn).toContain("`initiative_slug`");
		// The loader must route to the section, or the contract is unreachable.
		expect(LOOP_LOADER).toContain("dist/imm-loop.md#unattended-batch-opt-in");

		// The opt-in tool and its single parameter are shipped facts, not prose.
		const claudeServer = read("plugins/immune-brain/runtime/claude/mcp_server.ts");
		expect(claudeServer).toContain(`name: "${BATCH_TOOL}"`);
		expect(claudeServer).toContain("initiative_slug");

		const piExtension = read("plugins/immune-brain/.pi-extension/imm-unattended-batch.ts");
		expect(piExtension).toContain(`name: "${BATCH_TOOL}"`);
		expect(piExtension).toContain("initiative_slug: Type.String");
	});

	it("states the restrictions the runner actually enforces", () => {
		const optIn = section(LOOP_CONTRACT, "## Unattended Batch Opt-In");
		for (const claim of ["never pushes a ref", "pull request", "user decision", "Git worktree"]) {
			expect(optIn).toContain(claim);
		}
		expect(optIn).toContain("`critical`");

		// Shipped restriction: no push, no PR, no worktree mutation anywhere in the runner.
		const runnerSources = [
			read("plugins/immune-brain/runtime/unattended/batch_git.ts"),
			read("plugins/immune-brain/runtime/unattended/batch_runner.ts"),
			read("plugins/immune-brain/runtime/unattended/batch_plan.ts"),
			read("plugins/immune-brain/runtime/unattended/batch_state.ts"),
		].join("\n");
		const gitMutations = runnerSources
			.split("\n")
			.filter((line) => !line.trimStart().startsWith("//"))
			.filter((line) => /\bgit\b/.test(line) || /["'](push|worktree)["']/.test(line));
		expect(gitMutations.filter((line) => /"push"|"worktree"|'push'|'worktree'/.test(line))).toEqual([]);

		// Shipped restriction: a `critical` child is never enrollable.
		const plan = read("plugins/immune-brain/runtime/unattended/batch_plan.ts");
		expect(plan).toContain('read.intent.risk === "critical" ? "needs_human" : "enrollable"');
		expect(plan).toContain('read.intent.risk === "critical" ? "critical" : null');
	});

	it("amends the constitution, vocabulary, and Architecture Map ownership boundary", () => {
		// The constitution states the Batch Authorization boundary without a new tier.
		expect(CONSTITUTION).toContain("Batch Authorization");
		expect(CONSTITUTION).toContain(BATCH_TOOL);
		expect(CONSTITUTION).toMatch(/不得替用户确认批次|Batch Authorization 只是这次 Enrollment 的覆盖范围/);

		// Vocabulary carries the canonical terms.
		for (const term of [
			"**Batch Authorization**",
			"**Batch Plan**",
			"**Plan Digest**",
			"**Batch Branch**",
			"**HEAD Lineage**",
		]) {
			expect(CONTEXT).toContain(term);
		}

		// Architecture Map names the sole owners of batch transitions.
		expect(CONTEXT).toContain("- Batch execution: `plugins/immune-brain/runtime/unattended/`");
		expect(CONTEXT).toContain("`plugins/immune-brain/runtime/kernel/batch_authority.ts` alone own every batch state transition");

		// The named owners exist, and no host adapter appears in that ownership list.
		expect(existsSync(resolve(REPO_ROOT, "plugins/immune-brain/runtime/unattended"))).toBe(true);
		expect(existsSync(resolve(REPO_ROOT, "plugins/immune-brain/runtime/kernel/batch_authority.ts"))).toBe(true);
	});

	it("records the reopened decision, the TaskRecord v4 evidence, and the deferred items", () => {
		expect(ADR).toContain("status: accepted");
		expect(ADR).toContain("reopened");
		expect(ADR).toContain("TaskRecord v4");
		for (const deferred of ["cron", "CI", "worktree"]) expect(ADR).toContain(deferred);
		expect(ADR).toContain("critical");
	});

	it("keeps default imm-loop behavior byte-identical when the batch tool is not invoked", () => {
		// The opt-in path is a Tool registration; the loop contract's execution
		// sequence must not make a batch step mandatory or implicit.
		expect(LOOP_CONTRACT).not.toContain("start_unattended_batch` automatically");
		expect(LOOP_CONTRACT).not.toMatch(/imm-loop must start a batch|先调用 start_unattended_batch/i);

		// The shipped entry requires a literal-user confirmation; a non-interactive
		// invocation is refused, so the opt-in cannot happen implicitly.
		const piExtension = read("plugins/immune-brain/.pi-extension/imm-unattended-batch.ts");
		expect(piExtension).toContain("unsupported_host");
		expect(piExtension).toContain('reason: "native confirmation port is unavailable"');

		// The opt-in never runs on its own: nothing in the shipped extension starts
		// a batch outside the registered Tool.
		const piToolRegistrations = piExtension.match(/registerTool\(/g) ?? [];
		expect(piToolRegistrations.length).toBe(1);
	});

	it("declares no batch authority tier beyond the Enrolled TaskIntent", () => {
		// The ADR must name the rejected alternative explicitly rather than leave it
		// to inference, and must state the negative in its decision.
		expect(ADR).toContain("## Rejected Alternatives");
		expect(section(ADR, "## Rejected Alternatives")).toContain("batch-scoped authority record");
		expect(normalized(ADR)).toContain("No batch-scoped *authority* record, ledger, or second settlement state machine is introduced");
		// The decision states one Enrollment act per batch, not a new tier above it.
		expect(normalized(ADR)).toContain("not a new authority tier");

		// The Batch Authorization section in the constitution sits under the
		// existing Enrollment gate rather than creating a new one.
		expect(CONSTITUTION).toContain("Batch Authorization 不新增 authority 层级");
	});

	it("separates the batch execution record from authority, matching the shipped runtime", () => {
		// The ADR must not deny the orchestration record the runner actually writes.
		expect(normalized(ADR)).toContain("Orchestration state is separate from authority");
		expect(normalized(ADR)).toContain(".imm/state/batches/<batch_id>.json");
		expect(normalized(ADR)).toContain("That record owns batch progress only");
		expect(normalized(ADR)).not.toMatch(/No batch-scoped record, ledger/);

		// Shipped fact 1: the execution record exists with that contract and path.
		const batchState = read("plugins/immune-brain/runtime/unattended/batch_state.ts");
		expect(batchState).toContain('contract: "assurance_kernel/batch_run_state/v1"');
		expect(batchState).toContain('export interface BatchRunStateRecord');
		expect(batchState).toContain(".imm/state/batches/");

		// Shipped fact 2: every declared field describes orchestration only. Authority
		// stays per child in the Kernel TaskRecord, which is what makes the ADR true.
		const recordBody = batchState.slice(
			batchState.indexOf("export interface BatchRunStateRecord"),
			batchState.indexOf("const BATCH_ID_PATTERN"),
		);
		const declaredFields = (recordBody
			.split("\n")
			.filter((line) => !line.trimStart().startsWith("*") && !line.trimStart().startsWith("/**") && !line.trimStart().startsWith("//"))
			.join("\n")
			.match(/^\s*([a-z_]+)\??:/gm) ?? []
		).map((line) => line.trim().replace(/\??:$/, ""));
		expect(declaredFields).toEqual([
			"contract",
			"batch_id",
			"initiative_slug",
			"plan_digest",
			"base_head",
			"branch",
			"confirmation_time",
			"authorization_expires_at",
			"budget",
			"max_children",
			"deadline_at",
			"qa_failure_limit",
			"batch_state",
			"children",
			"consecutive_qa_failures",
			"commits",
			"created_at",
			"updated_at",
		]);
	});

	it("keeps the edited suites free of skipped, focused, or vacuous tests", () => {
		// "no previously passing test disabled, skipped, or weakened" is the part of
		// the regression clause a bounded descriptor can bind: the suites this task
		// edited must carry real assertions and no skip/only/todo markers.
		const editedSuites = [
			"tests/unattended-contracts.test.ts",
			"tests/dist-docs-sync-contract.test.ts",
			"tests/claude-host-package.test.ts",
		];
		for (const suite of editedSuites) {
			const source = read(suite);
			expect({ suite, markers: source.match(/\b(it|test|describe)\.(skip|only|todo)\b/g) }).toEqual({ suite, markers: null });
			expect((source.match(/expect\(/g) ?? []).length).toBeGreaterThan(0);
			expect((source.match(/\b(it|test)\(/g) ?? []).length).toBeGreaterThan(0);
		}
	});

	it("ships no Git worktree command in the batch runtime", () => {
		const tracked = execFileSync("git", ["ls-files", "plugins/immune-brain/runtime/unattended"], {
			cwd: REPO_ROOT,
			encoding: "utf8",
		})
			.split("\n")
			.filter(Boolean);
		expect(tracked.length).toBeGreaterThan(0);
		for (const path of tracked) {
			const content = read(path)
				.split("\n")
				.filter((line) => !line.trimStart().startsWith("//"))
				.join("\n");
			expect(content).not.toMatch(/["']worktree["']|git", \["worktree/);
		}
	});
});
