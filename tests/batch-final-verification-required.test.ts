import { expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// Exercise the existing Host and real-Git Lane fixtures in separate processes:
// their Host SDK mocks must not leak into each other.
for (const [file, pattern] of [
	["pi-batch-authority.test.ts", "final verification|reuses max_parallel|registered Tool content"],
	["claude-batch-authority.test.ts", "final verification|omitted max_parallel|accepts max_parallel above"],
	["unattended-batch-lanes.test.ts", "final verification in the completion report"],
]) {
	it(`final verification contract: ${file}`, () => {
		const result = spawnSync(process.execPath, ["test", `tests/${file}`, "--test-name-pattern", pattern!], {
			cwd: resolve(import.meta.dir, ".."), encoding: "utf8", timeout: 240000,
		});
		expect(result.error).toBeUndefined();
		expect(result.status, result.stdout + result.stderr).toBe(0);
	}, 250000);
}
