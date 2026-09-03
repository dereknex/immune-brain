// P2B2 task-scoped invocation registry. NOT part of the Kernel runtime graph.
// One linear state transition per task: `open -> committed | cancelled`.
// Concurrent assure/authorize operations for the same task are rejected;
// timeout/cancel wins `open -> cancelled` first; a successful continuation
// must win `open -> committed` immediately before mint/apply; application
// failure leaves the invocation closed so retry requires a new invocation.
// No memory/file cross-transaction atomicity is claimed.

export type InvocationState = "open" | "committed" | "cancelled";

export interface InvocationToken {
	readonly task_id: string;
	readonly nonce: string;
}

export interface InvocationRegistry {
	/** Open a new invocation for one task; rejects if one is already open. */
	open(taskId: string): InvocationToken;
	/**
	 * Linearization point: wins `open -> committed` for exactly this token.
	 * Throws for a foreign token or a token whose invocation already ended.
	 * Only the winner may mint/apply a capability.
	 */
	commit(token: InvocationToken): void;
	/** Wins `open -> cancelled` (timeout/cancel/abort path). */
	cancel(token: InvocationToken): void;
	/** Inspect the current state of the caller's token. */
	stateOf(token: InvocationToken): InvocationState;
	/** Whether any invocation for the task is currently open. */
	isOpen(taskId: string): boolean;
	/** Internal task state (for tests). */
	states(): Record<string, InvocationState>;
}

export function createInvocationRegistry(): InvocationRegistry {
	const states = new Map<string, { token: InvocationToken; state: InvocationState }>();

	function tokenOf(taskId: string, nonce: string): InvocationToken {
		return Object.freeze({ task_id: taskId, nonce });
	}

	function entryOf(token: InvocationToken): { token: InvocationToken; state: InvocationState } {
		const entry = states.get(token.task_id);
		if (!entry || entry.token.nonce !== token.nonce)
			throw new Error("invocation token is not recognized for this task");
		return entry;
	}

	return {
		open(taskId: string): InvocationToken {
			if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(taskId))
				throw new Error("task id is not a safe file identity");
			const existing = states.get(taskId);
			if (existing && existing.state === "open") {
				throw new Error(
					`task ${taskId} already has an open invocation; concurrent assure/authorize is rejected`,
				);
			}
			// A closed (committed/cancelled) invocation is replaced by a fresh
			// one: retry requires a new invocation.
			const token = tokenOf(taskId, `${taskId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`);
			states.set(taskId, { token, state: "open" });
			return token;
		},
		commit(token: InvocationToken): void {
			const entry = entryOf(token);
			if (entry.state !== "open")
				throw new Error(
					`invocation for task ${token.task_id} is already ${entry.state}; a new invocation is required`,
				);
			entry.state = "committed";
		},
		cancel(token: InvocationToken): void {
			const entry = entryOf(token);
			if (entry.state === "open") entry.state = "cancelled";
			// Cancel on an already-closed invocation is a no-op (idempotent).
		},
		stateOf(token: InvocationToken): InvocationState {
			return entryOf(token).state;
		},
		isOpen(taskId: string): boolean {
			return states.get(taskId)?.state === "open";
		},
		states(): Record<string, InvocationState> {
			const out: Record<string, InvocationState> = {};
			for (const [taskId, entry] of states) out[taskId] = entry.state;
			return out;
		},
	};
}
