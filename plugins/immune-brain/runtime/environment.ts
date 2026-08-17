import {
	existsSync,
	lstatSync,
	readFileSync,
	renameSync,
	statSync,
} from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { execSync } from "node:child_process";
import process from "node:process";
import type { NormalizedPlan } from "./plan_core";
import {
	inspectLedgerWriteLock,
	loadStateLedger,
	STEP_STATES,
} from "./state_ledger";

export interface HealResult {
	ok: boolean;
	warnings: string[];
	recovered: boolean;
}

export function healCurrentIteration(
	statePath: string,
	projectRoot: string,
	resolvePlanPathFn: (path: string, root?: string) => string,
	_loadNormalizedPlanFn: (path: string, root?: string) => NormalizedPlan | null,
): HealResult {
	const warnings: string[] = [];
	const recovered = false;
	let hasIssues = false;
	const lock = inspectLedgerWriteLock(statePath);
	if (lock.classification !== "absent") {
		const owner = lock.owner
			? `; owner runId=${lock.owner.runId} pid=${lock.owner.pid} startedAt=${lock.owner.startedAt} initializing=${lock.owner.initializing}`
			: "";
		warnings.push(
			`State Ledger write lock: ${lock.classification} at ${lock.lockPath}${owner}`,
		);
		warnings.push(
			`After independently stopping all writers, manually remove ${lock.lockPath}, then rerun imm-heal or imm-autowork. Immune-Brain will never delete this lock automatically.`,
		);
		hasIssues = true;
	}

	const state = loadStateLedger(statePath);
	if (!state) {
		try {
			warnings.push(...collectGlobalCliWarnings(projectRoot));
		} catch {
			// Diagnostics must not make a missing ledger unreadable.
		}
		return { ok: !hasIssues, warnings, recovered };
	}

	const planPath = state.plan_path as string | undefined;
	if (planPath) {
		const resolved = resolvePlanPathFn(planPath, projectRoot);
		if (!existsSync(resolved)) {
			warnings.push(`Plan path does not exist: ${planPath}`);
			hasIssues = true;
		}
	}

	for (const [key, entry] of Object.entries(state.steps || {})) {
		if (!entry.state || !STEP_STATES.includes(entry.state)) {
			warnings.push(`Step ${key} has invalid state: ${entry.state}`);
			hasIssues = true;
		}
	}
	if (!state.runtime_status) {
		warnings.push("runtime_status is missing");
		hasIssues = true;
	}
	try {
		warnings.push(...collectGlobalCliWarnings(projectRoot));
	} catch {
		// Diagnostics are best effort.
	}
	return { ok: !hasIssues, warnings, recovered };
}

export const MANAGED_COPY_MARKERS = [
	"imm-install-mode: copy",
	"imm-install-family: agent-skills",
	"imm-install-runtime-root:",
];

export interface InspectionResult {
	path: string | null;
	eligible: boolean;
	applied: boolean;
	reason: string | null;
	retired_path?: string;
	markers?: string[];
}

export function which(
	cmd: string,
	env?: Record<string, string>,
): string | null {
	const pathEnv = (env ?? process.env).PATH || "";
	for (const dir of pathEnv.split(delimiter)) {
		if (!dir) continue;
		const fullPath = join(dir, cmd);
		try {
			if (existsSync(fullPath) && statSync(fullPath).isFile()) return fullPath;
		} catch {
			// Ignore inaccessible PATH entries.
		}
	}
	return null;
}

export function commandHelpContainsSync(
	command: string,
	env?: Record<string, string>,
): boolean {
	try {
		const stdout = execSync(`"${command}" --help`, {
			stdio: ["ignore", "pipe", "pipe"],
			encoding: "utf8",
			timeout: 5000,
			env: env ?? process.env,
		});
		return stdout.includes("--sync");
	} catch (exc: any) {
		const out = exc.stdout ? exc.stdout.toString() : "";
		const err = exc.stderr ? exc.stderr.toString() : "";
		return out.includes("--sync") || err.includes("--sync");
	}
}

export function localImmPlanSupportsSync(
	projectRoot: string,
	env?: Record<string, string>,
): boolean {
	const candidates = [
		resolve(projectRoot, "plugins/immune-brain/bin/imm-plan"),
		resolve(projectRoot, "bin/imm-plan"),
	];
	return candidates.some(
		(candidate) =>
			existsSync(candidate) &&
			statSync(candidate).isFile() &&
			commandHelpContainsSync(candidate, env),
	);
}

export function collectGlobalCliWarnings(
	projectRoot: string,
	env?: Record<string, string>,
): string[] {
	if (!localImmPlanSupportsSync(projectRoot, env)) return [];
	const globalImmPlan = which("imm-plan", env);
	if (!globalImmPlan || commandHelpContainsSync(globalImmPlan, env)) return [];
	return [
		`PATH imm-plan at ${globalImmPlan} does not expose --sync. ` +
			"Dry-run retirement with `plugins/immune-brain/bin/imm-retire-stale-wrapper --path " +
			`${globalImmPlan}` +
			"`; add --apply only if it reports an eligible managed-copy wrapper. Or use " +
			"plugins/immune-brain/bin/imm-plan --sync.",
	];
}

export function inspectManagedCopyWrapper(
	wrapperPath: string,
): InspectionResult {
	const resolvedPath = resolve(wrapperPath);
	const result: InspectionResult = {
		path: resolvedPath,
		eligible: false,
		applied: false,
		reason: null,
		retired_path: resolvedPath + ".retired",
		markers: [],
	};
	try {
		if (!existsSync(resolvedPath)) {
			result.reason = "wrapper does not exist";
			return result;
		}
		const lstat = lstatSync(resolvedPath);
		if (lstat.isSymbolicLink()) {
			result.reason = "refusing symlink wrapper";
			return result;
		}
		if (!statSync(resolvedPath).isFile()) {
			result.reason = "wrapper is not a regular file";
			return result;
		}
		const content = readFileSync(resolvedPath, { encoding: "utf8" });
		const foundMarkers = MANAGED_COPY_MARKERS.filter((marker) =>
			content.includes(marker),
		);
		result.markers = foundMarkers;
		if (foundMarkers.length !== MANAGED_COPY_MARKERS.length) {
			result.reason = "wrapper lacks Immune-Brain managed-copy markers";
			return result;
		}
		if (content.includes("--sync")) {
			result.reason = "wrapper already appears to expose --sync";
			return result;
		}
		result.eligible = true;
		result.reason = "eligible stale Immune-Brain managed-copy wrapper";
	} catch (error) {
		result.reason = `unable to read wrapper: ${error instanceof Error ? error.message : error}`;
	}
	return result;
}

export function retireManagedCopyWrapper(
	wrapperPath: string,
	apply: boolean,
): InspectionResult {
	const inspection = inspectManagedCopyWrapper(wrapperPath);
	if (!inspection.eligible || !apply) return inspection;
	const source = inspection.path!;
	const retired = inspection.retired_path!;
	try {
		try {
			lstatSync(retired);
			inspection.eligible = false;
			inspection.reason = `retired path already exists: ${retired}`;
			return inspection;
		} catch {
			// Retired target does not exist.
		}
		renameSync(source, retired);
		inspection.applied = true;
		inspection.reason = "retired stale Immune-Brain managed-copy wrapper";
	} catch (error) {
		inspection.applied = false;
		inspection.reason = `failed to rename wrapper: ${error instanceof Error ? error.message : error}`;
	}
	return inspection;
}
