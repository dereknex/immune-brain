// 2026-08-13-018 acc-user-approval-tui-wired.
// /imm-canary-authorize <task-id> record-user-approval records a user-kind
// approval on a review-phase task through the exact-action capability path
// after a fresh TUI confirmation; cancellation/abort/stale perform zero
// writes and the capability is consumed exactly once.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { enrollCanaryTask } from "../plugins/immune-brain/runtime/kernel/enrollment";
import { preparePiCanary } from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import { createEnrollmentAuthorityRegistry, type EnrollmentCapabilityBinding } from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { canonicalIntentHash } from "../plugins/immune-brain/runtime/kernel/intent";
import { readBackendClaim } from "../plugins/immune-brain/runtime/kernel/backend_claim";
import { readTaskRecordV2 } from "../plugins/immune-brain/runtime/kernel/storage";
import { createCanaryApplication } from "../plugins/immune-brain/runtime/kernel/canary_application";
import { createMutationAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/authority_port";
import { taskDiffHash } from "../plugins/immune-brain/runtime/workspace_scope";
import type { CanaryOperation } from "../plugins/immune-brain/runtime/kernel/canary_application";

const TASK = "canary-user-approval-task";
const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: TASK,
	goal: "user approval wiring",
	acceptance: [{ id: "A1", assertion: "a1", verification: "true" }],
	scope_hint: ["plugins/immune-brain/.pi-extension"],
	risk: "routine",
	revision: 1,
	owner: "user",
} as const;
const INTENT_HASH = canonicalIntentHash(INTENT);

interface FakeUI {
	notifyCalls: Array<{ text: string; kind: string }>;
	confirmCalls: Array<{ title: string; body: string }>;
}
function makeUI(): FakeUI {
	return { notifyCalls: [], confirmCalls: [] };
}

function makeReviewRoot(): { root: string; app: ReturnType<typeof createCanaryApplication> } {
	const root = mkdtempSync(join(tmpdir(), "uaw-tui-"));
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	mkdirSync(join(root, ".imm", "tasks"), { recursive: true });
	mkdirSync(join(root, "plugins", "immune-brain", ".pi-extension"), { recursive: true });
	execFileSync("git", ["init", "-q"], { cwd: root });
	writeFileSync(join(root, "plugins", "immune-brain", ".pi-extension", "owned.ts"), "baseline\n");
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
	const registry = createEnrollmentAuthorityRegistry();
	const prep = preparePiCanary(root, { task_id: TASK, now: "2026-08-12T10:00:00.000Z" });
	const binding: EnrollmentCapabilityBinding = {
		task_id: TASK,
		intent_path: `docs/plans/${TASK}.intent.json`,
		intent_revision: 1,
		intent_content_hash: INTENT_HASH,
		preparation_digest: prep.digest,
		readiness_digest: "sha256:none",
		evidence_digest: "sha256:none",
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
			capability: registry.issue(binding),
			capability_binding: binding,
			now: "2026-08-12T10:00:00.000Z",
		},
		registry,
	);
	const mutationRegistry = createMutationAuthorityRegistry();
	const app = createCanaryApplication(mutationRegistry);
	writeFileSync(join(root, "plugins", "immune-brain", ".pi-extension", "owned.ts"), "task snapshot\n");
	execFileSync("git", ["add", "--", "plugins/immune-brain/.pi-extension/owned.ts"], { cwd: root });
	// Advance to review: evidence then submit_review (ordinary ops).
	const token = () => {
		const { readTaskIntent } = require("../plugins/immune-brain/runtime/kernel/intent");
		return readTaskIntent(root, TASK).token;
	};
	app.execute({
		root,
		task_id: TASK,
		operation: { op: "record_evidence", acceptance_id: "A1", status: "passed", summary: "ok", actor_id: "executor-1" },
		prior_intent_token: token(),
		diffProvider: (projectRoot, intent) => taskDiffHash(projectRoot, intent.scope_hint),
		now: "2026-08-12T10:00:01.000Z",
	});
	app.execute({
		root,
		task_id: TASK,
		operation: { op: "submit_review", actor_id: "executor-1" },
		prior_intent_token: token(),
		diffProvider: (projectRoot, intent) => taskDiffHash(projectRoot, intent.scope_hint),
		now: "2026-08-12T10:00:02.000Z",
	});
	return { root, app };
}

function loadAuthorizeHandler(): (args: string, ctx: unknown) => Promise<void> {
	const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
	const factory = mod.default as (pi: ExtensionAPI) => void;
	let handler: ((args: string, ctx: unknown) => Promise<void>) | undefined;
	const pi = {
		registerTool: () => undefined,
		registerMessageRenderer: () => undefined,
		registerCommand: (name: string, spec: { handler: (args: string, ctx: unknown) => Promise<void> }) => {
			if (name === "imm-canary-authorize") handler = spec.handler;
		},
		on: () => () => {},
	} as unknown as ExtensionAPI;
	factory(pi);
	if (!handler) throw new Error("handler not registered");
	return handler;
}

