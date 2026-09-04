import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const SPEC_PATH = "docs/specs/task-rail-progress-depth-and-overview.spec.md";

test("task-rail progress Spec exists with design metadata and complete Brainstorm trace", () => {
	const text = readFileSync(SPEC_PATH, "utf8");
	for (const key of [
		"Design risk",
		"Diagram decision",
		"Diagram reason",
		"Brainstorm manifest",
		"Brainstorm Trace",
		"BR-REQ-1",
		"BR-REQ-2",
		"BR-DEC-1",
		"BR-DEC-2",
		"BR-DEC-3",
		"BR-OUT-1",
		"BR-OUT-2",
		"BR-OUT-3",
		"BR-DEFER-1",
	]) {
		expect(text.includes(key)).toBe(true);
	}
});
