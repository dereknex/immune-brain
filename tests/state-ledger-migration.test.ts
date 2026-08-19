import { afterEach, describe, expect, it } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	AUTHORITY_OBSERVATION_GENERATION_V2,
	AUTHORITY_OBSERVER_VERSION_V2,
	authorityStatePathIdentity,
	prepareAuthorityCommit,
	readAuthorityCommitReceipts,
	terminalizeAuthorityCommit,
	type AuthorityObservationSeedV2,
} from "../plugins/immune-brain/runtime/authority_commit_receipts";
import { buildAutomaticObservationV2 } from "../plugins/immune-brain/runtime/kernel/observation";
import {
	appendAutomaticObservationV2,
	readAutomaticObservationsV2,
} from "../plugins/immune-brain/runtime/kernel/automatic_observations";
import {
	buildPlanSignature,
	normalizePlan,
	parsePlan,
} from "../plugins/immune-brain/runtime/plan_core";

const roots: string[] = [];

function tempRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "imm-v3-projection-"));
	roots.push(root);
	mkdirSync(join(root, ".imm", "memory"), { recursive: true });
	return root;
}

function sha256(value: string): string {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function seedFor(
	statePath: string,
	content: string,
): AuthorityObservationSeedV2 {
	return {
		contract: "assurance_kernel/authority_observation_seed/v2",
		observer_version: AUTHORITY_OBSERVER_VERSION_V2,
		source_kind: "state_mutation",
		source_ref: `history:${randomUUID()}`,
		state_path_identity: authorityStatePathIdentity(statePath),
		committed_bytes_sha256: sha256(content),
		committed_revision: "ledger-revision-1",
		committed_at: "2026-08-11T00:00:00.000Z",
		plan_path: "tests/fixtures/roadmap-transition/predecessor.md",
		plan_signature: "plan-signature",
		source_events: [
			{
				id: "history-1",
				action: "execution_recorded",
				at: "2026-08-11T00:00:00.000Z",
			},
		],
		shadow: {
			phase: "working",
			reason: "legacy-active",
			ambiguous: false,
			source_states: ["active"],
		},
		divergence: { detected: false, fields: [] },
	};
}

afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

describe("retained v3 projection surfaces", () => {
	it("keeps Plan identity parsing and v2 authority observations executable", () => {
		const repoRoot = resolve(import.meta.dir, "..");
		const plan = normalizePlan(
			parsePlan(join(import.meta.dir, "fixtures/roadmap-transition/predecessor.md")),
			repoRoot,
		);
		expect(plan.plan_path).toBe("tests/fixtures/roadmap-transition/predecessor.md");
		expect(buildPlanSignature(plan)).toMatch(/^[0-9a-f]{64}$/);

		const root = tempRoot();
		const statePath = join(root, ".imm/memory/current_iteration.json");
		const content = '{"schema_version":3}\n';
		writeFileSync(statePath, content);
		const seed = seedFor(statePath, content);
		const prepared = prepareAuthorityCommit(statePath, {
			source_kind: "state_mutation",
			targets: [{ absolute_path: statePath, before_bytes: "before", after_bytes: content }],
			ledger_revision: seed.committed_revision,
			source_ref: seed.source_ref,
			attempt_id: randomUUID(),
			observation_generation: AUTHORITY_OBSERVATION_GENERATION_V2,
			observation_seed: seed,
		});
		const terminal = terminalizeAuthorityCommit(statePath, prepared, "committed");
		const observation = buildAutomaticObservationV2(terminal);

		expect(readAuthorityCommitReceipts(statePath).at(-1)?.status).toBe("committed");
		expect(appendAutomaticObservationV2(root, observation)).toBe("appended");
		expect(readAutomaticObservationsV2(root)).toEqual([observation]);
	});
});
