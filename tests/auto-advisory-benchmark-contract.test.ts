import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseAdvisoryMetrics } from "../scripts/benchmark_eval";

function readJson(path: string): any {
	return JSON.parse(readFileSync(resolve(import.meta.dir, path), "utf8"));
}

describe("auto advisory benchmark contract", () => {
	it("requires advisory budget metrics in both benchmark fixtures", () => {
		for (const path of [
			"fixtures/immune-brain-benchmark.json",
			"fixtures/imm-brainstorm-behavior-benchmark.json",
		]) {
			const fixture = readJson(path);
			expect(fixture.metrics.required).toContain("advisory_metrics");
			if (path === "fixtures/immune-brain-benchmark.json") {
				expect(fixture.evidence).toEqual({
					claim_scope: "provider_runtime",
					runtime_advisory_metrics: "unavailable",
				});
			}
		}
	});

	it("pins the benchmark task to the canonical U5 telemetry artifact", () => {
		const mise = readFileSync(resolve(import.meta.dir, "../mise.toml"), "utf8");
		expect(mise).toContain(
			"scripts/benchmark_eval.ts --results-dir benchmark-results/immune-brain-u5-telemetry",
		);
	});

	it("accepts zero-dispatch and bounded-dispatch metric footers", () => {
		expect(
			parseAdvisoryMetrics(
				"Advisory metrics: child_count=0 | packet_bytes=0 | truncation_count=0",
			),
		).toEqual({
			child_count: 0,
			packet_bytes: 0,
			truncation_count: 0,
		});
		expect(
			parseAdvisoryMetrics(
				"Advisory metrics: child_count=2 | packet_bytes=4096 | truncation_count=1",
			),
		).toEqual({
			child_count: 2,
			packet_bytes: 4096,
			truncation_count: 1,
		});
	});
});
