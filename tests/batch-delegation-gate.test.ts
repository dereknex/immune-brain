// D20: batch confirmation grants execution without delegated Intent revision.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { elicitationParams } from "../plugins/immune-brain/runtime/claude/mcp_server";

const REPO_ROOT = resolve(import.meta.dir, "..");

describe("batch gate after delegation retirement", () => {
	it("Claude exposes no delegation choice for a Lane batch", () => {
		const gate = elicitationParams({
			operation: "start_unattended_batch", initiativeSlug: "s", toolCallId: "t", planDigest: "sha256:x",
			batchDetails: {
				initiative_slug: "s", batch_branch: "imm/s", children: [], excluded: [],
				budget: { max_children: 1, qa_failure_limit: 1 },
				lane_mode: { max_parallel: 2, parallel_groups: [], serialized: [] },
			},
		});
		expect(gate.requestedSchema).toEqual({ type: "object", properties: {} });
		expect(gate.message).not.toContain("breaking Intent revisions");
	});

	it("Pi keeps plain confirmation and removes the delegation selection", () => {
		const source = readFileSync(resolve(REPO_ROOT, "plugins/immune-brain/.pi-extension/imm-unattended-batch.ts"), "utf8");
		expect(source).toContain('if (selected === "confirm") return "accept";');
		expect(source).toContain('return "cancel";');
		expect(source).not.toContain("confirm_delegate");
		expect(source).not.toContain("offerRevisionDelegation");
	});
});
