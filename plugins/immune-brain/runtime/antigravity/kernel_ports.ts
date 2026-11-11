// Antigravity adapter runtime (Issue #414 slice S3, Spec
// docs/specs/host-neutral-adapter-core.spec.md D7). The host-neutral body is
// `HostRuntime` in `../host-core/runtime`; this module supplies the Antigravity
// profile and keeps the public surface callers use. It no longer extends the
// Claude runtime and no longer imports it.
//
// Interface: `AntigravityRuntime`, `AntigravityRuntimeOptions`, `ToolMeta`.
// Invariants: the profile is the only Antigravity-specific wiring here; one
// `HostRuntime` carries the behavior; no adapter extends another.
// Side Effects: through the shared runtime.
// Verification: `bun test tests/antigravity-assurance-conformance.test.ts -t 'AntigravityRuntime'`.

import { HostRuntime, type HostRuntimeOptions, type HostRuntimeProfile } from "../host-core/runtime";
import { hostConfirmationRef } from "../host-core/interaction";
import { AntigravityReviewHost, antigravityHookEventLog, type AntigravityHookEvent } from "./review_host";
import { probeHost } from "./capability";

export type { ToolMeta } from "../host-core/runtime";
export type AntigravityRuntimeOptions = HostRuntimeOptions;

/** The Antigravity composition root: every Antigravity-specific fact the shared runtime needs. */
const ANTIGRAVITY_PROFILE: HostRuntimeProfile = {
	hostId: "antigravity",
	createHost: () => new AntigravityReviewHost(antigravityHookEventLog()),
	observe: (host, event) => host.observe(event as AntigravityHookEvent),
	probeHost,
	confirmationRef: (input) => hostConfirmationRef("antigravity", input),
	laneRuntime: (options) => new HostRuntime(ANTIGRAVITY_PROFILE, options),
	// This Host records no foreground parent session metadata, so no Lane tab is
	// owned by a parent session here (the Claude runtime's continuation log is
	// another Host's store and is never read).
	selectedParent: () => false,
};

export class AntigravityRuntime {
	readonly runtime: HostRuntime;

	constructor(options: AntigravityRuntimeOptions) {
		this.runtime = new HostRuntime(ANTIGRAVITY_PROFILE, options);
	}

	get host(): HostRuntime["host"] {
		return this.runtime.host;
	}

	get coordinator(): HostRuntime["coordinator"] {
		return this.runtime.coordinator;
	}

	observe(event: AntigravityHookEvent): void {
		this.runtime.observe(event);
	}

	observeAntigravity(event: AntigravityHookEvent): void {
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

	shutdown(): Promise<void> {
		return this.runtime.shutdown();
	}

	kernelPorts(): ReturnType<HostRuntime["kernelPorts"]> {
		return this.runtime.kernelPorts();
	}

	status(...args: Parameters<HostRuntime["status"]>): ReturnType<HostRuntime["status"]> {
		return this.runtime.status(...args);
	}

	advance(...args: Parameters<HostRuntime["advance"]>): ReturnType<HostRuntime["advance"]> {
		return this.runtime.advance(...args);
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

	startUnattendedBatch(...args: Parameters<HostRuntime["startUnattendedBatch"]>): ReturnType<HostRuntime["startUnattendedBatch"]> {
		return this.runtime.startUnattendedBatch(...args);
	}

	retireStaleBatch(...args: Parameters<HostRuntime["retireStaleBatch"]>): ReturnType<HostRuntime["retireStaleBatch"]> {
		return this.runtime.retireStaleBatch(...args);
	}
}
