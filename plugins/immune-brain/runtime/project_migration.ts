import { createHash, randomUUID } from "node:crypto";
import {
	chmodSync,
	closeSync,
	existsSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { stableStringify } from "./canonical_json";
import {
	AUTHORITY_OBSERVATION_GENERATION_V2,
	authorityStatePathIdentity,
	prepareAuthorityCommit,
	recoverAuthorityCommitReceipts,
	terminalizeAuthorityCommit,
	type AuthorityCommitReceipt,
	type PreparedAuthorityCommit,
} from "./authority_commit_receipts";
import {
	buildLedgerRevision,
	buildRoadmapPhaseCompletionRecord,
	type StateLedger,
	validateTransitionState,
	withLedgerWriteLock,
} from "./state_ledger";
import {
	buildPlanSignature,
	normalizePlan,
	parsePlan,
	validatePlan,
} from "./plan_core";
import {
	buildAuthorityObservationSeedV2,
	replayMissingAutomaticObservationsV2BestEffort,
} from "./kernel/observation";

export const CURRENT_LEDGER_SCHEMA_VERSION = 3;

export type ProjectMigrationStatus =
	| "current"
	| "migration_required"
	| "invalid"
	| "future";

export interface ProjectMigrationInspection {
	status: ProjectMigrationStatus;
	state_path: string;
	source_version: number | null;
	reasons: string[];
	plan_path: string | null;
	changed_files: string[];
}

export interface ProjectMigrationResult extends ProjectMigrationInspection {
	migrated: boolean;
	migration_id: string | null;
	backup_dir: string | null;
}

type MigrationFile = {
	relative_path: string;
	absolute_path: string;
	before: string;
	after: string;
	mode: number;
	device: number;
	inode: number;
};

type MigrationManifest = {
	manifest_version: 1;
	migration_id: string;
	status: "prepared" | "committed" | "rolled_back";
	created_at: string;
	completed_at?: string;
	files: Array<{
		relative_path: string;
		sha256: string;
		after_sha256: string;
		backup_file: string;
		mode: number;
	}>;
};

type ExecutionStatus = "passed" | "failed" | "blocked";

type VerificationCheck = {
	kind: string;
	command: string;
	status: ExecutionStatus;
	exit_code: number | null;
	summary: string;
	artifact?: string;
};

const FAILED_PRECHECK_PATTERNS = [
	/^fail(?:ed|ure)?\b/i,
	/^error\b/i,
	/^blocked\b/i,
	/^not[ _-]?run\b/i,
	/^unable\b/i,
	/\b(?:test|tests|check|checks|verification|verify|build|lint|typecheck)\b.{0,48}\b(?:fail(?:ed|ure)?|error|blocked|not[ _-]?run|unable)\b/i,
	/\b(?:fail(?:ed|ure)?|error|blocked|not[ _-]?run|unable)\b.{0,48}\b(?:test|tests|check|checks|verification|verify|build|lint|typecheck)\b/i,
];

let beforeReplaceForTest:
	| ((relativePath: string, index: number) => void)
	| null = null;
let beforeFinalizeForTest: (() => void) | null = null;

export function setBeforeMigrationReplaceForTest(
	hook: ((relativePath: string, index: number) => void) | null,
): void {
	beforeReplaceForTest = hook;
}

export function setBeforeMigrationFinalizeForTest(
	hook: (() => void) | null,
): void {
	beforeFinalizeForTest = hook;
}

function statePath(root: string): string {
	return join(root, ".imm", "memory", "current_iteration.json");
}

function migrationsRoot(root: string): string {
	return join(root, ".imm", "migrations");
}

function sha256(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertProjectFile(root: string, path: string, label: string): void {
	const lexicalRoot = resolve(root);
	const pathResolved = resolve(path);
	const rel = relative(lexicalRoot, pathResolved);
	if (!rel || rel === ".." || rel.startsWith(`..${sep}`)) {
		throw new Error(`${label} must be a project-relative regular file.`);
	}
	let cursor = lexicalRoot;
	for (const segment of rel.split(sep)) {
		cursor = join(cursor, segment);
		if (!existsSync(cursor)) {
			throw new Error(`${label} does not exist: ${rel.replace(/\\/g, "/")}`);
		}
		if (lstatSync(cursor).isSymbolicLink()) {
			throw new Error(`${label} path must not contain symbolic links.`);
		}
	}
	const rootReal = realpathSync(lexicalRoot);
	const pathReal = realpathSync(pathResolved);
	const canonicalRel = relative(rootReal, pathReal);
	if (
		!canonicalRel ||
		canonicalRel === ".." ||
		canonicalRel.startsWith(`..${sep}`)
	) {
		throw new Error(`${label} resolves outside the project root.`);
	}
	if (!statSync(pathResolved).isFile()) {
		throw new Error(`${label} must be a non-symlink regular file.`);
	}
}

function assertProjectDirectory(
	root: string,
	path: string,
	label: string,
): void {
	const lexicalRoot = resolve(root);
	const pathResolved = resolve(path);
	const rel = relative(lexicalRoot, pathResolved);
	if (!rel || rel === ".." || rel.startsWith(`..${sep}`)) {
		throw new Error(`${label} must be a project-relative directory.`);
	}
	let cursor = lexicalRoot;
	for (const segment of rel.split(sep)) {
		cursor = join(cursor, segment);
		if (!existsSync(cursor)) {
			throw new Error(`${label} does not exist: ${rel.replace(/\\/g, "/")}`);
		}
		if (lstatSync(cursor).isSymbolicLink()) {
			throw new Error(`${label} path must not contain symbolic links.`);
		}
	}
	const rootReal = realpathSync(lexicalRoot);
	const pathReal = realpathSync(pathResolved);
	const canonicalRel = relative(rootReal, pathReal);
	if (
		!canonicalRel ||
		canonicalRel === ".." ||
		canonicalRel.startsWith(`..${sep}`)
	) {
		throw new Error(`${label} resolves outside the project root.`);
	}
	if (!statSync(pathResolved).isDirectory()) {
		throw new Error(`${label} must be a non-symlink directory.`);
	}
}

function assertPlanPath(relativePath: string): void {
	const segments = relativePath.split("/");
	if (
		!relativePath.endsWith(".md") ||
		relativePath.startsWith("/") ||
		relativePath.includes("\\") ||
		segments.includes("..") ||
		segments.includes("") ||
		[".git", ".imm", "node_modules"].includes(segments[0])
	) {
		throw new Error(
			"Active Plan path must be a safe project-relative Markdown file.",
		);
	}
}

function validateLegacyLedgerShape(state: Record<string, any>): void {
	if (!Object.hasOwn(state, "steps") || !isRecord(state.steps)) {
		throw new Error(
			"Legacy State Ledger requires steps as an object; refusing to guess its shape.",
		);
	}
	for (const [stepId, step] of Object.entries(state.steps)) {
		if (!isRecord(step)) {
			throw new Error(`Legacy State Ledger step ${stepId} must be an object.`);
		}
	}
	for (const field of [
		"pending_follow_up",
		"last_review",
		"validated_plan_snapshot",
	]) {
		if (
			Object.hasOwn(state, field) &&
			state[field] !== null &&
			!isRecord(state[field])
		) {
			throw new Error(
				`Legacy State Ledger ${field} must be an object or null.`,
			);
		}
	}
	for (const field of ["history", "follow_up_history"]) {
		if (Object.hasOwn(state, field) && !Array.isArray(state[field])) {
			throw new Error(`Legacy State Ledger ${field} must be an array.`);
		}
	}
	if (
		Object.hasOwn(state, "review_follow_up_start_index") &&
		(!Number.isInteger(state.review_follow_up_start_index) ||
			state.review_follow_up_start_index < 0)
	) {
		throw new Error(
			"Legacy State Ledger review_follow_up_start_index must be a non-negative integer.",
		);
	}
	if (
		Object.hasOwn(state, "requires_replan") &&
		typeof state.requires_replan !== "boolean"
	) {
		throw new Error("Legacy State Ledger requires_replan must be a boolean.");
	}
	if (
		Object.hasOwn(state, "runtime_status") &&
		typeof state.runtime_status !== "string"
	) {
		throw new Error("Legacy State Ledger runtime_status must be a string.");
	}
	if (
		Object.hasOwn(state, "plan_path") &&
		state.plan_path !== null &&
		typeof state.plan_path !== "string"
	) {
		throw new Error("Legacy State Ledger plan_path must be a string or null.");
	}
}

function readActivePlanPath(root: string): string | null {
	const path = statePath(root);
	assertProjectFile(root, path, "State Ledger");
	const state = parseLedger(readFileSync(path, "utf-8"));
	if (typeof state.plan_path !== "string" || !state.plan_path.trim()) {
		return null;
	}
	assertPlanPath(state.plan_path);
	assertProjectFile(root, resolve(root, state.plan_path), "Active Plan");
	return state.plan_path;
}

function parseLedger(raw: string): Record<string, any> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error("State Ledger contains invalid JSON.");
	}
	if (!isRecord(parsed)) throw new Error("State Ledger must be a JSON object.");
	return parsed;
}

