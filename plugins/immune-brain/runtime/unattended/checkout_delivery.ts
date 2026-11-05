import { spawnSync } from "node:child_process";
import { readGitIntegrationPreference } from "../git_integration_preference";
import { porcelainEntries } from "./batch_preflight";
import type { BatchFinalReport } from "./batch_final_report";

/** Deliver exactly the Lane's integrated delta, preserving unrelated checkout changes. */
export function deliverSingleTask(root: string, base: string, head: string): BatchFinalReport["return_to_coordinator"] {
	const { mode } = readGitIntegrationPreference(root);
	const blocked = (reason: string): BatchFinalReport["return_to_coordinator"] => ({ mode, status: "blocked", reason });
	const git = (...args: string[]) => spawnSync("git", ["--no-optional-locks", "-C", root, ...args], { encoding: "utf8" });
	const changed = git("diff", "--name-only", "--no-renames", "-z", base, head, "--");
	const dirty = porcelainEntries(root);
	if (changed.status !== 0 || !dirty) return blocked("coordinator_status_unreadable");
	const delivered = changed.stdout.split("\0").filter(Boolean);
	const overlaps = dirty.map(entry => entry.path).filter(path => delivered.some(file =>
		path === file || path.startsWith(`${file}/`) || file.startsWith(`${path}/`)));
	if (overlaps.length) return blocked(`checkout_delivery_overlap: ${[...new Set(overlaps)].sort().join(", ")}`);
	if (mode === "auto") {
		if (git("symbolic-ref", "--quiet", "HEAD").status !== 0) return blocked("coordinator_branch_unavailable");
		if (git("merge-base", "--is-ancestor", "HEAD", head).status !== 0) return blocked("coordinator_head_diverged");
		const merge = git("merge", "--ff-only", "--no-edit", head);
		if (merge.status !== 0) return blocked(`checkout_delivery_conflict: ${merge.stderr.trim()}`);
		return { mode, status: "fast_forwarded", reason: null };
	}
	const patch = spawnSync("git", ["--no-optional-locks", "-C", root, "diff", "--binary", "--full-index", "--no-renames", base, head, "--"], { maxBuffer: 128 * 1024 * 1024 });
	if (patch.status !== 0) return blocked("checkout_delivery_conflict: cannot read delivery delta");
	if (!patch.stdout.length) return { mode, status: "staged", reason: null };
	const apply = (check: boolean) => spawnSync("git", ["--no-optional-locks", "-C", root, "apply", "--index", ...(check ? ["--check"] : [])], { input: patch.stdout, encoding: "utf8" });
	const checked = apply(true);
	if (checked.status !== 0) return blocked(`checkout_delivery_conflict: ${checked.stderr.trim()}`);
	const applied = apply(false);
	if (applied.status !== 0) return blocked(`checkout_delivery_conflict: ${applied.stderr.trim()}`);
	return { mode, status: "staged", reason: null };
}
