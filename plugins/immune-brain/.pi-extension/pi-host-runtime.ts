// Pi adapter runtime (Issue #414 slice S4, Spec
// docs/specs/tri-host-capability-alignment.spec.md D5). The host-neutral body is
// `HostRuntime` in `../runtime/host-core/runtime`; this module supplies the Pi
// profile and keeps the public surface callers and extension tools use.
//
// Interface: `PiRuntime`, `PiRuntimeOptions`, `PI_PROFILE`, `selectedPiParent`,
// `bindPiSelectedParent`, `ToolMeta`.
// Invariants: the profile is the only Pi-specific wiring here; one
// `HostRuntime` carries the behavior; no adapter extends another.
// Side Effects: through the shared runtime.
// Verification: `bun test tests/pi-canary-assurance-progression.test.ts tests/pi-canary-work-extension.test.ts tests/pi-canary-assurance-authority.test.ts`.

import { HostRuntime, type HostRuntimeOptions, type HostRuntimeProfile, type ToolMeta } from "../runtime/host-core/runtime";
import { hostConfirmationRef } from "../runtime/host-core/interaction";
import type { ForegroundToolUpdate, HostContext } from "../runtime/assurance/coordinator";
import type { VerifierEvent } from "../runtime/host-core/verifier_observation";
import { LaneSupervisor } from "../runtime/unattended/lane_supervisor";
import { PiReviewHost } from "./pi-canary-assurance-progression";
import { probeHost } from "./pi-capability";

export const PI_LANE_WAIT_MS = 5_000;
/** One supervisor per Pi process: the start/stop entry and the decision relay must see the same running generation. */
export const piLaneSupervisor = new LaneSupervisor();

export type { ToolMeta } from "../runtime/host-core/runtime";
export type PiRuntimeOptions = HostRuntimeOptions & {
	supervisor?: LaneSupervisor;
};

let currentSelectedPiParent: ((toolCallId: string, root: string, slug: string) => boolean) | null = null;

export function bindPiSelectedParent(fn: (toolCallId: string, root: string, slug: string) => boolean): void {
	currentSelectedPiParent = fn;
}

export function selectedPiParent(toolCallId: string, root: string, slug: string): boolean {
	return currentSelectedPiParent ? currentSelectedPiParent(toolCallId, root, slug) : false;
}

/** The Pi composition root: every Pi-specific fact the shared runtime needs. */
export const PI_PROFILE: HostRuntimeProfile = {
	hostId: "pi",
	createHost: () => new PiReviewHost(),
	observe: (host, event) => host.observe(event as VerifierEvent),
	probeHost,
	confirmationRef: (input) => hostConfirmationRef("pi", input),
	laneRuntime: (options) => {
		const lane = new HostRuntime(PI_PROFILE, options);
		(lane as any).laneSupervisor = piLaneSupervisor;
		return lane;
	},
	selectedParent: selectedPiParent,
};

export class PiRuntime {
	readonly runtime: HostRuntime;
	readonly options: PiRuntimeOptions;

	constructor(options: PiRuntimeOptions) {
		this.options = options;
		this.runtime = new HostRuntime(PI_PROFILE, options);
		(this.runtime as any).laneSupervisor = options.supervisor ?? piLaneSupervisor;
	}

	get host(): HostRuntime["host"] {
		return this.runtime.host;
	}

	get coordinator(): HostRuntime["coordinator"] {
		return this.runtime.coordinator;
	}

	observe(event: VerifierEvent): void {
		this.runtime.observe(event);
	}

	bindWorkspace(cwd: string): void {
		this.runtime.bindWorkspace(cwd);
	}

	bindHostVersion(version: string | undefined): void {
		this.runtime.bindHostVersion(version);
	}

	bindNativeConfirmation(port: Parameters<HostRuntime["bindNativeConfirmation"]>[0]): void {
		this.runtime.bindNativeConfirmation(port);
	}

	async shutdown(): Promise<void> {
		const host = this.options.host ?? (this.runtime as any).reviewHost;
		if (host && typeof (host as any).onSessionShutdown === "function") {
			(host as any).onSessionShutdown();
		}
		return this.runtime.shutdown();
	}

