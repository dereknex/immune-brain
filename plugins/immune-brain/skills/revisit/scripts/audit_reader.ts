/**
 * Committed-audit reader for `revisit --audit`.
 *
 * Reads the terminal audit pairs (`task-record.json` + `terminal-proof.json`) that one project committed at HEAD,
 * through the Kernel's `readAuditTaskPair`, and reduces each pair to raw lifecycle and review counts.
 *
 *   source   = `.imm/audit/**` of the HEAD commit, exported with `git archive` into a fresh temporary directory;
 *              the working tree, `.imm/state/`, SQLite and the authority store are never opened
 *   pair     = flat `<task>/` or run-scoped `<task>/run-<id>/`; each goes through `readAuditTaskPair`
 *   skipped  = counted by reason (`incomplete`, `proof_mismatch`, `invalid`, `no_terminal_time`), never guessed at
 *   counts   = raw per-run facts; a field the record's schema cannot carry is `null`, never 0
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAuditTaskPair } from "../../../runtime/kernel/storage.ts";

export type AuditSkipReason = "incomplete" | "proof_mismatch" | "invalid" | "no_terminal_time";
export const SKIP_REASONS: AuditSkipReason[] = ["incomplete", "proof_mismatch", "invalid", "no_terminal_time"];

export type AuditSchema = "v2" | "v3" | "v4";

export type AuditRun = {
	/** `<task>` for a flat pair, `<task>/run-<id>` for a run-scoped pair. */
	path: string;
	taskId: string;
	lifecycle: "done" | "stopped";
	schema: AuditSchema;
	terminalizedAt: string;
	terminalizedMs: number;
	qaPass: number;
	qaExecutionFailures: number;
	reviewRework: number;
	reviewPass: number;
	/** `<source>/<status>` → finding count. */
	findings: Map<string, number>;
	/** null when the schema's history vocabulary has no such event. */
	compatibleRevisions: number | null;
	breakingRevisions: number;
	authorizedRework: number | null;
	stops: number;
	intentBindings: number;
	diffBindings: number;
};

export type CommittedAudit = {
	projectRoot: string;
	head: string;
	runs: AuditRun[];
	skipped: Record<AuditSkipReason, number>;
};

type Attestation = { kind?: string; intent_content_hash?: string; diff_hash?: string };
type HistoryEntry = { type?: string; authority?: { authority_kind?: string } };
type Finding = { source?: string; status?: string };
type AnyRecord = {
	contract: string;
	approvals?: Attestation[];
	attestations?: Attestation[];
	findings: Finding[];
	history: HistoryEntry[];
};

export class AuditUsageError extends Error {}

