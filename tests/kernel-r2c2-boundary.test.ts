import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as kernel from "../plugins/immune-brain/runtime/kernel/index";
import * as storage from "../plugins/immune-brain/runtime/kernel/storage";
import { readSettledTaskEvidence } from "../plugins/immune-brain/runtime/kernel/storage";
import {
	canonicalIntentHash,
	readTaskIntent,
} from "../plugins/immune-brain/runtime/kernel/intent";
import type { TaskAction } from "../plugins/immune-brain/runtime/kernel/types";
import type { TaskRecordV2 } from "../plugins/immune-brain/runtime/kernel/legacy_task_record";
import { applyTaskAction } from "../plugins/immune-brain/runtime/kernel/application";
import * as applicationV2 from "../plugins/immune-brain/runtime/kernel/application";

const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: "task-r2c2-b",
	goal: "One outcome",
	acceptance: [
		{ id: "A1", assertion: "acceptance one", verification: "verify one" },
	],
	scope_hint: ["docs/plans"],
	risk: "routine",
	revision: 1,
	owner: "user",
} as const;

function recordFixture(): TaskRecordV2 {
	return {
		contract: "assurance_kernel/task_record/v2",
		task_id: "task-r2c2-b",
		intent_revision: 1,
		intent_snapshot: INTENT,
		intent_ref: {
			path: "docs/plans/task-r2c2-b.intent.json",
			revision: 1,
			content_hash: canonicalIntentHash(INTENT),
		},
		phase: "working",
		baseline: "sha256:" + "0".repeat(64),
		evidence: [],
		findings: [],
		approvals: [],
		history: [],
	};
}

describe("R2C2 boundary and compatibility", () => {
	test("index exports the pure reducer and application port but no issuer", () => {
		expect(typeof kernel.reduceTask).toBe("function");
		expect(typeof kernel.canonicalRecordHash).toBe("function");
		// The mutation port is exported from its own module for future trusted
		// host integration, but the public index stays mutation-surface-free.
		expect(typeof applicationV2.applyTaskAction).toBe("function");
		expect((kernel as Record<string, unknown>).applyTaskAction).toBeUndefined();
		// No authority issuer, capability constructor, token consumer, or
		// token unwrap may leak through the public index.
		expect((kernel as Record<string, unknown>).createMutationAuthorityCapabilityForTest).toBeUndefined();
		expect((kernel as Record<string, unknown>).consumeAuthorityCapability).toBeUndefined();
		expect((kernel as Record<string, unknown>).inspectAuthorityCapability).toBeUndefined();
		expect((kernel as Record<string, unknown>).consumeIntentToken).toBeUndefined();
		expect((kernel as Record<string, unknown>).inspectIntentTokenPair).toBeUndefined();
		expect((kernel as Record<string, unknown>).mintToken).toBeUndefined();
	});

	test("legacy reducer and storage entry points are retired", () => {
		expect((kernel as Record<string, unknown>).reduceTaskV1).toBeUndefined();
		// The forwarding readTaskRecord export is gone (deepen-authority-seams D6):
		// callers use readTaskRecordRaw.
		expect(typeof storage.readTaskRecordRaw).toBe("function");
		expect((storage as Record<string, unknown>).readTaskRecord).toBeUndefined();
		expect(typeof storage.withKernelStoreLock).toBe("function");
		expect(typeof storage.setAfterTaskTransactionWriteForTest).toBe("function");
		expect(typeof storage.readWorkspaceStateRaw).toBe("function");
	});

	test("no v2 creation path exists in storage", () => {
		const storageNames = Object.keys(storage).filter((key) =>
			key.toLowerCase().includes("v2"),
		);
		// Only read/commit primitives; no create/write/enroll surface.
		expect(storageNames.some((name) => /create|write|enroll/.test(name))).toBe(false);
	});

	test("applyTaskAction input does not expose authority minting", () => {
		// The port's public surface is the function; capability creation stays
		// module-private. Calling the port with a plain object fails.
		expect(() =>
			applyTaskAction({
				root: "/nonexistent",
				task_id: "x",
				action: { type: "stop" },
				prior_intent_token: {} as never,
				diffProvider: () => "sha256:" + "0".repeat(64),
			}),
		).toThrow();
	});

	test("reducer v2 result is branded and non-constructible", () => {
		// A caller-built plain object cannot pass the brand check.
		expect(
			kernel.isReducedMutation({ record: recordFixture(), next_workspace_working: null }),
		).toBe(false);
	});
});

// AC2 import boundary (deepen-authority-seams D6.2): the Kernel store is reached
// only inside runtime/kernel. Every module outside it goes through the storage
// read surface, so a caller can never open the authoritative database itself.
describe("kernel store import boundary (D6.2)", () => {
	const pluginRoot = resolve(import.meta.dir, "..", "plugins", "immune-brain");

	function sourceFiles(dir: string): string[] {
		const found: string[] = [];
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) found.push(...sourceFiles(path));
			else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) found.push(path);
		}
		return found;
	}

	const isKernelInternal = (path: string) => path.includes(`${"runtime"}/kernel/`);
	const importsStore = (source: string) => /from\s+["'][^"']*sqlite_store["']/.test(source);

	test("no module outside runtime/kernel imports the Kernel store", () => {
		const violators = sourceFiles(pluginRoot)
			.filter((path) => !isKernelInternal(path))
			.filter((path) => importsStore(readFileSync(path, "utf8")))
			.map((path) => path.slice(pluginRoot.length + 1));
		expect(violators).toEqual([]);
	});

	test("the boundary matcher itself is proven by a synthetic violation", () => {
		// A negative control: a probe that imports the store outside runtime/kernel
		// is flagged, and the same import inside runtime/kernel is not.
		const probe = 'import { withKernelTransaction } from "../kernel/sqlite_store";\n';
		expect(isKernelInternal(join(pluginRoot, "runtime/kernel/enrollment.ts"))).toBe(true);
		expect(importsStore(probe)).toBe(true);
		expect(
			isKernelInternal(join(pluginRoot, "runtime/unattended/batch_git.ts")) && importsStore(probe),
		).toBe(false);
		// The read surface that callers do use stays importable from the module.
		expect(typeof readSettledTaskEvidence).toBe("function");
	});
});
