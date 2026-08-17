import { afterEach, describe, expect, it } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
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
import { join } from "node:path";
import {
	AUTHORITY_OBSERVATION_GENERATION_V2,
	AUTHORITY_OBSERVER_VERSION_V2,
	authorityStatePathIdentity,
	prepareAuthorityCommit,
	readAuthorityCommitReceipts,
	terminalizeAuthorityCommit,
	type AuthorityObservationSeedV2,
} from "../plugins/immune-brain/runtime/authority_commit_receipts";
import { stableStringify } from "../plugins/immune-brain/runtime/canonical_json";
import { runKernelCommand } from "../plugins/immune-brain/runtime/commands/kernel";
import {
	appendAutomaticObservationV2,
	automaticObservationJournalPath,
	parseAutomaticObservationV2,
	readAutomaticObservationsV2,
} from "../plugins/immune-brain/runtime/kernel/automatic_observations";
import {
	buildAutomaticObservationV2,
	replayMissingAutomaticObservationsV2,
} from "../plugins/immune-brain/runtime/kernel/observation";

const roots: string[] = [];

function tempRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "imm-kernel-r2a-"));
	roots.push(root);
	mkdirSync(join(root, ".imm", "memory"), { recursive: true });
	return root;
}

function sha256(content: string): string {
	return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function seedFor(ledgerPath: string, content: string): AuthorityObservationSeedV2 {
	return {
		contract: "assurance_kernel/authority_observation_seed/v2",
		observer_version: AUTHORITY_OBSERVER_VERSION_V2,
		source_kind: "state_mutation",
		source_ref: `history:${randomUUID()}`,
		state_path_identity: authorityStatePathIdentity(ledgerPath),
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

function prepareV2(ledgerPath: string, content: string) {
	const seed = seedFor(ledgerPath, content);
	return {
		seed,
		prepared: prepareAuthorityCommit(ledgerPath, {
			source_kind: "state_mutation",
			targets: [
				{
					absolute_path: ledgerPath,
					before_bytes: "before",
					after_bytes: content,
				},
			],
			ledger_revision: seed.committed_revision,
			source_ref: seed.source_ref,
			attempt_id: randomUUID(),
			observation_generation: AUTHORITY_OBSERVATION_GENERATION_V2,
			observation_seed: seed,
		}),
	};
}

function observationId(value: ReturnType<typeof buildAutomaticObservationV2>): string {
	const { observation_id: _observationId, ...payload } = value;
	return `sha256:${createHash("sha256")
		.update(`assurance-kernel-v3-observation/v2\0${stableStringify(payload)}`)
		.digest("hex")}`;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("R2A exact automatic observations", () => {
	it("binds one observation to the terminal receipt record and exact seed", () => {
		const root = tempRoot();
		const ledgerPath = join(root, ".imm", "memory", "current_iteration.json");
		const content = '{"schema_version":3}\n';
		writeFileSync(ledgerPath, content);
		const { seed, prepared } = prepareV2(ledgerPath, content);
		const terminal = terminalizeAuthorityCommit(ledgerPath, prepared, "committed");
		const observation = buildAutomaticObservationV2(terminal);
		expect(observation).toMatchObject({
			observer_generation: AUTHORITY_OBSERVATION_GENERATION_V2,
			receipt_record_id: terminal.record_id,
			receipt_attempt_id: prepared.attempt_id,
			source_kind: seed.source_kind,
			source_ref: seed.source_ref,
			committed_bytes_sha256: seed.committed_bytes_sha256,
			ledger_revision: seed.committed_revision,
		});
		expect(appendAutomaticObservationV2(root, observation)).toBe("appended");
		expect(appendAutomaticObservationV2(root, observation)).toBe("duplicate");
		expect(readAutomaticObservationsV2(root)).toEqual([observation]);
	});

	it("rejects a conflicting or malformed terminal identity", () => {
		const root = tempRoot();
		const ledgerPath = join(root, ".imm", "memory", "current_iteration.json");
		const content = '{"schema_version":3}\n';
		writeFileSync(ledgerPath, content);
		const { prepared } = prepareV2(ledgerPath, content);
		const terminal = terminalizeAuthorityCommit(ledgerPath, prepared, "committed");
		const observation = buildAutomaticObservationV2(terminal);
		appendAutomaticObservationV2(root, observation);
		const conflict = { ...observation, source_ref: "history:conflict" };
		conflict.observation_id = observationId(conflict);
		expect(() => appendAutomaticObservationV2(root, conflict)).toThrow(
			"automatic observation receipt identity conflict",
		);
		expect(() =>
			parseAutomaticObservationV2({
				...observation,
				committed_bytes_sha256: "sha256:bad",
			}),
		).toThrow("automatic observation v2 identity mismatch");
	});

	it("replays from the terminal receipt seed after later Ledger mutation", () => {
		const root = tempRoot();
		const ledgerPath = join(root, ".imm", "memory", "current_iteration.json");
		const committed = '{"schema_version":3,"runtime_status":"idle"}\n';
		writeFileSync(ledgerPath, committed);
		const { seed, prepared } = prepareV2(ledgerPath, committed);
		const terminal = terminalizeAuthorityCommit(
			ledgerPath,
			prepared,
			"recovered_committed",
		);
		writeFileSync(ledgerPath, '{"schema_version":3,"runtime_status":"active"}\n');
		replayMissingAutomaticObservationsV2(ledgerPath);
		const [observation] = readAutomaticObservationsV2(root);
		expect(observation.receipt_record_id).toBe(terminal.record_id);
		expect(observation.committed_bytes_sha256).toBe(seed.committed_bytes_sha256);
		expect(observation.committed_bytes_sha256).not.toBe(
			sha256(readFileSync(ledgerPath, "utf8")),
		);
	});

	it("keeps receipt v1 readable but nonqualifying", () => {
		const root = tempRoot();
		const ledgerPath = join(root, ".imm", "memory", "current_iteration.json");
		writeFileSync(ledgerPath, "{}\n");
		const prepared = prepareAuthorityCommit(ledgerPath, {
			source_kind: "state_mutation",
			targets: [
				{
					absolute_path: ledgerPath,
					before_bytes: "before",
					after_bytes: "{}\n",
				},
			],
			ledger_revision: "legacy-revision",
			source_ref: "legacy:test",
			attempt_id: randomUUID(),
		});
		const terminal = terminalizeAuthorityCommit(ledgerPath, prepared, "committed");
		expect(readAuthorityCommitReceipts(ledgerPath)).toHaveLength(2);
		expect(() => buildAutomaticObservationV2(terminal)).toThrow(
			"automatic observation requires a committed receipt-v2 seed",
		);
		expect(readAutomaticObservationsV2(root)).toEqual([]);
	});

	it("rejects a symlinked automatic observation journal", () => {
		const root = tempRoot();
		const outside = tempRoot();
		const path = automaticObservationJournalPath(root);
		writeFileSync(join(outside, "journal.jsonl"), "");
		symlinkSync(join(outside, "journal.jsonl"), path);
		expect(() => readAutomaticObservationsV2(root)).toThrow(
			"automatic observation path is not a regular file",
		);
	});

	it("exposes the canonical R2B readiness surface without authority writes", () => {
		const repoRoot = join(import.meta.dir, "..");
		expect(existsSync(join(repoRoot, "plugins/immune-brain/runtime/kernel/readiness.ts"))).toBe(
			true,
		);
		expect(existsSync(join(repoRoot, "tests/kernel-readiness.test.ts"))).toBe(true);
		// The shipped v4 router manifest exposes only the retained Kernel
		// surface; readiness/journal/migrate are retired kernel subcommands.
		const manifest = JSON.parse(
			Bun.spawnSync({
				cmd: [
					"bun",
					join(repoRoot, "plugins/immune-brain/runtime/v4_runtime.ts"),
					"list-commands",
					"--json",
				],
				cwd: repoRoot,
				stdout: "pipe",
			}).stdout.toString(),
		);
		const command = manifest.commands.find((entry: any) => entry.name === "imm-kernel");
		expect(command.examples).toContain("imm-kernel intent author docs/plans/<task-id>.intent.json --stdin --json");
		expect(command.examples).toContain("imm-kernel intent validate docs/plans/<task-id>.intent.json --json");
		expect(command.examples).toContain("imm-kernel status --json");
		expect(command.examples).toContain("imm-kernel audit --legacy");
		expect(JSON.stringify(manifest.commands)).not.toContain("readiness");
		expect(JSON.stringify(manifest.commands)).not.toContain("journal");
		expect(JSON.stringify(manifest.commands)).not.toContain("migrate");
		const root = tempRoot();
		const ledgerPath = join(root, ".imm", "memory", "current_iteration.json");
		writeFileSync(ledgerPath, JSON.stringify({ schema_version: 3, steps: {} }));
		const before = readFileSync(ledgerPath, "utf8");
		const result = runKernelCommand(["readiness", "--json"], root);
		expect(result.returncode).toBe(2);
		expect(JSON.parse(result.stdout)).toMatchObject({
			error: { code: "invalid_command" },
		});
		expect(readFileSync(ledgerPath, "utf8")).toBe(before);
		expect(existsSync(join(root, ".imm", "tasks"))).toBe(false);
		expect(existsSync(join(root, ".imm", "workspace.json"))).toBe(false);
		expect(existsSync(join(root, ".imm", "journal.jsonl"))).toBe(false);
	});
});