function ctxFor(
	root: string,
	ui: FakeUI,
	confirmResult: boolean | (() => Promise<boolean>),
	mode = "tui",
) {
	return {
		mode,
		cwd: root,
		signal: new AbortController().signal,
		ui: {
			notify: (text: string, kind: string) => ui.notifyCalls.push({ text, kind }),
			confirm: async (title: string, body: string) => {
				ui.confirmCalls.push({ title, body });
				return typeof confirmResult === "function" ? confirmResult() : confirmResult;
			},
		},
	};
}

function approvals(root: string): Array<Record<string, unknown>> {
	return (readTaskRecordV2(root, TASK).record?.approvals ?? []) as Array<Record<string, unknown>>;
}

describe("record-user-approval TUI wiring", () => {
	test("non-TUI mode rejects before any confirm", async () => {
		const { root } = makeReviewRoot();
		try {
			const handler = loadAuthorizeHandler();
			const ui = makeUI();
			await handler(`${TASK} record-user-approval`, ctxFor(root, ui, true, "print"));
			expect(ui.confirmCalls.length).toBe(0);
			expect(ui.notifyCalls.some((n) => /TUI-only/i.test(n.text))).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("confirmed record-user-approval records a user-kind approval and stays in review", async () => {
		const { root } = makeReviewRoot();
		try {
			const handler = loadAuthorizeHandler();
			const ui = makeUI();
			await handler(`${TASK} record-user-approval`, ctxFor(root, ui, true));
			expect(ui.confirmCalls.length).toBe(1);
			expect(ui.notifyCalls.some((n) => /applied/.test(n.text))).toBe(true);
			const rec = readTaskRecordV2(root, TASK).record!;
			expect(rec.phase).toBe("review");
			const user = approvals(root).filter((a) => a.kind === "user");
			expect(user).toHaveLength(1);
			expect(user[0].authority_role).toBe("user");
			expect(user[0].actor_id).toBe("literal-user");
			expect(user[0].task_revision).toBe(1);
			expect(user[0].intent_content_hash).toBe(INTENT_HASH);
			// The handler applies through the real diff provider
			// (diffHashOf(root)), so the approval is bound to that hash.
			expect(user[0].diff_hash).toBe(taskDiffHash(root, INTENT.scope_hint));
			expect(readBackendClaim(root)?.lifecycle_status).toBe("active");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("cancellation performs zero writes", async () => {
		const { root } = makeReviewRoot();
		try {
			const handler = loadAuthorizeHandler();
			const ui = makeUI();
			await handler(`${TASK} record-user-approval`, ctxFor(root, ui, false));
			expect(ui.notifyCalls.some((n) => /cancelled/i.test(n.text))).toBe(true);
			expect(approvals(root).filter((a) => a.kind === "user")).toHaveLength(0);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("confirmation abort performs zero writes", async () => {
		const { root } = makeReviewRoot();
		try {
			const handler = loadAuthorizeHandler();
			const ui = makeUI();
			await handler(
				`${TASK} record-user-approval`,
				ctxFor(
					root,
					ui,
					async () => {
						throw new Error("aborted");
					},
				),
			);
			expect(ui.notifyCalls.some((n) => /aborted/i.test(n.text))).toBe(true);
			expect(approvals(root).filter((a) => a.kind === "user")).toHaveLength(0);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("stale record between confirmation and apply fails closed with zero writes", async () => {
		const { root, app } = makeReviewRoot();
		try {
			const handler = loadAuthorizeHandler();
			const ui = makeUI();
			await handler(
				`${TASK} record-user-approval`,
				ctxFor(
					root,
					ui,
					async () => {
						// Mutate the record inside the confirmation window: the
						// minted capability is bound to the pre-confirm revision,
						// so the apply must fail closed.
						const { readTaskIntent } = require("../plugins/immune-brain/runtime/kernel/intent");
						app.execute({
							root,
							task_id: TASK,
							operation: {
								op: "record_finding",
								finding: {
									id: "stale-finding",
									kind: "advisory",
									acceptance_id: null,
									summary: "stale probe",
								},
								actor_id: "executor-1",
							} as CanaryOperation,
							prior_intent_token: readTaskIntent(root, TASK).token,
							diffProvider: (projectRoot, intent) => taskDiffHash(projectRoot, intent.scope_hint),
							now: "2026-08-12T10:00:03.000Z",
						});
						return true;
					},
				),
			);
			expect(ui.notifyCalls.some((n) => /failed/i.test(n.text))).toBe(true);
			expect(approvals(root).filter((a) => a.kind === "user")).toHaveLength(0);
			expect(readBackendClaim(root)?.lifecycle_status).toBe("active");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
