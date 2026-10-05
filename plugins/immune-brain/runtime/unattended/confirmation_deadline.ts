// A native confirmation is bounded on both Hosts. Claude bounded its MCP
// elicitation with IMMUNE_BRAIN_BATCH_TIMEOUT_MS and Pi waited indefinitely; the
// bound, its default, and the "this deadline expired rather than the user
// cancelling" distinction are shared here. Each Host still owns its transport:
// this module only produces the signal to hand it and reports expiry.
//
// The default is sized to a literal user reading a multi-child batch plan: the
// earlier 60 s default expired gates the user was still answering.

export const CONFIRMATION_TIMEOUT_DEFAULT_MS = 900_000;
export const CONFIRMATION_TIMEOUT_ENV = "IMMUNE_BRAIN_BATCH_TIMEOUT_MS";
/** The longest delay a single timer honours: a signed 32-bit millisecond count. */
const TIMER_DELAY_LIMIT_MS = 2_147_483_647;

export interface ConfirmationDeadline {
	/** The caller's signal, combined with this deadline. */
	signal: AbortSignal;
	/** The bound this deadline armed, in milliseconds. */
	timeoutMs: number;
	/** True when this deadline fired and the caller's own signal did not. */
	timedOut(): boolean;
	clear(): void;
}

export function startConfirmationDeadline(input: {
	env?: Record<string, string | undefined>;
	signal?: AbortSignal;
}): ConfirmationDeadline {
	const configured = Number(input.env?.[CONFIRMATION_TIMEOUT_ENV]);
	const timeoutMs = Number.isFinite(configured) && configured > 0 ? configured : CONFIRMATION_TIMEOUT_DEFAULT_MS;
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout>;
	// A delay above the runtime's timer limit fires after 1 ms instead, so a
	// longer bound is walked in limit-sized steps: the bound reported is the
	// bound enforced.
	const arm = (remainingMs: number) => {
		timer = setTimeout(
			() => {
				if (remainingMs > TIMER_DELAY_LIMIT_MS) return arm(remainingMs - TIMER_DELAY_LIMIT_MS);
				controller.abort(new Error("native confirmation timed out waiting for user interaction"));
			},
			Math.min(remainingMs, TIMER_DELAY_LIMIT_MS),
		);
	};
	arm(timeoutMs);
	return {
		timeoutMs,
		signal: input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal,
		timedOut: () => controller.signal.aborted && !input.signal?.aborted,
		clear: () => clearTimeout(timer),
	};
}
