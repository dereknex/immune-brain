import { describe, expect, it } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import { projectBatchPlan } from "../plugins/immune-brain/runtime/unattended/batch_plan";

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

const GUARD_TASK_ID = "git-guard-fixture";
const GUARD_BATCH_ID = "batch-git-guard";
const GUARD_CHANGED_PATH = "notes.txt";
const GUARD_HEAD = "1".repeat(40);
const GUARD_COMMIT = "2".repeat(40);

/**
 * Terminal audit pair for the fixture task, in the shape a settled child leaves
 * behind. Generated rather than copied so the guard does not depend on some
 * unrelated task's real record staying on disk.
 */
function writeAuditPair(root: string, taskId: string): void {
	const auditDir = join(root, ".imm", "audit", taskId);
	mkdirSync(auditDir, { recursive: true });
	const intent = parseTaskIntentV1({
		contract: "assurance_kernel/task_intent/v1",
		task_id: taskId,
		owner: "user",
		goal: `Goal for ${taskId}`,
		scope_hint: [GUARD_CHANGED_PATH],
		acceptance: [{ id: `acc-${taskId}`, assertion: "assert something", verification: "bun test" }],
		risk: "material",
		revision: 1,
	});
	const intentHash = canonicalIntentHash(intent);
	const recordBytes = `${JSON.stringify(
		{
			contract: "assurance_kernel/task_record/v4",
			task_id: taskId,
			intent_snapshot: intent,
			intent_ref: { path: `docs/plans/archive/${taskId}.intent.json`, content_hash: intentHash },
			lifecycle: "done",
			artifact_state: "frozen",
			baseline: intentHash,
			git_base_head: GUARD_HEAD,
			attestations: [],
			findings: [],
			history: [],
		},
		null,
		2,
	)}\n`;
	writeFileSync(join(auditDir, "task-record.json"), recordBytes);
	writeFileSync(
		join(auditDir, "terminal-proof.json"),
		`${JSON.stringify(
			{
				contract: "assurance_kernel/task_tombstone/v2",
				task_id: taskId,
				lifecycle_status: "terminal",
				terminal_lifecycle: "done",
				terminal_event_id: `evt-${taskId}`,
				final_record_hash: `sha256:${createHash("sha256").update(recordBytes).digest("hex")}`,
				terminalized_at: "2026-01-01T00:00:00.000Z",
			},
			null,
			2,
		)}\n`,
	);
}

/**
 * Install a recording `git` first on PATH. It logs every argument vector it is
 * handed and answers with just enough canned output for the runtime's Git layer
 * to run its real code paths — so the guard asserts over the vectors the runtime
 * produces, catching an invocation assembled through a helper, variable, or
 * template literal, while a legitimate mention of `worktree` in a reason key or
 * a comment no longer fails the suite.
 *
 * The drive runs in a child process: the shim has to be on PATH when that
 * process starts, and mocking `node:child_process` here would leak into every
 * other suite sharing this runner process.
 */
function installRecordingGit(options: {
	binDir: string;
	logPath: string;
	committedMarker: string;
	stagedMarker: string;
	root: string;
}): void {
	const shim = `#!/bin/sh
log="${options.logPath}"
committed="${options.committedMarker}"
staged="${options.stagedMarker}"
printf '%s\\000' "$@" >> "$log"
printf '\\n' >> "$log"

command=""
skip=""
for argument in "$@"; do
  if [ "$skip" = "1" ]; then skip=""; continue; fi
  case "$argument" in
    -C|-c) skip="1"; continue ;;
    -*) continue ;;
  esac
  command="$argument"
  break
done

case "$command" in
  rev-parse)
    case "$*" in
      *--show-toplevel*) printf '%s\\n' "${options.root}" ;;
      *"^@"*) printf '%s\\n' "${GUARD_HEAD}" ;;
      *) if [ -f "$committed" ]; then printf '%s\\n' "${GUARD_COMMIT}"; else printf '%s\\n' "${GUARD_HEAD}"; fi ;;
    esac ;;
  symbolic-ref) printf '%s\\n' "main" ;;
  show-ref) exit 1 ;;
  diff-files) if [ ! -f "$staged" ]; then printf '${GUARD_CHANGED_PATH}\\000'; fi ;;
  ls-files)
    case "$*" in
      *-v*) ;;
      *--others*) if [ ! -f "$staged" ]; then printf '${GUARD_CHANGED_PATH}\\000'; fi ;;
    esac ;;
  add) : > "$staged" ;;
  commit) : > "$committed" ;;
  log) printf '%s\\000%s\\000%s\\000%s\\000%s\\n' "${GUARD_COMMIT}" "${GUARD_BATCH_ID}" "Immune-Brain Batch" "immune-brain@local" "imm(${GUARD_TASK_ID}): recorded" ;;
esac
exit 0
`;
	writeFileSync(join(options.binDir, "git"), shim, { mode: 0o755 });
}

