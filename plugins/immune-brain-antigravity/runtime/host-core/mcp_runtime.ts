// Host-neutral MCP stdio runtime (Issue #414 slice S4, Spec
// docs/specs/host-neutral-adapter-core.spec.md D8). One server, one JSON-RPC
// transport and one per-call workspace resolution serve both Hosts; each adapter
// supplies an `McpHostProfile` and keeps only its profile, entrypoint and hook
// dispatch.
//
// Interface: `createMcpRuntime`, `handleJsonRpc`, `serveStdio`, `runMcpEntry`,
// `McpHostProfile`, `McpRuntimeOptions`, `ServeStdioOptions`, `JsonRpc`, `TOOLS`,
// `listMcpTools`, `MCP_PROTOCOL_VERSION`, `elicitationParams`,
// `supportsElicitationProtocol`, `withCompletionDelivery`.
// Invariants: every Host-specific fact arrives through the profile; this module
// imports no adapter; #429 workspace resolution runs once per tool call.
// Side Effects: the Kernel store and Host private files through the runtime, and
// the stdio streams once `serveStdio` starts.
// Verification: `bun test tests/dual-host-assurance-conformance.test.ts -t 'MCP host profile'`.

import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { stdin, stdout } from "node:process";
import type { Readable, Writable } from "node:stream";
import { PLUGIN_VERSION } from "../plugin_version";
import {
	isPrivilegedOperation,
	NativeAuthorityError,
	privilegedAnnotations,
	type NativeConfirmationInput,
	type NativeConfirmationPort,
} from "./interaction";
import { HostRuntime, type HostRuntimeOptions, type HostRuntimeProfile, type ToolMeta } from "./runtime";
import { batchReason } from "../unattended/batch_reasons";
import { parseLaneInstruction, parseLaneOffers, parseMaxParallel, resolveLaneParallel } from "../unattended/batch_lanes";import { parseFinalVerification } from "../unattended/batch_final_verification";
import type { ExecutorHost } from "../unattended/lane_supervisor";
import type { InitiativeObservationReader } from "../unattended/types";
import type { BatchRunnerKernelPort } from "../unattended/batch_runner";
import type { BatchRunnerGitPort } from "../unattended/batch_git";
import type { AssuranceHostPort } from "../assurance/host_port";
import { deliveryOf, type AssuranceCoordinatorPorts } from "../assurance/coordinator";
import type { VerdictAuthority } from "../assurance/verdict_authority";
import type { SettleCommitResult } from "../assurance/workflow_autocommit";
import { readSettledTaskEvidence } from "../kernel/storage";
import { watchBundleIdentity, type BundleIdentityWatch } from "../plugin_source_skew";
import { parseReworkChoice, reworkExitLines, type ReworkChoice } from "../kernel/assurance_projection";

export const MCP_PROTOCOL_VERSION = "2025-06-18";

/** The two MCP tools whose PreToolUse admission decides the call. */
export type GatedTool = "start_unattended_batch" | "retire_stale_batch";

/** A consumed admission, with the entry token the hook saw and the workspace it was minted for. */
export interface PhaseAdmissionGrant {
	entry_token: string | null;
	workspace: string | null;
}

/** What only a Host knows about its MCP connection; each adapter's composition root supplies one. */
export interface McpHostProfile {
	/** The `serverInfo` this server answers `initialize` with, and the Host floor it reports. */
	readonly serverInfo: { name: string; minimumHostVersion: string };
	/** The Host-adapter contract this server answers `initialize` with. */
	readonly contract: string;
	/** Client names whose `initialize` handshake may bind a trusted host version. */
	readonly trustedClientNames: ReadonlyArray<string>;
	/** The `_meta` key carrying this Host's tool-call id. */
	readonly toolCallIdMetaKey: string;
	/** The refusal when a privileged call carries no tool-call id. */
	readonly correlationMissingRefusal: string;
	/** The refusal when the connected client offers no interactive elicitation. */
	readonly elicitationUnavailableRefusal: string;
	/** The refusal when the Host rejects `elicitation/create`. */
	readonly elicitationRejectedRefusal: string;
	/** The Host probe; the shared runtime never selects one. */
	readonly probeHost: HostRuntimeProfile["probeHost"];
	/** The adapter's AssuranceHostPort, built when the runtime needs its default. */
	readonly createHost: () => AssuranceHostPort & { observe(event: any): void };
	/** Builds this adapter's runtime; the MCP server never names an adapter class. */
	readonly createRuntime: (options: HostRuntimeOptions) => HostRuntime;
	/** Takes the admission the PreToolUse hook wrote for one gated call. */
	readonly consumePhaseAdmission: (toolCallId: string, operation: GatedTool) => boolean | PhaseAdmissionGrant | null;
	/** The Hook session correlated with one gated call in this workspace. */
	readonly readRunToolSession: (toolCallId: string, operation: string, workspace: string) => string | null;
	/** Runs this Host's `--hook` entry. */
	readonly dispatchHook: () => Promise<void>;
	/** This adapter module's own bundle, watched for staleness. */
	readonly bundlePath: string;
}

export const TOOLS = [
	{ name: "status", description: "Read the Kernel Assurance Projection for an exact task.", privileged: false },
	{ name: "advance_assurance", description: "Advance frozen Assurance through deterministic QA and Review reservation.", privileged: false },
	{ name: "submit_review", description: "Submit the Review verdict; omit the verdict to apply the correlated reviewer receipt, or relay the reviewer's structured verdict for fingerprint comparison.", privileged: false },
	{ name: "submit_verification", description: "Submit the reserved verifier result; omit result to use the Host-observed receipt.", privileged: false },
	{ name: "request_authorization", description: "Apply exact literal-user authorization.", privileged: true },
	{ name: "revise_intent", description: "Apply a compatible TaskIntent revision.", privileged: false },
	{ name: "approve_breaking_intent_revision", description: "Approve a breaking TaskIntent revision.", privileged: true },
	{ name: "stop", description: "Stop the active task with literal-user authority.", privileged: true },
	{ name: "start_unattended_batch", description: "Start an unattended Lane batch for an Initiative or a single TaskIntent under the literal-user drive entry.", privileged: true },
	{ name: "retire_stale_batch", description: "Retire an Initiative's parked or drifted batch record to the terminal superseded state under the literal-user drive entry.", privileged: true },
	{ name: "repair_authority_state", description: "Repair a proven recoverable stale backend claim.", privileged: false },
	{ name: "resolve_finding", description: "Resolve one open blocking or advisory finding whose cause is fixed and verified.", privileged: false },
	{ name: "refute_finding", description: "Refute one open finding by binding the fresh passing QA attestation that contradicts it.", privileged: false },
] as const;

