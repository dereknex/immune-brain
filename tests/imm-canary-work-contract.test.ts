// P2B2 U2: imm-canary-work Skill contract. Covers the Pi-only routing Skill
// entry, source/dist parity, registry registration, and the Kernel routing
// clauses added to imm-work and imm-loop (source and packaged copies).

import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const SKILLS = join(ROOT, "plugins/immune-brain/skills");
const DIST = join(ROOT, "plugins/immune-brain/dist");

function read(rel: string): string {
	return readFileSync(join(ROOT, rel), "utf8");
}

describe("imm-canary-work skill contract", () => {
	test("skill entry and packaged copy exist with matching names", () => {
		const entry = read("plugins/immune-brain/skills/imm-canary-work/SKILL.md");
		const dist = read("plugins/immune-brain/dist/imm-canary-work.md");
		expect(entry).toMatch(/^name: imm-canary-work$/m);
		expect(dist).toMatch(/^name: imm-canary-work$/m);
		expect(entry).toContain("imm-canary-work.md");
		expect(dist).toContain("imm_kernel_canary");
		expect(dist).toContain("/imm-canary-assure <task-id> qa");
		expect(dist).toContain("/imm-canary-assure <task-id> review [model]");
		expect(dist).toContain("makes no LLM call");
		expect(dist).toContain("standard `Agent` tool");
		expect(dist).toContain("native result is advisory");
		expect(dist).toContain("advance_assurance");
		expect(dist).toContain("cancel_assurance");
		expect(dist).toContain("request_authorization");
		expect(entry).toContain("request_authorization");
		expect(entry).not.toMatch(/ask the user to type \/imm-canary-authorize/i);
		expect(dist).toMatch(/manual recovery/i);
		expect(dist).toContain("structured `started`, `blocked`, `awaiting_user`");
		expect(dist).not.toContain("`completed`, or `cancelled` state");
		expect(dist).toContain("renderCall");
		expect(dist).toContain("renderResult");
		expect(dist).not.toContain("Footer and Widget refresh");
		expect(dist).toContain("triggerTurn: true");
		expect(dist).toContain('deliverAs: "followUp"');
		expect(dist).toContain("Duplicate advances reuse the active operation ID");
		expect(dist).toMatch(/manual\s+diagnostic\/recovery/);
		expect(dist).toContain("record-review-verdict");
		expect(dist).toContain("main input remains available");
		expect(dist).toContain("releases session job ownership");
		expect(dist).toContain("expected-record-hash CAS");
		expect(dist).toContain("base blob OID");
		expect(dist).toContain("never reads the parent live worktree");
		expect(dist).toContain("30-second preparation");
		expect(dist).toContain("120-second standard `Agent` receipt");
		expect(dist).toContain("Quick is 5m soft/15m stop");
		expect(dist).toContain("QA derives `max(15m, sum(descriptor timeout)+2m)`");
		expect(dist).toContain("Durable cross-session");
		expect(dist).toContain("explicitly deferred");
		expect(dist).not.toContain("300-second Review ceiling");
		expect(dist).toContain("does not automatically retry");
		expect(dist).toContain("does not call\n  provider stop RPC");
		expect(dist).toContain("retain locked");
		expect(dist).toContain("terminal settlement is still unconfirmed");
		expect(dist).not.toContain("current bytes and immutable `HEAD` base bytes");
		expect(dist).toContain("revalidate the");
		expect(dist).toContain("locked TaskRecord/workspace/Intent/diff snapshot");
		expect(dist).toContain("/imm-canary-authorize");
		expect(dist).toContain("replan_required");
	});

	test("enrollment contracts require isolated descriptor rehearsal and one explicit waiver route", () => {
		const guide = read("plugins/immune-brain/USER_GUIDE.md");
		const kernelCommand = read("plugins/immune-brain/runtime/commands/kernel.ts");
		const defaultRoute = read("plugins/immune-brain/.pi-extension/imm-canary-new.ts");
		const waiverRoute = read("plugins/immune-brain/.pi-extension/imm-canary-enroll.ts");
		expect(guide).toContain("foreground");
		expect(guide).toContain("descriptor-rehearsal/v1:waived:<digest>");
		expect(guide).toContain("frozen `index_digest`");
		expect(guide).toContain("scope/index snapshot integrity");
		expect(kernelCommand).toContain('status: enrollmentReady ? "pending_tui_enrollment"');
		expect(kernelCommand).toContain('waiver_route: "explicit_tui_waiver"');
		expect(kernelCommand).toContain('snapshot_binding: "frozen_git_index_digest"');
		expect(kernelCommand).toContain('scope_drift: "non_waivable"');
		expect(kernelCommand).toContain('timeout_budget: "isolated_copy_setup_and_execution"');
		expect(kernelCommand).toContain('setup_timeout: "non_waivable_close_settled"');
		expect(kernelCommand).toContain('cancellation: "non_waivable_close_settled"');
		expect(kernelCommand).toContain('output_limit: "non_waivable_close_settled"');
		expect(kernelCommand).toContain('setup_failure: "non_waivable"');
		expect(kernelCommand).toContain('live_integrity_drift: "abort_all_non_waivable_close_settled"');
		expect(kernelCommand).toContain('parent_fingerprint: "git_visible_content_bytes"');
		expect(defaultRoute).toContain('launchEnrollmentRequest(pi, "new"');
		expect(defaultRoute).not.toContain("runDescriptorRehearsal");
		expect(waiverRoute).toContain('name: "imm_canary_enrollment"');
		expect(waiverRoute).toContain('const route = action === "new" ? "default" : "explicit_waiver"');
		expect(waiverRoute).toContain("if (!rehearsalDecision.proceed_to_confirmation)");
		expect(waiverRoute).toContain("assertDescriptorRehearsalSnapshot");
		expect(waiverRoute).toContain('| "cancelled"');
		expect(waiverRoute).toContain('| "output_exceeded"');
		expect(waiverRoute).toContain('| "setup_timed_out"');
		expect(waiverRoute).toContain('| "integrity_drift"');
		expect(waiverRoute).toContain('child.once("close"');
		expect(waiverRoute).toContain('gitBytes(root, ["diff", "--binary"');
		expect(waiverRoute).toContain("setInterval(monitorIntegrity, 250)");
		expect(waiverRoute).toContain("waiver_allowed");
		expect(waiverRoute).toContain("REHEARSAL WAIVER: enrollment_ready=false");
		expect(waiverRoute).toContain('waiver_gate: rehearsalOverride ? "descriptor_rehearsal"');
		expect(waiverRoute).toContain('pi.on("session_shutdown"');
		expect(waiverRoute).toContain("class ForegroundEnrollmentCoordinator");
		expect(waiverRoute).toContain("hostSignal?.addEventListener");
		expect(waiverRoute).toContain("onUpdate");
		expect(waiverRoute).toContain('"settlement_unknown"');
		expect(waiverRoute).not.toContain("EnrollmentJobCoordinator");
		expect(waiverRoute).not.toContain("setWidget(");
		expect(waiverRoute).not.toContain("setStatus(");
	});

	test("skill is registered in both registry copies", () => {
		for (const rel of [
			"plugins/immune-brain/skills/registry.yaml",
			"plugins/immune-brain/dist/registry.yaml",
		]) {
			const registry = read(rel);
			const block = registry.split("  - name: imm-canary-work")[1]?.split("\n  - name:")[0] ?? "";
			expect(block).toContain("path: skills/imm-canary-work/SKILL.md");
			expect(block).toContain("role: coordinate");
			expect(block).toMatch(/Pi-only routing/i);
		}
	});

	test("registry copies are byte-identical", () => {
		expect(read("plugins/immune-brain/skills/registry.yaml")).toBe(
			read("plugins/immune-brain/dist/registry.yaml"),
		);
	});

	test("imm-work and imm-loop carry the Kernel routing clause (source + dist)", () => {
		for (const name of ["imm-work", "imm-loop"]) {
			const entry = read(`plugins/immune-brain/skills/${name}/SKILL.md`);
			expect(entry).toMatch(/imm-canary-work|Kernel projection/i);
			const dist = read(`plugins/immune-brain/dist/${name}.md`);
			expect(dist).toMatch(/Kernel Canary Routing/i);
			expect(dist).toMatch(/task tombstone|terminal/i);
			expect(dist).toMatch(/fail(s)?\s+closed/i);
		}
	});

	test("every SKILL.md directory is registered (no orphans)", () => {
		const registry = read("plugins/immune-brain/skills/registry.yaml");
		const names = [...registry.matchAll(/^\s{2}-\s+name:\s*(.+?)\s*$/gm)].map((m) => m[1]);
		const { readdirSync } = require("node:fs") as typeof import("node:fs");
		const dirs = readdirSync(SKILLS, { withFileTypes: true })
			.filter((d) => d.isDirectory() && existsSync(join(SKILLS, d.name, "SKILL.md")))
			.map((d) => d.name);
		for (const dir of dirs) expect(names).toContain(dir);
	});

	test("entry is a loader entry that does not expose workflow state", () => {
		const entry = read("plugins/immune-brain/skills/imm-canary-work/SKILL.md");
		expect(entry).toContain("Load");
		expect(entry).not.toContain("appendEntry");
		expect(entry).not.toContain("pi.appendEntry");
	});
});