function sourceVersion(state: Record<string, any>): number | null {
	if (state.schema_version === undefined) return null;
	if (!Number.isInteger(state.schema_version)) {
		throw new Error("State Ledger schema_version must be an integer.");
	}
	return state.schema_version;
}

function normalizeChangedFiles(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value
			.flatMap((entry) =>
				typeof entry === "string" ? entry.split(/[\n,]/) : [],
			)
			.map((entry) => entry.trim())
			.filter(Boolean);
	}
	if (typeof value === "string") {
		return value
			.split(/[\n,]/)
			.map((entry) => entry.trim())
			.filter(Boolean);
	}
	return [];
}

function parseStatus(value: unknown, field: string): ExecutionStatus {
	if (value === "passed" || value === "failed" || value === "blocked") {
		return value;
	}
	throw new Error(`${field} must be passed, failed, or blocked.`);
}

function normalizeChecks(value: unknown): VerificationCheck[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error(
			"Structured execution evidence requires at least one check.",
		);
	}
	return value.map((entry, index) => {
		if (!isRecord(entry)) {
			throw new Error(
				`Execution evidence check ${index + 1} must be an object.`,
			);
		}
		const kind = entry.kind === undefined ? "command" : entry.kind;
		if (kind !== "command" && kind !== "manual") {
			throw new Error(`checks[${index}].kind must be command or manual.`);
		}
		const command =
			typeof entry.command === "string" ? entry.command.trim() : "";
		const summary =
			typeof entry.summary === "string" ? entry.summary.trim() : "";
		if (!command) throw new Error(`checks[${index}].command is required.`);
		if (!summary) throw new Error(`checks[${index}].summary is required.`);
		const status = parseStatus(entry.status, `checks[${index}].status`);
		const exitCode = entry.exit_code === null ? null : entry.exit_code;
		if (
			exitCode !== null &&
			(!Number.isInteger(exitCode) || Number(exitCode) < 0)
		) {
			throw new Error(
				`checks[${index}].exit_code must be a non-negative integer or null.`,
			);
		}
		if (kind === "command" && status === "passed" && exitCode !== 0) {
			throw new Error(
				`checks[${index}] command cannot pass without exit_code 0.`,
			);
		}
		if (kind === "manual" && exitCode !== null) {
			throw new Error(`checks[${index}] manual check must use exit_code null.`);
		}
		if (status === "failed" && exitCode === 0) {
			throw new Error(`checks[${index}] cannot fail with exit_code 0.`);
		}
		if (status === "blocked" && exitCode !== null) {
			throw new Error(`checks[${index}] must use exit_code null when blocked.`);
		}
		return {
			kind,
			command,
			status,
			exit_code: exitCode as number | null,
			summary,
			...(typeof entry.artifact === "string" && entry.artifact.trim()
				? { artifact: entry.artifact.trim() }
				: {}),
		};
	});
}

