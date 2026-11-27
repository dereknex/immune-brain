// `bun run e2e:live` (Spec e2e-release-gate D6, S9): the maintainer's L2 run. It runs J1 on `claude`
// and J4 on every Host against the real binaries (installed `herdr --version` recorded; the batch
// journey J2 retired with the unattended batch, ADR 0043 Slice 3) with one retry per journey, re-records the
// journey cassettes through the recorder (E2E_RECORD=1, low-cost model tier E2E_LIVE_MODEL), and
// writes docs/evidence/e2e-live/<version>.json (contract immune_brain/e2e_release_evidence/v1, mode
// "live") for scripts/release-promote.ts to check. It needs the maintainer's Host logins, an
// ANTHROPIC_API_KEY and installed Host binaries, so it is a maintainer action and never a QA descriptor.
// Black box: no runtime imports; the journeys run as child `bun test` processes.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "../../..");

export const EVIDENCE_CONTRACT = "immune_brain/e2e_release_evidence/v1";
/** One run plus one retry (BR-DEC-E3, D6). */
export const MAX_ATTEMPTS = 2;
/** The 30-minute budget per live run (D6). */
export const LIVE_BUDGET_MS = 30 * 60_000;
const ATTEMPT_TIMEOUT_MS = 10 * 60_000;
/** The low-cost tier the recorder sends upstream during a live run (D6). */
export const LIVE_MODEL_TIER = "claude-haiku-5-5";

export type JourneyId = "J1" | "J4";
export interface JourneyPlan {
	id: JourneyId;
	/** tests/e2e/<file>.e2e.ts */
	file: string;
	/** Host -> bun test name pattern selecting that Host's cases in the file. */
	hosts: Record<string, string>;
}

/** D6: J1 (in-place single-task drive) on claude; J4 on claude, pi and antigravity (install only). */
export const LIVE_PLAN: JourneyPlan[] = [
	{ id: "J1", file: "single-task", hosts: { claude: "claude Parent" } },
	{ id: "J4", file: "install", hosts: { claude: "Claude Code at the", pi: "Pi installs", antigravity: "Antigravity's packed plugin" } },
];

export interface JourneyAttempt {
	result: "pass" | "fail";
	duration_ms: number;
	log_sha256: string;
}
export interface JourneyRecord {
	id: JourneyId;
	host: string;
	result: "pass" | "fail";
	attempts: JourneyAttempt[];
}
export interface LiveEvidence {
	contract: typeof EVIDENCE_CONTRACT;
	version: string;
	commit: string;
	mode: "live";
	hosts: Record<string, string>;
	journeys: JourneyRecord[];
	checklist: [];
}

/** What one journey attempt reports: whether it passed and the output that the log hash covers. */
export type JourneyRunner = (plan: JourneyPlan, host: string, timeoutMs: number) => Promise<{ passed: boolean; log: string }>;

export interface LiveOptions {
	version: string;
	commit: string;
	hosts: Record<string, string>;
	/** Directory that receives <version>.json. */
	outDir: string;
	run: JourneyRunner;
	plan?: JourneyPlan[];
	maxAttempts?: number;
	budgetMs?: number;
	now?: () => number;
	log?: (line: string) => void;
}

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/**
 * Runs every planned journey and Host in order, retrying a failed attempt once, and writes the
 * evidence file. A journey whose attempts all failed is recorded as failed with every attempt; the
 * file is written either way so a failing run leaves its record, and `passed` tells the caller.
 */
