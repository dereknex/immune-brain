import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	inspectProjectMigration,
	migrateProject,
	setBeforeMigrationFinalizeForTest,
	setBeforeMigrationReplaceForTest,
} from "../plugins/immune-brain/runtime/project_migration";
import { readAuthorityCommitReceipts } from "../plugins/immune-brain/runtime/authority_commit_receipts";
import { readAutomaticObservationsV2 } from "../plugins/immune-brain/runtime/kernel/automatic_observations";

import {
	buildPlanSignature,
	normalizePlan,
	parsePlan,
} from "../plugins/immune-brain/runtime/plan_core";

const ROADMAP_FIXTURE_DIR = join(
	import.meta.dir,
	"fixtures",
	"roadmap-transition",
);
const HISTORICAL_PLAN =
	"tests/fixtures/roadmap-transition/predecessor.md";

function installHistoricalPlan(root: string): {
	planPath: string;
	planSignature: string;
	roadmapSource: string;
	phase: string;
} {
	const destination = join(root, "tests", "fixtures", "roadmap-transition");
	mkdirSync(destination, { recursive: true });
	for (const file of ["predecessor.md", "roadmap.spec.md"]) {
		copyFileSync(join(ROADMAP_FIXTURE_DIR, file), join(destination, file));
	}
	const parsed = parsePlan(join(root, HISTORICAL_PLAN));
	const normalized = normalizePlan(parsed, root);
	return {
		planPath: normalized.plan_path,
		planSignature: buildPlanSignature(normalized),
		roadmapSource: normalized.task.roadmap_source,
		phase: normalized.task.current_phase,
	};
}

function recoverableRoadmapHistory(root: string): Record<string, unknown> {
	const plan = installHistoricalPlan(root);
	return currentLedger({
		history: [
			{
				at: "2026-08-09T01:00:00Z",
				action: "sync_plan_from_imm_plan",
				details: {
					plan_path: plan.planPath,
					plan_signature: plan.planSignature,
					same_plan: false,
				},
			},
			{
				at: "2026-08-09T02:00:00Z",
				action: "finish_reset",
				details: { plan_path: plan.planPath },
			},
		],
	});
}

const roots: string[] = [];

function tempRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "imm-migration-"));
	roots.push(root);
	mkdirSync(join(root, ".imm", "memory"), { recursive: true });
	return root;
}

function ledgerPath(root: string): string {
	return join(root, ".imm", "memory", "current_iteration.json");
}

function writeLedger(root: string, state: Record<string, unknown>): string {
	const content = JSON.stringify(state, null, 2) + "\n";
	writeFileSync(ledgerPath(root), content);
	return content;
}

function currentLedger(overrides: Record<string, unknown> = {}) {
	return {
		schema_version: 3,
		steps: {},
		pending_follow_up: null,
		last_review: null,
		validated_plan_snapshot: null,
		history: [],
		review_follow_up_start_index: 0,
		requires_replan: false,
		runtime_status: "idle",
		closed_plan_history: [],
		plan_transition_history: [],
		...overrides,
	};
}

function legacyEvidence(result = "tests passed") {
	return {
		changed_files: "src/a.ts, src/b.ts",
		verification_result: result,
		verification_command: "bun test",
		notes: "legacy note",
	};
}