function deriveStatus(checks: VerificationCheck[]): ExecutionStatus {
	if (checks.some((check) => check.status === "failed")) return "failed";
	if (checks.some((check) => check.status === "blocked")) return "blocked";
	return "passed";
}

function legacyResultFailed(result: string): boolean {
	const normalized = result.trim();
	return FAILED_PRECHECK_PATTERNS.some((pattern) => pattern.test(normalized));
}

function migrateExecutionEvidence(
	value: unknown,
	location: string,
): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new Error(`${location} execution evidence must be an object.`);
	}
	const changedFiles = normalizeChangedFiles(value.changed_files);
	const hasStructuredFields =
		Object.hasOwn(value, "checks") || Object.hasOwn(value, "status");
	if (hasStructuredFields) {
		if (!Object.hasOwn(value, "checks") || !Object.hasOwn(value, "status")) {
			throw new Error(
				`${location} structured evidence requires status and checks.`,
			);
		}
		const checks = normalizeChecks(value.checks);
		const status = parseStatus(value.status, `${location}.status`);
		if (status !== deriveStatus(checks)) {
			throw new Error(`${location} status does not match its checks.`);
		}
		const {
			verification_result: _legacyResult,
			verification_command: _legacyCommand,
			...current
		} = value;
		return {
			...current,
			evidence_schema: "structured-v1",
			changed_files: changedFiles,
			status,
			checks,
			notes: typeof value.notes === "string" ? value.notes : "",
		};
	}

	const verificationResult =
		typeof value.verification_result === "string"
			? value.verification_result.trim()
			: "";
	if (!verificationResult) {
		throw new Error(
			`${location} legacy evidence requires a non-empty verification_result.`,
		);
	}
	const verificationCommand =
		typeof value.verification_command === "string"
			? value.verification_command.trim()
			: "";
	const status: ExecutionStatus = legacyResultFailed(verificationResult)
		? "failed"
		: "passed";
	const {
		verification_result: _legacyResult,
		verification_command: _legacyCommand,
		...preserved
	} = value;
	return {
		...preserved,
		evidence_schema: "structured-v1",
		changed_files: changedFiles,
		status,
		checks: [
			{
				kind: "manual",
				command: verificationCommand || "migrated legacy verification",
				status,
				exit_code: null,
				summary: verificationResult,
			},
		],
		notes: typeof value.notes === "string" ? value.notes : "",
		migrated_from: "legacy-execution-evidence",
	};
}

function migrateEvidenceContainer(
	container: unknown,
	location: string,
): boolean {
	if (
		!isRecord(container) ||
		container.execution_evidence === null ||
		container.execution_evidence === undefined
	)
		return false;
	const normalized = migrateExecutionEvidence(
		container.execution_evidence,
		location,
	);
	if (
		stableStringify(normalized) ===
		stableStringify(container.execution_evidence)
	) {
		return false;
	}
	container.execution_evidence = normalized;
	return true;
}

function migrateLedgerEvidence(state: Record<string, any>): string[] {
	const changed: string[] = [];
	if (!isRecord(state.steps)) {
		throw new Error("State Ledger steps must be an object.");
	}
	for (const [stepId, step] of Object.entries(state.steps)) {
		if (migrateEvidenceContainer(step, `steps.${stepId}`)) {
			changed.push(`steps.${stepId}.execution_evidence`);
		}
	}
	if (migrateEvidenceContainer(state.pending_follow_up, "pending_follow_up")) {
		changed.push("pending_follow_up.execution_evidence");
	}
	if (Array.isArray(state.follow_up_history)) {
		state.follow_up_history.forEach((followUp: unknown, index: number) => {
			if (migrateEvidenceContainer(followUp, `follow_up_history.${index}`)) {
				changed.push(`follow_up_history.${index}.execution_evidence`);
			}
		});
	}
	if (Array.isArray(state.closed_plan_history)) {
		state.closed_plan_history.forEach(
			(archive: unknown, archiveIndex: number) => {
				if (!isRecord(archive)) return;
				if (Array.isArray(archive.steps)) {
					archive.steps.forEach((step: unknown, stepIndex: number) => {
						if (
							migrateEvidenceContainer(
								step,
								`closed_plan_history.${archiveIndex}.steps.${stepIndex}`,
							)
						) {
							changed.push(
								`closed_plan_history.${archiveIndex}.steps.${stepIndex}.execution_evidence`,
							);
						}
					});
				}
				if (Array.isArray(archive.follow_ups)) {
					archive.follow_ups.forEach(
						(followUp: unknown, followUpIndex: number) => {
							if (
								migrateEvidenceContainer(
									followUp,
									`closed_plan_history.${archiveIndex}.follow_ups.${followUpIndex}`,
								)
							) {
								changed.push(
									`closed_plan_history.${archiveIndex}.follow_ups.${followUpIndex}.execution_evidence`,
								);
							}
						},
					);
				}
			},
		);
	}
	return changed;
}

