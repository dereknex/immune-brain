#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MIN_CLAUDE_CODE_VERSION } from "../plugins/immune-brain/runtime/claude/capability";

export const CONFORMANCE_PATH = "docs/verification/claude-code-host-conformance.md";

export const REQUIRED_SCENARIOS = [
	"native_manual",
	"native_acceptEdits",
	"native_auto",
	"native_bypassPermissions",
	"native_dontAsk",
	"risk_routine",
	"risk_material",
	"risk_critical",
	"denial",
	"cancellation",
	"review_event_order",
	"resume_pi_to_claude",
	"resume_claude_to_pi",
	"stale_rejection",
	"concurrent_rejection",
	"plugin_removal_recovery",
] as const;

export interface ConformanceReport {
	minimum_version: string;
	current_version: string;
	package_version: string;
	platform: string;
	plugin_validate: string;
	authority: "hitl-evidence";
	scenarios: Record<string, { result: "pass" | "fail"; notes: string }>;
}

export function parseConformanceReport(markdown: string): ConformanceReport {
	const field = (name: string) => {
		const match = new RegExp(`^${name}:\\s*(.+)$`, "m").exec(markdown);
		if (!match) throw new Error(`conformance report missing ${name}`);
		return match[1].trim();
	};
	const scenarios: ConformanceReport["scenarios"] = {};
	for (const id of REQUIRED_SCENARIOS) {
		const match = new RegExp(`^- \\[(x| )\\] \`${id}\`:\\s*(pass|fail)\\s*—\\s*(.+)$`, "m").exec(markdown);
		if (!match) throw new Error(`conformance report missing scenario ${id}`);
		if (match[1] !== "x") throw new Error(`conformance scenario ${id} is unchecked`);
		scenarios[id] = { result: match[2] as "pass" | "fail", notes: match[3].trim() };
	}
	return {
		minimum_version: field("minimum_version"),
		current_version: field("current_version"),
		package_version: field("package_version"),
		platform: field("platform"),
		plugin_validate: field("plugin_validate"),
		authority: field("authority") as "hitl-evidence",
		scenarios,
	};
}

export function validateConformanceReport(root: string, packageVersion: string): ConformanceReport {
	const report = parseConformanceReport(readFileSync(resolve(root, CONFORMANCE_PATH), "utf8"));
	if (report.minimum_version !== MIN_CLAUDE_CODE_VERSION) {
		throw new Error(`minimum_version ${report.minimum_version} != ${MIN_CLAUDE_CODE_VERSION}`);
	}
	if (report.package_version !== packageVersion) {
		throw new Error(`package_version ${report.package_version} != ${packageVersion}`);
	}
	if (report.authority !== "hitl-evidence") throw new Error("conformance report must declare hitl-evidence authority");
	if (report.plugin_validate !== "pass") throw new Error(`plugin_validate is ${report.plugin_validate}, not pass`);
	if (!["darwin", "linux"].includes(report.platform.split("/")[0] ?? "")) {
		throw new Error(`unsupported conformance platform ${report.platform}`);
	}
	for (const [id, scenario] of Object.entries(report.scenarios)) {
		if (scenario.result !== "pass") throw new Error(`conformance scenario ${id} is ${scenario.result}`);
		if (/pending/i.test(scenario.notes)) throw new Error(`conformance scenario ${id} is still pending`);
	}
	return report;
}

if (import.meta.main) {
	const root = resolve(import.meta.dir, "..");
	const version = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version as string;
	const report = validateConformanceReport(root, version);
	console.log(JSON.stringify({ ok: true, report: { ...report, scenarios: Object.keys(report.scenarios) } }, null, 2));
}
