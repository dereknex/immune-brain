// Resolves the repository's Git integration policy through layered configuration.
import { resolveConfig } from "./config/layered_config";

export type GitIntegrationMode = "manual" | "auto";

export interface GitIntegrationPreference {
	mode: GitIntegrationMode;
	/** The file that declared (or failed) the preference, or null for the default. */
	source: ".imm/config.json" | "AGENTS.md" | "CLAUDE.md" | string | null;
	/** Invalid or deprecated declarations are reported to the caller. */
	diagnostic: string | null;
}

export function readGitIntegrationPreference(root: string): GitIntegrationPreference {
	const config = resolveConfig(root);
	const userFile = config.files.user;
	const error = config.diagnostics.find((d) => d.severity === "error" && (
		(d.file === userFile && (
			d.key_path === "git_integration"
			|| ["$", "contract"].includes(d.key_path)
			|| (d.key_path === "projects" && d.message.endsWith(": expected object"))
			|| (!d.key_path.includes(".") && d.message.endsWith(": unknown key"))
			|| (d.key_path.startsWith("projects.") && !/\.(decision_models|lanes)(\.|$)/.test(d.key_path) && (d.message.endsWith(": expected object") || d.message.endsWith(": unknown key")))
		))
		|| (d.file === ".imm/config.json" && (d.key_path === "git_integration" || ["$", "contract"].includes(d.key_path) || (!d.key_path.includes(".") && d.message.endsWith("unknown key"))))
		|| ((d.file === "AGENTS.md" || d.file === "CLAUDE.md") && d.key_path === "git_integration")
	));
	const legacy = config.git_integration.source.startsWith("legacy:") ? config.git_integration.source.slice(7) : null;
	const source = error?.file === userFile || (!error && config.git_integration.source === "user") ? userFile
		: error?.file === ".imm/config.json" || config.git_integration.source === "project" ? ".imm/config.json"
		: error?.file === "AGENTS.md" || legacy === "AGENTS.md" ? "AGENTS.md"
		: error?.file === "CLAUDE.md" || legacy === "CLAUDE.md" ? "CLAUDE.md" : null;
	return {
		mode: config.git_integration.value as GitIntegrationMode,
		source,
		diagnostic: error ? `${error.message}; using manual` : legacy ? `${legacy}: Git integration is deprecated; use git_integration in .imm/config.json` : null,
	};
}
