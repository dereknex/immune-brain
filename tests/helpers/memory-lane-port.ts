// In-memory Herdr-shaped port for batch tests.
//
// Opens sessions without touching the `herdr` binary. Batch tests that expect
// a batch to start must inject this factory (and a Herdr-bearing env); otherwise
// a run inside Herdr opens a real tab, and a run outside Herdr refuses with
// `lane_session_unavailable`. Never used by tests asserting a real provider.
import type { SupervisedSessionPort } from "../../plugins/immune-brain/runtime/session/supervised_session_port";

class MemoryLaneSession implements SupervisedSessionPort {
	readonly provider = "herdr" as const;
	readonly protocolVersion = 1;
	private counter = 0;
	private states = new Map<string, string>();
	private handles = new Map<string, string>();
	async probe() {
		return { ok: true as const };
	}
	async createSession(input: {
		cwd: string;
		label: string;
		host: unknown;
		hostArgs: string[];
		entry: string;
		session_key?: string;
		resume?: string;
		env?: Record<string, string>;
	}) {
		if (input.resume) {
			return { ok: true as const, handle: input.resume, entry_submitted: true as const, state: "idle" as const, provenance: "detected" as const };
		}
		this.counter += 1;
		const key = input.session_key ?? `k${this.counter}`;
		const handle = `herdr:ws1/tab${this.counter}/pane${this.counter}/${key}`;
		this.handles.set(key, handle);
		this.states.set(handle, "working");
		return { ok: true as const, handle, entry_submitted: true as const, state: "working" as const, provenance: "detected" as const };
	}
	async sendInstruction(handle: string) {
		return { ok: true as const, state: (this.states.get(handle) ?? "idle") as "idle", provenance: "detected" as const };
	}
	async awaitTransition(handle: string) {
		return { ok: true as const, transition: "changed" as const, state: (this.states.get(handle) ?? "idle") as "idle", provenance: "detected" as const };
	}
	async readOutput() {
		return { ok: true as const, text: "", source: "visible" as const };
	}
	async observeState(handle: string) {
		return { ok: true as const, state: (this.states.get(handle) ?? "working") as "working", provenance: "detected" as const };
	}
	async stopSession() {
		return { ok: true as const };
	}
	async closeSession() {
		return { ok: true as const };
	}
	async reconcile(owned: string[]) {
		return { ok: true as const, sessions: owned.map((handle) => ({ handle, state: "working" as const, provenance: "detected" as const })) };
	}
	async findSession(key: string) {
		const handle = this.handles.get(key);
		if (handle) return { ok: true as const, handle };
		return { ok: true as const, not_found: true as const };
	}
	async closeWithProof(handle: string, session_key: string) {
		return { ok: true as const, exited: true as const, handle, session_key };
	}
}

/** One fresh in-memory port per injection; no `herdr` process spawns. */
export const memoryLanePort = () => new MemoryLaneSession() as unknown as SupervisedSessionPort;

/** Hermetic Herdr-shaped env for batch tests that expect sessions to open. */
export const memoryLanePortEnv = { HERDR_ENV: "1", HERDR_WORKSPACE_ID: "ws-test" } as Record<string, string>;
