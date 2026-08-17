// P2B1 Pi extension: /imm-canary-enroll <task-id>
// The sole shipped route that can complete confirmed canary enrollment.
// - TUI only: ctx.mode === "tui" is required before any readiness read or confirm.
// - No tool, flag, shortcut, automatic event, CLI, RPC, JSON, or print route.
// - The production enrollment registry is created HERE inside the activation
//   closure and never exported; no other module can issue or consume it.
// - Missing live evidence or any non-waivable gap rejects BEFORE ctx.ui.confirm.
// - Canonical descriptors run concurrently in isolated index copies; this
//   explicit route alone may present a failed rehearsal for user waiver.
// - Post-confirm and final-lock revalidation gates every enrollment.
//
// Runtime modules are loaded dynamically inside the handler: the extension is
// type-isolated from the runtime source graph (tsc checks only this file).

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
// The Kernel runtime graph is never type-checked from this extension: static
// imports resolve to ./runtime-stub.ts (relative so the Pi extension loader
// can resolve them at runtime), and the stub forwards to the real Kernel
// modules via dynamic import.
import {
	createEnrollmentAuthorityRegistry,
	preparePiCanary,
	revalidatePiCanary,
	evaluateCanaryEligibility,
	readTaskIntent,
	runEnrollmentRehearsal,
	enrollCanaryTask,
} from "./runtime-stub";
import type { CanaryWaiver } from "./runtime-stub";
import type { PiCanaryPreparation, PiCanaryPrepareInput } from "./runtime-stub";
import type { EnrollCanaryInput } from "./runtime-stub";
import {
	assertRunnerCompatible,
	parseVerificationDescriptor,
	resolveBunRunner,
	type VerificationDescriptor,
} from "./pi-canary-verification";

const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const REHEARSAL_OUTPUT_SUMMARY_LIMIT = 512;

export interface DescriptorRehearsalResult {
	acceptance_id: string;
	status:
		| "passed"
		| "failed"
		| "timed_out"
		| "setup_timed_out"
		| "cancelled"
		| "integrity_drift"
		| "output_exceeded"
		| "setup_failed";
	duration_ms: number;
	exit_code: number;
	summary: string;
}

export interface DescriptorRehearsalReceipt {
	contract: "assurance_kernel/descriptor_rehearsal/v1";
	task_id: string;
	index_digest: string;
	scope_paths: string[];
	enrollment_ready: boolean;
	waiver_allowed: boolean;
	writes_performed: false;
	descriptors: DescriptorRehearsalResult[];
	blockers: string[];
}

export interface DescriptorRehearsalDecision {
	proceed_to_confirmation: boolean;
	override: boolean;
}

export function decideDescriptorRehearsalRoute(
	receipt: DescriptorRehearsalReceipt,
	route: "default" | "explicit_waiver",
): DescriptorRehearsalDecision {
	if (receipt.enrollment_ready)
		return { proceed_to_confirmation: true, override: false };
	if (route === "explicit_waiver" && receipt.waiver_allowed)
		return { proceed_to_confirmation: true, override: true };
	return { proceed_to_confirmation: false, override: false };
}

function gitBytes(root: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): Buffer {
	return execFileSync("git", args, {
		cwd: root,
		encoding: "buffer",
		env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", ...extraEnv },
		stdio: ["ignore", "pipe", "pipe"],
		maxBuffer: 32 * 1024 * 1024,
		timeout: 30_000,
	}) as Buffer;
}

function indexDigest(root: string, indexFile?: string): string {
	const bytes = gitBytes(
		root,
		["ls-files", "--stage", "-z"],
		indexFile ? { GIT_INDEX_FILE: indexFile } : {},
	);
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function rootFingerprint(root: string): Buffer {
	const hash = createHash("sha256");
	hash.update(gitBytes(root, ["ls-files", "--stage", "-z"]));
	hash.update(Buffer.from([0xfd]));
	hash.update(gitBytes(root, ["diff", "--binary", "--no-ext-diff", "--"]));
	hash.update(Buffer.from([0xfe]));
	hash.update(gitBytes(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]));
	for (const path of splitNullPaths(gitBytes(root, ["ls-files", "--others", "--exclude-standard", "-z"])).sort()) {
		const fullPath = resolve(root, path);
		const stat = lstatSync(fullPath);
		hash.update(Buffer.from([0xfc]));
		hash.update(path);
		hash.update(`\0${stat.mode}\0`);
		if (stat.isSymbolicLink()) hash.update(readlinkSync(fullPath));
		else if (stat.isFile()) hash.update(readFileSync(fullPath));
	}
	return hash.digest();
}

function splitNullPaths(bytes: Buffer): string[] {
	return bytes.toString("utf8").split("\0").filter(Boolean);
}

