import { afterEach, describe, expect, it, spyOn } from "bun:test";
import {
	CONFIRMATION_TIMEOUT_DEFAULT_MS,
	CONFIRMATION_TIMEOUT_ENV,
	startConfirmationDeadline,
} from "../plugins/immune-brain/runtime/unattended/confirmation_deadline";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("confirmation deadline", () => {
	let timers: ReturnType<typeof spyOn> | undefined;
	afterEach(() => {
		timers?.mockRestore();
		timers = undefined;
	});

	/** The delay actually handed to the timer, not only the reported field. */
	const armed = (env?: Record<string, string | undefined>) => {
		timers = spyOn(globalThis, "setTimeout");
		const deadline = startConfirmationDeadline({ env });
		const delay = timers.mock.calls.at(-1)?.[1];
		deadline.clear();
		timers.mockRestore();
		timers = undefined;
		return { delay, deadline };
	};

	it("arms a 15 minute default when the setting is unset, so a gate is still pending after 60 s", () => {
		expect(CONFIRMATION_TIMEOUT_DEFAULT_MS).toBe(900_000);
		for (const env of [undefined, {}, { [CONFIRMATION_TIMEOUT_ENV]: undefined }]) {
			const { delay, deadline } = armed(env);
			expect(delay).toBe(900_000);
			expect(deadline.timeoutMs).toBe(900_000);
			expect(delay as number).toBeGreaterThan(60_000);
			expect(deadline.signal.aborted).toBe(false);
			expect(deadline.timedOut()).toBe(false);
		}
	});

	it("honours a positive finite override exactly", () => {
		for (const [value, expected] of [["1", 1], ["40", 40], ["60000", 60_000], ["1800000", 1_800_000], ["2500.5", 2500.5]] as const) {
			const { delay, deadline } = armed({ [CONFIRMATION_TIMEOUT_ENV]: value });
			expect(delay).toBe(expected);
			expect(deadline.timeoutMs).toBe(expected);
		}
	});

	it("enforces an override above the single-timer limit in full instead of expiring at once", () => {
		const limit = 2_147_483_647;
		const pending: Array<{ fire: () => void; delay: number }> = [];
		timers = spyOn(globalThis, "setTimeout").mockImplementation(((fire: () => void, delay: number) => {
			pending.push({ fire, delay });
			return pending.length as unknown as ReturnType<typeof setTimeout>;
		}) as unknown as typeof setTimeout);
		const cleared = spyOn(globalThis, "clearTimeout").mockImplementation(() => {});
		try {
			const deadline = startConfirmationDeadline({ env: { [CONFIRMATION_TIMEOUT_ENV]: "5000000000" } });
			expect(deadline.timeoutMs).toBe(5_000_000_000);

			// No armed delay may exceed the limit, and the steps sum to the bound.
			for (let step = 0; step < 2; step++) {
				expect(pending).toHaveLength(step + 1);
				expect(pending[step].delay).toBe(limit);
				pending[step].fire();
				expect(deadline.timedOut()).toBe(false);
			}
			expect(pending).toHaveLength(3);
			expect(pending[2].delay).toBe(5_000_000_000 - 2 * limit);
			pending[2].fire();
			expect(deadline.timedOut()).toBe(true);
			expect(pending).toHaveLength(3);

			// clear() cancels the step currently armed, not only the first one.
			const later = startConfirmationDeadline({ env: { [CONFIRMATION_TIMEOUT_ENV]: "3000000000" } });
			pending[3].fire();
			later.clear();
			expect(cleared.mock.calls.at(-1)?.[0] as unknown).toBe(5);
			expect(later.timedOut()).toBe(false);

			// The limit itself still fits a single timer.
			const exact = startConfirmationDeadline({ env: { [CONFIRMATION_TIMEOUT_ENV]: String(limit) } });
			expect(pending.at(-1)?.delay).toBe(limit);
			pending.at(-1)?.fire();
			expect(exact.timedOut()).toBe(true);
		} finally {
			cleared.mockRestore();
		}
	});

	it("falls back to the default for an empty, non-numeric, zero, negative or non-finite override", () => {
		for (const value of ["", "   ", "abc", "15m", "0", "-1", "-60000", "NaN", "Infinity", "-Infinity"]) {
			const { delay, deadline } = armed({ [CONFIRMATION_TIMEOUT_ENV]: value });
			expect(delay).toBe(900_000);
			expect(deadline.timeoutMs).toBe(900_000);
		}
	});

	it("reports expiry as a timeout once the bound elapses", async () => {
		const deadline = startConfirmationDeadline({ env: { [CONFIRMATION_TIMEOUT_ENV]: "20" } });
		expect(deadline.timedOut()).toBe(false);
		await wait(60);
		expect(deadline.signal.aborted).toBe(true);
		expect(deadline.timedOut()).toBe(true);
		deadline.clear();
	});

	it("accepts an answer given before the bound: the signal stays live and nothing fires later", async () => {
		const deadline = startConfirmationDeadline({ env: { [CONFIRMATION_TIMEOUT_ENV]: "30" } });
		const answer = await Promise.resolve("accept");
		deadline.clear();
		await wait(80);
		expect(answer).toBe("accept");
		expect(deadline.signal.aborted).toBe(false);
		expect(deadline.timedOut()).toBe(false);
	});

	it("reports a caller-signal abort as cancellation, not timeout", async () => {
		const caller = new AbortController();
		const deadline = startConfirmationDeadline({ signal: caller.signal });
		caller.abort();
		expect(deadline.signal.aborted).toBe(true);
		expect(deadline.timedOut()).toBe(false);
		deadline.clear();

		// Still a cancellation when the caller aborts first and the bound elapses after.
		const second = new AbortController();
		const short = startConfirmationDeadline({ env: { [CONFIRMATION_TIMEOUT_ENV]: "20" }, signal: second.signal });
		second.abort();
		await wait(60);
		expect(short.timedOut()).toBe(false);
		short.clear();
	});

	it("clear() cancels exactly the timer it armed", () => {
		timers = spyOn(globalThis, "setTimeout");
		const cleared = spyOn(globalThis, "clearTimeout");
		try {
			const deadline = startConfirmationDeadline({});
			const handle = timers.mock.results.at(-1)?.value;
			deadline.clear();
			expect(cleared.mock.calls.some(([arg]) => arg === handle)).toBe(true);
		} finally {
			cleared.mockRestore();
		}
	});
});
