// P2B2 verification descriptor v1 — Pi extension side.
//
// The strict canonical parser for `assurance_kernel/verification_descriptor/v1`
// is the shared pure module `runtime/verification_descriptor.ts`, consumed
// identically by Kernel intent author/validate and by Pi assurance. This file
// re-exports that single implementation and keeps Pi-only runner resolution
// and execution (frozen Bun runner binding, compatibility gate, fixed
// execution, findings digest) extension-owned.

import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, join, resolve, sep, relative } from "node:path";


export {
	VERIFICATION_DESCRIPTOR_CONTRACT,
	parseVerificationDescriptor,
	canonicalDescriptorBytes,
	VerificationDescriptorError,
	VERIFICATION_DESCRIPTOR_BOUNDS,
	type VerificationDescriptor,
} from "../runtime/verification_descriptor";
// Re-import for direct references in this module.
import {
	VERIFICATION_DESCRIPTOR_BOUNDS,
	VerificationDescriptorError,
	type VerificationDescriptor,
} from "../runtime/verification_descriptor";

/** Host-owned frozen runner identity: absolute realpath, device/inode, content hash, version. */
export interface FrozenRunner {
	runner_id: "bun";
	path: string;
	dev: number;
	ino: number;
	content_hash: string;
	version: string;
}

export function resolveBunRunner(): FrozenRunner {
	let executable: string;
	try {
		executable = execFileSync("which", ["bun"], { encoding: "utf8" }).trim();
	} catch {
		throw new VerificationDescriptorError("bun runner is unavailable on this host");
	}
	let real: string;
	try {
		real = realpathSync(executable);
	} catch {
		throw new VerificationDescriptorError("bun runner realpath is unresolvable");
	}
	let stat: ReturnType<typeof statSync>;
	try {
		stat = statSync(real);
	} catch {
		throw new VerificationDescriptorError("bun runner is unreadable");
	}
	if (!stat.isFile())
		throw new VerificationDescriptorError("bun runner is not a regular file");
	const { readFileSync } = require("node:fs") as typeof import("node:fs");
	const contentHash = `sha256:${createHash("sha256").update(readFileSync(real)).digest("hex")}`;
	let version = "";
	try {
		version = execFileSync(real, ["--version"], { encoding: "utf8" }).trim();
	} catch {
		throw new VerificationDescriptorError("bun runner version is unreadable");
	}
	return {
		runner_id: "bun",
		path: real,
		dev: stat.dev,
		ino: stat.ino,
		content_hash: contentHash,
		version,
	};
}

/** The descriptor's claimed runner version must equal the frozen host runner version. */
export function assertRunnerCompatible(
	descriptor: VerificationDescriptor,
	runner: FrozenRunner,
): void {
	if (descriptor.runner_version !== runner.version)
		throw new VerificationDescriptorError(
			`frozen runner version mismatch: descriptor claims ${descriptor.runner_version}, host has ${runner.version}; assurance unavailable`,
		);
}

/** Raised when the host cancels a running fixed verification. */
export class VerificationAbortedError extends Error {
	constructor() {
		super("fixed verification aborted");
		this.name = "VerificationAbortedError";
	}
}