function scopeAlignmentBlockers(root: string, scopePaths: string[]): string[] {
	if (scopePaths.length === 0) return [];
	const unstaged = splitNullPaths(gitBytes(root, ["diff", "--name-only", "-z", "--", ...scopePaths]));
	const untracked = splitNullPaths(
		gitBytes(root, ["ls-files", "--others", "--exclude-standard", "-z", "--", ...scopePaths]),
	);
	const blockers: string[] = [];
	if (unstaged.length > 0)
		blockers.push(`scope contains unstaged tracked bytes omitted from the Git index: ${unstaged.join(", ")}`);
	if (untracked.length > 0)
		blockers.push(`scope contains untracked bytes omitted from the Git index: ${untracked.join(", ")}`);
	return blockers;
}

interface FrozenRehearsalIndex {
	directory: string;
	path: string;
	digest: string;
}

function freezeRehearsalIndex(root: string): FrozenRehearsalIndex {
	const directory = mkdtempSync(join(tmpdir(), "imm-descriptor-index-"));
	try {
		const rawPath = gitBytes(root, ["rev-parse", "--git-path", "index"]).toString("utf8").trim();
		const source = resolve(root, rawPath);
		const path = join(directory, "index");
		copyFileSync(source, path);
		return { directory, path, digest: indexDigest(root, path) };
	} catch (error) {
		rmSync(directory, { recursive: true, force: true });
		throw error;
	}
}

class RehearsalSetupTimeoutError extends Error {
	constructor() {
		super("isolated-copy setup exceeded the descriptor timeout");
		this.name = "RehearsalSetupTimeoutError";
	}
}

class RehearsalIntegrityDriftError extends Error {
	constructor(readonly blockers: string[]) {
		super(`descriptor rehearsal integrity drift: ${blockers.join("; ")}`);
		this.name = "RehearsalIntegrityDriftError";
	}
}

function runSetupCommand(
	command: string,
	args: string[],
	options: { cwd?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal; deadline: number },
): Promise<void> {
	const remaining = Math.floor(options.deadline - performance.now());
	if (remaining <= 0) return Promise.reject(new RehearsalSetupTimeoutError());
	if (options.signal?.aborted)
		return Promise.reject(options.signal.reason instanceof Error ? options.signal.reason : new Error("descriptor rehearsal cancelled"));
	return new Promise((resolvePromise, rejectPromise) => {
		let settled = false;
		let terminationError: Error | undefined;
		let spawnError: Error | undefined;
		let stderr = "";
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: { ...process.env, ...options.env },
			detached: process.platform !== "win32",
			stdio: ["ignore", "ignore", "pipe"],
		});
		const killTree = () => {
			if (child.pid === undefined) return;
			try {
				if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
				else child.kill("SIGKILL");
			} catch {
				// The setup process already exited.
			}
		};
		const cleanup = () => {
			if (timeout !== undefined) clearTimeout(timeout);
			options.signal?.removeEventListener("abort", onAbort);
		};
		const settle = (error?: Error) => {
			if (settled) return;
			settled = true;
			cleanup();
			if (error) rejectPromise(error);
			else resolvePromise();
		};
		const requestTermination = (error: Error) => {
			if (settled || terminationError !== undefined) return;
			terminationError = error;
			if (timeout !== undefined) clearTimeout(timeout);
			options.signal?.removeEventListener("abort", onAbort);
			killTree();
		};
		const onAbort = () => {
			requestTermination(
				options.signal?.reason instanceof Error
					? options.signal.reason
					: new Error("descriptor rehearsal cancelled"),
			);
		};
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr = `${stderr}${chunk.toString("utf8")}`.slice(0, REHEARSAL_OUTPUT_SUMMARY_LIMIT);
		});
		child.once("error", (error) => {
			spawnError = error;
		});
		child.once("close", (code) => {
			settle(
				terminationError ?? spawnError
				?? (code === 0 ? undefined : new Error(`${command} setup failed (${code ?? 1}): ${stderr || "no stderr"}`)),
			);
		});
		options.signal?.addEventListener("abort", onAbort, { once: true });
		timeout = setTimeout(() => requestTermination(new RehearsalSetupTimeoutError()), remaining);
		if (options.signal?.aborted) onAbort();
	});
}

async function cloneDependencies(
	dependencies: string,
	destination: string,
	options: { signal?: AbortSignal; deadline: number },
): Promise<void> {
	const args = process.platform === "darwin"
		? ["-cRL", dependencies, destination]
		: process.platform === "linux"
			? ["-aL", "--reflink=auto", dependencies, destination]
			: null;
	if (!args)
		throw new Error(`descriptor rehearsal dependency isolation is unsupported on ${process.platform}`);
	await runSetupCommand("cp", args, options);
}

