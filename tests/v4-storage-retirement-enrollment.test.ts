// v4 storage retirement — acc-kernel-enrollment-only.
// Pi task preparation, confirmation binding, rehearsal, and enrollment derive
// their decision and digest exclusively from securely reread Kernel TaskIntent,
// workspace, backend-claim, TaskRecord v2, and tombstone owners; enrollment
// has no dependency on v3 migration reports, readiness evidence, authority
// receipts, automatic observations, or an observation-window waiver route.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const PREPARE = join(
	ROOT,
	"plugins/immune-brain/runtime/kernel/pi_canary_prepare.ts",
);
const ENROLL = join(
	ROOT,
	"plugins/immune-brain/runtime/kernel/enrollment.ts",
);
const ENROLL_EXT = join(
	ROOT,
	"plugins/immune-brain/.pi-extension/imm-canary-enroll.ts",
);
const STUB = join(
	ROOT,
	"plugins/immune-brain/.pi-extension/runtime-stub.ts",
);

describe("v4 enrollment is kernel-owner-only", () => {
	test("preparation has no readiness/evidence/receipt/observation imports", () => {
		const src = readFileSync(PREPARE, "utf8");
		expect(src).not.toContain("readAuthorityCommitReceipts");
		expect(src).not.toContain("readAutomaticObservationsV2");
		expect(src).not.toContain("loadReadinessEvidence");
		expect(src).not.toContain("projectReadiness");
		expect(src).not.toContain("buildMigrationDryRunReport");
		expect(src).not.toContain("migrationDryRunDigest");
		expect(src).toContain("readTaskIntent");
		expect(src).toContain("readBackendClaim");
		expect(src).toContain("readTaskRecordV2Raw");
		expect(src).toContain("readWorkspaceStateRaw");
		expect(src).toContain("readTaskTombstone");
	});

	test("enrollment binds preparation_digest and revalidates it", () => {
		const src = readFileSync(ENROLL, "utf8");
		expect(src).toContain("preparation_digest");
		expect(src).toContain("preparePiCanary");
		expect(src).toContain("preparation digest mismatch");
	});

	test("enrollment Tool owns no waiver or Kernel preparation surface", () => {
		const src = readFileSync(ENROLL_EXT, "utf8");
		expect(src).not.toContain("explicit user risk acceptance");
		expect(src).not.toContain("preparation.readiness");
		expect(src).not.toContain("preparation.evidence");
		expect(src).not.toContain("waiver,\n");
		expect(src).not.toContain("mintWaiver");
		expect(src).toContain("preparePiCanary");
	});

	test("enrollment extension derives binding from kernel owners, not readiness", () => {
		const src = readFileSync(ENROLL_EXT, "utf8");
		expect(src).not.toContain("preparation.readiness");
		expect(src).not.toContain("preparation.evidence");
		expect(src).not.toContain("readiness evidence");
		expect(src).toContain("preparation.digest");
	});

	test("runtime stub preparation type has no readiness/evidence fields", () => {
		const src = readFileSync(STUB, "utf8");
		expect(src).not.toContain("readiness: {");
		expect(src).not.toMatch(/evidence:\s*\{\s*status/);
		expect(src).not.toContain("preparation.readiness");
		expect(src).not.toContain("preparation.evidence");
		expect(src).toContain("preparation_digest");
	});
});
