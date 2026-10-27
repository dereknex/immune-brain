import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalIntentHash, readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import { canonicalRecordHash, reduceTask, reviewIncompleteHistory } from "../plugins/immune-brain/runtime/kernel/reducer";
import { parseTaskAction, parseTaskRecord } from "../plugins/immune-brain/runtime/kernel/validation";
import { capabilityActionFor, createCanaryApplication, type CanaryOperation } from "../plugins/immune-brain/runtime/kernel/canary_application";
import { createMutationAuthorityRegistry, digestOfAction } from "../plugins/immune-brain/runtime/kernel/authority_port";
import { readTaskRecordRaw, readWorkspaceStateRaw } from "../plugins/immune-brain/runtime/kernel/storage";
import { seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";
import type { AuthorityAuditDescriptor, TaskAction, TaskRecord } from "../plugins/immune-brain/runtime/kernel/types";

const hash = (c: string) => `sha256:${c.repeat(64)}`;
const DIFF = hash("d"), OLD = hash("a"), CURRENT = hash("b"), WS = hash("e");
const intent = { contract: "assurance_kernel/task_intent/v1", task_id: "review-retry", goal: "Bounded retry", acceptance: [{ id: "A1", assertion: "works", verification: "check" }], scope_hint: ["src/a.ts"], risk: "material", revision: 1, owner: "user" } as const;
const INTENT = canonicalIntentHash(intent);
const identity = { intent_content_hash: INTENT, diff_hash: DIFF };
const audit: AuthorityAuditDescriptor = { authority_kind: "user", actor_id: "literal-user", confirmation_ref: "native-confirm", issued_at: "now" };
const fingerprint = `\naction_v2_sha256:${"f".repeat(64)}`;
function incompleteEvent(budget: number, contract?: string) {
	return { id: `incomplete-${budget}`, at: "now", type: "record_review_incomplete", from_state: "active:frozen", to_state: "active:frozen", reason: JSON.stringify({ ...identity, turn_budget: budget, inspected_paths: [], reason: "unfinished", ...(contract ? { review_contract_hash: contract } : {}) }) + fingerprint };
}
function grantEvent(contract = CURRENT) {
	return { id: "grant", at: "now", type: "authorize_review_retry", from_state: "active:frozen", to_state: "active:frozen", authority: audit, reason: JSON.stringify({ ...identity, review_contract_hash: contract }) + fingerprint };
}
function fixture(legacy = false): TaskRecord {
	return parseTaskRecord({ contract: "assurance_kernel/task_record/v4", task_id: intent.task_id, intent_snapshot: intent,
		intent_ref: { path: `docs/plans/${intent.task_id}.intent.json`, content_hash: INTENT }, lifecycle: "active", artifact_state: "frozen", baseline: hash("0"), git_base_head: "a".repeat(40),
		attestations: [{ id: "qa", kind: "qa", authority_role: "qa", task_revision: 1, intent_content_hash: INTENT, diff_hash: DIFF, actor_id: "qa", summary: "passed", acceptance_results: [{ acceptance_id: "A1", status: "passed", summary: "passed" }] }], findings: [], history: [incompleteEvent(16, legacy ? undefined : OLD), incompleteEvent(32, legacy ? undefined : OLD)] });
}
function grant(record: TaskRecord): TaskAction {
	return { ...capabilityActionFor({ op: "authorize_review_retry", task_id: intent.task_id, at: "retry", actor_id: "literal-user", intent_content_hash: INTENT, review_contract_hash: CURRENT }), expected_record_hash: canonicalRecordHash(record), expected_workspace_hash: WS, diff_hash: DIFF };
}
function third(record: TaskRecord, overrides = {}): TaskAction {
	return { type: "record_review_incomplete", event_id: "third", at: "third", actor_id: "reviewer", expected_record_hash: canonicalRecordHash(record), expected_workspace_hash: WS, ...identity, turn_budget: 64, inspected_paths: [], reason: "unfinished", review_contract_hash: CURRENT, ...overrides } as TaskAction;
}

describe("snapshot-bound literal-user Review retry", () => {
	for (const legacy of [false, true]) test(`one grant preserves all non-history state (legacy=${legacy})`, () => {
		const before = fixture(legacy), action = grant(before);
		const after = reduceTask(before, action, audit, ["src/a.ts"]).record;
		expect({ ...after, history: before.history }).toEqual(before);
		expect(after.history.slice(0, -1)).toEqual(before.history);
		expect(after.history.at(-1)?.authority).toEqual(audit);
		expect(reviewIncompleteHistory(after.history, identity)).toEqual({ count: 2, previous_budget: 32, round_limit: 3, last_contract_hash: legacy ? null : OLD, retry_authorized: true, authorized_contract_hash: CURRENT });
		expect(reduceTask(after, action, audit, ["src/a.ts"]).record).toEqual(after);
		expect(() => reduceTask(after, { ...grant(after), event_id: "second-grant" }, audit, ["src/a.ts"])).toThrow();
		const exhausted = reduceTask(after, third(after), null, ["src/a.ts"]).record;
		expect(reviewIncompleteHistory(exhausted.history, identity)).toMatchObject({ count: 3, previous_budget: 64, last_contract_hash: CURRENT, round_limit: 3 });
		expect(() => reduceTask(exhausted, third(exhausted, { event_id: "fourth", turn_budget: 96 }), null, ["src/a.ts"])).toThrow();
	});

	for (const authority of [null, { ...audit, authority_kind: "review" as const }, { ...audit, authority_kind: "qa" as const }, { ...audit, actor_id: "executor" }]) test(`rejects non-user authority ${JSON.stringify(authority)}`, () => {
		const record = fixture();
		expect(() => reduceTask(record, grant(record), authority, ["src/a.ts"])).toThrow(/authority/);
	});
	for (const change of [ { artifact_state: "active" }, { lifecycle: "stopped" }, { attestations: [] }, { attestations: [{ ...fixture().attestations[0], diff_hash: hash("c") }] }, { history: [] }, { history: [incompleteEvent(16, OLD)] } ]) test(`rejects ineligible snapshot ${JSON.stringify(change)}`, () => {
		const record = { ...fixture(), ...change } as TaskRecord;
		expect(() => reduceTask(record, grant(record), audit, ["src/a.ts"])).toThrow();
	});
	test("rejects unchanged contract, wrong intent/diff and missing changed paths", () => {
		const record = fixture(), action = grant(record);
		for (const override of [{ review_contract_hash: OLD }, { intent_content_hash: hash("c") }, { diff_hash: hash("c") }]) expect(() => reduceTask(record, { ...action, ...override } as TaskAction, audit, ["src/a.ts"])).toThrow();
		expect(() => reduceTask(record, action, audit)).toThrow();
	});
	test("third incomplete requires exact doubled budget and granted contract", () => {
		const before = fixture(), record = reduceTask(before, grant(before), audit, ["src/a.ts"]).record;
		for (const override of [{ turn_budget: 32 }, { turn_budget: 96 }, { review_contract_hash: OLD }, { review_contract_hash: undefined }]) expect(() => reduceTask(record, third(record, override), null, ["src/a.ts"])).toThrow();
		const capped = [incompleteEvent(48, OLD), incompleteEvent(96, OLD), grantEvent(), incompleteEvent(96, CURRENT)];
		expect(reviewIncompleteHistory(capped, identity).previous_budget).toBe(96);
	});
	test("history is snapshot scoped, keeps legacy read-only compatibility, validates every sequence", () => {
		const legacy = fixture(true).history;
		expect(reviewIncompleteHistory(legacy, identity)).toEqual({ count: 2, previous_budget: 32, round_limit: 2, last_contract_hash: null, retry_authorized: false, authorized_contract_hash: null });
		expect(reviewIncompleteHistory([...legacy, grantEvent()], { ...identity, diff_hash: hash("c") })).toMatchObject({ count: 0, round_limit: 2, retry_authorized: false });
		for (const entries of [
			[grantEvent()], [legacy[0]!, grantEvent()], [...legacy, grantEvent(), grantEvent()],
			[...legacy, incompleteEvent(64, CURRENT)], [...legacy, grantEvent(), incompleteEvent(64)],
			[...legacy, grantEvent(), incompleteEvent(64, OLD)], [...legacy, grantEvent(), incompleteEvent(96, CURRENT)],
			[...legacy, { ...grantEvent(), reason: grantEvent().reason.replace(CURRENT, "invalid") }],
			[...legacy, { ...grantEvent(), reason: grantEvent().reason.replace(INTENT, hash("c")) }],
			[...legacy, { ...grantEvent(), reason: grantEvent().reason.replace(DIFF, hash("c")) }],
			[...legacy, { ...grantEvent(), reason: grantEvent().reason.split("\n")[0]! }],
			[incompleteEvent(16, CURRENT), incompleteEvent(32, CURRENT), grantEvent()],
		]) expect(() => reviewIncompleteHistory(entries, identity)).toThrow();
	});
	test("strict action parsing and capability digest bind both hashes", () => {
		const action = grant(fixture());
		expect(parseTaskAction(action)).toEqual(action);
		for (const override of [{ review_contract_hash: "invalid" }, { intent_content_hash: "invalid" }, { extra: true }]) expect(() => parseTaskAction({ ...action, ...override })).toThrow();
		expect(digestOfAction(action)).not.toBe(digestOfAction({ ...action, review_contract_hash: OLD } as TaskAction));
		expect(digestOfAction(action)).not.toBe(digestOfAction({ ...action, intent_content_hash: hash("c") } as TaskAction));
		const live = { ...fixture(), history: [] };
		expect(() => reduceTask(live, third(live, { review_contract_hash: undefined, turn_budget: 16 }), null, ["src/a.ts"])).toThrow(/live incomplete/);
	});
});

test("canary requires trusted host hash and capability; commits history only", () => {
	const root = mkdtempSync(join(tmpdir(), "review-retry-authority-"));
	try {
		const record = fixture(true);
		mkdirSync(join(root, "docs/plans"), { recursive: true });
		const intentPath = join(root, record.intent_ref.path);
		writeFileSync(intentPath, JSON.stringify(intent, null, 2) + "\n");
		const git = (...args: string[]) => execFileSync("git", args, { cwd: root, env: { ...process.env, GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "f@f", GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "f@f" } });
		git("init", "-q"); git("add", "docs"); git("commit", "-qm", "fixture");
		seedKernelRunForTest(root, { task_id: intent.task_id, created_at: "now", updated_at: "now", record });
		const registry = createMutationAuthorityRegistry(), app = createCanaryApplication(registry);
		const diffProvider = () => ({ diff_hash: DIFF, changed_paths: ["src/a.ts"] });
		const execute = (operation: CanaryOperation, reviewContractHash?: string, now = "retry") => app.execute({ root, task_id: intent.task_id, operation, reviewContractHash, now, diffProvider, prior_intent_token: readTaskIntent(root, intent.task_id).token });
		const action = capabilityActionFor({ op: "authorize_review_retry", task_id: intent.task_id, at: "retry", actor_id: "literal-user", intent_content_hash: INTENT, review_contract_hash: CURRENT });
		const capability = registry.issue({ authority_kind: "user", actor_id: "literal-user", task_id: intent.task_id, action_digest: digestOfAction(action), expected_record_hash: readTaskRecordRaw(root, intent.task_id).revision, intent_revision: 1, intent_content_hash: INTENT, diff_hash: DIFF, findings_digest: null, confirmation_ref: "native-confirm", nonce: "retry" });
		const operation: CanaryOperation = { op: "authorize_review_retry", actor_id: "literal-user", intent_content_hash: INTENT, review_contract_hash: CURRENT, capability };
		const workspace = readWorkspaceStateRaw(root), intentBytes = readFileSync(intentPath, "utf8");
		for (const supplied of [undefined, "invalid", OLD]) expect(() => execute(operation, supplied)).toThrow(/trusted current/);
		expect(() => execute({ ...operation, capability: {} }, CURRENT)).toThrow(/capability/);
		expect(() => execute({ ...operation, review_contract_hash: OLD }, OLD)).toThrow(/digest/);
		expect(registry.isConsumed(capability)).toBe(false);
		const committed = execute(operation, CURRENT);
		expect(registry.isConsumed(capability)).toBe(true);
		expect({ ...committed.record, history: record.history }).toEqual(record);
		expect(readWorkspaceStateRaw(root)).toEqual(workspace);
		expect(readFileSync(intentPath, "utf8")).toBe(intentBytes);
		const incomplete: CanaryOperation = { op: "record_review_incomplete", actor_id: "reviewer", snapshot: { record_revision: committed.revision, workspace_revision: workspace.revision, ...identity }, turn_budget: 64, inspected_paths: [], reason: "unfinished", review_contract_hash: CURRENT };
		for (const supplied of [undefined, OLD]) expect(() => execute(incomplete, supplied, "third")).toThrow(/trusted current/);
		expect(() => execute({ ...incomplete, review_contract_hash: undefined }, CURRENT, "third")).toThrow(/trusted current/);
		const exhausted = execute(incomplete, CURRENT, "third");
		expect(reviewIncompleteHistory(exhausted.record.history, identity)).toMatchObject({ count: 3, round_limit: 3, last_contract_hash: CURRENT });
	} finally { rmSync(root, { recursive: true, force: true }); }
});
