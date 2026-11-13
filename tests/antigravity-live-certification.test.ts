import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	ANTIGRAVITY_BUNDLE_REL,
	type AgyProbeResult,
	LIVE_REPORT_PATH,
	type LiveCertificationEvidence,
	parseLiveCertificationReport,
	validateLiveCertificationReport,
} from "../scripts/verify-antigravity-live";

const REPO_ROOT = resolve(import.meta.dir, "..");
const tempRoots: string[] = [];

afterAll(() => {
	for (const dir of tempRoots) {
		rmSync(dir, { recursive: true, force: true });
	}
});

function createSyntheticRepo(mutateEvidence?: (evidence: LiveCertificationEvidence) => void): {
	root: string;
	probeAgy: () => AgyProbeResult;
} {
	const root = mkdtempSync(join(tmpdir(), "imm-live-cert-test-"));
	tempRoots.push(root);

	const bundleAbs = join(root, ANTIGRAVITY_BUNDLE_REL);
	mkdirSync(join(bundleAbs, ".."), { recursive: true });
	writeFileSync(bundleAbs, readFileSync(resolve(REPO_ROOT, ANTIGRAVITY_BUNDLE_REL)));

	const realReport = readFileSync(resolve(REPO_ROOT, LIVE_REPORT_PATH), "utf8");
	const evidence = parseLiveCertificationReport(realReport);
	mutateEvidence?.(evidence);

	mkdirSync(join(root, "docs/reports"), { recursive: true });
	const wrapped = [
		"# Synthetic Live Certification Report",
		"",
		"<!-- LIVE_CERTIFICATION_EVIDENCE_START -->",
		"```json",
		JSON.stringify(evidence, null, 2),
		"```",
		"<!-- LIVE_CERTIFICATION_EVIDENCE_END -->",
	].join("\n");
	writeFileSync(join(root, LIVE_REPORT_PATH), wrapped);

	return {
		root,
		probeAgy: () => ({
			ok: true,
			version: evidence.host_version,
			rawVersionOutput: `antigravity ${evidence.host_version}`,
			pluginValidateOk: true,
		}),
	};
}

