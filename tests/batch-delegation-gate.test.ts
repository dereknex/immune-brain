// ADR 0018: the batch gate states the opt-in delegation explicitly, only in lane
// mode, off by default; declining it keeps today's behavior.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { elicitationParams } from "../plugins/immune-brain/runtime/claude/mcp_server";
import { REVISION_DELEGATION_TEXT, delegatedRevisionRefusal } from "../plugins/immune-brain/runtime/unattended/batch_delegation";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const batch = (laneMode: boolean) => ({
	operation: "start_unattended_batch" as const,
	initiativeSlug: "s",
	toolCallId: "t",
	planDigest: "sha256:x",
	batchDetails: {
		initiative_slug: "s", batch_branch: "imm/s", children: [], excluded: [], budget: { max_children: 1, qa_failure_limit: 1 },
		...(laneMode ? { lane_mode: { max_parallel: 2, parallel_groups: [], serialized: [], offer_revision_delegation: true } } : {}),
	},
});

describe("delegation in the batch gate", () => {
	it("Claude Code: a lane batch offers one boolean defaulting to false and states the bounds; a serial batch offers nothing", () => {
		const lane = elicitationParams(batch(true));
		expect(lane.requestedSchema).toEqual({ type: "object", properties: { delegate_in_lane_revisions: expect.objectContaining({ type: "boolean", default: false }) } });
		expect(lane.message).toContain(REVISION_DELEGATION_TEXT);
		const serial = elicitationParams(batch(false));
		expect(serial.requestedSchema).toEqual({ type: "object", properties: {} });
		expect(serial.message).not.toContain(REVISION_DELEGATION_TEXT);
	});

	it("Pi: the delegating choice is its own selection; plain confirm stays a grant-free accept", () => {
		// The Pi module imports `typebox`, which an isolated QA delivery has no
		// node_modules for, so the mapping is pinned in its source here; the
		// behavior of every selection, confirm_delegate included, runs in
		// pi-batch-authority ("native-decline-unreachable").
		const source = readFileSync(resolve(REPO_ROOT, "plugins/immune-brain/.pi-extension/imm-unattended-batch.ts"), "utf8");
		expect(source).toContain('if (selected === "confirm") return "accept";');
		expect(source).toContain('if (selected === "confirm_delegate") return "accept_delegate";');
		expect(source).toContain('return "cancel";');
		expect(source).toContain('details.offerRevisionDelegation');
		expect(source).toContain('value: "confirm_delegate"');
	});

	it("states the bounds the runtime enforces", () => {
		const base = { contract: "assurance_kernel/task_intent/v1" as const, task_id: "t", goal: "g", owner: "user" as const, risk: "material" as const, revision: 1,
			scope_hint: ["src/a.ts", "src/b.ts"], acceptance: [{ id: "A1", assertion: "a", verification: "v" }] };
		const changed = { ...base, revision: 2, acceptance: [{ id: "A1", assertion: "a, stated as a principle", verification: "v" }] };
		expect(delegatedRevisionRefusal(base, base, changed)).toBeNull();
		expect(delegatedRevisionRefusal(base, base, { ...changed, scope_hint: ["src/a.ts"] })).toBeNull();
		expect(delegatedRevisionRefusal(base, base, { ...changed, scope_hint: ["src/a.ts", "src/c.ts"] })).toContain("widening scope_hint");
		expect(delegatedRevisionRefusal(base, base, { ...changed, risk: "critical" })).toContain("risk");
		expect(delegatedRevisionRefusal(base, base, { ...changed, goal: "other" })).toContain("goal");
	});

	it("keeps refusing a widening that is not compatible, and leaves a compatible one to revise_intent (ADR 0021)", () => {
		const base = { contract: "assurance_kernel/task_intent/v1" as const, task_id: "t", goal: "g", owner: "user" as const, risk: "material" as const, revision: 1,
			scope_hint: ["src/a.ts", "src/b.ts"], acceptance: [{ id: "A1", assertion: "a", verification: "v" }] };
		const acceptance = [{ id: "A1", assertion: "a, stated as a principle", verification: "v" }];
		// A new directory is breaking: delegation still refuses the widening.
		expect(delegatedRevisionRefusal(base, base, { ...base, revision: 2, acceptance, scope_hint: ["other/c.ts", "src/a.ts", "src/b.ts"] }))
			.toContain("widening scope_hint");
		// A same-directory file alone is compatible: it needs no delegated approval.
		expect(delegatedRevisionRefusal(base, base, { ...base, revision: 2, scope_hint: ["src/a.ts", "src/b.ts", "src/c.ts"] }))
			.toContain("apply a compatible one with revise_intent");
	});

	it("is recorded as an accepted ADR that names the clauses it revises", () => {
		const adr = readFileSync(resolve(REPO_ROOT, "docs/adr/0018-delegated-in-lane-intent-revision.md"), "utf8").replace(/\s+/g, " ");
		expect(adr).toContain("status: accepted");
		expect(adr).toContain("ADR 0005, rejected \"batch-scoped authority record\"");
		expect(adr).toContain("ADR 0016, clause 6, \"No new authority tier\"");
		expect(adr).toContain("`delegated-batch:<batch_id>@<confirmation_time>`");
	});
});
