// v4 storage retirement — acc-legacy-audit-read-only.
// A packaged explicit legacy-audit projection can securely inspect retained
// terminal v3 history with bounded no-symlink reads and deterministic redacted
// output, performs no journal or workflow write, and never imports,
// synthesizes, or activates a Kernel TaskRecord from legacy data.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { projectLegacyAudit } from "../plugins/immune-brain/runtime/kernel/legacy_audit";

function root(): string {
	const r = mkdtempSync(join(tmpdir(), "v4-audit-"));
	mkdirSync(join(r, ".imm", "memory"), { recursive: true });
	return r;
}

const TERMINAL_STATE = {
	plan_path: "docs/plans/finished.md",
	runtime_status: "idle",
	reset_reason: "intentional_reset",
	active_step: null,
	steps: { "1": { number: 1, step_id: "U1", state: "closed" } },
	history: [
		{ at: "2026-01-01T00:00:00Z", action: "finish_reset", details: {} },
	],
};

describe("legacy audit read-only projection", () => {
	test("projects terminal v3 history without writing and without task import", () => {
		const r = root();
		const content = `${JSON.stringify(TERMINAL_STATE, null, 2)}\n`;
		writeFileSync(join(r, ".imm/memory/current_iteration.json"), content);
		const p = projectLegacyAudit(r);
		expect(p.contract).toBe("assurance_kernel/legacy_audit/v1");
		expect(p.read_only).toBe(true);
		expect(p.writes_performed).toBe(false);
		expect(p.plan_path).toBe("docs/plans/finished.md");
		expect(p.step_count).toBe(1);
		expect(p.phase).toBe("finished");
		expect(p.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
		// Deterministic across reads
		expect(p.digest).toBe(projectLegacyAudit(r).digest);
		// No task_record, no kernel task surface
		expect(JSON.stringify(p)).not.toContain("task_record");
		expect(JSON.stringify(p)).not.toContain("backend_claim");
	});

	test("rejects a symlinked ledger", () => {
		const r = root();
		const target = join(r, ".imm/memory/current_iteration.json");
		writeFileSync(target, JSON.stringify(TERMINAL_STATE));
		rmSync(target);
		const link = target;
		const real = join(r, "real.json");
		writeFileSync(real, JSON.stringify(TERMINAL_STATE));
		symlinkSync(real, link);
		expect(() => projectLegacyAudit(r)).toThrow(/symlink/);
	});

	test("rejects an oversized ledger", () => {
		const r = root();
		writeFileSync(
			join(r, ".imm/memory/current_iteration.json"),
			`${"x".repeat(2 * 1024 * 1024 + 1)}`,
		);
		expect(() => projectLegacyAudit(r)).toThrow(/exceeds/);
	});

	test("redacts step/history/evidence payloads", () => {
		const r = root();
		const content = `${JSON.stringify(TERMINAL_STATE, null, 2)}\n`;
		writeFileSync(join(r, ".imm/memory/current_iteration.json"), content);
		const p = projectLegacyAudit(r);
		// No raw step details or history entries are echoed.
		expect(JSON.stringify(p)).not.toContain("finish_reset");
		expect(JSON.stringify(p)).not.toContain('"history"');
	});
});
