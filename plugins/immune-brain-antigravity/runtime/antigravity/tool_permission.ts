import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Reads ancestor process argument vectors, ordered from the nearest parent
 * process upwards. Each entry is an `argv` array starting with the executable.
 */
export type AncestorProcessReader = () => ReadonlyArray<ReadonlyArray<string>>;

export interface NativeGateSurfacingOptions {
	/** Override user home directory for `<home>/.gemini/antigravity-cli/settings.json`. */
	home?: string;
	/** Override ancestor-process reader for deterministic testing. */
	readAncestorArgs?: AncestorProcessReader;
}

export type NativeGateSurfacingResult =
	| { ok: true; settingsPath: string; agyArgv: ReadonlyArray<string> }
	| { ok: false; cause: string; remediation: string; reason: string };

const REQUIRED_TOOL_PERMISSION = "request-review";
const UNCERTIFIED_TOOL_PERMISSIONS = new Set(["strict", "proceed-in-sandbox"]);
const DISALLOWED_AGY_FLAGS = ["--dangerously-skip-permissions", "--print", "-p"] as const;
const MAX_ANCESTOR_DEPTH = 64;

/** Path to Antigravity's CLI user settings file under `home`. */
export function antigravitySettingsPath(home = homedir()): string {
	return join(home, ".gemini", "antigravity-cli", "settings.json");
}

function fail(cause: string, remediation: string): NativeGateSurfacingResult {
	return {
		ok: false,
		cause,
		remediation,
		reason: `Native confirmation gate cannot surface (${cause}). Remediation: ${remediation}`,
	};
}

function isAgyExecutable(executable: string): boolean {
	const cleaned = executable.trim().replace(/^["']|["']$/g, "");
	if (!cleaned) return false;
	const base = cleaned.split(/[\\/]/).pop() ?? "";
	return base === "agy" || base === "agy.exe";
}

function findDisallowedFlags(args: ReadonlyArray<string>): string[] {
	const found: string[] = [];
	for (const arg of args) {
		if (arg === "--") break;
		for (const flag of DISALLOWED_AGY_FLAGS) {
			if (arg === flag) {
				if (!found.includes(flag)) found.push(flag);
				break;
			}
			if (arg.startsWith(`${flag}=`)) {
				const value = arg.slice(flag.length + 1);
				if (value !== "false" && value !== "0") {
					if (!found.includes(flag)) found.push(flag);
				}
				break;
			}
		}
	}
	return found;
}

/**
 * Default ancestor-process argument reader using `ps` (POSIX/BSD + procps-ng).
 * Walks from `process.ppid` up to PID 1 and throws on any inspection failure
 * so callers fail closed.
 */
export function readAncestorProcessArgs(): ReadonlyArray<ReadonlyArray<string>> {
	const ancestors: string[][] = [];
	const seen = new Set<number>();
	let pid = process.ppid;
	while (Number.isSafeInteger(pid) && pid > 1 && !seen.has(pid) && ancestors.length < MAX_ANCESTOR_DEPTH) {
		seen.add(pid);
		const out = execFileSync("ps", ["-ww", "-o", "ppid=,args=", "-p", String(pid)], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
		const line = out.split(/\r?\n/).find((entry) => entry.trim().length > 0);
		if (!line) {
			throw new Error(`ps returned no process row for pid ${pid}`);
		}
		const match = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
		if (!match) {
			throw new Error(`unexpected ps output for pid ${pid}: ${line}`);
		}
		const nextPpid = Number(match[1]);
		const tokens = match[2].trim().split(/\s+/).filter(Boolean);
		if (tokens.length > 0) {
			ancestors.push(tokens);
		}
		pid = nextPpid;
	}
	return ancestors;
}

function readToolPermission(settingsPath: string, remediation: string): { ok: true } | NativeGateSurfacingResult {
	let raw: string;
	try {
		const stat = lstatSync(settingsPath);
		if (!stat.isFile()) {
			return fail(`Antigravity settings path is not a regular file (${settingsPath})`, remediation);
		}
		raw = readFileSync(settingsPath, "utf8");
	} catch (error) {
		const code = (error as NodeJS.ErrnoException | undefined)?.code;
		if (code === "ENOENT" || code === "ENOTDIR") {
			return fail(`Antigravity settings.json is missing (${settingsPath})`, remediation);
		}
		const detail = error instanceof Error ? error.message : String(error);
		return fail(`Antigravity settings.json could not be read (${settingsPath}): ${detail}`, remediation);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return fail(`Antigravity settings.json is unparsable JSON (${settingsPath})`, remediation);
	}

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return fail(`Antigravity settings.json must be a JSON object (${settingsPath})`, remediation);
	}

	if (!Object.hasOwn(parsed, "toolPermission") || (parsed as Record<string, unknown>).toolPermission === undefined) {
		return fail(`toolPermission key is missing in ${settingsPath}`, remediation);
	}

	const permission = (parsed as Record<string, unknown>).toolPermission;
	if (typeof permission !== "string") {
		const kind = permission === null ? "null" : Array.isArray(permission) ? "array" : typeof permission;
		return fail(`toolPermission in ${settingsPath} must be a string (got ${kind})`, remediation);
	}

	if (permission !== REQUIRED_TOOL_PERMISSION) {
		if (UNCERTIFIED_TOOL_PERMISSIONS.has(permission)) {
			return fail(
				`toolPermission is "${permission}" in ${settingsPath}, which is refused until live confirmation-dialog evidence is verified`,
				remediation,
			);
		}
		return fail(
			`toolPermission is "${permission}" in ${settingsPath}, which auto-approves or does not surface a native confirmation dialog`,
			remediation,
		);
	}

	return { ok: true };
}

/**
 * Verifies that Antigravity can surface a human confirmation dialog before the
 * `PreToolUse` hook writes a native confirmation grant or returns `force_ask`.
 */
export function checkNativeGateSurfacing(
	options: NativeGateSurfacingOptions = {},
): NativeGateSurfacingResult {
	const home = options.home ?? homedir();
	const settingsPath = antigravitySettingsPath(home);
	const remediation =
		`Set "toolPermission": "${REQUIRED_TOOL_PERMISSION}" in ${settingsPath} and run an interactive agy session (without --dangerously-skip-permissions, --print, or -p).`;

	const settingsCheck = readToolPermission(settingsPath, remediation);
	if (!settingsCheck.ok) return settingsCheck;

	const reader = options.readAncestorArgs ?? readAncestorProcessArgs;
	let ancestors: ReadonlyArray<ReadonlyArray<string>>;
	try {
		ancestors = reader();
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		return fail(`unable to inspect ancestor processes: ${detail}`, remediation);
	}

	if (!Array.isArray(ancestors)) {
		return fail("unable to inspect ancestor processes: invalid ancestor list", remediation);
	}

	for (const argv of ancestors) {
		if (!Array.isArray(argv) || argv.length === 0 || typeof argv[0] !== "string") continue;
		if (!isAgyExecutable(argv[0])) continue;

		const disallowed = findDisallowedFlags(argv.slice(1));
		if (disallowed.length > 0) {
			return fail(
				`nearest ancestor agy process was started with ${disallowed.join(", ")}, which prevents interactive native confirmation dialogs`,
				remediation,
			);
		}
		return { ok: true, settingsPath, agyArgv: argv };
	}

	return fail(
		"no ancestor agy process was found, so no interactive native confirmation dialog can surface",
		remediation,
	);
}
