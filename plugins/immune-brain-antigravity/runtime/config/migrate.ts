// `imm-kernel config migrate`: rewrite the v1 user and project files, and the
// legacy sources beside them, as v2 (ADR 0041). It runs in one repository: the
// user-global choices go to the user file, this repository's `projects.<key>`
// entry goes to this repository's local `.imm/config.json`, and every other
// `projects` entry is listed for its own repository. Nothing is written
// without `--write`. Writing over a v1 user file first keeps it as
// `<user file>.v1`, so that a later run in another repository still reads its
// `projects` entry (and the v1 roles it refers to) from there.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { AGENT_ROLES, type AgentRole } from "./agent_roles.ts";
import { defaultUserConfigPath, mainCheckoutRoot, PROJECT_CONFIG_CONTRACT, USER_CONFIG_CONTRACT } from "./layered_config.ts";
import { projectIdentity } from "./project_identity.ts";

type Obj = Record<string, any>;
const object = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const V1_USER = "immune_brain/user_config/v1";
const V1_PROJECT = "immune_brain/project_config/v1";
/** Top-level keys no current contract reads; `--write` deletes them from either file. */
const RETIRED_KEYS = ["herdr", "loop", "decision_models", "batch", "session_providers"] as const;

/** The v1 roles each v2 role takes its value from, first bound wins. */
const ROLE_SOURCES: Record<AgentRole, readonly string[]> = {
	executor: ["executor", "repair"],
	reviewer: ["code-review", "review-verifier", "advisory-reviewer"],
	planner: ["plan", "clarify"],
	triage: ["judging"],
};

export interface MigrationFile { path: string; before: Obj | null; after: Obj; changed: boolean }
export interface MigrationReport { user: MigrationFile; project: MigrationFile; notes: string[]; written: boolean }

function readJson(path: string): Obj | null {
	if (!existsSync(path)) return null;
	const data: unknown = JSON.parse(readFileSync(path, "utf8"));
	if (!object(data)) throw new Error(`${path}: expected a JSON object`);
	return data;
}

const tracked = (root: string, path: string) => {
	try { execFileSync("git", ["ls-files", "--error-unmatch", "--", path], { cwd: root, stdio: "ignore" }); return true; } catch { return false; }
};

/** A v1 Lane profile's executor and review groups as whole v2 profiles. */
function laneRoles(lane: Obj): Partial<Record<AgentRole, Obj>> {
	const out: Partial<Record<AgentRole, Obj>> = {};
	const group = (prefix: string) => object(lane) && typeof lane[`${prefix}_host`] === "string"
		? { host: lane[`${prefix}_host`], ...(lane[`${prefix}_model`] ? { model: lane[`${prefix}_model`] } : {}), ...(lane[`${prefix}_effort`] ? { effort: lane[`${prefix}_effort`] } : {}) }
		: undefined;
	const executor = group("executor"), reviewer = group("review");
	if (executor) out.executor = executor;
	if (reviewer) out.reviewer = reviewer;
	return out;
}

/** The v2 roles one v1 `agents` preset binds, by the v1 lookup order. */
function presetRoles(agents: Obj, active: string, notes: string[]): Partial<Record<AgentRole, string>> {
	const presets = object(agents.presets) ? agents.presets : {};
	const roles = (name: string): Obj => object(presets[name]?.roles) ? presets[name].roles : {};
	const lookup = (role: string): string | undefined => roles(active)[role] ?? roles("default")[role] ?? roles(active)["*"] ?? roles("default")["*"];
	const out: Partial<Record<AgentRole, string>> = {};
	for (const role of AGENT_ROLES) {
		const values = ROLE_SOURCES[role].map((source) => [source, lookup(source)] as const).filter(([, v]) => typeof v === "string");
		if (!values.length) continue;
		out[role] = values[0]![1]!;
		const dropped = values.filter(([, v]) => v !== out[role]);
		if (dropped.length) notes.push(`preset ${active}: ${role} takes ${values[0]![0]} = ${out[role]}; ${dropped.map(([s, v]) => `${s} = ${v}`).join(", ")} no longer has a role of its own`);
	}
	return out;
}