export async function runLive(options: LiveOptions): Promise<{ evidence: LiveEvidence; path: string; passed: boolean }> {
	const now = options.now ?? Date.now;
	const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
	const deadline = now() + (options.budgetMs ?? LIVE_BUDGET_MS);
	const say = options.log ?? (() => {});
	const journeys: JourneyRecord[] = [];
	for (const plan of options.plan ?? LIVE_PLAN) {
		for (const host of Object.keys(plan.hosts)) {
			const attempts: JourneyAttempt[] = [];
			while (attempts.length < maxAttempts && attempts.at(-1)?.result !== "pass") {
				const remaining = deadline - now();
				if (remaining <= 0) break;
				const started = now();
				let outcome: { passed: boolean; log: string };
				try {
					outcome = await options.run(plan, host, Math.min(remaining, ATTEMPT_TIMEOUT_MS));
				} catch (error) {
					outcome = { passed: false, log: `runner_error: ${(error as Error).message}` };
				}
				attempts.push({ result: outcome.passed ? "pass" : "fail", duration_ms: Math.max(0, now() - started), log_sha256: sha256(outcome.log) });
				say(`${plan.id} ${host} attempt ${attempts.length}: ${attempts.at(-1)!.result}`);
			}
			if (!attempts.length) attempts.push({ result: "fail", duration_ms: 0, log_sha256: sha256("budget_exhausted") });
			journeys.push({ id: plan.id, host, result: attempts.at(-1)!.result, attempts });
		}
	}
	const evidence: LiveEvidence = { contract: EVIDENCE_CONTRACT, version: options.version, commit: options.commit, mode: "live", hosts: options.hosts, journeys, checklist: [] };
	mkdirSync(options.outDir, { recursive: true });
	const path = join(options.outDir, `${options.version}.json`);
	writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`);
	return { evidence, path, passed: journeys.every((journey) => journey.result === "pass") };
}

/** A journey attempt passes only when bun exited 0 in time AND at least one test ran and passed: a name pattern that selects nothing also exits 0. */
export function judgeBunTest(exitCode: number, log: string, timedOut = false): boolean {
	return exitCode === 0 && !timedOut && /^\s*([1-9]\d*) pass\b/m.test(log);
}

/** The journey child: `bun test` of one journey file filtered to one Host, recording cassettes against the real API. */
export const runJourneyProcess: JourneyRunner = async (plan, host, timeoutMs) => {
	const child = Bun.spawn(["bun", "test", "--timeout", "600000", "--path-ignore-patterns", "node_modules/**", `./tests/e2e/${plan.file}.e2e.ts`, "--test-name-pattern", plan.hosts[host]], {
		cwd: REPO,
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, E2E: "1", E2E_RECORD: "1", E2E_LIVE: "1", E2E_LIVE_MODEL: process.env.E2E_LIVE_MODEL || LIVE_MODEL_TIER },
	});
	let timedOut = false;
	const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
	const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	clearTimeout(timer);
	const log = `${stdout}${stderr}${timedOut ? "\nattempt_timeout" : ""}`;
	return { passed: judgeBunTest(code, log, timedOut), log };
};

const versionOf = (text: string): string | undefined => /\d+\.\d+\.\d+/.exec(text)?.[0];

/** The installed Host versions the evidence records (claude, pi, herdr). An unreadable one aborts the run. */
export async function detectHostVersions(bins: Record<string, string> = { claude: process.env.E2E_CLAUDE_BIN || "claude", pi: process.env.E2E_PI_BIN || "pi", herdr: process.env.E2E_HERDR_BIN || "herdr" }): Promise<Record<string, string>> {
	const found: Record<string, string> = {};
	for (const [name, bin] of Object.entries(bins)) {
		let text = "";
		try {
			const child = Bun.spawn([bin, "--version"], { stdout: "pipe", stderr: "pipe" });
			const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
			text = stdout + stderr;
		} catch { /* binary absent */ }
		const version = versionOf(text);
		if (!version) throw new Error(`host_version_unavailable: ${bin} --version did not report a version`);
		found[name] = version;
	}
	return found;
}

function git(...args: string[]): string {
	const result = Bun.spawnSync(["git", ...args], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) throw new Error(`git_failed: git ${args.join(" ")}: ${result.stderr.toString().trim()}`);
	return result.stdout.toString().trim();
}

/** The version and commit the evidence binds: the tagged release commit must be the checked-out HEAD. */
export function resolveRelease(version: string | undefined): { version: string; commit: string } {
	const resolved = version ?? JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).version;
	if (!/^\d+\.\d+\.\d+$/.test(resolved)) throw new Error(`invalid_version: ${JSON.stringify(resolved)}`);
	const commit = git("rev-parse", "HEAD");
	const tag = Bun.spawnSync(["git", "rev-parse", "--verify", "--quiet", `refs/tags/immune-brain-v${resolved}^{commit}`], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
	const tagged = tag.exitCode === 0 ? tag.stdout.toString().trim() : undefined;
	if (tagged && tagged !== commit) throw new Error(`release_commit_mismatch: immune-brain-v${resolved} is ${tagged} but HEAD is ${commit}; check out the release tag first`);
	if (git("status", "--porcelain", "--untracked-files=no")) throw new Error("worktree_dirty: the evidence binds a commit, so tracked files must match HEAD");
	return { version: resolved, commit };
}

export async function main(argv: string[]): Promise<number> {
	const flag = (name: string): string | undefined => { const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : undefined; };
	try {
		if (!process.env.ANTHROPIC_API_KEY) throw new Error("record_credentials_missing: bun run e2e:live needs ANTHROPIC_API_KEY in the maintainer's environment");
		const release = resolveRelease(flag("--version"));
		const hosts = await detectHostVersions();
		const { path, passed, evidence } = await runLive({ ...release, hosts, outDir: resolve(flag("--out-dir") ?? join(REPO, "docs/evidence/e2e-live")), run: runJourneyProcess, log: (line) => console.error(line) });
		console.log(`e2e:live ${passed ? "passed" : "FAILED"}: ${evidence.journeys.filter((journey) => journey.result === "pass").length}/${evidence.journeys.length} journeys, evidence at ${path}`);
		return passed ? 0 : 1;
	} catch (error) {
		console.error(`e2e:live refused ${(error as Error).message}`);
		return 2;
	}
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