export function listMcpTools() {
	return TOOLS.map((tool) => ({
		name: tool.name,
		description: tool.description,
		inputSchema: {
			type: "object",
			properties: {
				...(tool.name === "start_unattended_batch" || tool.name === "retire_stale_batch"
					? {
						initiative_slug: { type: "string" },
						...(tool.name === "start_unattended_batch"
							? {
									task_id: { type: "string" },
									stop: { type: "boolean" },
									executor_host: { type: "string", enum: ["pi", "claude-code", "antigravity"] },
									executor_model: { type: "string", minLength: 1 },
									executor_effort: { type: "string", minLength: 1 },
									max_parallel: { type: "integer", minimum: 1 },
									lane_offers: {
										type: "array",
										items: {
											type: "object",
											properties: { task_id: { type: "string" }, path: { type: "string" } },
											required: ["task_id", "path"],
											additionalProperties: false,
										},
									},
									final_verification: { type: "array", items: { type: "string" }, maxItems: 8 },
									lane_instruction: {
										type: "object",
										properties: {
											task_id: { type: "string" },
											kind: { type: "string", enum: ["instruction", "correction"] },
											text: { type: "string" },
											session_state: { type: "string", enum: ["idle", "working", "blocked", "done"] },
										},
										required: ["task_id", "text", "session_state"],
										additionalProperties: false,
									},
								}
							: {}),
						}
					: {
						task_id: { type: "string" },
						...(tool.name === "approve_breaking_intent_revision" || tool.name === "revise_intent" ? { next_intent: { type: "object" } } : {}),
						...(tool.name === "stop" ? { reason: { type: "string" } } : {}),
						// Spec drive-always-lanes D11: the record revision read in `lane_decision_required`; a Lane that moved since is refused as stale.
						...(tool.name === "request_authorization" || tool.name === "approve_breaking_intent_revision" || tool.name === "stop" ? { record_revision: { type: "string" } } : {}),
						...(tool.name === "submit_review" ? { verdict: { type: "object" } } : {}),
						...(tool.name === "submit_verification" ? { result: { type: "string" } } : {}),
						...(tool.name === "resolve_finding" ? { finding_id: { type: "string" } } : {}),
						...(tool.name === "refute_finding" ? { finding_id: { type: "string" }, attestation_id: { type: "string" } } : {}),
					}),
			},
			required: tool.name === "start_unattended_batch" ? [] : tool.name === "retire_stale_batch"
				? ["initiative_slug"]
				: tool.name === "resolve_finding"
					? ["task_id", "finding_id"]
					: tool.name === "refute_finding"
						? ["task_id", "finding_id", "attestation_id"]
						: tool.name === "revise_intent"
							? ["task_id", "next_intent"]
							: ["task_id"],
		},
		annotations: tool.privileged ? privilegedAnnotations() : { readOnlyHint: tool.name === "status" },
	}));
}

export function supportsElicitationProtocol(value: unknown): boolean {
	return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= MCP_PROTOCOL_VERSION;
}

export interface McpRuntimeOptions {
	cwd?: string;
	env?: Record<string, string | undefined>;
	parentHost?: ExecutorHost;
	/** The Host probe this adapter's composition root chose; defaults to the profile's. */
	probeHost?: McpHostProfile["probeHost"];
	ports?: AssuranceCoordinatorPorts;
	authorityOverrides?: Partial<VerdictAuthority>;
	host?: AssuranceHostPort & { observe(event: any): void };
	interactive?: boolean;
	requestConfirmation?: NativeConfirmationPort;
	batchKernel?: Partial<BatchRunnerKernelPort>;
	batchGit?: BatchRunnerGitPort;
	readInitiative?: InitiativeObservationReader;
	/**
	 * Takes the admission the PreToolUse hook wrote for one
	 * `start_unattended_batch` or `retire_stale_batch` call. Defaults to the
	 * profile's private file store. `true` is an admission without an entry token.
	 */
	consumePhaseAdmission?: (toolCallId: string, operation: GatedTool) => boolean | PhaseAdmissionGrant | null;
	/** The startup identity of this server's own bundle; defaults to the profile's module file. */
	bundleIdentity?: BundleIdentityWatch;
	/** Client names whose `initialize` handshake may bind a trusted host version; defaults to the profile's. */
	trustedClientNames?: ReadonlyArray<string>;
	/** The `serverInfo` this server answers `initialize` with; defaults to the profile's. */
	serverInfo?: { name: string; minimumHostVersion: string };
	/** Queries `roots/list` on a client that advertised the roots capability. */
	rootsProvider?: (signal?: AbortSignal) => Promise<ReadonlyArray<{ uri?: unknown }> | undefined>;
}

/**
 * Content-delivery-authority D7: a completed Task names the scoped content hash
 * its final attestation bound, and reports any auto settle commit. Read from
 * settled evidence after completion, so the shared coordinator result is unchanged.
 */
export function withCompletionDelivery<T>(taskId: string, result: T, root = process.cwd()): T {
	if ((result as { state?: unknown })?.state !== "completed") return result;
	try {
		const record = readSettledTaskEvidence(root, taskId)?.record as { attestations?: Array<{ diff_hash?: unknown }> } | undefined;
		const diffHash = record?.attestations?.at(-1)?.diff_hash;
		const settle = (result as { settle_commit?: SettleCommitResult }).settle_commit;
		return typeof diffHash === "string" ? { ...result, delivery: deliveryOf(diffHash, settle?.committed ? settle.commit : undefined) } : result;
	} catch {
		return result;
	}
}

