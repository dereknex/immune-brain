// v4 storage retirement — acc-v3-writers-retired.
// No shipped production command, migration path, recovery hook, observer,
// runtime adapter, or host integration can create or mutate the v3 State
// Ledger, v3 authority-commit receipts, or v3 automatic-observation journals.
// This is a shipped-reachability contract: the legacy implementation modules
// remain for tests/history, but no bin/* wrapper, v4 CLI dispatcher, Pi
// extension factory, or command manifest may reach a v3 writer.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const BIN = join(ROOT, "plugins/immune-brain/bin");
const V4 = join(ROOT, "plugins/immune-brain/runtime/v4_runtime.ts");
const EXT = join(ROOT, "plugins/immune-brain/.pi-extension");

const V3_WRITER_SYMBOLS = [
	"commitStateMutation",
	"migrateProject",
	"saveStateLedger",
	"appendJournalEntry",
	"appendObservationJournalEntry",
	"writeTaskRecord",
	"applyTaskAction",
	"readAuthorityCommitReceipts",
	"readAutomaticObservationsV2",
];

describe("v4 storage retirement: v3 writers retired from shipped surface", () => {
	test("every bin wrapper enters only the v4 runtime", () => {
		const wrappers = readdirSync(BIN).filter((f) => f.startsWith("imm-") && f !== "imm-pr-diag");
		expect(wrappers.length).toBeGreaterThan(0);
		for (const w of wrappers) {
			const content = readFileSync(join(BIN, w), "utf8");
			expect(content).toContain("runtime/v4_runtime.ts");
			expect(content).not.toContain("immune_brain_runtime.ts");
		}
	});

	test("v4 runtime never imports the legacy runtime or any v3 writer", () => {
		const source = readFileSync(V4, "utf8");
		expect(source).not.toContain("immune_brain_runtime");
		expect(source).not.toContain("state_ledger");
		expect(source).not.toContain("project_migration");
		expect(source).not.toContain("authority_commit_receipts");
		expect(source).not.toContain("automatic_observations");
		for (const symbol of V3_WRITER_SYMBOLS) {
			expect(source).not.toContain(symbol);
		}
	});

	test("Pi extension factories never import a v3 writer", () => {
		const factories = [
			"imm-canary-enroll.ts",
			"imm-canary-work.ts",
		];
		for (const f of factories) {
			const source = readFileSync(join(EXT, f), "utf8");
			expect(source).not.toContain("authority_commit_receipts");
			expect(source).not.toContain("automatic_observations");
			expect(source).not.toContain("state_ledger");
			expect(source).not.toContain("project_migration");
			expect(source).not.toContain("migrateProject");
		}
	});

	test("legacy runtime is retired from source", () => {
		// The legacy runtime file is deleted; no shipped bin or extension may
		// reference it.
		const legacy = join(ROOT, "plugins/immune-brain/runtime/immune_brain_runtime.ts");
		expect(existsSync(legacy)).toBe(false);
		const bins = readdirSync(BIN).filter((f) => f.startsWith("imm-") && f !== "imm-pr-diag");
		for (const w of bins) {
			const content = readFileSync(join(BIN, w), "utf8");
			expect(content).not.toContain("immune_brain_runtime");
		}
	});
});
