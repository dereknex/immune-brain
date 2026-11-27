import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { resolveAgents } from "./agent_roles.ts";

// Two layers resolve every key (ADR 0041): the project's local, unversioned
// `.imm/config.json` overrides the user's `config.json`, which overrides the
// built-in default. Permission keys take the stricter of the two values.

type Obj = Record<string, any>;
type ResolvedLeaf = { value: unknown; source: string };
/**
 * Where a reserved Review or Verification round runs: one explicit supervised
 * session the Parent launches inside Herdr (Spec retire-process-review-transport D1, D2).
 */
export type ReviewTransport = "herdr";
export type ReviewProfile = {
	host: "pi" | "claude-code" | "antigravity";
	model?: string;
	effort?: string;
	transport?: ReviewTransport;
};
export type ConfigDiagnostic = { code: string; severity: "error" | "warning"; file: string; key_path: string; message: string };
const object = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const leaf = (value: unknown, source: string): ResolvedLeaf => ({ value, source });

export const USER_CONFIG_CONTRACT = "immune_brain/user_config/v2";
export const PROJECT_CONFIG_CONTRACT = "immune_brain/project_config/v2";

/** The top-level keys either file may set; `profiles` under agents stays user-only.
 * `herdr` is retired (warning only, never resolved). `loop` and `decision_models` retired with the
 * in-repo Loop daemon, and `batch` and `session_providers` with the unattended batch (ADR 0043): each
 * is an unknown key, `config_invalid`, until `imm-kernel config migrate --write` strips it. */
const FILE_KEYS = ["contract", "agents", "herdr", "git_integration", "external_approval", "initiative_carrier", "review_verifier"];

export function defaultUserConfigPath(): string {
	return join(process.env.XDG_CONFIG_HOME && isAbsolute(process.env.XDG_CONFIG_HOME) ? process.env.XDG_CONFIG_HOME : join(homedir(), ".config"), "immune-brain/config.json");
}

/**
 * The main checkout's root: the project file is local and unversioned, so a Lane
 * worktree reads the one beside the main checkout instead of its own copy.
 */
export function mainCheckoutRoot(root: string): string {
	try {
		const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
		return basename(common) === ".git" ? dirname(common) : root;
	} catch { return root; }
}

export function projectConfigPath(root: string): string {
	return join(mainCheckoutRoot(root), ".imm/config.json");
}

export function resolveConfig(root: string, options: { userConfigPath?: string; projectConfigPath?: string } = {}) {
	const diagnostics: ConfigDiagnostic[] = [];
	const diag = (code: string, severity: "error" | "warning", file: string, key_path: string, message: string) => {
		diagnostics.push({ code, severity, file, key_path, message: `${file}: ${key_path}: ${message}` });
	};
	const invalid = (file: string, key: string, message: string) => diag("config_invalid", "error", file, key, message);
	const userPath = options.userConfigPath ?? defaultUserConfigPath();
	const projectPath = options.projectConfigPath ?? projectConfigPath(root);
	/** A file that fails to parse is void as a whole; a missing file is empty. */
	const read = (path: string, contract: string): Obj | null => {
		if (!existsSync(path)) return null;
		try {
			const data: unknown = JSON.parse(readFileSync(path, "utf8"));
			if (!object(data)) { invalid(path, "$", "expected object"); return null; }
			if (data.contract !== contract) {
				invalid(path, "contract", typeof data.contract === "string" && data.contract.endsWith("/v1")
					? `${data.contract} is retired; run \`imm-kernel config migrate\` to rewrite it as ${contract}`
					: `expected ${contract}`);
				return null;
			}
			for (const key of Object.keys(data)) if (!FILE_KEYS.includes(key)) invalid(path, key, "unknown key");
			return data;
		} catch { invalid(path, "$", "unreadable or malformed JSON"); return null; }
	};
	const user = read(userPath, USER_CONFIG_CONTRACT);
	const project = read(projectPath, PROJECT_CONFIG_CONTRACT);
	const layers = [["project", project, projectPath], ["user", user, userPath]] as const;
	/** The first layer whose value passes `ok`; an invalid value counts as unset and records an error. */
	const pick = (get: (o: Obj) => unknown, key: string, ok: (v: unknown) => boolean, message: string, fallback: unknown = null): ResolvedLeaf => {
		for (const [layer, o, file] of layers) {
			const value = o ? get(o) : undefined;
			if (value === undefined) continue;
			if (ok(value)) return leaf(value, layer);
			invalid(file, key, message);
		}
		return leaf(fallback, "default");
	};
	/** Every layer's valid value for a key, project first. */
	const valid = (get: (o: Obj) => unknown, key: string, ok: (v: unknown) => boolean, message: string): Array<{ value: any; source: string }> => {
		const out: Array<{ value: any; source: string }> = [];
		for (const [layer, o, file] of layers) {
			const value = o ? get(o) : undefined;
			if (value === undefined) continue;
			if (ok(value)) out.push({ value, source: layer });
			else invalid(file, key, message);
		}
		return out;
	};
	const oneOf = (values: readonly unknown[]) => (v: unknown) => values.includes(v);

	// agents
	const agentLayers = resolveAgents({ user: user ? (user.agents ?? null) : null, project: project ? (project.agents ?? null) : null, files: { user: userPath, project: projectPath } });
	for (const error of agentLayers.errors) diag(error.code, "error", error.file, error.key_path, error.message);
	const agents = agentLayers.agents;
	// Retired top-level `herdr` switch: ignored, warned once per layer that sets it, never resolved.
	for (const [, o, file] of layers) if (o && Object.hasOwn(o, "herdr"))
		diag("retired_key", "warning", file, "herdr", "herdr is retired and ignored; remove it (imm-kernel config migrate --write deletes it)");
	// plain keys
	const reviewVerifier = pick((o) => o.review_verifier, "review_verifier", oneOf(["off", "on"]), "expected off or on", "off");
	const carrier = pick((o) => o.initiative_carrier, "initiative_carrier", oneOf(["github", "local"]), "expected github or local");
	// Permission key: `manual` wins wherever it is set, and an invalid value or a void file behaves as `manual`.
	const git = valid((o) => o.git_integration, "git_integration", oneOf(["manual", "auto"]), "expected manual or auto");
	const gitBroken = diagnostics.find((d) => d.severity === "error" && ["git_integration", "$", "contract"].includes(d.key_path));
	const gitIntegration = gitBroken ? { value: "manual", source: gitBroken.file === projectPath ? "project" : "user" }
		: git.find((g) => g.value === "manual") ?? git[0] ?? { value: "manual", source: "default" };
	// Permission key (ADR 0043 Slice 2): `false` wins wherever it is set, and an invalid value or a
	// void file behaves as `false`, so a project file never re-enables what the user turned off.
	const external = valid((o) => o.external_approval, "external_approval", (v) => typeof v === "boolean", "expected true or false");
	const externalBroken = diagnostics.find((d) => d.severity === "error" && ["external_approval", "$", "contract"].includes(d.key_path));
	const externalApproval = externalBroken ? { value: false, source: externalBroken.file === projectPath ? "project" : "user" }
		: external.find((e) => e.value === false) ?? external[0] ?? { value: false, source: "default" };

	return {
		contract: "immune_brain/effective_config/v2",
		files: { user: userPath, project: projectPath },
		agents,
		git_integration: leaf(gitIntegration.value, gitIntegration.source),
		external_approval: { value: externalApproval.value === true, source: externalApproval.source },
		initiative_carrier: carrier,
		review_verifier: reviewVerifier,
		diagnostics,
	};
}

export type EffectiveConfig = ReturnType<typeof resolveConfig>;

