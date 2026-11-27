import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GithubInitiativeObservation } from "../plugins/immune-brain/runtime/github_issue_tracker";
import { hasLocalInitiative, observeLocalInitiative } from "../plugins/immune-brain/runtime/local_initiative";

const SLUG = "local-batch";
const CONFIRMATION_TIME = "2099-01-01T00:00:00.000Z";
const CARRIER = `# Verify the local carrier

## S1: Alpha exists

Exit criteria: alpha is delivered

Tasks:
- local-alpha

## S2: Beta exists

Exit criteria: beta is delivered

Tasks:
- \`local-beta\`

## S3: Gamma follows alpha

Exit criteria: gamma is delivered

Blocked by: local-alpha

Tasks:
- local-gamma
`;

function writeIntent(root: string, taskId: string, scope: string): string {
	const path = `docs/plans/${taskId}.intent.json`;
	writeFileSync(join(root, path), `${JSON.stringify({
		contract: "assurance_kernel/task_intent/v1",
		task_id: taskId,
		goal: `Deliver ${taskId}`,
		acceptance: [{ id: `acc-${taskId}`, assertion: `Deliver ${taskId}`, verification: "{}" }],
		scope_hint: [scope],
		risk: "material",
		revision: 1,
		owner: "user",
	}, null, 2)}\n`);
	return path;
}

/** A repository whose only Initiative carrier is the Local file; no `gh` is reachable from here. */
function fixtureRoot(carrier: string | null = CARRIER): string {
	const root = mkdtempSync(join(tmpdir(), "imm-local-initiative-"));
	execFileSync("git", ["init", "-q"], { cwd: root });
	mkdirSync(join(root, "docs/plans"), { recursive: true });
	mkdirSync(join(root, "docs/initiatives"), { recursive: true });
	const paths = [
		writeIntent(root, "local-alpha", "alpha/**"),
		writeIntent(root, "local-beta", "beta/**"),
		writeIntent(root, "local-gamma", "gamma/**"),
	];
	if (carrier !== null) writeFileSync(join(root, `docs/initiatives/${SLUG}.md`), carrier);
	execFileSync("git", ["add", ...paths], { cwd: root });
	return root;
}

function withRoot<T>(carrier: string | null, run: (root: string) => T): T {
	const root = fixtureRoot(carrier);
	try {
		return run(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

describe("Local Initiative carrier", () => {
	it("reads each Slice's Task and its Blocked by line", () => {
		withRoot(CARRIER, (root) => {
			expect(observeLocalInitiative(root, SLUG)).toEqual({
				contract: "immune_brain/local_initiative_observation/v1",
				initiative_id: SLUG,
				path: `docs/initiatives/${SLUG}.md`,
				tasks: [
					{ task_id: "local-alpha", slice_id: "S1", blocked_by: [] },
					{ task_id: "local-beta", slice_id: "S2", blocked_by: [] },
					{ task_id: "local-gamma", slice_id: "S3", blocked_by: ["local-alpha"] },
				],
			});
		});
	});

	it("ignores Slice-shaped text inside a fenced block", () => {
		const fenced = `${CARRIER}\n\`\`\`markdown\n## S9: Example only\n\nTasks:\n- not-a-task\n\`\`\`\n`;
		withRoot(fenced, (root) => {
			expect(observeLocalInitiative(root, SLUG).tasks.map((task) => task.slice_id)).toEqual(["S1", "S2", "S3"]);
		});
	});

	it("refuses a Slice that names no Task or several, a file with no Slice, and a symlinked carrier", () => {
		withRoot("# Goal\n\n## S1: Two tasks\n\nTasks:\n- local-alpha\n- local-beta\n", (root) => {
			expect(() => observeLocalInitiative(root, SLUG)).toThrow("Slice S1 must name exactly one Task");
		});
		withRoot("# Goal\n\n## S1: No task\n\nExit criteria: nothing\n", (root) => {
			expect(() => observeLocalInitiative(root, SLUG)).toThrow("Slice S1 must name exactly one Task");
		});
		withRoot("# Goal only\n", (root) => {
			expect(() => observeLocalInitiative(root, SLUG)).toThrow("declares no Slice");
		});
		withRoot(null, (root) => {
			expect(hasLocalInitiative(root, SLUG)).toBe(false);
			expect(() => observeLocalInitiative(root, SLUG)).toThrow("does not exist");
			writeFileSync(join(root, "elsewhere.md"), CARRIER);
			symlinkSync(join(root, "elsewhere.md"), join(root, `docs/initiatives/${SLUG}.md`));
			expect(() => hasLocalInitiative(root, SLUG)).toThrow("must be a regular file");
		});
	});
});

describe("draw-up Local carrier shape", () => {
	it("documents an example carrier that drive's parser reads", () => {
		const contract = readFileSync(join(import.meta.dir, "../plugins/immune-brain/dist/draw-up.md"), "utf8");
		const example = /A Local carrier is written[\s\S]*?```markdown\n([\s\S]*?)```/.exec(contract)?.[1];
		expect(example).toBeDefined();
		const root = mkdtempSync(join(tmpdir(), "drawup-carrier-"));
		try {
			mkdirSync(join(root, "docs/initiatives"), { recursive: true });
			writeFileSync(join(root, "docs/initiatives/example.md"), example!);
			expect(observeLocalInitiative(root, "example").tasks).toEqual([
				{ task_id: "initiative-alpha", slice_id: "A", blocked_by: [] },
				{ task_id: "initiative-beta", slice_id: "B", blocked_by: ["initiative-alpha"] },
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
