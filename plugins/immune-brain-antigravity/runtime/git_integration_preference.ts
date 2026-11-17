// Resolves the repository's Git integration policy through layered configuration (ADR 0041).
import { resolveConfig } from "./config/layered_config";

export type GitIntegrationMode = "manual" | "auto";

export interface GitIntegrationPreference {
	mode: GitIntegrationMode;
	/** The user file path or `.imm/config.json` that declared (or failed) the preference, or null for the default. */
	source: string | null;
	/** An invalid declaration, or a void file, reported to the caller; the mode is then `manual`. */
	diagnostic: string | null;
}

export function readGitIntegrationPreference(root: string): GitIntegrationPreference {
	const config = resolveConfig(root);
	const { user, project } = config.files;
	const error = config.diagnostics.find((d) => d.severity === "error" && (d.file === user || d.file === project)
		&& ["git_integration", "$", "contract"].includes(d.key_path));
	const name = (file: string) => (file === project ? ".imm/config.json" : file);
	const resolved = config.git_integration.source === "user" ? user : config.git_integration.source === "project" ? project : null;
	return {
		mode: config.git_integration.value as GitIntegrationMode,
		source: error ? name(error.file) : resolved && name(resolved),
		diagnostic: error ? `${error.message}; using manual` : null,
	};
}
