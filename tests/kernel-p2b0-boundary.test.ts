import { describe, expect, test } from "bun:test";

import * as kernelIndex from "../plugins/immune-brain/runtime/kernel/index";
import { createMutationAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/authority_port";
import { createMutationAuthorityCapabilityForTest } from "./fixtures/mutation-authority-test-seam";
import { createEnrollmentAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/enrollment_authority";

describe("P2B0 kernel surface boundary", () => {
	test("kernel index exposes no enrollment issuer or mutation route", () => {
		const exported = Object.keys(kernelIndex);
		const forbidden = exported.filter(
			(key) =>
				/issuer|enrollcanary|enrollmentcapability|createtest.*capability/i.test(key) &&
				key !== "commitEnrollmentLocked",
		);
		expect(forbidden).toEqual([]);
		expect(exported).not.toContain("createEnrollmentCapabilityForTest");
		expect(exported).not.toContain("createMutationAuthorityCapabilityForTest");
	});

	test("enrollment capability is not JSON/spread serializable", () => {
		const registry = createEnrollmentAuthorityRegistry();
		const cap = registry.issue({
			task_id: "t",
			intent_path: "docs/plans/001-goal.intent.json",
			intent_revision: 1,
			intent_content_hash: "sha256:h",
			readiness_digest: "sha256:r",
			evidence_digest: "sha256:e",
			waiver_gate: "observation_window_days",
			actor_id: "user",
			confirmation_ref: "ref",
			expires_at: "2099-01-01T00:00:00.000Z",
			nonce: "n",
		});
		expect(JSON.parse(JSON.stringify(cap))).toEqual({});
		expect({ ...cap }).toEqual({});
	});

	test("R2C2 mutation capability rejected by enrollment inspect", () => {
		const registry = createEnrollmentAuthorityRegistry();
		const mutationRegistry = createMutationAuthorityRegistry();
		const mutationCap = createMutationAuthorityCapabilityForTest(
			mutationRegistry,
			{
				authority_kind: "user",
				task_id: "t",
				action_digest: "abc",
				expected_record_hash: "h",
				intent_revision: 1,
				intent_content_hash: "sha256:h",
				diff_hash: "d",
				actor_id: "user",
				confirmation_ref: "ref",
				expires_at: "2099-01-01T00:00:00.000Z",
				findings_digest: null,
			},
		);
		expect(() => registry.inspect(mutationCap as never, {} as never)).toThrow(/enrollment capability/i);
	});
});
