import { readDerivedFiles } from "../derived_files";
import type { TaskIntentV1 } from "./types";

/** Candidate scope limit; enrolled intents and revisions retain their scope freedom. */
export function scopeEstimateFailure(root: string, intent: TaskIntentV1): string | null {
	if (intent.scope_size_reason !== undefined) return null;
	const outputs = new Set(readDerivedFiles(root).flatMap(entry => entry.outputs));
	const counted = intent.scope_hint.filter(path =>
		!path.startsWith(".changeset/") &&
		path !== `docs/plans/${intent.task_id}.intent.json` &&
		!/^docs\/specs\/[^/]+\.spec\.md$/.test(path) &&
		!outputs.has(path),
	).length;
	return counted > 15
		? `${counted} counted scope_hint paths exceed the 15-path cap; split the Slice or provide scope_size_reason`
		: null;
}