async function createIsolatedRehearsalCopy(
	root: string,
	copy: string,
	frozenIndexPath: string,
	options: { signal?: AbortSignal; deadline: number },
): Promise<void> {
	await runSetupCommand("git", ["checkout-index", "--all", `--prefix=${copy}/`], {
		...options,
		cwd: root,
		env: { GIT_OPTIONAL_LOCKS: "0", GIT_INDEX_FILE: frozenIndexPath },
	});
	const dependencies = resolve(root, "node_modules");
	if (existsSync(dependencies) && !existsSync(join(copy, "node_modules")))
		await cloneDependencies(dependencies, join(copy, "node_modules"), options);
	await runSetupCommand("git", ["init", "-q"], { ...options, cwd: copy });
	await runSetupCommand("git", ["add", "-A"], { ...options, cwd: copy });
	await runSetupCommand(
		"git",
		[
			"-c", "user.email=rehearsal@localhost",
			"-c", "user.name=Descriptor Rehearsal",
			"-c", "core.hooksPath=/dev/null",
			"commit", "--no-verify", "-qm", "immutable rehearsal snapshot",
		],
		{ ...options, cwd: copy },
	);
}

function conciseResult(result: { stdout: string; stderr: string }): string {
	const text = `${result.stderr}\n${result.stdout}`.trim().replace(/\s+/g, " ");
	return (text || "descriptor exited non-zero").slice(-REHEARSAL_OUTPUT_SUMMARY_LIMIT);
}

interface RehearsalProcessResult {
	exit_code: number;
	stdout: string;
	stderr: string;
	timed_out: boolean;
	cancelled: boolean;
	output_exceeded: boolean;
	spawn_failed: boolean;
}

function runRehearsalProcessToClose(
	root: string,
	descriptor: VerificationDescriptor,
	runnerPath: string,
	signal?: AbortSignal,
): Promise<RehearsalProcessResult> {
	const canonicalRoot = resolve(root);
	const cwd = resolve(canonicalRoot, descriptor.cwd);
	if (
		isAbsolute(descriptor.cwd)
		|| relative(canonicalRoot, cwd).startsWith(`..${sep}`)
		|| cwd === resolve(canonicalRoot, "..")
	)
		throw new Error("verification cwd escapes the repository");
	if (process.platform === "win32")
		throw new Error("fixed verification process-group isolation requires a POSIX host");
	if (signal?.aborted)
		return Promise.resolve({
			exit_code: 1,
			stdout: "",
			stderr: "",
			timed_out: false,
			cancelled: true,
			output_exceeded: false,
			spawn_failed: false,
		});
	return new Promise((resolvePromise) => {
		let settled = false;
		let termination: "cancelled" | "timed_out" | "output_limit" | null = null;
		let stdout = Buffer.alloc(0);
		let stderr = Buffer.alloc(0);
		let spawnError: Error | undefined;
		let capturedBytes = 0;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const child = spawn(runnerPath, descriptor.argv, {
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
				// The descriptor process already exited.
			}
		};
		const cleanup = () => {
			if (timeout !== undefined) clearTimeout(timeout);
			signal?.removeEventListener("abort", onAbort);
		};
		const settle = (result: RehearsalProcessResult) => {
			if (settled) return;
			settled = true;
			cleanup();
			resolvePromise(result);
		};
		const requestTermination = (kind: "cancelled" | "timed_out" | "output_limit") => {
			if (settled || termination !== null) return;
			termination = kind;
			if (timeout !== undefined) clearTimeout(timeout);
			signal?.removeEventListener("abort", onAbort);
			killTree();
		};
		const appendBounded = (
			current: Buffer<ArrayBuffer>,
			chunk: Buffer<ArrayBuffer>,
		): Buffer<ArrayBuffer> => {
			const available = Math.max(0, descriptor.max_output_bytes - capturedBytes);
			const accepted = chunk.subarray(0, available);
			capturedBytes += accepted.length;
			if (chunk.length > available) requestTermination("output_limit");
			return accepted.length > 0 ? Buffer.concat([current, accepted]) : current;
		};
		const finalResult = (code: number | null): RehearsalProcessResult => {
			const outputLimit = termination === "output_limit";
			const outputLimitMarker = outputLimit ? "verification output limit exceeded" : "";
			const stderrLimit = Math.max(0, descriptor.max_output_bytes - stdout.length);
			return {
				exit_code: termination === null ? (code ?? 1) : 1,
				stdout: stdout.toString("utf8"),
				stderr: `${stderr.toString("utf8")}${outputLimitMarker}`.slice(0, stderrLimit),
				timed_out: termination === "timed_out",
				cancelled: termination === "cancelled",
				output_exceeded: outputLimit,
				spawn_failed: spawnError !== undefined && termination === null,
			};
		};
		const onAbort = () => requestTermination("cancelled");
		child.stdout?.on("data", (chunk: Buffer<ArrayBuffer>) => {
			stdout = appendBounded(stdout, chunk);
		});
		child.stderr?.on("data", (chunk: Buffer<ArrayBuffer>) => {
			stderr = appendBounded(stderr, chunk);
		});
		child.once("error", (error) => {
			spawnError = error;
		});
		child.once("close", (code) => {
			const result = finalResult(code);
			if (spawnError && termination === null) {
				result.stderr = `${result.stderr}runner spawn failed: ${spawnError.message}`.slice(
					0,
					descriptor.max_output_bytes,
				);
			}
			settle(result);
		});
		signal?.addEventListener("abort", onAbort, { once: true });
		timeout = setTimeout(() => requestTermination("timed_out"), descriptor.timeout_ms);
		if (signal?.aborted) onAbort();
	});
}

