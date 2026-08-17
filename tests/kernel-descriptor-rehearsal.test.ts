import { execFileSync } from "node:child_process";
import { describe, expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	assertDescriptorRehearsalSnapshot,
	descriptorRehearsalDigest,
	descriptorRehearsalReceiptRef,
	decideDescriptorRehearsalRoute,
	EnrollmentJobCoordinator,
	runDescriptorRehearsalForDescriptors,
} from "../plugins/immune-brain/.pi-extension/imm-canary-enroll.ts";

function git(root: string, args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function repo(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "descriptor-rehearsal-test-"));
	git(root, ["init", "-q"]);
	git(root, ["config", "user.email", "test@example.com"]);
	git(root, ["config", "user.name", "Test"]);
	for (const [path, content] of Object.entries(files)) writeFileSync(join(root, path), content);
	git(root, ["add", "."]);
	git(root, ["commit", "-qm", "fixture"]);
	return root;
}

function descriptor(script: string, timeoutMs = 5_000, maxOutputBytes = 16_384, cwd = "."): string {
	return JSON.stringify({
		contract: "assurance_kernel/verification_descriptor/v1",
		runner_id: "bun",
		runner_version: "1.3.14",
		argv: ["run", script],
		cwd,
		timeout_ms: timeoutMs,
		max_output_bytes: maxOutputBytes,
	});
}

function statusBytes(root: string): Buffer {
	return execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
		cwd: root,
		encoding: "buffer",
	}) as Buffer;
}

