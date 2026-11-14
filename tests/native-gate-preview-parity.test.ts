// The Antigravity PreToolUse Hook shows the confirmation a preview built; the
// MCP call later opens its own gate. They must agree field for field, or the
// single-use grant bound to the preview would not match the call it authorizes.

import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AntigravityRuntime } from "../plugins/immune-brain/runtime/antigravity/kernel_ports";
import type { NativeConfirmationInput } from "../plugins/immune-brain/runtime/host-core/interaction";
import { enrollTaskForTest } from "./helpers/kernel-enroll";

const roots: string[] = [];
const probeHost = () => ({ ok: true as const, version: "1.0.0", platform: process.platform });

function fixture(taskId: string): { root: string; intent: Record<string, unknown> } {
	const root = mkdtempSync(join(tmpdir(), "imm-gate-parity-"));
	roots.push(root);
	const intent = {
		contract: "assurance_kernel/task_intent/v1",
		task_id: taskId,
		owner: "user",
		goal: "preview parity",
		acceptance: [{ id: "acc-1", assertion: "initial assertion", verification: "bun test" }],
		scope_hint: [`docs/plans/${taskId}.intent.json`, `docs/specs/${taskId}.spec.md`, `docs/specs/archive/${taskId}.spec.md`],
		risk: "routine",
		revision: 1,
	};
	mkdirSync(join(root, ".imm", "state"), { recursive: true });
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	mkdirSync(join(root, "docs", "specs", "archive"), { recursive: true });
	writeFileSync(join(root, "docs", "plans", `${taskId}.intent.json`), `${JSON.stringify(intent, null, 2)}\n`);
	writeFileSync(join(root, "docs", "specs", `${taskId}.spec.md`), `# ${taskId}\n`);
	writeFileSync(join(root, ".gitignore"), ".imm/state/\n");
	execFileSync("git", ["init", "-q"], { cwd: root });
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "fixture"], { cwd: root });
	return { root, intent };
}

const runtimeFor = (root: string, requestConfirmation?: (input: NativeConfirmationInput) => Promise<{ decision: "cancel"; requestId: string }>) =>
	new AntigravityRuntime({ cwd: root, env: {}, interactive: true, probeHost, ...(requestConfirmation ? { requestConfirmation } : {}) });

const metaFor = (taskId: string) => ({ sessionId: "s", toolCallId: "call-1", taskId, interactive: true });
/** The fields the Host adds around the shared input are not part of the comparison. */
const comparable = (input: NativeConfirmationInput) => {
	const { signal: _s, admissionId: _a, workspace: _w, ...rest } = input as NativeConfirmationInput & { signal?: unknown; admissionId?: unknown; workspace?: unknown };
	return rest;
};
const porcelain = (root: string) => execFileSync("git", ["status", "--porcelain"], { cwd: root }).toString();

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("native gate preview parity", () => {
	const cases: Array<{ operation: string; extra: (intent: Record<string, unknown>) => Record<string, unknown> }> = [
		{ operation: "stop", extra: () => ({ reason: "done" }) },
		{
			operation: "approve_breaking_intent_revision",
			extra: (intent) => ({ next_intent: { ...intent, acceptance: [{ id: "acc-1", assertion: "revised assertion", verification: "bun test" }], revision: 2 } }),
		},
	];

	for (const { operation, extra } of cases) {
		test(`${operation}: the preview input equals the input the real call's gate receives`, async () => {
			const taskId = `parity-${operation.replace(/_/g, "-")}`;
			const { root, intent } = fixture(taskId);
			await enrollTaskForTest(root, taskId);
			const sidecar = join(root, "docs", "plans", `${taskId}.intent.json`);
			const sidecarBefore = readFileSync(sidecar, "utf8");
			const dirtyBefore = porcelain(root);

			const previewRuntime = runtimeFor(root);
			let previewed: NativeConfirmationInput | null;
			try {
				previewed = await previewRuntime.previewAuthorization(taskId, operation, metaFor(taskId), extra(intent));
			} finally {
				await previewRuntime.shutdown();
			}
			expect(previewed).not.toBeNull();
			// The preview applies nothing and leaves the sidecar and index as they were.
			expect(readFileSync(sidecar, "utf8")).toBe(sidecarBefore);
			expect(porcelain(root)).toBe(dirtyBefore);

			let gated: NativeConfirmationInput | null = null;
			const realRuntime = runtimeFor(root, async (input) => {
				gated = input;
				return { decision: "cancel", requestId: "parity" };
			});
			try {
				await realRuntime.authorize(taskId, operation, metaFor(taskId), extra(intent)).catch(() => undefined);
			} finally {
				await realRuntime.shutdown();
			}
			expect(gated).not.toBeNull();
			expect(comparable(previewed!)).toEqual(comparable(gated!));
			// Not two empty shells: the input names the task and, for a revision, its digest binding.
			expect(previewed).toMatchObject({ operation, taskId, toolCallId: "call-1" });
			if (operation === "approve_breaking_intent_revision") expect(previewed!.bindingDigest).toMatch(/\S+:\S+/);
			expect(previewed!.operation).toBe(operation);
		}, 60_000);
	}
});
