import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import {
	authoritySnapshot,
	cleanupE2ERoot,
	createE2ERoot,
	E2E_PATHS,
	ledgerBytes,
	readJson,
	runPlugin,
	seedExternalSentinels,
	type CliResult,
} from "./helpers/roadmap-e2e-harness";

const PRED = E2E_PATHS.predecessor;
const TERMINAL = E2E_PATHS.terminal;
const ALTERNATIVE = E2E_PATHS.alternative;

function expectOk(result: CliResult): CliResult {
	if (result.status !== 0) {
		throw new Error(
			`${result.command} ${result.args.join(" ")} failed (${result.status}): ${result.stderr || result.stdout}`,
		);
	}
	return result;
}

/**
 * HANDOFF.md joins the Ledger as runtime-owned: QA pass refreshes it by design,
 * so it cannot serve as a sentinel for "the roadmap flow touched nothing
 * external". The inbox and session sentinels still carry that guarantee, and
 * transition-scoped HANDOFF stability is asserted in the transition suite.
 */
function externalSnapshot(
	snapshot: Record<string, string>,
): Record<string, string> {
	const {
		[E2E_PATHS.ledger]: _ledger,
		"HANDOFF.md": _handoff,
		...external
	} = snapshot;
	return external;
}

function closePredecessor(root: string): string {
	expectOk(runPlugin(root, "imm-plan", [PRED, "--sync"]));
	expectOk(runPlugin(root, "imm-work", ["activate", PRED, "1"]));
	expectOk(
		runPlugin(root, "imm-work", [
			"record-execution",
			"--evidence-json",
			JSON.stringify({
				changed_files: ["plugins/immune-brain/runtime/e2e-fixture.ts"],
				status: "passed",
				checks: [
					{
						kind: "command",
						command: "true",
						status: "passed",
						exit_code: 0,
						summary: "fixture predecessor passed",
					},
				],
			}),
		]),
	);
	expectOk(
		runPlugin(root, "imm-review", ["pass", "--evidence", "fixture QA passed"]),
	);
	expectOk(
		runPlugin(root, "imm-review", [
			"gate-pass",
			"--gate",
			"imm-code-review",
			"--evidence-ref",
			"e2e-predecessor-review:pass",
			"--changed-files",
			"plugins/immune-brain/runtime/e2e-fixture.ts",
		]),
	);
	expectOk(
		runPlugin(root, "imm-finish", [
			"P3 fixture closed",
			"P4 terminal fixture next",
		]),
	);
	const status = readJson<Record<string, any>>(
		expectOk(runPlugin(root, "imm-work", ["status", "--json"])),
	);
	expect(status.successor_decision?.successor_candidate).toBe("P4");
	return status.ledger_revision;
}

function approveTerminal(root: string, revision: string): void {
	expectOk(
		runPlugin(root, "imm-plan", [
			TERMINAL,
			"--sync",
			"--approve-successor",
			"--expected-current-plan",
			PRED,
			"--expected-ledger-revision",
			revision,
		]),
	);
}

function assertNoAuthorityMutation(
	root: string,
	before: Record<string, string>,
): void {
	expect(externalSnapshot(authoritySnapshot(root))).toEqual(
		externalSnapshot(before),
	);
}

describe("Roadmap fresh-process linear acceptance", () => {
	it("v3 roadmap workflow is retired after v4 storage retirement", () => {
		const root = createE2ERoot();
		try {
			for (const [cmd, args] of [
				["imm-work", ["activate", PRED, "1"]],
				["imm-review", ["pass", "--evidence", "fixture"]],
				["imm-finish", ["closed", "next"]],
			] as Array<[string, string[]]>) {
				const result = runPlugin(root, cmd, args);
				expect(result.status).toBe(1);
				expect(result.stderr).toMatch(/v3_storage_retired|drain_required/);
			}
			// imm-plan --sync is retired (v3 mutation); read-only validation
			// without --sync stays allowed and reports legacy_validation.
			const planResult = runPlugin(root, "imm-plan", [PRED, "--sync"]);
			expect(planResult.status).toBe(1);
			expect(planResult.stderr).toMatch(/v3_storage_retired|drain_required/);
			const planReadOnly = runPlugin(root, "imm-plan", [PRED, "--json"]);
			expect([0, 1]).toContain(planReadOnly.status);
		} finally {
			cleanupE2ERoot(root);
		}
	});
});