describe("Antigravity Live Certification Report Validation (AC2)", () => {
	it("accepts only the current live-verified report matching installed agy and bundle digest", () => {
		const result = validateLiveCertificationReport({ root: REPO_ROOT });
		expect(result.errors).toEqual([]);
		expect(result.ok).toBe(true);
		expect(result.evidence?.final_projection.lifecycle).toBe("done");
		expect(result.evidence?.p8_probe.pre_invocation_supported).toBe(true);
		expect(result.evidence?.p8_probe.skill_tool_present).toBe(false);
		expect(result.evidence?.p8_probe.skill_hook_matcher_configured).toBe(false);
	});

	it("fails when installed agy CLI is absent or fails version/plugin probe", () => {
		const fixture = createSyntheticRepo();
		const res = validateLiveCertificationReport({
			root: fixture.root,
			probeAgy: () => ({
				ok: false,
				version: "",
				rawVersionOutput: "",
				pluginValidateOk: false,
				error: "spawnSync agy ENOENT",
			}),
		});
		expect(res.ok).toBe(false);
		expect(res.errors.some((e) => e.includes("Installed agy probe failed"))).toBe(true);
	});

	it("fails when the live certification report file is absent", () => {
		const root = mkdtempSync(join(tmpdir(), "imm-live-cert-missing-"));
		tempRoots.push(root);
		const bundleAbs = join(root, ANTIGRAVITY_BUNDLE_REL);
		mkdirSync(join(bundleAbs, ".."), { recursive: true });
		writeFileSync(bundleAbs, "// bundle");
		const res = validateLiveCertificationReport({
			root,
			probeAgy: () => ({ ok: true, version: "1.5.8", rawVersionOutput: "antigravity 1.5.8", pluginValidateOk: true }),
		});
		expect(res.ok).toBe(false);
		expect(res.errors.some((e) => e.includes("Live certification report missing"))).toBe(true);
	});

	it("fails when the bundle digest is stale relative to the rebuilt Antigravity plugin", () => {
		const fixture = createSyntheticRepo((ev) => {
			ev.plugin_digest = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
		});
		const res = validateLiveCertificationReport(fixture);
		expect(res.ok).toBe(false);
		expect(res.errors.some((e) => e.includes("Stale plugin_digest"))).toBe(true);
	});

	it("fails when any phase is marked skipped instead of passed (skip is never a pass)", () => {
		const fixture = createSyntheticRepo((ev) => {
			ev.phases.verifier_observation.status = "skipped";
		});
		const res = validateLiveCertificationReport(fixture);
		expect(res.ok).toBe(false);
		expect(res.errors.some((e) => e.includes("verifier_observation") && e.includes("skipped"))).toBe(true);
	});

	it("fails when any recorded command failed or exited non-zero", () => {
		const fixture = createSyntheticRepo((ev) => {
			ev.commands[0] = { ...ev.commands[0], exit_code: 1, status: "failed" };
		});
		const res = validateLiveCertificationReport(fixture);
		expect(res.ok).toBe(false);
		expect(res.errors.some((e) => e.includes("Command did not pass"))).toBe(true);
	});

	it("fails when final_projection lifecycle is not done", () => {
		const fixture = createSyntheticRepo((ev) => {
			ev.final_projection.lifecycle = "active";
		});
		const res = validateLiveCertificationReport(fixture);
		expect(res.ok).toBe(false);
		expect(res.errors.some((e) => e.includes("Final projection must be lifecycle='done'"))).toBe(true);
	});

	it("fails when a fictitious Skill tool or matcher is claimed", () => {
		const fixture = createSyntheticRepo((ev) => {
			ev.p8_probe.skill_hook_matcher_configured = true;
		});
		const res = validateLiveCertificationReport(fixture);
		expect(res.ok).toBe(false);
		expect(res.errors.some((e) => e.includes("fictitious Skill tool"))).toBe(true);
	});

	it("fails when P4 Stop continuation or measured lifecycle proof metadata is incomplete", () => {
		const badP4 = createSyntheticRepo((ev) => {
			ev.continuation.stop_invocations = 1;
			ev.continuation.yielded_after_no_progress = false;
		});
		const resP4 = validateLiveCertificationReport(badP4);
		expect(resP4.ok).toBe(false);
		expect(resP4.errors.some((e) => e.includes("Stop continuation evidence"))).toBe(true);

		const badLifecycle = createSyntheticRepo((ev) => {
			ev.lifecycle_proof.review_decision = "missing";
		});
		const resLifecycle = validateLiveCertificationReport(badLifecycle);
		expect(resLifecycle.ok).toBe(false);
		expect(resLifecycle.errors.some((e) => e.includes("lifecycle proof metadata"))).toBe(true);
	});

	it("fails when a real host audit proof fails settlement or has a SHA mismatch", () => {
		const badAudit = createSyntheticRepo((ev) => {
			ev.br_scn_4.audit_records[0].review_approved = false;
		});
		const resBadAudit = validateLiveCertificationReport(badAudit);
		expect(resBadAudit.ok).toBe(false);
		expect(resBadAudit.errors.some((e) => e.includes("did not cleanly settle"))).toBe(true);

		const tamperedSha = createSyntheticRepo((ev) => {
			ev.br_scn_4.audit_records[0].terminal_proof_sha256 = "sha256:1111111111111111111111111111111111111111111111111111111111111111";
		});
		const recRel = parseLiveCertificationReport(readFileSync(resolve(REPO_ROOT, LIVE_REPORT_PATH), "utf8")).br_scn_4.audit_records[0].terminal_proof_path;
		const targetProof = join(tamperedSha.root, recRel);
		mkdirSync(join(targetProof, ".."), { recursive: true });
		writeFileSync(targetProof, "{}");
		const resSha = validateLiveCertificationReport(tamperedSha);
		expect(resSha.ok).toBe(false);
		expect(resSha.errors.some((e) => e.includes("Audit proof SHA mismatch"))).toBe(true);
	});
});
