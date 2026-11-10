// One Immune-Brain per Pi resource loader (issue #426, C-1).
//
// A Lane Executor started with `-e <plugin root>` while the same plugin is also
// installed as a Pi package loads two copies. Pi loads `-e` extensions before
// installed ones, and two copies register the same tools and replace each
// other's process-wide state (the Assurance progression), so the Host exits or
// runs on mixed state. Each factory first claims its loader, identified by the
// event bus Pi shares among every extension one resource loader loads
// (`pi.events`): the first copy's source directory owns it, a reload from that
// directory keeps it, a copy from any other directory registers nothing and
// says which one it left, and a vanished owner directory (a moved or upgraded
// package) is taken over.

import { existsSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const owners = new WeakMap<object, string>();

export type CopyClaim = { active: true; source: string } | { active: false; source: string; owner: string };

/** The plugin root a factory module belongs to, resolved through symlinks. */
export function copySource(moduleUrl: string): string {
	const root = resolve(dirname(fileURLToPath(moduleUrl)), "..");
	try { return realpathSync(root); } catch { return root; }
}

/** Claims `scope` (a loader's event bus) for `source`; another live source keeps it. */
export function claimLoader(scope: object, source: string, exists: (path: string) => boolean = existsSync): CopyClaim {
	const owner = owners.get(scope);
	if (owner === undefined || owner === source || !exists(owner)) {
		owners.set(scope, source);
		return { active: true, source };
	}
	return { active: false, source, owner };
}

/** The scope a factory claims: Pi's loader-wide event bus, or the API object without one. */
export function loaderScope(pi: object): object {
	const events = (pi as { events?: unknown }).events;
	return typeof events === "object" && events !== null ? events : pi;
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
