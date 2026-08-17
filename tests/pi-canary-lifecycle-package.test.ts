// P2B2 U2: root package composition and enrollment -> lifecycle handoff.
// Covers the root Pi package as the composition boundary between the two
// authority domains, the durable tuple handoff discovered from a fresh
// projection, and the packed package excluding fixtures while shipping both
// extensions and the Skill.

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { enrollCanaryTask } from "../plugins/immune-brain/runtime/kernel/enrollment";
import { preparePiCanary } from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import {
	createEnrollmentAuthorityRegistry,
	type EnrollmentCapabilityBinding,
} from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { canonicalIntentHash } from "../plugins/immune-brain/runtime/kernel/intent";
import { readBackendClaim } from "../plugins/immune-brain/runtime/kernel/backend_claim";

const ROOT = resolve(__dirname, "..");
const TASK = "canary-handoff-task";
const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: TASK,
	goal: "handoff",
	acceptance: [{ id: "A1", assertion: "a1", verification: "true" }],
	scope_hint: ["plugins/immune-brain/.pi-extension"],
	risk: "routine",
	revision: 1,
	owner: "user",
} as const;
const INTENT_HASH = canonicalIntentHash(INTENT);

function loadWorkSurface() {
	const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
	const factory = mod.default as (pi: ExtensionAPI) => void;
	let tool: { execute: (id: string, params: unknown, s: unknown, u: unknown, ctx: unknown) => Promise<{ content: Array<{ type: string; text: string }> }> } | undefined;
	let commands: string[] = [];
	const pi = {
		registerTool: (t: { name: string; execute: typeof tool extends undefined ? never : typeof tool }) => {
			if (t.name === "imm_kernel_canary") tool = t as never;
		},
		registerMessageRenderer: () => undefined,
		registerCommand: (name: string) => commands.push(name),
		on: () => () => {},
	} as unknown as ExtensionAPI;
	factory(pi);
	return { tool, commands };
}

describe("pi canary lifecycle package composition", () => {
	test("package.json imports map every kernel module used by the extensions", () => {
		const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
		for (const key of [
			"#kernel/enrollment_authority",
			"#kernel/pi_canary_prepare",
			"#kernel/canary_eligibility",
			"#kernel/enrollment",
			"#kernel/authority_port",
			"#kernel/canary_application",
			"#kernel/backend_claim",
			"#kernel/storage",
			"#kernel/intent",
			"#kernel/reducer_v2",
		]) {
			expect(pkg.imports[key]).toBeDefined();
		}
		expect(pkg.pi.extensions).toEqual(["./plugins/immune-brain/.pi-extension"]);
		expect(pkg.pi.skills).toContain("./plugins/immune-brain/skills");
	});

	test("packed files ship both extensions and the Skill; exclude tests/fixtures", () => {
		const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
		const files = pkg.files as string[];
		expect(files).toContain("plugins/immune-brain/.pi-extension");
		expect(files).toContain("plugins/immune-brain/skills");
		expect(files).not.toContain("tests");
		for (const f of [
			"plugins/immune-brain/.pi-extension/imm-canary-enroll.ts",
			"plugins/immune-brain/.pi-extension/imm-canary-work.ts",
			"plugins/immune-brain/skills/imm-canary-work/SKILL.md",
		]) {
			expect(existsSync(join(ROOT, f))).toBe(true);
		}
		// The test issuer seam lives outside the shipped files.
		expect(existsSync(join(ROOT, "tests/fixtures/mutation-authority-test-seam.ts"))).toBe(true);
	});

	test("enrollment commits the durable tuple; lifecycle discovers it from a fresh projection", async () => {
		const root = mkdtempSync(join(tmpdir(), "p2b2-handoff-"));
		mkdirSync(join(root, "docs", "plans"), { recursive: true });
		mkdirSync(join(root, ".imm", "tasks"), { recursive: true });
		execFileSync("git", ["init", "-q"], { cwd: root });
		writeFileSync(
			join(root, "docs", "plans", `${TASK}.intent.json`),
			JSON.stringify(INTENT, null, 2) + "\n",
		);
		execFileSync("git", ["add", "-A"], { cwd: root });
		execFileSync("git", ["commit", "-qm", "intent"], { cwd: root });
		writeFileSync(
			join(root, ".imm", "workspace.json"),
			JSON.stringify(
				{ contract: "assurance_kernel/workspace/v1", current_working: null },
				null,
				2,
			) + "\n",
		);
		try {
			const enrollmentRegistry = createEnrollmentAuthorityRegistry();
			const prep = preparePiCanary(root, { task_id: TASK, now: "2026-08-12T10:00:00.000Z" });
			const binding: EnrollmentCapabilityBinding = {
				task_id: TASK,
				intent_path: `docs/plans/${TASK}.intent.json`,
				intent_revision: 1,
				intent_content_hash: INTENT_HASH,
				preparation_digest: prep.digest,
				readiness_digest: "sha256:r",
				evidence_digest: "sha256:e",
				waiver_gate: "observation_window_days",
				actor_id: "user",
				confirmation_ref: "c",
				expires_at: "2099-01-01T00:00:00.000Z",
				nonce: "n",
			};
			enrollCanaryTask(
				root,
				{
					task_id: TASK,
					intent_path: `docs/plans/${TASK}.intent.json`,
					intent_revision: 1,
					preparation_digest: binding.preparation_digest,
					capability: enrollmentRegistry.issue(binding),
					capability_binding: binding,
					now: "2026-08-12T10:00:00.000Z",
				},
				enrollmentRegistry,
			);
			// The lifecycle extension has no shared object with enrollment:
			// it discovers the same exact task from a fresh projection.
			const { tool } = loadWorkSurface();
			expect(tool).toBeDefined();
			const ctx = {
				mode: "print",
				cwd: root,
				signal: new AbortController().signal,
				ui: { notify: () => undefined, confirm: async () => true },
			};
			const result = await tool!.execute("c1", { task_id: TASK, action: { op: "status" } }, undefined, undefined, ctx);
			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.phase).toBe("working");
			expect(parsed.intent_revision).toBe(1);
			expect(parsed.intent_content_hash).toBe(INTENT_HASH);
			expect(readBackendClaim(root)?.task_id).toBe(TASK);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("lifecycle surface registers the tool and both commands exactly once", () => {
		const { tool, commands } = loadWorkSurface();
		expect(tool).toBeDefined();
		expect(commands.sort()).toEqual(["imm-canary-assure", "imm-canary-authorize", "imm-canary-succeed"]);
	});
});