/** The Git subcommand of an argument vector, past any global options. */
function gitSubcommand(invocation: string[]): string {
	for (let index = 0; index < invocation.length; index += 1) {
		const argument = invocation[index] ?? "";
		if (argument === "-C" || argument === "-c") {
			index += 1;
			continue;
		}
		if (argument.startsWith("-")) continue;
		return argument;
	}
	return "";
}

function recordedInvocations(logPath: string): string[][] {
	return readFileSync(logPath, "utf8")
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => line.split("\0").filter((part) => part.length > 0));
}

/**
 * The child-process drive: the Git layer's branch preflight, scope-bounded child
 * commit, and commit lookup, then the runner's persisted-state inspections. Every
 * step asserts the path really ran, so the guard cannot pass by driving nothing.
 */
function driveSource(runtimeDir: string): string {
	const runtimePath = (relativePath: string) => JSON.stringify(join(runtimeDir, relativePath));
	return `import { mkdirSync } from "node:fs";
import { join } from "node:path";
const git = await import(${runtimePath("unattended/batch_git.ts")});
const { createBatchAuthorityRegistry, computeBatchPlanDigest } = await import(${runtimePath("kernel/batch_authority.ts")});
const { prepareBatchRunState, writeBatchRunState } = await import(${runtimePath("unattended/batch_state.ts")});
const { resumeBatch } = await import(${runtimePath("unattended/batch_runner.ts")});

const [root, taskId, batchId, head, commit] = process.argv.slice(2);

const preflight = git.runBatchGitPreflight({ root, initiative_slug: "initiative-slug", base_head: head });
if (!preflight.ok) throw new Error(\`preflight rejected: \${preflight.reason}\`);
const committed = await git.commitBatchChild({ root, taskId, batchId, expectedHead: head });
if (committed.commit !== commit) throw new Error(\`unexpected child commit \${committed.commit}\`);
const adopted = await git.lookupBatchCommit({ root, taskId, batchId, expectedHead: head });
if (!adopted || adopted.commit !== commit) throw new Error("commit lookup did not adopt the child commit");

const farFuture = "2099-01-01T00:00:00.000Z";
const confirmationTime = "2026-01-01T00:00:00.000Z";
const children = [
	{
		task_id: "child-1",
		slice_id: "S1",
		blocked_by: [],
		status: "enrollable",
		reason: null,
		intent_path: "docs/plans/child-1.intent.json",
		intent_revision: 1,
		intent_content_hash: "0".repeat(64),
	},
];
const planDigest = computeBatchPlanDigest(children);
const registry = createBatchAuthorityRegistry();
const budget = { max_children: 1, deadline_at: farFuture, qa_failure_limit: 3 };

/** Persist a batch record, then resume it so the runner inspects Git itself. */
const resumePersisted = async (state, recordCommit) => {
	const id = \`batch-\${state}\`;
	const capability = registry.issue(
		{
			batch_id: id,
			initiative_slug: "initiative-slug",
			plan_digest: planDigest,
			branch: "imm/initiative-slug",
			base_head: head,
			budget,
			actor_id: "user",
			confirmation_ref: "confirm",
			expires_at: farFuture,
			nonce: "n",
		},
		children,
		confirmationTime,
	);
	const input = {
		root,
		batch_id: id,
		initiative_slug: "initiative-slug",
		registry,
		capability,
		children,
		plan_digest: planDigest,
		base_head: head,
		confirmation_time: confirmationTime,
		authorization_expires_at: farFuture,
		budget,
		now: farFuture,
		kernel: {},
		git: {
			preflight: (request) => git.runBatchGitPreflight(request),
			commitChild: (r, t, b, h, branch, intentPath) =>
				git.commitBatchChild({ root: r, taskId: t, batchId: b, expectedHead: h, branch, intentPath }),
			lookupBatchCommit: (r, t, b, expectedHead, branch) =>
				git.lookupBatchCommit({ root: r, taskId: t, batchId: b, expectedHead, branch }),
		},
	};
	const prepared = prepareBatchRunState(input);
	writeBatchRunState(root, {
		...prepared,
		batch_state: "running",
		children: prepared.children.map((child) => ({
			...child,
			state,
			...(recordCommit ? { commit: recordCommit } : {}),
		})),
		commits: recordCommit ? [recordCommit] : [],
	});
	try {
		return {
			report: await resumeBatch(input, () => {
				throw new Error("no projection is expected on this path");
			}),
			error: null,
		};
	} catch (error) {
		return { report: null, error: String(error) };
	}
};

mkdirSync(join(root, ".git"), { recursive: true });
const drift = await resumePersisted("enrolled", null);
if (!drift.report || drift.report.batch_state !== "failed" || !String(drift.report.reason).includes("lineage")) {
	throw new Error(\`the runner's head-drift inspection did not run: \${JSON.stringify(drift)}\`);
}
const unreachable = await resumePersisted("committed", "3".repeat(40));
if (!unreachable.error || !unreachable.error.includes("lacks evidence")) {
	throw new Error(\`the runner's unreachable-commit inspection did not run: \${JSON.stringify(unreachable)}\`);
}
`;
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

	it("states the restrictions the runner actually enforces", async () => {
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

		// Shipped restriction: a `critical` child is never enrollable. Asserted by
		// running the projection, not by matching one branch's spelling — the
		// classification gained a Spec-binding exclusion ahead of it.
		const criticalRoot = mkdtempSync(join(tmpdir(), "imm-critical-child-"));
		try {
			mkdirSync(join(criticalRoot, "docs/plans"), { recursive: true });
			const writeChild = (taskId: string, risk: string, scope: string[]) =>
				writeFileSync(join(criticalRoot, `docs/plans/${taskId}.intent.json`), `${JSON.stringify({
					contract: "assurance_kernel/task_intent/v1",
					task_id: taskId,
					goal: `Deliver ${taskId}`,
					acceptance: [{ id: `acc-${taskId}`, assertion: "a", verification: "{}" }],
					scope_hint: scope,
					risk,
					revision: 1,
					owner: "user",
				}, null, 2)}\n`);
			writeChild("critical-child", "critical", ["tests/**"]);
			writeChild("healthy-child", "material", [
				"tests/**",
				"docs/specs/healthy-child.spec.md",
				"docs/specs/archive/healthy-child.spec.md",
			]);
			// The projection only offers Git-tracked TaskIntents.
			execFileSync("git", ["init", "-q"], { cwd: criticalRoot });
			execFileSync("git", ["add", "docs/plans"], { cwd: criticalRoot });
			const plan = await projectBatchPlan(
				criticalRoot,
				"initiative",
				{ confirmation_time: "2099-01-01T00:00:00.000Z" },
				async () => ({
					contract: "immune_brain/github_initiative_observation/v1",
					initiative_id: "initiative",
					issue_number: 1,
					tasks: [
						{ task_id: "critical-child", slice_id: "S1", issue_number: 2, blocked_by: [] },
						{ task_id: "healthy-child", slice_id: "S2", issue_number: 3, blocked_by: [] },
					],
				}),
			);
			expect(plan.children.map((child) => [child.task_id, child.status, child.reason])).toEqual([
				["critical-child", "needs_human", "critical"],
				["healthy-child", "enrollable", null],
			]);
			expect(plan.enrollable.map((child) => child.task_id)).toEqual(["healthy-child"]);
		} finally {
			rmSync(criticalRoot, { recursive: true, force: true });
		}
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

	it("never produces a worktree invocation while the batch runtime runs", () => {
		const scratch = mkdtempSync(join(tmpdir(), "imm-git-guard-"));
		const root = join(scratch, "repo");
		const binDir = join(scratch, "bin");
		const logPath = join(scratch, "invocations.log");
		const drivePath = join(scratch, "drive.ts");
		try {
			mkdirSync(root);
			mkdirSync(binDir);
			writeAuditPair(root, GUARD_TASK_ID);
			installRecordingGit({
				binDir,
				logPath,
				committedMarker: join(scratch, "committed"),
				stagedMarker: join(scratch, "staged"),
				root,
			});
			// Drive the runtime's Git layer down its real paths — branch preflight,
			// the scope-bounded child commit, and the commit lookup.
			writeFileSync(drivePath, driveSource(join(REPO_ROOT, "plugins/immune-brain/runtime")));
			const drive = spawnSync(
				"bun",
				[drivePath, root, GUARD_TASK_ID, GUARD_BATCH_ID, GUARD_HEAD, GUARD_COMMIT],
				{
					cwd: REPO_ROOT,
					encoding: "utf8",
					env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` },
				},
			);
			expect({ status: drive.status, stderr: drive.stderr.trim().slice(0, 2000) }).toEqual({ status: 0, stderr: "" });

			const subcommands = recordedInvocations(logPath).map(gitSubcommand);
			// A drive that never reached the mutating Git effects would assert nothing.
			for (const mutation of ["checkout", "add", "commit"]) expect(subcommands).toContain(mutation);
			expect(subcommands).not.toContain("worktree");
		} finally {
			rmSync(scratch, { recursive: true, force: true });
		}
	});
});
