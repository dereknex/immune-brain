// In-memory Supervised Session provider for conformance tests and callers'
// unit tests. It models the port's semantics, not any real provider.

import {
	closeRecordRefusal,
	instructionRefusal,
	refuse,
	resumeRefusal,
	SUPERVISED_SESSION_PROTOCOL,
	validateCreateInput,
	type AwaitResult,
	type CloseRecord,
	type CreateSessionInput,
	type SessionHandle,
	type SessionState,
	type SupervisedSessionPort,
} from "./supervised_session_port";

interface FakeSession {
	handle: SessionHandle;
	input: CreateSessionInput;
	state: SessionState;
	exited: boolean;
	closed: boolean;
	submitted: string[];
	output: string;
	keys: string[];
}

export interface FakeSessionControl {
	setState(handle: SessionHandle, state: SessionState): void;
	exit(handle: SessionHandle): void;
	setOutput(handle: SessionHandle, text: string): void;
	submitted(handle: SessionHandle): string[];
	sessionCount(): number;
	closed(handle: SessionHandle): boolean;
	/** Makes the next start show a dialog only the user may answer. */
	blockNextStart(): void;
	setAvailable(available: boolean): void;
}

export function createFakeSessionProvider(): { port: SupervisedSessionPort; control: FakeSessionControl } {
	const sessions = new Map<SessionHandle, FakeSession>();
	const waiters = new Set<() => void>();
	let next = 0;
	let blockStart = false;
	let available = true;

	const notify = () => { for (const wake of [...waiters]) wake(); };
	const owned = (handle: SessionHandle) => {
		const session = sessions.get(handle);
		return session ?? null;
	};
	const notOwned = (handle: SessionHandle) => refuse("not_owned", "handle was not created by this provider", handle);

	const port: SupervisedSessionPort = {
		provider: "fake",
		protocolVersion: SUPERVISED_SESSION_PROTOCOL,
		async probe() {
			return available ? { ok: true } : refuse("provider_unavailable", "fake provider set unavailable");
		},
		async createSession(input) {
			if (!available) return refuse("provider_unavailable", "fake provider set unavailable");
			const invalid = validateCreateInput(input);
			if (invalid) return invalid;
			if (input.resume !== undefined) {
				const session = owned(input.resume);
				if (!session) return notOwned(input.resume);
				const refused = resumeRefusal(session.handle, { state: session.state, provenance: "detected" });
				if (refused) return refused;
				session.submitted.push(input.entry);
				session.state = "working";
				notify();
				return { ok: true, handle: session.handle, entry_submitted: true, state: session.state, provenance: "detected" };
			}
			const handle = `fake:${++next}`;
			const session: FakeSession = { handle, input, state: "idle", exited: false, closed: false, submitted: [], output: "", keys: [] };
			sessions.set(handle, session);
			if (blockStart) {
				blockStart = false;
				session.state = "blocked";
				return { ok: true, handle, entry_submitted: false, state: "blocked", provenance: "detected" };
			}
			session.submitted.push(input.entry);
			session.state = "working";
			return { ok: true, handle, entry_submitted: true, state: session.state, provenance: "detected" };
		},
		async sendInstruction(handle, text) {
			const session = owned(handle);
			if (!session) return notOwned(handle);
			const refused = instructionRefusal(handle, { state: session.state, provenance: "detected" });
			if (refused) return refused;
			session.submitted.push(text);
			session.state = "working";
			notify();
			return { ok: true, state: session.state, provenance: "detected" };
		},
		async awaitTransition(handle, options) {
			const session = owned(handle);
			if (!session) return notOwned(handle);
			const settle = (): AwaitResult | null => {
				if (session.exited) return { ok: true, transition: "exited", state: "unknown", provenance: "none" };
				if (session.state !== "working") return { ok: true, transition: "changed", state: session.state, provenance: "detected" };
				return null;
			};
			const now = settle();
			if (now) return now;
			return await new Promise<AwaitResult>(resolve => {
				let timer: ReturnType<typeof setTimeout> | undefined;
				const wake = () => {
					const result = settle();
					if (!result) return;
					waiters.delete(wake);
					if (timer) clearTimeout(timer);
					resolve(result);
				};
				const giveUp = () => {
					waiters.delete(wake);
					if (timer) clearTimeout(timer);
					resolve({ ok: true, transition: "timeout", state: "unknown", provenance: "none" });
				};
				waiters.add(wake);
				if (options?.signal?.aborted) return giveUp();
				options?.signal?.addEventListener("abort", giveUp, { once: true });
				if (options?.timeoutMs !== undefined && options.timeoutMs > 0) timer = setTimeout(giveUp, options.timeoutMs);
			});
		},
		async readOutput(handle, source) {
			const session = owned(handle);
			if (!session) return notOwned(handle);
			return { ok: true, text: session.output, source };
		},
		async observeState(handle) {
			const session = owned(handle);
			if (!session) return notOwned(handle);
			if (session.exited) return { ok: true, state: "unknown", provenance: "none" };
			return { ok: true, state: session.state, provenance: session.state === "unknown" ? "none" : "detected" };
		},
		async stopSession(handle) {
			const session = owned(handle);
			if (!session) return notOwned(handle);
			session.keys.push("ctrl+c");
			session.exited = true;
			notify();
			return { ok: true };
		},
		async closeSession(handle, record: CloseRecord) {
			const session = owned(handle);
			if (!session) return notOwned(handle);
			const unproven = closeRecordRefusal(handle, record);
			if (unproven) return unproven;
			session.closed = true;
			session.exited = true;
			notify();
			return { ok: true };
		},
		async reconcile(handles) {
			const entries = handles.map(handle => {
				const session = owned(handle);
				if (!session) return { handle, state: "unknown" as const, provenance: "none" as const, refused: "not_owned" as const };
				if (session.exited) return { handle, state: "unknown" as const, provenance: "none" as const };
				return { handle, state: session.state, provenance: session.state === "unknown" ? "none" as const : "detected" as const };
			});
			return { ok: true, sessions: entries };
		},
		async sendKeys(handle, key) {
			const session = owned(handle);
			if (!session) return notOwned(handle);
			session.keys.push(key);
			return { ok: true };
		},
	};

	const control: FakeSessionControl = {
		setState(handle, state) {
			const session = sessions.get(handle);
			if (!session) throw new Error(`unknown fake session ${handle}`);
			session.state = state;
			notify();
		},
		exit(handle) {
			const session = sessions.get(handle);
			if (!session) throw new Error(`unknown fake session ${handle}`);
			session.exited = true;
			notify();
		},
		setOutput(handle, text) {
			const session = sessions.get(handle);
			if (!session) throw new Error(`unknown fake session ${handle}`);
			session.output = text;
		},
		submitted: handle => [...(sessions.get(handle)?.submitted ?? [])],
		sessionCount: () => sessions.size,
		closed: handle => sessions.get(handle)?.closed ?? false,
		blockNextStart() { blockStart = true; },
		setAvailable(value) { available = value; },
	};
	return { port, control };
}
