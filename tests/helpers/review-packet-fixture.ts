import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReviewPacketWriter, type ReviewPacketWriter } from "../../plugins/immune-brain/runtime/assurance/review_evidence";

const writers: ReviewPacketWriter[] = [];
let root: string | null = null;
afterAll(() => {
	for (const writer of writers) writer.remove();
	if (root) rmSync(root, { recursive: true, force: true });
});

/** Synthetic host fixtures still dispatch real, readable packets. */
export function writeTestReviewPacket(name: string, content: string) {
	root ??= mkdtempSync(join(tmpdir(), "imm-test-packets-"));
	const writer = createReviewPacketWriter(root);
	writers.push(writer);
	return writer.writePacket(name, content);
}
