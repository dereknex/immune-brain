import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { run } from "../plugins/immune-brain/skills/imm-review-retro/scripts/review_retro.ts";

const ROOT = resolve(import.meta.dir, "fixtures/review-retro");

describe("review-retro analyzer", () => {
	test("ranks authors, splits findings, and reports usage", async () => {
		const out = await run(["7", "--root", ROOT]);
		expect(out).toContain("anthropic/claude-opus");
		expect(out).toContain("openai/gpt-5");
		expect(out).toContain("=== usage (sessions / turns / edits / tools) ===");
		expect(out).toMatch(/sessions: 2 \| turns: \d+ \| edits: 2/);
		expect(out).toMatch(/^\s+3\s+Agent$/m);
		expect(out).toMatch(/^\s+1\s+edit$/m);
		expect(out).toMatch(/^\s+1\s+write$/m);
		expect(out).toMatch(/^\s+1\s+bash$/m);
		expect(out).toContain("caveats:");

		const opus = out.split("\n").find((line) => line.startsWith("anthropic/claude-opus"));
		expect(opus).toBeDefined();
		// reviews=2 uniq=1 (same description+prompt), registr=1, advis=1, noisy=1 (receipt recorded)
		expect(opus).toMatch(/claude-opus\s+1\s+\d+\s+2\s+1\b/);
		expect(opus).toContain("8.0");
		expect(opus).toContain("100%");
		expect(opus).toMatch(/1\s+0\s+1\s+1\s*$/);

		const gpt = out.split("\n").find((line) => line.startsWith("openai/gpt-5"));
		expect(gpt).toBeDefined();
		expect(gpt).toMatch(/gpt-5\s+1\s+\d+\s+1\s+1\b/);
		expect(gpt).toContain("3.0");
		expect(gpt).toContain("0%");
		expect(gpt).toMatch(/0\s+1\s+0\s+0\s*$/);

		expect(out).toContain("REJECT");
		expect(out).toContain("highRisk");
		expect(out).toContain("immune-brain");
		expect(out).toContain("other-app");
		expect(out).toContain("1.0 rounds/task");
		expect(out).toContain("registr");
	});

	test("--project keeps sessions whose cwd contains the substring", async () => {
		const out = await run(["7", "--root", ROOT, "--project", "immune-brain"]);
		expect(out).toContain("anthropic/claude-opus");
		expect(out).not.toContain("openai/gpt-5");
		expect(out).toMatch(/sessions: 1 /);
		expect(out).not.toContain("other-app");
	});

	test("rejects a non-positive window", async () => {
		await expect(run(["0", "--root", ROOT])).rejects.toThrow(/usage:/);
	});
});
