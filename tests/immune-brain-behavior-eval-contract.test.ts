import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BENCHMARK_PATH = resolve(
	import.meta.dir,
	"fixtures/immune-brain-benchmark.json",
);
const benchmark = JSON.parse(readFileSync(BENCHMARK_PATH, "utf8"));

describe("Immune-Brain behavior eval contract", () => {
	it("targets pi-agent antigravity/gemini-3.6-flash with a portable fixture path", () => {
		expect(benchmark.runner.type).toBe("pi-agent");
		expect(benchmark.runner.model).toBe("antigravity/gemini-3.6-flash");
		expect(benchmark.runner.resultTransport).toBe("foreground_agent_details");
		expect(benchmark.workspace.sourcePath).toBe(
			"tests/fixtures/immune-brain-benchmark-workspace",
		);
	});

	it("declares comparable host-reported metrics", () => {
		expect(benchmark.metrics).toEqual({
			required: [
				"scenario_status",
				"question_count",
				"tool_uses",
				"reported_tokens",
				"duration_ms",
				"advisory_metrics",
			],
			cost: "unavailable_by_host",
		});
	});

	it("covers managed planning, managed execution, host-native mutations, explicit Managed routing, and weak matches", () => {
		expect(
			benchmark.scenarios.map((scenario: { id: string }) => scenario.id),
		).toEqual([
			"entrypoint-routing",
			"multi-skill-follow-up",
			"host-native-mutation",
			"explicit-managed-boundary",
			"plugin-boundary",
		]);
	});

	it("makes the host-native mutation contract observable", () => {
		const scenario = benchmark.scenarios.find(
			(item: { id: string }) => item.id === "host-native-mutation",
		);
		const contract = [scenario.userInput, ...scenario.successChecklist].join(
			"\n",
		);

		expect(contract).toContain("stays host-native");
		expect(contract).toContain("does not create or inspect Immune-Brain workflow state");
		expect(contract).toContain("bun test tests");
	});

	it("makes the explicit Managed boundary observable", () => {
		const scenario = benchmark.scenarios.find(
			(item: { id: string }) => item.id === "explicit-managed-boundary",
		);
		const contract = [scenario.userInput, ...scenario.successChecklist].join(
			"\n",
		);
		expect(contract).toContain("explicit `imm-planner`");
		expect(contract).toContain("public runtime contract");
		expect(contract).toContain("compatibility");
		expect(contract).toContain("Managed");
		expect(contract).toContain("does not implement before authority exists");
	});

	it("keeps every scenario evidence-oriented", () => {
		for (const scenario of benchmark.scenarios) {
			expect(scenario.purpose.trim().length).toBeGreaterThan(20);
			expect(scenario.successChecklist.length).toBeGreaterThanOrEqual(3);
		}
	});
});
