import { describe, expect, it } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import { projectBatchPlan } from "../plugins/immune-brain/runtime/unattended/batch_plan";
import { batchReason } from "../plugins/immune-brain/runtime/unattended/batch_reasons";

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

const LOOP_CONTRACT = read("plugins/immune-brain/dist/drive.md");
const BATCH_CONTRACT = read("plugins/immune-brain/dist/drive-batch.md");
const LOOP_LOADER = read("plugins/immune-brain/skills/drive/SKILL.md");
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
		scope_hint: [GUARD_CHANGED_PATH, `docs/specs/${taskId}.spec.md`, `docs/specs/archive/${taskId}.spec.md`],
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
  symbolic-ref) if [ -f "$committed.branch" ]; then printf '%s\\n' "imm/initiative-slug"; else printf '%s\\n' "main"; fi ;;
  show-ref) if [ ! -f "$committed.branch" ]; then exit 1; fi ;;
  checkout) : > "$committed.branch" ;;
  update-ref)
    # The hidden-ref plumbing: creation passes the all-zero old value, a move does not.
    case "$*" in
      *0000000000000000000000000000000000000000) ;;
      *) : > "$committed" ;;
    esac ;;
  write-tree) printf '%s\\n' "3333333333333333333333333333333333333333" ;;
  commit-tree)
    printf '%s\\n' "${GUARD_COMMIT}"
    while IFS= read -r line; do
      case "$line" in
        "Immune-Brain-Batch: "*) printf '%s\\n' "\${line#Immune-Brain-Batch: }" > "$committed.batch" ;;
      esac
    done ;;
  diff) if [ ! -f "$committed" ]; then printf '${GUARD_CHANGED_PATH}\\000'; fi ;;
  diff-tree) printf '${GUARD_CHANGED_PATH}\\000' ;;
  diff-files) if [ ! -f "$staged" ]; then printf '${GUARD_CHANGED_PATH}\\000'; fi ;;
  ls-files)
    case "$*" in
      *-v*) ;;
      *--others*) if [ ! -f "$staged" ]; then printf '${GUARD_CHANGED_PATH}\\000'; fi ;;
    esac ;;
  add) : > "$staged" ;;
  commit)
    : > "$committed"
    while IFS= read -r line; do
      case "$line" in
        "Immune-Brain-Batch: "*) printf '%s\\n' "\${line#Immune-Brain-Batch: }" > "$committed.batch" ;;
      esac
    done ;;
  show)
    # The lineage check reads committed evidence with: git show <commit>:<path>.
    for argument in "$@"; do
      case "$argument" in
        *:*) spec="$argument" ;;
      esac
    done
    case "$spec" in
      *:*) evidence="\${spec#*:}"; if [ -f "${options.root}/$evidence" ]; then cat "${options.root}/$evidence"; else exit 1; fi ;;
      *) exit 1 ;;
    esac ;;
  log)
    batch="${GUARD_BATCH_ID}"
    if [ -f "$committed.batch" ]; then IFS= read -r batch < "$committed.batch"; fi
    printf '%s\\000%s\\000%s\\000%s\\000%s\\n' "${GUARD_COMMIT}" "$batch" "Immune-Brain Batch" "immune-brain@local" "imm(${GUARD_TASK_ID}): recorded" ;;
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
 * commit and commit lookup. Lane lifecycle worktree operations are owned by the
 * Lane driver, not this Git seam; every driven operation must actually run.
 */
function driveSource(runtimeDir: string): string {
	const runtimePath = (relativePath: string) => JSON.stringify(join(runtimeDir, relativePath));
	return `import { mkdirSync } from "node:fs";
import { join } from "node:path";
const git = await import(${runtimePath("unattended/batch_git.ts")});
const { batchRefName } = await import(${runtimePath("unattended/batch_ref.ts")});
const [root, taskId, batchId, head, commit] = process.argv.slice(2);

const preflight = git.runBatchGitPreflight({ root, initiative_slug: "initiative-slug", base_head: head, batch_id: batchId });
if (!preflight.ok) throw new Error(\`preflight rejected: \${preflight.reason}\`);
const committed = await git.commitBatchChild({ root, taskId, batchId, expectedHead: head, branch: batchRefName(batchId) });
if (committed.commit !== commit) throw new Error(\`unexpected child commit \${committed.commit}\`);
const adopted = await git.lookupBatchCommit({ root, taskId, batchId, expectedHead: head, branch: batchRefName(batchId) });
if (!adopted || adopted.commit !== commit) throw new Error("commit lookup did not adopt the child commit");


`;
}

