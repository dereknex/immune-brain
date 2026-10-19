import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..");

function runFixture(fixtureCase: "default" | "explicit"): { status: number | null; output: string } {
	const result = spawnSync(process.execPath, ["test", "./tests/fixtures/default-timeout.fixture.ts"], {
		cwd: repoRoot,
		env: { ...process.env, FIXTURE_CASE: fixtureCase },
		encoding: "utf8",
	});
	return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("repository test runtime config", () => {
	it("a test without an explicit timeout runs past Bun's 5000 ms default", () => {
		const { status, output } = runFixture("default");
		expect(output).toContain("1 pass");
		expect(status).toBe(0);
	}, 60_000);

	it("an explicit per-test timeout still overrides the repository default", () => {
		const { status, output } = runFixture("explicit");
		expect(output).toContain("timed out after 200ms");
		expect(status).not.toBe(0);
	}, 60_000);
});
