import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { STATE_RELATIVE } from "./kernel/storage_paths";

export const NO_TOUCH_PATH = "docs/agents/no-touch.json";
const CONTRACT = "immune_brain/no_touch/v1";

export function parseNoTouch(value: unknown): string[] {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid no_touch: expected object");
	const declaration = value as Record<string, unknown>;
	for (const key of Object.keys(declaration))
		if (key !== "contract" && key !== "paths") throw new Error(`invalid no_touch.${key}: unknown field`);
	if (declaration.contract !== CONTRACT) throw new Error("invalid no_touch.contract");
	if (!Array.isArray(declaration.paths)) throw new Error("invalid no_touch.paths: expected array");
	return declaration.paths.map((path, index) => {
		if (typeof path !== "string" || !path || path !== path.trim() || /[\x00-\x1f\x7f\\:*?\[\]{}]/.test(path) ||
			path.startsWith("/") || path.split("/").some(part => !part || part === "." || part === ".." || part.toLowerCase() === ".git"))
			throw new Error(`invalid no_touch.paths[${index}]: expected literal repository-relative path`);
		return path;
	});
}

export function readNoTouch(root: string): string[] {
	const target = join(root, NO_TOUCH_PATH);
	try {
		const stat = lstatSync(target);
		if (realpathSync(target) !== join(realpathSync(root), NO_TOUCH_PATH) || !stat.isFile() || stat.size > 65536) throw new Error("invalid no_touch: expected regular file at most 64 KiB");
		return parseNoTouch(JSON.parse(readFileSync(target, "utf8")));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

export function readNoTouchAt(root: string, commit: string): string[] {
	const options = { cwd: root, encoding: "utf8" as const, stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"], maxBuffer: 65536 };
	const entry = execFileSync("git", ["ls-tree", "-z", commit, "--", NO_TOUCH_PATH], options);
	if (!entry) return [];
	if (!/^100(?:644|755) blob /.test(entry)) throw new Error("invalid no_touch: expected regular file");
	return parseNoTouch(JSON.parse(execFileSync("git", ["show", `${commit}:${NO_TOUCH_PATH}`], options)));
}

/**
 * The Kernel hard-refuses only state it owns: the worktree authority root. Any
 * other protection is a project decision declared through `docs/agents/no-touch.json`
 * (hard refusal) or `.imm/risk-floor.json` (Review escalation).
 */
export function noTouchPaths(paths: readonly string[], additions: readonly string[] = []): string[] {
	return paths.filter(path =>
		path === STATE_RELATIVE || path.startsWith(`${STATE_RELATIVE}/`) ||
		additions.some(prefix => path === prefix || path.startsWith(`${prefix}/`)),
	);
}

export function assertNoTouch(paths: readonly string[], additions: readonly string[] = []): void {
	const forbidden = noTouchPaths(paths, additions);
	if (forbidden.length) throw new Error(`no_touch_path_changed: ${forbidden.join(", ")}`);
}
