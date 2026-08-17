import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	captureStateCommitExpectation,
	commitStateMutation,
	createEmptyStateLedger,
	HISTORY_TAIL_LIMIT,
	loadStateLedger,
	normalizeCurrentIteration,
	saveStateLedger,
} from "../plugins/immune-brain/runtime/state_ledger";

let root: string;
let statePath: string;

function ledgerWithHistory(count: number): any {
	const state: any = createEmptyStateLedger();
	state.plan_path = "docs/plans/plan.md";
	state.plan_signature = "sig-1";
	state.history = Array.from({ length: count }, (_, index) => ({
		at: `2026-08-01T00:00:${String(index % 60).padStart(2, "0")}Z`,
		action: "review_step",
		details: { seq: index },
	}));
	return state;
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "imm-bounded-history-"));
	mkdirSync(join(root, ".imm", "memory"), { recursive: true });
	statePath = join(root, ".imm", "memory", "current_iteration.json");
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("bounded State Ledger history", () => {
	it("keeps only the newest tail entries in the hot file", () => {
		const overflow = 12;
		saveStateLedger(statePath, ledgerWithHistory(HISTORY_TAIL_LIMIT + overflow));

		const persisted: any = loadStateLedger(statePath);

		expect(persisted.history).toHaveLength(HISTORY_TAIL_LIMIT);
		expect(persisted.history[0].details.seq).toBe(overflow);
		expect(persisted.history.at(-1).details.seq).toBe(
			HISTORY_TAIL_LIMIT + overflow - 1,
		);
	});

	it("writes every trimmed entry to the archive instead of dropping it", () => {
		const overflow = 12;
		saveStateLedger(statePath, ledgerWithHistory(HISTORY_TAIL_LIMIT + overflow));

		const archived = readFileSync(
			join(root, ".imm", "memory", "current_iteration_history.jsonl"),
			"utf8",
		)
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));

		const entries = archived.flatMap((record: any) => record.history);
		expect(entries).toHaveLength(overflow);
		expect(entries.map((entry: any) => entry.details.seq)).toEqual(
			Array.from({ length: overflow }, (_, index) => index),
		);
		expect(archived[0].plan_path).toBe("docs/plans/plan.md");
		expect(archived[0].plan_signature).toBe("sig-1");
		expect(typeof archived[0].archived_at).toBe("string");
	});

	it("leaves a Ledger sitting exactly at the limit untouched", () => {
		saveStateLedger(statePath, ledgerWithHistory(HISTORY_TAIL_LIMIT));

		const persisted: any = loadStateLedger(statePath);

		expect(persisted.history).toHaveLength(HISTORY_TAIL_LIMIT);
		expect(persisted.history[0].details.seq).toBe(0);
		expect(
			existsSync(join(root, ".imm", "memory", "current_iteration_history.jsonl")),
		).toBe(false);
	});

	it("does not re-archive entries a previous save already archived", () => {
		const state = ledgerWithHistory(HISTORY_TAIL_LIMIT + 5);
		saveStateLedger(statePath, state);
		state.history.push({
			at: "2026-08-01T01:00:00Z",
			action: "review_step",
			details: { seq: 999 },
		});
		saveStateLedger(statePath, state);

		const entries = readFileSync(
			join(root, ".imm", "memory", "current_iteration_history.jsonl"),
			"utf8",
		)
			.trim()
			.split("\n")
			.flatMap((line) => JSON.parse(line).history)
			.map((entry: any) => entry.details.seq);

		expect(entries).toEqual([...entries].filter((v, i, a) => a.indexOf(v) === i));
		expect(entries).toEqual([0, 1, 2, 3, 4, 5]);
	});

	it("keeps the oversized history when the archive cannot be written", () => {
		mkdirSync(join(root, ".imm", "memory", "current_iteration_history.jsonl"));
		const total = HISTORY_TAIL_LIMIT + 5;

		expect(() => saveStateLedger(statePath, ledgerWithHistory(total))).toThrow();

		const persisted: any = loadStateLedger(statePath);
		expect(persisted === null || persisted.history.length === total).toBe(true);
	});
});

describe("compaction on the command write path", () => {
	/** Mirrors the oversized Ledger that predates compaction. */
	function seedOversizedLedger(count: number): void {
		mkdirSync(join(root, "docs", "plans"), { recursive: true });
		writeFileSync(join(root, "docs", "plans", "plan.md"), "# Iteration Plan\n");
		writeFileSync(
			statePath,
			JSON.stringify(ledgerWithHistory(count), null, 2),
			"utf8",
		);
	}

	it("compacts through commitStateMutation, not just saveStateLedger", () => {
		seedOversizedLedger(HISTORY_TAIL_LIMIT + 7);
		const state = normalizeCurrentIteration(
			loadStateLedger(statePath) as any,
		) as any;

		commitStateMutation(
			statePath,
			state,
			captureStateCommitExpectation(state),
		);

		expect((loadStateLedger(statePath) as any).history).toHaveLength(
			HISTORY_TAIL_LIMIT,
		);
	});
});