/** Run the frozen runner with the descriptor argv/cwd under minimal environment. */
export async function runFixedVerification(
	root: string,
	descriptor: VerificationDescriptor,
	runner: FrozenRunner,
	options: { signal?: AbortSignal } = {},
): Promise<{ exit_code: number; stdout: string; stderr: string; timed_out: boolean }> {
	const canonicalRoot = resolve(root);
	const cwd = resolve(canonicalRoot, descriptor.cwd);
	if (cwd === canonicalRoot ? false : !relative(canonicalRoot, cwd).startsWith(".") === false)
		throw new VerificationDescriptorError("verification cwd escapes the repository");
	if (isAbsolute(descriptor.cwd) || relative(canonicalRoot, cwd).startsWith(`..${sep}`) || cwd === resolve(canonicalRoot, ".."))
		throw new VerificationDescriptorError("verification cwd escapes the repository");
	if (options.signal?.aborted) throw new VerificationAbortedError();
	if (process.platform === "win32")
		throw new VerificationDescriptorError("fixed verification process-group isolation requires a POSIX host");
	const maxOutput = Math.min(descriptor.max_output_bytes, VERIFICATION_DESCRIPTOR_BOUNDS.max_output_bytes);
	return new Promise((resolvePromise, rejectPromise) => {
		let settled = false;
		let stdout = Buffer.alloc(0);
		let stderr = Buffer.alloc(0);
		let capturedBytes = 0;
		const child = spawn(runner.path, descriptor.argv, {
			cwd,
			env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
			detached: process.platform !== "win32",
			stdio: ["ignore", "pipe", "pipe"],
		});

		const killTree = () => {
			if (child.pid === undefined) return;
			try {
				if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
				else child.kill("SIGKILL");
			} catch {
				// The process already exited.
			}
		};
		const cleanup = () => {
			clearTimeout(timeout);
			options.signal?.removeEventListener("abort", onAbort);
		};
		const resolveOnce = (result: { exit_code: number; stdout: string; stderr: string; timed_out: boolean }) => {
			if (settled) return;
			settled = true;
			cleanup();
			resolvePromise(result);
		};
		const rejectOnce = (error: Error) => {
			if (settled) return;
			settled = true;
			cleanup();
			rejectPromise(error);
		};
		const appendBounded = (current: Buffer<ArrayBuffer>, chunk: Buffer<ArrayBuffer>): { content: Buffer<ArrayBuffer>; exceeded: boolean } => {
			const available = Math.max(0, maxOutput - capturedBytes);
			const accepted = chunk.subarray(0, available);
			capturedBytes += accepted.length;
			return {
				content: accepted.length > 0 ? Buffer.concat([current, accepted]) : current,
				exceeded: chunk.length > available,
			};
		};
		const outputLimitExceeded = () => {
			const marker = Buffer.from("verification output limit exceeded\n", "utf8");
			stdout = stdout.subarray(0, Math.max(0, maxOutput - marker.length));
			stderr = marker.subarray(0, maxOutput - stdout.length);
			capturedBytes = stdout.length + stderr.length;
			killTree();
			child.stdout?.destroy();
			child.stderr?.destroy();
			resolveOnce({
				exit_code: 1,
				stdout: stdout.toString("utf8"),
				stderr: stderr.toString("utf8"),
				timed_out: false,
			});
		};
		child.stdout?.on("data", (chunk: Buffer<ArrayBuffer>) => {
			const appended = appendBounded(stdout, chunk);
			stdout = appended.content;
			if (appended.exceeded) outputLimitExceeded();
		});
		child.stderr?.on("data", (chunk: Buffer<ArrayBuffer>) => {
			const appended = appendBounded(stderr, chunk);
			stderr = appended.content;
			if (appended.exceeded) outputLimitExceeded();
		});
		child.once("error", (error) => {
			resolveOnce({
				exit_code: 1,
				stdout: stdout.toString("utf8"),
				stderr: `${stderr.toString("utf8")}runner spawn failed: ${error.message}`.slice(0, maxOutput),
				timed_out: false,
			});
		});
		child.once("close", (code) => {
			resolveOnce({
				exit_code: code ?? 1,
				stdout: stdout.toString("utf8"),
				stderr: stderr.toString("utf8"),
				timed_out: false,
			});
		});
		const onAbort = () => {
			killTree();
			child.stdout?.destroy();
			child.stderr?.destroy();
			rejectOnce(new VerificationAbortedError());
		};
		options.signal?.addEventListener("abort", onAbort, { once: true });
		const timeout = setTimeout(() => {
			killTree();
			child.stdout?.destroy();
			child.stderr?.destroy();
			resolveOnce({
				exit_code: 1,
				stdout: stdout.toString("utf8"),
				stderr: stderr.toString("utf8"),
				timed_out: true,
			});
		}, descriptor.timeout_ms);
	});
}

/** Normalized findings digest: stable-sorted keys over id/kind/acceptance_id/summary. */
export function findingsDigest(
	findings: Array<{ id: string; kind: string; acceptance_id: string | null; summary: string }>,
): string {
	const normalized = findings.map((f) =>
		JSON.stringify({
			acceptance_id: f.acceptance_id,
			id: f.id,
			kind: f.kind,
			summary: f.summary,
		}),
	);
	return `sha256:${createHash("sha256").update(`[${normalized.join(",")}]`).digest("hex")}`;
}
