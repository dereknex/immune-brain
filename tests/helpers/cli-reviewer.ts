// A stand-in CLI reviewer for tests (Spec review-cli-stage D11).
//
// The reserved script runs a Host binary whose last argument is the Review
// packet path. This stand-in prints the verdict a test placed beside that
// packet, so the receipt is per reservation and no test has to win a race for a
// shared output file or PATH entry.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Matches the reserved script's prompt argument whatever Host name it uses. */
const REVIEWER_SCRIPT = `#!/bin/sh
for packet in "$@"; do :; done
packet=\${packet##* }
cat "$(dirname "$packet")/verdict.txt"
`;

const BIN = mkdtempSync(join(tmpdir(), "imm-cli-reviewer-bin-"));

/**
 * Make the stand-in reviewer resolvable under the `pi` profile binary name these
 * fixtures configure. Only that name is shadowed: a real `claude` or `agy`
 * install stays reachable for the suites that probe it.
 */
export function installCliReviewer(): void {
	writeFileSync(join(BIN, "pi"), REVIEWER_SCRIPT, { mode: 0o755 });
	const path = process.env.PATH ?? "";
	if (!path.split(":").includes(BIN)) process.env.PATH = `${BIN}:${path}`;
}

/** The packet path the reserved script passes to the reviewer. */
export function reservedPacketPath(ready: unknown): string {
	const command = (ready as { review_command?: string }).review_command;
	if (!command) throw new Error(`expected a CLI review command, got ${JSON.stringify(ready)}`);
	const script = readFileSync(command.replace(/^sh /, ""), "utf8");
	const packet = /authority-review ([^']*\/packet\.md)/.exec(script);
	if (!packet) throw new Error("the reserved script names no Review packet");
	return packet[1];
}

/** Publish these bytes as the reviewer's output, then run the reserved script. */
export function runReservedReview(ready: unknown, bytes: unknown): void {
	const command = (ready as { review_command?: string }).review_command;
	if (!command) throw new Error(`expected a CLI review command, got ${JSON.stringify(ready)}`);
	const packet = reservedPacketPath(ready);
	writeFileSync(join(dirname(packet), "verdict.txt"), typeof bytes === "string" ? bytes : JSON.stringify(bytes));
	execFileSync("sh", [command.replace(/^sh /, "")], { encoding: "utf8" });
}
