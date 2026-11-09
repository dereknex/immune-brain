import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
	ANTIGRAVITY_ROOT,
	CANONICAL_FILES,
	NATIVE_READONLY_TOOLS,
	artifactBoundaryErrors,
	artifactClosureErrors,
	buildAntigravityPlugin,
	checkAntigravityPlugin,
} from "../scripts/build-antigravity-plugin";
import {
	generateReadonlyRoleDefinitions,
	generateVerifierDefinition,
} from "../scripts/build-claude-plugin";
import { stampPluginManifest, validateManifests } from "../scripts/plugin_versioning";

const ROOT = resolve(import.meta.dir, "..");
const ARTIFACT = resolve(ROOT, ANTIGRAVITY_ROOT);
const ROLES = [
	"immune-brain-advisory-reviewer",
	"immune-brain-qa",
	"immune-brain-review-verifier",
	"immune-brain-ui-review",
];
const SKILLS = ["authority-review", "clarify", "draw-up", "drive", "fix-pr", "prune-docs", "prune-tests", "revisit", "slim"];

const scratch: string[] = [];
function scratchDir(label: string): string {
	const dir = mkdtempSync(join(tmpdir(), `agy-${label}-`));
	scratch.push(dir);
	return dir;
}
afterAll(() => {
	for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** Copy only the artifact into a path with spaces and no repository sibling. */
function relocate(): string {
	const parent = join(scratchDir("reloc"), "install dir with spaces");
	mkdirSync(parent);
	const dest = join(parent, "immune-brain-antigravity");
	cpSync(ARTIFACT, dest, { recursive: true });
	return dest;
}

function files(dir: string): string[] {
	const out: string[] = [];
	const visit = (current: string): void => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const path = join(current, entry.name);
			if (entry.isDirectory()) visit(path);
			else out.push(relative(dir, path).split("\\").join("/"));
		}
	};
	visit(dir);
	return out.sort();
}

function digest(dir: string): Record<string, string> {
	return Object.fromEntries(files(dir).map((file) => [file, createHash("sha256").update(readFileSync(join(dir, file))).digest("hex")]));
}

function frontmatter(path: string): { head: string; body: string } {
	const match = /^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/.exec(readFileSync(path, "utf8"));
	if (!match) throw new Error(`no frontmatter: ${path}`);
	return { head: match[1], body: match[2] };
}

function isolatedEnv(): Record<string, string> {
	const home = scratchDir("home");
	const env: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: home, TMPDIR: scratchDir("tmp") };
	return env; // PLUGIN_ROOT deliberately absent
}

function hookCommands(artifact: string): Array<{ event: string; command: string }> {
	const hooks = JSON.parse(readFileSync(join(artifact, "hooks.json"), "utf8"))["immune-brain"] as Record<string, unknown[]>;
	const commands: Array<{ event: string; command: string }> = [];
	for (const [event, entries] of Object.entries(hooks)) {
		for (const entry of entries as Array<{ command?: string; hooks?: Array<{ command: string }> }>) {
			if (entry.command) commands.push({ event, command: entry.command });
			for (const hook of entry.hooks ?? []) commands.push({ event, command: hook.command });
		}
	}
	return commands;
}

