// Spec binding ownership. A simple TaskIntent binds no Spec. A complex
// TaskIntent binds at most one active Spec by path; freeze records Git
// content identity without relocating source files. Archive paths are
// historical evidence, not a freeze requirement.

import type { TaskIntentV1 } from "./types";
import { readSecureProjectFile } from "./storage";
import { KernelInvariantError } from "./validation";

const ACTIVE_SPEC_RE = /^docs\/specs\/(?!archive\/)[^/]+\.spec\.md$/;
const ARCHIVED_SPEC_RE = /^docs\/specs\/archive\/[^/]+\.spec\.md$/;

/** The archive counterpart of an active planning-artifact path. */
export function archivePath(path: string): string {
	const matched = path.match(/^docs\/(plans|specs)\/([^/]+)$/);
	if (!matched) throw new KernelInvariantError([`artifact path is not active: ${path}`]);
	return `docs/${matched[1]}/archive/${matched[2]}`;
}

/** The inverse of `archivePath`, for an already-archived Spec path. */
export function activePath(path: string): string {
	const matched = path.match(/^docs\/(plans|specs)\/archive\/([^/]+)$/);
	if (!matched) throw new KernelInvariantError([`artifact path is not archived: ${path}`]);
	return `docs/${matched[1]}/${matched[2]}`;
}

/**
 * The active Spec the intent binds, or `undefined` when it binds none.
 * Archive counterparts are not part of the binding predicate.
 */
export function boundSpecPath(intent: TaskIntentV1): string | undefined {
	const candidates = intent.scope_hint.filter((path) => ACTIVE_SPEC_RE.test(path));
	if (candidates.length > 1)
		throw new KernelInvariantError([`artifact transition requires at most one scope-bound Spec; found ${candidates.length}`]);
	return candidates[0];
}

/**
 * Bound Spec bytes when the intent names one. Simple intents have none.
 * `required` still fails closed for callers that demand a Spec.
 */
export function readBoundActiveSpec(
	root: string,
	intent: TaskIntentV1,
	required = false,
): { path: string; content: string } | undefined {
	const specPath = boundSpecPath(intent);
	if (!specPath) {
		if (required) throw new KernelInvariantError(["artifact freeze requires one scope-bound active Spec"]);
		return undefined;
	}
	try {
		return { path: specPath, content: readSecureProjectFile(root, specPath) };
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("source_missing:") && !required) return undefined;
		throw error;
	}
}

export interface BoundSpec {
	active: string;
	archive: string;
}

export type SpecBindingInspection =
	| { ok: true; binding: BoundSpec | null }
	| {
			ok: false;
			code: "binding_missing" | "binding_incomplete" | "binding_ambiguous";
			missing: string[];
			message: string;
	  };

/**
 * Enrollment and validate caller: a missing Spec is a simple task; a
 * malformed or incomplete complex binding is refused before any write.
 */
export function inspectSpecBinding(intent: TaskIntentV1): SpecBindingInspection {
	const active = intent.scope_hint.filter((path) => ACTIVE_SPEC_RE.test(path));
	const archived = intent.scope_hint.filter((path) => ARCHIVED_SPEC_RE.test(path));
	if (active.length === 0 && archived.length === 0)
		return { ok: true, binding: null };
	if (active.length > 1)
		return {
			ok: false,
			code: "binding_ambiguous",
			missing: [],
			message: `enrollment requires at most one scope-bound Spec; found ${active.length}: ${active.join(", ")}`,
		};
	if (active.length === 0) {
		const missing = archived.map((path) => activePath(path));
		return {
			ok: false,
			code: "binding_incomplete",
			missing,
			message: `complex Spec binding is incomplete; add ${missing.join(", ")}`,
		};
	}
	return { ok: true, binding: { active: active[0]!, archive: archivePath(active[0]!) } };
}