function hasUnclosedWorkflowTarget(state: Record<string, any>): boolean {
	if (state.active_step !== null && state.active_step !== undefined) return true;
	if (state.pending_follow_up !== null && state.pending_follow_up !== undefined) {
		return true;
	}
	const steps = isRecord(state.steps) ? Object.values(state.steps) : [];
	return steps.some(
		(step) =>
			isRecord(step) &&
			typeof step.state === "string" &&
			step.state !== "pending" &&
			step.state !== "closed",
	);
}

function recoverSignedRoadmapPhaseCompletions(
	root: string,
	state: Record<string, any>,
): string[] {
	const reasons: string[] = [];
	if (hasUnclosedWorkflowTarget(state)) return reasons;
	const existing = state.roadmap_phase_completion_history;
	if (existing !== undefined && !Array.isArray(existing)) {
		throw new Error(
			"schema v3 roadmap_phase_completion_history must be an array when present.",
		);
	}
	const records = Array.isArray(existing) ? [...existing] : [];
	const knownIds = new Set(
		records
			.filter(isRecord)
			.map((record) => record.completion_id)
			.filter((id): id is string => typeof id === "string"),
	);
	const history = Array.isArray(state.history) ? state.history : [];
	const claimedSyncIndexes = new Set<number>();
	let recovered = 0;

	for (let finishIndex = 0; finishIndex < history.length; finishIndex += 1) {
		const finish = history[finishIndex];
		if (!isRecord(finish) || finish.action !== "finish_reset") continue;
		const finishDetails = finish.details;
		const planPath = isRecord(finishDetails)
			? finishDetails.plan_path
			: undefined;
		const diagnostic = (message: string): void => {
			reasons.push(
				`skipped Roadmap completion for history.${finishIndex}: ${message}`,
			);
		};
		if (typeof planPath !== "string" || !planPath.trim()) {
			diagnostic("finish_reset has no Plan path");
			continue;
		}

		let syncIndex = -1;
		let sync: Record<string, any> | null = null;
		for (let index = finishIndex - 1; index >= 0; index -= 1) {
			const candidate = history[index];
			if (
				isRecord(candidate) &&
				candidate.action === "sync_plan_from_imm_plan" &&
				isRecord(candidate.details) &&
				candidate.details.plan_path === planPath
			) {
				syncIndex = index;
				sync = candidate;
				break;
			}
		}
		if (!sync) {
			diagnostic("no prior same-path signed sync exists");
			continue;
		}
		if (claimedSyncIndexes.has(syncIndex)) {
			diagnostic("the nearest signed sync is already paired with another finish");
			continue;
		}
		claimedSyncIndexes.add(syncIndex);

		try {
			assertPlanPath(planPath);
			const absolutePlanPath = resolve(root, planPath);
			assertProjectFile(root, absolutePlanPath, "Historical Plan");
			const parsed = parsePlan(absolutePlanPath);
			const validation = validatePlan(parsed);
			if (validation.errors.length > 0) {
				throw new Error(
					`Plan validation failed: ${validation.errors.join("; ")}`,
				);
			}
			const normalized = normalizePlan(parsed, root);
			if (normalized.plan_path !== planPath) {
				throw new Error("Plan path does not reproduce its canonical identity");
			}
			const signed = sync.details.plan_signature;
			if (typeof signed !== "string" || !/^[0-9a-f]{64}$/.test(signed)) {
				throw new Error("nearest sync has no valid Plan signature");
			}
			if (buildPlanSignature(normalized) !== signed) {
				throw new Error("Plan signature mismatch against current file contents");
			}
			const roadmapSource = normalized.task.roadmap_source;
			const phase = normalized.task.current_phase;
			if (
				typeof roadmapSource !== "string" ||
				!roadmapSource.trim() ||
				typeof phase !== "string" ||
				!phase.trim()
			) {
				diagnostic("Plan declares no Roadmap source or Phase");
				continue;
			}
			const record = buildRoadmapPhaseCompletionRecord({
				plan_path: planPath,
				plan_signature: signed,
				roadmap_source: roadmapSource,
				phase,
				finished_at: finish.at,
				provenance: "signed_history_migration",
			});
			if (!knownIds.has(record.completion_id)) {
				records.push(record);
				knownIds.add(record.completion_id);
				recovered += 1;
			}
		} catch (error) {
			diagnostic(error instanceof Error ? error.message : String(error));
		}
	}

	if (recovered > 0) {
		state.roadmap_phase_completion_history = records;
		reasons.push(
			`recovered ${recovered} signed Roadmap Phase completion record(s)`,
		);
	}
	return reasons;
}

