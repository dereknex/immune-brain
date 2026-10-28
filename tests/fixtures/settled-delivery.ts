import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalIntentHash, parseTaskIntentV1 } from "../../plugins/immune-brain/runtime/kernel/intent";
import { recoverKernelStoreFollowUps } from "../../plugins/immune-brain/runtime/kernel/storage";
import { seedKernelRunForTest } from "./mutation-authority-test-seam";

/**
 * A botline-shaped native Parent (content-delivery-authority S1): critical `s5`
 * and its dependent `s6`, real Git and Kernel settlement, no runtime commits.
 * Callers decide where settled bytes live (user commit, index, working tree).
 */
/** The scoped content hash a fixture Task's final attestation binds. */
export const deliveryHash = (id: string) => `sha256:${Buffer.from(id.padEnd(32, "0")).toString("hex")}`;

export function settledDeliveryFixture(dependentRisk: "critical" | "material" = "critical", prerequisiteId = "s5") {
	const root = mkdtempSync(join(tmpdir(), "imm-settled-delivery-"));
	const git = (...args: string[]) => execFileSync("git", ["-C", root, "-c", "user.name=User", "-c", "user.email=user@example.com", ...args],
		{ encoding: "utf8" }).trim();
	git("init", "-q", "-b", "main");
	writeFileSync(join(root, ".gitignore"), ".imm/state/\n");
	mkdirSync(join(root, "docs/plans"), { recursive: true }); mkdirSync(join(root, "docs/initiatives"), { recursive: true });
	mkdirSync(join(root, "src"));
	const source = { s5: "src/admin.ts", s6: "src/enroll.ts" } as const;
	type Id = keyof typeof source;
	const intents = Object.fromEntries((Object.keys(source) as Id[]).map(id => {
		const taskId = id === "s5" ? prerequisiteId : id;
		const intent = parseTaskIntentV1({ contract: "assurance_kernel/task_intent/v1", task_id: taskId, owner: "user", goal: `Deliver ${taskId}`,
			scope_hint: [source[id], `docs/plans/${taskId}.intent.json`], risk: id === "s5" ? "critical" : dependentRisk, revision: 1,
			acceptance: [{ id: "AC1", assertion: `Deliver ${taskId}`, verification: "true" }] });
		writeFileSync(join(root, `docs/plans/${taskId}.intent.json`), JSON.stringify(intent, null, 2) + "\n");
		return [id, intent];
	})) as Record<Id, ReturnType<typeof parseTaskIntentV1>>;
	writeFileSync(join(root, "docs/initiatives/parent.md"), `# Parent\n## S5: admin\nTasks:\n- ${prerequisiteId}\n## S6: enroll\nTasks:\n- s6\nBlocked by: ${prerequisiteId}\n`);
	git("add", "."); git("commit", "-qm", "plan");
	const baseHead = git("rev-parse", "HEAD");
	/** Write the Task's bytes, then settle (or leave active) its Kernel run. */
	const settle = (id: Id, lifecycle: "done" | "stopped" | "active" = "done", bytes = `export const ${id} = true;\n`) => {
		writeFileSync(join(root, source[id]), bytes);
		const intent = intents[id];
		const taskId = intent.task_id;
		const record = { contract: "assurance_kernel/task_record/v4", task_id: taskId, intent_snapshot: intent,
			intent_ref: { path: `docs/plans/${taskId}.intent.json`, content_hash: canonicalIntentHash(intent) },
			lifecycle, artifact_state: lifecycle === "active" ? "active" : "frozen", baseline: `sha256:${"a".repeat(64)}`,
			git_base_head: baseHead, findings: [], history: [],
			attestations: lifecycle === "done" ? [{ id: `qa-${id}`, kind: "qa", authority_role: "qa", actor_id: "qa-actor",
				task_revision: 1, intent_content_hash: canonicalIntentHash(intent), diff_hash: deliveryHash(id), summary: "passed",
				acceptance_results: [{ acceptance_id: "AC1", status: "passed", summary: "passed" }] }] : [] };
		const seeded = seedKernelRunForTest(root, { task_id: taskId, record,
			...(lifecycle === "active" ? {} : { terminal: { lifecycle } }) });
		if (lifecycle !== "active") recoverKernelStoreFollowUps(root, taskId);
		return seeded.run_id;
	};
	const reader = async () => ({ contract: "immune_brain/github_initiative_observation/v1" as const,
		initiative_id: "parent", initiative_slug: "parent", issue_number: 1, carrier: "local" as const,
		tasks: [{ task_id: prerequisiteId, slice_id: "S5", blocked_by: [] as string[] }, { task_id: "s6", slice_id: "S6", blocked_by: [prerequisiteId] }] });
	return { root, git, baseHead, source, intents, settle, reader };
}
