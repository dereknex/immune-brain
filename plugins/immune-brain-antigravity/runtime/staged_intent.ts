// Staging a TaskIntent sidecar is one operation on both Hosts: capture the
// sidecar bytes together with its Git index entry, and restore both. Claude used
// to stop at `git update-index`; Pi re-read the bytes and the index and failed
// closed on any mismatch. The stricter branch is now the only one, so a restore
// that silently left either side inconsistent cannot pass as success.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface StagedIntentSnapshot {
	/** Repository-relative path of the staged sidecar. */
	path: string;
	bytes: Buffer;
	index_state: Buffer;
}

/** Capture the sidecar bytes and the exact index entry the restore must reproduce. */
export function captureStagedIntent(root: string, relativePath: string): StagedIntentSnapshot {
	return {
		path: relativePath,
		bytes: readFileSync(join(root, relativePath)),
		index_state: execFileSync("git", ["ls-files", "--stage", "-z", "--", relativePath], {
			cwd: root,
			stdio: ["ignore", "pipe", "pipe"],
		}),
	};
}

/**
 * Restore the sidecar and its index entry, then verify both. A restore that
 * leaves either the bytes or the index different from the snapshot throws.
 */
export function restoreStagedIntent(root: string, snapshot: StagedIntentSnapshot): void {
	writeFileSync(join(root, snapshot.path), snapshot.bytes);
	execFileSync("git", ["update-index", "--force-remove", "--", snapshot.path], {
		cwd: root,
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (snapshot.index_state.length > 0) {
		execFileSync("git", ["update-index", "-z", "--index-info"], {
			cwd: root,
			input: snapshot.index_state,
			stdio: ["pipe", "ignore", "pipe"],
		});
	}
	const restoredBytes = readFileSync(join(root, snapshot.path));
	if (!restoredBytes.equals(snapshot.bytes)) {
		throw new Error("failed to restore prior intent bytes");
	}
	const restoredIndex = execFileSync("git", ["ls-files", "--stage", "-z", "--", snapshot.path], {
		cwd: root,
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (!restoredIndex.equals(snapshot.index_state)) {
		throw new Error("failed to restore prior intent git index entry");
	}
}