afterEach(() => {
	setBeforeMigrationFinalizeForTest(null);
	setBeforeMigrationReplaceForTest(null);
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

describe("legacy project migration", () => {
	it("treats a project without a State Ledger as current", () => {
		const root = tempRoot();
		const inspection = inspectProjectMigration(root);
		expect(inspection.status).toBe("current");
		expect(migrateProject(root).migrated).toBe(false);
		expect(existsSync(join(root, ".imm", "migrations"))).toBe(false);
	});

	it("keeps a current v3 project byte-identical", () => {
		const root = tempRoot();
		const before = writeLedger(root, currentLedger());
		expect(inspectProjectMigration(root).status).toBe("current");
		const result = migrateProject(root);
		expect(result.migrated).toBe(false);
		expect(readFileSync(ledgerPath(root), "utf-8")).toBe(before);
		expect(existsSync(join(root, ".imm", "migrations"))).toBe(false);
	});

	it("keeps semantically current v3 JSON formatting as a no-op", () => {
		const root = tempRoot();
		const before = JSON.stringify(
			Object.fromEntries(Object.entries(currentLedger()).reverse()),
		);
		writeFileSync(ledgerPath(root), before);
		const beforeMtime = statSync(ledgerPath(root)).mtimeMs;

		expect(inspectProjectMigration(root).status).toBe("current");
		const result = migrateProject(root);
		expect(result.migrated).toBe(false);
		expect(readFileSync(ledgerPath(root), "utf-8")).toBe(before);
		expect(statSync(ledgerPath(root)).mtimeMs).toBe(beforeMtime);
		expect(existsSync(join(root, ".imm", "migrations"))).toBe(false);
	});

	it("rejects malformed missing-version ledgers without discarding fields", () => {
		const root = tempRoot();
		const before = JSON.stringify({
			steps: "corrupt-step-data",
			history: { lost: true },
			requires_replan: "yes",
			runtime_status: 42,
		});
		writeFileSync(ledgerPath(root), before);

		const inspection = inspectProjectMigration(root);
		expect(inspection.status).toBe("invalid");
		expect(inspection.reasons.join(" ")).toContain(
			"requires steps as an object",
		);
		expect(() => migrateProject(root)).toThrow();
		expect(readFileSync(ledgerPath(root), "utf-8")).toBe(`${before}`);
		expect(existsSync(join(root, ".imm", "migrations"))).toBe(false);
	});

	it("migrates schema v2 and legacy Step evidence to v3 structured evidence", () => {
		const root = tempRoot();
		writeLedger(root, {
			schema_version: 2,
			steps: {
				"1": {
					state: "ready_for_review",
					execution_evidence: legacyEvidence(),
				},
			},
			history: [],
			runtime_status: "idle",
		});

		const inspection = inspectProjectMigration(root);
		expect(inspection.status).toBe("migration_required");
		expect(inspection.reasons).toContain("schema v2");
		const result = migrateProject(root);
		expect(result.migrated).toBe(true);
		expect(result.backup_dir).toStartWith(".imm/migrations/");

		const migrated = JSON.parse(readFileSync(ledgerPath(root), "utf-8"));
		expect(migrated.schema_version).toBe(3);
		expect(migrated.closed_plan_history).toEqual([]);
		expect(migrated.plan_transition_history).toEqual([]);
		const evidence = migrated.steps["1"].execution_evidence;
		expect(evidence.evidence_schema).toBe("structured-v1");
		expect(evidence.changed_files).toEqual(["src/a.ts", "src/b.ts"]);
		expect(evidence.status).toBe("passed");
		expect(evidence.checks).toEqual([
			{
				kind: "manual",
				command: "bun test",
				status: "passed",
				exit_code: null,
				summary: "tests passed",
			},
		]);
		expect(evidence.verification_result).toBeUndefined();
		expect(evidence.verification_command).toBeUndefined();
		expect(inspectProjectMigration(root).status).toBe("current");
		const receipts = readAuthorityCommitReceipts(ledgerPath(root));
		expect(receipts.map((receipt) => receipt.status)).toEqual([
			"prepared",
			"committed",
		]);
		expect(receipts[1]?.source_kind).toBe("project_migration");
		const observations = readAutomaticObservationsV2(root);
		expect(observations).toHaveLength(1);
		expect(observations[0]?.receipt_record_id).toBe(receipts[1]?.record_id);
	});

	it("migrates a valid missing-version ledger and marks failed legacy evidence", () => {
		const root = tempRoot();
		writeLedger(root, {
			steps: {
				"1": {
					state: "ready_for_review",
					execution_evidence: legacyEvidence("tests failed: one failure"),
				},
			},
		});
		expect(inspectProjectMigration(root).source_version).toBeNull();
		migrateProject(root);
		const migrated = JSON.parse(readFileSync(ledgerPath(root), "utf-8"));
		expect(migrated.schema_version).toBe(3);
		expect(migrated.steps["1"].execution_evidence.status).toBe("failed");
		expect(migrated.steps["1"].execution_evidence.checks[0].status).toBe(
			"failed",
		);
	});

	it("migrates legacy evidence in follow-ups and closed Plan archives", () => {
		const root = tempRoot();
		writeLedger(
			root,
			currentLedger({
				pending_follow_up: { execution_evidence: legacyEvidence() },
				follow_up_history: [{ execution_evidence: legacyEvidence() }],
				closed_plan_history: [
					{
						steps: [{ execution_evidence: legacyEvidence() }],
						follow_ups: [{ execution_evidence: legacyEvidence() }],
					},
				],
			}),
		);
		expect(inspectProjectMigration(root).status).toBe("migration_required");
		migrateProject(root);
		const migrated = JSON.parse(readFileSync(ledgerPath(root), "utf-8"));
		expect(migrated.pending_follow_up.execution_evidence.evidence_schema).toBe(
			"structured-v1",
		);
		expect(
			migrated.follow_up_history[0].execution_evidence.evidence_schema,
		).toBe("structured-v1");
		expect(
			migrated.closed_plan_history[0].steps[0].execution_evidence
				.evidence_schema,
		).toBe("structured-v1");
		expect(
			migrated.closed_plan_history[0].follow_ups[0].execution_evidence
				.evidence_schema,
		).toBe("structured-v1");
	});

	it("rewrites an active Plan legacy Spec reference when the current Spec exists", () => {
		const root = tempRoot();
		mkdirSync(join(root, "docs", "plans"), { recursive: true });
		mkdirSync(join(root, "docs", "specs"), { recursive: true });
		const planPath = join(root, "docs", "plans", "legacy.md");
		writeFileSync(
			planPath,
			"# Iteration Plan\n\n## Task\n\n- Spec: `docs/architecture/example.md`\n",
		);
		writeFileSync(join(root, "docs", "specs", "example.md"), "# Spec\n");
		writeLedger(root, currentLedger({ plan_path: "docs/plans/legacy.md" }));

		const inspection = inspectProjectMigration(root);
		expect(inspection.changed_files).toContain("docs/plans/legacy.md");
		migrateProject(root);
		expect(readFileSync(planPath, "utf-8")).toContain(
			"- Spec: `docs/specs/example.md`",
		);
	});

	it("rejects a legacy Spec reference when the current target is absent", () => {
		const root = tempRoot();
		mkdirSync(join(root, "docs", "plans"), { recursive: true });
		writeFileSync(
			join(root, "docs", "plans", "legacy.md"),
			"# Iteration Plan\n\n## Task\n\n- Spec: docs/architecture/missing.md\n",
		);
		writeLedger(root, currentLedger({ plan_path: "docs/plans/legacy.md" }));
		const inspection = inspectProjectMigration(root);
		expect(inspection.status).toBe("invalid");
		expect(inspection.reasons.join(" ")).toContain("Migrated Spec");
		expect(() => migrateProject(root)).toThrow();
	});

	it("fails closed for malformed, ambiguous, and future ledgers", () => {
		const malformedRoot = tempRoot();
		writeFileSync(ledgerPath(malformedRoot), "{not-json\n");
		expect(inspectProjectMigration(malformedRoot).status).toBe("invalid");

		const ambiguousRoot = tempRoot();
		writeLedger(ambiguousRoot, {
			schema_version: 2,
			steps: {
				"1": { state: "ready_for_review", execution_evidence: {} },
			},
		});
		expect(inspectProjectMigration(ambiguousRoot).status).toBe("invalid");

		const futureRoot = tempRoot();
		writeLedger(futureRoot, currentLedger({ schema_version: 4 }));
		expect(inspectProjectMigration(futureRoot).status).toBe("future");
		expect(() => migrateProject(futureRoot)).toThrow(
			"Unsupported future schema_version 4.",
		);
	});

	it("recovers a signed historical Roadmap finish without mutating check mode", () => {
		const root = tempRoot();
		const authority = recoverableRoadmapHistory(root) as any;
		const expected = installHistoricalPlan(root);
		authority.history.unshift({
			at: "2026-08-09T00:00:00Z",
			action: "sync_plan_from_imm_plan",
			details: {
				plan_path: expected.planPath,
				plan_signature: "b".repeat(64),
				same_plan: false,
			},
		});
		const before = writeLedger(root, authority);

		const inspection = inspectProjectMigration(root);
		expect(inspection).toMatchObject({
			status: "migration_required",
			changed_files: [".imm/memory/current_iteration.json"],
		});
		expect(inspection.reasons.join(" ")).toContain(
			"signed Roadmap Phase completion",
		);
		expect(readFileSync(ledgerPath(root), "utf8")).toBe(before);
		expect(existsSync(join(root, ".imm", "migrations"))).toBe(false);

		const result = migrateProject(root);
		expect(result.migrated).toBe(true);
		const migrated = JSON.parse(readFileSync(ledgerPath(root), "utf8"));
		expect(migrated.history).toEqual((authority as any).history);
		expect(migrated.roadmap_phase_completion_history).toHaveLength(1);
		expect(migrated.roadmap_phase_completion_history[0]).toMatchObject({
			contract: "roadmap_phase_completion/v1",
			plan_path: expected.planPath,
			plan_signature: expected.planSignature,
			roadmap_source: expected.roadmapSource,
			phase: expected.phase,
			finished_at: "2026-08-09T02:00:00Z",
			provenance: "signed_history_migration",
		});
		expect(migrated.roadmap_phase_completion_history[0].completion_id).toMatch(
			/^[0-9a-f]{64}$/,
		);

		const manifestPath = join(root, result.backup_dir!, "manifest.json");
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		expect(manifest.status).toBe("committed");
		expect(
			readFileSync(join(root, result.backup_dir!, "backup-0.txt"), "utf8"),
		).toBe(before);
		const entries = readdirSync(join(root, ".imm", "migrations"));
		const second = migrateProject(root);
		expect(second.migrated).toBe(false);
		expect(readdirSync(join(root, ".imm", "migrations"))).toEqual(entries);
	});

	it("skips unproven historical finishes without fabricating records", () => {
		for (const scenario of [
			"missing-sync",
			"signature-drift",
			"missing-plan",
			"missing-roadmap-fields",
			"escaping-plan",
			"symlink-plan",
		] as const) {
			const root = tempRoot();
			const state = recoverableRoadmapHistory(root) as any;
			const sync = state.history[0];
			if (scenario === "missing-sync") state.history.shift();
			if (scenario === "signature-drift") {
				sync.details.plan_signature = "b".repeat(64);
			}
			if (scenario === "missing-plan") {
				rmSync(join(root, HISTORICAL_PLAN));
			}
			if (scenario === "missing-roadmap-fields") {
				writeFileSync(
					join(root, HISTORICAL_PLAN),
					readFileSync(join(root, HISTORICAL_PLAN), "utf8")
						.replace(/^.*Roadmap source:.*$/m, "")
						.replace(/^.*Current phase:.*$/m, ""),
				);
				sync.details.plan_signature = buildPlanSignature(
					normalizePlan(parsePlan(join(root, HISTORICAL_PLAN)), root),
				);
			}
			if (scenario === "escaping-plan") {
				state.history[1].details.plan_path = "../outside.md";
				sync.details.plan_path = "../outside.md";
			}
			if (scenario === "symlink-plan") {
				const path = join(root, HISTORICAL_PLAN);
				const realPath = join(root, "tests", "fixtures", "roadmap-transition", "real-plan.md");
				writeFileSync(realPath, readFileSync(path, "utf8"));
				rmSync(path);
				symlinkSync("real-plan.md", path);
			}
			const before = writeLedger(root, state);
			const inspection = inspectProjectMigration(root);
			expect(inspection.status).toBe("current");
			expect(inspection.reasons.join(" ")).toContain("skipped");
			expect(migrateProject(root).migrated).toBe(false);
			expect(readFileSync(ledgerPath(root), "utf8")).toBe(before);
		}
	});

	it("does not migrate a signed Plan without finish authority", () => {
		const root = tempRoot();
		const state = recoverableRoadmapHistory(root) as any;
		state.history.pop();
		const before = writeLedger(root, state);
		expect(inspectProjectMigration(root).status).toBe("current");
		expect(migrateProject(root).migrated).toBe(false);
		expect(readFileSync(ledgerPath(root), "utf8")).toBe(before);
	});

	it("uses one signed sync for at most one historical finish", () => {
		const root = tempRoot();
		const state = recoverableRoadmapHistory(root) as any;
		state.history.push({
			at: "2026-08-09T03:00:00Z",
			action: "finish_reset",
			details: { plan_path: state.history[0].details.plan_path },
		});
		writeLedger(root, state);
		const inspection = inspectProjectMigration(root);
		expect(inspection.status).toBe("migration_required");
		expect(inspection.reasons.join(" ")).toContain(
			"already paired with another finish",
		);
		migrateProject(root);
		const migrated = JSON.parse(readFileSync(ledgerPath(root), "utf8"));
		expect(migrated.roadmap_phase_completion_history).toHaveLength(1);
	});

	it("preserves a concurrently replaced Ledger before migration replacement", () => {
		const root = tempRoot();
		writeLedger(root, recoverableRoadmapHistory(root));
		setBeforeMigrationReplaceForTest((relativePath, index) => {
			if (relativePath !== ".imm/memory/current_iteration.json" || index !== 0)
				return;
			const concurrent = JSON.parse(readFileSync(ledgerPath(root), "utf8"));
			concurrent.concurrent_marker = "newer-authority";
			writeLedger(root, concurrent);
		});

		expect(() => migrateProject(root)).toThrow(
			"Migration source changed after preparation",
		);
		const persisted = JSON.parse(readFileSync(ledgerPath(root), "utf8"));
		expect(persisted.concurrent_marker).toBe("newer-authority");
		expect(persisted.roadmap_phase_completion_history).toBeUndefined();
	});

	it("is idempotent and reuses no additional backup after success", () => {
		const root = tempRoot();
		writeLedger(root, { schema_version: 2, steps: {} });
		const first = migrateProject(root);
		const entriesAfterFirst = readdirSync(join(root, ".imm", "migrations"));
		const bytesAfterFirst = readFileSync(ledgerPath(root), "utf-8");
		const second = migrateProject(root);
		expect(first.migrated).toBe(true);
		expect(second.migrated).toBe(false);
		expect(readdirSync(join(root, ".imm", "migrations"))).toEqual(
			entriesAfterFirst,
		);
		expect(readFileSync(ledgerPath(root), "utf-8")).toBe(bytesAfterFirst);
	});

	it("rejects structured evidence that the current runtime would reject", () => {
		const root = tempRoot();
		writeLedger(root, {
			schema_version: 2,
			steps: {
				"1": {
					state: "ready_for_review",
					execution_evidence: {
						changed_files: ["src/a.ts"],
						status: "passed",
						checks: [
							{
								kind: "command",
								command: "bun test",
								status: "passed",
								exit_code: null,
								summary: "missing exit code",
							},
						],
					},
				},
			},
		});
		const inspection = inspectProjectMigration(root);
		expect(inspection.status).toBe("invalid");
		expect(inspection.reasons.join(" ")).toContain(
			"command cannot pass without exit_code 0",
		);
	});

	it("rejects parent-directory symlinks that escape the project root", () => {
		const root = tempRoot();
		const outside = mkdtempSync(join(tmpdir(), "imm-migration-outside-"));
		roots.push(outside);
		mkdirSync(join(outside, "plans"), { recursive: true });
		writeFileSync(join(outside, "plans", "legacy.md"), "# Plan\n");
		symlinkSync(outside, join(root, "docs"));
		writeLedger(root, currentLedger({ plan_path: "docs/plans/legacy.md" }));
		const inspection = inspectProjectMigration(root);
		expect(inspection.status).toBe("invalid");
		expect(inspection.reasons.join(" ")).toContain("symbolic links");
	});

	it("recovers a valid prepared journal before retrying migration", () => {
		const root = tempRoot();
		const original =
			JSON.stringify({ schema_version: 2, steps: {} }, null, 2) + "\n";
		const current = JSON.stringify(currentLedger(), null, 2) + "\n";
		const currentDigest = createHash("sha256").update(current).digest("hex");
		writeFileSync(ledgerPath(root), current);
		const digest = createHash("sha256").update(original).digest("hex");
		const identity = createHash("sha256")
			.update(`.imm/memory/current_iteration.json\0${digest}`)
			.digest("hex");
		const dir = join(root, ".imm", "migrations", identity);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "backup-0.txt"), original);
		writeFileSync(
			join(dir, "manifest.json"),
			JSON.stringify(
				{
					manifest_version: 1,
					migration_id: identity,
					status: "prepared",
					created_at: "2026-07-30T00:00:00.000Z",
					files: [
						{
							relative_path: ".imm/memory/current_iteration.json",
							sha256: digest,
							after_sha256: currentDigest,
							backup_file: "backup-0.txt",
							mode: 0o644,
						},
					],
				},
				null,
				2,
			) + "\n",
		);

		const result = migrateProject(root);
		expect(result.migrated).toBe(true);
		expect(inspectProjectMigration(root).status).toBe("current");
		const manifest = JSON.parse(
			readFileSync(join(dir, "manifest.json"), "utf-8"),
		);
		expect(manifest.status).toBe("committed");
	});

	it("rejects a prepared journal that targets a non-runtime project file", () => {
		const root = tempRoot();
		writeLedger(root, currentLedger());
		mkdirSync(join(root, ".git", "hooks"), { recursive: true });
		writeFileSync(join(root, ".git", "hooks", "pre-commit"), "safe\n");
		const backup = "malicious\n";
		const digest = createHash("sha256").update(backup).digest("hex");
		const identity = createHash("sha256")
			.update(`.git/hooks/pre-commit\0${digest}`)
			.digest("hex");
		const dir = join(root, ".imm", "migrations", identity);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "backup-0.txt"), backup);
		writeFileSync(
			join(dir, "manifest.json"),
			JSON.stringify({
				manifest_version: 1,
				migration_id: identity,
				status: "prepared",
				created_at: "2026-07-30T00:00:00.000Z",
				files: [
					{
						relative_path: ".git/hooks/pre-commit",
						sha256: digest,
						after_sha256: digest,
						backup_file: "backup-0.txt",
						mode: 0o755,
					},
				],
			}),
		);
		expect(() => migrateProject(root)).toThrow(
			"target must be the State Ledger or the active Plan",
		);
		expect(
			readFileSync(join(root, ".git", "hooks", "pre-commit"), "utf-8"),
		).toBe("safe\n");
	});

	it("rejects a prepared journal that targets an unrelated Markdown file", () => {
		const root = tempRoot();
		writeLedger(root, currentLedger());
		const target = join(root, "README.md");
		const current = "safe README\n";
		const backup = "untrusted replacement\n";
		writeFileSync(target, current);
		const digest = createHash("sha256").update(backup).digest("hex");
		const afterDigest = createHash("sha256").update(current).digest("hex");
		const identity = createHash("sha256")
			.update(`README.md\\0${digest}`)
			.digest("hex");
		const dir = join(root, ".imm", "migrations", identity);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "backup-0.txt"), backup);
		writeFileSync(
			join(dir, "manifest.json"),
			JSON.stringify({
				manifest_version: 1,
				migration_id: identity,
				status: "prepared",
				created_at: "2026-07-30T00:00:00.000Z",
				files: [
					{
						relative_path: "README.md",
						sha256: digest,
						after_sha256: afterDigest,
						backup_file: "backup-0.txt",
						mode: 0o644,
					},
				],
			}),
		);

		expect(() => migrateProject(root)).toThrow(
			"target must be the State Ledger or the active Plan",
		);
		expect(readFileSync(target, "utf-8")).toBe(current);
	});

	it("does not overwrite manual changes made after journal preparation", () => {
		const root = tempRoot();
		const original =
			JSON.stringify({ schema_version: 2, steps: {} }, null, 2) + "\n";
		const manual =
			JSON.stringify(
				{ schema_version: 2, steps: {}, manual_change: true },
				null,
				2,
			) + "\n";
		writeFileSync(ledgerPath(root), manual);
		const digest = createHash("sha256").update(original).digest("hex");
		const afterDigest = createHash("sha256")
			.update("expected migrated bytes")
			.digest("hex");
		const identity = createHash("sha256")
			.update(`.imm/memory/current_iteration.json\0${digest}`)
			.digest("hex");
		const dir = join(root, ".imm", "migrations", identity);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "backup-0.txt"), original);
		writeFileSync(
			join(dir, "manifest.json"),
			JSON.stringify({
				manifest_version: 1,
				migration_id: identity,
				status: "prepared",
				created_at: "2026-07-30T00:00:00.000Z",
				files: [
					{
						relative_path: ".imm/memory/current_iteration.json",
						sha256: digest,
						after_sha256: afterDigest,
						backup_file: "backup-0.txt",
						mode: 0o644,
					},
				],
			}),
		);
		expect(() => migrateProject(root)).toThrow(
			"Migration rollback was incomplete",
		);
		expect(readFileSync(ledgerPath(root), "utf-8")).toBe(manual);
	});

	it("rolls back when finalization fails before commit", () => {
		const root = tempRoot();
		mkdirSync(join(root, "docs", "plans"), { recursive: true });
		mkdirSync(join(root, "docs", "specs"), { recursive: true });
		const planPath = join(root, "docs", "plans", "legacy.md");
		const planBefore =
			"# Iteration Plan\n\n## Task\n\n- Spec: `docs/architecture/example.md`\n";
		writeFileSync(planPath, planBefore);
		writeFileSync(join(root, "docs", "specs", "example.md"), "# Spec\n");
		const ledgerBefore = writeLedger(root, {
			schema_version: 2,
			steps: {},
			plan_path: "docs/plans/legacy.md",
		});
		setBeforeMigrationFinalizeForTest(() => {
			throw new Error("injected finalization failure");
		});
		expect(() => migrateProject(root)).toThrow("injected finalization failure");
		expect(readFileSync(ledgerPath(root), "utf-8")).toBe(ledgerBefore);
		expect(readFileSync(planPath, "utf-8")).toBe(planBefore);
		expect(
			readAuthorityCommitReceipts(ledgerPath(root)).map(
				(receipt) => receipt.status,
			),
		).toEqual(["prepared", "aborted"]);
		expect(
			existsSync(
				join(root, ".imm", "memory", ".current_iteration.automatic_observations.jsonl"),
			),
		).toBe(false);
	});

	it("recovers a committed migration after process interruption before terminal receipt", () => {
		const root = tempRoot();
		writeLedger(root, {
			schema_version: 2,
			steps: {
				"1": {
					state: "ready_for_review",
					execution_evidence: legacyEvidence(),
				},
			},
			history: [],
			runtime_status: "idle",
		});
		const script = `
			import { migrateProject } from "./plugins/immune-brain/runtime/project_migration.ts";
			import { setBeforeAuthorityReceiptAppendForTest } from "./plugins/immune-brain/runtime/authority_commit_receipts.ts";
			setBeforeAuthorityReceiptAppendForTest((record) => {
				if (record.status === "committed") process.kill(process.pid, "SIGKILL");
			});
			migrateProject(process.env.IMM_TEST_ROOT);
		`;
		const interrupted = spawnSync("bun", ["-e", script], {
			cwd: process.cwd(),
			env: { ...process.env, IMM_TEST_ROOT: root },
			encoding: "utf8",
		});
		expect(interrupted.status).not.toBe(0);
		expect(
			readAuthorityCommitReceipts(ledgerPath(root)).map(
				(receipt) => receipt.status,
			),
		).toEqual(["prepared"]);
		expect(
			existsSync(
				join(root, ".imm", "memory", ".current_iteration.automatic_observations.jsonl"),
			),
		).toBe(false);
		const staleWriteLock = `${ledgerPath(root)}.write.lock`;
		expect(existsSync(staleWriteLock)).toBe(true);
		rmSync(staleWriteLock, { recursive: true, force: true });

		const recovery = migrateProject(root);
		expect(recovery.migrated).toBe(false);
		const receipts = readAuthorityCommitReceipts(ledgerPath(root));
		expect(receipts.map((receipt) => receipt.status)).toEqual([
			"prepared",
			"recovered_committed",
		]);
		const observations = readAutomaticObservationsV2(root);
		expect(observations).toHaveLength(1);
		expect(observations[0]?.receipt_record_id).toBe(receipts[1]?.record_id);
	});

	it("uses secure Ledger mode while preserving active Plan mode", () => {
		const root = tempRoot();
		mkdirSync(join(root, "docs", "plans"), { recursive: true });
		mkdirSync(join(root, "docs", "specs"), { recursive: true });
		const planPath = join(root, "docs", "plans", "legacy.md");
		writeFileSync(
			planPath,
			"# Iteration Plan\n\n## Task\n\n- Spec: docs/architecture/example.md\n",
		);
		writeFileSync(join(root, "docs", "specs", "example.md"), "# Spec\n");
		writeLedger(root, {
			schema_version: 2,
			steps: {},
			plan_path: "docs/plans/legacy.md",
		});
		chmodSync(ledgerPath(root), 0o644);
		chmodSync(planPath, 0o640);
		migrateProject(root);
		expect(statSync(ledgerPath(root)).mode & 0o777).toBe(0o600);
		expect(statSync(planPath).mode & 0o777).toBe(0o640);
	});

	it("restores every changed file when replacement fails", () => {
		const root = tempRoot();
		mkdirSync(join(root, "docs", "plans"), { recursive: true });
		mkdirSync(join(root, "docs", "specs"), { recursive: true });
		const planPath = join(root, "docs", "plans", "legacy.md");
		const planBefore =
			"# Iteration Plan\n\n## Task\n\n- Spec: `docs/architecture/example.md`\n";
		writeFileSync(planPath, planBefore);
		writeFileSync(join(root, "docs", "specs", "example.md"), "# Spec\n");
		const ledgerBefore = writeLedger(root, {
			schema_version: 2,
			steps: {},
			plan_path: "docs/plans/legacy.md",
		});
		setBeforeMigrationReplaceForTest((_path, index) => {
			if (index === 1) throw new Error("injected replacement failure");
		});

		expect(() => migrateProject(root)).toThrow("injected replacement failure");
		expect(readFileSync(ledgerPath(root), "utf-8")).toBe(ledgerBefore);
		expect(readFileSync(planPath, "utf-8")).toBe(planBefore);
		const migrationDirs = readdirSync(join(root, ".imm", "migrations"));
		expect(migrationDirs).toHaveLength(1);
		const manifest = JSON.parse(
			readFileSync(
				join(root, ".imm", "migrations", migrationDirs[0], "manifest.json"),
				"utf-8",
			),
		);
		expect(manifest.status).toBe("rolled_back");
	});
});