function toCurrentLedger(state: Record<string, any>, root: string): {
	state: StateLedger;
	reasons: string[];
} {
	const version = sourceVersion(state);
	if (version !== null && version > CURRENT_LEDGER_SCHEMA_VERSION) {
		throw new Error(`Unsupported future schema_version ${version}.`);
	}
	if (version !== null && version !== 2 && version !== 3) {
		throw new Error(`Unsupported legacy schema_version ${version}.`);
	}
	if (version === null || version === 2) {
		validateLegacyLedgerShape(state);
	}
	if (
		(version === 2 || version === null) &&
		(state.closed_plan_history !== undefined ||
			state.plan_transition_history !== undefined)
	) {
		throw new Error("Legacy State Ledger contains conflicting v3 collections.");
	}
	const migrated: Record<string, any> = structuredClone(state);
	const reasons: string[] = [];
	if (version !== CURRENT_LEDGER_SCHEMA_VERSION) {
		migrated.schema_version = CURRENT_LEDGER_SCHEMA_VERSION;
		migrated.closed_plan_history = [];
		migrated.plan_transition_history = [];
		migrated.roadmap_phase_completion_history = [];
		reasons.push(
			version === null ? "missing schema_version" : `schema v${version}`,
		);
	} else {
		if (!Array.isArray(migrated.closed_plan_history)) {
			throw new Error("schema v3 requires closed_plan_history as an array.");
		}
		if (!Array.isArray(migrated.plan_transition_history)) {
			throw new Error(
				"schema v3 requires plan_transition_history as an array.",
			);
		}
	}
	migrated.steps = isRecord(migrated.steps) ? migrated.steps : {};
	migrated.pending_follow_up = migrated.pending_follow_up ?? null;
	migrated.last_review = migrated.last_review ?? null;
	migrated.validated_plan_snapshot = migrated.validated_plan_snapshot ?? null;
	migrated.history = Array.isArray(migrated.history) ? migrated.history : [];
	migrated.review_follow_up_start_index =
		typeof migrated.review_follow_up_start_index === "number"
			? migrated.review_follow_up_start_index
			: 0;
	migrated.requires_replan = migrated.requires_replan ?? false;
	migrated.runtime_status = migrated.runtime_status ?? "idle";
	const evidenceChanges = migrateLedgerEvidence(migrated);
	if (evidenceChanges.length > 0) reasons.push(...evidenceChanges);
	const completionChanges = recoverSignedRoadmapPhaseCompletions(root, migrated);
	if (completionChanges.length > 0) reasons.push(...completionChanges);
	validateTransitionState(migrated);
	return { state: migrated as StateLedger, reasons };
}

