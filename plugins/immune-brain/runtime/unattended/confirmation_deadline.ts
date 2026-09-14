// A native confirmation is bounded on both Hosts. Claude bounded its MCP
// elicitation with IMMUNE_BRAIN_BATCH_TIMEOUT_MS and Pi waited indefinitely; the
// bound, its default, and the "this deadline expired rather than the user
// cancelling" distinction are shared here. Each Host still owns its transport:
// this module only produces the signal to hand it and reports expiry.

export const CONFIRMATION_TIMEOUT_DEFAULT_MS = 60_000;
export const CONFIRMATION_TIMEOUT_ENV = "IMMUNE_BRAIN_BATCH_TIMEOUT_MS";

export interface ConfirmationDeadline {
	/** The caller's signal, combined with this deadline. */
	signal: AbortSignal;
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
	const timer = setTimeout(() => {
		controller.abort(new Error("native confirmation timed out waiting for user interaction"));
	}, timeoutMs);
	return {
		signal: input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal,
		timedOut: () => controller.signal.aborted && !input.signal?.aborted,
		clear: () => clearTimeout(timer),
	};
}
