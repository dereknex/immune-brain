import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { createCapabilityRegistry } from "../plugins/immune-brain/runtime/kernel/capability_registry";
import {
	createMutationAuthorityRegistry,
	type MutationAuthorityCapabilityV2,
	type MutationAuthorityInspection,
} from "../plugins/immune-brain/runtime/kernel/authority_port";

const enrollmentSrc = readFileSync("plugins/immune-brain/runtime/kernel/enrollment_authority.ts", "utf8");
const authorityPortSrc = readFileSync("plugins/immune-brain/runtime/kernel/authority_port.ts", "utf8");
const kernelIndexSrc = readFileSync("plugins/immune-brain/runtime/kernel/index.ts", "utf8");

describe("capability registry contract", () => {
	test("shared factory exists and is imported by both adapters", () => {
		const exists = require("node:fs").existsSync("plugins/immune-brain/runtime/kernel/capability_registry.ts");
		expect(exists).toBe(true);
		expect(enrollmentSrc).toContain("capability_registry");
		expect(authorityPortSrc).toContain("capability_registry");
	});

	test("issue snapshots the binding before caller mutation", () => {
		const brand = Symbol("contract-test-capability");
		const registry = createCapabilityRegistry<{ value: string }, { value: string }, string>(brand, {
			validateBinding: () => {},
			validateAndProject: (state, expected) => {
				if (state.value !== expected.value) throw new Error("binding changed");
				return state.value;
			},
		}, "contract-test");
		const binding = { value: "issued" };
		const capability = registry.issue(binding);
		binding.value = "mutated";
		expect(registry.inspect(capability, { value: "issued" })).toBe("issued");
	});

	test("mutation adapter normalizes fabricated consume failures", () => {
		const registry = createMutationAuthorityRegistry();
		expect(() => registry.consume(
			{} as MutationAuthorityCapabilityV2,
			{} as MutationAuthorityInspection,
		)).toThrow(/opaque authority capability/i);
	});

	test("neither adapter retains its own WeakMap scaffolding", () => {
		expect(enrollmentSrc).not.toContain("new WeakMap");
		expect(authorityPortSrc).not.toContain("new WeakMap");
	});

	test("enrollment-specific validation markers remain in enrollment_authority.ts", () => {
		expect(enrollmentSrc).toContain("EnrollmentCapabilityBinding");
		expect(enrollmentSrc).toContain("enrollment capability binding is incomplete");
		expect(enrollmentSrc).toContain("enrollment capability must have a future expiry");
	});

	test("mutation-specific validation markers remain in authority_port.ts", () => {
		expect(authorityPortSrc).toContain("findings_digest");
		expect(authorityPortSrc).toContain("digestOfAction");
		expect(authorityPortSrc).toContain("authority capability findings_digest must be a canonical sha256 hash");
		expect(authorityPortSrc).toContain("authority capability action digest mismatch");
	});

	test("combined adapter line count is below 332", () => {
		const enrollmentLines = enrollmentSrc.split("\n").length;
		const authorityLines = authorityPortSrc.split("\n").length;
		const combined = enrollmentLines + authorityLines;
		expect(combined).toBeLessThan(332);
	});

	test("shared factory is NOT exported from kernel/index.ts", () => {
		expect(kernelIndexSrc).not.toContain("capability_registry");
	});
});