function readPlanMigration(
	root: string,
	state: Record<string, any>,
): { file: MigrationFile | null; reason: string | null } {
	if (typeof state.plan_path !== "string" || !state.plan_path.trim()) {
		return { file: null, reason: null };
	}
	assertPlanPath(state.plan_path);
	const absolutePath = resolve(root, state.plan_path);
	assertProjectFile(root, absolutePath, "Active Plan");
	const before = readFileSync(absolutePath, "utf-8");
	const lines = before.split("\n");
	let reason: string | null = null;
	const rewritten = lines.map((line) => {
		const match = line.match(
			/^(\s*-\s*Spec:\s*)(`?)(docs\/architecture\/[^`\s]+)(`?)(\s*)$/,
		);
		if (!match) return line;
		if ((match[2] === "`") !== (match[4] === "`")) {
			throw new Error("Legacy Plan Spec reference has mismatched backticks.");
		}
		const nextReference = match[3].replace(
			/^docs\/architecture\//,
			"docs/specs/",
		);
		const target = resolve(root, nextReference);
		assertProjectFile(root, target, "Migrated Spec");
		reason = `legacy Spec reference ${match[3]}`;
		return `${match[1]}${match[2]}${nextReference}${match[4]}${match[5]}`;
	});
	const after = rewritten.join("\n");
	if (after === before) return { file: null, reason: null };
	const fileStat = statSync(absolutePath);
	return {
		file: {
			relative_path: relative(resolve(root), absolutePath).replace(/\\/g, "/"),
			absolute_path: absolutePath,
			before,
			after,
			mode: fileStat.mode & 0o777,
			device: fileStat.dev,
			inode: fileStat.ino,
		},
		reason,
	};
}

function buildMigrationFiles(root: string): {
	inspection: ProjectMigrationInspection;
	files: MigrationFile[];
} {
	const ledgerPath = statePath(root);
	if (!existsSync(ledgerPath)) {
		return {
			inspection: {
				status: "current",
				state_path: ledgerPath,
				source_version: null,
				reasons: [],
				plan_path: null,
				changed_files: [],
			},
			files: [],
		};
	}
	assertProjectFile(root, ledgerPath, "State Ledger");
	const before = readFileSync(ledgerPath, "utf-8");
	const state = parseLedger(before);
	let version: number | null;
	try {
		version = sourceVersion(state);
	} catch (error) {
		return invalidInspection(ledgerPath, state, error);
	}
	if (version !== null && version > CURRENT_LEDGER_SCHEMA_VERSION) {
		return {
			inspection: {
				status: "future",
				state_path: ledgerPath,
				source_version: version,
				reasons: [`Unsupported future schema_version ${version}.`],
				plan_path: typeof state.plan_path === "string" ? state.plan_path : null,
				changed_files: [],
			},
			files: [],
		};
	}
	try {
		const migrated = toCurrentLedger(state, root);
		const after = JSON.stringify(migrated.state, null, 2) + "\n";
		const files: MigrationFile[] = [];
		const ledgerChanged =
			version !== CURRENT_LEDGER_SCHEMA_VERSION ||
			stableStringify(migrated.state) !== stableStringify(state);
		if (ledgerChanged) {
			const ledgerStat = statSync(ledgerPath);
			files.push({
				relative_path: ".imm/memory/current_iteration.json",
				absolute_path: ledgerPath,
				before,
				after,
				mode: ledgerStat.mode & 0o777,
				device: ledgerStat.dev,
				inode: ledgerStat.ino,
			});
		}
		const planMigration = readPlanMigration(root, migrated.state);
		if (planMigration.file) files.push(planMigration.file);
		const reasons = [...migrated.reasons];
		if (planMigration.reason) reasons.push(planMigration.reason);
		return {
			inspection: {
				status: files.length > 0 ? "migration_required" : "current",
				state_path: ledgerPath,
				source_version: version,
				reasons,
				plan_path:
					typeof migrated.state.plan_path === "string"
						? migrated.state.plan_path
						: null,
				changed_files: files.map((file) => file.relative_path),
			},
			files,
		};
	} catch (error) {
		return invalidInspection(ledgerPath, state, error);
	}
}

function invalidInspection(
	ledgerPath: string,
	state: Record<string, any>,
	error: unknown,
): { inspection: ProjectMigrationInspection; files: MigrationFile[] } {
	return {
		inspection: {
			status: "invalid",
			state_path: ledgerPath,
			source_version:
				typeof state.schema_version === "number" ? state.schema_version : null,
			reasons: [error instanceof Error ? error.message : String(error)],
			plan_path: typeof state.plan_path === "string" ? state.plan_path : null,
			changed_files: [],
		},
		files: [],
	};
}

export function inspectProjectMigration(
	root: string,
): ProjectMigrationInspection {
	try {
		return buildMigrationFiles(resolve(root)).inspection;
	} catch (error) {
		return {
			status: "invalid",
			state_path: statePath(resolve(root)),
			source_version: null,
			reasons: [error instanceof Error ? error.message : String(error)],
			plan_path: null,
			changed_files: [],
		};
	}
}

function fsyncDirectory(path: string): void {
	const descriptor = openSync(path, "r");
	try {
		fsyncSync(descriptor);
	} finally {
		closeSync(descriptor);
	}
}

function atomicWrite(path: string, content: string, mode = 0o600): void {
	const parent = dirname(path);
	const temp = join(
		parent,
		`.${basename(path)}.migration-${process.pid}-${randomUUID()}`,
	);
	const descriptor = openSync(temp, "wx", mode);
	try {
		writeFileSync(descriptor, content, "utf-8");
		fsyncSync(descriptor);
	} catch (error) {
		try {
			unlinkSync(temp);
		} catch {
			// Preserve the original file.
		}
		throw error;
	} finally {
		closeSync(descriptor);
	}
	renameSync(temp, path);
	chmodSync(path, mode);
	fsyncDirectory(parent);
}

function writeManifest(path: string, manifest: MigrationManifest): void {
	atomicWrite(path, JSON.stringify(manifest, null, 2) + "\n");
}

function manifestIdentity(files: MigrationManifest["files"]): string {
	return sha256(
		files
			.map((file) => `${file.relative_path}\0${file.sha256}`)
			.sort((left, right) => left.localeCompare(right))
			.join("\0"),
	);
}

function validateManifest(
	root: string,
	dir: string,
	value: unknown,
): MigrationManifest {
	if (!isRecord(value))
		throw new Error("Migration manifest must be an object.");
	if (value.manifest_version !== 1) {
		throw new Error("Unsupported migration manifest version.");
	}
	if (
		typeof value.migration_id !== "string" ||
		!/^[a-f0-9]{64}$/.test(value.migration_id) ||
		basename(dir) !== value.migration_id
	) {
		throw new Error(
			"Migration manifest identity does not match its directory.",
		);
	}
	if (
		value.status !== "prepared" &&
		value.status !== "committed" &&
		value.status !== "rolled_back"
	) {
		throw new Error("Migration manifest has an invalid status.");
	}
	if (
		!Array.isArray(value.files) ||
		value.files.length < 1 ||
		value.files.length > 2
	) {
		throw new Error("Migration manifest must contain one or two files.");
	}
	const activePlanPath = readActivePlanPath(root);
	const files: MigrationManifest["files"] = value.files.map(
		(raw: unknown, index: number) => {
			if (!isRecord(raw)) {
				throw new Error(`Migration manifest file ${index} must be an object.`);
			}
			const isLedger =
				raw.relative_path === ".imm/memory/current_iteration.json";
			if (
				typeof raw.relative_path !== "string" ||
				(!isLedger && raw.relative_path !== activePlanPath)
			) {
				throw new Error(
					"Migration manifest target must be the State Ledger or the active Plan.",
				);
			}
			if (!isLedger) {
				assertPlanPath(raw.relative_path);
			}
			if (raw.backup_file !== `backup-${index}.txt`) {
				throw new Error("Migration manifest backup path is invalid.");
			}
			if (
				typeof raw.sha256 !== "string" ||
				!/^[a-f0-9]{64}$/.test(raw.sha256)
			) {
				throw new Error("Migration manifest backup hash is invalid.");
			}
			if (
				typeof raw.after_sha256 !== "string" ||
				!/^[a-f0-9]{64}$/.test(raw.after_sha256)
			) {
				throw new Error("Migration manifest replacement hash is invalid.");
			}
			if (!Number.isInteger(raw.mode) || raw.mode < 0 || raw.mode > 0o777) {
				throw new Error("Migration manifest file mode is invalid.");
			}
			const backup = join(dir, raw.backup_file);
			assertProjectFile(root, backup, "Migration backup");
			const content = readFileSync(backup, "utf-8");
			if (sha256(content) !== raw.sha256) {
				throw new Error(
					`Migration backup hash mismatch for ${raw.relative_path}.`,
				);
			}
			return {
				relative_path: raw.relative_path,
				sha256: raw.sha256,
				after_sha256: raw.after_sha256,
				backup_file: raw.backup_file,
				mode: raw.mode,
			};
		},
	);
	if (new Set(files.map((file) => file.relative_path)).size !== files.length) {
		throw new Error("Migration manifest contains duplicate targets.");
	}
	if (manifestIdentity(files) !== value.migration_id) {
		throw new Error("Migration manifest content does not match its identity.");
	}
	return {
		manifest_version: 1,
		migration_id: value.migration_id,
		status: value.status,
		created_at: typeof value.created_at === "string" ? value.created_at : "",
		...(typeof value.completed_at === "string"
			? { completed_at: value.completed_at }
			: {}),
		files,
	};
}

function readManifest(root: string, dir: string): MigrationManifest {
	assertProjectDirectory(root, dir, "Migration journal");
	const manifestPath = join(dir, "manifest.json");
	assertProjectFile(root, manifestPath, "Migration manifest");
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(manifestPath, "utf-8"));
	} catch {
		throw new Error(`Invalid migration manifest: ${manifestPath}`);
	}
	return validateManifest(root, dir, parsed);
}

function restoreFromManifest(
	root: string,
	dir: string,
	manifest: MigrationManifest,
): void {
	const errors: Error[] = [];
	for (const file of manifest.files.toReversed()) {
		try {
			const target = resolve(root, file.relative_path);
			assertProjectFile(root, target, "Migration restore target");
			const current = readFileSync(target, "utf-8");
			const currentHash = sha256(current);
			if (currentHash === file.sha256) continue;
			if (currentHash !== file.after_sha256) {
				throw new Error(
					`Migration target changed after journal preparation: ${file.relative_path}.`,
				);
			}
			const backup = join(dir, file.backup_file);
			assertProjectFile(root, backup, "Migration backup");
			const content = readFileSync(backup, "utf-8");
			if (sha256(content) !== file.sha256) {
				throw new Error(
					`Migration backup hash mismatch for ${file.relative_path}.`,
				);
			}
			atomicWrite(target, content, file.mode);
		} catch (error) {
			errors.push(error instanceof Error ? error : new Error(String(error)));
		}
	}
	if (errors.length > 0) {
		throw new AggregateError(errors, "Migration rollback was incomplete.");
	}
}

function recoverInterruptedMigrations(root: string): void {
	const base = migrationsRoot(root);
	if (!existsSync(base)) return;
	assertProjectDirectory(root, base, "Migration root");
	for (const entry of readdirSync(base, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const dir = join(base, entry.name);
		const manifestPath = join(dir, "manifest.json");
		if (!existsSync(manifestPath)) continue;
		const manifest = readManifest(root, dir);
		if (manifest.status !== "prepared") continue;
		restoreFromManifest(root, dir, manifest);
		manifest.status = "rolled_back";
		manifest.completed_at = new Date().toISOString();
		writeManifest(manifestPath, manifest);
	}
}

function migrationId(files: MigrationFile[]): string {
	return manifestIdentity(
		files.map((file) => ({
			relative_path: file.relative_path,
			sha256: sha256(file.before),
			after_sha256: sha256(file.after),
			backup_file: "",
			mode: file.mode,
		})),
	);
}

function prepareMigration(
	root: string,
	files: MigrationFile[],
): {
	id: string;
	dir: string;
	manifestPath: string;
	manifest: MigrationManifest;
} {
	const id = migrationId(files);
	const base = migrationsRoot(root);
	mkdirSync(base, { recursive: true, mode: 0o700 });
	assertProjectDirectory(root, base, "Migration root");
	const dir = join(base, id);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	assertProjectDirectory(root, dir, "Migration journal");
	const manifest: MigrationManifest = {
		manifest_version: 1,
		migration_id: id,
		status: "prepared",
		created_at: new Date().toISOString(),
		files: files.map((file, index) => {
			const backupFile = `backup-${index}.txt`;
			const backupPath = join(dir, backupFile);
			const expectedHash = sha256(file.before);
			if (!existsSync(backupPath)) {
				atomicWrite(backupPath, file.before);
			} else {
				assertProjectFile(root, backupPath, "Migration backup");
				if (sha256(readFileSync(backupPath, "utf-8")) !== expectedHash) {
					throw new Error(
						`Existing migration backup is invalid: ${backupFile}`,
					);
				}
			}
			return {
				relative_path: file.relative_path,
				sha256: expectedHash,
				after_sha256: sha256(file.after),
				backup_file: backupFile,
				mode: file.mode,
			};
		}),
	};
	fsyncDirectory(dir);
	const manifestPath = join(dir, "manifest.json");
	writeManifest(manifestPath, manifest);
	validateManifest(root, dir, manifest);
	return { id, dir, manifestPath, manifest };
}

function publishCommittedManifest(
	root: string,
	dir: string,
	manifestPath: string,
	manifest: MigrationManifest,
): void {
	try {
		writeManifest(manifestPath, manifest);
	} catch (error) {
		try {
			const persisted = readManifest(root, dir);
			if (persisted.status === "committed") return;
		} catch {
			// The original publication error remains authoritative.
		}
		throw error;
	}
}

function assertMigrationSourceUnchanged(file: MigrationFile): void {
	if (!existsSync(file.absolute_path)) {
		throw new Error(
			`Migration source changed after preparation: ${file.relative_path}`,
		);
	}
	const current = statSync(file.absolute_path);
	if (
		current.dev !== file.device ||
		current.ino !== file.inode ||
		readFileSync(file.absolute_path, "utf8") !== file.before
	) {
		throw new Error(
			`Migration source changed after preparation: ${file.relative_path}`,
		);
	}
}

function terminalizeMigrationReceiptBestEffort(
	ledgerPath: string,
	prepared: PreparedAuthorityCommit,
	status: "committed" | "aborted",
	ledgerRevision: string | null,
): AuthorityCommitReceipt | null {
	try {
		return terminalizeAuthorityCommit(
			ledgerPath,
			prepared,
			status,
			ledgerRevision,
		);
	} catch (error) {
		console.error(
			`warning: project migration outcome was decided but its terminal authority receipt failed: ${
				error instanceof Error ? error.message : error
			}`,
		);
		return null;
	}
}

export function migrateProject(root: string): ProjectMigrationResult {
	const projectRoot = resolve(root);
	const ledgerPath = statePath(projectRoot);
	if (!existsSync(ledgerPath)) {
		const inspection = inspectProjectMigration(projectRoot);
		return {
			...inspection,
			migrated: false,
			migration_id: null,
			backup_dir: null,
		};
	}
	let result: ProjectMigrationResult | null = null;
	try {
		result = withLedgerWriteLock(ledgerPath, () => {
			recoverInterruptedMigrations(projectRoot);
			recoverAuthorityCommitReceipts(ledgerPath);
			const { inspection, files } = buildMigrationFiles(projectRoot);
			if (inspection.status === "current") {
				return {
					...inspection,
					migrated: false,
					migration_id: null,
					backup_dir: null,
				};
			}
			if (inspection.status !== "migration_required") {
				throw new Error(inspection.reasons.join(" "));
			}
			const prepared = prepareMigration(projectRoot, files);
			const ledgerFile = files.find(
				(file) => file.absolute_path === ledgerPath,
			);
			const authorityAttempt = ledgerFile
				? (() => {
						const attemptId = randomUUID();
						const previousState = JSON.parse(ledgerFile.before) as StateLedger;
						const committedState = JSON.parse(ledgerFile.after) as StateLedger;
						const committedRevision = buildLedgerRevision(committedState);
						const committedAt = new Date().toISOString();
						const seed = buildAuthorityObservationSeedV2(
							authorityStatePathIdentity(ledgerPath),
							{
								attempt_id: attemptId,
								source_kind: "project_migration",
								source_ref: prepared.id,
								receipt_status: "committed",
								previous_state: previousState,
								proposed_state: committedState,
								committed_state: committedState,
								committed_bytes: ledgerFile.after,
								ledger_revision: committedRevision,
								committed_at: committedAt,
							},
						);
						return prepareAuthorityCommit(ledgerPath, {
							attempt_id: attemptId,
							source_kind: "project_migration",
							source_ref: prepared.id,
							ledger_revision: committedRevision,
							observation_generation: AUTHORITY_OBSERVATION_GENERATION_V2,
							observation_seed: seed,
							targets: files.map((file) => ({
								absolute_path: file.absolute_path,
								before_bytes: file.before,
								after_bytes: file.after,
							})),
						});
					})()
				: null;
			let after: ProjectMigrationInspection;
			let replacedFiles = 0;
			try {
				files.forEach((file, index) => {
					beforeReplaceForTest?.(file.relative_path, index);
					assertMigrationSourceUnchanged(file);
					atomicWrite(
						file.absolute_path,
						file.after,
						file.absolute_path === ledgerPath ? 0o600 : file.mode,
					);
					replacedFiles += 1;
				});
				beforeFinalizeForTest?.();
				after = inspectProjectMigration(projectRoot);
				if (after.status !== "current") {
					throw new Error(
						`Migrated project is not current: ${after.reasons.join(" ")}`,
					);
				}
				prepared.manifest.status = "committed";
				prepared.manifest.completed_at = new Date().toISOString();
				publishCommittedManifest(
					projectRoot,
					prepared.dir,
					prepared.manifestPath,
					prepared.manifest,
				);
			} catch (error) {
				try {
					if (replacedFiles > 0) {
						restoreFromManifest(projectRoot, prepared.dir, prepared.manifest);
					}
					prepared.manifest.status = "rolled_back";
					prepared.manifest.completed_at = new Date().toISOString();
					writeManifest(prepared.manifestPath, prepared.manifest);
					if (authorityAttempt) {
						terminalizeMigrationReceiptBestEffort(
							ledgerPath,
							authorityAttempt,
							"aborted",
							null,
						);
					}
				} catch (rollbackError) {
					throw new AggregateError(
						[
							error instanceof Error ? error : new Error(String(error)),
							rollbackError instanceof Error
								? rollbackError
								: new Error(String(rollbackError)),
						],
						"Migration failed and rollback was incomplete.",
					);
				}
				throw error;
			}
			if (ledgerFile && authorityAttempt) {
				const committedLedger = JSON.parse(
					readFileSync(ledgerPath, "utf8"),
				) as StateLedger;
				terminalizeMigrationReceiptBestEffort(
					ledgerPath,
					authorityAttempt,
					"committed",
					buildLedgerRevision(committedLedger),
				);
			}
			return {
				...after,
				reasons: inspection.reasons,
				changed_files: inspection.changed_files,
				migrated: true,
				migration_id: prepared.id,
				backup_dir: relative(projectRoot, prepared.dir).replace(/\\/g, "/"),
			};
		});
	} finally {
		replayMissingAutomaticObservationsV2BestEffort(ledgerPath);
	}
	if (!result) throw new Error("Project migration completed without a result.");
	return result;
}
