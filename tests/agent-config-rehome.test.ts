import { afterEach, describe, expect, it } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveImmuneBrainLocalRoot } from "../plugins/immune-brain/runtime/agent_config";
import {
	readImmuneBrainConfig,
	resolveImmuneBrainLocalPath,
} from "../plugins/immune-brain/runtime/agent_config";

const ROOT = resolve(import.meta.dir, "..");
const ISLAND_MODULES = [
	"state_ledger",
	"project_migration",
	"advisory_dispatch",
	"work_probes",
	"environment",
	"handoff",
	"activation",
];
const temps: string[] = [];

function write(path: string, content: string): void {
	mkdirSync(resolve(path, ".."), { recursive: true });
	writeFileSync(path, content);
}

afterEach(() => {
	while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

describe("agent config rehome", () => {
	it("keeps the loader and its types outside the v3 island", () => {
		const configSource = readFileSync(
			join(ROOT, "plugins/immune-brain/runtime/agent_config.ts"),
			"utf8",
		);
		const dispatchSource = readFileSync(
			join(ROOT, "plugins/immune-brain/runtime/advisory_dispatch.ts"),
			"utf8",
		);

		for (const symbol of [
			"AdvisoryDispatchConfig",
			"WorkflowModelOptions",
			"resolveImmuneBrainLocalRoot",
			"resolveImmuneBrainLocalPath",
			"readImmuneBrainConfig",
		]) {
			expect(configSource).toMatch(
				new RegExp(`export (?:function|interface|type) ${symbol}\\b`),
			);
			expect(dispatchSource).not.toMatch(
				new RegExp(`export (?:function|interface|type) ${symbol}\\b`),
			);
		}
		expect(dispatchSource).toContain('from "./agent_config"');
		for (const module of ISLAND_MODULES) {
			expect(configSource).not.toMatch(
				new RegExp(`from ["'][^"']*/${module}(?:\\.ts)?["']`),
			);
		}
	});

	it("preserves path validation and config override precedence", () => {
		const home = mkdtempSync(join(tmpdir(), "imm-agent-config-rehome-"));
		temps.push(home);
		const root = resolveImmuneBrainLocalRoot({ home_dir: home });
		expect(root.root).toBe(join(home, ".pi/agent/immune-brain"));
		expect(
			resolveImmuneBrainLocalPath({
				home_dir: home,
				relative_path: "insights/workflow-improvement-inbox.md",
			}),
		).toBe(join(root.root, "insights/workflow-improvement-inbox.md"));
		for (const relative_path of ["", "/absolute", "../outside", "nested/../outside", "nested\\file"]) {
			expect(() => resolveImmuneBrainLocalPath({ home_dir: home, relative_path })).toThrow(
				"Invalid Immune-Brain local path",
			);
		}

		write(root.config_path, '[workflow]\nmodel_preset = "off"\n');
		const base = join(home, "base.toml");
		const agent = join(home, "agent.toml");
		write(base, '[workflow]\nmodel_preset = "balanced"\n');
		write(agent, '[workflow]\nmodel_preset = "quality"\n');
		const loaded = readImmuneBrainConfig({
			home_dir: home,
			env: {
				IMMUNE_BRAIN_CONFIG: base,
				IMMUNE_BRAIN_AGENT_CONFIG: agent,
			},
		});

		expect(loaded.config.workflow?.model_preset).toBe("quality");
		expect(loaded.config_paths).toEqual([root.config_path, base, agent]);
	});
});
