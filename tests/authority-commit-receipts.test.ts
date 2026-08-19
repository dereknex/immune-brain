import { afterEach, describe, expect, it } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
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
import {
	AUTHORITY_OBSERVATION_GENERATION_V2,
	AUTHORITY_OBSERVER_VERSION_V2,
	authorityStatePathIdentity,
	prepareAuthorityCommit,
	readAuthorityCommitReceipts,
	recoverAuthorityCommitReceipts,
	receiptJournalPath,
	setBeforeAuthorityReceiptAppendForTest,
	terminalizeAuthorityCommit,
	type AuthorityObservationSeedV2,
} from "../plugins/immune-brain/runtime/authority_commit_receipts";
import { buildAutomaticObservationV2 } from "../plugins/immune-brain/runtime/kernel/observation";
import {
	appendAutomaticObservationV2,
	readAutomaticObservationsV2,
} from "../plugins/immune-brain/runtime/kernel/automatic_observations";

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

function sha256(value: string): string {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function observationSeed(
	statePath: string,
	content: string,
): AuthorityObservationSeedV2 {
	return {
		contract: "assurance_kernel/authority_observation_seed/v2",
		observer_version: AUTHORITY_OBSERVER_VERSION_V2,
		source_kind: "state_mutation",
		source_ref: `history:${randomUUID()}`,
		state_path_identity: authorityStatePathIdentity(statePath),
		committed_bytes_sha256: sha256(content),
		committed_revision: "ledger-revision-1",
		committed_at: "2026-08-11T00:00:00.000Z",
		plan_path: "docs/plans/example.md",
		plan_signature: "plan-signature",
		source_events: [
			{
				id: "history-1",
				action: "execution_recorded",
				at: "2026-08-11T00:00:00.000Z",
			},
		],
		shadow: {
			phase: "working",
			reason: "legacy-active",
			ambiguous: false,
			source_states: ["active"],
		},
		divergence: { detected: false, fields: [] },
	};
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

	it("binds automatic observations to a terminal v2 receipt", () => {
		const root = tempRoot();
		const statePath = ledgerPath(root);
		const content = '{"schema_version":3}\n';
		writeFileSync(statePath, content);
		const seed = observationSeed(statePath, content);
		const prepared = prepareAuthorityCommit(statePath, {
			source_kind: "state_mutation",
			targets: [{ absolute_path: statePath, before_bytes: "before", after_bytes: content }],
			ledger_revision: seed.committed_revision,
			source_ref: seed.source_ref,
			attempt_id: randomUUID(),
			observation_generation: AUTHORITY_OBSERVATION_GENERATION_V2,
			observation_seed: seed,
		});
		const terminal = terminalizeAuthorityCommit(statePath, prepared, "committed");
		const observation = buildAutomaticObservationV2(terminal);

		expect(appendAutomaticObservationV2(root, observation)).toBe("appended");
		expect(appendAutomaticObservationV2(root, observation)).toBe("duplicate");
		expect(readAutomaticObservationsV2(root)).toEqual([observation]);
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