	kernelPorts(): ReturnType<HostRuntime["kernelPorts"]> {
		return this.runtime.kernelPorts();
	}

	status(...args: Parameters<HostRuntime["status"]>): ReturnType<HostRuntime["status"]> {
		return this.runtime.status(...args);
	}

	async advance(
		taskId: string,
		signal?: AbortSignal,
		meta?: ToolMeta,
		onUpdate?: (update: ForegroundToolUpdate) => void,
	): Promise<ReturnType<HostRuntime["advance"]> extends Promise<infer T> ? T : never> {
		if (onUpdate) {
			const originalAdvance = this.runtime.coordinator.advance.bind(this.runtime.coordinator);
			this.runtime.coordinator.advance = (id, ctx, sig, cb) => {
				if (id === taskId) {
					return originalAdvance(id, ctx, sig, cb ?? onUpdate);
				}
				return originalAdvance(id, ctx, sig, cb);
			};
			try {
				return await this.runtime.advance(taskId, signal, meta) as any;
			} finally {
				this.runtime.coordinator.advance = originalAdvance;
			}
		}
		return this.runtime.advance(taskId, signal, meta) as any;
	}

	executeOrdinary(ctx: HostContext, input: { taskId: string; operation: { op: string; actor_id: string; next_intent?: unknown; finding_id?: string; attestation_id?: string } }) {
		return (this.runtime as any).executeOrdinary(ctx, input);
	}

	freeze(taskId: string, ctx: HostContext) {
		return this.executeOrdinary(ctx, { taskId, operation: { op: "freeze_artifacts", actor_id: "executor" } });
	}

	complete(taskId: string, ctx: HostContext) {
		return this.executeOrdinary(ctx, { taskId, operation: { op: "complete", actor_id: "executor" } });
	}

	submitReview(...args: Parameters<HostRuntime["submitReview"]>): ReturnType<HostRuntime["submitReview"]> {
		return this.runtime.submitReview(...args);
	}

	submitVerification(...args: Parameters<HostRuntime["submitVerification"]>): ReturnType<HostRuntime["submitVerification"]> {
		return this.runtime.submitVerification(...args);
	}

	reviseIntent(...args: Parameters<HostRuntime["reviseIntent"]>): ReturnType<HostRuntime["reviseIntent"]> {
		return this.runtime.reviseIntent(...args);
	}

	resolveFinding(...args: Parameters<HostRuntime["resolveFinding"]>): ReturnType<HostRuntime["resolveFinding"]> {
		return this.runtime.resolveFinding(...args);
	}

	refuteFinding(...args: Parameters<HostRuntime["refuteFinding"]>): ReturnType<HostRuntime["refuteFinding"]> {
		return this.runtime.refuteFinding(...args);
	}

	authorize(...args: Parameters<HostRuntime["authorize"]>): ReturnType<HostRuntime["authorize"]> {
		return this.runtime.authorize(...args);
	}

	previewAuthorization(...args: Parameters<HostRuntime["previewAuthorization"]>): ReturnType<HostRuntime["previewAuthorization"]> {
		return this.runtime.previewAuthorization(...args);
	}

	previewBatchConfirmation(...args: Parameters<HostRuntime["previewBatchConfirmation"]>): ReturnType<HostRuntime["previewBatchConfirmation"]> {
		return this.runtime.previewBatchConfirmation(...args);
	}

	previewBatchRetirement(...args: Parameters<HostRuntime["previewBatchRetirement"]>): ReturnType<HostRuntime["previewBatchRetirement"]> {
		return this.runtime.previewBatchRetirement(...args);
	}

	startUnattendedBatch(...args: Parameters<HostRuntime["startUnattendedBatch"]>): ReturnType<HostRuntime["startUnattendedBatch"]> {
		return this.runtime.startUnattendedBatch(...args);
	}

	retireStaleBatch(...args: Parameters<HostRuntime["retireStaleBatch"]>): ReturnType<HostRuntime["retireStaleBatch"]> {
		return this.runtime.retireStaleBatch(...args);
	}
}
