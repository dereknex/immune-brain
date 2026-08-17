import { afterEach, describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	captureStateCommitExpectation,
	commitAuthorityStateIfUnchanged,
	commitStateIfUnchanged,
	commitStateMutation,
	createEmptyStateLedger,
	loadStateLedger,
	normalizeCurrentIteration,
	saveStateLedgerForTest,
} from "../plugins/immune-brain/runtime/state_ledger";
import {
	automaticObservationJournalPath,
	readAutomaticObservationsV2,
} from "../plugins/immune-brain/runtime/kernel/automatic_observations";
import {
	prepareAuthorityCommit,
	readAuthorityCommitReceipts,
	recoverAuthorityCommitReceipts,
	receiptJournalPath,
	setBeforeAuthorityReceiptAppendForTest,
	terminalizeAuthorityCommit,
} from "../plugins/immune-brain/runtime/authority_commit_receipts";

const roots: string[] = [];

function tempRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "imm-authority-receipt-"));
	roots.push(root);
	mkdirSync(join(root, ".imm", "memory"), { recursive: true });
	return root;
}

function ledgerPath(root: string): string {
	return join(root, ".imm", "memory", "current_iteration.json");
}

function bytes(value: string): string {
	return JSON.stringify({ value }, null, 2) + "\n";
}

function prepare(root: string, before: string | null, after: string) {
	return prepareAuthorityCommit(ledgerPath(root), {
		source_kind: "state_mutation",
		ledger_revision: `revision-${after.length}`,
		source_ref: "test",
		targets: [
			{
				absolute_path: ledgerPath(root),
				before_bytes: before,
				after_bytes: after,
			},
		],
	});
}