describe("Antigravity artifact boundary (AC1)", () => {
	it("owns its manifest, native roles and public skills; the shared-root entrypoints are retired", () => {
		const manifest = JSON.parse(readFileSync(join(ARTIFACT, ".antigravity-plugin/plugin.json"), "utf8"));
		const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
		expect(manifest).toMatchObject({ name: "immune-brain", version: pkg.version });
		expect(readdirSync(join(ARTIFACT, "agents")).sort()).toEqual(ROLES.map((role) => `${role}.md`));
		expect(readdirSync(join(ARTIFACT, "skills")).filter((name) => existsSync(join(ARTIFACT, "skills", name, "SKILL.md"))).sort()).toEqual(SKILLS);
		for (const retired of ["plugin.json", "mcp_config.json", "hooks.json", "dist/antigravity"]) {
			expect(existsSync(join(ROOT, "plugins/immune-brain", retired))).toBe(false);
		}
	});

	it("ships native read-only role definitions that keep the shared prompt bodies", () => {
		const sharedBodies = [
			generateVerifierDefinition(ROOT),
			...generateReadonlyRoleDefinitions(ROOT).map((generated) => generated.content),
		].map((definition) => /^---\n[\s\S]*?\n---\n\n([\s\S]*)$/.exec(definition)![1]);
		const nativeBodies: string[] = [];
		for (const role of ROLES) {
			const { head, body } = frontmatter(join(ARTIFACT, "agents", `${role}.md`));
			expect(head).toContain(`name: ${role}`);
			expect(head).toContain("tools:\n" + NATIVE_READONLY_TOOLS.map((tool) => `  - ${tool}`).join("\n"));
			expect(head).not.toMatch(/^tools: \S/m);
			expect(head).not.toMatch(/run_command|write|edit|invoke_subagent|Bash/);
			nativeBodies.push(body);
		}
		expect(nativeBodies.sort()).toEqual(sharedBodies.sort());
	});

	it("discloses that native reviewer/verifier Git and packet-hash access is not certified", () => {
		const readme = readFileSync(join(ARTIFACT, "README.md"), "utf8").replace(/\s+/g, " ");
		expect(readme).toContain("Known limitation: native reviewer and verifier");
		expect(readme).toContain("Immutable Git access and review-packet hash verification by those native roles are not certified");
		expect(readme).toContain("does not certify the complete Managed lifecycle");
		expect(readme).toContain("not real model behavior");
	});

	it("carries no other host's loader components, while runtime/claude implementation stays", () => {
		expect(artifactBoundaryErrors(ARTIFACT)).toEqual([]);
		for (const absent of [".claude-plugin", ".mcp.json", "hooks", ".pi-extension", "dist/claude"]) {
			expect(existsSync(join(ARTIFACT, absent))).toBe(false);
		}
		expect(existsSync(join(ARTIFACT, "runtime/claude/mcp_server.ts"))).toBe(true);
	});

	it("rejects string-valued tools and cross-host components", () => {
		const copy = relocate();
		writeFileSync(join(copy, "agents/immune-brain-qa.md"), "---\nname: immune-brain-qa\ndescription: x\ntools: Read, Grep, Glob\n---\n\nbody\n");
		expect(artifactBoundaryErrors(copy)).toContain("agents/immune-brain-qa.md: tools must be a YAML array, not a string");

		const widened = relocate();
		writeFileSync(join(widened, "agents/immune-brain-qa.md"), "---\nname: immune-brain-qa\ndescription: x\ntools: [view_file, run_command]\n---\n\nbody\n");
		expect(artifactBoundaryErrors(widened)).toContain("agents/immune-brain-qa.md: tool outside the read-only native set: run_command");

		const foreign = relocate();
		mkdirSync(join(foreign, ".claude-plugin"));
		writeFileSync(join(foreign, ".mcp.json"), "{}");
		mkdirSync(join(foreign, "hooks"));
		expect(artifactBoundaryErrors(foreign)).toEqual([
			"foreign host component in artifact: .claude-plugin",
			"foreign host component in artifact: .mcp.json",
			"foreign host component in artifact: hooks",
		]);
	});
});

