// P2B2 U2: verification descriptor v1 authority. Covers strict canonical JSON
// parsing (unknown fields rejected), the bun-only runner registry, argv/cwd/
// numeric bounds, shell/PATH/executable-path rejection, frozen runner binding
// (realpath/device/inode/content hash/version), and the normalized findings
// digest.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	parseVerificationDescriptor,
	canonicalDescriptorBytes,
	resolveBunRunner,
	assertRunnerCompatible,
	runFixedVerification,
	findingsDigest,
	type VerificationDescriptor,
} from "../plugins/immune-brain/.pi-extension/pi-canary-verification.ts";

const GOOD = {
	contract: "assurance_kernel/verification_descriptor/v1",
	runner_id: "bun",
	runner_version: "1.3.14",
	argv: ["test", "tests/focused.test.ts"],
	cwd: ".",
	timeout_ms: 120000,
	max_output_bytes: 262144,
};

function good(overrides: Record<string, unknown> = {}): VerificationDescriptor {
	return parseVerificationDescriptor(JSON.stringify({ ...GOOD, ...overrides }));
}

describe("verification descriptor v1", () => {
	test("canonical JSON parses and canonical bytes are deterministic", () => {
		const a = good();
		const b = good();
		expect(a.contract).toBe("assurance_kernel/verification_descriptor/v1");
		expect(a.runner_id).toBe("bun");
		expect(canonicalDescriptorBytes(a)).toBe(canonicalDescriptorBytes(b));
	});

	test("unknown fields and wrong contract are rejected", () => {
		expect(() => parseVerificationDescriptor(JSON.stringify({ ...GOOD, forged: 1 }))).toThrow(/unknown field/i);
		expect(() => parseVerificationDescriptor(JSON.stringify({ ...GOOD, contract: "x" }))).toThrow(/contract is invalid/i);
	});

	test("only the bun runner id is accepted", () => {
		for (const runner of ["bash", "sh", "python3", "node", "git", "ruby", "perl"]) {
			expect(() => good({ runner_id: runner })).toThrow(/runner must be bun/i);
		}
	});

	test("argv bounds and shell/executable-path tokens are rejected", () => {
		expect(() => good({ argv: [] })).toThrow(/non-empty/i);
		expect(() => good({ argv: ["test", "a b"] })).toThrow(/safe literal/i);
		expect(() => good({ argv: ["test", "a;b"] })).toThrow(/safe literal/i);
		expect(() => good({ argv: ["test", "$(rm -rf)"] })).toThrow(/safe literal/i);
		expect(() => good({ argv: ["test", "../escape"] })).toThrow(/safe literal/i);
		expect(() => good({ argv: ["test", "/abs/path"] })).toThrow(/safe literal/i);
		expect(() => good({ argv: ["test", ".."] })).toThrow(/safe literal/i);
		expect(() => good({ argv: ["test", "a|b"] })).toThrow(/safe literal/i);
		expect(() => good({ argv: ["test", "a>b"] })).toThrow(/safe literal/i);
		expect(() => good({ argv: ["test", "a`b"] })).toThrow(/safe literal/i);
		expect(() => good({ argv: ["test", "a*b"] })).toThrow(/safe literal/i);
		expect(() => good({ argv: Array(65).fill("x") })).toThrow(/token bound/i);
		expect(() => good({ argv: ["test", "x".repeat(600)] })).toThrow(/byte bound/i);
	});

	test("cwd must be repository-relative and bounded", () => {
		expect(() => good({ cwd: "/abs" })).toThrow(/repository-relative/i);
		expect(() => good({ cwd: "../up" })).toThrow(/escapes/i);
		expect(() => good({ cwd: "a/../../b" })).toThrow(/escapes/i);
		expect(() => good({ cwd: "a\\b" })).toThrow(/repository-relative|escapes/i);
		expect(() => good({ cwd: "" })).toThrow(/cwd is invalid/i);
	});

	test("numeric bounds are finite positive integers within host ceilings", () => {
		expect(() => good({ timeout_ms: 0 })).toThrow(/finite positive/i);
		expect(() => good({ timeout_ms: -1 })).toThrow(/finite positive/i);
		expect(() => good({ timeout_ms: 1.5 })).toThrow(/host ceiling|finite positive/i);
		expect(() => good({ timeout_ms: 999999999 })).toThrow(/host ceiling/i);
		expect(() => good({ max_output_bytes: 0 })).toThrow(/finite positive/i);
		expect(() => good({ max_output_bytes: 999999999 })).toThrow(/host ceiling/i);
	});

	test("free-form verification text is never executable", () => {
		expect(() => parseVerificationDescriptor("bun test tests/x.test.ts")).toThrow(/not valid JSON/i);
		expect(() => parseVerificationDescriptor("test -f artifact")).toThrow(/not valid JSON/i);
		expect(() => parseVerificationDescriptor("")).toThrow(/empty/i);
		expect(() => parseVerificationDescriptor("   ")).toThrow(/empty/i);
	});

	test("frozen runner identity binds realpath/device/inode/content hash/version", () => {
		const runner = resolveBunRunner();
		expect(runner.runner_id).toBe("bun");
		expect(runner.path).toMatch(/bun$/);
		expect(runner.dev).toBeGreaterThan(0);
		expect(runner.ino).toBeGreaterThan(0);
		expect(runner.content_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
		expect(runner.version).toMatch(/^\d+\.\d+\.\d+/);
	});

	test("runner version compatibility gates assurance", () => {
		const runner = resolveBunRunner();
		expect(() => assertRunnerCompatible(good({ runner_version: runner.version }), runner)).not.toThrow();
		expect(() => assertRunnerCompatible(good({ runner_version: "0.0.0" }), runner)).toThrow(/version mismatch/i);
	});

	test("fixed verification executes under the frozen runner with bounded output", async () => {
		const root = mkdtempSync(join(tmpdir(), "p2b2-vd-run-"));
		try {
			const runner = resolveBunRunner();
			const ok = await runFixedVerification(
				root,
				good({ runner_version: runner.version, argv: ["-e", "1"], timeout_ms: 30000, max_output_bytes: 8192 }),
				runner,
			);
			expect(ok.exit_code).toBe(0);
			const fail = await runFixedVerification(
				root,
				good({ runner_version: runner.version, argv: ["test", "nonexistent-xyz.test.ts"], timeout_ms: 30000, max_output_bytes: 8192 }),
				runner,
			);
			expect(fail.exit_code).not.toBe(0);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("fixed verification abort settles promptly", async () => {
		const root = mkdtempSync(join(tmpdir(), "p2b2-vd-abort-"));
		try {
			writeFileSync(join(root, "hang.ts"), "setInterval(() => {}, 1000);\n");
			const runner = resolveBunRunner();
			const controller = new AbortController();
			const startedAt = Date.now();
			const pending = runFixedVerification(
				root,
				good({
					runner_version: runner.version,
					argv: ["run", "hang.ts"],
					timeout_ms: 30_000,
					max_output_bytes: 8192,
				}),
				runner,
				{ signal: controller.signal },
			);
			setTimeout(() => controller.abort(), 25);
			await expect(pending).rejects.toThrow(/abort/i);
			expect(Date.now() - startedAt).toBeLessThan(500);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("fixed verification enforces one shared stdout and stderr output bound", async () => {
		const root = mkdtempSync(join(tmpdir(), "p2b2-vd-output-"));
		try {
			writeFileSync(
				join(root, "loud.ts"),
				"process.stdout.write('x'.repeat(5000)); process.stderr.write('y'.repeat(5000)); setInterval(() => {}, 1000);\n",
			);
			const runner = resolveBunRunner();
			const startedAt = Date.now();
			const result = await runFixedVerification(
				root,
				good({
					runner_version: runner.version,
					argv: ["run", "loud.ts"],
					timeout_ms: 30_000,
					max_output_bytes: 8192,
				}),
				runner,
			);
			expect(result.exit_code).not.toBe(0);
			expect(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(8192);
			expect(result.stderr).toContain("output limit exceeded");
			expect(Date.now() - startedAt).toBeLessThan(1000);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("findings digest is stable across key orders", () => {
		const a = findingsDigest([{ id: "f-1", kind: "blocking", acceptance_id: "A1", summary: "x" }]);
		const b = findingsDigest([{ summary: "x", kind: "blocking", id: "f-1", acceptance_id: "A1" }]);
		expect(a).toBe(b);
		expect(a).toMatch(/^sha256:[a-f0-9]{64}$/);
	});
});

describe("findings digest algorithm parity", () => {
	test("extension findingsDigest equals kernel findingsDigestV2 for identical findings", async () => {
		const { findingsDigest } = await import(
			"../plugins/immune-brain/.pi-extension/pi-canary-verification"
		);
		const { findingsDigestV2 } = await import(
			"../plugins/immune-brain/runtime/kernel/reducer"
		);
		const findings = [
			{ id: "f-1", kind: "blocking", acceptance_id: "A1", summary: "broken gate" },
			{ id: "f-2", kind: "advisory", acceptance_id: null, summary: "nit" },
		];
		expect(findingsDigest(findings as never)).toBe(
			findingsDigestV2(findings as never),
		);
	});
});
