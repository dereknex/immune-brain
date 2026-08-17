import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	AUTHORITY_OBSERVATION_GENERATION_V2,
	AUTHORITY_OBSERVER_VERSION_V2,
} from "../plugins/immune-brain/runtime/authority_commit_receipts";
import { loadReadinessEvidence } from "../plugins/immune-brain/runtime/kernel/readiness";

const DIGEST = `sha256:${"d".repeat(64)}`;

function git(root: string, args: string[]): void {
	const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

function repo(): { root: string; evidence: string } {
	const root = mkdtempSync(join(tmpdir(), "imm-readiness-evidence-"));
	git(root, ["init", "-q"]);
	git(root, ["config", "user.email", "test@example.com"]);
	git(root, ["config", "user.name", "Test"]);
	mkdirSync(join(root, "docs/evidence/assurance-kernel"), { recursive: true });
	return { root, evidence: join(root, "docs/evidence/assurance-kernel/readiness.json") };
}

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		contract: "assurance_kernel/readiness_evidence/v1",
		generated_at: "2026-08-02T00:00:00Z",
		observer_generation: AUTHORITY_OBSERVATION_GENERATION_V2,
		observer_version: AUTHORITY_OBSERVER_VERSION_V2,
		migration_dry_run: { digest: DIGEST, writes_performed: false },
		rollback_rehearsal: {
			result: "passed",
			at: "2026-08-02T00:00:00Z",
			summary: "rollback rehearsal passed",
			receipt_record_ids: [`sha256:${"a".repeat(64)}`],
		},
		...overrides,
	};
}

function track(root: string, evidence: string, value = payload()): void {
	writeFileSync(evidence, `${JSON.stringify(value, null, 2)}\n`);
	git(root, ["add", "docs/evidence/assurance-kernel/readiness.json"]);
	git(root, ["commit", "-qm", "evidence"]);
}

describe("R2B readiness evidence loader", () => {
	test("loads a tracked clean strict bundle", () => {
		const { root, evidence } = repo();
		track(root, evidence);
		const result = loadReadinessEvidence(root, "2026-08-03T00:00:00Z");
		expect(result.status).toBe("valid");
		if (result.status === "valid") expect(result.bundle.migration_dry_run.digest).toBe(DIGEST);
	});

	test("rejects missing, untracked, dirty, and staged evidence", () => {
		const missing = repo();
		expect(loadReadinessEvidence(missing.root, "2026-08-03T00:00:00Z").status).toBe("missing");
		const untracked = repo();
		writeFileSync(untracked.evidence, JSON.stringify(payload()));
		expect(loadReadinessEvidence(untracked.root, "2026-08-03T00:00:00Z")).toMatchObject({ status: "invalid" });
		const dirty = repo();
		track(dirty.root, dirty.evidence);
		writeFileSync(dirty.evidence, `${readFileSync(dirty.evidence, "utf8")} `);
		expect(loadReadinessEvidence(dirty.root, "2026-08-03T00:00:00Z")).toMatchObject({ status: "invalid" });
		const staged = repo();
		track(staged.root, staged.evidence);
		writeFileSync(staged.evidence, `${JSON.stringify(payload({ generated_at: "2026-08-02T01:00:00Z" }))}\n`);
		git(staged.root, ["add", "docs/evidence/assurance-kernel/readiness.json"]);
		expect(loadReadinessEvidence(staged.root, "2026-08-03T00:00:00Z")).toMatchObject({ status: "invalid" });
	});

	test("rejects symlinks, oversized files, and malformed schemas", () => {
		const linked = repo();
		const target = join(linked.root, "target.json");
		writeFileSync(target, JSON.stringify(payload()));
		symlinkSync(target, linked.evidence);
		expect(loadReadinessEvidence(linked.root, "2026-08-03T00:00:00Z")).toMatchObject({ status: "invalid" });
		const oversized = repo();
		writeFileSync(oversized.evidence, "x".repeat(65 * 1024));
		git(oversized.root, ["add", "docs/evidence/assurance-kernel/readiness.json"]);
		git(oversized.root, ["commit", "-qm", "large"]);
		expect(loadReadinessEvidence(oversized.root, "2026-08-03T00:00:00Z")).toMatchObject({ status: "invalid" });
		const malformed = repo();
		track(malformed.root, malformed.evidence, payload({ extra: true }));
		expect(loadReadinessEvidence(malformed.root, "2026-08-03T00:00:00Z")).toMatchObject({ status: "invalid" });
	});

	test("rejects stale generation, future timestamps, and invalid rehearsal references", () => {
		const stale = repo();
		track(stale.root, stale.evidence, payload({ observer_version: "old" }));
		expect(loadReadinessEvidence(stale.root, "2026-08-03T00:00:00Z")).toMatchObject({ status: "invalid" });
		const future = repo();
		track(future.root, future.evidence, payload({ generated_at: "2026-08-04T00:00:00Z" }));
		expect(loadReadinessEvidence(future.root, "2026-08-03T00:00:00Z")).toMatchObject({ status: "invalid" });
		const badRef = repo();
		track(badRef.root, badRef.evidence, payload({ rollback_rehearsal: { result: "passed", at: "2026-08-02T00:00:00Z", summary: "ok", receipt_record_ids: [] } }));
		expect(loadReadinessEvidence(badRef.root, "2026-08-03T00:00:00Z")).toMatchObject({ status: "invalid" });
	});
});