describe("Antigravity configured executable paths (AC2)", () => {
	const PAYLOADS: Record<string, (workspace: string) => unknown> = {
		PreInvocation: (workspace) => ({ conversationId: "c-1", invocationNum: 1, lastUserInput: "hello", workspacePaths: [workspace] }),
		PreToolUse: (workspace) => ({ conversationId: "c-1", stepIdx: 1, toolCall: { name: "view_file", args: {} }, workspacePaths: [workspace] }),
		PostToolUse: (workspace) => ({ conversationId: "c-1", stepIdx: 2, result: "ok", toolCall: { name: "view_file", args: {} }, workspacePaths: [workspace] }),
		Stop: (workspace) => ({ conversationId: "c-1", executionNum: 1, terminationReason: "done", workspacePaths: [workspace] }),
	};

	it("runs every configured hook from a relocated path with spaces and PLUGIN_ROOT unset", () => {
		const copy = relocate();
		const commands = hookCommands(copy);
		expect(commands.map((entry) => entry.event).sort()).toEqual(["PostToolUse", "PreInvocation", "PreToolUse", "Stop"]);
		const workspace = scratchDir("workspace");
		for (const { event, command } of commands) {
			expect(command).toBe('node "./dist/antigravity/mcp-server.mjs" --hook');
			const run = spawnSync("sh", ["-c", command], {
				cwd: copy,
				env: isolatedEnv(),
				input: JSON.stringify(PAYLOADS[event](workspace)),
				encoding: "utf8",
			});
			expect(run.status).toBe(0);
			const result = JSON.parse(run.stdout);
			if (event === "PreToolUse") expect(result).toEqual({ decision: "allow" });
			if (event === "PostToolUse" || event === "Stop") expect(result).toEqual({});
			if (event === "PreInvocation") expect(result).toEqual({ injectSteps: [], terminationBehavior: "" });
		}
		expect(existsSync(join(workspace, ".imm"))).toBe(false);
	});

	it("resolves the MCP bundle through PLUGIN_ROOT interpolation and answers initialize", () => {
		const copy = relocate();
		const server = JSON.parse(readFileSync(join(copy, "mcp_config.json"), "utf8")).mcpServers["immune-brain"];
		expect(server.args).toEqual(["${PLUGIN_ROOT}/dist/antigravity/mcp-server.mjs"]);
		const bundle = server.args[0].replace("${PLUGIN_ROOT}", copy);
		expect(existsSync(bundle)).toBe(true);
		const run = spawnSync(server.command, [bundle], {
			env: isolatedEnv(),
			input: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n",
			encoding: "utf8",
		});
		expect(run.status).toBe(0);
		expect(JSON.parse(run.stdout.split("\n")[0]).id).toBe(1);
	});

	it("fails the launch, rather than passing, when the bundle is removed", () => {
		const copy = relocate();
		rmSync(join(copy, "dist/antigravity/mcp-server.mjs"));
		const hook = spawnSync("sh", ["-c", hookCommands(copy)[0].command], { cwd: copy, env: isolatedEnv(), input: "{}", encoding: "utf8" });
		expect(hook.status).not.toBe(0);
		const mcp = spawnSync("node", [join(copy, "dist/antigravity/mcp-server.mjs")], { env: isolatedEnv(), input: "", encoding: "utf8" });
		expect(mcp.status).not.toBe(0);
		expect(artifactClosureErrors(copy)).toContain("hook command: missing dist/antigravity/mcp-server.mjs");
	});
});

