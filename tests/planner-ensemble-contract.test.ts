import { afterEach, describe, expect, it } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readImmuneBrainConfig } from "../plugins/immune-brain/runtime/agent_config";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temps: string[] = [];

function read(rel: string): string {
	return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}

function tempHome(): string {
	const dir = mkdtempSync(join(tmpdir(), "imm-planner-config-"));
	temps.push(dir);
	return dir;
}

function write(path: string, content: string): void {
	mkdirSync(path.split("/").slice(0, -1).join("/"), { recursive: true });
	writeFileSync(path, content);
}

afterEach(() => {
	while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

describe("planner ensemble contract", () => {
	it("keeps agent-local workflow configuration available to the planner", () => {
		const home = tempHome();
		write(
			join(home, ".pi/agent/immune-brain/config.toml"),
			'[workflow_models]\nplanner_ensemble = ["fast", "strong"]\n\n[subagent_models]\nfast = "file-fast"\nstrong = "file-strong"\n',
		);

		const loaded = readImmuneBrainConfig({ home_dir: home });
		expect(loaded.config.workflow_models?.planner_ensemble).toEqual([
			"fast",
			"strong",
		]);
		expect(loaded.config.subagent_models?.fast).toBe("file-fast");
		expect(loaded.config.subagent_models?.strong).toBe("file-strong");
	});

	it("documents planner-owned ensemble boundaries in source and packaged planner contracts", () => {
		for (const rel of [
			"plugins/immune-brain/skills/imm-planner/SKILL.md",
			"plugins/immune-brain/dist/imm-planner.md",
		]) {
			const content = read(rel);
			expect(content).toContain("planner ensemble");
			expect(content).toContain("workflow_models.planner_ensemble");
			expect(content).toContain("advisory-only");
			expect(content).toContain("final Spec and Plan");
			expect(content).toContain("Agreement becomes evidence");
			expect(content).toContain("Disagreement becomes decision criteria");
			expect(content).toContain("strong-model blockers");
		}
	});

	it("documents brainstorm-owned ensemble boundaries in source and packaged brainstorm contracts", () => {
		for (const rel of [
			"plugins/immune-brain/skills/imm-brainstorm/SKILL.md",
			"plugins/immune-brain/dist/imm-brainstorm.md",
		]) {
			const content = read(rel);
			expect(content).toContain("Brainstorm ensemble");
			expect(content).toContain("workflow_models.brainstorm_ensemble");
			expect(content).toContain("advisory-only");
			expect(content).toContain(
				"Final Spec and Plan authority stays with `imm-planner`",
			);
			expect(content).toContain(
				"Pi's adapter may consume `brainstorm_ensemble` dispatch JSON",
			);
			expect(content).not.toContain("Pi host adapters");
			expect(content).toContain("does not transfer framing authority");
			expect(content).toContain(
				"mutate state, or own final Spec/Plan authority",
			);
			expect(content).toContain("Agreement becomes framing evidence");
			expect(content).toContain("Disagreement becomes decision criteria");
			expect(content).toContain("strong-model blockers");
		}

		const packaged = read("plugins/immune-brain/dist/imm-brainstorm.md");
		expect(packaged).toContain("one foreground Agent at a time");
		expect(packaged).toContain("direct result");
		expect(packaged).toContain("remaining dispatch budget");
		expect(packaged).not.toContain("Pi itself may launch those subagents");
		expect(packaged).not.toContain("poll background work");
	});
});
