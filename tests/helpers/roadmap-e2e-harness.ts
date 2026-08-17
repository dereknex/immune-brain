import { createHash } from "node:crypto";
import {
	copyFileSync,
	readdirSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const FIXTURE_DIR = resolve(REPO_ROOT, "tests/fixtures/roadmap-e2e");
const PLUGIN_BIN_DIR = resolve(REPO_ROOT, "plugins/immune-brain/bin");

export const E2E_PATHS = {
	predecessor: "plans/predecessor.md",
	terminal: "plans/terminal.md",
	alternative: "plans/alternative.md",
	spec: "specs/roadmap.spec.md",
	ledger: ".imm/memory/current_iteration.json",
} as const;

export type AuthoritySnapshot = Record<string, string>;

export type CliResult = {
	command: string;
	args: string[];
	status: number | null;
	stdout: string;
	stderr: string;
};

export function createE2ERoot(): string {
	const root = mkdtempSync(join(tmpdir(), "imm-roadmap-e2e-"));
	mkdirSync(join(root, ".imm", "memory"), { recursive: true });
	mkdirSync(join(root, "plans"), { recursive: true });
	mkdirSync(join(root, "specs"), { recursive: true });
	mkdirSync(join(root, ".home"), { recursive: true });
	for (const file of readdirSync(FIXTURE_DIR)) {
		const source = join(FIXTURE_DIR, file);
		const target =
			file === "roadmap.spec.md"
				? join(root, E2E_PATHS.spec)
				: join(root, "plans", file);
		copyFileSync(source, target);
	}
	return root;
}

export function cleanupE2ERoot(root: string): void {
	if (process.env.IMM_P4_KEEP_FIXTURE === "1") return;
	rmSync(root, { recursive: true, force: true });
}

export function runPlugin(
	root: string,
	command: string,
	args: string[],
): CliResult {
	const result = spawnSync(join(PLUGIN_BIN_DIR, command), args, {
		cwd: root,
		env: {
			...process.env,
			HOME: join(root, ".home"),
			XDG_CONFIG_HOME: join(root, ".home", "config"),
		},
		encoding: "utf8",
		maxBuffer: 512 * 1024,
	});
	return {
		command,
		args,
		status: result.status,
		stdout: result.stdout,
		stderr: result.stderr,
	};
}

export function authoritySnapshot(root: string): AuthoritySnapshot {
	const paths = [
		E2E_PATHS.ledger,
		E2E_PATHS.predecessor,
		E2E_PATHS.terminal,
		E2E_PATHS.alternative,
		E2E_PATHS.spec,
		"HANDOFF.md",
		".imm/developer-inbox.md",
		".pi/sessions/sentinel.json",
	];
	return Object.fromEntries(
		paths.map((path) => {
			const absolute = join(root, path);
			if (!existsSync(absolute)) return [path, "<missing>"];
			const digest = createHash("sha256")
				.update(readFileSync(absolute))
				.digest("hex");
			return [path, digest];
		}),
	);
}

export function readJson<T>(result: CliResult): T {
	return JSON.parse(result.stdout) as T;
}

export function ledgerBytes(root: string): string {
	return readFileSync(join(root, E2E_PATHS.ledger), "utf8");
}

export function seedExternalSentinels(root: string): void {
	mkdirSync(join(root, ".pi", "sessions"), { recursive: true });
	mkdirSync(join(root, ".imm"), { recursive: true });
	const sentinels = [
		["HANDOFF.md", "handoff sentinel\n"],
		[".imm/developer-inbox.md", "inbox sentinel\n"],
		[".pi/sessions/sentinel.json", "session sentinel\n"],
	] as const;
	for (const [path, content] of sentinels)
		writeFileSync(join(root, path), content);
}
