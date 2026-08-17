// P2B2 U2: task-scoped invocation registry. Covers the single linear state
// transition open -> committed | cancelled, concurrent-operation rejection,
// timeout/cancel-first-wins, late callbacks, duplicate handlers, stale
// tokens, and retry-requires-new-invocation semantics.

import { describe, expect, test } from "bun:test";
import {
	createInvocationRegistry,
} from "../plugins/immune-brain/.pi-extension/pi-canary-invocations.ts";

describe("invocation registry", () => {
	test("open creates an open invocation; commit linearizes to committed", () => {
		const registry = createInvocationRegistry();
		const token = registry.open("task-1");
		expect(registry.isOpen("task-1")).toBe(true);
		registry.commit(token);
		expect(registry.stateOf(token)).toBe("committed");
		expect(registry.isOpen("task-1")).toBe(false);
	});

	test("cancel linearizes to cancelled and is idempotent", () => {
		const registry = createInvocationRegistry();
		const token = registry.open("task-1");
		registry.cancel(token);
		expect(registry.stateOf(token)).toBe("cancelled");
		registry.cancel(token);
		expect(registry.stateOf(token)).toBe("cancelled");
	});

	test("concurrent open for the same task is rejected", () => {
		const registry = createInvocationRegistry();
		registry.open("task-1");
		expect(() => registry.open("task-1")).toThrow(/concurrent|already/i);
		// Different tasks are independent.
		expect(() => registry.open("task-2")).not.toThrow();
	});

	test("commit after cancel or commit is rejected (closed)", () => {
		const registry = createInvocationRegistry();
		const t1 = registry.open("task-1");
		registry.cancel(t1);
		expect(() => registry.commit(t1)).toThrow(/cancelled|new invocation/i);
		const t2 = registry.open("task-2");
		registry.commit(t2);
		expect(() => registry.commit(t2)).toThrow(/committed|new invocation/i);
	});

	test("timeout/cancel first wins: a late commit cannot reopen it", () => {
		const registry = createInvocationRegistry();
		const token = registry.open("task-1");
		// Simulate timeout winning before the UI promise resolves.
		registry.cancel(token);
		expect(() => registry.commit(token)).toThrow();
		expect(registry.stateOf(token)).toBe("cancelled");
	});

	test("foreign and stale tokens are unrecognized", () => {
		const registry = createInvocationRegistry();
		const token = registry.open("task-1");
		registry.cancel(token);
		const foreign = Object.freeze({ task_id: "task-1", nonce: "forged" });
		expect(() => registry.stateOf(foreign)).toThrow(/not recognized/i);
		expect(() => registry.commit(foreign)).toThrow(/not recognized/i);
		expect(() => registry.cancel(foreign)).toThrow(/not recognized/i);
	});

	test("application failure leaves the invocation closed; retry needs a new invocation", () => {
		const registry = createInvocationRegistry();
		const token = registry.open("task-1");
		registry.commit(token);
		// The application failed after commit: the invocation stays closed.
		expect(registry.stateOf(token)).toBe("committed");
		expect(() => registry.commit(token)).toThrow();
		// A retry must open a fresh invocation.
		const retry = registry.open("task-1");
		expect(registry.stateOf(retry)).toBe("open");
		registry.commit(retry);
		expect(registry.stateOf(retry)).toBe("committed");
	});

	test("duplicate handler entry cannot win the linearization point twice", () => {
		const registry = createInvocationRegistry();
		const token = registry.open("task-1");
		// Two late callbacks race; only the first commit wins.
		registry.commit(token);
		expect(() => registry.commit(token)).toThrow();
	});

	test("safe task ids are enforced", () => {
		const registry = createInvocationRegistry();
		expect(() => registry.open("../evil")).toThrow(/safe file identity/i);
	});
});
