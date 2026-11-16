// An admitted-Herdr reviewer for tests (Spec review-cli-stage D11).
//
// Every Authority Review and findings Verification is prepared as an explicit
// supervised session (Spec retire-process-review-transport D2), so a fixture
// needs three things: a Host inside Herdr, the reviewer executable on PATH, and
// the receipt the reviewer agent would write. `installCliReviewer` supplies the
// first two once per test file; `runReservedReview` publishes the verdict bytes
// to the reservation's out-of-tree `output_path`. No reviewer process runs.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BIN = mkdtempSync(join(tmpdir(), "imm-cli-reviewer-bin-"));
/** The Herdr provider stand-in; `imm-session` resolves `herdr` from PATH. */
const HERDR_BIN = join(import.meta.dir, "..", "fixtures", "fake-herdr");

/** A receipt-backed Review session reservation's out-of-tree JSON file. */
export function reservedReviewSession(ready: unknown): { output_path: string; create_command: string } {
	const session = (ready as { review_session?: { output_path: string; create_command: string } }).review_session;
	if (!session) throw new Error(`expected an explicit review session, got ${JSON.stringify(ready)}`);
	return session;
}

/**
 * Make this process an admitted Herdr workspace with the `pi` reviewer
 * executable on PATH, so Review preparation succeeds without a real Host.
 */
export function installCliReviewer(): void {
	const state = join(mkdtempSync(join(tmpdir(), "imm-cli-reviewer-herdr-")), "state.json");
	writeFileSync(state, JSON.stringify({ protocol: 22, panes: {}, after_prompt: "idle" }));
	Object.assign(process.env, { HERDR_ENV: "1", HERDR_WORKSPACE_ID: "w-parent", FAKE_HERDR_STATE: state });
	// Only the `pi` name is shadowed: a real `claude` or `agy` install stays reachable.
	writeFileSync(join(BIN, "pi"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
	const path = process.env.PATH ?? "";
	const entries = [BIN, HERDR_BIN, ...path.split(":")].filter((entry) => entry !== "");
	process.env.PATH = [...new Set(entries)].join(":");
}

/** The packet path the prepared session's entry names. */
export function reservedPacketPath(ready: unknown): string {
	const packet = /(\S*\/packet\.md)/.exec(reservedReviewSession(ready).create_command);
	if (!packet) throw new Error("the reserved session names no Review packet");
	return packet[1]!;
}

/** Publish these bytes as the reviewer's receipt for the prepared session. */
export function runReservedReview(ready: unknown, bytes: unknown): void {
	const session = reservedReviewSession(ready);
	writeFileSync(session.output_path, typeof bytes === "string" ? bytes : JSON.stringify(bytes));
}