function blockedReceipt(
	taskId: string,
	indexDigestValue: string,
	scopePaths: string[],
	blockers: string[],
	waiverAllowed = false,
): DescriptorRehearsalReceipt {
	return {
		contract: "assurance_kernel/descriptor_rehearsal/v1",
		task_id: taskId,
		index_digest: indexDigestValue,
		scope_paths: scopePaths,
		enrollment_ready: false,
		waiver_allowed: waiverAllowed,
		writes_performed: false,
		descriptors: [],
		blockers,
	};
}

export async function runDescriptorRehearsalForDescriptors(
	root: string,
	taskId: string,
	items: Array<{ id: string; verification: string }>,
	options: { signal?: AbortSignal; scopePaths?: string[] } = {},
): Promise<DescriptorRehearsalReceipt> {
	const canonicalRoot = resolve(root);
	const scopePaths = [...new Set(options.scopePaths ?? [])].sort();
	const before = rootFingerprint(canonicalRoot);
	const initialIndexDigest = indexDigest(canonicalRoot);
	const initialScopeBlockers = scopeAlignmentBlockers(canonicalRoot, scopePaths);
	if (initialScopeBlockers.length > 0)
		return blockedReceipt(taskId, initialIndexDigest, scopePaths, initialScopeBlockers);

	const runner = resolveBunRunner();
	let parsed: Array<{ id: string; descriptor: VerificationDescriptor }>;
	try {
		parsed = items.map((item) => {
			const descriptor = parseVerificationDescriptor(item.verification);
			assertRunnerCompatible(descriptor, runner);
			return { id: item.id, descriptor };
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return blockedReceipt(
			taskId,
			initialIndexDigest,
			scopePaths,
			[`descriptor validation failed: ${message}`],
			true,
		);
	}

	const frozenIndex = freezeRehearsalIndex(canonicalRoot);
	try {
		if (frozenIndex.digest !== indexDigest(canonicalRoot))
			return blockedReceipt(taskId, frozenIndex.digest, scopePaths, ["Git index changed while freezing descriptor rehearsal snapshot"]);

		const executionController = new AbortController();
		const relayExternalAbort = () => executionController.abort(
			options.signal?.reason instanceof Error
				? options.signal.reason
				: new Error("descriptor rehearsal cancelled"),
		);
		options.signal?.addEventListener("abort", relayExternalAbort, { once: true });
		if (options.signal?.aborted) relayExternalAbort();

		let observedIntegrityBlockers: string[] = [];
		const collectIntegrityBlockers = (): string[] => {
			const blockers: string[] = [];
			if (!before.equals(rootFingerprint(canonicalRoot)))
				blockers.push("parent Git-visible content bytes, worktree classification, or Git index changed during descriptor rehearsal");
			if (indexDigest(canonicalRoot) !== frozenIndex.digest)
				blockers.push("current Git index no longer matches the rehearsed frozen index");
			blockers.push(...scopeAlignmentBlockers(canonicalRoot, scopePaths));
			return [...new Set(blockers)];
		};
		const monitorIntegrity = () => {
			if (executionController.signal.aborted) return;
			let blockers: string[];
			try {
				blockers = collectIntegrityBlockers();
			} catch (error) {
				blockers = [`integrity monitor failed closed: ${error instanceof Error ? error.message : String(error)}`];
			}
			if (blockers.length === 0) return;
			observedIntegrityBlockers = blockers;
			executionController.abort(new RehearsalIntegrityDriftError(blockers));
		};
		const integrityMonitor = setInterval(monitorIntegrity, 250);
		try {
			const executions = parsed.map(async ({ id, descriptor }): Promise<DescriptorRehearsalResult> => {
				const started = performance.now();
				const deadline = started + descriptor.timeout_ms;
				const copy = mkdtempSync(join(tmpdir(), "imm-descriptor-rehearsal-"));
				try {
					await createIsolatedRehearsalCopy(canonicalRoot, copy, frozenIndex.path, {
						signal: executionController.signal,
						deadline,
					});
					const remaining = Math.floor(deadline - performance.now());
					if (remaining <= 0) throw new RehearsalSetupTimeoutError();
					const result = await runRehearsalProcessToClose(
						copy,
						{ ...descriptor, timeout_ms: remaining },
						runner.path,
						executionController.signal,
					);
					const duration = Math.max(0, Math.round(performance.now() - started));
					if (result.cancelled) {
						const integrityDrift = executionController.signal.reason instanceof RehearsalIntegrityDriftError;
						return {
							acceptance_id: id,
							status: integrityDrift ? "integrity_drift" : "cancelled",
							duration_ms: duration,
							exit_code: result.exit_code,
							summary: integrityDrift
								? "live integrity drift aborted the descriptor; process tree closed before cleanup"
								: "descriptor rehearsal cancelled; process tree closed before cleanup",
						};
					}
					if (result.timed_out) return {
						acceptance_id: id,
						status: "timed_out",
						duration_ms: duration,
						exit_code: result.exit_code,
						summary: `descriptor execution timed out after ${descriptor.timeout_ms}ms under concurrent rehearsal`,
					};
					if (result.output_exceeded) return {
						acceptance_id: id,
						status: "output_exceeded",
						duration_ms: duration,
						exit_code: result.exit_code,
						summary: `verification output exceeded max_output_bytes=${descriptor.max_output_bytes}; process tree closed before cleanup`,
					};
					if (result.spawn_failed) return {
						acceptance_id: id,
						status: "setup_failed",
						duration_ms: duration,
						exit_code: result.exit_code,
						summary: conciseResult(result),
					};
					return {
						acceptance_id: id,
						status: result.exit_code === 0 ? "passed" : "failed",
						duration_ms: duration,
						exit_code: result.exit_code,
						summary: result.exit_code === 0 ? "descriptor passed" : conciseResult(result),
					};
				} catch (error) {
					const setupTimedOut = error instanceof RehearsalSetupTimeoutError;
					const integrityDrift = error instanceof RehearsalIntegrityDriftError
						|| executionController.signal.reason instanceof RehearsalIntegrityDriftError;
					const cancelled = !setupTimedOut && !integrityDrift && executionController.signal.aborted;
					return {
						acceptance_id: id,
						status: setupTimedOut
							? "setup_timed_out"
							: integrityDrift
								? "integrity_drift"
								: cancelled
									? "cancelled"
									: "setup_failed",
						duration_ms: Math.max(0, Math.round(performance.now() - started)),
						exit_code: 1,
						summary: setupTimedOut
							? `isolated-copy setup timed out after ${descriptor.timeout_ms}ms; process tree closed before cleanup`
							: integrityDrift
								? "live integrity drift aborted isolated-copy setup; process tree closed before cleanup"
								: cancelled
									? "descriptor rehearsal cancelled; setup process tree closed before cleanup"
									: (error instanceof Error ? error.message : String(error)).slice(0, REHEARSAL_OUTPUT_SUMMARY_LIMIT),
					};
				} finally {
					rmSync(copy, { recursive: true, force: true });
				}
			});
			const descriptors = await Promise.all(executions);
			clearInterval(integrityMonitor);
			let finalIntegrityBlockers: string[];
			try {
				finalIntegrityBlockers = collectIntegrityBlockers();
			} catch (error) {
				finalIntegrityBlockers = [`final integrity check failed closed: ${error instanceof Error ? error.message : String(error)}`];
			}
			const integrityBlockers = [...new Set([...observedIntegrityBlockers, ...finalIntegrityBlockers])];
			const descriptorBlockers = descriptors
				.filter((result) => result.status !== "passed")
				.map((result) => `${result.acceptance_id}: ${result.status} after ${result.duration_ms}ms - ${result.summary}`);
			const blockers = [...integrityBlockers, ...descriptorBlockers];
			const hasNonWaivableDescriptorFailure = descriptors.some(
				(result) => result.status === "setup_timed_out"
					|| result.status === "cancelled"
					|| result.status === "integrity_drift"
					|| result.status === "output_exceeded"
					|| result.status === "setup_failed",
			);
			return {
				contract: "assurance_kernel/descriptor_rehearsal/v1",
				task_id: taskId,
				index_digest: frozenIndex.digest,
				scope_paths: scopePaths,
				enrollment_ready: blockers.length === 0,
				waiver_allowed: integrityBlockers.length === 0
					&& descriptorBlockers.length > 0
					&& !hasNonWaivableDescriptorFailure,
				writes_performed: false,
				descriptors,
				blockers,
			};
		} finally {
			clearInterval(integrityMonitor);
			options.signal?.removeEventListener("abort", relayExternalAbort);
		}
	} finally {
		rmSync(frozenIndex.directory, { recursive: true, force: true });
	}
}

export function assertDescriptorRehearsalSnapshot(
	root: string,
	receipt: DescriptorRehearsalReceipt,
): void {
	const current = indexDigest(resolve(root));
	if (current !== receipt.index_digest)
		throw new Error(`descriptor rehearsal index drift: expected ${receipt.index_digest}, got ${current}`);
	const blockers = scopeAlignmentBlockers(resolve(root), receipt.scope_paths);
	if (blockers.length > 0) throw new Error(`descriptor rehearsal scope drift: ${blockers.join("; ")}`);
}

export async function runDescriptorRehearsal(
	root: string,
	taskId: string,
	options: { signal?: AbortSignal } = {},
): Promise<DescriptorRehearsalReceipt> {
	const intent = await readTaskIntent(root, taskId);
	const scopePaths = [`docs/plans/${taskId}.intent.json`, ...intent.intent.scope_hint];
	return runDescriptorRehearsalForDescriptors(root, taskId, intent.intent.acceptance, {
		...options,
		scopePaths,
	});
}

export function descriptorRehearsalDigest(receipt: DescriptorRehearsalReceipt): string {
	return `sha256:${createHash("sha256").update(JSON.stringify(receipt)).digest("hex")}`;
}

export function descriptorRehearsalReceiptRef(
	receipt: DescriptorRehearsalReceipt,
	overridden: boolean,
): string {
	return `descriptor-rehearsal/v1:${overridden ? "waived" : "passed"}:${descriptorRehearsalDigest(receipt)}`;
}

export function descriptorRehearsalSummary(receipt: DescriptorRehearsalReceipt): string {
	return receipt.descriptors
		.map((result) => `${result.acceptance_id}: ${result.status} (${result.duration_ms}ms)`)
		.join("\n");
}

const BACKGROUND_ENROLLMENT_CONTEXT = Symbol("background-enrollment-context");
const ENROLLMENT_STATUS_KEY = "imm-canary-enrollment";

interface BackgroundEnrollmentJob {
	controller: AbortController;
	ctx: ExtensionContext;
	command: string;
	committing: boolean;
	completion?: Promise<void>;
}

export class EnrollmentJobCoordinator {
	private readonly jobs = new Map<string, BackgroundEnrollmentJob>();

	start(
		taskId: string,
		command: string,
		ctx: ExtensionContext,
		work: (backgroundCtx: ExtensionContext) => Promise<void>,
	): boolean {
		if (this.jobs.size > 0) {
			const [activeTaskId] = this.jobs.keys();
			ctx.ui.notify(
				`enrollment preflight already running for ${activeTaskId}; cancel it before starting ${taskId}`,
				"warning",
			);
			return false;
		}
		const controller = new AbortController();
		const job: BackgroundEnrollmentJob = { controller, ctx, command, committing: false };
		this.jobs.set(taskId, job);
		ctx.ui.setStatus(ENROLLMENT_STATUS_KEY, `${command} ${taskId}: descriptor rehearsal running`);
		ctx.ui.notify(
			`descriptor rehearsal started in the background for ${taskId}; input remains available; use /${command} cancel ${taskId} to stop it`,
			"info",
		);
		const backgroundCtx = Object.create(ctx) as ExtensionContext;
		Object.defineProperty(backgroundCtx, "signal", { value: controller.signal });
		Object.defineProperty(backgroundCtx, BACKGROUND_ENROLLMENT_CONTEXT, { value: true });
		const completion = work(backgroundCtx)
			.catch((error) => {
				ctx.ui.notify(
					`enrollment preflight failed: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
			})
			.finally(() => {
				if (this.jobs.get(taskId) !== job) return;
				this.jobs.delete(taskId);
				ctx.ui.setStatus(
					ENROLLMENT_STATUS_KEY,
					`${command} ${taskId}: ${controller.signal.aborted ? "cancelled" : "finished"}`,
				);
			});
		job.completion = completion;
		void completion;
		return true;
	}

	markCommitting(taskId: string, ctx: ExtensionContext): boolean {
		const job = this.jobs.get(taskId);
		if (!job) return true;
		if (job.controller.signal.aborted) {
			ctx.ui.notify(`enrollment cancelled before commit for ${taskId}; zero authority writes`, "info");
			return false;
		}
		job.committing = true;
		ctx.ui.setStatus(ENROLLMENT_STATUS_KEY, `${job.command} ${taskId}: committing`);
		return true;
	}

	cancel(taskId: string, ctx: ExtensionContext): void {
		const job = this.jobs.get(taskId);
		if (!job) {
			ctx.ui.notify(`no enrollment preflight is running for ${taskId}`, "warning");
			return;
		}
		if (job.committing) {
			ctx.ui.notify(
				`cancellation rejected for ${taskId}: enrollment commit already owns settlement`,
				"warning",
			);
			return;
		}
		job.controller.abort(new Error("descriptor rehearsal cancelled by user"));
		ctx.ui.setStatus(ENROLLMENT_STATUS_KEY, `${job.command} ${taskId}: cancelling`);
		ctx.ui.notify(`cancelling enrollment preflight for ${taskId}`, "info");
	}

	async shutdown(): Promise<void> {
		const jobs = [...this.jobs.entries()];
		for (const [taskId, job] of jobs) {
			if (job.committing) {
				try {
					job.ctx.ui.setStatus(ENROLLMENT_STATUS_KEY, `${job.command} ${taskId}: shutdown waiting for commit`);
				} catch {
					// Session teardown may already have disposed the UI.
				}
				continue;
			}
			job.controller.abort(new Error("Pi session shutdown"));
			try {
				job.ctx.ui.setStatus(ENROLLMENT_STATUS_KEY, `${job.command} ${taskId}: cancelled`);
			} catch {
				// Session teardown may already have disposed the UI.
			}
		}
		await Promise.allSettled(
			jobs.map(([, job]) => job.completion).filter((value): value is Promise<void> => value !== undefined),
		);
		this.jobs.clear();
	}
}

const enrollmentCoordinators = new WeakMap<ExtensionAPI, EnrollmentJobCoordinator>();

export function enrollmentCoordinatorFor(pi: ExtensionAPI): EnrollmentJobCoordinator {
	const existing = enrollmentCoordinators.get(pi);
	if (existing) return existing;
	const coordinator = new EnrollmentJobCoordinator();
	enrollmentCoordinators.set(pi, coordinator);
	return coordinator;
}

export function isBackgroundEnrollmentContext(ctx: ExtensionContext): boolean {
	return (ctx as ExtensionContext & { [BACKGROUND_ENROLLMENT_CONTEXT]?: boolean })[
		BACKGROUND_ENROLLMENT_CONTEXT
	] === true;
}

export default function (pi: ExtensionAPI) {
	const coordinator = enrollmentCoordinatorFor(pi);
	const handler = async (args: string, ctx: ExtensionContext): Promise<void> => {
			// 1. TUI-only gate before ANY readiness read or prompt.
			if (ctx.mode !== "tui") {
				ctx.ui.notify("imm-canary-enroll is TUI-only and was rejected", "warning");
				return;
			}
			const rawArgs = (args || "").trim();
			const cancelMatch = /^cancel\s+(.+)$/.exec(rawArgs);
			if (cancelMatch) {
				const cancelledTaskId = cancelMatch[1].trim();
				if (!TASK_ID_PATTERN.test(cancelledTaskId)) {
					ctx.ui.notify(`invalid task id: ${cancelledTaskId}`, "error");
					return;
				}
				coordinator.cancel(cancelledTaskId, ctx);
				return;
			}
			const taskId = rawArgs;
			if (!TASK_ID_PATTERN.test(taskId)) {
				ctx.ui.notify(`invalid task id: ${taskId}`, "error");
				return;
			}
			if (
				!isBackgroundEnrollmentContext(ctx) &&
				typeof ctx.ui.setStatus === "function"
			) {
				coordinator.start(taskId, "imm-canary-enroll", ctx, (backgroundCtx) =>
					handler(taskId, backgroundCtx));
				return;
			}

			// Production authority registry: created only here, never exported.
			const registry = await createEnrollmentAuthorityRegistry();

			const now = new Date().toISOString();

			// 2. Read-only preparation (U1). Missing evidence must reject here,
			//    before any confirmation UI.
			let preparation;
			try {
				preparation = await preparePiCanary(ctx.cwd, { task_id: taskId, now });
			} catch (error) {
				ctx.ui.notify(`cannot prepare canary enrollment: ${error instanceof Error ? error.message : String(error)}`, "error");
				return;
			}
			if (!preparation.intent) {
				ctx.ui.notify(
					"enrollment blocked: a Git-tracked TaskIntent is required for Kernel enrollment",
					"error",
				);
				return;
			}

			const waiver = {
				gate: "observation_window_days" as const,
				task_id: taskId,
				reason: "explicit user risk acceptance at enrollment time",
				actor: "user",
				confirmation_ref: `pi-confirm-${createHash("sha256").update(`${taskId}\0${now}`).digest("hex").slice(0, 16)}`,
				expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
				nonce: createHash("sha256").update(`${taskId}\0${now}\0pi`).digest("hex"),
			};

			const eligibility = await evaluateCanaryEligibility({
				task: {
					id: taskId,
					intent_path: preparation.intent?.path ?? `docs/plans/${taskId}.intent.json`,
					intent_revision: preparation.intent?.revision ?? 1,
					intent_content_hash: preparation.intent?.content_hash ?? "",
				},
				now,
			});
			if (!eligibility.eligible) {
				const reasons = [...eligibility.rejections, ...eligibility.unmet_non_waivable].join("; ");
				ctx.ui.notify(`enrollment ineligible: ${reasons}`, "error");
				return;
			}

			// 3. Execute every canonical verification descriptor concurrently in
			//    isolated Git-index copies before asking for authority. This explicit
			//    waiver route may continue after a failed rehearsal, but the failure
			//    and override are displayed in the one literal-user confirmation.
			let descriptorRehearsal: DescriptorRehearsalReceipt;
			try {
				descriptorRehearsal = await runDescriptorRehearsal(ctx.cwd, taskId, { signal: ctx.signal });
			} catch (error) {
				ctx.ui.notify(
					`descriptor rehearsal unavailable: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
				return;
			}
			const rehearsalDecision = decideDescriptorRehearsalRoute(
				descriptorRehearsal,
				"explicit_waiver",
			);
			if (!rehearsalDecision.proceed_to_confirmation) {
				ctx.ui.notify(
					`descriptor rehearsal integrity blocked enrollment and cannot be waived: ${descriptorRehearsal.blockers.join("; ")}`,
					"error",
				);
				return;
			}
			assertDescriptorRehearsalSnapshot(ctx.cwd, descriptorRehearsal);
			const rehearsalOverride = rehearsalDecision.override;
			const rehearsalDigest = descriptorRehearsalDigest(descriptorRehearsal);
			const rehearsalReceiptRef = descriptorRehearsalReceiptRef(
				descriptorRehearsal,
				rehearsalOverride,
			);

			// 4. Exact-task confirmation summary, including per-descriptor timing
			//    and any explicit rehearsal waiver that will enter the receipt.
			const summary = [
				`Task: ${taskId}`,
				`Intent: ${preparation.intent?.path ?? "(missing)"} @ rev ${preparation.intent?.revision ?? "?"}`,
				`Content hash: ${preparation.intent?.content_hash ?? "?"}`,
				`Owners: intent+workspace+claim+record checked`,
				`Descriptor rehearsal (${rehearsalDigest}):`,
				descriptorRehearsalSummary(descriptorRehearsal) || "(no descriptors)",
				...(rehearsalOverride
					? [
						`REHEARSAL WAIVER: enrollment_ready=false`,
						...descriptorRehearsal.blockers.map((blocker) => `- ${blocker}`),
					]
					: [`Rehearsal: enrollment_ready=true`]),
				`Route: Kernel enrollment${rehearsalOverride ? " (explicit descriptor-rehearsal waiver)" : ""}`,
			].join("\n");
			const confirmed = await ctx.ui.confirm("Enroll Kernel canary task?", summary, {
				timeout: 10 * 60 * 1000,
				signal: ctx.signal,
			});
			if (!confirmed) {
				ctx.ui.notify("Enrollment cancelled", "info");
				return;
			}
			ctx.signal?.throwIfAborted();

			// 5. Post-confirm revalidation: every owner must be unchanged since
			//    the preview. Any drift aborts before any write.
			const { unchanged } = await revalidatePiCanary(ctx.cwd, { task_id: taskId, now }, preparation);
			if (!unchanged) {
				ctx.ui.notify("enrollment aborted: workspace changed after confirmation", "error");
				return;
			}
			ctx.signal?.throwIfAborted();
			assertDescriptorRehearsalSnapshot(ctx.cwd, descriptorRehearsal);

			// 6. One-shot capability bound to the exact confirmation and the
			//    descriptor rehearsal receipt (including an explicit override).
			const binding = {
				task_id: taskId,
				intent_path: preparation.intent?.path ?? `docs/plans/${taskId}.intent.json`,
				intent_revision: preparation.intent?.revision ?? 1,
				intent_content_hash: preparation.intent?.content_hash ?? "",
				preparation_digest: preparation.digest,
				// Compatibility mirror fields (never authority after v4).
				readiness_digest: rehearsalReceiptRef,
				evidence_digest: rehearsalReceiptRef,
				waiver_gate: rehearsalOverride ? "descriptor_rehearsal" : waiver.gate,
				actor_id: waiver.actor,
				confirmation_ref: waiver.confirmation_ref,
				expires_at: waiver.expires_at,
				nonce: waiver.nonce,
			};
			const capability = registry.issue(binding);

			const input = {
				task_id: taskId,
				intent_path: binding.intent_path,
				intent_revision: binding.intent_revision,
				preparation_digest: binding.preparation_digest,
				capability,
				capability_binding: binding,
				now,
			};

			// 7. Kernel-owner rehearsal (zero-write) before final enrollment.
			const rehearsal = await runEnrollmentRehearsal(ctx.cwd, input, capability, registry);
			if (!rehearsal.rehearsed || rehearsal.evidence.outcome !== "ready") {
				ctx.ui.notify(
					`enrollment rehearsal failed: ${rehearsal.evidence.blockers.join("; ")}`,
					"error",
				);
				return;
			}

			ctx.signal?.throwIfAborted();
			assertDescriptorRehearsalSnapshot(ctx.cwd, descriptorRehearsal);

			// 8. Atomic enrollment (final-lock revalidation inside enrollCanaryTask).
			//    This is the cancellation linearization point: once committing,
			//    cancellation is rejected and authority settlement proceeds.
			if (!coordinator.markCommitting(taskId, ctx)) return;
			try {
				const result = await enrollCanaryTask(ctx.cwd, input, registry);
				ctx.ui.notify(
					`canary enrolled: task ${result.record.task_id} phase=${result.record.phase} backend=${result.backend_claim.backend} rehearsal=${descriptorRehearsal.enrollment_ready ? "passed" : "waived"} receipt=${rehearsalReceiptRef}`,
					"info",
				);
			} catch (error) {
				ctx.ui.notify(
					`enrollment failed: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
			}
	};
	pi.registerCommand("imm-canary-enroll", {
		description: "Enroll one exact canary task into the Kernel backend after TUI confirmation",
		handler,
	});
	if (typeof pi.on === "function")
		pi.on("session_shutdown", async () => coordinator.shutdown());
}