afterEach(() => {
	setBeforeAuthorityReceiptAppendForTest(null);
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

describe("durable authority commit receipts", () => {
	it("assigns unique attempt identities to A-B-A-B commits and chains every record", () => {
		const root = tempRoot();
		const a = bytes("A");
		const b = bytes("B");
		writeFileSync(ledgerPath(root), a);

		const attempts = [];
		const first = prepare(root, a, b);
		attempts.push(first);
		writeFileSync(ledgerPath(root), b);
		terminalizeAuthorityCommit(ledgerPath(root), first, "committed");
		const second = prepare(root, b, a);
		attempts.push(second);
		writeFileSync(ledgerPath(root), a);
		terminalizeAuthorityCommit(ledgerPath(root), second, "committed");
		const third = prepare(root, a, b);
		attempts.push(third);
		writeFileSync(ledgerPath(root), b);
		terminalizeAuthorityCommit(ledgerPath(root), third, "committed");

		expect(new Set(attempts.map((attempt) => attempt.attempt_id)).size).toBe(3);
		const records = readAuthorityCommitReceipts(ledgerPath(root));
		expect(records.map((record) => record.status)).toEqual([
			"prepared",
			"committed",
			"prepared",
			"committed",
			"prepared",
			"committed",
		]);
		for (let index = 0; index < records.length; index += 1) {
			expect(records[index].previous_record_hash).toBe(
				index === 0 ? null : records[index - 1].record_id,
			);
		}
		expect(existsSync(receiptJournalPath(ledgerPath(root)))).toBe(true);
	});

	it("recovers prepared attempts from exact before or after bytes", () => {
		const root = tempRoot();
		const a = bytes("A");
		const b = bytes("B");
		writeFileSync(ledgerPath(root), a);

		const committed = prepare(root, a, b);
		writeFileSync(ledgerPath(root), b);
		expect(recoverAuthorityCommitReceipts(ledgerPath(root))).toMatchObject([
			{ attempt_id: committed.attempt_id, status: "recovered_committed" },
		]);

		const aborted = prepare(root, b, a);
		expect(recoverAuthorityCommitReceipts(ledgerPath(root))).toMatchObject([
			{ attempt_id: aborted.attempt_id, status: "recovered_aborted" },
		]);
		expect(recoverAuthorityCommitReceipts(ledgerPath(root))).toEqual([]);
	});

	it("fails closed when a prepared attempt observes a third state", () => {
		const root = tempRoot();
		const a = bytes("A");
		const b = bytes("B");
		writeFileSync(ledgerPath(root), a);
		prepare(root, a, b);
		writeFileSync(ledgerPath(root), bytes("C"));

		expect(() => recoverAuthorityCommitReceipts(ledgerPath(root))).toThrow(
			"authority receipt recovery is ambiguous",
		);
	});

	it("rejects a broken hash chain before accepting another record", () => {
		const root = tempRoot();
		const a = bytes("A");
		const b = bytes("B");
		writeFileSync(ledgerPath(root), a);
		prepare(root, a, b);
		const journal = receiptJournalPath(ledgerPath(root));
		const lines = readFileSync(journal, "utf8").trimEnd().split("\n");
		const record = JSON.parse(lines[0]);
		record.source_ref = "tampered";
		writeFileSync(journal, `${JSON.stringify(record)}\n`);

		expect(() => readAuthorityCommitReceipts(ledgerPath(root))).toThrow(
			"record hash mismatch",
		);
		expect(() => prepare(root, a, b)).toThrow("record hash mismatch");
	});

	it("prevents a commit attempt when the prepared receipt cannot be fsynced", () => {
		const root = tempRoot();
		const a = bytes("A");
		const b = bytes("B");
		writeFileSync(ledgerPath(root), a);
		setBeforeAuthorityReceiptAppendForTest((record) => {
			if (record.status === "prepared") throw new Error("receipt disk full");
		});

		expect(() => prepare(root, a, b)).toThrow("receipt disk full");
		expect(readFileSync(ledgerPath(root), "utf8")).toBe(a);
	});

	it("records receipt-backed authority CAS commits and rejects stale retries", () => {
		const root = tempRoot();
		const statePath = ledgerPath(root);
		saveStateLedgerForTest(statePath, createEmptyStateLedger());
		const persisted = normalizeCurrentIteration(loadStateLedger(statePath)!);
		const expected = captureStateCommitExpectation(persisted);
		const proposed = structuredClone(persisted);
		proposed.runtime_status = "active";

		expect(
			commitAuthorityStateIfUnchanged(
				statePath,
				proposed,
				expected,
				"imm-autowork:snapshot",
			),
		).toBe(true);
		const afterCommit = readAuthorityCommitReceipts(statePath);
		expect(afterCommit.map((record) => record.status)).toEqual([
			"prepared",
			"committed",
		]);
		const observations = readAutomaticObservationsV2(root);
		expect(observations.map((entry) => entry.receipt_attempt_id)).toEqual([
			afterCommit[0]!.attempt_id,
		]);

		const staleProposal = structuredClone(proposed);
		staleProposal.requires_replan = true;
		expect(
			commitAuthorityStateIfUnchanged(
				statePath,
				staleProposal,
				expected,
				"imm-autowork:snapshot",
			),
		).toBe(false);
		expect(readAuthorityCommitReceipts(statePath)).toHaveLength(2);
	});

	it("recovers a normal commit interrupted after Ledger rename before another write", () => {
		const root = tempRoot();
		const statePath = ledgerPath(root);
		saveStateLedgerForTest(statePath, createEmptyStateLedger());
		const childScript = join(root, "kill-normal-commit.ts");
		const ledgerModule = resolve(
			"plugins/immune-brain/runtime/state_ledger.ts",
		);
		const receiptModule = resolve(
			"plugins/immune-brain/runtime/authority_commit_receipts.ts",
		);
		writeFileSync(
			childScript,
			`import { captureStateCommitExpectation, commitStateMutation, loadStateLedger, normalizeCurrentIteration } from ${JSON.stringify(ledgerModule)};\n` +
				`import { setBeforeAuthorityReceiptAppendForTest } from ${JSON.stringify(receiptModule)};\n` +
				`const path = ${JSON.stringify(statePath)};\n` +
				`const state = normalizeCurrentIteration(loadStateLedger(path));\n` +
				`const expected = captureStateCommitExpectation(state);\n` +
				`state.runtime_status = "active";\n` +
				`setBeforeAuthorityReceiptAppendForTest((record) => { if (record.status === "committed") process.kill(process.pid, "SIGKILL"); });\n` +
				`commitStateMutation(path, state, expected);\n`,
		);
		const child = Bun.spawnSync([process.execPath, childScript], {
			cwd: root,
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(child.exitCode).not.toBe(0);
		expect(loadStateLedger(statePath)?.runtime_status).toBe("active");
		expect(readAuthorityCommitReceipts(statePath).map((record) => record.status)).toEqual([
			"prepared",
		]);

		// The Ledger lock is intentionally operator-recovered after an unclean kill.
		rmSync(`${statePath}.write.lock`, { recursive: true, force: true });
		const next = normalizeCurrentIteration(loadStateLedger(statePath)!);
		const nextExpected = captureStateCommitExpectation(next);
		next.requires_replan = true;
		commitStateMutation(statePath, next, nextExpected);

		const receipts = readAuthorityCommitReceipts(statePath);
		expect(receipts.map((record) => record.status)).toEqual([
			"prepared",
			"recovered_committed",
			"prepared",
			"committed",
		]);
		const observations = readAutomaticObservationsV2(root);
		expect(observations.map((entry) => entry.receipt_attempt_id)).toEqual([
			receipts[0]!.attempt_id,
			receipts[2]!.attempt_id,
		]);
	});

	it("replays an observation from the terminal seed after append failure and a later commit", () => {
		const root = tempRoot();
		const statePath = ledgerPath(root);
		saveStateLedgerForTest(statePath, createEmptyStateLedger());
		const journal = automaticObservationJournalPath(root);
		const outside = join(root, "outside-observations.jsonl");
		writeFileSync(outside, "");
		symlinkSync(outside, journal);

		const first = normalizeCurrentIteration(loadStateLedger(statePath)!);
		const firstExpected = captureStateCommitExpectation(first);
		first.runtime_status = "active";
		commitStateMutation(statePath, first, firstExpected);
		expect(readAuthorityCommitReceipts(statePath).map((record) => record.status)).toEqual([
			"prepared",
			"committed",
		]);
		rmSync(journal);

		const second = normalizeCurrentIteration(loadStateLedger(statePath)!);
		const secondExpected = captureStateCommitExpectation(second);
		second.requires_replan = true;
		commitStateMutation(statePath, second, secondExpected);

		const receipts = readAuthorityCommitReceipts(statePath);
		const terminals = receipts.filter(
			(record) => record.status === "committed" || record.status === "recovered_committed",
		);
		const observations = readAutomaticObservationsV2(root);
		expect(observations).toHaveLength(2);
		expect(observations.map((entry) => entry.receipt_record_id)).toEqual(
			terminals.map((record) => record.record_id),
		);
		expect(observations[0]!.committed_bytes_sha256).toBe(
			terminals[0]!.observation_seed!.committed_bytes_sha256,
		);
		expect(observations[0]!.committed_bytes_sha256).not.toBe(
			observations[1]!.committed_bytes_sha256,
		);
	});

	it("keeps the snapshot writer projection-only", () => {
		const root = tempRoot();
		const statePath = ledgerPath(root);
		saveStateLedgerForTest(statePath, createEmptyStateLedger());
		const persisted = normalizeCurrentIteration(loadStateLedger(statePath)!);
		const allowed = structuredClone(persisted);
		(allowed as any).completed_steps = ["1"];
		(allowed as any).active_step = null;
		(allowed as any).next_action = "render-only";
		expect(
			commitStateIfUnchanged(
				statePath,
				allowed,
				captureStateCommitExpectation(persisted),
			),
		).toBe(true);

		const afterProjection = loadStateLedger(statePath)!;
		const forbidden = structuredClone(afterProjection);
		forbidden.runtime_status = "active";
		expect(() =>
			commitStateIfUnchanged(
				statePath,
				forbidden,
				captureStateCommitExpectation(afterProjection),
			),
		).toThrow("authority-owned Ledger fields");
	});

	it("keeps a successful authority outcome recoverable when terminal append fails", () => {
		const root = tempRoot();
		const a = bytes("A");
		const b = bytes("B");
		writeFileSync(ledgerPath(root), a);
		const attempt = prepare(root, a, b);
		writeFileSync(ledgerPath(root), b);
		setBeforeAuthorityReceiptAppendForTest((record) => {
			if (record.status === "committed") throw new Error("terminal disk full");
		});
		expect(() =>
			terminalizeAuthorityCommit(ledgerPath(root), attempt, "committed"),
		).toThrow("terminal disk full");
		setBeforeAuthorityReceiptAppendForTest(null);

		expect(recoverAuthorityCommitReceipts(ledgerPath(root))).toMatchObject([
			{ attempt_id: attempt.attempt_id, status: "recovered_committed" },
		]);
	});
});
