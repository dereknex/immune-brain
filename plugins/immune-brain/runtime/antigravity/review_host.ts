import { constants, closeSync, fstatSync, lstatSync, openSync, readdirSync, readSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { FileHookEventLog, MemoryHookEventLog, type HookEventLog } from "../host-core/hook_event_log";
import { ownedByUs } from "../host-core/private_file";
import {
	VerifierObservation,
	type VerifierEvent,
	type VerifierObservationProfile,
} from "../host-core/verifier_observation";
import type {
	AssuranceHostPort,
	HostReviewReservation,
	VerificationReceipt,
	VerificationRequest,
} from "../assurance/host_port";

export const VERIFIER_AGENT = "immune-brain-review-verifier";

/** Declared byte bound for `.system_generated` spawn and message files. */
export const MAX_ASYNC_VERIFIER_FILE_BYTES = 256 * 1024;

/**
 * This adapter's log already holds only verifier evidence, so it stores the
 * shared vocabulary directly (D4, D5): `start` for an allowed dispatch, `result`
 * for its `PostToolUse` or asynchronous child message resolution, which is
 * terminal on its own.
 */
export type AntigravityHookEvent =
	| (Extract<VerifierEvent, { type: "start" }> & {
		model?: string;
		artifactDirectoryPath?: string;
	})
	| (Extract<VerifierEvent, { type: "result" }> & {
		messageId?: string;
		refusal?: string;
	})
	| Exclude<VerifierEvent, { type: "start" | "result" }>;

/** The Antigravity Host keeps its own cache directory name; storage is shared (D3). */
export const ANTIGRAVITY_CACHE_DIR = "immune-brain-antigravity";

/** The event log this adapter constructs: the shared file log over the Antigravity cache. */
export function antigravityHookEventLog(root = tmpdir()): FileHookEventLog<AntigravityHookEvent> {
	return new FileHookEventLog<AntigravityHookEvent>(ANTIGRAVITY_CACHE_DIR, root);
}

const ANTIGRAVITY_VERIFIER_PROFILE: VerifierObservationProfile<AntigravityHookEvent> = {
	verifierAgents: [VERIFIER_AGENT],
	// BR-SCN-1 / BR-DEC-3: `PostToolUse` (or the resolved async child message)
	// is this Host's terminal event, so a `stop` never follows and never gates the receipt.
	terminal: "result",
	actorPrefix: "antigravity",
	dispatch: ({ dispatchPrompt, model }) => ({
		TypeName: VERIFIER_AGENT,
		Role: "Review Verifier",
		Prompt: dispatchPrompt,
		Model: model,
	}),
	decode: (event) => event,
	resolveResult: (observed) => {
		if (observed.host.result.type === "result" && observed.host.result.refusal) {
			return { ok: false, reason: observed.host.result.refusal, release: true };
		}
		return { ok: true, result: observed.result.result };
	},
};

function isOwnedNonSymlinkDir(dirPath: string): boolean {
	try {
		const stat = lstatSync(dirPath);
		return !stat.isSymbolicLink() && stat.isDirectory() && ownedByUs(stat);
	} catch {
		return false;
	}
}

function readBoundedJsonObject(
	filePath: string,
	maxBytes = MAX_ASYNC_VERIFIER_FILE_BYTES,
): Record<string, unknown> | null {
	let fd: number;
	try {
		fd = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	} catch {
		return null;
	}
	try {
		const stat = fstatSync(fd);
		if (!stat.isFile() || !ownedByUs(stat) || stat.size < 0 || stat.size > maxBytes) return null;
		const buf = Buffer.alloc(maxBytes + 1);
		let total = 0;
		while (total <= maxBytes) {
			const n = readSync(fd, buf, total, buf.length - total, total);
			if (n === 0) break;
			total += n;
		}
		if (total > maxBytes) return null;
		const parsed: unknown = JSON.parse(buf.subarray(0, total).toString("utf8"));
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
		return parsed as Record<string, unknown>;
	} catch {
		return null;
	} finally {
		closeSync(fd);
	}
}

function resolveValidatedSystemDir(artifactDirectoryPath: unknown, conversationId: string): string | null {
	if (typeof artifactDirectoryPath !== "string" || !artifactDirectoryPath || !conversationId) return null;
	const normalized = resolve(artifactDirectoryPath);
	if (basename(normalized) !== conversationId) return null;
	if (!isOwnedNonSymlinkDir(normalized)) return null;
	const sysDir = join(normalized, ".system_generated");
	if (!isOwnedNonSymlinkDir(sysDir)) return null;
	return sysDir;
}

interface SpawnRecord {
	conversationId: string;
	spawnStepIndex: number;
	typeName: string;
}

interface ChildMessage {
	id: string;
	sender: string;
	recipient: string;
	content: string | null;
}

function readSpawnRecords(subagentsDir: string): SpawnRecord[] | null {
	if (!isOwnedNonSymlinkDir(subagentsDir)) return null;
	let entries;
	try {
		entries = readdirSync(subagentsDir, { withFileTypes: true });
	} catch {
		return null;
	}
	const records: SpawnRecord[] = [];
	for (const entry of entries) {
		if (!entry.name.endsWith(".json")) continue;
		if (entry.isSymbolicLink() || !entry.isFile()) return null;
		const obj = readBoundedJsonObject(join(subagentsDir, entry.name));
		if (!obj) return null;
		const descriptor =
			typeof obj.subagentDescriptor === "object" && obj.subagentDescriptor !== null && !Array.isArray(obj.subagentDescriptor)
				? (obj.subagentDescriptor as Record<string, unknown>)
				: null;
		records.push({
			conversationId: typeof obj.conversationId === "string" ? obj.conversationId : "",
			spawnStepIndex: typeof obj.spawnStepIndex === "number" && Number.isInteger(obj.spawnStepIndex) ? obj.spawnStepIndex : -1,
			typeName: descriptor && typeof descriptor.typeName === "string" ? descriptor.typeName : "",
		});
	}
	return records;
}

function readChildMessages(messagesDir: string): ChildMessage[] | null {
	if (!isOwnedNonSymlinkDir(messagesDir)) return null;
	let entries;
	try {
		entries = readdirSync(messagesDir, { withFileTypes: true });
	} catch {
		return null;
	}
	const messages: ChildMessage[] = [];
	for (const entry of entries) {
		if (!entry.name.endsWith(".json")) continue;
		if (entry.isSymbolicLink() || !entry.isFile()) return null;
		const obj = readBoundedJsonObject(join(messagesDir, entry.name));
		if (!obj) return null;
		// Antigravity stores read-tracking metadata in `messages/read.json`.
		if (entry.name === "read.json" && obj.sender === undefined && obj.recipient === undefined && obj.content === undefined) {
			continue;
		}
		messages.push({
			id: typeof obj.id === "string" && obj.id.length > 0 ? obj.id : entry.name,
			sender: typeof obj.sender === "string" ? obj.sender : "",
			recipient: typeof obj.recipient === "string" ? obj.recipient : "",
			content: typeof obj.content === "string" ? obj.content : null,
		});
	}
	return messages;
}

/**
 * Resolve pending asynchronous verifier dispatches for `payload.conversationId`
 * from `.system_generated/subagents/` and `.system_generated/messages/` (Spec D7).
 */
export function resolveAsyncVerifierResults(
	payload: Record<string, unknown>,
	log: HookEventLog<AntigravityHookEvent> = antigravityHookEventLog(),
): void {
	const conversationId = typeof payload.conversationId === "string" ? payload.conversationId : "";
	if (!conversationId) return;

	const events = log.list(conversationId);
	const startsByAgent = new Map<string, Extract<AntigravityHookEvent, { type: "start" }>>();
	const resultsByAgent = new Map<string, Array<Extract<AntigravityHookEvent, { type: "result" }>>>();

	for (const event of events) {
		if (event.type === "start" && event.agent === VERIFIER_AGENT) {
			startsByAgent.set(event.agentId, event);
		} else if (event.type === "result") {
			const list = resultsByAgent.get(event.agentId) ?? [];
			list.push(event);
			resultsByAgent.set(event.agentId, list);
		}
	}
	if (startsByAgent.size === 0) return;

	const dirCache = new Map<string, { spawns: SpawnRecord[]; messages: ChildMessage[] } | null>();
	const loadDir = (sysDir: string): { spawns: SpawnRecord[]; messages: ChildMessage[] } | null => {
		if (dirCache.has(sysDir)) return dirCache.get(sysDir)!;
		const spawns = readSpawnRecords(join(sysDir, "subagents"));
		const messages = spawns ? readChildMessages(join(sysDir, "messages")) : null;
		const loaded = spawns && messages ? { spawns, messages } : null;
		dirCache.set(sysDir, loaded);
		return loaded;
	};

	for (const [agentId, start] of startsByAgent) {
		const stepIdx = Number(agentId);
		if (!Number.isInteger(stepIdx) || String(stepIdx) !== agentId) continue;

		const existingResults = resultsByAgent.get(agentId) ?? [];
		// Inline PostToolUse results (no messageId) and already-refused/multi-result rounds stay settled.
		if (existingResults.some((e) => !e.messageId || Boolean(e.refusal)) || existingResults.length >= 2) {
			continue;
		}

		const rawArtifactDir = payload.artifactDirectoryPath !== undefined ? payload.artifactDirectoryPath : start.artifactDirectoryPath;
		const sysDir = resolveValidatedSystemDir(rawArtifactDir, conversationId);
		if (!sysDir) continue;

		const dir = loadDir(sysDir);
		if (!dir) continue;

		const stepSpawns = dir.spawns.filter((s) => s.spawnStepIndex === stepIdx);
		if (stepSpawns.length !== 1) continue;
		const spawn = stepSpawns[0];
		if (spawn.typeName !== VERIFIER_AGENT || !spawn.conversationId || spawn.conversationId === conversationId) {
			continue;
		}

		const childMessages = dir.messages.filter((m) => m.sender === spawn.conversationId && m.recipient === conversationId);
		const modelProps = start.model ? { model: start.model } : {};
		const promptProps = start.prompt ? { prompt: start.prompt } : {};

		if (existingResults.length === 1) {
			const recordedId = existingResults[0].messageId!;
			if (childMessages.length === 0 || (childMessages.length === 1 && childMessages[0].id === recordedId)) {
				continue;
			}
			const other = childMessages.find((m) => m.id !== recordedId) ?? childMessages[0];
			log.append({
				type: "result",
				sessionId: conversationId,
				agentId,
				result: other.content && other.content.trim().length > 0 ? other.content : "[refused: multiple verifier messages]",
				messageId: other.id,
				refusal: "multiple verifier messages observed for spawned verifier",
				...modelProps,
				...promptProps,
			});
			continue;
		}

		if (childMessages.length === 0) continue;
		if (childMessages.length === 1) {
			const msg = childMessages[0];
			if (msg.content === null || msg.content.trim().length === 0) continue;
			log.append({
				type: "result",
				sessionId: conversationId,
				agentId,
				result: msg.content,
				messageId: msg.id,
				...modelProps,
				...promptProps,
			});
			continue;
		}

		log.append({
			type: "result",
			sessionId: conversationId,
			agentId,
			result: "[refused: multiple verifier messages]",
			refusal: "multiple verifier messages observed for spawned verifier",
			...modelProps,
			...promptProps,
		});
	}
}

export class AntigravityReviewHost implements AssuranceHostPort {
	readonly host = "antigravity" as const;
	private readonly observation: VerifierObservation<AntigravityHookEvent>;

	constructor(log: HookEventLog<AntigravityHookEvent> = new MemoryHookEventLog<AntigravityHookEvent>()) {
		this.observation = new VerifierObservation(ANTIGRAVITY_VERIFIER_PROFILE, log);
	}

	prepareVerification(request: VerificationRequest): HostReviewReservation {
		return this.observation.prepare(request);
	}

	inspectVerification(reservation: HostReviewReservation): VerificationReceipt {
		return this.observation.inspect(reservation);
	}

	observe(event: AntigravityHookEvent): void {
		this.observation.observe(event);
	}

	releaseReview(reservation: HostReviewReservation): void {
		this.observation.release(reservation);
	}
}
