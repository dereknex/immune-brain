// Spec binding ownership. A TaskIntent binds one Spec by listing both its
// active path (`docs/specs/<name>.spec.md`) and its archive path
// (`docs/specs/archive/<name>.spec.md`) in `scope_hint`. The freeze transition
// relocates that pair, and enrollment refuses an intent whose scope_hint cannot
// name the pair — the same predicate, evaluated before any Executor turn
// instead of after the implementation is written.

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
 * The active Spec the intent binds, or `undefined` when it binds none. The
 * freeze caller preserves this exact predicate: at most one scope-bound
 * active Spec, whose archive counterpart is also in scope.
 */
export function boundSpecPath(intent: TaskIntentV1): string | undefined {
	const candidates = intent.scope_hint.filter(
		(path) => ACTIVE_SPEC_RE.test(path) && intent.scope_hint.includes(archivePath(path)),
	);
	if (candidates.length > 1)
		throw new KernelInvariantError([`artifact transition requires at most one scope-bound Spec; found ${candidates.length}`]);
	return candidates[0];
}

/**
 * Freeze caller: the bound active Spec's bytes, read from an active path. The
 * `required` default keeps the freeze-time failure message unchanged.
 */
export function readBoundActiveSpec(
	root: string,
	intent: TaskIntentV1,
	required = true,
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
	| { ok: true; binding: BoundSpec }
	| {
			ok: false;
			code: "binding_missing" | "binding_incomplete" | "binding_ambiguous";
			missing: string[];
			message: string;
	  };

/**
 * Enrollment caller: inspect the scope_hint binding with no filesystem read and
 * no write, so the same pure check runs in the zero-write rehearsal and in the
 * enrollment transaction. The rejection names every path the intent must add.
 */
export function inspectSpecBinding(intent: TaskIntentV1): SpecBindingInspection {
	const active = intent.scope_hint.filter((path) => ACTIVE_SPEC_RE.test(path));
	const archived = intent.scope_hint.filter((path) => ARCHIVED_SPEC_RE.test(path));
	if (active.length === 0 && archived.length === 0)
		return {
			ok: false,
			code: "binding_missing",
			missing: [],
			message:
				"enrollment requires one scope-bound active Spec and its archive path in scope_hint: add docs/specs/<name>.spec.md and docs/specs/archive/<name>.spec.md",
		};
	const bindings = active.filter((path) => archived.includes(archivePath(path)));
	if (bindings.length > 1)
		return {
			ok: false,
			code: "binding_ambiguous",
			missing: [],
			message: `enrollment requires at most one scope-bound Spec; found ${bindings.length}: ${bindings.join(", ")}`,
		};
	// Every declared path whose counterpart is absent from scope_hint, named by
	// the path the intent still has to add. Non-empty for every declared path
	// that never pairs, so a refusal never discards the concrete paths it saw.
	const missing = [
		...active.filter((path) => !archived.includes(archivePath(path))).map((path) => archivePath(path)),
		...archived.filter((path) => !active.includes(activePath(path))).map((path) => activePath(path)),
	];
	const addMessage = `enrollment requires the bound Spec pair in scope_hint; add ${missing.join(", ")}`;
	// Halves that never pair leave the binding missing outright, and the refusal
	// names every path the intent still has to add. This is the only fallback the
	// genuinely-empty case cannot reach: paths exist, so `missing` is never empty.
	if (bindings.length === 0) return { ok: false, code: "binding_missing", missing, message: addMessage };
	// A complete binding carrying an unpaired half is an incomplete pair rather
	// than a missing one, and still names the half that has to be added.
	if (missing.length > 0) return { ok: false, code: "binding_incomplete", missing, message: addMessage };
	return { ok: true, binding: { active: bindings[0]!, archive: archivePath(bindings[0]!) } };
}
