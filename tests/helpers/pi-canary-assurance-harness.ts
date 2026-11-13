import { writeTestReviewPacket } from "../helpers/review-packet-fixture";
import { mock } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installCliReviewer } from "./cli-reviewer";
import type { VerdictAuthority } from "../../plugins/immune-brain/runtime/assurance/verdict_authority";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	PiReviewHost,
	snapshotDigest,
	type AssuranceProgressionPorts,
	type AssuranceVerdict,
	type SnapshotDescriptor,
} from "../../plugins/immune-brain/.pi-extension/pi-canary-assurance-progression.ts";
import { PiRuntime } from "../../plugins/immune-brain/.pi-extension/pi-host-runtime";
import {
	type ForegroundToolUpdate,
	type HostContext,
	type ReviewSubmissionOptions,
} from "../../plugins/immune-brain/runtime/assurance/coordinator";
import { withSettleCommit } from "../../plugins/immune-brain/runtime/assurance/workflow_autocommit";
import type { AssuranceProjectionResult } from "../../plugins/immune-brain/runtime/kernel/assurance_projection";
import type { ReviewBundle } from "../../plugins/immune-brain/.pi-extension/pi-canary-review-bundle.ts";

// These fixtures reserve the CLI reviewer (Spec review-cli-stage D11), so the
// fixture root is a real repository with a review profile and the reviewer
// binary on PATH. Settlement stays in the test: a submitted verdict is relayed
// through the coordinator, never produced by the process.
export const TASK = "phase3-task";
// One root and one reviewer output per test process: Bun runs test files in
// parallel workers, and a shared root would let one file's reserved tree guard
// see another file's writes.
export const ROOT = join(tmpdir(), `immune-brain-phase3-assurance-${process.pid}`);