describe("unattended batch contract text", () => {
	it("documents the opt-in entry, the single parameter, and the unchanged default", () => {
		const optIn = section(BATCH_CONTRACT, "## Unattended Batch Opt-In");
		expect(optIn).toContain(BATCH_TOOL);
		expect(optIn).toContain("`initiative_slug`");
		// The loader must route to the section, or the contract is unreachable.
		expect(LOOP_LOADER).toContain("dist/drive-batch.md#unattended-batch-opt-in");

		// The opt-in tool and its single parameter are shipped facts, not prose.
		const claudeServer = read("plugins/immune-brain/runtime/claude/mcp_server.ts");
		expect(claudeServer).toContain(`name: "${BATCH_TOOL}"`);
		expect(claudeServer).toContain("initiative_slug");

		const piExtension = read("plugins/immune-brain/.pi-extension/imm-unattended-batch.ts");
		expect(piExtension).toContain(`name: "${BATCH_TOOL}"`);
		expect(piExtension).toContain("initiative_slug: Type.String");
	});

	it("states the restrictions the runner actually enforces", async () => {
		const optIn = section(BATCH_CONTRACT, "## Unattended Batch Opt-In");
		for (const claim of ["never pushes a ref", "pull request", "user decision", "refs/heads/imm/<slug>"]) {
			expect(optIn).toContain(claim);
		}
		expect(optIn).toContain("`critical`");

		// A valid `critical` child is enrollable like any other (run-entry decision
		// hosting D5). Asserted by running the projection, not by matching one
		// branch's spelling — the classification has a Spec-binding exclusion too.
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
				["critical-child", "enrollable", null],
				["healthy-child", "enrollable", null],
			]);
			expect(plan.enrollable.map((child) => child.task_id)).toEqual(["critical-child", "healthy-child"]);
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

	it("states that task QA runs in place against the frozen snapshot (ADR 0022)", () => {
		const loop = LOOP_CONTRACT.replace(/\s+/g, " ");
		expect(loop).toContain("Deterministic QA runs all descriptors in the task's working directory");
		expect(loop).toContain("the tracked content inside the task's scope must equal the frozen snapshot");
		expect(loop).toContain("`protected_input_or_output_drift`");
		expect(loop).not.toContain("disposable delivery");
		const adrPath = resolve(REPO_ROOT, "docs/adr/0022-deterministic-qa-runs-in-place.md");
		expect(existsSync(adrPath)).toBe(true);
		const adr = readFileSync(adrPath, "utf8").replace(/\s+/g, " ");
		expect(adr).toContain("status: accepted");
		expect(adr).toContain("Task QA runs in the task's working directory");
		expect(adr).toContain("Only in-scope content is compared");
	});

	it("keeps default drive behavior byte-identical when the batch tool is not invoked", () => {
		// The opt-in path is a Tool registration; the loop contract's execution
		// sequence must not make a batch step mandatory or implicit.
		for (const contract of [LOOP_CONTRACT, BATCH_CONTRACT]) {
			expect(contract).not.toContain("start_unattended_batch` automatically");
			expect(contract).not.toMatch(/drive must start a batch|先调用 start_unattended_batch/i);
		}

		// The shipped entry requires a literal-user confirmation; a non-interactive
		// invocation is refused, so the opt-in cannot happen implicitly. The refusal
		// text is table-owned: the adapter names the key and the shared table owns the
		// operator-visible prose, so assert the resolution rather than the spelling.
		const piExtension = read("plugins/immune-brain/.pi-extension/imm-unattended-batch.ts");
		expect(piExtension).toContain("unsupported_host");
		expect(piExtension).toContain('batchReason("confirmation_port_unavailable")');
		expect(batchReason("confirmation_port_unavailable")).toEqual({
			state: "rejected",
			reason: "native confirmation port is unavailable",
			recovery_action: "retry through a fresh native gate in the current Host",
		});

		// The opt-in never runs on its own: the shipped extension registers only the
		// batch Tools, and the disposition Tool never starts a batch — it retires one
		// parked record behind its own literal-user gate.
		const piToolRegistrations = piExtension.match(/registerTool\(/g) ?? [];
		expect(piToolRegistrations.length).toBe(2);
		expect(piExtension).toContain('name: "retire_stale_batch"');
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
			batchState.indexOf("export type BatchLaneChildRunState"),
		);
		const fieldsOf = (body: string) =>
			(body
				.split("\n")
				.filter((line) => !line.trimStart().startsWith("*") && !line.trimStart().startsWith("/**") && !line.trimStart().startsWith("//"))
				.join("\n")
				.match(/^\s*([a-z_]+)\??:/gm) ?? []
			).map((line) => line.trim().replace(/\??:$/, ""));
		const declaredFields = fieldsOf(recordBody);
		// Lane mode adds a second record contract; it is orchestration-only as well.
		expect(batchState).toContain('contract: "assurance_kernel/batch_run_state/v2"');
		expect(
			fieldsOf(
				batchState.slice(
					batchState.indexOf("export interface BatchLaneRunStateRecord"),
					batchState.indexOf("export type AnyBatchRunStateRecord"),
				),
			),
		).toEqual([
			"contract",
			"topology_digest",
			"progress_mode",
			"final_report",
			"batch_id",
			"initiative_slug",
			"plan_digest",
			"base_head",
			"branch",
			"confirmation_time",
			"budget",
			"max_children",
			"qa_failure_limit",
			"max_parallel",
			"batch_state",
			"children",
			"commits",
			"adopted_heads",
			// Orchestration evidence only: restored Lane leaks and the recorded
			// final verification commands, and coordinator instructions (retro #195, #200, #201).
			"restores",
			"interventions",
			"final_verification",
			// The recorded verification outcome and the bounded Parent repair tasks it produced.
			"final_verification_result",
			"repair_tasks",
			// ADR 0028: legacy delegation evidence stays readable, with no current grant.
			"revision_delegation",
			"delegated_revisions",
			"intent_identities",
			"reseals",
			"created_at",
			"updated_at",
		]);
		expect(declaredFields).toEqual([
			"contract",
			"batch_id",
			"initiative_slug",
			"plan_digest",
			"base_head",
			"branch",
			"confirmation_time",
			"budget",
			"max_children",
			"qa_failure_limit",
			"batch_state",
			"children",
			"consecutive_qa_failures",
			"commits",
			"final_verification",
			"final_verification_result",
			"repair_tasks",
			"adopted_heads",
			// Spec branch-boundary D7: the authorized identities, kept only when the plan binds the authority subject.
			"intent_identities",
			"created_at",
			"updated_at",
		]);
	});

	it("documents frozen acceptance and retains delegation fields only as legacy evidence (ADR 0028)", () => {
		const batch = normalized(BATCH_CONTRACT);
		expect(batch).toContain("Frozen acceptance remains the authority subject (ADR 0026)");
		expect(batch).toContain("acceptance changes pauses for the literal user's native gate");
		expect(batch).toContain("cannot approve revisions or reseal `plan_digest`");
		expect(batch).toContain("those fields grant no current authority");
		expect(batch).toContain("scope-only revision keeping the bound Spec path is compatible");
		const state = read("plugins/immune-brain/runtime/unattended/batch_state.ts");
		expect(state).toContain("Legacy v2 fields, preserved for reading and retirement only (D20)");
		for (const host of [
			"plugins/immune-brain/runtime/claude/mcp_server.ts",
			"plugins/immune-brain/.pi-extension/imm-unattended-batch.ts",
		]) {
			expect(read(host)).not.toContain("lane_revision:");
		}
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

	it("child Git preflight, bounded commit and lookup never mutate worktrees or push", () => {
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
			// `--no-install` is load-bearing: without it Bun auto-installs on demand in
			// the node_modules-less delivery tree, and each attempt to fetch an
			// unresolvable package costs tens of seconds, which blows this test's own
			// budget under deterministic QA.
			const drive = spawnSync(
				"bun",
				["--no-install", drivePath, root, GUARD_TASK_ID, GUARD_BATCH_ID, GUARD_HEAD, GUARD_COMMIT],
				{
					cwd: REPO_ROOT,
					encoding: "utf8",
					env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` },
				},
			);
			expect({ status: drive.status, stderr: drive.stderr.trim().slice(0, 2000) }).toEqual({ status: 0, stderr: "" });

			const subcommands = recordedInvocations(logPath).map(gitSubcommand);
			// A drive that never reached the mutating Git effects would assert nothing.
			for (const mutation of ["update-ref", "add", "commit-tree"]) expect(subcommands).toContain(mutation);
			// The user's branch, HEAD and index are never touched.
			for (const forbidden of ["checkout", "commit", "switch", "reset"]) expect(subcommands).not.toContain(forbidden);
			// This low-level seam owns no Lane lifecycle or remote delivery.
			// The Lane driver separately creates/removes worktrees and never pushes.
			for (const forbidden of ["worktree", "push"]) expect(subcommands).not.toContain(forbidden);
		} finally {
			rmSync(scratch, { recursive: true, force: true });
		}
	});

});
