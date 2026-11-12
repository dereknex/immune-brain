// Claude Code adapter runtime (Issue #414 slice S3, Spec
// docs/specs/host-neutral-adapter-core.spec.md D7). The host-neutral body is
// `HostRuntime` in `../host-core/runtime`; this module supplies the Claude
// profile and keeps the public surface callers and MCP servers use.
//
// Interface: `ClaudeRuntime`, `ClaudeRuntimeOptions`, `ToolMeta`,
// `diffSnapshotOf`, `diffHashOf`, `settledKernelResult`, `CLAUDE_LANE_WAIT_MS`,
// `ensureClaudeReviewRevision`.
// Invariants: the profile is the only Claude-specific wiring here; one
// `HostRuntime` carries the behavior; no adapter extends another.
// Side Effects: through the shared runtime.
// Verification: `bun test tests/claude-host-authority.test.ts`.

import { HostRuntime, LANE_WAIT_MS, type HostRuntimeOptions, type HostRuntimeProfile } from "../host-core/runtime";
import { ClaudeReviewHost, claudeHookEventLog, type ClaudeHookEvent } from "./review_host";
import { probeHost } from "./capability";
import { confirmationRef } from "./interaction";
import { selectedClaudeParent } from "./run_continuation";

export { diffHashOf, diffSnapshotOf, settledKernelResult, type ToolMeta } from "../host-core/runtime";
export { ensureReviewRevision as ensureClaudeReviewRevision } from "../assurance/verdict_authority";
export { extractVerdictJson } from "../assurance/review_mediation";

/** The Lane supervisor's poll interval, unchanged from the pre-composition adapter. */
export const CLAUDE_LANE_WAIT_MS = LANE_WAIT_MS;

export type ClaudeRuntimeOptions = HostRuntimeOptions;

/** The Claude Code composition root: every Claude-specific fact the shared runtime needs. */
const CLAUDE_PROFILE: HostRuntimeProfile = {
	hostId: "claude-code",
	createHost: () => new ClaudeReviewHost(claudeHookEventLog()),
	observe: (host, event) => host.observe(event as ClaudeHookEvent),
	probeHost,
	confirmationRef,
	laneRuntime: (options) => new HostRuntime(CLAUDE_PROFILE, options),
	selectedParent: selectedClaudeParent,
};

export class ClaudeRuntime {
	readonly runtime: HostRuntime;

	constructor(options: ClaudeRuntimeOptions) {
		this.runtime = new HostRuntime(CLAUDE_PROFILE, options);
	}

	get host(): HostRuntime["host"] {
		return this.runtime.host;
	}

	get coordinator(): HostRuntime["coordinator"] {
		return this.runtime.coordinator;
	}

	observe(event: ClaudeHookEvent): void {
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