function prepareReviewRoot(): void {
	mkdirSync(join(ROOT, ".imm"), { recursive: true });
	installCliReviewer();
	if (!existsSync(join(ROOT, ".git"))) {
		execFileSync("git", ["init", "-q"], { cwd: ROOT });
		writeFileSync(join(ROOT, "tracked.ts"), "export const value = 1;\n");
		execFileSync("git", ["add", "-A"], { cwd: ROOT });
		execFileSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.com", "commit", "-qm", "fixture"], { cwd: ROOT });
	}
	writeFileSync(join(ROOT, ".imm", "config.json"), JSON.stringify({
		contract: "immune_brain/project_config/v1",
		lanes: { review_host: "pi" },
	}) + "\n");
	for (const entry of ["tracked.ts", ".imm/config.json"]) {
		try { execFileSync("git", ["ls-files", "--error-unmatch", "--", entry], { cwd: ROOT, stdio: "ignore" }); }
		catch { execFileSync("git", ["add", "--", entry], { cwd: ROOT }); }
	}
	try { execFileSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.com", "commit", "-qm", "fixture config"], { cwd: ROOT, stdio: "ignore" }); }
	catch { /* nothing to commit */ }
}

prepareReviewRoot();
export const ctx = { cwd: ROOT, mode: "tui", ui: {} } as unknown as ExtensionContext;

export function projection(
	lifecycle: "active" | "done" | "stopped" = "active",
	nextObligation: AssuranceProjectionResult["projection"]["next_obligation"] = "run_qa",
	risk: AssuranceProjectionResult["projection"]["risk"] = "material",
	artifactState: "active" | "frozen" = "frozen",
): AssuranceProjectionResult {
	return {
		error: null,
		claim: { task_id: TASK, lifecycle_status: lifecycle === "active" ? "active" : "terminal" } as never,
		projection: {
			lifecycle,
			artifact_state: artifactState,
			risk,
			next_obligation: nextObligation,
			record_revision: "record-1",
			workspace_revision: "workspace-1",
			intent_revision: 1,
			intent_content_hash: "sha256:intent",
			diff_hash: "sha256:diff",
			fresh_acceptance_ids: ["A1"],
			missing_acceptance_ids: [],
			stale_attestation_ids: [],
			blocking_finding_ids: [],
			unresolved_user_decision_ids: [],
			replan_required_ids: [],
			completion_ready: false,
			authorization: { state: "blocked" },
		} as never,
	} as AssuranceProjectionResult;
}

export function snapshot(role: "qa" | "review"): SnapshotDescriptor {
	return {
		contract: "assurance_kernel/assurance_snapshot/v2",
		task_id: TASK,
		role,
		record_revision: "record-1",
		workspace_revision: "workspace-1",
		intent_revision: 1,
		intent_content_hash: "sha256:intent",
		diff_hash: "sha256:diff",
		lifecycle: "active",
		artifact_state: "frozen",
		risk: "material",
		fresh_acceptance_ids: ["A1"],
		missing_acceptance_ids: [],
		stale_attestation_ids: [],
		acceptance: [{ id: "A1", assertion: "the contract holds", verification: "{}" }],
		dirty_files: ["src/change.ts"],
		review_bundle_digest: role === "review" ? "sha256:bundle" : null,
		root: ROOT,
	};
}

function reviewBundle(): ReviewBundle {
	return {
		contract: "assurance_kernel/review_bundle/v4",
		root: ROOT,
		head: "a".repeat(40),
		scope: ["src/change.ts"],
		diff_hash: "sha256:diff",
		dirty_files: {},
		outcomes: { A1: { status: "passed", summary: "fresh" } },
		bundle_digest: "sha256:bundle",
	} as unknown as ReviewBundle;
}

export function passVerdict(s: SnapshotDescriptor): AssuranceVerdict & { approval?: Record<string, unknown> } {
	return {
		contract: "assurance_kernel/assurance_verdict/v2",
		role: s.role,
		task_id: TASK,
		snapshot_digest: snapshotDigest(s),
		decision: "pass",
		approval: {
			kind: s.role === "qa" ? "qa" : "review",
			authority_role: s.role === "qa" ? "qa" : "reviewer",
			summary: "passed",
			// A review pass must claim the reviewed change set (BR-DEC-3). QA
			// verdicts never carry the field.
			...(s.role === "review" ? { inspected_paths: [...s.dirty_files] } : {}),
		},
	};
}

/**
 * Build a Pi assurance driver backed by the real `PiRuntime`/`HostRuntime`
 * composition root for conformance and progression tests.
 */
export function createPiRuntimeDriver(
	ports: AssuranceProgressionPorts,
	cwd: string = process.cwd(),
) {
	const host = new PiReviewHost();
	const piRuntime = new PiRuntime({
		cwd,
		ports: ports as any,
		authorityOverrides: ports.authorityOverrides,
		host,
	});
	const coordinator = piRuntime.coordinator;
	return {
		piReviewHost: host,
		authority: (coordinator as any).authority,
		coordinator,
		piRuntime,
		advance: async (taskId: string, ctx: HostContext, signal?: AbortSignal, onUpdate?: (update: ForegroundToolUpdate) => void) => {
			piRuntime.bindWorkspace(ctx.cwd);
			return piRuntime.advance(taskId, signal, undefined, onUpdate);
		},
		submitReview: async (taskId: string, ctx: HostContext, verdictInput: unknown, options?: ReviewSubmissionOptions) => {
			piRuntime.bindWorkspace(ctx.cwd);
			return withSettleCommit(ctx.cwd, taskId, await coordinator.submitReview(taskId, ctx, verdictInput, options));
		},
		submitMediated: (taskId: string, ctx: HostContext, verdictInput: unknown) => {
			piRuntime.bindWorkspace(ctx.cwd);
			return piRuntime.submitReview(taskId, verdictInput);
		},
		releaseStoppedReview: (taskId: string) => coordinator.releaseStoppedReview(taskId),
		submitVerification: async (taskId: string, ctx: HostContext, result?: string) => {
			piRuntime.bindWorkspace(ctx.cwd);
			return piRuntime.submitVerification(taskId, result);
		},
		active: (taskId: string) => coordinator.active(taskId),
		onSessionShutdown: async () => {
			await piRuntime.shutdown();
		},
	};
}

export function makeAssuranceHarness(overrides: Partial<{
	phase: string;
	risk: "routine" | "material" | "critical";
	runQa: AssuranceProgressionPorts["runQa"];
	project: AssuranceProgressionPorts["projectTask"];
	writeReviewEvidence: AssuranceProgressionPorts["writeReviewEvidence"];
	applyVerdict: VerdictAuthority["applyVerdict"];
	applyOrdinaryOperation: AssuranceProgressionPorts["applyOrdinaryOperation"];
}> = {}) {
	let applyCount = 0;
	let removeCount = 0;
	let evidenceCount = 0;
	let currentLifecycle: "active" | "done" | "stopped" = "active";
	let artifactState: "active" | "frozen" = overrides.phase === "working" ? "active" : "frozen";
	const risk = overrides.risk ?? "material";
	let nextObligation: AssuranceProjectionResult["projection"]["next_obligation"] = artifactState === "active" ? "submit_assurance" : "run_qa";
	const ports: AssuranceProgressionPorts & Partial<VerdictAuthority> = {
		confirmationReference: ({ actorId }) => `fixture:${actorId}`,
		projectTask: overrides.project ?? (async () => projection(currentLifecycle, nextObligation, risk, artifactState)),
		readTaskRecord: async () => ({ record: { findings: [] } } as never),
		readTaskIntent: async () => ({ token: "intent-token" } as never),
		buildAssurance: async (_root, _task, role) => ({
			snapshot: snapshot(role),
			descriptors: new Map([[
				"A1",
				{ contract: "assurance_kernel/verification_descriptor/v2", command: { executable: "bun", argv: ["test"], cwd: ".", timeout_ms: 1000, max_output_bytes: 1024 }, environment: { prepare: null, writable_paths: [] } },
			]] as never),
			reviewBundle: role === "review" ? reviewBundle() : null,
		}),
		runQa: overrides.runQa ?? (async (s, _descriptors, options) => {
			options.onProgress?.({ index: 1, total: 1, acceptance_id: "A1", phase: "passed", elapsed_ms: 1 });
			return passVerdict(s);
		}),
		writeReviewEvidence: overrides.writeReviewEvidence ?? (() => {
			evidenceCount += 1;
			return { writePacket: writeTestReviewPacket, path: `${ROOT}/review-${evidenceCount}.json`, remove: () => { removeCount += 1; } };
		}),
		applyVerdict: overrides.applyVerdict ?? (async (_ctx, input) => {
			applyCount += 1;
			await input.hooks?.beforeCommit?.();
			input.hooks?.onCommit?.();
			if (input.verdict.decision === "rework") {
				artifactState = "active";
				nextObligation = "resolve_findings";
			} else if (input.snapshot.role === "qa") {
				nextObligation = risk === "routine" ? "complete" : "run_review";
			} else {
				nextObligation = "complete";
			}
			await input.hooks?.afterCommit?.();
		}),
		applyOrdinaryOperation: overrides.applyOrdinaryOperation ?? (async (_ctx, input) => {
			if (input.operation.op === "freeze_artifacts") {
				artifactState = "frozen";
				nextObligation = "run_qa";
			} else if (input.operation.op === "complete") {
				currentLifecycle = "done";
				nextObligation = "none";
			}
		}),
	};
	ports.authorityOverrides = ports;
	const delegatingPorts: AssuranceProgressionPorts = {
		confirmationReference: ({ actorId }) => ports.confirmationReference({ actorId }),
		projectTask: (root, taskId) => ports.projectTask(root, taskId),
		readTaskRecord: (root, taskId) => ports.readTaskRecord(root, taskId),
		readTaskIntent: (root, taskId) => ports.readTaskIntent(root, taskId),
		runQa: (s, d, o) => ports.runQa(s, d, o),
		writeReviewEvidence: (input) => ports.writeReviewEvidence(input),
		applyOrdinaryOperation: (ctx, input) => ports.applyOrdinaryOperation(ctx, input),
		onReworkApplied: (ctx, taskId, count) => ports.onReworkApplied?.(ctx, taskId, count),
		advanceBeforeProjection: () => ports.advanceBeforeProjection?.(),
		qaBeforeProjection: () => ports.qaBeforeProjection?.(),
		qaBeforeAuthorityCommit: () => ports.qaBeforeAuthorityCommit?.(),
		qaOnAuthorityCommit: () => ports.qaOnAuthorityCommit?.(),
		qaAfterAuthorityCommit: () => ports.qaAfterAuthorityCommit?.(),
		authorityOverrides: ports.authorityOverrides,
	};
	const progression = createPiRuntimeDriver(delegatingPorts);
	return { progression, authority: progression.authority, ports, counts: () => ({ applyCount, removeCount, evidenceCount }) };
}

export function resultText(s: SnapshotDescriptor, decision: "pass" | "rework" = "pass"): string {
	return JSON.stringify(decision === "pass"
		? passVerdict(s)
		: {
				contract: "assurance_kernel/assurance_verdict/v2",
				role: "review",
				task_id: TASK,
				snapshot_digest: snapshotDigest(s),
				decision: "rework",
				findings: [{
					id: "finding",
					kind: "blocking",
					acceptance_id: "A1",
					summary: "needs repair",
					evidence: {
						trigger: "the repaired path reaches the defect",
						caller_chain: ["runtime/assurance/coordinator.ts"],
						violated: { kind: "acceptance", ref: "A1" },
					},
				}],
			});
}

/**
 * Delivery-tree seam (memory #3390): the deterministic QA tree has no
 * `node_modules`, so a suite that loads a Pi extension module must register
 * stand-ins for the Host-provided packages only when the real ones are absent.
 * Registration is process-global, which is why callers pair it with
 * `mock.restore()` in `afterAll`.
 */
async function hostPackagesAvailable(): Promise<boolean> {
	for (const specifier of [
		"typebox",
		"typebox/value",
		"@earendil-works/pi-coding-agent",
		"@earendil-works/pi-tui",
	]) {
		try { await import(specifier); }
		catch { return false; }
	}
	return true;
}

export async function mockHostSdkForDeliveryTree(): Promise<void> {
	if (await hostPackagesAvailable()) return;
	const optional = Symbol("optional");
	const Type = {
		Array: (items: object) => ({ type: "array", items }),
		Boolean: () => ({ type: "boolean" }),
		Literal: (value: unknown) => ({ const: value }),
		Null: () => ({ type: "null" }),
		Number: () => ({ type: "number" }),
		Object: (properties: Record<string, any>, options: Record<string, unknown> = {}) => ({
			type: "object",
			properties,
			required: Object.entries(properties).filter(([, value]) => !value[optional]).map(([key]) => key),
			...options,
		}),
		Optional: (schema: Record<string, unknown>) => ({ ...schema, [optional]: true }),
		Record: (_key: object, value: object) => ({ type: "object", additionalProperties: value }),
		String: () => ({ type: "string" }),
		Union: (anyOf: object[]) => ({ anyOf }),
		Unknown: () => ({}),
	};
	const Check = (schema: any, value: any): boolean => {
		if (schema.anyOf) return schema.anyOf.some((item: any) => Check(item, value));
		if ("const" in schema) return value === schema.const;
		if (schema.type === "null") return value === null;
		if (schema.type === "array") return Array.isArray(value) && value.every((item) => Check(schema.items, item));
		if (schema.type === "object") {
			if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
			if ((schema.required ?? []).some((key: string) => !(key in value))) return false;
			for (const [key, child] of Object.entries(schema.properties ?? {}))
				if (key in value && !Check(child, value[key])) return false;
			if (schema.additionalProperties === false
				&& Object.keys(value).some((key) => !(key in (schema.properties ?? {})))) return false;
			if (schema.additionalProperties && typeof schema.additionalProperties === "object")
				return Object.values(value).every((item) => Check(schema.additionalProperties, item));
			return true;
		}
		return schema.type === undefined || typeof value === schema.type;
	};
	class Text {
		constructor(private text: string) {}
		setText(text: string) { this.text = text; }
		render() { return this.text.split("\n"); }
		invalidate() {}
	}
	class Container {
		private children: Array<{ render(width: number): string[] }> = [];
		addChild(child: { render(width: number): string[] }) { this.children.push(child); }
		render(width: number) { return this.children.flatMap((child) => child.render(width)); }
		invalidate() { for (const child of this.children) (child as any).invalidate?.(); }
	}
	class DynamicBorder {
		constructor(private style: (text: string) => string) {}
		render(width: number) { return [this.style("─".repeat(Math.max(0, width)))]; }
	}
	class SelectList {
		onSelect?: (item: any) => void;
		onCancel?: () => void;
		private selected = 0;
		constructor(private items: any[]) {}
		render() { return this.items.map((item, index) => `${index === this.selected ? "> " : "  "}${item.label}`); }
		handleInput(input: string) {
			if (input === "\u001b[B") this.selected = Math.min(this.items.length - 1, this.selected + 1);
			else if (input === "\u001b[A") this.selected = Math.max(0, this.selected - 1);
			else if (input === "\r") this.onSelect?.(this.items[this.selected]);
			else if (input === "\u001b") this.onCancel?.();
		}
	}
	mock.module("typebox", () => ({ Type }));
	mock.module("typebox/value", () => ({ Check }));
	mock.module("@earendil-works/pi-coding-agent", () => ({ DynamicBorder }));
	mock.module("@earendil-works/pi-tui", () => ({
		Container,
		SelectList,
		Text,
		sliceByColumn: (text: string, start: number, width?: number) => text.slice(start, width === undefined ? undefined : start + width),
		truncateToWidth: (text: string, width: number, marker = "") => text.length <= width
			? text
			: `${text.slice(0, Math.max(0, width - marker.length))}${marker}`,
		visibleWidth: (text: string) => text.length,
	}));
}