export function createMcpRuntime(profile: McpHostProfile, options: McpRuntimeOptions = {}) {
	const host = options.host ?? profile.createHost();
	const defaultWorkspace = options.cwd ?? process.cwd();
	const trustedClientNames = options.trustedClientNames ?? profile.trustedClientNames;
	const serverInfo = options.serverInfo ?? profile.serverInfo;
	const runtime = profile.createRuntime({
		cwd: defaultWorkspace,
		env: options.env ?? process.env,
		parentHost: options.parentHost,
		probeHost: options.probeHost,
		host,
		ports: options.ports,
		authorityOverrides: options.authorityOverrides,
		interactive: options.interactive,
		requestConfirmation: options.requestConfirmation,
		batchKernel: options.batchKernel,
		batchGit: options.batchGit,
		readInitiative: options.readInitiative,
	});
	// Trusted Host evidence negotiated on this JSON-RPC connection. Absent
	// handshake evidence means unversioned and non-interactive: fail closed.
	let negotiatedVersion: string | undefined;
	let negotiatedInteractive = false;
	let negotiatedRoots = false;
	// One `roots/list` answer per initialized connection: `undefined` means it
	// was never queried, `null` means it was queried with no usable file root.
	let rootsWorkspace: string | null | undefined;
	let rootsProvider = options.rootsProvider;
	const connectionId = randomUUID();
	/**
	 * Resolve and bind this call's workspace (Spec antigravity-mcp-workspace-resolution
	 * D1): explicit Host `_meta` path, then the MCP roots answer, then this
	 * server's own workspace. Every workspace-scoped helper below reads the
	 * binding, never a value cached from a previous call.
	 */
	const resolveWorkspace = async (meta: Partial<ToolMeta>, signal?: AbortSignal): Promise<string> => {
		let workspace = typeof meta.workspace === "string" && isAbsolute(meta.workspace) ? meta.workspace : undefined;
		if (!workspace && rootsProvider && (negotiatedRoots || options.rootsProvider)) {
			if (rootsWorkspace === undefined) {
				let roots: ReadonlyArray<{ uri?: unknown }> | undefined;
				try {
					roots = await rootsProvider(signal);
				} catch {
					roots = undefined;
				}
				rootsWorkspace = firstFileRootPath(roots) ?? null;
			}
			workspace = rootsWorkspace ?? undefined;
		}
		if (!workspace) workspace = defaultWorkspace;
		runtime.bindWorkspace(workspace);
		return workspace;
	};
	// Spec branch-boundary D3: hooks run every new build in a fresh process, but
	// this long-lived server keeps the bundle it started with. Once that file
	// changes, authority calls refuse with a reconnect action instead of failing
	// later as an unrelated refusal such as run_entry_required.
	const bundle = options.bundleIdentity ?? watchBundleIdentity(profile.bundlePath);
	const staleBundleMessage = () => `this MCP server started from ${bundle.path}, which changed on disk after startup; it still runs the old bundle`;
	const consumeAdmission = options.consumePhaseAdmission ?? ((toolCallId: string, operation: GatedTool) => profile.consumePhaseAdmission(toolCallId, operation));
	// The environment version fallback stays disabled on this connection: these
	// gates judge only a version bound from the trusted handshake, so the probe
	// never reads the environment here. A session without one is refused with
	// the injected probe's own reason.
	const sessionProbe = options.probeHost ?? profile.probeHost;
	const probeNegotiatedHost = (version = negotiatedVersion) => sessionProbe({}, process.platform, version);
	const unversionedHostReason = (): string => {
		const probe = probeNegotiatedHost(undefined);
		return probe.ok ? "host version is unavailable" : probe.reason;
	};
	// The phase entry gate, before any preparation or native dialog. The hook
	// decided on the session's literal entry; no admission for this exact call
	// means no hook saw it, which refuses. ADR 0025: the admission carries the
	// session's entry token, which stands in for the native gate only in the
	// workspace the token was minted for.
	let hookSessionId: string | null = null;
	const requireRunEntry = (operation: GatedTool, toolCallId: string, workspace: string): string | undefined => {
		const correlated = profile.readRunToolSession(toolCallId, operation, workspace);
		if (!options.consumePhaseAdmission && !correlated)
			throw new NativeAuthorityError("run_entry_required", "A gated call needs exact Hook session and workspace correlation");
		const grant = consumeAdmission(toolCallId, operation);
		if (!grant) throw new NativeAuthorityError("run_entry_required", `${operation} needs a literal-user drive entry in this session`);
		hookSessionId = correlated ?? hookSessionId;
		if (grant === true || !grant.entry_token) return undefined;
		let current: string | null = null;
		try { current = realpathSync(workspace); } catch { /* an unresolvable workspace refuses */ }
		if (!current || grant.workspace !== current)
			throw new NativeAuthorityError("run_entry_required", `${operation} runs in a workspace other than the one drive was entered in`);
		return grant.entry_token;
	};
	const refuseSuppliedAuthority = (args: Record<string, unknown>) => {
		if ("native_decision" in args) throw new Error("native_decision cannot be supplied in tool arguments");
		if ("entry_token" in args) throw new Error("entry_token cannot be supplied in tool arguments");
	};
	return {
		profile,
		runtime,
		host,
		connectionId,
		listTools: listMcpTools,
		trustedClientNames,
		serverInfo,
		bindClientHandshake(identity: { version: string; interactive: boolean; protocolVersion?: string; roots?: boolean }) {
			negotiatedVersion = identity.version || undefined;
			negotiatedInteractive = identity.interactive && supportsElicitationProtocol(identity.protocolVersion);
			negotiatedRoots = identity.roots === true;
			// A re-initialize re-negotiates the connection: a cached root answer no longer applies.
			rootsWorkspace = undefined;
			runtime.bindHostVersion(negotiatedVersion);
		},
		bindRootsProvider(provider: NonNullable<McpRuntimeOptions["rootsProvider"]>) {
			rootsProvider = provider;
		},
		/** `notifications/roots/list_changed`: the next call queries `roots/list` again. */
		clearRootsWorkspace() {
			rootsWorkspace = undefined;
		},
		bindNativeConfirmation(port: NativeConfirmationPort) {
			runtime.bindNativeConfirmation(port);
		},
		sessionInteractive: () => negotiatedInteractive,
		async callTool(name: string, args: Record<string, unknown>, meta: Partial<ToolMeta> = {}) {
			const workspace = await resolveWorkspace(meta, meta.signal);
			if (name !== "status" && bundle.stale()) throw new NativeAuthorityError("plugin_bundle_stale", staleBundleMessage());
			const observedSession = profile.readRunToolSession(meta.toolCallId ?? `call-${name}`, name, workspace);
			if (observedSession) hookSessionId = observedSession;
			if (name === "start_unattended_batch") {
				if (Object.hasOwn(args, "lane_revision")) throw new Error("unknown parameter: lane_revision");
				const initiative = typeof args.initiative_slug === "string" ? args.initiative_slug : "";
				const task = typeof args.task_id === "string" ? args.task_id : "";
				if (args.stop !== undefined && typeof args.stop !== "boolean") throw new Error("stop must be a boolean");
				if (args.executor_host !== undefined && args.executor_host !== "pi" && args.executor_host !== "claude-code" && args.executor_host !== "antigravity") throw new Error("invalid executor_host");
				for (const key of ["executor_model", "executor_effort"]) if (args[key] !== undefined && (typeof args[key] !== "string" || !args[key])) throw new Error(`invalid ${key}`);
				if (!!initiative === !!task) return batchReason("batch_entry_ambiguous");
				const initiativeSlug = task || initiative;
				refuseSuppliedAuthority(args);
				if (!negotiatedVersion) throw new NativeAuthorityError("unsupported_host", unversionedHostReason());
				if (!negotiatedInteractive) {
					throw new NativeAuthorityError("unsupported_host", profile.elicitationUnavailableRefusal);
				}
				const probe = probeNegotiatedHost();
				if (!probe.ok) throw new NativeAuthorityError("unsupported_host", probe.reason);
				const entryToken = requireRunEntry(name, meta.toolCallId ?? `call-${name}`, workspace);
				const toolMeta: ToolMeta = {
					sessionId: hookSessionId ?? meta.sessionId ?? connectionId,
					toolCallId: meta.toolCallId ?? `call-${name}`,
					taskId: initiativeSlug,
					initiativeSlug,
					...(entryToken ? { entryToken } : {}),
					interactive: meta.interactive ?? options.interactive ?? negotiatedInteractive,
					signal: meta.signal,
				};
				const laneOffers = parseLaneOffers(args.lane_offers);
				// A lane_offers-only call resumes the recorded lane batch; refused before any gate otherwise.
				const laneInstruction = parseLaneInstruction(args.lane_instruction);
				const maxParallel = task ? 1 : resolveLaneParallel(workspace, initiativeSlug, parseMaxParallel(args.max_parallel), laneOffers, laneInstruction);
				const finalVerification = Array.isArray(args.final_verification) && args.final_verification.length === 0 ? undefined : parseFinalVerification(args.final_verification);
				return runtime.startUnattendedBatch(initiativeSlug, toolMeta, {
					...(task ? { plan_source: "single_task" as const } : {}),
					...(args.stop === true ? { stop: true } : {}),
					executor: {
						...(args.executor_host === "pi" || args.executor_host === "claude-code" || args.executor_host === "antigravity" ? { executor_host: args.executor_host } : {}),
						...(typeof args.executor_model === "string" ? { executor_model: args.executor_model } : {}),
						...(typeof args.executor_effort === "string" ? { executor_effort: args.executor_effort } : {}),
					},
					...(maxParallel !== undefined ? { max_parallel: maxParallel } : {}),
					...(laneOffers !== undefined ? { lane_offers: laneOffers } : {}),
					...(finalVerification !== undefined ? { final_verification: finalVerification } : {}),
					...(laneInstruction !== undefined ? { lane_instruction: laneInstruction } : {}),
				});
			}
			if (name === "retire_stale_batch") {
				const initiativeSlug = String(args.initiative_slug ?? "");
				if (!initiativeSlug) throw new Error("initiative_slug is required");
				refuseSuppliedAuthority(args);
				if (!negotiatedVersion) throw new NativeAuthorityError("unsupported_host", unversionedHostReason());
				if (!negotiatedInteractive) {
					throw new NativeAuthorityError("unsupported_host", profile.elicitationUnavailableRefusal);
				}
				const probe = probeNegotiatedHost();
				if (!probe.ok) throw new NativeAuthorityError("unsupported_host", probe.reason);
				const entryToken = requireRunEntry(name, meta.toolCallId ?? `call-${name}`, workspace);
				const toolMeta: ToolMeta = {
					sessionId: hookSessionId ?? meta.sessionId ?? connectionId,
					toolCallId: meta.toolCallId ?? `call-${name}`,
					taskId: initiativeSlug,
					initiativeSlug,
					...(entryToken ? { entryToken } : {}),
					interactive: meta.interactive ?? options.interactive ?? negotiatedInteractive,
					signal: meta.signal,
				};
				return runtime.retireStaleBatch(initiativeSlug, toolMeta);
			}
			const taskId = String(args.task_id ?? "");
			if (!taskId) throw new Error("task_id is required");
			refuseSuppliedAuthority(args);
			// Read-only status must stay usable without trusted Host evidence, so it
			// is dispatched before the capability probe rejects unversioned hosts.
			if (name === "status") {
				const result = { plugin_version: PLUGIN_VERSION, ...(await runtime.status(taskId)), loaded_bundle: { path: bundle.path, sha256_prefix: bundle.sha256?.slice(0, 12) ?? null } } as Record<string, unknown>;
				if (!bundle.stale()) return result;
				const warnings = Array.isArray(result.warnings) ? result.warnings : [];
				return { ...result, warnings: [...warnings, { code: "plugin_bundle_stale", paths: [bundle.path], message: `${staleBundleMessage()}; authority calls refuse until the immune-brain MCP server is reconnected` }] };
			}
			// The environment version fallback is disabled on this connection:
			// only a version bound from the trusted initialize handshake may
			// reach authority-mutating tools.
			if (!negotiatedVersion) throw new NativeAuthorityError("unsupported_host", unversionedHostReason());
			// Automatic stale-claim repair is deterministic and needs no native
			// interaction; other mutations retain the Host capability requirement.
			if (!negotiatedInteractive && name !== "repair_authority_state") {
				throw new NativeAuthorityError("unsupported_host", profile.elicitationUnavailableRefusal);
			}
			const probe = probeNegotiatedHost();
			if (!probe.ok) throw new NativeAuthorityError("unsupported_host", probe.reason);
			const toolMeta: ToolMeta = {
				sessionId: hookSessionId ?? meta.sessionId ?? connectionId,
				toolCallId: meta.toolCallId ?? `call-${name}`,
				taskId,
				interactive: meta.interactive ?? options.interactive ?? negotiatedInteractive,
				signal: meta.signal,
			};
			if (name === "advance_assurance") return withCompletionDelivery(taskId, await runtime.advance(taskId, toolMeta.signal, toolMeta), workspace);
			if (name === "submit_review") {
				// ADR 0017: an absent verdict is the receipt-bound submission.
				return withCompletionDelivery(taskId, await runtime.submitReview(taskId, Object.hasOwn(args, "verdict") ? args.verdict : undefined, toolMeta), workspace);
			}
			if (name === "submit_verification") {
				if (args.result !== undefined && typeof args.result !== "string") throw new Error("result must be a string");
				return withCompletionDelivery(taskId, await runtime.submitVerification(taskId, args.result as string | undefined, toolMeta), workspace);
			}
			if (name === "revise_intent") {
				if (!Object.hasOwn(args, "next_intent")) throw new Error("next_intent is required");
				return runtime.reviseIntent(taskId, args.next_intent);
			}
			if (name === "resolve_finding") {
				// Structural only. Which findings may be resolved, and when, stays
				// the reducer's decision; duplicating it here would create a second
				// authority that could drift from the Kernel.
				if (typeof args.finding_id !== "string" || !args.finding_id) throw new Error("finding_id is required");
				return runtime.resolveFinding(taskId, args.finding_id);
			}
			if (name === "refute_finding") {
				// Structural only, exactly like resolve_finding: the reducer owns
				// which findings may be refuted and with which evidence.
				if (typeof args.finding_id !== "string" || !args.finding_id) throw new Error("finding_id is required");
				if (typeof args.attestation_id !== "string" || !args.attestation_id) throw new Error("attestation_id is required");
				return runtime.refuteFinding(taskId, args.finding_id, args.attestation_id);
			}
			if (name === "request_authorization" || name === "approve_breaking_intent_revision" || name === "stop" || name === "repair_authority_state") {
				return runtime.authorize(taskId, name, toolMeta, args);
			}
			throw new Error(`unknown tool ${name}`);
		},
		observe: (event: unknown) => host.observe(event),
		shutdown: () => runtime.shutdown(),
		aborts: new Map<string | number, AbortController>(),
	};
}

