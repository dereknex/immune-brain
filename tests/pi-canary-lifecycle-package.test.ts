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
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import { readBackendClaim } from "../plugins/immune-brain/runtime/kernel/backend_claim";

const ROOT = resolve(__dirname, "..");
const TASK = "canary-handoff-task";
const ACCEPTANCE = [{
	id: "A1",
	assertion: "acceptance script passes",
	verification: JSON.stringify({
		contract: "assurance_kernel/verification_descriptor/v1",
		runner_id: "bun",
		runner_version: "1.3.14",
		argv: ["run", "scripts/accept.ts"],
		cwd: ".",
		timeout_ms: 5_000,
		max_output_bytes: 16_384,
	}),
}] as const;
const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: TASK,
	goal: "handoff",
	acceptance: ACCEPTANCE,
	scope_hint: [
		"docs/plans/fixture.txt",
		"docs/specs/canary-handoff-task.spec.md",
		"docs/specs/archive/canary-handoff-task.spec.md",
	],
	risk: "routine",
	revision: 1,
	owner: "user",
} as const;
const INTENT_HASH = canonicalIntentHash(parseTaskIntentV1(INTENT));

function loadEnrollmentTool() {
	const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-enroll.ts");
	let tool: { execute: (...args: any[]) => Promise<any> } | undefined;
	const pi = {
		registerTool: (candidate: { name: string; execute: (...args: any[]) => Promise<any> }) => {
			if (candidate.name === "imm_canary_enrollment") tool = candidate;
		},
		registerCommand: () => undefined,
		on: () => undefined,
	};
	mod.default(pi);
	if (!tool) throw new Error("enrollment Tool not registered");
	return tool;
}

function enrollmentContext(root: string) {
	return {
		mode: "tui",
		hasUI: true,
		cwd: root,
		isIdle: () => true,
		ui: {
			custom: async (factory: any) => {
				let selected: boolean | undefined;
				const component = factory(
					{ requestRender: () => undefined },
					{ fg: (_color: string, text: string) => text, bold: (text: string) => text },
					{},
					(result: boolean) => { selected = result; },
				);
				component.handleInput?.("d");
				component.handleInput?.("\r");
				return selected ?? true;
			},
			notify: () => undefined,
			confirm: async () => true,
		},
	};
}