/** The v1 transports that opted into Herdr tabs (executor or advisory). */
const herdrRequested = (profiles: Obj, lanes: Obj[]) =>
	Object.values(profiles).some((p) => object(p) && p.transport === "herdr")
	|| lanes.some((l) => object(l) && l.advisory_transport === "herdr");

export function migrateConfig(root: string, options: { userConfigPath?: string; write?: boolean } = {}): MigrationReport {
	const notes: string[] = [];
	const main = mainCheckoutRoot(root);
	const userPath = options.userConfigPath ?? defaultUserConfigPath();
	const projectPath = join(main, ".imm/config.json");
	const userBefore = readJson(userPath);
	const projectBefore = readJson(projectPath);
	if (userBefore && userBefore.contract === USER_CONFIG_CONTRACT && (!projectBefore || projectBefore.contract === PROJECT_CONFIG_CONTRACT))
		notes.push("both files already use the v2 contract");
	const backupPath = `${userPath}.v1`;
	const userMigrated = userBefore?.contract === USER_CONFIG_CONTRACT;
	const archived = userMigrated ? readJson(backupPath) : null;
	const u: Obj = userBefore?.contract === V1_USER ? userBefore : userMigrated ? (archived?.contract === V1_USER ? archived : {}) : (userBefore ?? {});
	const p: Obj = projectBefore?.contract === V1_PROJECT ? projectBefore : projectBefore?.contract === PROJECT_CONFIG_CONTRACT ? {} : (projectBefore ?? {});
	const userAfter: Obj = userBefore?.contract === USER_CONFIG_CONTRACT ? structuredClone(userBefore) : { contract: USER_CONFIG_CONTRACT };
	const projectAfter: Obj = projectBefore?.contract === PROJECT_CONFIG_CONTRACT ? structuredClone(projectBefore) : { contract: PROJECT_CONFIG_CONTRACT };

	let key = "";
	try { key = projectIdentity(root); } catch { notes.push("cannot determine this repository's project key; projects entries are listed, not migrated"); }
	const projects: Obj = object(u.projects) ? u.projects : {};
	const mine: Obj = key && object(projects[key]) ? projects[key] : {};
	for (const other of Object.keys(projects)) if (other !== key) notes.push(`projects.${other} belongs to another repository: run \`imm-kernel config migrate\` there (the v1 user file is kept as ${backupPath})`);

	// Legacy sources fill only what the v1 files left unset.
	const legacyFile = (path: string): Obj => { const v = readJson(join(main, path)); if (v) notes.push(`${path} was read; delete it once the migration is written`); return v ?? {}; };
	const legacyLanes = legacyFile(".imm/lanes.local.json");
	const directive = (regex: RegExp): string | undefined => {
		for (const file of ["AGENTS.md", "CLAUDE.md"]) {
			if (!tracked(main, file)) continue;
			for (const line of readFileSync(join(main, file), "utf8").split(/\r?\n/)) {
				const match = regex.exec(line);
				if (match) { notes.push(`${file}: the "${line.trim()}" line was read; remove it once the migration is written`); return match[1]!.trim().replace(/^`|`$/g, ""); }
			}
		}
	};
	const gitLegacy = directive(/^\s*[-*]\s+Git integration:\s*(.*?)\s*$/i);
	const carrierLegacy = directive(/^\s*[-*]\s+Initiative carrier default:\s*(.*?)\s*$/i);

	// agents: user profiles keep their names; transport moves to the herdr switch.
	const agents: Obj = object(u.agents) ? u.agents : {};
	const lanes: Obj = object(u.lanes) ? u.lanes : legacyLanes;
	const laneProfiles: Obj = object(lanes.profiles) ? lanes.profiles : {};
	const v1Profiles: Obj = object(agents.profiles) ? agents.profiles : {};
	if (Object.keys(v1Profiles).length) {
		userAfter.agents = { ...(userAfter.agents ?? {}), profiles: Object.fromEntries(Object.entries(v1Profiles).map(([name, profile]) => {
			const { transport: _transport, ...rest } = object(profile) ? profile : {};
			return [name, rest];
		})) };
	}
	// The retired `herdr` switch is never written, and `--write` deletes a stored `herdr` key (handled below).
	if (herdrRequested(v1Profiles, [lanes, ...Object.values(laneProfiles), p.lanes ?? {}])) notes.push("a v1 transport chose herdr: the herdr switch and Lane sessions are retired, so it is not migrated");
	const rolesFor = (active: string | undefined, laneActive: string | undefined, flatLane: Obj): Partial<Record<AgentRole, unknown>> => {
		if (Object.keys(agents).length) return presetRoles(agents, active ?? "default", notes);
		const lane = laneActive && object(laneProfiles[laneActive]) ? laneProfiles[laneActive] : flatLane;
		return { ...laneRoles(flatLane), ...laneRoles(lane) };
	};
	const userRoles = rolesFor(typeof agents.active === "string" ? agents.active : undefined, typeof lanes.active === "string" ? lanes.active : undefined, lanes);
	for (const [role, value] of Object.entries(userRoles)) (userAfter.agents ??= {})[role] = value;
	const projectActive = mine.agents?.active ?? p.agents?.active;
	const projectLaneActive = mine.lanes?.active;
	const projectFlat: Obj = object(p.lanes) ? p.lanes : {};
	if (projectActive !== undefined || projectLaneActive !== undefined || Object.keys(laneRoles(projectFlat)).length) {
		const projectRoles = rolesFor(projectActive ?? agents.active, projectLaneActive ?? lanes.active, projectFlat);
		for (const [role, value] of Object.entries(projectRoles)) if (JSON.stringify(value) !== JSON.stringify(userRoles[role as AgentRole])) (projectAfter.agents ??= {})[role] = value;
	}

	// Plain keys keep their layer.
	for (const k of ["git_integration", "initiative_carrier", "review_verifier"] as const) {
		if (u[k] !== undefined) userAfter[k] = u[k];
		if (p[k] !== undefined) projectAfter[k] = p[k];
	}
	if (mine.initiative_carrier !== undefined) projectAfter.initiative_carrier = mine.initiative_carrier;
	if (gitLegacy && u.git_integration === undefined && p.git_integration === undefined) projectAfter.git_integration = gitLegacy;
	if (carrierLegacy && projectAfter.initiative_carrier === undefined && u.initiative_carrier === undefined) projectAfter.initiative_carrier = carrierLegacy;

	// Retired top-level keys are never carried into the migrated files: `--write` deletes them,
	// preserving every other key verbatim. `loop` and `decision_models` retired with the
	// in-repo Loop daemon, and `batch` and `session_providers` with the unattended batch
	// (ADR 0043), so v1 values for them are not migrated either.
	for (const [label, after] of [...(userMigrated ? [] : [["user", userAfter] as const]), ["project", projectAfter] as const]) {
		for (const retired of RETIRED_KEYS) if (Object.hasOwn(after, retired)) {
			delete after[retired];
			notes.push(`${label} file: removed the retired ${retired} key; all other keys are preserved`);
		}
	}
	// An already migrated user file is never rewritten from the archived v1 file; only the project side uses it.
	const userResult: Obj = userMigrated ? userBefore! : userAfter;
	// An already-migrated v2 user file reports (and `--write` writes) a copy without the retired keys.
	let userReported: Obj = userResult;
	if (userMigrated && userResult) for (const retired of RETIRED_KEYS) if (Object.hasOwn(userReported, retired)) {
		if (userReported === userResult) userReported = { ...userResult };
		delete userReported[retired];
		notes.push(`user file: removed the retired ${retired} key; all other keys are preserved`);
	}
	const changed = (before: Obj | null, after: Obj) => JSON.stringify(before) !== JSON.stringify(after) && (before !== null || Object.keys(after).length > 1);
	const report: MigrationReport = {
		user: { path: userPath, before: userBefore, after: userReported, changed: changed(userBefore, userReported) },
		project: { path: projectPath, before: projectBefore, after: projectAfter, changed: changed(projectBefore, projectAfter) },
		notes,
		written: false,
	};
	if (options.write) {
		if (report.user.changed && userBefore?.contract === V1_USER && !existsSync(backupPath)) writeFileSync(backupPath, readFileSync(userPath));
		for (const target of [report.user, report.project]) {
			if (!target.changed) continue;
			mkdirSync(dirname(target.path), { recursive: true });
			writeFileSync(target.path, `${JSON.stringify(target.after, null, 2)}\n`);
		}
		report.written = true;
	}
	return report;
}
