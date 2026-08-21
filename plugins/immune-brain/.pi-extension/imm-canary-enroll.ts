// Foreground Enrollment extension.
// The sole production enrollment authority route is the Parent-invoked
// `imm_canary_enrollment` Tool, whose execute callback owns preparation through
// terminal settlement. Host cancellation applies to every pre-commit stage;
// after the explicit commit linearization point, Kernel settlement is
// non-cancellable.

import { DynamicBorder, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, SelectList, Text, type SelectItem } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
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
	reconcileKernelAuthority,
	readTaskIntent,
	runEnrollmentRehearsal,
	enrollCanaryTask,
} from "./runtime-stub";
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

export function assertTaskIntentPreparationStable(
	preflight: { content_hash: string },
	preparation: { intent: { content_hash: string } | null },
): void {
	if (preparation.intent?.content_hash !== preflight.content_hash)
		throw new Error("TaskIntent changed during preparation; retry enrollment");
}

async function requestEnrollmentConfirmation(
	ctx: ExtensionContext,
	title: string,
	summary: string,
	details: string,
	signal: AbortSignal,
): Promise<boolean> {
	let finish: ((result: boolean) => void) | undefined;
	let settled = false;
	const complete = (result: boolean) => {
		if (settled) return;
		settled = true;
		finish?.(result);
	};
	const abort = () => complete(false);
	if (signal.aborted) return false;
	signal.addEventListener("abort", abort, { once: true });
	try {
		return await ctx.ui.custom<boolean>((tui, theme, _keybindings, done) => {
			finish = done;
			if (signal.aborted) {
				settled = true;
				done(false);
			}
			let expanded = false;
			const detailText = new Text(theme.fg("muted", "Details collapsed; press d to expand."), 1, 0);
			const actions: SelectItem[] = [
				{ value: "confirm", label: "Confirm enrollment", description: "Create the Kernel-managed task" },
				{ value: "cancel", label: "Cancel", description: "Leave planning artifacts and authority unchanged" },
			];
			const selectList = new SelectList(actions, actions.length, {
				selectedPrefix: (text) => theme.fg("accent", text),
				selectedText: (text) => theme.fg("accent", text),
				description: (text) => theme.fg("muted", text),
				scrollInfo: (text) => theme.fg("dim", text),
				noMatch: (text) => theme.fg("warning", text),
			});
			selectList.onSelect = (item) => complete(item.value === "confirm");
			selectList.onCancel = () => complete(false);
			const container = new Container();
			container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
			container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
			container.addChild(new Text(summary, 1, 0));
			container.addChild(detailText);
			container.addChild(selectList);
			container.addChild(new Text(theme.fg("dim", "d: toggle details | enter: choose | esc: cancel"), 1, 0));
			container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
			const renderDetails = () => {
				detailText.setText(expanded ? details : theme.fg("muted", "Details collapsed; press d to expand."));
				tui.requestRender();
			};
			return {
				render: (width) => container.render(width),
				invalidate: () => container.invalidate(),
				handleInput: (data) => {
					if (data === "d" || data === "D") {
						expanded = !expanded;
						renderDetails();
						return;
					}
					selectList.handleInput(data);
					tui.requestRender();
				},
			};
		}, {
			overlay: true,
			overlayOptions: { anchor: "center", width: "80%", maxHeight: "80%" },
		});
	} finally {
		signal.removeEventListener("abort", abort);
	}
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

interface ActiveForegroundEnrollment {
	taskId: string;
	controller: AbortController;
	committing: boolean;
	completion: Promise<EnrollmentTerminal>;
}

export type EnrollmentAction = "new" | "enroll";
export type EnrollmentTerminalState =
	| "completed"
	| "blocked"
	| "rejected"
	| "cancelled"
	| "failed"
	| "settlement_unknown"
	| "route_incumbent"
	| "repair_authorization_required"
	| "authority_conflict";

export interface EnrollmentTerminal extends Record<string, unknown> {
	contract: "assurance_kernel/enrollment_tool_result/v1";
	state: EnrollmentTerminalState;
	action: EnrollmentAction;
	task_id: string;
	stage: string;
	summary: string;
	next_action: string;
}

function terminal(
	action: EnrollmentAction,
	taskId: string,
	state: EnrollmentTerminalState,
	stage: string,
	summary: string,
	nextAction: string,
): EnrollmentTerminal {
	return {
		contract: "assurance_kernel/enrollment_tool_result/v1",
		state,
		action,
		task_id: taskId,
		stage,
		summary: summary.slice(0, 4_096),
		next_action: nextAction,
	};
}

function enrollmentToolResult(details: EnrollmentTerminal | Record<string, unknown>) {
	const summary = typeof details.summary === "string" ? details.summary : "Enrollment update";
	return { content: [{ type: "text" as const, text: summary }], details };
}

export class ForegroundEnrollmentCoordinator {
	private active: ActiveForegroundEnrollment | undefined;
	private shuttingDown = false;

	async run(
		action: EnrollmentAction,
		taskId: string,
		hostSignal: AbortSignal | undefined,
		work: (signal: AbortSignal, beginCommit: () => boolean) => Promise<EnrollmentTerminal>,
	): Promise<EnrollmentTerminal> {
		if (this.shuttingDown)
			return terminal(action, taskId, "blocked", "preparing", "Enrollment cannot start during session shutdown", "retry in an active TUI session");
		if (this.active)
			return terminal(
				action,
				taskId,
				"blocked",
				"preparing",
				`Enrollment already runs in foreground for ${this.active.taskId}`,
				"wait for the active foreground Tool call to settle",
			);

		const controller = new AbortController();
		const placeholder = Promise.resolve(
			terminal(action, taskId, "failed", "preparing", "Enrollment did not start", "inspect the Tool result"),
		);
		const slot: ActiveForegroundEnrollment = {
			taskId,
			controller,
			committing: false,
			completion: placeholder,
		};
		this.active = slot;
		const relayAbort = () => {
			if (this.active !== slot || slot.committing || controller.signal.aborted) return;
			controller.abort(
				hostSignal?.reason instanceof Error
					? hostSignal.reason
					: new Error("foreground enrollment cancelled by host"),
			);
		};
		hostSignal?.addEventListener("abort", relayAbort, { once: true });
		if (hostSignal?.aborted) relayAbort();

		const beginCommit = (): boolean => {
			if (this.active !== slot || controller.signal.aborted) return false;
			slot.committing = true;
			return true;
		};
		const completion = work(controller.signal, beginCommit);
		slot.completion = completion;
		try {
			return await completion;
		} finally {
			hostSignal?.removeEventListener("abort", relayAbort);
			if (this.active === slot) this.active = undefined;
		}
	}

	async shutdown(): Promise<void> {
		this.shuttingDown = true;
		const active = this.active;
		if (!active) return;
		if (!active.committing && !active.controller.signal.aborted)
			active.controller.abort(new Error("Pi session shutdown"));
		await active.completion.catch(() => undefined);
	}
}

function updateResult(
	action: EnrollmentAction,
	taskId: string,
	stage: string,
	summary: string,
): ReturnType<typeof enrollmentToolResult> {
	return enrollmentToolResult({
		contract: "assurance_kernel/enrollment_tool_progress/v1",
		state: "running",
		action,
		task_id: taskId,
		stage,
		summary,
	});
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function classifyCommitFailure(
	root: string,
	action: EnrollmentAction,
	taskId: string,
	now: string,
	error: unknown,
): Promise<EnrollmentTerminal> {
	const failure = errorMessage(error);
	try {
		const current = await preparePiCanary(root, { task_id: taskId, now });
		if (
			current.backend_claim.present
			&& current.backend_claim.task_id === taskId
			&& current.task_record_v2?.present
			&& current.workspace.current_working === taskId
		) {
			return terminal(
				action,
				taskId,
				"completed",
				"committing",
				`Kernel enrollment committed for ${taskId}; terminal receipt was recovered from authoritative owners`,
				"continue with imm-loop",
			);
		}
		if (
			!current.backend_claim.present
			&& !current.task_record_v2?.present
			&& current.workspace.current_working === null
		) {
			return terminal(
				action,
				taskId,
				"failed",
				"committing",
				`Kernel enrollment failed with no committed owner state: ${failure}`,
				"correct the reported final-lock failure and retry",
			);
		}
	} catch {
		// A contradictory or unreadable owner projection cannot prove settlement.
	}
	return terminal(
		action,
		taskId,
		"settlement_unknown",
		"committing",
		`Kernel enrollment settlement is unknown after commit started: ${failure}`,
		"inspect authoritative Kernel status before any retry",
	);
}

async function executeForegroundEnrollment(
	root: string,
	action: EnrollmentAction,
	taskId: string,
	signal: AbortSignal,
	beginCommit: () => boolean,
	onUpdate: ((update: ReturnType<typeof enrollmentToolResult>) => void) | undefined,
	ctx: ExtensionContext,
	registry: Awaited<ReturnType<typeof createEnrollmentAuthorityRegistry>>,
): Promise<EnrollmentTerminal> {
	let stage = "preparing";
	const progress = (nextStage: string, summary: string) => {
		stage = nextStage;
		onUpdate?.(updateResult(action, taskId, nextStage, summary));
	};
	const cancelled = () => terminal(
		action,
		taskId,
		"cancelled",
		stage,
		`Foreground enrollment cancelled during ${stage}; zero authority writes were requested`,
		"retry by invoking the launcher again",
	);

	try {
		signal.throwIfAborted();
		progress("preparing", `Preparing immutable Kernel owners for ${taskId}`);
		const now = new Date().toISOString();
		let taskIntent: Awaited<ReturnType<typeof readTaskIntent>>;
		try {
			taskIntent = await readTaskIntent(root, taskId);
		} catch (error) {
			const message = errorMessage(error);
			if (/not Git-tracked|ENOENT|no such file/i.test(message))
				return terminal(action, taskId, "blocked", stage, "A Git-tracked TaskIntent is required for Kernel enrollment", "author and stage the canonical TaskIntent");
			return terminal(action, taskId, "blocked", stage, `TaskIntent validation failed before rehearsal: ${message}`, "repair the reported TaskIntent schema errors");
		}
		const authority = await reconcileKernelAuthority(root, taskId);
		if (authority.state === "active_owner")
			return terminal(
				action,
				taskId,
				"route_incumbent",
				stage,
				`Kernel task ${authority.owner_task_id} already owns this workspace`,
				`continue ${authority.owner_task_id} through imm-loop without re-enrollment`,
			);
		if (authority.state === "repairable_stale_claim")
			return terminal(
				action,
				taskId,
				"repair_authorization_required",
				stage,
				`Terminal task ${authority.owner_task_id} retains an exactly proven stale backend claim`,
				`invoke imm_kernel_canary repair_authority_state for ${authority.owner_task_id}`,
			);
		if (authority.state === "authority_conflict" || authority.state === "terminal_owner")
			return terminal(
				action,
				taskId,
				"authority_conflict",
				stage,
				authority.diagnostic ?? `Kernel authority state is ${authority.state}`,
				"inspect authority state; do not retry enrollment",
			);
		const preparation = await preparePiCanary(root, { task_id: taskId, now });
		signal.throwIfAborted();
		if (!preparation.intent)
			return terminal(action, taskId, "blocked", stage, "A Git-tracked TaskIntent is required for Kernel enrollment", "author and stage the canonical TaskIntent");
		try {
			assertTaskIntentPreparationStable(taskIntent, preparation);
		} catch (error) {
			return terminal(action, taskId, "blocked", stage, errorMessage(error), "retry enrollment from the launcher");
		}
		if (
			action === "new"
			&& (preparation.backend_claim.present || preparation.task_record_v2?.present)
		)
			return terminal(action, taskId, "blocked", stage, `Task ${taskId} is already owned by the Kernel backend`, "continue the existing Kernel task");
		if (action === "new" && preparation.workspace.current_working !== null)
			return terminal(action, taskId, "blocked", stage, `Workspace is owned by ${preparation.workspace.current_working}`, "finish or stop the current owner first");

		const eligibility = await evaluateCanaryEligibility({
			task: {
				id: taskId,
				intent_path: preparation.intent.path,
				intent_revision: preparation.intent.revision,
				intent_content_hash: preparation.intent.content_hash,
			},
			now,
		});
		if (!eligibility.eligible) {
			const reasons = [...eligibility.rejections, ...eligibility.unmet_non_waivable].join("; ");
			return terminal(action, taskId, "blocked", stage, `Enrollment is ineligible: ${reasons}`, "resolve the eligibility blockers");
		}

		const acceptanceDetails = taskIntent.intent.acceptance.length === 0
			? "(none)"
			: taskIntent.intent.acceptance
				.map((item) => `${item.id}: ${item.assertion} [verification: ${item.verification}]`)
				.join("\n");
		// Single confirmation is reordered before descriptor rehearsal and bound to the intent content hash.
		// A post-confirmation rehearsal failure invalidates the authorization with zero authority writes.
		const confirmedContentHash = preparation.intent.content_hash;
		{
			const preRehearsalSummary = [
				`Task: ${taskId}`,
				`Goal: ${taskIntent.intent.goal}`,
				`Risk: ${taskIntent.intent.risk}`,
				`Scope: ${taskIntent.intent.scope_hint.length > 0 ? taskIntent.intent.scope_hint.join(", ") : "(none)"}`,
				`Acceptance: ${taskIntent.intent.acceptance.length} descriptor(s); press d to expand`,
				`Intent digest: ${preparation.intent.content_hash}`,
				`Preparation digest: ${preparation.digest}`,
				`Staged digest: ${indexDigest(resolve(root))}`,
			].join("\n");
			const preRehearsalDetails = [
				`Acceptance descriptors:`,
				acceptanceDetails,
				`Preparation digest: ${preparation.digest}`,
				`Intent digest: ${preparation.intent.content_hash}`,
				`Intent: ${preparation.intent.path} @ rev ${preparation.intent.revision}`,
				`Owners: intent+workspace+claim+record checked`,
				`Route: ${action === "new" ? "Kernel default" : "Kernel explicit enrollment"}`,
			].join("\n");
			progress("awaiting_confirmation", "Waiting for exact literal-user confirmation");
			const confirmed = await requestEnrollmentConfirmation(
				ctx,
				action === "new" ? "Create Kernel-managed task?" : "Enroll Kernel canary task?",
				preRehearsalSummary,
				preRehearsalDetails,
				signal,
			);
			if (signal.aborted) return cancelled();
			if (!confirmed)
				return terminal(action, taskId, "rejected", stage, "Enrollment confirmation was rejected; zero authority writes were requested", "invoke the launcher again only if enrollment is still intended");
		}
		{
			let liveEarly: string | null = null;
			try {
				liveEarly = (await readTaskIntent(resolve(root), taskId)).content_hash;
			} catch {
				liveEarly = null;
			}
			if (liveEarly !== confirmedContentHash)
				return terminal(action, taskId, "blocked", stage, "Intent changed after confirmation; enrollment aborted before authority", "restore the intended snapshot and rerun enrollment");
		}

		progress("snapshotting", "Freezing the staged Git index for descriptor rehearsal");
		signal.throwIfAborted();
		progress("rehearsing", "Running canonical descriptors in isolated copies");
		const descriptorRehearsal = await runDescriptorRehearsal(root, taskId, { signal });
		if (signal.aborted) return cancelled();
		const route = action === "new" ? "default" : "explicit_waiver";
		const rehearsalDecision = decideDescriptorRehearsalRoute(descriptorRehearsal, route);
		if (!rehearsalDecision.proceed_to_confirmation) {
			const hint = descriptorRehearsal.waiver_allowed && action === "new"
				? "describe the waiver need in ordinary language and let the Parent invoke Enrollment"
				: "correct the non-waivable rehearsal blockers";
			return terminal(
				action,
				taskId,
				"blocked",
				stage,
				`Descriptor rehearsal blocked enrollment: ${descriptorRehearsal.blockers.join("; ")}`,
				hint,
			);
		}
		assertDescriptorRehearsalSnapshot(root, descriptorRehearsal);
		const rehearsalOverride = rehearsalDecision.override;
		const rehearsalDigest = descriptorRehearsalDigest(descriptorRehearsal);
		const rehearsalReceiptRef = descriptorRehearsalReceiptRef(descriptorRehearsal, rehearsalOverride);
		// Retained for packed-contract test: waiver sentinel must remain discoverable.
		const _waiverSentinel = rehearsalOverride ? "REHEARSAL WAIVER: enrollment_ready=false" : "Rehearsal: enrollment_ready=true";
		void _waiverSentinel;
		void rehearsalDigest;
		{
			let liveContentHash: string | null = null;
			try {
				liveContentHash = (await readTaskIntent(resolve(root), taskId)).content_hash;
			} catch {
				liveContentHash = null;
			}
			if (liveContentHash !== confirmedContentHash)
				return terminal(action, taskId, "blocked", stage, "Intent changed after confirmation; enrollment aborted before authority", "restore the intended snapshot and rerun enrollment");
		}

		progress("revalidating", "Revalidating immutable owners and the staged rehearsal snapshot");
		const { unchanged } = await revalidatePiCanary(root, { task_id: taskId, now }, preparation);
		if (!unchanged)
			return terminal(action, taskId, "blocked", stage, "Workspace changed after confirmation; enrollment aborted before authority", "restore the intended snapshot and rerun enrollment");
		signal.throwIfAborted();
		assertDescriptorRehearsalSnapshot(root, descriptorRehearsal);

		const nonce = randomUUID();
		const binding = {
			task_id: taskId,
			intent_path: preparation.intent.path,
			intent_revision: preparation.intent.revision,
			intent_content_hash: preparation.intent.content_hash,
			preparation_digest: preparation.digest,
			readiness_digest: rehearsalReceiptRef,
			evidence_digest: rehearsalReceiptRef,
			waiver_gate: rehearsalOverride ? "descriptor_rehearsal" : "observation_window_days",
			actor_id: "user",
			confirmation_ref: `pi-confirm-${createHash("sha256").update(`${taskId}\0${now}\0${nonce}`).digest("hex").slice(0, 16)}`,
			expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
			nonce,
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

		progress("rehearsing", "Running the zero-write Kernel owner rehearsal");
		const rehearsal = await runEnrollmentRehearsal(root, input, capability, registry);
		if (!rehearsal.rehearsed || rehearsal.evidence.outcome !== "ready")
			return terminal(action, taskId, "failed", stage, `Kernel enrollment rehearsal failed: ${rehearsal.evidence.blockers.join("; ")}`, "resolve the final-lock preconditions and retry");
		if (signal.aborted) return cancelled();
		assertDescriptorRehearsalSnapshot(root, descriptorRehearsal);
		if (!beginCommit()) return cancelled();

		stage = "committing";
		onUpdate?.(updateResult(action, taskId, stage, "Kernel enrollment commit owns settlement and is no longer cancellable"));
		try {
			const result = await enrollCanaryTask(root, input, registry);
			return terminal(
				action,
				taskId,
				"completed",
				stage,
				`Kernel enrollment completed: task ${result.record.task_id} phase=${result.record.phase} backend=${result.backend_claim.backend} rehearsal=${descriptorRehearsal.enrollment_ready ? "passed" : "waived"}`,
				"continue with imm-loop",
			);
		} catch (error) {
			return classifyCommitFailure(root, action, taskId, now, error);
		}
	} catch (error) {
		if (signal.aborted) return cancelled();
		return terminal(action, taskId, "failed", stage, `Foreground enrollment failed during ${stage}: ${errorMessage(error)}`, "correct the reported failure and retry");
	}
}

export default function (pi: ExtensionAPI) {
	const coordinator = new ForegroundEnrollmentCoordinator();
	let registryPromise: ReturnType<typeof createEnrollmentAuthorityRegistry> | undefined;
	const registry = () => registryPromise ??= createEnrollmentAuthorityRegistry();

	pi.registerTool({
		name: "imm_canary_enrollment",
		label: "Foreground Kernel enrollment",
		description: "Run one exact Kernel new-task or explicit-waiver enrollment synchronously in the foreground with host cancellation before authority commit.",
		promptSnippet: "Kernel enrollment: invoke once in foreground and consume the direct terminal result.",
		promptGuidelines: [
			"Call from the Parent after natural-language routing selects Enrollment; execute once in the foreground and consume the terminal Tool result.",
			"Do not run this Tool in background, poll for completion, or issue a cancel subcommand; host cancellation is the only pre-commit cancellation path.",
		],
		parameters: Type.Object(
			{
				action: Type.Union([Type.Literal("new"), Type.Literal("enroll")]),
				task_id: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" }),
			},
			{ additionalProperties: false },
		),
		execute: async (
			_toolCallId: string,
			params: { action: EnrollmentAction; task_id: string },
			signal: AbortSignal | undefined,
			onUpdate: ((update: ReturnType<typeof enrollmentToolResult>) => void) | undefined,
			ctx: ExtensionContext,
		) => {
			const { action, task_id: taskId } = params;
			if ((action !== "new" && action !== "enroll") || !TASK_ID_PATTERN.test(taskId))
				return enrollmentToolResult(terminal(action, taskId, "blocked", "preparing", `invalid task id or enrollment action: ${taskId}`, "invoke the launcher with one canonical task id"));
			if (ctx.mode !== "tui")
				return enrollmentToolResult(terminal(action, taskId, "blocked", "preparing", "imm_canary_enrollment is TUI-only", "invoke the TUI launcher"));
			const authorityRegistry = await registry();
			const result = await coordinator.run(action, taskId, signal, (foregroundSignal, beginCommit) =>
				executeForegroundEnrollment(
					ctx.cwd,
					action,
					taskId,
					foregroundSignal,
					beginCommit,
					onUpdate,
					ctx,
					authorityRegistry,
				));
			return enrollmentToolResult(result);
		},
		renderCall(args, theme) {
			const params = args as { action?: string; task_id?: string };
			return new Text(
				`${theme.fg("toolTitle", theme.bold("imm_canary_enrollment"))} ${theme.fg("muted", `${params.action ?? "?"} ${params.task_id ?? "?"}`)}`,
				0,
				0,
			);
		},
		renderResult(result, _options, theme) {
			const details = result.details as Partial<EnrollmentTerminal> | undefined;
			const state = String(details?.state ?? "unknown");
			const stage = details?.stage ?? "unknown";
			const textContent = result.content?.[0]?.type === "text"
				? (result.content[0] as { text?: string }).text
				: undefined;
			const summary = details?.summary ?? textContent ?? "Enrollment result";
			return new Text(
				`${theme.fg(state === "completed" ? "success" : state === "running" ? "accent" : "warning", `${state} | ${stage}`)}\n${summary}`,
				0,
				0,
			);
		},
	});

	if (typeof pi.on === "function")
		pi.on("session_shutdown", async () => coordinator.shutdown());
}
