// The e2e escape rule (Spec e2e-release-gate D9): a pull request titled `fix` that changes
// plugin runtime must also change tests/e2e/, or state `e2e-exempt: <reason>` in its body.
//
// CI runs `bun scripts/check-e2e-escape-rule.ts` on pull_request events. It reads the title and
// body from the event payload and the changed paths from `git diff --name-only base...head`;
// any other event skips. `evaluateEscapeRule` is the pure decision the tests exercise.

import { readFileSync } from "node:fs";

export const FIX_TITLE = /^fix(\(|:|!)/;
export const RUNTIME_PREFIXES = ["plugins/immune-brain/runtime/", "plugins/immune-brain/.pi-extension/", "plugins/immune-brain/hooks/"];
export const E2E_PREFIX = "tests/e2e/";
const EXEMPT_LINE = /^[ \t]*e2e-exempt:[ \t]*(.*)$/gm;

export interface EscapeRuleInput {
	title: string;
	body: string | null | undefined;
	changedPaths: readonly string[];
}

export type EscapeRuleDecision =
	| { ok: true; reason: "not_fix_title" | "no_runtime_change" | "e2e_changed" | "exempt"; exemptReason?: string }
	| { ok: false; reason: "e2e_required" | "exempt_reason_empty"; runtimePaths: string[] };

/** The first non-empty `e2e-exempt: <reason>` reason in a PR body, and whether a bare marker was seen. */
function readExemption(body: string): { reason?: string; sawEmpty: boolean } {
	let sawEmpty = false;
	for (const match of body.matchAll(EXEMPT_LINE)) {
		const reason = match[1].trim();
		if (reason) return { reason, sawEmpty };
		sawEmpty = true;
	}
	return { sawEmpty };
}

export function evaluateEscapeRule(input: EscapeRuleInput): EscapeRuleDecision {
	if (!FIX_TITLE.test(input.title)) return { ok: true, reason: "not_fix_title" };
	const runtimePaths = input.changedPaths.filter((path) => RUNTIME_PREFIXES.some((prefix) => path.startsWith(prefix)));
	if (!runtimePaths.length) return { ok: true, reason: "no_runtime_change" };
	if (input.changedPaths.some((path) => path.startsWith(E2E_PREFIX))) return { ok: true, reason: "e2e_changed" };
	const exemption = readExemption(input.body ?? "");
	if (exemption.reason) return { ok: true, reason: "exempt", exemptReason: exemption.reason };
	return { ok: false, reason: exemption.sawEmpty ? "exempt_reason_empty" : "e2e_required", runtimePaths };
}

export function describeDecision(decision: EscapeRuleDecision): string {
	if (decision.ok) return `e2e escape rule: pass (${decision.reason}${decision.exemptReason ? `: ${decision.exemptReason}` : ""})`;
	const files = decision.runtimePaths.map((path) => `  - ${path}`).join("\n");
	const why = decision.reason === "exempt_reason_empty" ? "the body has an `e2e-exempt:` line with no reason" : "it changes nothing under `tests/e2e/` and its body has no `e2e-exempt: <reason>` line";
	return `e2e escape rule: a \`fix\` pull request changes plugin runtime but ${why}.\nRuntime paths changed:\n${files}\nAdd or extend an L1 journey under tests/e2e/, or add a body line \`e2e-exempt: <reason>\`.`;
}

interface PullRequestEvent {
	pull_request?: { title?: string; body?: string | null; base?: { sha?: string }; head?: { sha?: string } };
}

/** Runs the rule for one CI event; returns the process exit code. */
export function run(env: Record<string, string | undefined>, git: (args: string[]) => string, log: (line: string) => void = console.log): number {
	if (env.GITHUB_EVENT_NAME !== "pull_request") {
		log(`e2e escape rule: skipped (event ${env.GITHUB_EVENT_NAME ?? "none"} is not a pull request)`);
		return 0;
	}
	if (!env.GITHUB_EVENT_PATH) {
		log("e2e escape rule: GITHUB_EVENT_PATH is not set");
		return 2;
	}
	const pr = (JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8")) as PullRequestEvent).pull_request;
	const base = pr?.base?.sha;
	const head = pr?.head?.sha;
	if (!pr || !base || !head) {
		log("e2e escape rule: the pull_request event lacks a title, base sha or head sha");
		return 2;
	}
	const changedPaths = git(["diff", "--name-only", `${base}...${head}`]).split("\n").filter(Boolean);
	const decision = evaluateEscapeRule({ title: pr.title ?? "", body: pr.body, changedPaths });
	log(describeDecision(decision));
	return decision.ok ? 0 : 1;
}

if (import.meta.main) {
	const git = (args: string[]): string => {
		const done = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "pipe" });
		if (done.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${done.stderr.toString().trim()}`);
		return done.stdout.toString();
	};
	process.exit(run(process.env, git));
}