function git(root: string, args: string[]): string {
	return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Resolve the project root's HEAD commit; throws `AuditUsageError` unless the root is a Git work tree top level. */
function resolveHead(root: string): string {
	try {
		if (git(root, ["rev-parse", "--is-inside-work-tree"]) !== "true") throw new Error("not a work tree");
		if (git(root, ["rev-parse", "--show-prefix"]) !== "") throw new Error("not the work tree root");
		return git(root, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
	} catch {
		throw new AuditUsageError(
			`usage error: --audit ${root} must be the root of a Git work tree with a HEAD commit`,
		);
	}
}

function schemaOf(contract: string): AuditSchema {
	if (contract.endsWith("/v2")) return "v2";
	return contract.endsWith("/v3") ? "v3" : "v4";
}

function skipReason(err: unknown): AuditSkipReason {
	const message = err instanceof Error ? err.message : "";
	if (message.includes("terminal audit pair is incomplete")) return "incomplete";
	if (message.includes("terminal audit proof does not match its task record")) return "proof_mismatch";
	return "invalid";
}

function count<T>(items: T[], pred: (item: T) => boolean): number {
	return items.filter(pred).length;
}

function toRun(path: string, taskId: string, pair: NonNullable<ReturnType<typeof readAuditTaskPair>>): AuditRun | null {
	const terminalizedMs = Date.parse(pair.proof.terminalized_at);
	if (!Number.isFinite(terminalizedMs)) return null;
	const record = pair.record as unknown as AnyRecord;
	const schema = schemaOf(record.contract);
	const attestations = (schema === "v2" ? record.approvals : record.attestations) ?? [];
	const history = record.history;
	const findings = new Map<string, number>();
	for (const f of record.findings) {
		const key = `${f.source}/${f.status}`;
		findings.set(key, (findings.get(key) ?? 0) + 1);
	}
	const events = (type: string) => count(history, (h) => h.type === type);
	return {
		path,
		taskId,
		lifecycle: pair.proof.terminal_lifecycle as "done" | "stopped",
		schema,
		terminalizedAt: pair.proof.terminalized_at,
		terminalizedMs,
		qaPass: count(attestations, (a) => a.kind === "qa"),
		qaExecutionFailures: count(record.findings, (f) => f.source === "execution"),
		reviewRework: count(history, (h) => h.type === "request_rework" && h.authority?.authority_kind === "review"),
		reviewPass: count(attestations, (a) => a.kind === "review"),
		findings,
		compatibleRevisions: schema === "v2" ? null : events("revise_intent"),
		breakingRevisions: events("approve_breaking_intent_revision"),
		authorizedRework: schema === "v2" ? null : events("authorize_rework"),
		stops: events("stop"),
		intentBindings: new Set(attestations.map((a) => a.intent_content_hash)).size,
		diffBindings: new Set(attestations.map((a) => a.diff_hash)).size,
	};
}

function subdirs(dir: string): string[] {
	return readdirSync(dir).filter((name) => statSync(join(dir, name)).isDirectory());
}

/** Read every committed terminal pair of `projectRoot` at HEAD. The temporary export is removed on success and failure. */
export function readCommittedAudit(projectRoot: string): CommittedAudit {
	const head = resolveHead(projectRoot);
	const out: CommittedAudit = {
		projectRoot,
		head,
		runs: [],
		skipped: { incomplete: 0, proof_mismatch: 0, invalid: 0, no_terminal_time: 0 },
	};
	if (git(projectRoot, ["ls-tree", "--name-only", head, "--", ".imm/audit"]) === "") return out;

	const tmp = mkdtempSync(join(tmpdir(), "revisit-audit-"));
	try {
		const tar = join(tmp, "audit.tar");
		const exported = join(tmp, "export");
		git(projectRoot, ["archive", "--format=tar", "-o", tar, head, "--", ".imm/audit"]);
		mkdirSync(exported);
		execFileSync("tar", ["-xf", tar, "-C", exported], { stdio: "ignore" });
		const auditDir = join(exported, ".imm", "audit");
		if (!existsSync(auditDir)) return out;

		const read = (taskId: string, runId?: string) => {
			const path = runId ? `${taskId}/${runId}` : taskId;
			try {
				const pair = readAuditTaskPair(exported, taskId, runId);
				const run = pair ? toRun(path, taskId, pair) : null;
				if (run) out.runs.push(run);
				else out.skipped[pair ? "no_terminal_time" : "incomplete"] += 1;
			} catch (err) {
				out.skipped[skipReason(err)] += 1;
			}
		};
		for (const taskId of subdirs(auditDir)) {
			const taskDir = join(auditDir, taskId);
			const runs = subdirs(taskDir).filter((name) => name.startsWith("run-"));
			for (const runId of runs) read(taskId, runId);
			const flat = ["task-record.json", "terminal-proof.json"].some((name) => existsSync(join(taskDir, name)));
			// A lone run directory shadows flat files in `readAuditTaskPair`, so such a flat pair cannot be read unambiguously.
			if (flat && runs.length === 1) out.skipped.invalid += 1;
			else if (flat || runs.length === 0) read(taskId);
		}
		return out;
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}
