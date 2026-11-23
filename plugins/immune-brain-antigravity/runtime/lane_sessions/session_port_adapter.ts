// SessionPortAdapter (Spec unified-lane-sessions S5, D1/D8/D10).
//
// Composition-root adapter: the only module that binds a `SupervisedSessionPort`
// to the batch `BatchSessionPort` vocabulary. It owns no Lane state transitions
// and never touches the batch record.
//
// Interface: `SessionPortAdapter` implements `BatchSessionPort` over one
// `SupervisedSessionPort`, with a fixed Executor host and host args.
// Invariants: provider `pane_not_found` maps to `exited` when observing;
// every other provider failure maps to `unknown` (never a refusal that would
// park the child as held). A refused `send` stays a refusal so the recorded
// instruction digest is retried at the next tick instead of counting as sent.
// Side Effects: delegates to the wrapped port.
// Verification: `bun test tests/lane-sessions.test.ts`.
import type { BatchSessionPort, BatchSessionOpenInput } from "../unattended/batch_session_port";
import type { ExecutorHostKind, SupervisedSessionPort } from "../session/supervised_session_port";

function isRefusal(value: unknown): value is { ok: false; code: string; reason: string } {
	return typeof value === "object" && value !== null && (value as { ok?: unknown }).ok === false;
}

function refusalReason(value: { reason?: unknown }): string {
	return typeof value.reason === "string" ? value.reason : "provider failure";
}

function isPaneNotFound(reason: string): boolean {
	return reason.includes("pane_not_found");
}

export class SessionPortAdapter implements BatchSessionPort {
	readonly provider: string;
	private readonly port: SupervisedSessionPort;
	readonly host: ExecutorHostKind;
	private readonly hostArgs: string[];

	constructor(port: SupervisedSessionPort, host: ExecutorHostKind, hostArgs: string[] = []) {
		this.port = port;
		this.provider = port.provider;
		this.host = host;
		this.hostArgs = [...hostArgs];
	}

	async open(input: BatchSessionOpenInput) {
		const result = await this.port.createSession({
			cwd: input.cwd,
			label: input.label,
			host: this.host,
			hostArgs: this.hostArgs,
			entry: input.entry,
			session_key: input.key,
			...(input.env && Object.keys(input.env).length > 0 ? { env: input.env } : {}),
		});
		if (isRefusal(result)) return { ok: false as const, code: result.code, reason: result.reason };
		return { ok: true as const, handle: result.handle, entry_submitted: result.entry_submitted, ...(result.attention !== undefined ? { attention: result.attention ?? null } : {}) };
	}

	async resume(handle: string, entry: string) {
		const result = await this.port.createSession({
			cwd: ".",
			label: "resume",
			host: this.host,
			hostArgs: this.hostArgs,
			entry,
			resume: handle,
		});
		if (isRefusal(result)) {
			return { ok: false as const, code: result.code, reason: result.reason };
		}
		return { ok: true as const, entry_submitted: result.entry_submitted };
	}

	async find(key: string) {
		if (!this.port.findSession) return { ok: true as const, not_found: true as const };
		const result = await this.port.findSession(key);
		if (isRefusal(result)) {
			const reason = refusalReason(result);
			if (isPaneNotFound(reason)) return { ok: true as const, not_found: true as const };
			return { ok: false as const, code: result.code, reason: result.reason };
		}
		return result;
	}

	async observe(handle: string) {
		const result = await this.port.observeState(handle);
		if (isRefusal(result)) {
			const reason = refusalReason(result);
			if (isPaneNotFound(reason)) return { ok: true as const, state: "exited" as const };
			return { ok: true as const, state: "unknown" as const };
		}
		if (result.state === "working" || result.state === "blocked" || result.state === "idle" || result.state === "done" || result.state === "error" || result.state === "unknown") {
			return { ok: true as const, state: result.state };
		}
		return { ok: true as const, state: "unknown" as const };
	}

	async send(handle: string, text: string) {
		const result = await this.port.sendInstruction(handle, text);
		// A gone pane is a refusal here: the reconciler keeps the digest unprocessed.
		if (isRefusal(result)) return { ok: false as const, code: result.code, reason: result.reason };
		return { ok: true as const, state: result.state };
	}

	async stop(handle: string) {
		const result = await this.port.stopSession(handle);
		if (isRefusal(result)) {
			const reason = refusalReason(result);
			if (isPaneNotFound(reason)) return { ok: true as const };
			return { ok: false as const, code: result.code, reason: result.reason };
		}
		return { ok: true as const };
	}

	async closeWithProof(handle: string, key: string) {
		if (!this.port.closeWithProof) return { ok: false as const, code: "provider_unavailable", reason: `provider ${this.provider} has no close proof` };
		const result = await this.port.closeWithProof(handle, key);
		if (isRefusal(result)) {
			const reason = refusalReason(result);
			if (isPaneNotFound(reason)) return { ok: true as const, exited: true as const, handle, key };
			return { ok: false as const, code: result.code, reason: result.reason };
		}
		return { ok: true as const, exited: true as const, handle, key };
	}
}