function loadWorkSurface(dependencies: Record<string, unknown> = {}) {
	const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
	const factory = mod.default as (pi: ExtensionAPI, dependencies?: Record<string, unknown>) => void;
	let tool: { execute: (id: string, params: unknown, s: unknown, u: unknown, ctx: unknown) => Promise<{ content: Array<{ type: string; text: string }> }> } | undefined;
	let commands: string[] = [];
	const events: Record<string, Array<(event: unknown) => unknown>> = {};
	const pi = {
		registerTool: (t: { name: string; execute: typeof tool extends undefined ? never : typeof tool }) => {
			if (t.name === "imm_kernel_canary") tool = t as never;
		},
		registerMessageRenderer: () => undefined,
		registerCommand: (name: string) => commands.push(name),
		on: (name: string, handler: (event: unknown) => unknown) => { (events[name] ??= []).push(handler); },
	} as unknown as ExtensionAPI;
	factory(pi, dependencies);
	return { tool, commands, events };
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
			"#kernel/reducer",
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
			"plugins/immune-brain/skills/imm-loop/SKILL.md",
		]) {
			expect(existsSync(join(ROOT, f))).toBe(true);
		}
		// The test issuer seam lives outside the shipped files.
		expect(existsSync(join(ROOT, "tests/fixtures/mutation-authority-test-seam.ts"))).toBe(true);
	});

	test("enrollment commits the durable tuple; lifecycle discovers it from a fresh projection", async () => {
		const root = mkdtempSync(join(tmpdir(), "p2b2-handoff-"));
		mkdirSync(join(root, "docs", "plans"), { recursive: true });
		mkdirSync(join(root, "docs", "specs"), { recursive: true });
		mkdirSync(join(root, ".imm", "tasks"), { recursive: true });
		execFileSync("git", ["init", "-q"], { cwd: root });
		writeFileSync(
			join(root, "docs", "plans", `${TASK}.intent.json`),
			JSON.stringify(INTENT, null, 2) + "\n",
		);
		writeFileSync(join(root, "docs", "specs", "canary-handoff-task.spec.md"), "# Canary handoff task\n");
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
			expect(parsed).toMatchObject({ lifecycle: "active", artifact_state: "active" });
			expect(parsed.intent_revision).toBe(1);
			expect(parsed.intent_content_hash).toBe(INTENT_HASH);
			expect(readBackendClaim(root)?.task_id).toBe(TASK);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("packaged Tool lifecycle settles Enrollment handoff through terminal completion without command invocation", async () => {
		const root = mkdtempSync(join(tmpdir(), "p2b2-tool-lifecycle-"));
		mkdirSync(join(root, "docs", "plans"), { recursive: true });
		mkdirSync(join(root, "docs", "specs"), { recursive: true });
		mkdirSync(join(root, ".imm", "tasks"), { recursive: true });
		mkdirSync(join(root, ".imm", "memory"), { recursive: true });
		mkdirSync(join(root, "scripts"), { recursive: true });
		writeFileSync(join(root, ".imm", "memory", "current_iteration.json"), JSON.stringify({ runtime_status: "idle", active_step: null }, null, 2) + "\n");
		writeFileSync(join(root, "docs", "plans", "fixture.txt"), "fixture\n");
		writeFileSync(join(root, "scripts", "accept.ts"), "process.exit(0);\n");
		execFileSync("git", ["init", "-q"], { cwd: root });
		writeFileSync(join(root, "docs", "plans", `${TASK}.intent.json`), JSON.stringify(INTENT, null, 2) + "\n");
		writeFileSync(join(root, "docs", "specs", "canary-handoff-task.spec.md"), "# Canary handoff task\n");
		execFileSync("git", ["add", "-A"], { cwd: root });
		execFileSync("git", ["commit", "-qm", "intent"], { cwd: root });
		writeFileSync(join(root, ".imm", "workspace.json"), JSON.stringify({ contract: "assurance_kernel/workspace/v1", current_working: null }, null, 2) + "\n");
		try {
			const enrollmentTool = loadEnrollmentTool();
			const enrollment = await enrollmentTool.execute(
				"enrollment",
				{ action: "new", task_id: TASK },
				undefined,
				undefined,
				enrollmentContext(root),
			);
			expect(enrollment.details).toMatchObject({ state: "completed" });
			expect(readBackendClaim(root)?.task_id).toBe(TASK);

			const surface = loadWorkSurface({
				buildAssurance: async (rootPath: string, _task: string, role: "qa" | "review", current: { projection: Record<string, any> }) => ({
					snapshot: {
						contract: "assurance_kernel/assurance_snapshot/v2",
						task_id: TASK,
						role,
						record_revision: current.projection.record_revision,
						workspace_revision: current.projection.workspace_revision,
						intent_revision: current.projection.intent_revision,
						intent_content_hash: current.projection.intent_content_hash,
						diff_hash: current.projection.diff_hash,
						lifecycle: current.projection.lifecycle,
						artifact_state: current.projection.artifact_state,
						risk: "routine",
						fresh_acceptance_ids: current.projection.fresh_acceptance_ids,
						missing_acceptance_ids: current.projection.missing_acceptance_ids,
						stale_attestation_ids: current.projection.stale_attestation_ids,
						acceptance: ACCEPTANCE,
						dirty_files: [],
						review_bundle_digest: null,
						root: rootPath,
					},
					descriptors: new Map(),
					reviewBundle: null,
				}),
				runQa: async (snapshot: Record<string, unknown>) => ({
					contract: "assurance_kernel/assurance_verdict/v2",
					role: "qa",
					task_id: TASK,
					snapshot_digest: require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts").snapshotDigest(snapshot),
					decision: "pass",
					approval: { kind: "qa", authority_role: "qa", summary: "passed" },
				}),
			});
			const ctx = { mode: "tui", cwd: root, ui: { notify: () => undefined } };
			await surface.tool!.execute("freeze", { task_id: TASK, action: { op: "freeze_artifacts" } }, undefined, undefined, ctx);
			const completed = await surface.tool!.execute("advance", { task_id: TASK, action: { op: "advance_assurance" } }, undefined, undefined, ctx);
			expect(JSON.parse(completed.content[0].text)).toMatchObject({ state: "completed", next_action: "none", task_state: { lifecycle: "done" } });
			const terminalStatus = await surface.tool!.execute("terminal-status", { task_id: TASK, action: { op: "status" } }, undefined, undefined, ctx);
			expect(JSON.parse(terminalStatus.content[0].text)).toMatchObject({ lifecycle: "done", next_obligation: "none" });
			expect(terminalStatus.details).toMatchObject({ lifecycle: "done", next_action: "none" });
			expect(surface.commands).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}, 15_000);

	test("lifecycle surface registers the foreground Tool without Slash Commands", () => {
		const { tool, commands } = loadWorkSurface();
		expect(tool).toBeDefined();
		expect(commands).toEqual([]);
	});
});
