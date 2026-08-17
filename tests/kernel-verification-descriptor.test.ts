// P3 U2: the strict verification_descriptor/v1 parser has exactly ONE
// implementation, in the shared runtime module
// `plugins/immune-brain/runtime/verification_descriptor.ts`. Pi assurance and
// Kernel intent author/validate both consume it; no second parser exists.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..");

describe("shared verification descriptor parser", () => {
	test("runtime module is the single parser implementation", () => {
		const shared = readFileSync(
			join(
				REPO_ROOT,
				"plugins/immune-brain/runtime/verification_descriptor.ts",
			),
			"utf8",
		);
		expect(shared).toContain("export function parseVerificationDescriptor");
		expect(shared).toContain("export function canonicalDescriptorBytes");
	});

	test("Pi extension re-exports the runtime parser and contains no second implementation", () => {
		const extension = readFileSync(
			join(
				REPO_ROOT,
				"plugins/immune-brain/.pi-extension/pi-canary-verification.ts",
			),
			"utf8",
		);
		expect(extension).toContain(
			'from "../runtime/verification_descriptor"',
		);
		// The parser body must not be duplicated in the extension.
		const parserBody = extension.match(/export function parseVerificationDescriptor/);
		expect(parserBody).toBeNull();
		const fieldList = extension.match(/DESCRIPTOR_FIELDS/);
		expect(fieldList).toBeNull();
	});

	test("kernel command surface imports the shared parser, not a local copy", () => {
		const kernel = readFileSync(
			join(REPO_ROOT, "plugins/immune-brain/runtime/commands/kernel.ts"),
			"utf8",
		);
		expect(kernel).toContain(
			'from "../verification_descriptor"',
		);
	});

	test("runtime and extension resolve to the same module identity", async () => {
		const shared = await import(
			"../plugins/immune-brain/runtime/verification_descriptor"
		);
		const extension = await import(
			"../plugins/immune-brain/.pi-extension/pi-canary-verification"
		);
		expect(extension.parseVerificationDescriptor).toBe(
			shared.parseVerificationDescriptor,
		);
		expect(extension.canonicalDescriptorBytes).toBe(
			shared.canonicalDescriptorBytes,
		);
		expect(extension.VerificationDescriptorError).toBe(
			shared.VerificationDescriptorError,
		);
	});

	test("canonical bytes are deterministic and whitespace-independent parsing", () => {
		const { parseVerificationDescriptor, canonicalDescriptorBytes } =
			require("../plugins/immune-brain/runtime/verification_descriptor");
		const compact =
			'{"contract":"assurance_kernel/verification_descriptor/v1","runner_id":"bun","runner_version":"1.3.14","argv":["test","tests/x.test.ts"],"cwd":".","timeout_ms":120000,"max_output_bytes":262144}';
		const pretty =
			'{\n  "contract": "assurance_kernel/verification_descriptor/v1",\n  "runner_id": "bun",\n  "runner_version": "1.3.14",\n  "argv": ["test", "tests/x.test.ts"],\n  "cwd": ".",\n  "timeout_ms": 120000,\n  "max_output_bytes": 262144\n}';
		const a = parseVerificationDescriptor(compact);
		const b = parseVerificationDescriptor(pretty);
		expect(canonicalDescriptorBytes(a)).toBe(canonicalDescriptorBytes(b));
	});
});