export interface JsonRpc {
	jsonrpc: "2.0";
	id?: string | number | null;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: { code: number; message: string; data?: Record<string, unknown> };
}

function hostCallIdentity(meta: Record<string, unknown> | undefined, key: string): { toolCallId: string } | undefined {
	if (!meta) return undefined;
	const toolCallId = meta[key];
	return typeof toolCallId === "string" && toolCallId ? { toolCallId } : undefined;
}

/**
 * The workspace Antigravity names on every `tools/call` (E2). A relative, empty
 * or non-string entry is not a workspace and never binds.
 */
function metaWorkspacePath(meta: Record<string, unknown> | undefined): string | undefined {
	const paths = meta?.["antigravity.google/workspace_paths"];
	if (!Array.isArray(paths) || typeof paths[0] !== "string") return undefined;
	const first = paths[0].trim();
	return first && isAbsolute(first) ? first : undefined;
}

/** The first `roots/list` root that is a usable local directory URI. */
function firstFileRootPath(roots: ReadonlyArray<{ uri?: unknown }> | undefined): string | undefined {
	for (const root of roots ?? []) {
		const uri = root?.uri;
		if (typeof uri !== "string" || !uri.startsWith("file://")) continue;
		try {
			const path = fileURLToPath(uri);
			if (isAbsolute(path)) return path;
		} catch {
			// A URI that is not a local file path is not a workspace.
		}
	}
	return undefined;
}

