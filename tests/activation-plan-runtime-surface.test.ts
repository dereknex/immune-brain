import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TS_RUNTIME = resolve(
	REPO_ROOT,
	"plugins/immune-brain/runtime/v4_runtime.ts",
);
const ACTIVATION_WRAPPER = resolve(
	REPO_ROOT,
	"plugins/immune-brain/bin/imm-activation-plan",
);
const temps: string[] = [];

function tempConfig(content: string): string {
	const dir = mkdtempSync(join(tmpdir(), "imm-activation-surface-"));
	temps.push(dir);
	const path = join(dir, "config.toml");
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
	return path;
}

afterEach(() => {
	while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

function parseActivationText(text: string): any {
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new Error(
			`activation payload was not JSON: ${text}\n${String(error)}`,
		);
	}
}

describe("activation plan runtime surface", () => {
	it("exposes imm-activation-plan through the CLI command manifest", () => {
		const result = spawnSync("bun", [TS_RUNTIME, "list-commands", "--json"], {
			cwd: REPO_ROOT,
			encoding: "utf-8",
		});

		expect(result.status).toBe(0);
		const commands = JSON.parse(result.stdout).commands;
		const names = commands.map((command: any) => command.name);
		expect(names).not.toContain("imm-activation-plan");
		const retired = JSON.parse(result.stdout).retired as string[];
		expect(retired).toContain("imm-autowork");
		expect(retired).toContain("imm-work");
		expect(names).not.toContain("imm-activation-plan");
	});

	it("imm-activation-plan is retired after v4 storage retirement", () => {
		const result = spawnSync(
			ACTIVATION_WRAPPER,
			["--host", "imm-code-review"],
			{ cwd: REPO_ROOT, encoding: "utf-8" },
		);
		// imm-activation-plan is not a v4 command at all.
		expect(result.status).toBe(2);
		expect(result.stderr).toContain("Unknown Immune-Brain v4 command");
	});

});
