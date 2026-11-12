// One hook event log for every adapter (Spec docs/specs/host-neutral-adapter-core.spec.md
// D3). The cache directory name is the only per-Host input, so a Host keeps its
// own directory while the storage behavior is Claude's for both.
//
// Interface: `HookEventLog<E>`, `MemoryHookEventLog<E>`,
// `FileHookEventLog<E>(cacheName, root)`, `hookEventPath(cacheName, sessionId, root)`.
// Invariants: events are appended in order; `sessions()` returns the session ids
// the events name, never file names; a file is `<sha256(sessionId)>.jsonl` under
// `<root>/<cacheName>` and is read only while owner-only (see private_file.ts).
// Side Effects: creates the cache directory and appends to it.
// Verification: `bun test tests/dual-host-assurance-conformance.test.ts -t 'shared hook event log'`.

import { lstatSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { appendPrivate, cacheDir, ensurePrivateDir, ownedByUs, readPrivate, sessionHash } from "./private_file";

/** Every hook event this log stores names the session it belongs to. */
export interface SessionEvent {
	sessionId: string;
}

export interface HookEventLog<E extends SessionEvent> {
	append(event: E): boolean;
	list(sessionId?: string): E[];
	sessions(): string[];
	clear(sessionId?: string): void;
}

export class MemoryHookEventLog<E extends SessionEvent> implements HookEventLog<E> {
	private readonly events: E[] = [];
	append(event: E): boolean { this.events.push(event); return true; }
	list(sessionId?: string): E[] {
		return sessionId ? this.events.filter((event) => event.sessionId === sessionId) : [...this.events];
	}
	sessions(): string[] {
		return [...new Set(this.events.map((event) => event.sessionId))];
	}
	clear(sessionId?: string): void {
		if (!sessionId) {
			this.events.length = 0;
			return;
		}
		for (let i = this.events.length - 1; i >= 0; i--) {
			if (this.events[i].sessionId === sessionId) this.events.splice(i, 1);
		}
	}
}

export function hookEventPath(cacheName: string, sessionId: string, root = tmpdir()): string {
	return join(cacheDir(root, cacheName), `${sessionHash(sessionId)}.jsonl`);
}

export class FileHookEventLog<E extends SessionEvent> implements HookEventLog<E> {
	constructor(private readonly cacheName: string, private readonly root = tmpdir()) {}

	append(event: E): boolean {
		const path = hookEventPath(this.cacheName, event.sessionId, this.root);
		return appendPrivate(path, dirname(path), `${JSON.stringify(event)}\n`);
	}

	list(sessionId?: string): E[] {
		if (sessionId) return this.readSession(sessionId);
		const dir = cacheDir(this.root, this.cacheName);
		if (!ensurePrivateDir(dir)) return [];
		try {
			return readdirSync(dir)
				// `.events.jsonl` files are the retired Antigravity format (D3).
				.filter((name) => name.endsWith(".jsonl") && !name.endsWith(".events.jsonl"))
				.flatMap((name) => this.readFile(join(dir, name)));
		} catch {
			return [];
		}
	}

	sessions(): string[] {
		const ids = new Set<string>();
		for (const event of this.list()) if (event.sessionId) ids.add(event.sessionId);
		return [...ids];
	}

	private readFile(path: string): E[] {
		const text = readPrivate(path);
		if (!text) return [];
		try {
			return text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as E);
		} catch {
			return [];
		}
	}

	private readSession(sessionId: string): E[] {
		if (!ensurePrivateDir(cacheDir(this.root, this.cacheName))) return [];
		return this.readFile(hookEventPath(this.cacheName, sessionId, this.root));
	}

	clear(sessionId?: string): void {
		if (!sessionId || !ensurePrivateDir(cacheDir(this.root, this.cacheName))) return;
		const path = hookEventPath(this.cacheName, sessionId, this.root);
		try {
			const stat = lstatSync(path);
			if (!ownedByUs(stat) || stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o777) !== 0o600) return;
			rmSync(path, { force: true });
		} catch { /* cleanup cannot create authority */ }
	}
}