function rpcError(error: unknown): { code: number; message: string; data?: Record<string, unknown> } {
	if (error instanceof NativeAuthorityError) {
		return {
			code: -32000,
			message: error.message,
			data: { reason_code: error.reasonCode, recovery_action: error.recoveryAction },
		};
	}
	return { code: -32000, message: error instanceof Error ? error.message : String(error) };
}

function encodeMessage(message: JsonRpc): Buffer {
	return Buffer.from(`${JSON.stringify(message)}\n`);
}

/** One connected MCP server: the shared transport plus this Host's profile and runtime. */
export type McpRuntime = ReturnType<typeof createMcpRuntime>;

export async function handleJsonRpc(message: JsonRpc, mcp: McpRuntime): Promise<JsonRpc | null> {
	if (message.method === "initialize") {
		const params = (message.params ?? {}) as {
			protocolVersion?: unknown;
			clientInfo?: { name?: unknown; version?: unknown };
			capabilities?: Record<string, unknown>;
		};
		// Trust binds to the trusted client identity for this server: name,
		// parseable version at the floor, plus the negotiated capabilities. Any
		// other client name stays unversioned and non-interactive; read-only status
		// remains usable.
		const trustedClient = mcp.trustedClientNames.includes(String(params.clientInfo?.name ?? ""));
		const elicitation = params.capabilities?.elicitation;
		const roots = params.capabilities?.roots;
		mcp.bindClientHandshake({
			version: trustedClient && typeof params.clientInfo?.version === "string" ? params.clientInfo.version : "",
			protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : undefined,
			interactive: trustedClient && elicitation !== null && typeof elicitation === "object" && !Array.isArray(elicitation),
			roots: trustedClient && roots !== null && typeof roots === "object" && !Array.isArray(roots),
		});
		return {
			jsonrpc: "2.0",
			id: message.id ?? null,
			result: {
				protocolVersion: MCP_PROTOCOL_VERSION,
					serverInfo: {
						name: mcp.serverInfo.name,
						version: PLUGIN_VERSION,
						contract: mcp.profile.contract,
						minimumHostVersion: mcp.serverInfo.minimumHostVersion,
					},
				capabilities: { tools: {} },
			},
		};
	}
	if (message.method === "notifications/initialized") return null;
	// The client's root list moved: the next call queries `roots/list` again.
	if (message.method === "notifications/roots/list_changed") {
		mcp.clearRootsWorkspace();
		return null;
	}
	if (message.method === "notifications/cancelled") {
		const requestId = (message.params as { requestId?: string | number } | undefined)?.requestId;
		if (requestId !== undefined) mcp.aborts.get(requestId)?.abort(new Error("notifications/cancelled"));
		return null;
	}
	if (message.method === "tools/list") {
		return { jsonrpc: "2.0", id: message.id ?? null, result: { tools: mcp.listTools() } };
	}
	if (message.method === "tools/call") {
		const params = (message.params ?? {}) as { name?: string; arguments?: Record<string, unknown>; _meta?: Record<string, unknown> };
		const requestId = message.id ?? `anon-${Date.now()}`;
		const ac = new AbortController();
		mcp.aborts.set(requestId, ac);
		try {
			const name = String(params.name ?? "");
			const interactive = mcp.sessionInteractive();
			if (isPrivilegedOperation(name) && !interactive) {
				throw new NativeAuthorityError("unsupported_host", mcp.profile.elicitationUnavailableRefusal);
			}
			const identity = hostCallIdentity(params._meta, mcp.profile.toolCallIdMetaKey);
			if (isPrivilegedOperation(name) && !identity) {
				throw new NativeAuthorityError("correlation_missing", mcp.profile.correlationMissingRefusal);
			}
			const sessionId = mcp.connectionId;
			const toolCallId = identity?.toolCallId ?? String(message.id ?? "stdio");
			const result = await mcp.callTool(name, params.arguments ?? {}, {
				sessionId,
				toolCallId,
				workspace: metaWorkspacePath(params._meta),
				interactive,
				requiresUserInteraction: isPrivilegedOperation(name),
				signal: ac.signal,
			});
			return {
				jsonrpc: "2.0",
				id: message.id ?? null,
				result: { content: [{ type: "text", text: JSON.stringify(result) }] },
			};
		} catch (error) {
			return {
				jsonrpc: "2.0",
				id: message.id ?? null,
				error: rpcError(error),
			};
		} finally {
			mcp.aborts.delete(requestId);
		}
	}
	if (message.id === undefined) return null;
	return { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `unknown method ${message.method}` } };
}

