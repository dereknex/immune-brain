// One Immune-Brain per process (issue #426, C-1).
//
// A Lane Executor started with `-e <plugin root>` while the same plugin is also
// installed as a Pi package loads two copies. Two copies register the same
// tools and replace each other's process-wide state (the Assurance
// progression), so the Host exits or runs on mixed state. The live run showed
// the two copies come through different resource loaders, and each copy is its
// own module instance, so neither a loader-scoped nor a module-scoped claim can
// see the other copy. The claim therefore lives on `globalThis` under a
// registry symbol every copy spells the same way: the first copy's source
// directory owns the process, a reload from that directory keeps it, a copy
// from any other directory registers nothing and says which one it left, and a
// vanished owner directory (a moved or upgraded package) is taken over.

import { existsSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The process-wide claim's key; `Symbol.for` makes it the same in every copy. */
export const COPY_CLAIM_KEY = Symbol.for("immune-brain.pi-extension.copy-owner");

export type CopyClaim = { active: true; source: string } | { active: false; source: string; owner: string };

/** The plugin root a factory module belongs to, resolved through symlinks. */
export function copySource(moduleUrl: string): string {
	const root = resolve(dirname(fileURLToPath(moduleUrl)), "..");
	try { return realpathSync(root); } catch { return root; }
}

/** Claims the process for `source`; another live source keeps it. */
export function claimProcess(source: string, exists: (path: string) => boolean = existsSync, store: Record<symbol, unknown> = globalThis as never): CopyClaim {
	const owner = store[COPY_CLAIM_KEY];
	if (typeof owner !== "string" || owner === source || !exists(owner)) {
		store[COPY_CLAIM_KEY] = source;
		return { active: true, source };
	}
	return { active: false, source, owner };
}

export function duplicateCopyMessage(claim: Extract<CopyClaim, { active: false }>): string {
	return `Immune-Brain is already loaded from ${claim.owner}; the copy at ${claim.source} was not loaded. Install or pass the plugin once (a Pi package, or -e <plugin root>), not both.`;
}

interface NotifyingPi {
	on(event: "session_start", handler: (event: unknown, ctx?: { ui?: { notify?: (message: string, level: "warning") => void } }) => unknown): void;
}

/** Registers only a one-time notice in the skipped copy. */
export function announceSkippedCopy(pi: NotifyingPi, claim: Extract<CopyClaim, { active: false }>): void {
	let told = false;
	pi.on("session_start", (_event, ctx) => {
		if (told) return;
		told = true;
		try { ctx?.ui?.notify?.(duplicateCopyMessage(claim), "warning"); } catch { /* a notice never affects authority */ }
	});
}