describe("descriptor rehearsal preflight", () => {
	test("runs canonical descriptors concurrently in isolated index copies with zero parent mutation", async () => {
		const root = repo({
			"first.ts": "await Bun.sleep(600); await Bun.write('collision.txt', 'first');\n",
			"second.ts": "await Bun.sleep(600); await Bun.write('collision.txt', 'second');\n",
			"dependency.ts": "await Bun.write('node_modules/fixture-package/value.txt', 'copy only\\n');\n",
		});
		try {
			mkdirSync(join(root, "node_modules", "fixture-package"), { recursive: true });
			writeFileSync(join(root, "node_modules", "fixture-package", "value.txt"), "parent dependency\n");
			writeFileSync(join(root, "untracked-user-file.txt"), "preserve me\n");
			const beforeStatus = statusBytes(root);
			const beforeHead = git(root, ["rev-parse", "HEAD"]);
			const started = performance.now();
			const receipt = await runDescriptorRehearsalForDescriptors(root, "task-parallel", [
				{ id: "acc-first", verification: descriptor("first.ts") },
				{ id: "acc-second", verification: descriptor("second.ts") },
				{ id: "acc-dependency", verification: descriptor("dependency.ts") },
			]);
			const elapsed = performance.now() - started;

			expect(receipt.contract).toBe("assurance_kernel/descriptor_rehearsal/v1");
			expect(receipt.enrollment_ready).toBe(true);
			expect(receipt.writes_performed).toBe(false);
			expect(receipt.blockers).toEqual([]);
			expect(receipt.descriptors.map((item) => item.status)).toEqual(["passed", "passed", "passed"]);
			expect(receipt.descriptors.slice(0, 2).every((item) => item.duration_ms >= 500)).toBe(true);
			const summedDurations = receipt.descriptors.reduce((sum, item) => sum + item.duration_ms, 0);
			expect(elapsed).toBeLessThan(summedDurations - 100);
			expect(statusBytes(root).equals(beforeStatus)).toBe(true);
			expect(git(root, ["rev-parse", "HEAD"])).toBe(beforeHead);
			expect(readFileSync(join(root, "untracked-user-file.txt"), "utf8")).toBe("preserve me\n");
			expect(readFileSync(join(root, "node_modules", "fixture-package", "value.txt"), "utf8")).toBe("parent dependency\n");
			expect(() => readFileSync(join(root, "collision.txt"))).toThrow();
			expect(descriptorRehearsalDigest(receipt)).toMatch(/^sha256:[a-f0-9]{64}$/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("executes the frozen staged snapshot and rejects scope or index drift", async () => {
		const root = repo({ "snapshot.ts": "process.exit(9);\n" });
		try {
			writeFileSync(join(root, "snapshot.ts"), "console.log('staged pass');\n");
			git(root, ["add", "snapshot.ts"]);
			const receipt = await runDescriptorRehearsalForDescriptors(
				root,
				"task-snapshot",
				[{ id: "acc-snapshot", verification: descriptor("snapshot.ts") }],
				{ scopePaths: ["snapshot.ts"] },
			);
			expect(receipt.enrollment_ready).toBe(true);
			expect(receipt.index_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
			expect(receipt.scope_paths).toEqual(["snapshot.ts"]);
			expect(receipt.waiver_allowed).toBe(false);
			expect(() => assertDescriptorRehearsalSnapshot(root, receipt)).not.toThrow();

			writeFileSync(join(root, "snapshot.ts"), "process.exit(8);\n");
			const unstaged = await runDescriptorRehearsalForDescriptors(
				root,
				"task-snapshot",
				[{ id: "acc-snapshot", verification: descriptor("snapshot.ts") }],
				{ scopePaths: ["snapshot.ts"] },
			);
			expect(unstaged.enrollment_ready).toBe(false);
			expect(unstaged.waiver_allowed).toBe(false);
			expect(unstaged.blockers.join("\n")).toContain("unstaged tracked bytes");
			expect(decideDescriptorRehearsalRoute(unstaged, "explicit_waiver")).toEqual({
				proceed_to_confirmation: false,
				override: false,
			});

			git(root, ["add", "snapshot.ts"]);
			expect(() => assertDescriptorRehearsalSnapshot(root, receipt)).toThrow(/index drift/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("bounds setup and makes setup or execution cancellation non-waivable and close-settled", async () => {
		const root = repo({ "pass.ts": "console.log('pass');\n" });
		const pidFile = `${root}.descriptor.pid`;
		try {
			const timed = await runDescriptorRehearsalForDescriptors(root, "task-setup-timeout", [
				{ id: "acc-timeout", verification: descriptor("pass.ts", 1) },
			]);
			expect(timed.descriptors[0].status).toBe("setup_timed_out");
			expect(timed.descriptors[0].summary).toContain("isolated-copy setup timed out");
			expect(timed.descriptors[0].duration_ms).toBeLessThan(500);
			expect(timed.waiver_allowed).toBe(false);
			expect(decideDescriptorRehearsalRoute(timed, "explicit_waiver")).toEqual({
				proceed_to_confirmation: false,
				override: false,
			});

			const setupController = new AbortController();
			setupController.abort(new Error("cancel during setup"));
			const started = performance.now();
			const setupCancelled = await runDescriptorRehearsalForDescriptors(
				root,
				"task-setup-cancel",
				[{ id: "acc-cancel", verification: descriptor("pass.ts") }],
				{ signal: setupController.signal },
			);
			expect(setupCancelled.descriptors[0].status).toBe("cancelled");
			expect(setupCancelled.descriptors[0].summary).toContain("closed before cleanup");
			expect(setupCancelled.waiver_allowed).toBe(false);
			expect(decideDescriptorRehearsalRoute(setupCancelled, "explicit_waiver")).toEqual({
				proceed_to_confirmation: false,
				override: false,
			});
			expect(performance.now() - started).toBeLessThan(500);

			writeFileSync(
				join(root, "slow.ts"),
				`await Bun.write(${JSON.stringify(pidFile)}, String(process.pid)); await Bun.sleep(5_000);\n`,
			);
			git(root, ["add", "slow.ts"]);
			git(root, ["commit", "--amend", "--no-edit", "-q"]);
			const executionController = new AbortController();
			const pending = runDescriptorRehearsalForDescriptors(
				root,
				"task-execution-cancel",
				[{ id: "acc-cancel", verification: descriptor("slow.ts") }],
				{ signal: executionController.signal },
			);
			for (let attempt = 0; attempt < 100 && !existsSync(pidFile); attempt += 1)
				await Bun.sleep(20);
			expect(existsSync(pidFile)).toBe(true);
			executionController.abort(new Error("cancel during execution"));
			const executionCancelled = await pending;
			const descriptorPid = Number(readFileSync(pidFile, "utf8"));
			expect(executionCancelled.descriptors[0].status).toBe("cancelled");
			expect(executionCancelled.waiver_allowed).toBe(false);
			expect(decideDescriptorRehearsalRoute(executionCancelled, "explicit_waiver")).toEqual({
				proceed_to_confirmation: false,
				override: false,
			});
			expect(() => process.kill(descriptorPid, 0)).toThrow();
		} finally {
			rmSync(pidFile, { force: true });
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("aborts running descriptors on live index drift and fingerprints tracked dirty bytes", async () => {
		const root = repo({
			"slow.ts": "console.log('initial');\n",
			"dirty.txt": "committed\n",
		});
		const pidFile = `${root}.integrity.pid`;
		try {
			writeFileSync(join(root, "dirty.txt"), "dirty-before\n");
			writeFileSync(
				join(root, "slow.ts"),
				`await Bun.write(${JSON.stringify(pidFile)}, String(process.pid)); await Bun.sleep(10_000);\n`,
			);
			git(root, ["add", "slow.ts"]);
			const started = performance.now();
			const pending = runDescriptorRehearsalForDescriptors(
				root,
				"task-live-integrity",
				[{ id: "acc-integrity", verification: descriptor("slow.ts", 20_000) }],
				{ scopePaths: ["slow.ts"] },
			);
			for (let attempt = 0; attempt < 150 && !existsSync(pidFile); attempt += 1)
				await Bun.sleep(20);
			expect(existsSync(pidFile)).toBe(true);

			// Preserve the same Git status path/classification while changing tracked bytes.
			writeFileSync(join(root, "dirty.txt"), "dirty-after\n");
			writeFileSync(join(root, "slow.ts"), "console.log('new staged snapshot');\n");
			git(root, ["add", "slow.ts"]);

			const receipt = await pending;
			const descriptorPid = Number(readFileSync(pidFile, "utf8"));
			expect(performance.now() - started).toBeLessThan(5_000);
			expect(receipt.descriptors[0].status).toBe("integrity_drift");
			expect(receipt.descriptors[0].summary).toContain("process tree closed before cleanup");
			expect(receipt.blockers.join("\n")).toContain("parent Git-visible content bytes");
			expect(receipt.blockers.join("\n")).toContain("current Git index no longer matches");
			expect(receipt.waiver_allowed).toBe(false);
			expect(decideDescriptorRehearsalRoute(receipt, "explicit_waiver")).toEqual({
				proceed_to_confirmation: false,
				override: false,
			});
			expect(() => process.kill(descriptorPid, 0)).toThrow();
		} finally {
			rmSync(pidFile, { force: true });
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("detects same-path untracked byte drift while a descriptor is running", async () => {
		const root = repo({ "slow.ts": "console.log('initial');\n" });
		const pidFile = `${root}.untracked-integrity.pid`;
		try {
			writeFileSync(join(root, "untracked.txt"), "before\n");
			writeFileSync(
				join(root, "slow.ts"),
				`await Bun.write(${JSON.stringify(pidFile)}, String(process.pid)); await Bun.sleep(10_000);\n`,
			);
			git(root, ["add", "slow.ts"]);
			const pending = runDescriptorRehearsalForDescriptors(
				root,
				"task-untracked-integrity",
				[{ id: "acc-integrity", verification: descriptor("slow.ts", 20_000) }],
				{ scopePaths: ["slow.ts"] },
			);
			for (let attempt = 0; attempt < 150 && !existsSync(pidFile); attempt += 1)
				await Bun.sleep(20);
			expect(existsSync(pidFile)).toBe(true);

			writeFileSync(join(root, "untracked.txt"), "after\n");
			const receipt = await pending;
			const descriptorPid = Number(readFileSync(pidFile, "utf8"));
			expect(receipt.descriptors[0].status).toBe("integrity_drift");
			expect(receipt.blockers.join("\n")).toContain("parent Git-visible content bytes");
			expect(receipt.waiver_allowed).toBe(false);
			expect(() => process.kill(descriptorPid, 0)).toThrow();
		} finally {
			rmSync(pidFile, { force: true });
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("makes output-limit and setup failures non-waivable", async () => {
		const root = repo({
			"output.ts": "console.log('x'.repeat(100_000));\n",
			"pass.ts": "console.log('pass');\n",
		});
		try {
			const outputLimited = await runDescriptorRehearsalForDescriptors(root, "task-output-limit", [
				{ id: "acc-output", verification: descriptor("output.ts", 5_000, 64) },
			]);
			expect(outputLimited.descriptors[0].status).toBe("output_exceeded");
			expect(outputLimited.descriptors[0].summary).toContain("process tree closed before cleanup");
			expect(outputLimited.waiver_allowed).toBe(false);
			expect(decideDescriptorRehearsalRoute(outputLimited, "explicit_waiver")).toEqual({
				proceed_to_confirmation: false,
				override: false,
			});

			const setupFailed = await runDescriptorRehearsalForDescriptors(root, "task-setup-failure", [
				{ id: "acc-setup", verification: descriptor("pass.ts", 5_000, 16_384, "missing-directory") },
			]);
			expect(setupFailed.descriptors[0].status).toBe("setup_failed");
			expect(setupFailed.waiver_allowed).toBe(false);
			expect(decideDescriptorRehearsalRoute(setupFailed, "explicit_waiver")).toEqual({
				proceed_to_confirmation: false,
				override: false,
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("reports per-descriptor failure and timeout with actionable enrollment blockers", async () => {
		const root = repo({
			"fail.ts": "console.error('fixture leak detected'); process.exit(7);\n",
			"timeout.ts": "await Bun.sleep(5_000);\n",
		});
		try {
			const receipt = await runDescriptorRehearsalForDescriptors(root, "task-blocked", [
				{ id: "acc-fail", verification: descriptor("fail.ts") },
				{ id: "acc-timeout", verification: descriptor("timeout.ts", 100) },
			]);
			expect(receipt.enrollment_ready).toBe(false);
			expect(receipt.writes_performed).toBe(false);
			expect(receipt.descriptors).toHaveLength(2);
			expect(receipt.descriptors[0]).toMatchObject({
				acceptance_id: "acc-fail",
				status: "failed",
				exit_code: 7,
			});
			expect(receipt.descriptors[0].summary).toContain("fixture leak detected");
			expect(receipt.descriptors[1]).toMatchObject({
				acceptance_id: "acc-timeout",
				status: "timed_out",
			});
			expect(receipt.blockers.join("\n")).toContain("acc-fail: failed");
			expect(receipt.blockers.join("\n")).toContain("acc-timeout: timed_out");
			expect(receipt.blockers.join("\n")).toContain("concurrent rehearsal");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("permits failure override only on the explicit waiver route", () => {
		const failed = {
			contract: "assurance_kernel/descriptor_rehearsal/v1" as const,
			task_id: "task-route",
			index_digest: "sha256:index",
			scope_paths: [],
			enrollment_ready: false,
			waiver_allowed: true,
			writes_performed: false as const,
			descriptors: [],
			blockers: ["acc-one: failed"],
		};
		expect(decideDescriptorRehearsalRoute(failed, "default")).toEqual({
			proceed_to_confirmation: false,
			override: false,
		});
		expect(decideDescriptorRehearsalRoute(failed, "explicit_waiver")).toEqual({
			proceed_to_confirmation: true,
			override: true,
		});
		expect(
			decideDescriptorRehearsalRoute({ ...failed, waiver_allowed: false }, "explicit_waiver"),
		).toEqual({ proceed_to_confirmation: false, override: false });
		expect(
			descriptorRehearsalReceiptRef(failed, true),
		).toMatch(/^descriptor-rehearsal\/v1:waived:sha256:[a-f0-9]{64}$/);
		expect(
			descriptorRehearsalReceiptRef({ ...failed, enrollment_ready: true }, false),
		).toMatch(/^descriptor-rehearsal\/v1:passed:sha256:[a-f0-9]{64}$/);
		expect(
			decideDescriptorRehearsalRoute({ ...failed, enrollment_ready: true }, "default"),
		).toEqual({ proceed_to_confirmation: true, override: false });
	});

	test("returns immediately for session-owned jobs and supports cancellation and shutdown", async () => {
		const statuses: Array<string | undefined> = [];
		const widgets: Array<string[] | undefined> = [];
		const notifications: string[] = [];
		const ctx = {
			ui: {
				setStatus: (_key: string, text: string | undefined) => statuses.push(text),
				setWidget: (_key: string, content: string[] | undefined) => widgets.push(content),
				notify: (message: string) => notifications.push(message),
			},
		} as unknown as ExtensionContext;
		const coordinator = new EnrollmentJobCoordinator({ refreshIntervalMs: 5 });
		let started = false;
		const work = async (backgroundCtx: ExtensionContext): Promise<void> => {
			started = true;
			await new Promise<void>((resolve) => {
				backgroundCtx.signal.addEventListener("abort", () => resolve(), { once: true });
			});
		};

		expect(coordinator.start("task-background", "imm-canary-new", ctx, work)).toBe(true);
		expect(started).toBe(true);
		expect(notifications.join("\n")).toContain("input remains available");
		expect(coordinator.start("task-other", "imm-canary-enroll", ctx, work)).toBe(false);
		coordinator.cancel("task-background", ctx);
		await Bun.sleep(0);
		expect(widgets.some((widget) => widget?.join("\n").includes("Cancellation requested"))).toBe(true);
		expect(widgets.at(-1)).toBeUndefined();

		expect(coordinator.start("task-shutdown", "imm-canary-new", ctx, work)).toBe(true);
		await coordinator.shutdown();
		expect(widgets.at(-1)).toBeUndefined();

		let finishCommit: (() => void) | undefined;
		const committingWork = async (): Promise<void> => {
			await new Promise<void>((resolve) => { finishCommit = resolve; });
		};
		expect(coordinator.start("task-commit", "imm-canary-new", ctx, committingWork)).toBe(true);
		expect(coordinator.markCommitting("task-commit", ctx)).toBe(true);
		coordinator.cancel("task-commit", ctx);
		expect(notifications.join("\n")).toContain("commit already owns settlement");
		const shutdown = coordinator.shutdown();
		expect(widgets.some((widget) => widget?.join("\n").includes("shutdown waiting for commit"))).toBe(true);
		finishCommit?.();
		await shutdown;
		expect(widgets.at(-1)).toBeUndefined();
		expect(statuses).toEqual([]);
	});

	test("fails closed before execution for a non-canonical or incompatible descriptor", async () => {
		const root = repo({ "pass.ts": "console.log('pass');\n" });
		try {
			const receipt = await runDescriptorRehearsalForDescriptors(root, "task-invalid", [
				{ id: "acc-invalid", verification: "bun test" },
			]);
			expect(receipt.enrollment_ready).toBe(false);
			expect(receipt.descriptors).toEqual([]);
			expect(receipt.blockers[0]).toContain("descriptor validation failed");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
