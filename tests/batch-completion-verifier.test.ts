import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { commitBatchChild } from "../plugins/immune-brain/runtime/unattended/batch_git";
import { verify } from "../scripts/verify-batch-completion";
import { readSecureProjectBytes, readSecureProjectFile } from "../plugins/immune-brain/runtime/kernel/storage";
import { parseBatchRunState, readBatchRunState } from "../plugins/immune-brain/runtime/unattended/batch_state";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";

const SCRIPT = "scripts/verify-batch-completion.ts";
const NOW = "2026-01-01T00:00:00.000Z";
const GIT = { GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" };

function git(root: string, args: string[], env = GIT): string {
	const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
	if (result.status !== 0) throw new Error(result.stderr || result.stdout);
	return result.stdout.trim();
}
function tree(root: string, rel: string): string {
	const path = join(root, rel); if (!existsSync(path)) return "";
	return readdirSync(path, { recursive: true, withFileTypes: true }).flatMap((entry) => {
		const name = join(entry.parentPath ?? entry.path, entry.name).slice(path.length + 1);
		if (!entry.isFile()) return [];
		return [`${name}\0${readFileSync(join(path, name)).toString("base64")}`];
	}).sort().join("\n");
}
function snapshot(root: string) {
	return {
		files: readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => `${entry.name}\0${readFileSync(join(root, entry.name)).toString("base64")}`).sort().join("\n"),
		source: tree(root, "src"),
		head: git(root, ["rev-parse", "HEAD"]),
		refs: git(root, ["for-each-ref", "--format=%(refname) %(objectname)"]),
		index: readFileSync(resolve(root, git(root, ["rev-parse", "--git-path", "index"]))).toString("base64"),
		state: tree(root, ".imm/state"),
		audit: tree(root, ".imm/audit"),
		authority: tree(root, ".imm/authority"),
	};
}
function run(root: string, args: string[]) {
	const result = spawnSync("bun", [join(process.cwd(), SCRIPT), ...args], { cwd: root, encoding: "utf8" });
	return { status: result.status ?? 2, out: result.stdout, err: result.stderr };
}
function record(task: string, run: string, lifecycle: "done" | "stopped", paths: string[]) {
	const intent = parseTaskIntentV1({ contract: "assurance_kernel/task_intent/v1", task_id: task, owner: "user", goal: `Goal ${task}`, acceptance: [{ id: "A1", assertion: "implemented", verification: "bun test tests/fixture.test.ts" }], scope_hint: paths, risk: "material", revision: 1 });
	const history = [{ id: `complete:${task}`, at: NOW, type: lifecycle === "done" ? "complete" : "stop", from_state: "active:frozen", to_state: `${lifecycle}:frozen`, reason: "settled" }];
	const value = { contract: "assurance_kernel/task_record/v4", task_id: task, intent_snapshot: intent, intent_ref: { path: `docs/plans/${task}.intent.json`, content_hash: canonicalIntentHash(intent) }, lifecycle, artifact_state: "frozen", baseline: canonicalIntentHash(intent), git_base_head: "b".repeat(40), attestations: [], findings: [], history };
	const bytes = `${JSON.stringify(value, null, 2)}\n`;
	const proof = { contract: "assurance_kernel/task_tombstone/v2", task_id: task, lifecycle_status: "terminal", terminal_lifecycle: lifecycle, terminal_event_id: history[0].id, final_record_hash: `sha256:${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")}`, terminalized_at: NOW };
	return { run, bytes, proof: `${JSON.stringify(proof, null, 2)}\n` };
}
function child(task: string, state = "committed", commit: string | null = null, reason: string | null = null) {
	return { task_id: task, slice_id: task.at(-1)!.toUpperCase(), blocked_by: [], state, reason, commit };
}
function persist(root: string, batch: string, state: Record<string, unknown>, report: Record<string, unknown>) {
	const dir = join(root, ".imm/state/batches"); mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `${batch}.json`), `${JSON.stringify(state, null, 2)}\n`);
	writeFileSync(join(dir, `${batch}.report.json`), `${JSON.stringify(report, null, 2)}\n`);
}
async function fixture(format: "sha1" | "sha256" = "sha1", adopt?: "between" | "after") {
	const root = mkdtempSync(join(tmpdir(), "batch-verify-")); const batch = "batch-fixture-11111111-1111-4111-8111-111111111111";
	git(root, ["init", `--object-format=${format}`, "-b", "imm/fixture"]); writeFileSync(join(root, ".gitignore"), ".imm/state/\n.imm/authority/\n"); git(root, ["add", ".gitignore"]); git(root, ["commit", "-m", "base"]);
	const adopted: Array<{ from: string; to: string }> = [];
	const adoptOutsideCommit = () => {
		const from = git(root, ["rev-parse", "HEAD"]); writeFileSync(join(root, "outside.txt"), "user commit\n");
		git(root, ["add", "outside.txt"]); git(root, ["commit", "-m", "user work"]); adopted.push({ from, to: git(root, ["rev-parse", "HEAD"]) });
	};
	const commits: string[] = []; const tasks = ["task-s0", "task-s1"]; const runs = ["run-11111111-1111-4111-8111-111111111111", "run-22222222-2222-4222-8222-222222222222"];
	for (const [index, task] of tasks.entries()) {
		if (adopt === "between" && index === 1) adoptOutsideCommit();
		const path = `src/${task}.ts`; mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(join(root, path), `export const value = ${JSON.stringify(task)};\n`);
		const pair = record(task, runs[index]!, "done", [path]); const audit = join(root, ".imm/audit", task, pair.run);
		mkdirSync(audit, { recursive: true }); writeFileSync(join(audit, "task-record.json"), pair.bytes); writeFileSync(join(audit, "terminal-proof.json"), pair.proof);
		mkdirSync(join(root, ".imm/state"), { recursive: true }); writeFileSync(join(root, ".imm/state/active-run.json"), `${JSON.stringify({ task_id: task, run_id: pair.run })}\n`);
		const parent = git(root, ["rev-parse", "HEAD"]);
		const committed = await commitBatchChild({ root, taskId: task, batchId: batch, expectedHead: parent, branch: "imm/fixture" });
		commits.push(committed.commit); rmSync(join(root, ".imm/state/active-run.json"));
	}
	if (adopt === "after") adoptOutsideCommit();
	const children = tasks.map((task, index) => child(task, "committed", commits[index]));
	const state = { contract: "assurance_kernel/batch_run_state/v1", batch_id: batch, initiative_slug: "fixture", plan_digest: "sha256:p", base_head: git(root, ["rev-parse", `${commits[0]}^`]), branch: "imm/fixture", confirmation_time: NOW, authorization_expires_at: NOW, budget: { max_children: 2, deadline_at: NOW, qa_failure_limit: 2 }, batch_state: "completed", children, consecutive_qa_failures: 0, commits, ...(adopted.length ? { adopted_heads: adopted } : {}), created_at: NOW, updated_at: NOW } as Record<string, any>;
	const report = { contract: "assurance_kernel/batch_run_report/v1", batch_id: batch, initiative_slug: "fixture", batch_state: "completed", children: structuredClone(children), commits: [...commits], reason: null, next_action: "none", created_at: NOW };
	persist(root, batch, state, report);
	mkdirSync(join(root, ".imm/authority"), { recursive: true });
	writeFileSync(join(root, ".imm/authority/sentinel.json"), '{"fixture":"preserve existing authority bytes"}\n');
	return { root, batch, state, report, runs, before: snapshot(root) };
}
function assertUnchanged(root: string, before: ReturnType<typeof snapshot>) { expect(snapshot(root)).toEqual(before); }
function check(root: string, batch: string, before: ReturnType<typeof snapshot>, status: number, code?: string) {
	const result = run(root, ["--batch-id", batch, "--json"]); if (result.status !== status) throw new Error(`${code ?? "ok"} ${result.status}\nOUT ${result.out}\nERR ${result.err}`); expect(result.status).toBe(status); expect(result.err).toBe("");
	const parsed = JSON.parse(result.out); if (code) expect(parsed.code).toBe(code); assertUnchanged(root, before); return parsed;
}

