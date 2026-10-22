import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

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

export function noTouchPaths(paths: readonly string[], additions: readonly string[] = []): string[] {
	return paths.filter(path => {
		const name = path.split("/").at(-1)!;
		return path === ".imm/state" || path.startsWith(".imm/state/") ||
			path === ".github/workflows" || path.startsWith(".github/workflows/") || path === ".changeset/config.json" ||
			name === ".env" || name.startsWith(".env.") || /\.(pem|key)$/.test(name) ||
			/^id_(rsa|ed25519)/.test(name) || name === ".npmrc" || name === ".netrc" ||
			additions.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
	});
}

export function assertNoTouch(paths: readonly string[], additions: readonly string[] = []): void {
	const forbidden = noTouchPaths(paths, additions);
	if (forbidden.length) throw new Error(`no_touch_path_changed: ${forbidden.join(", ")}`);
}
