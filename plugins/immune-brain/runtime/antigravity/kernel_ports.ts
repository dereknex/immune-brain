import { ClaudeRuntime, type ClaudeRuntimeOptions, type ToolMeta } from "../claude/kernel_ports";
import { AntigravityReviewHost, FileHookEventLog, type AntigravityHookEvent } from "./review_host";
import { probeHost } from "./capability";

export type { ToolMeta, ClaudeRuntimeOptions as AntigravityRuntimeOptions };

export class AntigravityRuntime extends ClaudeRuntime {
	constructor(options: ClaudeRuntimeOptions) {
		super({
			...options,
			parentHost: "antigravity",
			probeHost: options.probeHost ?? probeHost,
			host: options.host ?? new AntigravityReviewHost(new FileHookEventLog()),
		});
	}

	observeAntigravity(event: AntigravityHookEvent): void {
		this.host.observe(event);
	}
}
