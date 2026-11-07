/**
 * Per-acceptance repeat series over review findings (decision-models S1; BR-DEC-7;
 * docs/specs/review-verifier-eval.spec.md item 7).
 *
 * Pure derivation: no I/O, no clock, no Kernel state. A caller supplies the findings of one run and the run's
 * latest review round; the series says, per acceptance key, how often and how recently review kept finding
 * defects there. It decides nothing by itself, and no runtime path calls it yet.
 */

export type RepeatFinding = {
	/** The acceptance the finding is bound to; null when the record carries none. */
	acceptance_id: string | null;
	/** The review round the record stamped on the finding; null when the record carries none. */
	review_round: number | null;
};

export type AcceptanceRepeatRow = {
	/** The acceptance key; null is a key of its own, never merged into another. */
	acceptance_id: string | null;
	/** Every finding of the key, rounded or not. */
	finding_count: number;
	/** Findings without a `review_round`: counted in `finding_count` only. */
	unrounded: number;
	/** Distinct rounds in which the key had at least one finding. */
	rounds_with_findings: number;
	/** The newest round with a finding; null when no finding carries a round. */
	last_finding_round: number | null;
	/** `latestRound - last_finding_round` (never negative); null when no finding carries a round. */
	rounds_since_last_finding: number | null;
	/** Consecutive rounds, ending at `latestRound`, that each had a finding; 0 once the newest round is clean. */
	current_streak: number;
};

/**
 * Group `findings` by acceptance key and derive each key's repeat metrics against `latestRound`.
 * Keys are ordered by first appearance; an empty input gives an empty series.
 */
export function acceptanceRepeatSeries(
	findings: readonly RepeatFinding[],
	latestRound: number,
): AcceptanceRepeatRow[] {
	const byKey = new Map<string | null, { count: number; unrounded: number; rounds: Set<number> }>();
	for (const finding of findings) {
		let entry = byKey.get(finding.acceptance_id);
		if (!entry) {
			entry = { count: 0, unrounded: 0, rounds: new Set() };
			byKey.set(finding.acceptance_id, entry);
		}
		entry.count += 1;
		if (finding.review_round === null) entry.unrounded += 1;
		else entry.rounds.add(finding.review_round);
	}
	return [...byKey].map(([acceptance_id, entry]) => {
		const last = entry.rounds.size > 0 ? Math.max(...entry.rounds) : null;
		let streak = 0;
		while (entry.rounds.has(latestRound - streak)) streak += 1;
		return {
			acceptance_id,
			finding_count: entry.count,
			unrounded: entry.unrounded,
			rounds_with_findings: entry.rounds.size,
			last_finding_round: last,
			rounds_since_last_finding: last === null ? null : Math.max(0, latestRound - last),
			current_streak: streak,
		};
	});
}
