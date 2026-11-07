import { spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { readGitIntegrationPreference } from "../git_integration_preference";
import { porcelainEntries } from "./batch_preflight";
import type { BatchFinalReport } from "./batch_final_report";

type DeliveredPath = { path: string; newMode: string; newBlob: string; deleted: boolean };

const gitIn = (root: string, ...args: string[]) => spawnSync("git", ["--no-optional-locks", "-C", root, ...args], { encoding: "utf8" });

/** The delivered change list with each path's new identity, or null when the diff is unreadable. */
function deliveredPaths(root: string, base: string, head: string): DeliveredPath[] | null {
	const raw = gitIn(root, "diff", "--raw", "-z", "--abbrev=40", "--no-renames", base, head, "--");
	if (raw.status !== 0) return null;
	const fields = raw.stdout.split("\0").filter(Boolean);
	const paths: DeliveredPath[] = [];
	for (let i = 0; i + 1 < fields.length; i += 2) {
		const meta = /^:(\d+) (\d+) ([0-9a-f]+) ([0-9a-f]+) (\S+)$/.exec(fields[i]!);
		if (!meta) return null;
		paths.push({ path: fields[i + 1]!, newMode: meta[2]!, newBlob: meta[4]!, deleted: meta[5] === "D" });
	}
	return paths;
}

/**
 * Per-path identity (D1): the path already carries exactly its delivered identity. Index mode+blob equal the
 * delivered entry and worktree bytes hash to that blob with a matching mode; a deletion is absent from index and worktree.
 */
function pathSatisfied(root: string, entry: DeliveredPath): boolean {
	const staged = gitIn(root, "--literal-pathspecs", "ls-files", "--stage", "-z", "--", entry.path);
	if (staged.status !== 0) return false;
	if (entry.deleted) {
		if (staged.stdout.length) return false;
		try { lstatSync(join(root, entry.path)); return false; } catch { return true; }
	}
	const indexed = /^(\d+) ([0-9a-f]+) \d\t/.exec(staged.stdout);
	if (!indexed || indexed[1] !== entry.newMode || indexed[2] !== entry.newBlob) return false;
	let stat;
	try { stat = lstatSync(join(root, entry.path)); } catch { return false; }
	const worktreeMode = stat.isSymbolicLink() ? "120000" : stat.isFile() ? (stat.mode & 0o111 ? "100755" : "100644") : "";
	if (worktreeMode !== entry.newMode) return false;
	const hashed = gitIn(root, "hash-object", "--no-filters", "--", entry.path);
	return hashed.status === 0 && hashed.stdout.trim() === entry.newBlob;
}

/**
 * Replay guard (D5): the delivery was already applied by an interrupted earlier attempt only when the
 * checkout carries the exact delivered identity. Manual mode requires every delivered path to be satisfied;
 * auto mode compares ref lineage. Any difference is "not applied".
 */
export function deliveryAlreadyApplied(root: string, base: string, head: string): boolean {
	const { mode } = readGitIntegrationPreference(root);
	if (mode === "auto") return gitIn(root, "merge-base", "--is-ancestor", head, "HEAD").status === 0;
	const paths = deliveredPaths(root, base, head);
	return !!paths?.length && paths.every(entry => pathSatisfied(root, entry));
}

/** Deliver exactly the Lane's integrated delta, preserving unrelated checkout changes. */
export function deliverSingleTask(root: string, base: string, head: string): BatchFinalReport["return_to_coordinator"] {
	const { mode } = readGitIntegrationPreference(root);
	const blocked = (reason: string): BatchFinalReport["return_to_coordinator"] => ({ mode, status: "blocked", reason });
	const git = (...args: string[]) => gitIn(root, ...args);
	if (deliveryAlreadyApplied(root, base, head)) return { mode, status: mode === "auto" ? "fast_forwarded" : "staged", reason: null };
	const changed = deliveredPaths(root, base, head);
	const dirty = porcelainEntries(root);
	if (!changed || !dirty) return blocked("coordinator_status_unreadable");
	// Manual mode delivers only paths that do not already carry their delivered identity (D1/D2); auto is a lineage fast-forward (D3).
	const pending = (mode === "auto" ? changed : changed.filter(entry => !pathSatisfied(root, entry))).map(entry => entry.path);
	const overlaps = dirty.map(entry => entry.path).filter(path => pending.some(file =>
		path === file || path.startsWith(`${file}/`) || file.startsWith(`${path}/`)));
	if (overlaps.length) return blocked(`checkout_delivery_overlap: ${[...new Set(overlaps)].sort().join(", ")}`);
	if (mode === "auto") {
		if (git("symbolic-ref", "--quiet", "HEAD").status !== 0) return blocked("coordinator_branch_unavailable");
		if (git("merge-base", "--is-ancestor", "HEAD", head).status !== 0) return blocked("coordinator_head_diverged");
		const merge = git("merge", "--ff-only", "--no-edit", head);
		if (merge.status !== 0) return blocked(`checkout_delivery_conflict: ${merge.stderr.trim()}`);
		return { mode, status: "fast_forwarded", reason: null };
	}
	if (!pending.length) return { mode, status: "staged", reason: null };
	const patch = spawnSync("git", ["--no-optional-locks", "--literal-pathspecs", "-C", root, "diff", "--binary", "--full-index", "--no-renames", base, head, "--", ...pending], { maxBuffer: 128 * 1024 * 1024 });
	if (patch.status !== 0) return blocked("checkout_delivery_conflict: cannot read delivery delta");
	if (!patch.stdout.length) return { mode, status: "staged", reason: null };
	const apply = (check: boolean) => spawnSync("git", ["--no-optional-locks", "-C", root, "apply", "--index", ...(check ? ["--check"] : [])], { input: patch.stdout, encoding: "utf8" });
	const checked = apply(true);
	if (checked.status !== 0) return blocked(`checkout_delivery_conflict: ${checked.stderr.trim()}`);
	const applied = apply(false);
	if (applied.status !== 0) return blocked(`checkout_delivery_conflict: ${applied.stderr.trim()}`);
	return { mode, status: "staged", reason: null };
}
