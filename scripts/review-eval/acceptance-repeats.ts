/**
 * Read-only per-run, per-acceptance review repeat report (decision-models S1; delivers #284 S1 item 7).
 *
 * Usage: bun scripts/review-eval/acceptance-repeats.ts [--root <project-root>] [--json]
 *
 * Source   = the audit pairs committed at HEAD of `--root` (default: the current directory), through the revisit
 *            audit reader; the working tree, `.imm/state/` and every other store are never opened
 * Output   = one row per (run, acceptance key), in run then first-appearance order; `latest_round` is the run's
 *            newest review round (max of its rework rounds and finding rounds, 0 when it has none)
 * Effects  = none: no file is written; a root that is not a Git work tree exits 1 with the error on stderr
 */
import { pathToFileURL } from "node:url";
import { acceptanceRepeatSeries, type AcceptanceRepeatRow } from "../../plugins/immune-brain/runtime/kernel/acceptance_repeats.ts";
import { readCommittedAudit, type AuditRun } from "../../plugins/immune-brain/skills/revisit/scripts/audit_reader.ts";

const USAGE = "usage: acceptance-repeats.ts [--root <project-root>] [--json]";

export type RepeatReportRow = AcceptanceRepeatRow & { run: string; latest_round: number };

export function latestRoundOf(run: AuditRun): number {
	const rounds = [...run.reworkRounds, ...run.reviewFindings.flatMap((f) => (f.round === null ? [] : [f.round]))];
	return rounds.length === 0 ? 0 : Math.max(...rounds);
}

/** Rows of every committed run at HEAD of `root`; throws `AuditUsageError` when `root` is not a Git work tree root. */
export function repeatReport(root: string): RepeatReportRow[] {
	return readCommittedAudit(root).runs.flatMap((run) => {
		const latest_round = latestRoundOf(run);
		const findings = run.reviewFindings.map((f) => ({ acceptance_id: f.acceptanceKey, review_round: f.round }));
		return acceptanceRepeatSeries(findings, latest_round).map((row) => ({ run: run.path, latest_round, ...row }));
	});
}

function parseArgs(argv: string[]): { root: string; json: boolean } {
	let root = ".";
	let json = false;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]!;
		if (a === "--json") json = true;
		else if (a === "--root") {
			root = argv[++i] ?? "";
			if (!root) throw new Error(`--root needs a project root; ${USAGE}`);
		} else throw new Error(`unknown argument ${a}; ${USAGE}`);
	}
	return { root, json };
}

function render(rows: RepeatReportRow[]): string {
	const cell = (v: string | number | null) => (v === null ? "-" : String(v));
	return rows
		.map((r) =>
			[
				r.run,
				cell(r.acceptance_id),
				`findings=${r.finding_count}`,
				`unrounded=${r.unrounded}`,
				`rounds=${r.rounds_with_findings}`,
				`last=${cell(r.last_finding_round)}`,
				`since=${cell(r.rounds_since_last_finding)}`,
				`streak=${r.current_streak}`,
			].join("\t"),
		)
		.map((line) => `${line}\n`)
		.join("");
}

export function run(argv: string[]): string {
	const args = parseArgs(argv);
	const rows = repeatReport(args.root);
	return args.json ? `${JSON.stringify(rows, null, 2)}\n` : render(rows);
}

const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]!).href === import.meta.url;
if (isMain) {
	try {
		process.stdout.write(run(process.argv.slice(2)));
	} catch (err) {
		console.error(err instanceof Error ? err.message : err);
		process.exit(1);
	}
}
