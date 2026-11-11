import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { parseBindings, parseProfiles } from "../decision_model/config.ts";
import { PROVIDER_KINDS, SENSITIVE_CATEGORIES, type PointRegistry } from "../decision_model/contract.ts";
import { POINT_REGISTRY } from "../decision_model/thresholds.ts";
import { projectIdentity } from "./project_identity.ts";

type Obj = Record<string, any>;
type ResolvedLeaf = { value: unknown; source: string };
export type ReviewProfile = { host: "pi" | "claude-code" | "antigravity"; model?: string; effort?: string };
type Diagnostic = { code: string; severity: "error" | "warning"; file: string; key_path: string; message: string };
const object = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const leaf = (value: unknown, source: string) => ({ value, source });
const has = (o: Obj | undefined, k: string) => !!o && Object.hasOwn(o, k);
const envName = /^[A-Z_][A-Z0-9_]*$/;

/** The Review profile `lanes` resolves to, or null when no `review_host` is set. No model-distinctness rule (BR-DEC-2). */
/** Defaults of the Lane keys that have one; every other key defaults to null. */
const LANE_DEFAULTS: Record<string, unknown> = { max_parallel: 1, review_transport: "process", advisory_transport: "subagent" };

export function chooseReviewer(lanes: { review_host: ResolvedLeaf; review_model: ResolvedLeaf; review_effort: ResolvedLeaf }): ReviewProfile | null {
	const host = lanes.review_host.value as ReviewProfile["host"] | null;
	if (!host) return null;
	const model = lanes.review_model.value as string | null, effort = lanes.review_effort.value as string | null;
	return { host, ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
}

export function resolveConfig(root: string, options: { userConfigPath?: string; checkEnv?: boolean; registry?: PointRegistry } = {}) {
	const registry = options.registry ?? POINT_REGISTRY;
	const diagnostics: Diagnostic[] = [];
	const diag = (code: string, severity: "error" | "warning", file: string, key_path: string, message: string) => {
		diagnostics.push({ code, severity, file, key_path, message: `${file}: ${key_path}: ${message}` });
	};
	const invalid = (file: string, key: string, message: string) => diag("config_invalid", "error", file, key, message);
	const userPath = options.userConfigPath ?? join(process.env.XDG_CONFIG_HOME && isAbsolute(process.env.XDG_CONFIG_HOME) ? process.env.XDG_CONFIG_HOME : join(homedir(), ".config"), "immune-brain/config.json");
	const projectPath = ".imm/config.json";
	const tracked = (path: string) => {
		try { execFileSync("git", ["ls-files", "--error-unmatch", "--", path], { cwd: root, stdio: "ignore" }); return true; } catch { return false; }
	};
	const read = (path: string, label: string, contract?: string): Obj | null => {
		if (!existsSync(path)) return {};
		try {
			const data: unknown = JSON.parse(readFileSync(path, "utf8"));
			if (!object(data)) { invalid(label, "$", "expected object"); return null; }
			if (contract && data.contract !== contract) { invalid(label, "contract", "invalid contract"); return null; }
			return data;
		} catch { invalid(label, "$", "unreadable or malformed JSON"); return null; }
	};
	let projectKey: string;
	try { projectKey = projectIdentity(root); } catch { projectKey = ""; invalid(root, "project_key", "cannot determine project identity"); }
	const user = read(userPath, userPath, "immune_brain/user_config/v1");
	const project = tracked(projectPath) ? read(join(root, projectPath), projectPath, "immune_brain/project_config/v1") : {};
	const failed = new Set<string>();
	const validKeys = (o: Obj, keys: string[], file: string, path: string, section: string) => {
		for (const key of Object.keys(o)) if (!keys.includes(key)) { invalid(file, path ? `${path}.${key}` : key, "unknown key"); failed.add(section); }
	};
	const section = (value: unknown, file: string, path: string, name: string): Obj => {
		if (value === undefined) return {};
		if (!object(value)) { invalid(file, path, "expected object"); failed.add(name); return {}; }
		return value;
	};
	if (user === null) for (const s of ["decision_models", "lanes", "initiative_carrier"]) failed.add(s);
	if (project === null) for (const s of ["decision_models", "lanes", "git_integration", "initiative_carrier", "batch", "review_verifier"]) failed.add(s);
	if (user) validKeys(user, ["contract", "decision_models", "lanes", "initiative_carrier", "projects"], userPath, "", "user_file");
	if (project) validKeys(project, ["contract", "decision_models", "lanes", "initiative_carrier", "git_integration", "batch", "review_verifier"], projectPath, "", "project_file");
	const projects = section(user?.projects, userPath, "projects", "user_file");
	for (const [key, value] of Object.entries(projects)) if (!object(value)) { invalid(userPath, `projects.${key}`, "expected object"); failed.add("user_file"); }
	const override = section(projects[projectKey], userPath, `projects.${projectKey}`, "user_file");
	validKeys(override, ["decision_models", "lanes", "initiative_carrier"], userPath, `projects.${projectKey}`, "user_file");
	const ud = section(user?.decision_models, userPath, "decision_models", "decision_models");
	const od = section(override.decision_models, userPath, `projects.${projectKey}.decision_models`, "decision_models");
	const pd = section(project?.decision_models, projectPath, "decision_models", "decision_models");
	const ul = section(user?.lanes, userPath, "lanes", "lanes");
	const ol = section(override.lanes, userPath, `projects.${projectKey}.lanes`, "lanes");
	const pl = section(project?.lanes, projectPath, "lanes", "lanes");
	const batch = section(project?.batch, projectPath, "batch", "batch");
	validKeys(ud, ["profiles", "default_profile", "bindings", "egress"], userPath, "decision_models", "decision_models");
	validKeys(od, ["default_profile", "bindings", "egress"], userPath, `projects.${projectKey}.decision_models`, "decision_models");
	validKeys(pd, ["enabled_points", "egress"], projectPath, "decision_models", "decision_models");
	validKeys(ul, ["profiles", "active"], userPath, "lanes", "lanes");
	validKeys(ol, ["active"], userPath, `projects.${projectKey}.lanes`, "lanes");
	const laneKeys = ["max_parallel", "executor_host", "executor_model", "executor_effort", "review_host", "review_model", "review_effort", "review_transport", "advisory_transport", "review_verifier_model"];
	validKeys(pl, laneKeys, projectPath, "lanes", "lanes");
	validKeys(batch, ["final_verification"], projectPath, "batch", "batch");
	const validateLane = (o: Obj, file: string, path: string) => {
		validKeys(o, laneKeys, file, path, "lanes");
		for (const [k, v] of Object.entries(o)) {
			const ok = k === "max_parallel" ? Number.isSafeInteger(v) && v > 0 : k.endsWith("_host") ? v === "pi" || v === "claude-code" || v === "antigravity" : k.endsWith("_model") || k.endsWith("_effort") ? typeof v === "string" && v.length > 0
				// ADR 0038: a supervised-session transport names its provider; no value is auto-detected.
				: k === "review_transport" ? v === "process" || v === "herdr" : k === "advisory_transport" ? v === "subagent" || v === "herdr" : true;
			if (!ok) { invalid(file, `${path}.${k}`, "invalid value"); failed.add("lanes"); }
		}
	};
	validateLane(pl, projectPath, "lanes");
	const laneProfiles = section(ul.profiles, userPath, "lanes.profiles", "lanes");
	for (const [name, profile] of Object.entries(laneProfiles)) validateLane(section(profile, userPath, `lanes.profiles.${name}`, "lanes"), userPath, `lanes.profiles.${name}`);
	for (const [o, file, path] of [[ul, userPath, "lanes"], [ol, userPath, `projects.${projectKey}.lanes`]] as const) if (has(o, "active") && (typeof o.active !== "string" || !o.active)) { invalid(file, `${path}.active`, "expected profile name"); failed.add("lanes"); }
	if (has(ud, "profiles")) {
		const profiles = section(ud.profiles, userPath, "decision_models.profiles", "decision_models");
		for (const [name, profile] of Object.entries(profiles)) if (object(profile)) for (const [key, value] of Object.entries(profile)) if (key.endsWith("_env") && (typeof value !== "string" || !envName.test(value))) { invalid(userPath, `decision_models.profiles.${name}.${key}`, "expected environment variable name"); failed.add("decision_models"); }
		const parsed = parseProfiles({ profiles });
		if (!parsed.ok) { invalid(userPath, "decision_models.profiles", parsed.error.detail.replace(/^.*?: /, "")); failed.add("decision_models"); }
	}
	const validateDecision = (o: Obj, file: string, path: string) => {
		if (has(o, "default_profile") && (typeof o.default_profile !== "string" || !o.default_profile)) { invalid(file, `${path}.default_profile`, "expected profile name"); failed.add("decision_models"); }
		const bindings = section(o.bindings, file, `${path}.bindings`, "decision_models");
		for (const [point, value] of Object.entries(bindings)) if (!Object.hasOwn(registry, point) || typeof value !== "string" || !value) { invalid(file, `${path}.bindings.${point}`, "invalid binding"); failed.add("decision_models"); }
		const egress = section(o.egress, file, `${path}.egress`, "decision_models");
		for (const [kind, value] of Object.entries(egress)) if (!(PROVIDER_KINDS as readonly string[]).includes(kind) || !Array.isArray(value) || value.some((v) => !(SENSITIVE_CATEGORIES as readonly unknown[]).includes(v)) || new Set(value).size !== value.length) { invalid(file, `${path}.egress.${kind}`, "invalid egress list"); failed.add("decision_models"); }
	};
	validateDecision(ud, userPath, "decision_models"); validateDecision(od, userPath, `projects.${projectKey}.decision_models`); validateDecision(pd, projectPath, "decision_models");
	if (has(pd, "enabled_points") && (!Array.isArray(pd.enabled_points) || pd.enabled_points.some((p: unknown) => typeof p !== "string" || !Object.hasOwn(registry, p)) || new Set(pd.enabled_points).size !== pd.enabled_points.length)) { invalid(projectPath, "decision_models.enabled_points", "invalid point list"); failed.add("decision_models"); }
	for (const [o, file, path] of [[user, userPath, "initiative_carrier"], [override, userPath, `projects.${projectKey}.initiative_carrier`], [project, projectPath, "initiative_carrier"]] as const) if (o && has(o, "initiative_carrier") && o.initiative_carrier !== "github" && o.initiative_carrier !== "local") { invalid(file, path, "expected github or local"); failed.add("initiative_carrier"); }
	if (project && has(project, "git_integration") && project.git_integration !== "manual" && project.git_integration !== "auto") { invalid(projectPath, "git_integration", "expected manual or auto"); failed.add("git_integration"); }
	if (project && has(project, "review_verifier") && project.review_verifier !== "off" && project.review_verifier !== "on") { invalid(projectPath, "review_verifier", "expected off or on"); failed.add("review_verifier"); }
	if (has(batch, "final_verification") && (!Array.isArray(batch.final_verification) || batch.final_verification.length > 8 || batch.final_verification.some((v: unknown) => typeof v !== "string" || !v))) { invalid(projectPath, "batch.final_verification", "expected at most eight command strings"); failed.add("batch"); }

	for (const [key, entry] of Object.entries(projects)) {
		if (key === projectKey || !object(entry)) continue;
		const base = `projects.${key}`;
		validKeys(entry, ["decision_models", "lanes", "initiative_carrier"], userPath, base, "user_file");
		const decision = section(entry.decision_models, userPath, `${base}.decision_models`, "decision_models");
		validKeys(decision, ["default_profile", "bindings", "egress"], userPath, `${base}.decision_models`, "decision_models");
		validateDecision(decision, userPath, `${base}.decision_models`);
		const lanes = section(entry.lanes, userPath, `${base}.lanes`, "lanes");
		validKeys(lanes, ["active"], userPath, `${base}.lanes`, "lanes");
		if (has(lanes, "active") && (typeof lanes.active !== "string" || !lanes.active)) { invalid(userPath, `${base}.lanes.active`, "expected profile name"); failed.add("lanes"); }
		if (has(entry, "initiative_carrier") && entry.initiative_carrier !== "github" && entry.initiative_carrier !== "local") { invalid(userPath, `${base}.initiative_carrier`, "expected github or local"); failed.add("initiative_carrier"); }
	}
	if (failed.has("user_file")) for (const s of ["decision_models", "lanes", "initiative_carrier"]) failed.add(s);
	if (failed.has("project_file")) for (const s of ["decision_models", "lanes", "git_integration", "initiative_carrier", "batch", "review_verifier"]) failed.add(s);
	if (failed.has("decision_models")) for (const o of [ud, od, pd]) for (const key of Object.keys(o)) delete o[key];
	if (failed.has("lanes")) for (const o of [ul, ol, pl, laneProfiles]) for (const key of Object.keys(o)) delete o[key];

	type Target = { layer: "user" | "project"; key: string };
	const legacy = (path: string, targets: Target[], used: boolean) => {
		if (!existsSync(join(root, path)) || (path === ".imm/decision-bindings.json" && !tracked(path))) return false;
		const where = targets.map((t) => `${t.layer} \`${t.key}\` in ${t.layer === "user" ? userPath : projectPath}`).join(" and ");
		diag(used ? "deprecated_config_source" : "legacy_source_ignored", "warning", path, targets[0].key, used ? `deprecated; move to ${where}` : `ignored because a newer layer sets this section; its replacement is ${where}`);
		return true;
	};
	let legacyLane: Obj = {}, legacyProfiles: Obj = {}, legacyBindings: Obj = {};
	const useLegacyLane = !has(ul, "profiles") && !has(ul, "active") && !has(ol, "active") && !Object.keys(pl).length && !failed.has("lanes");
	const useLegacyProfiles = !has(ud, "profiles") && !failed.has("decision_models");
	const useLegacyBindings = !failed.has("decision_models") && !has(ud, "default_profile") && !has(ud, "bindings") && !has(od, "default_profile") && !has(od, "bindings") && !has(pd, "egress");
	const readLegacy = (path: string, name: string): Obj => {
		const value = read(join(root, path), path);
		if (value === null) { failed.add(name); return {}; }
		return value;
	};
	if (legacy(".imm/lanes.local.json", [{ layer: "user", key: "lanes" }], useLegacyLane) && useLegacyLane) legacyLane = readLegacy(".imm/lanes.local.json", "lanes");
	if (legacy(".imm/decision-models.local.json", [{ layer: "user", key: "decision_models.profiles" }], useLegacyProfiles) && useLegacyProfiles) legacyProfiles = readLegacy(".imm/decision-models.local.json", "decision_models");
	if (legacy(".imm/decision-bindings.json", [{ layer: "user", key: "decision_models" }, { layer: "project", key: "decision_models.egress" }], useLegacyBindings) && useLegacyBindings) legacyBindings = readLegacy(".imm/decision-bindings.json", "decision_models");
	if (object(legacyProfiles.profiles)) for (const [name, profile] of Object.entries(legacyProfiles.profiles)) if (object(profile)) for (const [key, value] of Object.entries(profile)) if (key.endsWith("_env") && (typeof value !== "string" || !envName.test(value))) { invalid(".imm/decision-models.local.json", `profiles.${name}.${key}`, "expected environment variable name"); failed.add("decision_models"); legacyProfiles = {}; }
	if (Object.keys(legacyProfiles).length && !parseProfiles(legacyProfiles).ok) { invalid(".imm/decision-models.local.json", "profiles", "invalid profiles"); failed.add("decision_models"); legacyProfiles = {}; }
	if (Object.keys(legacyBindings).length && !parseBindings(legacyBindings, registry).ok) { invalid(".imm/decision-bindings.json", "decision_models", "invalid bindings"); failed.add("decision_models"); legacyBindings = {}; }
	if (legacyLane.active !== undefined && (typeof legacyLane.active !== "string" || !legacyLane.active)) { invalid(".imm/lanes.local.json", "lanes.active", "expected profile name"); failed.add("lanes"); legacyLane = {}; }
	if (legacyLane.profiles !== undefined && !object(legacyLane.profiles)) { invalid(".imm/lanes.local.json", "lanes.profiles", "expected object"); failed.add("lanes"); legacyLane = {}; }
	validKeys(legacyLane, ["active", "profiles"], ".imm/lanes.local.json", "lanes", "lanes");
	for (const [name, profile] of Object.entries(legacyLane.profiles ?? {})) validateLane(section(profile, ".imm/lanes.local.json", `lanes.profiles.${name}`, "lanes"), ".imm/lanes.local.json", `lanes.profiles.${name}`);
	const choose = (...items: [unknown, string][]) => { const item = items.find(([v]) => v !== undefined); return item ? leaf(item[0], item[1]) : leaf(null, "default"); };
	const profiles = has(ud, "profiles") ? ud.profiles : legacyProfiles.profiles ?? {};
	const active = choose([ol.active, "user:project"], [ul.active, "user"], [legacyLane.active, "legacy:.imm/lanes.local.json"]);
	const profileName = active.value as string | null;
	const laneProfile = profileName && (has(laneProfiles, profileName) ? laneProfiles[profileName] : has(legacyLane.profiles, profileName) ? legacyLane.profiles[profileName] : undefined);
	if (active.value && !laneProfile) { diag("unknown_profile", "error", active.source.startsWith("legacy:") ? ".imm/lanes.local.json" : userPath, "lanes.active", "unknown profile"); failed.add("lanes"); }
	if (laneProfile && active.source.startsWith("legacy:") && !object(laneProfile)) { invalid(".imm/lanes.local.json", `lanes.profiles.${active.value}`, "expected object"); failed.add("lanes"); }
	const resolvedLaneProfiles = choose([has(ul, "profiles") ? laneProfiles : undefined, "user"], [legacyLane.profiles, "legacy:.imm/lanes.local.json"], [{}, "default"]);
	const lanes: Obj = { valid: !failed.has("lanes"), active, profiles: resolvedLaneProfiles, project_defaults: leaf(pl, Object.keys(pl).length ? "project" : "default") };
	for (const key of laneKeys) {
		const hostKey = key.startsWith("review_") ? "review_host" : "executor_host";
		const dependent = key.endsWith("_model") || key.endsWith("_effort");
		const userValue = laneProfile?.[key];
		let projectValue = pl[key];
		if (dependent && projectValue !== undefined && laneProfile?.[hostKey] !== undefined) { diag("not_applied", "warning", projectPath, `lanes.${key}`, "host overridden by higher layer"); projectValue = undefined; }
		if (dependent && userValue !== undefined && laneProfile?.[hostKey] === undefined) { diag("not_applied", "warning", userPath, `lanes.${key}`, "host must be set in the same layer"); }
		if (dependent && projectValue !== undefined && pl[hostKey] === undefined) { diag("not_applied", "warning", projectPath, `lanes.${key}`, "host must be set in the same layer"); projectValue = undefined; }
		lanes[key] = choose([dependent && laneProfile?.[hostKey] === undefined ? undefined : userValue, active.source], [projectValue, "project"], [LANE_DEFAULTS[key], "default"]);
	}
	if (failed.has("lanes")) {
		lanes.active = leaf(null, "default");
		lanes.profiles = leaf({}, "default");
		lanes.project_defaults = leaf({}, "default");
		for (const key of laneKeys) lanes[key] = leaf(LANE_DEFAULTS[key] ?? null, "default");
	}
	const defaultProfile = choose([od.default_profile, "user:project"], [ud.default_profile, "user"], [legacyBindings.default_profile ?? undefined, "legacy:.imm/decision-bindings.json"]);
	const bindings: Obj = {};
	for (const key of new Set([...Object.keys(legacyBindings.bindings ?? {}), ...Object.keys(ud.bindings ?? {}), ...Object.keys(od.bindings ?? {})])) bindings[key] = choose([od.bindings?.[key], "user:project"], [ud.bindings?.[key], "user"], [legacyBindings.bindings?.[key], "legacy:.imm/decision-bindings.json"]);
	for (const [key, item] of [["default_profile", defaultProfile], ...Object.entries(bindings)] as [string, any][]) if (item.value && !Object.hasOwn(profiles, item.value)) { diag("unknown_profile", "error", item.source.startsWith("legacy:") ? ".imm/decision-bindings.json" : userPath, `decision_models.${key}`, "unknown profile"); failed.add("decision_models"); }
	const egress: Obj = {};
	for (const kind of PROVIDER_KINDS) {
		const ceiling: string[] = pd.egress?.[kind] ?? legacyBindings.egress?.[kind] ?? [];
		const requested: string[] | undefined = od.egress?.[kind] ?? ud.egress?.[kind];
		if (requested) for (const category of requested) if (!ceiling.includes(category)) diag("egress_beyond_project_ceiling", "warning", userPath, `decision_models.egress.${kind}.${category}`, "outside project ceiling");
		egress[kind] = leaf(requested ? ceiling.filter((v) => requested.includes(v)) : ceiling, requested ? has(od.egress, kind) ? "user:project" : "user" : has(pd.egress, kind) ? "project" : has(legacyBindings.egress, kind) ? "legacy:.imm/decision-bindings.json" : "default");
	}
	const directive = (regex: RegExp): { value: string; file: string } | undefined => {
		for (const file of ["AGENTS.md", "CLAUDE.md"]) if (tracked(file)) { try { for (const line of readFileSync(join(root, file), "utf8").split(/\r?\n/)) { const match = regex.exec(line); if (match) return { value: match[1].trim().replace(/^`|`$/g, ""), file }; } } catch { invalid(file, "$", "unreadable instruction file"); } }
	};
	const gitLegacy = directive(/^\s*[-*]\s+Git integration:\s*(.*?)\s*$/i);
	const carrierLegacy = directive(/^\s*[-*]\s+Initiative carrier default:\s*(.*?)\s*$/i);
	if (gitLegacy) legacy(gitLegacy.file, [{ layer: "project", key: "git_integration" }], !has(project ?? undefined, "git_integration"));
	if (carrierLegacy) legacy(carrierLegacy.file, [{ layer: "project", key: "initiative_carrier" }], !has(project ?? undefined, "initiative_carrier") && !has(override, "initiative_carrier") && !has(user ?? undefined, "initiative_carrier"));
	if (gitLegacy && !has(project ?? undefined, "git_integration") && !["manual", "auto"].includes(gitLegacy.value)) { invalid(gitLegacy.file, "git_integration", "invalid legacy directive"); failed.add("git_integration"); }
	if (carrierLegacy && !has(project ?? undefined, "initiative_carrier") && !has(override, "initiative_carrier") && !has(user ?? undefined, "initiative_carrier") && !["github", "local"].includes(carrierLegacy.value)) { invalid(carrierLegacy.file, "initiative_carrier", "invalid legacy directive"); failed.add("initiative_carrier"); }
	const decisionModels: Obj = { valid: !failed.has("decision_models"), profiles: leaf(profiles, has(ud, "profiles") ? "user" : Object.keys(legacyProfiles).length ? "legacy:.imm/decision-models.local.json" : "default"), default_profile: defaultProfile, bindings, egress, enabled_points: choose([pd.enabled_points, "project"], [Object.keys(registry), "default"]) };
	if (options.checkEnv) decisionModels.environment = Object.fromEntries(Object.entries(profiles).map(([name, profile]) => [name, object(profile) ? Object.fromEntries(Object.entries(profile).filter(([k, v]) => k.endsWith("_env") && typeof v === "string" && envName.test(v)).map(([k, v]) => [k, process.env[v as string] !== undefined ? "set" : "unset"])) : {}]));
	return { contract: "immune_brain/effective_config/v1", project_key: projectKey, files: { user: userPath, project: projectPath }, decision_models: decisionModels, lanes, git_integration: failed.has("git_integration") ? leaf("manual", "default") : choose([project?.git_integration, "project"], [gitLegacy?.value, `legacy:${gitLegacy?.file}`], ["manual", "default"]), initiative_carrier: failed.has("initiative_carrier") ? leaf(null, "default") : choose([project?.initiative_carrier, "project"], [override.initiative_carrier, "user:project"], [user?.initiative_carrier, "user"], [carrierLegacy?.value, `legacy:${carrierLegacy?.file}`]), batch: { final_verification: failed.has("batch") ? leaf(null, "default") : choose([batch.final_verification, "project"]) }, review_verifier: failed.has("review_verifier") ? leaf(null, "default") : choose([project?.review_verifier, "project"], ["off", "default"]), diagnostics };
}