describe("Antigravity relocatable closure (AC3)", () => {
	it("a sibling-free copy has no unresolved link, role prompt, runtime import or symlink", () => {
		expect(artifactClosureErrors(relocate())).toEqual([]);
	});

	it("serves bundled MCP initialize/tools/list and runs the shipped CLI wrappers from the copy", () => {
		const copy = relocate();
		const env = isolatedEnv();
		const mcp = spawnSync("node", ["dist/antigravity/mcp-server.mjs"], {
			cwd: copy,
			env,
			input: [
				{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
				{ jsonrpc: "2.0", id: 2, method: "tools/list" },
			].map((message) => JSON.stringify(message)).join("\n") + "\n",
			encoding: "utf8",
		});
		expect(mcp.status).toBe(0);
		const replies = mcp.stdout.trim().split("\n").map((line) => JSON.parse(line));
		expect(replies.some((reply) => reply.id === 1 && reply.result)).toBe(true);
		const tools = replies.find((reply) => reply.id === 2).result.tools.map((tool: { name: string }) => tool.name);
		expect(tools).toContain("status");

		const workspace = scratchDir("cli-workspace");
		spawnSync("git", ["init", "-q", "."], { cwd: workspace });
		const bunEnv = { ...env, PATH: process.env.PATH ?? "" };
		const plan = spawnSync(join(copy, "bin/imm-plan"), ["--routing-status", "--json"], { cwd: workspace, env: bunEnv, encoding: "utf8" });
		expect(plan.status).toBe(0);
		expect(JSON.parse(plan.stdout)).toHaveProperty("policy_status");
		const before = readdirSync(workspace).sort();
		const kernel = spawnSync(join(copy, "bin/imm-kernel"), ["inspect", "--json"], { cwd: workspace, env: bunEnv, encoding: "utf8" });
		expect(kernel.status).toBe(0);
		expect(JSON.parse(kernel.stdout)).toMatchObject({ contract: "assurance_kernel/inspect/v1" });
		expect(readdirSync(workspace).sort()).toEqual(before);
	});

	it("fails closure when a referenced contract, runtime dependency or role prompt is removed", () => {
		const contract = relocate();
		rmSync(join(contract, "dist/drive-batch.md"));
		expect(artifactClosureErrors(contract).some((error) => error.includes("broken link") && error.includes("drive-batch.md"))).toBe(true);

		const dependency = relocate();
		rmSync(join(dependency, "runtime/kernel/storage.ts"));
		expect(artifactClosureErrors(dependency).join("\n")).toContain("unresolved runtime import");

		const prompt = relocate();
		rmSync(join(prompt, "dist/role-prompts/code-review.md"));
		expect(artifactClosureErrors(prompt)).toContain("role prompt code-review: missing dist/role-prompts/code-review.md");

		const wrapper = relocate();
		rmSync(join(wrapper, "runtime/v4_runtime.ts"));
		expect(artifactClosureErrors(wrapper).join("\n")).toContain("bin/imm-kernel runtime: missing runtime/v4_runtime.ts");
	});

	it("checks links inside nested dist docs and role prompts", () => {
		const docs = relocate();
		appendTo(join(docs, "dist/docs/reference/immune-brain-config.md"), "\n[gone](./no-such-reference.md)\n");
		expect(artifactClosureErrors(docs).join("\n")).toContain("dist/docs/reference/immune-brain-config.md: broken link");

		const prompts = relocate();
		appendTo(join(prompts, "dist/role-prompts/qa.md"), "\n[escape](../../../../README.md)\n");
		expect(artifactClosureErrors(prompts).join("\n")).toContain("dist/role-prompts/qa.md: link leaves the artifact");
	});

	it("does not accept a symlink or parent-relative reference as a substitute", () => {
		const linked = relocate();
		const outside = scratchDir("outside");
		writeFileSync(join(outside, "drive.md"), "outside");
		rmSync(join(linked, "dist/drive.md"));
		symlinkSync(join(outside, "drive.md"), join(linked, "dist/drive.md"));
		expect(artifactClosureErrors(linked)).toContain("symlink in artifact: dist/drive.md");

		const escaping = relocate();
		appendTo(join(escaping, "skills/drive/SKILL.md"), "\n[escape](../../../../README.md)\n");
		expect(artifactClosureErrors(escaping).join("\n")).toContain("link leaves the artifact");
	});
});

function appendTo(path: string, text: string): void {
	writeFileSync(path, readFileSync(path, "utf8") + text);
}

describe("Antigravity distribution, version and generated outputs (AC4)", () => {
	it("npm dry-run includes the whole artifact and excludes the retired entrypoints", () => {
		const result = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: ROOT, encoding: "utf8" });
		expect(result.status).toBe(0);
		const packed: string[] = JSON.parse(result.stdout)[0].files.map((file: { path: string }) => file.path);
		for (const owned of files(ARTIFACT)) expect(packed).toContain(`${ANTIGRAVITY_ROOT}/${owned}`);
		for (const retired of [
			"plugins/immune-brain/plugin.json",
			"plugins/immune-brain/mcp_config.json",
			"plugins/immune-brain/hooks.json",
			"plugins/immune-brain/dist/antigravity/mcp-server.mjs",
		]) expect(packed).not.toContain(retired);
		for (const kept of [
			"plugins/immune-brain/.claude-plugin/plugin.json",
			"plugins/immune-brain/hooks/hooks.json",
			"plugins/immune-brain/.pi-extension/imm-canary-work.ts",
			"plugins/immune-brain/dist/claude/mcp-server.mjs",
		]) expect(packed).toContain(kept);
	});

	it("stamps and validates the relocated manifest, rejecting its absence or a version mismatch", () => {
		const root = scratchDir("version");
		for (const file of [
			"package.json",
			"plugins/immune-brain/.claude-plugin/plugin.json",
			"plugins/immune-brain/runtime/plugin_version.ts",
			`${ANTIGRAVITY_ROOT}/.antigravity-plugin/plugin.json`,
		]) {
			mkdirSync(resolve(root, file, ".."), { recursive: true });
			cpSync(resolve(ROOT, file), resolve(root, file));
		}
		expect(validateManifests(root).files).toContain(`${ANTIGRAVITY_ROOT}/.antigravity-plugin/plugin.json`);
		const manifest = resolve(root, ANTIGRAVITY_ROOT, ".antigravity-plugin/plugin.json");
		const original = readFileSync(manifest, "utf8");

		writeFileSync(manifest, original.replace(/"version": "[^"]+"/, '"version": "0.0.1"'));
		expect(() => validateManifests(root)).toThrow(`${ANTIGRAVITY_ROOT}/.antigravity-plugin/plugin.json version 0.0.1 does not match`);
		stampPluginManifest(root);
		expect(readFileSync(manifest, "utf8")).toBe(original);

		rmSync(manifest);
		expect(() => validateManifests(root)).toThrow(`Missing ${ANTIGRAVITY_ROOT}/.antigravity-plugin/plugin.json`);
		expect(() => stampPluginManifest(root)).toThrow(`Missing ${ANTIGRAVITY_ROOT}/.antigravity-plugin/plugin.json`);
	});

	it("declares the owned inventory as derived outputs and runs the check from CI and release", () => {
		const derived = JSON.parse(readFileSync(join(ROOT, "docs/agents/derived-files.json"), "utf8"));
		const entry = derived.entries.find((candidate: { id: string }) => candidate.id === "antigravity-plugin-artifact");
		const canonical = new Set<string>(CANONICAL_FILES);
		const owned = files(ARTIFACT).filter((file) => !canonical.has(file)).map((file) => `${ANTIGRAVITY_ROOT}/${file}`);
		expect([...entry.outputs].sort()).toEqual(owned);
		expect(entry.generate.argv).toEqual(["scripts/build-antigravity-plugin.ts"]);
		expect(entry.check.argv).toEqual(["scripts/build-antigravity-plugin.ts", "--check"]);
		expect(readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8")).toContain("bun scripts/build-antigravity-plugin.ts --check");
		expect(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts["verify:release"]).toContain("bun scripts/build-antigravity-plugin.ts --check");
	});

	describe("generated-output check on a fixture tree", () => {
		let fixture: string;
		const tempBundles = (): string[] => readdirSync(tmpdir()).filter((name) => name.startsWith("antigravity-bundle-"));

		beforeAll(() => {
			fixture = scratchDir("fixture");
			cpSync(resolve(ROOT, "package.json"), join(fixture, "package.json"));
			cpSync(resolve(ROOT, "plugins/immune-brain"), join(fixture, "plugins/immune-brain"), {
				recursive: true,
				filter: (source) => !/plugins\/immune-brain\/(dist\/claude|tests|\.plugin-eval)/.test(source),
			});
			cpSync(ARTIFACT, join(fixture, ANTIGRAVITY_ROOT), { recursive: true });
			rmSync(join(fixture, ANTIGRAVITY_ROOT, "dist"), { recursive: true, force: true });
		}, 60_000);

		it("builds identical owned bytes on repeat and then passes the read-only check", () => {
			buildAntigravityPlugin(fixture);
			const first = digest(join(fixture, ANTIGRAVITY_ROOT));
			buildAntigravityPlugin(fixture);
			expect(digest(join(fixture, ANTIGRAVITY_ROOT))).toEqual(first);
			expect(first).toEqual(digest(ARTIFACT));

			const before = digest(fixture);
			const bundlesBefore = tempBundles();
			checkAntigravityPlugin(fixture);
			expect(digest(fixture)).toEqual(before);
			expect(tempBundles()).toEqual(bundlesBefore);
		}, 120_000);

		it("detects changed source, a missing output and a stale extra output without writing", () => {
			const clarify = join(fixture, "plugins/immune-brain/skills/clarify/SKILL.md");
			const source = readFileSync(clarify, "utf8");
			const output = join(fixture, ANTIGRAVITY_ROOT, "skills/clarify/SKILL.md");
			const generated = readFileSync(output);
			const extra = join(fixture, ANTIGRAVITY_ROOT, "skills/stale.md");

			try {
				writeFileSync(clarify, source + "\nchanged\n");
				expect(() => checkAntigravityPlugin(fixture)).toThrow(`changed generated file: ${ANTIGRAVITY_ROOT}/skills/clarify/SKILL.md`);
				writeFileSync(clarify, source);

				rmSync(output);
				expect(() => checkAntigravityPlugin(fixture)).toThrow(`missing generated file: ${ANTIGRAVITY_ROOT}/skills/clarify/SKILL.md`);
				writeFileSync(output, generated);

				writeFileSync(extra, "stale");
				const before = digest(fixture);
				const bundlesBefore = tempBundles();
				expect(() => checkAntigravityPlugin(fixture)).toThrow(`stale generated file: ${ANTIGRAVITY_ROOT}/skills/stale.md`);
				expect(digest(fixture)).toEqual(before);
				expect(tempBundles()).toEqual(bundlesBefore);

				buildAntigravityPlugin(fixture);
				expect(existsSync(extra)).toBe(false);
			} finally {
				writeFileSync(clarify, source);
			}
		}, 180_000);

		it("repairs a wrapper that lost its executable bit, which the check reports as mode drift", () => {
			const wrapper = join(fixture, ANTIGRAVITY_ROOT, "bin/imm-kernel");
			chmodSync(wrapper, 0o644);
			expect(() => checkAntigravityPlugin(fixture)).toThrow(`mode drift: ${ANTIGRAVITY_ROOT}/bin/imm-kernel`);
			buildAntigravityPlugin(fixture);
			expect(statSync(wrapper).mode & 0o111).not.toBe(0);
			checkAntigravityPlugin(fixture);
		}, 120_000);

		it("fails explicitly for a missing manifest, role prompt or referenced contract input", () => {
			const manifest = join(fixture, ANTIGRAVITY_ROOT, ".antigravity-plugin/plugin.json");
			const original = readFileSync(manifest);
			rmSync(manifest);
			expect(() => checkAntigravityPlugin(fixture)).toThrow(/Missing/);
			writeFileSync(manifest, original);

			const prompt = join(fixture, "plugins/immune-brain/dist/role-prompts/code-review.md");
			const promptBytes = readFileSync(prompt);
			rmSync(prompt);
			try {
				expect(() => checkAntigravityPlugin(fixture)).toThrow("Missing role prompt for code-review");
			} finally {
				writeFileSync(prompt, promptBytes);
			}
		}, 60_000);
	});
});

describe("authority-review skill", () => {
	it("ships byte-equal to the shared plugin skill", () => {
		const shared = resolve(ROOT, "plugins/immune-brain/skills/authority-review/SKILL.md");
		expect(readFileSync(join(ARTIFACT, "skills/authority-review/SKILL.md"), "utf8")).toBe(readFileSync(shared, "utf8"));
	});
});

// Spec review-cli-stage D11: the Antigravity package ships the CLI reviewer's
// skill and the verifier agent. The agent allowlist is the set equality above;
// this suite adds the retired agent's absence as a package-level statement.
describe("retired reviewer agent", () => {
	const SHIPPED_AGENTS = [
		"immune-brain-advisory-reviewer.md",
		"immune-brain-qa.md",
		"immune-brain-review-verifier.md",
		"immune-brain-ui-review.md",
	];

	it("ships the authority-review skill and only the shipped agent definitions", () => {
		expect(existsSync(join(ARTIFACT, "skills/authority-review/SKILL.md"))).toBe(true);
		expect(existsSync(join(ARTIFACT, "agents/immune-brain-review-verifier.md"))).toBe(true);
		expect(readdirSync(join(ARTIFACT, "agents")).sort()).toEqual(SHIPPED_AGENTS);
	});

	it("derived-files lists the packaged skill and only the shipped agent definitions", () => {
		const derived = JSON.parse(readFileSync(join(ROOT, "docs/agents/derived-files.json"), "utf8")) as { entries: Array<{ outputs: string[] }> };
		const outputs = derived.entries.flatMap((entry) => entry.outputs);
		expect(outputs).toContain("plugins/immune-brain-antigravity/skills/authority-review/SKILL.md");
		expect(outputs.filter((path) => path.includes("/agents/")).sort())
			.toEqual(SHIPPED_AGENTS.map((name) => `plugins/immune-brain-antigravity/agents/${name}`));
	});
});
