/**
 * Loop Daemon: Leader Journal (S2)
 *
 * Implements D2.5 and D2.6 of docs/specs/loop-leader.spec.md (BR-REQ-2,
 * BR-DEC-3). `.imm/state/loop/leader/journal.jsonl` is the leader's advisory
 * memory: what it was shown, what it proposed and what was refused. It is never
 * authority, so losing it costs one wake and restores nothing from GitHub: the
 * next tick sees an empty journal, a fresh fingerprint and wakes once.
 */

import { appendFileSync, chmodSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

export const LOOP_LEADER_JOURNAL_CONTRACT = "immune_brain/loop_leader_journal/v1" as const;
/** Rotate at 2 MiB and keep exactly one previous file (D2.5). */
export const LEADER_JOURNAL_MAX_BYTES = 2 * 1024 * 1024;
/** How many entries the leader session is shown (D2.3). */
export const LEADER_JOURNAL_TAIL = 50;

export type LeaderJournalKind = "wake" | "proposal" | "rejected" | "accepted" | "owner_hint" | "outcome";

export interface LeaderJournalEntry {
	contract: typeof LOOP_LEADER_JOURNAL_CONTRACT;
	seq: number;
	at: string;
	kind: LeaderJournalKind;
	fingerprint: string | null;
	payload: unknown;
}

/** One entry before the journal assigns its sequence number. */
export type LeaderJournalDraft = Omit<LeaderJournalEntry, "contract" | "seq">;

export function leaderStateDir(stateDir: string): string {
	return join(stateDir, "leader");
}

export function leaderJournalPath(stateDir: string): string {
	return join(leaderStateDir(stateDir), "journal.jsonl");
}

export function leaderJournalPreviousPath(stateDir: string): string {
	return `${leaderJournalPath(stateDir)}.1`;
}

function parseEntries(raw: string): LeaderJournalEntry[] {
	const entries: LeaderJournalEntry[] = [];
	for (const line of raw.split("\n")) {
		if (line.trim().length === 0) continue;
		try {
			const parsed: unknown = JSON.parse(line);
			if (parsed === null || typeof parsed !== "object") continue;
			const entry = parsed as LeaderJournalEntry;
			if (entry.contract !== LOOP_LEADER_JOURNAL_CONTRACT) continue;
			if (!Number.isSafeInteger(entry.seq) || typeof entry.kind !== "string") continue;
			entries.push(entry);
		} catch {
			// A torn line is not memory; the journal rebuilds empty rather than fail.
		}
	}
	return entries;
}

function readOrNull(path: string): string | null {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return null;
	}
}

/** Every entry the current journal file holds, in sequence order. */
export function readLeaderJournal(stateDir: string): LeaderJournalEntry[] {
	const raw = readOrNull(leaderJournalPath(stateDir));
	return raw === null ? [] : parseEntries(raw);
}

/**
 * Append drafts as one batch, rotating the file first when it reached the cap.
 * Sequence numbers continue across a rotation, so `seq` stays monotonic.
 */
export function appendLeaderJournal(stateDir: string, drafts: readonly LeaderJournalDraft[]): LeaderJournalEntry[] {
	if (drafts.length === 0) return [];
	const existing = readLeaderJournal(stateDir);
	let seq = existing.reduce((max, entry) => Math.max(max, entry.seq), 0);
	const dir = leaderStateDir(stateDir);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	try {
		chmodSync(dir, 0o700);
	} catch {}
	const path = leaderJournalPath(stateDir);
	try {
		if (statSync(path).size >= LEADER_JOURNAL_MAX_BYTES) renameSync(path, leaderJournalPreviousPath(stateDir));
	} catch {
		// No file yet, or it vanished: the append creates it.
	}
	const written = drafts.map((draft) => {
		seq += 1;
		return { contract: LOOP_LEADER_JOURNAL_CONTRACT, seq, ...draft } satisfies LeaderJournalEntry;
	});
	appendFileSync(path, written.map((entry) => `${JSON.stringify(entry)}\n`).join(""), { mode: 0o600 });
	try {
		chmodSync(path, 0o600);
	} catch {}
	return written;
}

/** The last `limit` entries, oldest first. */
export function leaderJournalTail(entries: readonly LeaderJournalEntry[], limit = LEADER_JOURNAL_TAIL): LeaderJournalEntry[] {
	return entries.slice(-limit);
}

/**
 * The fingerprint of the last journaled wake, or null when the leader never
 * woke. A crash before the wake was journaled leaves null, so the next tick
 * wakes again (D2 interruption).
 */
export function lastLeaderWakeFingerprint(entries: readonly LeaderJournalEntry[]): string | null {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index]!;
		if (entry.kind === "wake" && typeof entry.fingerprint === "string") return entry.fingerprint;
	}
	return null;
}

/** The owner's advisory hints (D5.1), oldest first; the briefing never reads its own proposals. */
export function leaderOwnerHints(entries: readonly LeaderJournalEntry[]): string[] {
	return entries
		.filter((entry) => entry.kind === "owner_hint")
		.map((entry) => (entry.payload as { text?: unknown } | null)?.text)
		.filter((text): text is string => typeof text === "string" && text.trim().length > 0);
}
