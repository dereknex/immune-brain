// The repository's `Git integration` preference (ADR 0024). It decides whether
// the runtime may write commits to the user's branch on its own: `manual` (the
// default) never does, `auto` keeps the precondition commits and adds a settle
// commit. Read-only; an unreadable or invalid declaration resolves to `manual`.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type GitIntegrationMode = "manual" | "auto";

export interface GitIntegrationPreference {
	mode: GitIntegrationMode;
	/** The tracked root instruction file that declared it, or null for the default. */
	source: "AGENTS.md" | "CLAUDE.md" | null;
	/** Why a declaration was not honored; null when it was valid or absent. */
	diagnostic: string | null;
}

const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md"] as const;
const DIRECTIVE = /^\s*[-*]\s+Git integration:\s*(.*?)\s*$/i;

function tracked(root: string, path: string): boolean {
	return spawnSync("git", ["ls-files", "--error-unmatch", "--", path], { cwd: root, stdio: "ignore" }).status === 0;
}

/**
 * The first `- Git integration: <value>` line of the tracked repository root
 * `AGENTS.md`, else of the tracked root `CLAUDE.md`. Absent means `manual`; a
 * value other than `manual` or `auto` also means `manual`, with a diagnostic
 * naming the file and the value.
 */
export function readGitIntegrationPreference(root: string): GitIntegrationPreference {
	for (const file of INSTRUCTION_FILES) {
		if (!tracked(root, file)) continue;
		let text: string;
		try {
			text = readFileSync(join(root, file), "utf8");
		} catch {
			continue;
		}
		for (const line of text.split(/\r?\n/)) {
			const match = DIRECTIVE.exec(line);
			if (!match) continue;
			const value = match[1].replace(/^`(.*)`$/, "$1").trim();
			if (value === "manual" || value === "auto") return { mode: value, source: file, diagnostic: null };
			return {
				mode: "manual",
				source: file,
				diagnostic: `${file} declares Git integration: ${JSON.stringify(value)}, which is neither manual nor auto; using manual`,
			};
		}
	}
	return { mode: "manual", source: null, diagnostic: null };
}