async function writeReply(output: Writable, reply: JsonRpc): Promise<void> {
	const payload = encodeMessage(reply);
	await new Promise<void>((resolve, reject) => {
		if (!output.writable) {
			reject(new Error("output stream is not writable"));
			return;
		}
		let settled = false;
		const cleanup = () => {
			output.off("drain", onDrain);
			output.off("error", onError);
			output.off("close", onClose);
		};
		const onDrain = () => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve();
		};
		const onError = (error: Error) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(error);
		};
		const onClose = () => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(new Error("output stream closed before write drained"));
		};
		output.once("error", onError);
		output.once("close", onClose);
		const ok = output.write(payload, (error) => {
			if (settled) return;
			if (error) {
				settled = true;
				cleanup();
				reject(error);
			}
		});
		if (ok) {
			settled = true;
			cleanup();
			resolve();
			return;
		}
		output.once("drain", onDrain);
	});
}

export function elicitationParams(input: NativeConfirmationInput) {
	if (input.operation === "retire_stale_batch") {
		const d = input.batchDisposition;
		const details = [
			`Operation: retire_stale_batch`,
			`Initiative: ${input.initiativeSlug}`,
			d ? `Batch: ${d.batch_id}` : null,
			d ? `Batch state: ${d.batch_state}` : null,
			d ? `Batch branch: ${d.batch_branch}` : null,
			d ? `Plan digest: ${d.plan_digest}` : null,
			d ? `Recorded child commits: ${d.recorded_commits}` : null,
			d
				? `Children (${d.children.length}):\n${d.children
						.map(
							(child) =>
								`  - ${child.task_id} (${child.slice_id}) [state: ${child.state}]${child.commit ? ` [commit: ${child.commit}]` : " [no commit]"}${child.lane_branch ? ` [lane: ${child.lane_branch}]` : ""}${child.kernel_lifecycle ? ` [Kernel run: ${child.kernel_lifecycle}]` : ""}`,
						)
						.join("\n")}`
				: null,
			"Retiring writes this record to the terminal superseded state. Child states, recorded commits and the batch branch are preserved as evidence; nothing is deleted and no batch trailer or approval is manufactured.",
			"A child without a commit was never executed by this batch: it carries no delivery evidence, and the retired authorization is never reused for a revised plan.",
			"After retiring, run each remaining child with drive under its own authorization, or start a new batch for this Initiative.",
		].filter(Boolean);
		return {
			mode: "form",
			message: `Retire this stale batch record for ${input.initiativeSlug}?\n\n${details.join("\n")}`,
			requestedSchema: { type: "object", properties: {} },
		};
	}
	if (input.operation === "start_unattended_batch") {
		const b = input.batchDetails;
		if (b?.parent_final_verification) {
			const lines = [
				`Operation: start_unattended_batch (native Parent final verification; no batch run is started)`,
				`Initiative: ${input.initiativeSlug ?? b.initiative_slug}`,
				input.planDigest ? `Plan digest: ${input.planDigest}` : null,
				`Parent Tasks (${b.children.length}):\n${b.children.map((c) => `  - ${c.task_id} (${c.slice_id})`).join("\n")}`,
				`Final verification commands run in this workspace outside Host permission:\n${(b.final_verification ?? []).map((command) => `  - ${command}`).join("\n")}`,
			].filter(Boolean);
			return {
				mode: "form",
				message: `Authorize this Parent final verification for ${input.initiativeSlug}?\n\n${lines.join("\n")}`,
				requestedSchema: { type: "object", properties: {} },
			};
		}
		const details = [
			`Operation: start_unattended_batch`,
			`Initiative: ${input.initiativeSlug ?? b?.initiative_slug}`,
			b?.batch_branch ? `Batch branch: ${b.batch_branch}` : null,
			input.planDigest ? `Plan digest: ${input.planDigest}` : null,
			input.intentRevision !== undefined ? `TaskIntent revision: ${input.intentRevision}` : null,
			input.intentContentHash ? `TaskIntent content hash: ${input.intentContentHash}` : null,
			input.bindingDigest ? `Preparation digest: ${input.bindingDigest}` : null,
			b?.children ? `Ordered children (${b.children.length}):\n${b.children.map((c) => `  - ${c.task_id} (${c.slice_id}) [risk: ${c.risk ?? "unknown"}]`).join("\n")}` : null,
			b?.excluded && b.excluded.length > 0 ? `Excluded children (${b.excluded.length}):\n${b.excluded.map((e) => `  - ${e.task_id} (${e.slice_id}): ${e.reason}`).join("\n")}` : null,
			b?.budget ? `Budget: max_children=${b.budget.max_children}, qa_failure_limit=${b.budget.qa_failure_limit}` : null,
			b?.lane_mode ? `Lane mode: max_parallel=${b.lane_mode.max_parallel}` : null,
			b?.lane_mode ? `Parallel groups (${b.lane_mode.parallel_groups.length}):\n${b.lane_mode.parallel_groups.map((group) => `  - ${group.join(", ")}`).join("\n")}` : null,
			b?.lane_mode && b.lane_mode.serialized.length > 0 ? `Serialized by overlapping scope (${b.lane_mode.serialized.length}):\n${b.lane_mode.serialized.map((c) => `  - ${c.task_id} after ${c.overlaps_with.join(", ")}`).join("\n")}` : null,
			b?.final_verification ? `Final verification: ${b.final_verification.join("; ")}` : null,
		].filter(Boolean);
		return {
			mode: "form",
			message: `Authorize this unattended batch run for ${input.initiativeSlug}?\n\n${details.join("\n")}`,
			requestedSchema: { type: "object", properties: {} },
		};
	}
	if (input.verifierDispute) {
		const dispute = input.verifierDispute;
		return { mode: "form", message: `Resolve this Review verifier dispute for ${input.taskId}.\n\nClaim: ${dispute.claim}\nTrigger: ${dispute.trigger}\nCaller chain: ${dispute.caller_chain.join(" → ")}\nCounter-path: ${dispute.counter_path}`,
			requestedSchema: { type: "object", properties: { choice: { type: "string", title: "Decision", enum: ["accept_verifier_dispute", "dismiss_verifier_dispute"] } }, required: ["choice"] } };
	}
	if (input.reworkExits) {
		const exits = input.reworkExits;
		const exitValues = [
			"grant_rounds",
			...(exits.accept_residual_risk ? ["accept_residual_risk"] : []),
			"replan",
		];
		return {
			mode: "form",
			message: `Choose how to resolve this replan boundary for ${input.taskId}.\n\n${[
				`Operation: ${input.operation}`,
				`Task: ${input.taskId}`,
				input.risk ? `Risk: ${input.risk}` : null,
				input.bindingDigest ? `Binding digest: ${input.bindingDigest}` : null,
				...reworkExitLines(exits),
			].filter(Boolean).join("\n")}`,
			requestedSchema: {
				type: "object",
				properties: {
					exit: { type: "string", title: "Exit", enum: exitValues, default: "grant_rounds" },
					rounds: {
						type: "integer",
						title: "Further Review rounds (grant_rounds)",
						minimum: exits.grant_rounds.min,
						maximum: exits.grant_rounds.max,
						default: exits.grant_rounds.min,
					},
					...(exits.accept_residual_risk
						? { reason: { type: "string", title: "Reason for accepting residual risk (accept_residual_risk)" } }
						: {}),
				},
				required: ["exit"],
			},
		};
	}
	const details = [
		`Operation: ${input.operation}`,
		`Task: ${input.taskId}`,
		input.risk ? `Risk: ${input.risk}` : null,
		input.intentRevision !== undefined ? `Intent revision: ${input.intentRevision}` : null,
		input.intentContentHash ? `Intent hash: ${input.intentContentHash}` : null,
		input.bindingDigest ? `Binding digest: ${input.bindingDigest}` : null,
		input.gitBaseNotice,
		input.reviewRetryNotice,
	].filter(Boolean);
	return {
		mode: "form",
		message: `Authorize this exact Immune-Brain operation?\n\n${details.join("\n")}`,
		requestedSchema: { type: "object", properties: {} },
	};
}

