/**
 * Storage-layout diagnosis and the explicit import entry point.
 *
 * Diagnosis stays read-only and reports what a worktree holds. The conversion
 * itself is the SQLite importer in `sqlite_migration.ts`: it preserves the raw
 * historical bytes as audit evidence, imports them into a verified candidate
 * store, and publishes that store atomically.
 *
 * The previous file-relocation writer — manifest building, byte-CAS relocation,
 * marker replay and lock files — is deleted. Replaying a retired manifest would
 * write a second authority layout that no runtime reads, so a leftover marker is
 * reported for reconciliation instead.
 *
 * Removal milestone: this diagnosis module and its result contract are deleted
 * in the next major release, once no supported workspace can still carry the
 * retired file store.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
	KERNEL_DB_RELATIVE,
	MIGRATION_MARKER_RELATIVE,
	auditTaskRecordPath,
	auditTerminalProofPath,
	inspectStorageLayout,
} from "./storage_paths";
import { hasMigrationReceipt, importLegacyWorkspace } from "./sqlite_migration";

export interface MigrationOutcome {
	contract: "immune_brain/storage_layout_migration_result/v1";
	outcome:
		| "migrated"
		| "recovery_required"
		| "migration_blocked_active"
		| "invalid"
		| "already_migrated"
		| "migration_uncommitted";
	affected_paths: string[];
	reason: string | null;
}

const CONTRACT = "immune_brain/storage_layout_migration_result/v1";

/**
 * Diagnose the retired file store and refuse to convert it implicitly.
 *
 * Only an owner-free, committed legacy layout reaches the importer; every other
 * layout returns its stable diagnosis with the concrete reason an operator must
 * resolve first.
 */
export function migrateLegacyLayout(root: string): MigrationOutcome {
	const inspection = inspectStorageLayout(root);
	const affected = inspection.dirty_affected_paths;
	if (inspection.layout === "ready")
		return {
			contract: CONTRACT,
			outcome: "already_migrated",
			affected_paths: affected,
			reason: "the worktree already uses the SQLite authority store",
		};
	if (inspection.layout === "migration_uncommitted")
		return {
			contract: CONTRACT,
			outcome: "migration_uncommitted",
			affected_paths: affected,
			reason: inspection.reason ?? "affected legacy or audit paths differ from HEAD; commit or restore them before migration",
		};
	if (inspection.layout === "migration_blocked_active")
		return {
			contract: CONTRACT,
			outcome: "migration_blocked_active",
			affected_paths: affected,
			reason: inspection.reason ?? "a live legacy task still owns work; settle or stop it on the prior runtime first",
		};
	if (inspection.layout === "recovery_required")
		return {
			contract: CONTRACT,
			outcome: "recovery_required",
			affected_paths: affected,
			reason: `a retired file-relocation manifest at ${MIGRATION_MARKER_RELATIVE} is not replayed: reconcile the listed legacy evidence, delete the manifest, then rerun the import`,
		};
	if (inspection.layout !== "migration_required") {
		// A published store beside surviving legacy files is what a crash between
		// the publication rename and the cleanup looks like. A receipt proves this
		// worktree imported those facts, so the importer verifies the store and
		// finishes the cleanup instead of refusing.
		if (inspection.layout === "invalid" && existsSync(join(root, KERNEL_DB_RELATIVE)) && hasMigrationReceipt(root)) {
			const finished = importLegacyWorkspace(root);
			if (finished.outcome === "already_imported")
				return {
					contract: CONTRACT,
					outcome: "already_migrated",
					affected_paths: affected,
					reason: "finished the interrupted cleanup for an already published import",
				};
			return {
				contract: CONTRACT,
				outcome: "invalid",
				affected_paths: affected,
				reason: finished.reason ?? "the published store could not be verified",
			};
		}
		return {
			contract: CONTRACT,
			outcome: "invalid",
			affected_paths: affected,
			reason: inspection.reason ?? `unsupported storage layout: ${inspection.layout}`,
		};
	}
	const imported = importLegacyWorkspace(root);
	if (imported.uncommitted_evidence.length > 0)
		return {
			contract: CONTRACT,
			outcome: "migration_uncommitted",
			affected_paths: imported.uncommitted_evidence,
			reason: imported.reason ?? "the preserved audit evidence must be committed before the legacy authority is retired",
		};
	if (imported.outcome === "imported" || imported.outcome === "already_imported")
		return {
			contract: CONTRACT,
			outcome: "migrated",
			affected_paths: imported.imported_task_ids.flatMap((taskId) => [auditTaskRecordPath(taskId), auditTerminalProofPath(taskId)]),
			reason:
				imported.outcome === "imported"
					? `imported ${imported.imported_task_ids.length} terminal task(s) into the SQLite authority; commit the affected audit paths`
					: "the recorded import identity already matches these legacy facts; nothing to do",
		};
	return {
		contract: CONTRACT,
		outcome: "invalid",
		affected_paths: affected,
		reason: imported.reason ?? "the SQLite import refused this layout",
	};
}
