import { afterAll } from "bun:test";
import { writeNativeReviewEvidence } from "../../plugins/immune-brain/runtime/assurance/review_evidence";

const artifacts: ReturnType<typeof writeNativeReviewEvidence>[] = [];
afterAll(() => { for (const artifact of artifacts) artifact.remove(); });

/** Synthetic host fixtures still dispatch real, readable packets. */
export function writeTestReviewPacket(name: string, content: string) {
	const evidence = writeNativeReviewEvidence({ fixture: true });
	artifacts.push(evidence);
	return evidence.writePacket(name, content);
}
