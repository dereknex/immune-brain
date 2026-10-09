// Reads the Local Initiative carrier, `docs/initiatives/<slug>.md`, into the
// same Task list the GitHub carrier yields, so an unattended batch can be
// projected without any GitHub operation. Read-only: this parses a human-owned
// file and grants, records, and repairs nothing.

import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface LocalInitiativeObservation {
	contract: "immune_brain/local_initiative_observation/v1";
	initiative_id: string;
	path: string;
	tasks: Array<{
		task_id: string;
		slice_id: string;
		blocked_by: string[];
	}>;
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SLICE_HEADING = /^##\s+([^\s:]+)\s*:/;
const BLOCKED_BY = /^blocked by\s*:(.*)$/i;
const TASKS = /^tasks\s*:\s*$/i;
const BULLET = /^[-*]\s+(.*)$/;

export function localInitiativePath(initiativeSlug: string): string {
	return `docs/initiatives/${initiativeSlug}.md`;
}

/** True when the Local carrier owns this slug: a regular file, never a symlink. */
export function hasLocalInitiative(root: string, initiativeSlug: string): boolean {
	const stat = lstatSync(resolve(root, localInitiativePath(initiativeSlug)), { throwIfNoEntry: false });
	if (!stat) return false;
	if (!stat.isFile()) throw new Error(`${localInitiativePath(initiativeSlug)} must be a regular file`);
	return true;
}

function unquote(value: string): string {
	return value.trim().replace(/^`(.*)`$/, "$1");
}

/**
 * Each `## <slice-id>: <result>` section names its Task under `Tasks:` and may
 * add one `Blocked by: <task-id>, <task-id>` line. A batch child is one Slice,
 * so a section with no Task or several is refused rather than guessed at.
 */
export function observeLocalInitiative(root: string, initiativeSlug: string): LocalInitiativeObservation {
	if (!ID_PATTERN.test(initiativeSlug)) throw new Error("initiative_slug is invalid");
	const path = localInitiativePath(initiativeSlug);
	if (!hasLocalInitiative(root, initiativeSlug)) throw new Error(`Local Initiative ${path} does not exist`);
	const slices: Array<{ slice_id: string; tasks: string[]; blocked_by: string[] }> = [];
	let inTasks = false;
	let fence = false;
	for (const raw of readFileSync(resolve(root, path), "utf8").split(/\r?\n/)) {
		const line = raw.trim();
		if (line.startsWith("```")) {
			fence = !fence;
			continue;
		}
		if (fence) continue;
		const heading = SLICE_HEADING.exec(line);
		if (heading) {
			slices.push({ slice_id: heading[1]!, tasks: [], blocked_by: [] });
			inTasks = false;
			continue;
		}
		const slice = slices.at(-1);
		if (!slice) continue;
		if (TASKS.test(line)) {
			inTasks = true;
			continue;
		}
		const blocked = BLOCKED_BY.exec(line);
		if (blocked) {
			slice.blocked_by.push(...blocked[1]!.split(",").map(unquote).filter(Boolean));
			inTasks = false;
			continue;
		}
		const bullet = BULLET.exec(line);
		if (inTasks && bullet) slice.tasks.push(unquote(bullet[1]!));
		else if (line) inTasks = false;
	}
	if (!slices.length) throw new Error(`Local Initiative ${path} declares no Slice`);
	return {
		contract: "immune_brain/local_initiative_observation/v1",
		initiative_id: initiativeSlug,
		path,
		tasks: slices.map((slice) => {
			if (slice.tasks.length !== 1)
				throw new Error(`Local Initiative Slice ${slice.slice_id} must name exactly one Task to run as a batch child`);
			return { task_id: slice.tasks[0]!, slice_id: slice.slice_id, blocked_by: slice.blocked_by };
		}),
	};
}
