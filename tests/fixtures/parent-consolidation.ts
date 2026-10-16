import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalIntentHash, parseTaskIntentV1 } from "../../plugins/immune-brain/runtime/kernel/intent";
import { recoverKernelStoreFollowUps } from "../../plugins/immune-brain/runtime/kernel/storage";
import { captureGitTaskRevisionSnapshot } from "../../plugins/immune-brain/runtime/workspace_scope";
import { consolidationDigest } from "../../plugins/immune-brain/runtime/unattended/parent_delivery_consolidation";
import { seedKernelRunForTest } from "./mutation-authority-test-seam";

/** Script Kernel settlement, but use real Git/index/blobs, v4 proofs and three distinct Review trees. */
export function parentConsolidationFixture(exitCode = 0) {
	const root = mkdtempSync(join(tmpdir(), "imm-parent-consolidation-"));
	const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
	git("init", "-b", "main"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.com");
	writeFileSync(join(root, ".gitignore"), ".imm/state/\n");
	mkdirSync(join(root, "docs/plans"), { recursive: true }); mkdirSync(join(root, "src"));
	const sourceScope = (id: string) => ["src/", `docs/plans/${id}.intent.json`];
	const finalScope = ["src/", "docs/plans/", ".imm/audit/s4/", ".imm/audit/repair/"];
	const intents = Object.fromEntries(["s4", "repair", "consolidation"].map(id => {
		const intent = parseTaskIntentV1({ contract: "assurance_kernel/task_intent/v1", task_id: id, owner: "user", goal: `Deliver ${id}`,
			scope_hint: id === "consolidation" ? finalScope : sourceScope(id), risk: "material", revision: 1,
			acceptance: [{ id: "AC1", assertion: `Deliver ${id}`, verification: "true" }] });
		writeFileSync(join(root, `docs/plans/${id}.intent.json`), JSON.stringify(intent, null, 2) + "\n");
		return [id, intent];
	}));
	writeFileSync(join(root, "verify.ts"), `const fs = require('node:fs'); const p = '.imm/state/verification-count'; fs.writeFileSync(p, String(Number(fs.existsSync(p) ? fs.readFileSync(p,'utf8') : 0) + 1)); process.exitCode = ${exitCode};\n`);
	git("add", "."); git("commit", "-m", "initial plan"); const baseHead = git("rev-parse", "HEAD");
	const seal = (id: string, bundle: string) => {
		writeFileSync(join(root, `src/${id}.ts`), `export const value = '${id}';\n`);
		writeFileSync(join(root, "src/bundle.js"), bundle + "\n"); git("add", "src", "docs/plans", ".imm/audit");
		const intent = intents[id]!; const hash = canonicalIntentHash(intent);
		const snapshot = captureGitTaskRevisionSnapshot(root, intent.scope_hint, baseHead, id);
		const diff = consolidationDigest(snapshot); const tree = git("write-tree");
		const commit = git("commit-tree", tree, "-p", baseHead, "-m", `immutable review ${id}`);
		const revision = { contract: "assurance_kernel/review_revision_identity/v1", base_head: baseHead,
			review_commit: commit, review_tree: tree, manifest_digest: consolidationDigest({ id, diff }) };
		const approval = { task_revision: 1, intent_content_hash: hash, diff_hash: diff, summary: "scripted passing outcome" };
		const record = { contract: "assurance_kernel/task_record/v4", task_id: id, intent_snapshot: intent,
			intent_ref: { path: `docs/plans/${id}.intent.json`, content_hash: hash }, lifecycle: "done", artifact_state: "frozen",
			baseline: `sha256:${"a".repeat(64)}`, git_base_head: baseHead,
			attestations: [{ ...approval, id: `qa-${id}`, kind: "qa", authority_role: "qa", actor_id: "qa-actor",
				acceptance_results: [{ acceptance_id: "AC1", status: "passed", summary: "passed" }] },
			{ ...approval, id: `review-${id}`, kind: "review", authority_role: "reviewer", actor_id: "reviewer-actor",
				acceptance_results: [], review_revision: revision }], findings: [], history: [] };
		const seeded = seedKernelRunForTest(root, { task_id: id, record, terminal: { lifecycle: "done" } });
		recoverKernelStoreFollowUps(root, id);
		return { task_id: id, run_id: seeded.run_id, revision };
	};
	mkdirSync(join(root, ".imm/audit"), { recursive: true });
	const s4 = seal("s4", "historical-s4-bundle");
	const repair = seal("repair", "historical-repair-bundle");
	const final = seal("consolidation", "new-reviewed-composed-bundle");
	git("add", ".imm/audit");
	const selection = { task_id: final.task_id, run_id: final.run_id, source_runs: [s4, repair].map(({ task_id, run_id }) => ({ task_id, run_id })) };
	const reader = async () => ({ contract: "immune_brain/github_initiative_observation/v1" as const,
		initiative_id: "native-parent", initiative_slug: "native-parent", issue_number: 1, carrier: "local" as const,
		tasks: [{ task_id: "s4", slice_id: "S4", blocked_by: [] as string[] }] });
	const auditBytes = () => [s4, repair].flatMap(({ task_id, run_id }) => ["task-record.json", "terminal-proof.json"].map(file =>
		readFileSync(join(root, ".imm/audit", task_id, run_id, file), "utf8")));
	const count = () => Number(readFileSync(join(root, ".imm/state/verification-count"), "utf8"));
	return { root, git, baseHead, s4, repair, final, selection, reader, auditBytes, count };
}