export interface ServeStdioOptions extends McpRuntimeOptions {
	input?: Readable;
	output?: Writable;
	runtime?: McpRuntime;
	exit?: (code: number) => void;
}

export async function serveStdio(profile: McpHostProfile, options: ServeStdioOptions = {}): Promise<void> {
	const { input = stdin, output = stdout, runtime, exit = (code: number) => { process.exit(code); }, ...runtimeOptions } = options;
	const mcp = runtime ?? createMcpRuntime(profile, { cwd: process.cwd(), ...runtimeOptions });
	let buffer = Buffer.alloc(0);
	let accepting = true;
	let requestSequence = 0;
	const inFlight = new Set<Promise<void>>();
	const pending = new Map<string, {
		resolve: (response: JsonRpc) => void;
		reject: (error: Error) => void;
	}>();
	let chain = Promise.resolve();
	// One `tools/call` at a time: `callTool` binds the workspace it resolved on the
	// shared runtime, so an interleaved call would move that binding mid-call.
	// Native interactions still settle through `pending` on the input stream, which
	// is why a call is not awaited inline here.
	let callChain: Promise<void> = Promise.resolve();

	const rejectPending = (error: Error): void => {
		for (const item of pending.values()) item.reject(error);
		pending.clear();
	};

	mcp.bindNativeConfirmation(async (input) => {
		if (!accepting) throw new NativeAuthorityError("interaction_not_opened", "MCP connection is closed");
		if (input.signal?.aborted) throw new NativeAuthorityError("user_cancelled", "Tool call was cancelled");
		const requestId = `immune-brain:elicitation:${mcp.connectionId}:${++requestSequence}`;
		let abortListener: (() => void) | undefined;
		const response = new Promise<JsonRpc>((resolve, reject) => {
			pending.set(requestId, { resolve, reject });
			abortListener = () => {
				pending.delete(requestId);
				reject(new NativeAuthorityError("user_cancelled", "Tool call was cancelled"));
			};
			input.signal?.addEventListener("abort", abortListener, { once: true });
		});
		try {
			await writeReply(output, {
				jsonrpc: "2.0",
				id: requestId,
				method: "elicitation/create",
				params: elicitationParams(input),
			});
			const reply = await response;
			if (reply.error) {
				if (reply.error.code === -32601) {
					throw new NativeAuthorityError("unsupported_host", profile.elicitationRejectedRefusal);
				}
				throw new NativeAuthorityError("correlation_missing", `MCP elicitation failed: ${reply.error.message}`);
			}
			const result = reply.result;
			const action = typeof result === "object" && result !== null && !Array.isArray(result)
				? (result as { action?: unknown }).action
				: undefined;
			if (action !== "accept" && action !== "decline" && action !== "cancel") {
				throw new NativeAuthorityError("correlation_missing", "MCP elicitation returned an invalid action");
			}
			let reworkChoice: ReworkChoice | undefined;
			let verifierChoice: "accept_verifier_dispute" | "dismiss_verifier_dispute" | undefined;
			if (action === "accept" && input.verifierDispute) {
				const content = (result as { content?: unknown }).content;
				if (!content || typeof content !== "object" || Array.isArray(content)
					|| Object.keys(content).length !== 1 || !["accept_verifier_dispute", "dismiss_verifier_dispute"].includes(String((content as { choice?: unknown }).choice)))
					throw new NativeAuthorityError("correlation_missing", "MCP elicitation accept content did not match the verifier dispute schema");
				verifierChoice = (content as { choice: "accept_verifier_dispute" | "dismiss_verifier_dispute" }).choice;
			} else if (action === "accept" && input.reworkExits) {
				const parsed = parseReworkChoice(input.reworkExits, (result as { content?: unknown }).content);
				if (!parsed) {
					throw new NativeAuthorityError("correlation_missing", "MCP elicitation accept content did not match the requested exit schema");
				}
				reworkChoice = parsed;
			} else if (action === "accept") {
				const content = (result as { content?: unknown }).content;
				const keys = typeof content === "object" && content !== null && !Array.isArray(content) ? Object.keys(content) : null;
				const valid = keys !== null && keys.length === 0;
				if (!valid) {
					throw new NativeAuthorityError("correlation_missing", "MCP elicitation accept content did not match the requested schema");
				}
			}
			return {
				decision: action,
				requestId,
				...(reworkChoice ? { reworkChoice } : {}),
				...(verifierChoice ? { verifierChoice } : {}),
			};
		} finally {
			pending.delete(requestId);
			if (abortListener) input.signal?.removeEventListener("abort", abortListener);
		}
	});

	// The shared transport is bidirectional, so `roots/list` uses the same
	// pending-request map as `elicitation/create`. A client that answers with an
	// error or without usable roots leaves the workspace to the next fallback.
	mcp.bindRootsProvider(async (signal) => {
		if (!accepting) return undefined;
		const requestId = `immune-brain:roots:${mcp.connectionId}:${++requestSequence}`;
		let abortListener: (() => void) | undefined;
		const response = new Promise<JsonRpc>((resolve, reject) => {
			pending.set(requestId, { resolve, reject });
			abortListener = () => {
				pending.delete(requestId);
				reject(new NativeAuthorityError("user_cancelled", "Tool call was cancelled"));
			};
			signal?.addEventListener("abort", abortListener, { once: true });
		});
		try {
			await writeReply(output, { jsonrpc: "2.0", id: requestId, method: "roots/list", params: {} });
			const reply = await response;
			const roots = reply.error ? undefined : (reply.result as { roots?: unknown } | undefined)?.roots;
			return Array.isArray(roots) ? (roots as Array<{ uri?: unknown }>) : undefined;
		} catch {
			return undefined;
		} finally {
			pending.delete(requestId);
			if (abortListener) signal?.removeEventListener("abort", abortListener);
		}
	});

	const runCall = (parsed: JsonRpc): void => {
		const task = callChain.then(() => handleJsonRpc(parsed, mcp)).then(async (reply) => {
			if (reply) await writeReply(output, reply);
		}).catch(() => {
			void executeShutdown(1);
		});
		callChain = task;
		inFlight.add(task);
		void task.finally(() => inFlight.delete(task));
	};

	const routeResponse = (obj: Record<string, unknown>): boolean => {
		const id = typeof obj.id === "string" ? obj.id : "";
		const waiter = id ? pending.get(id) : undefined;
		if (waiter) {
			pending.delete(id);
			const hasResult = Object.hasOwn(obj, "result");
			const hasError = Object.hasOwn(obj, "error");
			if (obj.jsonrpc !== "2.0" || obj.method !== undefined || hasResult === hasError) {
				waiter.reject(new NativeAuthorityError("correlation_missing", "malformed MCP elicitation response"));
			} else {
				waiter.resolve(obj as unknown as JsonRpc);
			}
			return true;
		}
		return obj.method === undefined && obj.id !== undefined;
	};

	const drainStdio = async (): Promise<void> => {
		while (true) {
			const newline = buffer.indexOf("\n");
			if (newline < 0) return;
			const body = buffer.subarray(0, newline).toString("utf8").trim();
			buffer = buffer.subarray(newline + 1);
			if (!body) continue;
			let parsed: unknown;
			try {
				parsed = JSON.parse(body);
			} catch {
				await writeReply(output, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
				continue;
			}
			if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
				await writeReply(output, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } });
				continue;
			}
			const obj = parsed as Record<string, unknown>;
			if (routeResponse(obj)) continue;
			if (obj.jsonrpc !== "2.0") {
				await writeReply(output, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request: jsonrpc must be '2.0'" } });
				continue;
			}
			if (routeResponse(obj)) continue;
			if (typeof obj.method !== "string" || !obj.method) {
				const id = obj.id !== undefined && (typeof obj.id === "string" || typeof obj.id === "number") ? obj.id : null;
				await writeReply(output, { jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid Request: missing method" } });
				continue;
			}
			if (obj.id !== undefined && typeof obj.id !== "string" && typeof obj.id !== "number" && obj.id !== null) {
				await writeReply(output, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request: invalid id type" } });
				continue;
			}
			if (obj.method === "tools/call" && obj.id === undefined) {
				await writeReply(output, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request: tools/call requires an id" } });
				continue;
			}
			const rpc = parsed as JsonRpc;
			if (rpc.method === "notifications/cancelled") {
				const requestId = (rpc.params as { requestId?: string | number } | undefined)?.requestId;
				if (typeof requestId === "string" && pending.has(requestId)) {
					pending.get(requestId)?.reject(new NativeAuthorityError("user_cancelled", "native interaction was cancelled"));
					pending.delete(requestId);
				} else if (requestId !== undefined) {
					mcp.aborts.get(requestId)?.abort(new Error("notifications/cancelled"));
				}
				continue;
			}
			if (rpc.method === "tools/call") {
				if (!accepting) {
					if (rpc.id !== undefined) await writeReply(output, { jsonrpc: "2.0", id: rpc.id, error: { code: -32000, message: "stdio closed" } });
					continue;
				}
				runCall(rpc);
				continue;
			}
			const reply = await handleJsonRpc(rpc, mcp);
			if (reply) await writeReply(output, reply);
		}
	};

	let resolveStdio = () => {};
	let shutdownPromise: Promise<void> | null = null;
	const executeShutdown = (code = 0): Promise<void> => {
		if (shutdownPromise) return shutdownPromise;
		shutdownPromise = (async () => {
			accepting = false;
			for (const ac of mcp.aborts.values()) ac.abort(new Error("stdio closed"));
			rejectPending(new NativeAuthorityError("user_cancelled", "MCP connection closed during native interaction"));
			await Promise.race([
				Promise.allSettled([...inFlight]),
				new Promise<void>((resolve) => setTimeout(resolve, 200)),
			]);
			await mcp.shutdown();
			if (output.writable && typeof output.end === "function") {
				await new Promise<void>((cb) => output.end(() => cb()));
			}
			process.exitCode = code;
			exit(code);
			resolveStdio();
		})();
		return shutdownPromise;
	};

	await new Promise<void>((resolve) => {
		resolveStdio = resolve;
		output.on("error", () => {
			void executeShutdown(1);
		});
		output.on("close", () => {
			void executeShutdown(0);
		});
		input.on("data", (chunk: Buffer | string) => {
			if (!accepting) return;
			chain = chain.then(async () => {
				if (!accepting) return;
				buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
				await drainStdio();
			}).catch(() => {
				void executeShutdown(1);
			});
		});
		input.on("end", () => {
			void chain.then(() => executeShutdown(0));
		});
		input.on("close", () => {
			void chain.then(() => executeShutdown(0));
		});
		input.on("error", () => {
			void executeShutdown(1);
		});
	});
}

/**
 * Starts this adapter's own entrypoint: `--hook` runs the Host's hook dispatch,
 * anything else serves stdio. A module bundled beside this entrypoint starts
 * nothing.
 */
export function runMcpEntry(profile: McpHostProfile, entrySuffixes: ReadonlyArray<string>): void {
	const entry = process.argv[1] ?? "";
	if (!entrySuffixes.some((suffix) => entry.endsWith(suffix))) return;
	if (process.argv.includes("--hook")) void profile.dispatchHook();
	else void serveStdio(profile);
}
