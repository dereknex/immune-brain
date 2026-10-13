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
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import {
	KERNEL_DB_RELATIVE,
	LEGACY_ARTIFACT_RETIREMENT,
	FILE_STORE_WORKSPACE_RELATIVE,
	LEGACY_WORKSPACE_RELATIVE,
	MIGRATION_MARKER_RELATIVE,
	auditTaskRecordPath,
	auditTerminalProofPath,
	inspectStorageLayout,
} from "./storage_paths";
import { hasMigrationReceipt, importLegacyWorkspace } from "./sqlite_migration";
import { commitWorkflowPaths, type WorkflowCommitResult } from "../assurance/workflow_autocommit";

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
	/**
	 * A migration only reports success when the worktree really left the retired
	 * layout: anything the import could not interpret — an unknown file in a
	 * retired directory, for example — is reported instead of being hidden behind
	 * a success that the next layout check would immediately contradict.
	 */
	const confirmRetired = (outcome: MigrationOutcome): MigrationOutcome => {
		const after = inspectStorageLayout(root);
		if (after.layout === "ready" || after.layout === "migration_required") return outcome;
		return {
			contract: CONTRACT,
			outcome: "invalid",
			affected_paths: outcome.affected_paths,
			reason: `the retired layout is still present after migration: ${after.reason ?? after.layout}`,
		};
	};
	/**
	 * Finish a published import whose cleanup or identity marker never completed.
	 * The layout can already look `ready` — a leftover owner-free workspace file
	 * does not make it conflict — so the receipt, not the diagnosis, decides
	 * whether there is still something to finish.
	 */
	const finishPublishedImport = (): MigrationOutcome | null => {
		if (!existsSync(join(root, KERNEL_DB_RELATIVE)) || !hasMigrationReceipt(root)) return null;
		const finished = importLegacyWorkspace(root);
		if (finished.outcome === "already_imported")
			return confirmRetired({
				contract: CONTRACT,
				outcome: "already_migrated",
				affected_paths: [],
				reason: "finished the interrupted cleanup for an already published import",
			});
		return {
			contract: CONTRACT,
			outcome: "invalid",
			affected_paths: affected,
			reason: finished.reason ?? "the published store could not be verified",
		};
	};
	if (inspection.layout === "ready") {
		const finished = finishPublishedImport();
		if (finished) return finished;
		return {
			contract: CONTRACT,
			outcome: "already_migrated",
			affected_paths: affected,
			reason: "the worktree already uses the SQLite authority store",
		};
	}
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
		if (inspection.layout === "invalid") {
			const finished = finishPublishedImport();
			if (finished) return finished;
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
		return confirmRetired({
			contract: CONTRACT,
			outcome: "migrated",
			affected_paths: imported.imported_task_ids.flatMap((taskId) => [auditTaskRecordPath(taskId), auditTerminalProofPath(taskId)]),
			reason:
				imported.outcome === "imported"
					? `imported ${imported.imported_task_ids.length} terminal task(s) into the SQLite authority; commit the affected audit paths`
					: "the recorded import identity already matches these legacy facts; nothing to do",
		});
	return {
		contract: CONTRACT,
		outcome: "invalid",
		affected_paths: affected,
		reason: imported.reason ?? "the SQLite import refused this layout",
	};
}

const MIGRATION_SUBJECT = "chore(imm): commit storage-layout migration";

function retiredEvidencePath(path: string): string | undefined {
	const artifact = LEGACY_ARTIFACT_RETIREMENT.find((entry) => entry.source === path);
	if (artifact) return artifact.evidence;
	const match = /^\.imm\/(?:tasks|state\/tasks)\/([^/]+)\.json$/.exec(path);
	if (!match || match[1].startsWith(".")) return undefined;
	const proof = match[1].endsWith(".backend-claim");
	const taskId = proof ? match[1].slice(0, -".backend-claim".length) : match[1];
	return proof ? auditTerminalProofPath(taskId) : auditTaskRecordPath(taskId);
}

/** The importer validates current bytes; committed evidence identifies retired paths on retry. */
function pendingCleanupPaths(root: string): string[] {
	const tree = execFileSync("git", ["-C", root, "ls-tree", "-r", "-z", "HEAD", "--", ".imm"],
		{ encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
	const blobs = new Map(tree.split("\0").filter(Boolean).map((entry) => {
		const tab = entry.indexOf("\t");
		return [entry.slice(tab + 1), entry.slice(0, tab).split(" ")[2]] as const;
	}));
	return [...blobs.keys()].filter((path) => {
		if (existsSync(join(root, path))) return false;
		const evidence = retiredEvidencePath(path);
		if (evidence) return blobs.has(evidence);
		if (path === FILE_STORE_WORKSPACE_RELATIVE || path === LEGACY_WORKSPACE_RELATIVE) return true;
		return false;
	});
}

/** Consumers may commit an existing diff, but never initiate a conversion. */
export function commitPendingMigrationDiff(root: string, signal?: AbortSignal): WorkflowCommitResult {
	const inspection = inspectStorageLayout(root);
	if (inspection.layout !== "migration_uncommitted") return { committed: false };
	return commitWorkflowPaths(root, { paths: inspection.dirty_affected_paths, subject: MIGRATION_SUBJECT, signal });
}

/** Preserve the importer's committed-evidence barrier, then commit its cleanup. */
export function migrateAndCommitLegacyLayout(root: string, signal?: AbortSignal): MigrationOutcome & { commits: string[] } {
	const commits: string[] = [];
	const affected = new Set<string>();
	const commit = (paths: string[]) => {
		const result = commitWorkflowPaths(root, { paths, subject: MIGRATION_SUBJECT, signal });
		if (result.committed) {
			commits.push(result.commit);
			for (const path of result.paths) affected.add(path);
		}
		return result.committed;
	};
	try {
		// At most two pending phases: original source dirt, then preserved evidence.
		for (let phase = 0; phase < 3; phase++) {
			signal?.throwIfAborted();
			const migration = migrateLegacyLayout(root);
			if (migration.outcome === "migration_uncommitted") {
				const tracked = execFileSync("git", ["-C", root, "ls-files", "-z", "--", ".imm"],
					{ encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).split("\0");
				const evidence = new Set(migration.affected_paths);
				const sources = tracked.filter((path) => existsSync(join(root, path)) && evidence.has(retiredEvidencePath(path) ?? ""));
				if (!commit([...migration.affected_paths, ...sources]))
					throw new Error("migration reported a pending diff but no affected path could be committed");
				continue;
			}
			if (migration.outcome !== "migrated" && migration.outcome !== "already_migrated")
				return { ...migration, commits };
			commit([...migration.affected_paths, ...pendingCleanupPaths(root)]);
			const after = inspectStorageLayout(root);
			if (after.layout !== "ready") throw new Error(`storage layout is still ${after.layout}: ${after.reason ?? ""}`);
			return { ...migration, affected_paths: [...affected].sort(), reason: "storage layout is ready", commits };
		}
		throw new Error("migration remained uncommitted after the source and evidence phases");
	} catch (error) {
		const note = commits.length ? `; precondition commit(s) remain: ${commits.join(", ")}` : "";
		return { contract: CONTRACT, outcome: "invalid", affected_paths: [...affected].sort(), commits,
			reason: `${error instanceof Error ? error.message : String(error)}${note}` };
	}
}
