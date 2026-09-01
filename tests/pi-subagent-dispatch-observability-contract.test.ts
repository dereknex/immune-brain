import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("canonical and packaged dispatch protocol remain synchronized", () => {
	expect(read("plugins/immune-brain/dist/docs/reference/subagent-dispatch-protocol.md")).toBe(read("docs/reference/subagent-dispatch-protocol.md"));
});

test("dispatch contracts keep Role-only execution configuration ownership", () => {
	const required = [
		"Immune-Brain owns Role, evidence, authority, tool policy, and output contracts.",
		"Pi Host owns model, provider, and thinking defaults.",
		"Immune-Brain does not define\nmodel tiers, provider mapping, cost routing, or provider fallback.",
		"exact reserved authority parameters",
		"reservation 返回完整的 host-normalized Agent envelope",
	];
	for (const path of [
		"docs/reference/subagent-dispatch-protocol.md",
		"plugins/immune-brain/dist/docs/reference/subagent-dispatch-protocol.md",
	]) {
		const contract = read(path);
		for (const statement of required) expect(contract).toContain(statement);
	}
});

test("interactive dispatch contracts are foreground-only and do not poll", () => {
	for (const path of [
		"plugins/immune-brain/.pi-extension/pi-canary-assurance-progression.ts",
		"plugins/immune-brain/.pi-extension/pi-canary-native-review.ts",
	]) {
		const source = read(path);
		for (const forbidden of ["get_subagent_result", "setTimeout(", "setInterval(", "setStatus(", "setWidget(", "deliverFollowUp"]) expect(source).not.toContain(forbidden);
	}
});

test("assurance role guidance describes direct QA and native Review receipt flow", () => {
	for (const path of [
		"plugins/immune-brain/skills/imm-loop/SKILL.md",
		"plugins/immune-brain/dist/imm-loop.md",
	]) {
		const contract = read(path);
		expect(contract).toContain("advance_assurance");
		expect(contract).toMatch(/foreground|前台/i);
		expect(contract).toMatch(/submit_review|Review receipt/);
	}
});
