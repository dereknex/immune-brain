import { STATE_RELATIVE } from "./kernel/storage_paths";

/**
 * The Kernel hard-refuses only state it owns: the worktree authority root
 * `.imm/state` and everything beneath it. Any other protection is a Review
 * concern declared through `.imm/risk-floor.json`.
 */
export function noTouchPaths(paths: readonly string[]): string[] {
	return paths.filter(path => path === STATE_RELATIVE || path.startsWith(`${STATE_RELATIVE}/`));
}

export function assertNoTouch(paths: readonly string[]): void {
	const forbidden = noTouchPaths(paths);
	if (forbidden.length) throw new Error(`no_touch_path_changed: ${forbidden.join(", ")}`);
}