describe("batch completion verifier", () => {
	test("accepts a runner-produced chain and rejects each contradiction", async () => {
		const fx = await fixture();
		try {
			const ok = check(fx.root, fx.batch, fx.before, 0); expect(ok.complete).toBe(true); expect(ok.children.map((item: { run_id: string }) => item.run_id)).toEqual(fx.runs);
			const amend = (v: typeof fx, message?: string) => {
				const index = 1; const parent = git(v.root, ["rev-parse", "HEAD^"]);
				git(v.root, ["add", "-A", "--", ".imm/audit", "src"]); if (existsSync(join(v.root, "other.ts"))) git(v.root, ["add", "--", "other.ts"]);
				git(v.root, ["commit", "--amend", ...(message ? ["-m", message] : ["--no-edit"])]);
				const commit = git(v.root, ["rev-parse", "HEAD"]);
				v.state.commits[index] = commit; v.state.children[index].commit = commit; v.report.commits[index] = commit; v.report.children[index].commit = commit;
				const evidence = JSON.parse(readFileSync(join(v.root, ".imm/state/batches/commits", `${v.batch}-task-s1.json`), "utf8")); evidence.commit = commit; evidence.parent_head = parent;
				writeFileSync(join(v.root, ".imm/state/batches/commits", `${v.batch}-task-s1.json`), `${JSON.stringify(evidence, null, 2)}\n`);
				persist(v.root, v.batch, v.state, v.report);
			};
			const cases: Array<[string, (value: typeof fx) => void | Promise<void>, boolean?]> = [
				["malformed_report", (v) => { delete v.state.initiative_slug; delete v.report.initiative_slug; }, true],
				["state_report_mismatch", (v) => { v.report.batch_state = "needs_human"; }, true],
				["commit_order_mismatch", (v) => { const commits = [...v.state.commits].reverse(); v.state.commits = commits; v.report.commits = [...commits]; }, true],
				["lineage_mismatch", (v) => { git(v.root, ["checkout", "-b", "other"]); }, false],
				["missing_commit_evidence", (v) => { const path = join(v.root, ".imm/state/batches/commits", `${v.batch}-task-s1.json`); const value = JSON.parse(readFileSync(path, "utf8")); delete value.parent_head; writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); }],
				["missing_commit_evidence", (v) => { const path = join(v.root, ".imm/state/batches/commits", `${v.batch}-task-s1.json`); const value = JSON.parse(readFileSync(path, "utf8")); value.parent_head = "c".repeat(40); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); }],
				["missing_commit_evidence", (v) => amend(v, `external: not runner\n\nImmune-Brain-Batch: ${v.batch}`)],
				["missing_commit_evidence", (v) => amend(v, "imm(task-s1): wrong batch\n\nImmune-Brain-Batch: another")],
				["wrong_run_evidence", (v) => { const path = join(v.root, ".imm/audit/task-s1", v.runs[1]!, "terminal-proof.json"); const proof = JSON.parse(readFileSync(path, "utf8")); proof.final_record_hash = `sha256:${"c".repeat(64)}`; writeFileSync(path, `${JSON.stringify(proof, null, 2)}\n`); amend(v); }],
				["wrong_run_evidence", (v) => { const src = join(v.root, ".imm/audit/task-s1", v.runs[1]!); const dir = join(v.root, ".imm/audit/task-s1", "run-33333333-3333-4333-8333-333333333333"); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "task-record.json"), readFileSync(join(src, "task-record.json"))); writeFileSync(join(dir, "terminal-proof.json"), readFileSync(join(src, "terminal-proof.json"))); amend(v); }],
				...["type", "from_state", "to_state"].map((field): [string, (v: typeof fx) => void] => ["wrong_run_evidence", (v) => {
					const dir = join(v.root, ".imm/audit/task-s1", v.runs[1]!);
					const recordPath = join(dir, "task-record.json"); const value = JSON.parse(readFileSync(recordPath, "utf8"));
					value.history.at(-1)[field] = field === "type" ? "record_finding" : "active:frozen";
					if (field === "from_state") value.history.at(-1)[field] = "active";
					const raw = `${JSON.stringify(value, null, 2)}\n`; writeFileSync(recordPath, raw);
					const proofPath = join(dir, "terminal-proof.json"); const proof = JSON.parse(readFileSync(proofPath, "utf8")); proof.final_record_hash = `sha256:${new Bun.CryptoHasher("sha256").update(raw).digest("hex")}`;
					writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`); amend(v);
				}]),
				["stopped_lifecycle", (v) => { const pair = record("task-s1", v.runs[1]!, "stopped", ["src/task-s1.ts"]); const dir = join(v.root, ".imm/audit/task-s1", pair.run); writeFileSync(join(dir, "task-record.json"), pair.bytes); writeFileSync(join(dir, "terminal-proof.json"), pair.proof); amend(v); }],
				["scope_mismatch", (v) => { writeFileSync(join(v.root, "other.ts"), "export const extra = true;\n"); amend(v); }],
				["malformed_report", (v) => writeFileSync(join(v.root, ".imm/state/batches", `${v.batch}.report.json`), "{")],
				["unstable_evidence", (v) => { const path = join(v.root, ".imm/audit/task-s0", v.runs[0]!, "terminal-proof.json"); const proof = JSON.parse(readFileSync(path, "utf8")); proof.terminalized_at = "2026-01-02T00:00:00.000Z"; writeFileSync(path, `${JSON.stringify(proof, null, 2)}\n`); }],
				["invalid_input", (v) => { v.state.commits[0] = "--output=/tmp/immune-batch-verifier-must-not-write"; v.state.children[0].commit = v.state.commits[0]; v.report.commits = [...v.state.commits]; v.report.children[0].commit = v.state.commits[0]; }, true],
			];
			for (const [code, mutate, rewriteState] of cases) {
				const next = await fixture();
				try { await mutate(next); if (rewriteState) persist(next.root, next.batch, next.state, next.report); const failure = check(next.root, next.batch, snapshot(next.root), code === "malformed_report" || code === "invalid_input" ? 2 : 1, code); expect(failure.complete).toBe(false); }
				finally { rmSync(next.root, { recursive: true, force: true }); }
			}
		} finally { rmSync(fx.root, { recursive: true, force: true }); }
	}, 20000);
	test("accepts a completed batch whose chain steps over adopted commits and keeps the fatal cases", async () => {
		for (const adopt of ["between", "after"] as const) {
			const fx = await fixture("sha1", adopt);
			try { expect(check(fx.root, fx.batch, fx.before, 0).complete).toBe(true); }
			finally { rmSync(fx.root, { recursive: true, force: true }); }
		}
		const fatal: Array<[string, "between" | "after", string, (state: Record<string, any>, report: Record<string, any>) => void]> = [
			["adoption dropped from state", "between", "missing_commit_evidence", (state) => { delete state.adopted_heads; }],
			["unrecorded commit after the last child", "after", "lineage_mismatch", (state) => { delete state.adopted_heads; }],
			["adoption pointing backwards", "after", "lineage_mismatch", (state) => { state.adopted_heads[0].to = state.commits[0]; }],
		];
		for (const [label, adopt, code, mutate] of fatal) {
			const fx = await fixture("sha1", adopt);
			try {
				mutate(fx.state, fx.report); persist(fx.root, fx.batch, fx.state, fx.report);
				const failure = check(fx.root, fx.batch, snapshot(fx.root), 1, code); expect({ label, complete: failure.complete }).toEqual({ label, complete: false });
			} finally { rmSync(fx.root, { recursive: true, force: true }); }
		}
	}, 20000);
	test("accepts a real SHA-256 runner chain", async () => {
		const fx = await fixture("sha256");
		try { expect(fx.state.commits.every((commit) => /^[0-9a-f]{64}$/.test(commit))).toBe(true); expect(check(fx.root, fx.batch, fx.before, 0).complete).toBe(true); }
		finally { rmSync(fx.root, { recursive: true, force: true }); }
	});
	test("snapshot detects index metadata and existing authority changes", async () => {
		const fx = await fixture();
		try {
			const indexPath = resolve(fx.root, git(fx.root, ["rev-parse", "--git-path", "index"]));
			const index = readFileSync(indexPath);
			git(fx.root, ["update-index", "--assume-unchanged", "src/task-s0.ts"]);
			expect(snapshot(fx.root).index).not.toBe(fx.before.index);
			writeFileSync(indexPath, index);
			writeFileSync(join(fx.root, ".imm/authority/sentinel.json"), "changed");
			expect(snapshot(fx.root).authority).not.toBe(fx.before.authority);
		} finally { rmSync(fx.root, { recursive: true, force: true }); }
	});
	test("supports the runner custom author environment", () => {
		const result = spawnSync("bun", ["test", "tests/batch-completion-verifier.test.ts", "--test-name-pattern", "accepts a runner-produced chain"], { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "Alice" } });
		expect(result.status).toBe(0);
	}, 25000);
	test("validates captured state bytes and detects changes during reads", async () => {
		const fx = await fixture();
		try {
			const statePath = `.imm/state/batches/${fx.batch}.json`;
			const raw = readFileSync(join(fx.root, statePath), "utf8");
			expect(parseBatchRunState(raw, fx.batch)).toEqual(readBatchRunState(fx.root, fx.batch));
			expect(() => parseBatchRunState("{}", fx.batch)).toThrow();
			for (const target of [statePath, `.imm/state/batches/commits/${fx.batch}-task-s0.json`]) {
				const original = readFileSync(join(fx.root, target), "utf8");
				let changed = false;
				try {
					expect(() => verify(fx.root, fx.batch, (path) => {
						if (path === target && !changed) { changed = true; writeFileSync(join(fx.root, target), `${original} `); }
					})).toThrow("unstable_evidence");
				} finally { writeFileSync(join(fx.root, target), original); }
				expect(changed).toBe(true);
				assertUnchanged(fx.root, fx.before);
				// A changed-and-restored source cannot substitute another object for captured bytes.
				expect(verify(fx.root, fx.batch, (path) => {
					if (path === target) { writeFileSync(join(fx.root, target), "{}"); writeFileSync(join(fx.root, target), original); }
				}).complete).toBe(true);
				assertUnchanged(fx.root, fx.before);
			}
		} finally { rmSync(fx.root, { recursive: true, force: true }); }
	});
	test("preserves raw byte identity and rejects malformed UTF-8 drift", async () => {
		const fx = await fixture();
		try {
			const path = `.imm/state/batches/${fx.batch}.report.json`, full = join(fx.root, path);
			const value = JSON.parse(readFileSync(full, "utf8")); value.reason = "\uFFFD";
			const valid = Buffer.from(`${JSON.stringify(value)}\n`);
			const marker = valid.indexOf(Buffer.from("\uFFFD")); expect(marker).toBeGreaterThan(0);
			const malformed = Buffer.concat([valid.subarray(0, marker), Buffer.from([0xff]), valid.subarray(marker + 3)]);
			writeFileSync(full, valid); const before = snapshot(fx.root);
			expect(readSecureProjectBytes(fx.root, path).equals(valid)).toBe(true);
			expect(verify(fx.root, fx.batch).complete).toBe(true); assertUnchanged(fx.root, before);
			try {
				expect(() => verify(fx.root, fx.batch, (captured) => { if (captured === path) writeFileSync(full, malformed); })).toThrow("unstable_evidence");
			} finally { writeFileSync(full, valid); }
			assertUnchanged(fx.root, before);
			writeFileSync(full, malformed);
			expect(readSecureProjectBytes(fx.root, path).equals(malformed)).toBe(true);
			// Existing string-reader callers keep their decoding behavior; the verifier is strict.
			expect(readSecureProjectFile(fx.root, path)).toBe(valid.toString("utf8"));
			check(fx.root, fx.batch, snapshot(fx.root), 2, "read_failed");
		} finally { rmSync(fx.root, { recursive: true, force: true }); }
	});
	test("rejects unsafe input and symlink escape before reading it", async () => {
		const fx = await fixture(); const outside = mkdtempSync(join(tmpdir(), "batch-verify-out-"));
		try {
			expect(run(fx.root, ["--batch-id", "../escape", "--json"]).status).toBe(2);
			const batches = join(fx.root, ".imm/state/batches"); const moved = join(fx.root, ".imm/state/batches-real");
			rmSync(batches, { recursive: true }); mkdirSync(moved, { recursive: true }); symlinkSync(outside, batches);
			const before = snapshot(fx.root);
			const result = run(fx.root, ["--batch-id", fx.batch, "--json"]);
			expect(result.status).toBe(2); expect(JSON.parse(result.out).code).toBe("invalid_input");
			expect(readdirSync(outside)).toEqual([]); expect(snapshot(fx.root)).toEqual(before);
		} finally { rmSync(fx.root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
	});
});
