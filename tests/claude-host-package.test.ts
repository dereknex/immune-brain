import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { buildClaudePlugin, checkClaudePlugin, readonlyRoleDefinitionDrift, reviewerDefinitionDrift } from "../scripts/build-claude-plugin";
import {
	INTERNAL_ROLE_PROMPTS,
	REVIEWER_DISPATCH_RULES,
	STATIC_REVIEW_RULES,
} from "../plugins/immune-brain/runtime/role_prompt_bridge";
import {
	CLAUDE_READONLY_ROLE_AGENTS,
	CLAUDE_READONLY_ROLES,
	CLAUDE_READONLY_TOOLS,
	CLAUDE_HOST_PROVIDED_ROLE_AGENTS,
} from "../plugins/immune-brain/runtime/claude/role_agents";
import { buildLoopRoleDispatch, loopRoleSubagentFor } from "../plugins/immune-brain/runtime/loop_contract";
import { stampPluginManifest, validateManifests } from "../scripts/plugin_versioning";
import { MIN_CLAUDE_CODE_VERSION, probeHost } from "../plugins/immune-brain/runtime/claude/capability";
import { PLUGIN_VERSION } from "../plugins/immune-brain/runtime/plugin_version";
import { handleJsonRpc, listMcpTools } from "../plugins/immune-brain/runtime/claude/mcp_server";

const ROOT = resolve(import.meta.dir, "..");
const PLUGIN_ROOT = resolve(ROOT, "plugins/immune-brain");
const REQUIRED = [
  ".claude-plugin/marketplace.json",
  "plugins/immune-brain/.claude-plugin/plugin.json",
  "plugins/immune-brain/.mcp.json",
  "plugins/immune-brain/hooks/hooks.json",
  "plugins/immune-brain/agents/immune-brain-reviewer.md",
];
const REJECTED = [
  ".cursor-plugin",
  "plugins/immune-brain/.codex-plugin",
  "plugins/immune-brain/.cursor-plugin",
  "plugins/immune-brain/.opencode-plugin",
];
const SKILLS = ["imm-brainstorm", "imm-planner", "imm-run", "imm-pr-fix", "imm-doc-prune", "imm-doc-slim"];

describe("claude host package", () => {
  it("ships one versioned Pi+Claude allowlist and rejects undeclared hosts", () => {
    const version = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).version;
    const plugin = JSON.parse(readFileSync(resolve(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf8"));
    expect(plugin.version).toBe(version);
    expect(validateManifests(ROOT).files).toEqual([
      "package.json",
      "plugins/immune-brain/.claude-plugin/plugin.json",
      "plugins/immune-brain/runtime/plugin_version.ts",
    ]);
    const missing = mkdtempSync(join(tmpdir(), "missing-plugin-"));
    writeFileSync(join(missing, "package.json"), JSON.stringify({ version: "0.0.1" }) + "\n");
    expect(() => validateManifests(missing)).toThrow(/plugin.json/);
    expect(() => stampPluginManifest(missing)).toThrow(/plugin.json/);
    for (const path of REQUIRED) expect({ path, exists: existsSync(resolve(ROOT, path)) }).toEqual({ path, exists: true });
    for (const path of REJECTED) expect({ path, exists: existsSync(resolve(ROOT, path)) }).toEqual({ path, exists: false });
    const mcp = JSON.parse(readFileSync(resolve(PLUGIN_ROOT, ".mcp.json"), "utf8"));
    expect(mcp.mcpServers["immune-brain"].args[0]).toBe("${CLAUDE_PLUGIN_ROOT}/dist/claude/mcp-server.mjs");
    expect(mcp.mcpServers["immune-brain"].command).toBe("node");
    for (const skill of SKILLS) {
      expect(existsSync(resolve(PLUGIN_ROOT, `skills/${skill}/SKILL.md`))).toBe(true);
      expect(existsSync(resolve(PLUGIN_ROOT, `dist/${skill}.md`))).toBe(true);
    }
  });

  it("checked-in mcp-server.mjs matches a fresh generate", () => {
    checkClaudePlugin(ROOT);
  });

  it("builds a self-contained Node stdio server and answers initialize", () => {
    const built = buildClaudePlugin(ROOT);
    expect(existsSync(built.out)).toBe(true);
    const source = readFileSync(built.out, "utf8");
    expect(source).not.toContain("CLAUDE_PLUGIN_ROOT}/../");
    expect(source).not.toContain("Content-Length");
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } },
    });
    const child = spawnSync("node", [built.out], {
      cwd: ROOT,
      encoding: "utf8",
      input: `${body}\n`,
      timeout: 5000,
    });
    expect(child.error).toBeUndefined();
    expect(child.stdout).toContain("claude-code");
    expect(child.stdout).toContain("tools");

    // Rejects malformed JSON with -32700 Parse error
    const parseErr = spawnSync("node", [built.out], {
      cwd: ROOT,
      encoding: "utf8",
      input: "not json\n",
      timeout: 5000,
    });
    expect(parseErr.stdout).toContain("-32700");

    // Rejects non-object JSON with -32600 Invalid Request
    const nonObj = spawnSync("node", [built.out], {
      cwd: ROOT,
      encoding: "utf8",
      input: "null\n42\n",
      timeout: 5000,
    });
    expect(nonObj.stdout).toContain("-32600");

    // Rejects missing or wrong jsonrpc version
    const wrongRpc = spawnSync("node", [built.out], {
      cwd: ROOT,
      encoding: "utf8",
      input: JSON.stringify({ id: 1, method: "tools/list" }) + "\n" + JSON.stringify({ jsonrpc: "1.0", id: 2, method: "tools/list" }) + "\n",
      timeout: 5000,
    });
    expect(wrongRpc.stdout).toContain("-32600");

    // Rejects invalid id types (e.g. object or boolean)
    const invalidId = spawnSync("node", [built.out], {
      cwd: ROOT,
      encoding: "utf8",
      input: JSON.stringify({ jsonrpc: "2.0", id: { bad: true }, method: "tools/list" }) + "\n",
      timeout: 5000,
    });
    expect(invalidId.stdout).toContain("-32600");

    // Rejects notification-form tools/call (no id)
    const notifyCall = spawnSync("node", [built.out], {
      cwd: ROOT,
      encoding: "utf8",
      input: JSON.stringify({ jsonrpc: "2.0", method: "tools/call", params: { name: "status" } }) + "\n",
      timeout: 5000,
    });
    expect(notifyCall.stdout).toContain("-32600");
  });

  it("keeps Pi package installation and lists privileged MCP tools", async () => {
    const manifest = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
    expect(manifest.pi).toEqual({
      skills: ["./plugins/immune-brain/skills"],
      extensions: ["./plugins/immune-brain/.pi-extension"],
    });
    expect(manifest.files).toContain(".claude-plugin");
    expect(manifest.files).toContain("plugins/immune-brain/.pi-extension");
    expect(manifest.files).toContain("plugins/immune-brain/runtime/claude");
    expect(manifest.files).toContain("plugins/immune-brain/runtime/plugin_version.ts");
    expect(manifest.scripts["changeset:version"]).toContain("build-claude-plugin.ts");
    expect(manifest.scripts["changeset:publish"]).toBe("bun run verify:release && changeset publish");
    expect(listMcpTools().map((tool) => tool.name)).toEqual([
      "status",
      "enroll",
      "advance_assurance",
      "submit_review",
      "request_authorization",
      "revise_intent",
      "approve_breaking_intent_revision",
      "stop",
      "start_unattended_batch",
      "retire_stale_batch",
      "repair_authority_state",
      "resolve_finding",
      "refute_finding",
    ]);
    const init = await handleJsonRpc({ jsonrpc: "2.0", id: 1, method: "initialize" });
    expect(init?.result).toMatchObject({
      serverInfo: {
        name: "claude-code",
        version: PLUGIN_VERSION,
        minimumHostVersion: MIN_CLAUDE_CODE_VERSION,
      },
    });
  });

  it("fails closed on unsupported Claude versions and native Windows", () => {
    expect(probeHost({ CLAUDE_CODE_VERSION: "2.1.235" }).ok).toBe(false);
    // Prerelease builds never satisfy the stable minimum: numeric-only
    // comparison must not accept 2.1.236-alpha as 2.1.236.
    expect(probeHost({ CLAUDE_CODE_VERSION: "2.1.236-alpha" }).ok).toBe(false);
    expect(probeHost({ CLAUDE_CODE_VERSION: "2.1.236+build.1" }).ok).toBe(false);
    expect(probeHost({ CLAUDE_CODE_VERSION: MIN_CLAUDE_CODE_VERSION }, "win32").ok).toBe(false);
    expect(probeHost({ CLAUDE_CODE_VERSION: MIN_CLAUDE_CODE_VERSION }, "linux").ok).toBe(true);
    expect(probeHost({ CLAUDE_CODE_VERSION: MIN_CLAUDE_CODE_VERSION }, "darwin").ok).toBe(true);
  });

  it("optionally validates the plugin with the installed Claude CLI", () => {
    const claude = spawnSync("claude", ["plugin", "validate", "--strict", PLUGIN_ROOT], { encoding: "utf8", timeout: 20000 });
    if (claude.error) {
      // Only an explicitly missing CLI makes the optional validation
      // skippable; timeouts and other launch failures must fail the run.
      // Node sets errno `code`; Bun reports ENOENT via the message and
      // leaves status undefined instead of null.
      const err = claude.error as NodeJS.ErrnoException;
      const missing = err.code === "ENOENT" || /Executable not found|ENOENT/.test(err.message);
      if (missing) return;
      throw claude.error;
    }
    if (claude.status === 127) return;
    if (claude.status !== 0) {
      throw new Error(`claude plugin validate failed: ${claude.stderr || claude.stdout}`);
    }
  });

  it("npm pack includes the Claude plugin and keeps Pi files", () => {
    const result = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: ROOT, encoding: "utf8" });
    expect(result.status).toBe(0);
    const files = JSON.parse(result.stdout)[0].files.map((file: { path: string }) => file.path);
    for (const required of [
      "package.json",
      "plugins/immune-brain/.pi-extension/imm-canary-work.ts",
      ".claude-plugin/marketplace.json",
      "plugins/immune-brain/.claude-plugin/plugin.json",
      "plugins/immune-brain/.mcp.json",
      "plugins/immune-brain/runtime/claude/mcp_server.ts",
      "plugins/immune-brain/skills/imm-run/SKILL.md",
    ]) expect(files).toContain(required);
    expect(files.some((path: string) => path.startsWith("tests/"))).toBe(false);
    expect(files.some((path: string) => path.startsWith(".cursor-plugin/"))).toBe(false);
  });

  it("reviewer definition forbids continuation and recovers only through recovery_action", () => {
    const reviewer = readFileSync(resolve(PLUGIN_ROOT, "agents/immune-brain-reviewer.md"), "utf8").replace(/\s+/g, " ");
    expect(reviewer).toContain("A dispatched reviewer is never continued or re-prompted, including through SendMessage");
    expect(reviewer).toContain("The reserved prompt is dispatched verbatim");
    expect(reviewer).toContain("A blocked `submit_review` is recovered only through its returned `recovery_action`");
  });

  it("reviewer definition states the inspected_paths requirement and its read-before-claim rule", () => {
    const reviewer = readFileSync(resolve(PLUGIN_ROOT, "agents/immune-brain-reviewer.md"), "utf8").replace(/\s+/g, " ");
    expect(reviewer).toContain("A pass verdict's approval must carry `inspected_paths`");
    expect(reviewer).toContain("A path may be listed only after its diff was read");
    expect(reviewer).toContain("deleted paths included");
    expect(reviewer).toContain("lists a path outside the change set");
    expect(reviewer).toContain("duplicates a path");
  });

  it("reviewer definition declares exactly the native read-only tool boundary", () => {
    const source = readFileSync(resolve(PLUGIN_ROOT, "agents/immune-brain-reviewer.md"), "utf8");
    const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
    expect(match).not.toBeNull();
    const frontmatter = match![1];

    // The allowlist is read from the shipped frontmatter, not from a runtime
    // string, so a definition that stops asking for the boundary fails here.
    const toolsLine = /^tools:[^\n]*$/m.exec(frontmatter);
    expect(toolsLine).not.toBeNull();
    const tools = toolsLine![0]
      .slice("tools:".length)
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .sort();
    expect(tools).toEqual(["Bash", "Glob", "Grep", "Read"]);

    // Adding any of these would let the reviewer write, dispatch or escape its
    // read-only boundary; removing one narrows the evidence it can gather.
    for (const denied of ["Agent", "Edit", "Write", "NotebookEdit"]) expect(tools).not.toContain(denied);

    // Plugin agents ignore these keys, so declaring one would read as an
    // enforced boundary that the Host never applies.
    for (const ignored of ["hooks", "mcpServers", "permissionMode"]) {
      expect(new RegExp(`^${ignored}:`, "m").test(frontmatter)).toBe(false);
    }
    expect(source).not.toContain("hooks:");
    expect(source).not.toContain("mcpServers:");
    expect(source).not.toContain("permissionMode:");
  });

  it("the reviewer definition body is generated from the role prompt and the exported static rules", () => {
    const definition = readFileSync(resolve(PLUGIN_ROOT, "agents/immune-brain-reviewer.md"), "utf8");
    const rolePrompt = readFileSync(resolve(PLUGIN_ROOT, "runtime/prompts/code-review.md"), "utf8").trim();

    // One source: the definition carries the same role prompt bytes the Pi Host
    // dispatches, followed by the same static sentences the runtime composes
    // into a complete Review prompt. Neither is restated by hand.
    expect(definition).toContain(rolePrompt);
    for (const rule of [...STATIC_REVIEW_RULES, ...REVIEWER_DISPATCH_RULES]) expect(definition).toContain(rule);

    // Nothing is invented by the generator: every non-empty paragraph after the
    // frontmatter and the role prompt comes from those exported rules.
    const body = definition.slice(definition.indexOf(rolePrompt) + rolePrompt.length);
    const extra = body.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
    const sources = [...STATIC_REVIEW_RULES, ...REVIEWER_DISPATCH_RULES] as unknown as string[];
    expect(extra.filter((line) => !sources.some((rule) => line === rule.trim()))).toEqual([]);
  });

  it("carries the agreed-seam coverage rule into the generated reviewer definition", () => {
    const definition = readFileSync(resolve(PLUGIN_ROOT, "agents/immune-brain-reviewer.md"), "utf8");
    const rolePrompt = readFileSync(resolve(PLUGIN_ROOT, "runtime/prompts/code-review.md"), "utf8").trim();
    const flat = (text: string) => text.replace(/\s+/g, " ");

    expect(flat(rolePrompt)).toContain("names an agreed seam");
    // The generated definition is one composition of the role prompt, so the seam
    // rule reaches the Claude-native reviewer without being restated by hand.
    expect(flat(definition)).toContain("names an agreed seam");
    expect(reviewerDefinitionDrift(ROOT)).toBeNull();
  });

  it("the build check fails when the committed reviewer definition differs from the generated one", () => {
    expect(reviewerDefinitionDrift(ROOT)).toBeNull();

    const root = mkdtempSync(join(tmpdir(), "reviewer-drift-"));
    try {
      const promptDir = join(root, "plugins/immune-brain/runtime/prompts");
      const agentDir = join(root, "plugins/immune-brain/agents");
      mkdirSync(promptDir, { recursive: true });
      mkdirSync(agentDir, { recursive: true });
      const rolePrompt = readFileSync(resolve(PLUGIN_ROOT, "runtime/prompts/code-review.md"), "utf8");
      writeFileSync(join(promptDir, "code-review.md"), rolePrompt);

      // A hand-edited definition: correct tool boundary, one lost rule.
      const committed = readFileSync(resolve(PLUGIN_ROOT, "agents/immune-brain-reviewer.md"), "utf8");
      writeFileSync(join(agentDir, "immune-brain-reviewer.md"), committed.replace(STATIC_REVIEW_RULES[0], ""));
      expect(reviewerDefinitionDrift(root)).toContain("drifted from a fresh generate");

      // And the reverse: a role prompt whose bytes no longer match.
      writeFileSync(join(agentDir, "immune-brain-reviewer.md"), committed);
      writeFileSync(join(promptDir, "code-review.md"), `${rolePrompt}\nHand-added instruction.`);
      expect(reviewerDefinitionDrift(root)).toContain("drifted from a fresh generate");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ships one generated native definition per read-only Claude role", () => {
    // Exactly the three roles the acceptance names: a set equality, so adding a
    // fourth definition or dropping one fails here rather than shipping a
    // definition nothing dispatches.
    expect([...CLAUDE_READONLY_ROLES].sort()).toEqual(["advisory-reviewer", "qa", "ui-review"]);

    const WRITE_TOOLS = ["Agent", "Edit", "Write", "NotebookEdit", "Bash", "WebFetch", "WebSearch", "Task", "SendMessage"];
    for (const role of CLAUDE_READONLY_ROLES) {
      const spec = CLAUDE_READONLY_ROLE_AGENTS[role];
      const path = resolve(ROOT, spec.definition);
      expect({ role, exists: existsSync(path) }).toEqual({ role, exists: true });
      const source = readFileSync(path, "utf8");

      // The body comes from the role prompt the runtime dispatches on Pi, so a
      // definition cannot state a boundary the role prompt does not.
      expect(source).toContain(readFileSync(resolve(ROOT, spec.prompt), "utf8").trim());

      const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
      expect({ role, frontmatter: match !== null }).toEqual({ role, frontmatter: true });
      const frontmatter = match![1];
      const toolsLine = /^tools:[^\n]*$/m.exec(frontmatter);
      const tools = (toolsLine?.[0] ?? "").slice("tools:".length).split(",").map((t) => t.trim()).filter((t) => t.length > 0).sort();
      expect({ role, tools }).toEqual({ role, tools: [...CLAUDE_READONLY_TOOLS].sort() });
      for (const denied of WRITE_TOOLS) expect({ role, denied }).toEqual({ role, denied: tools.includes(denied) ? `${denied} is not denied` : denied });

      // Plugin agents ignore these keys, so declaring one would read as an
      // enforced boundary the Host never applies.
      for (const ignored of ["hooks", "mcpServers", "permissionMode"])
        expect({ role, ignored }).toEqual({ role, ignored: new RegExp(`^${ignored}:`, "m").test(frontmatter) ? `${ignored} is declared` : ignored });

      // The declared boundary of a role that ships a definition is read-only, so
      // no definition can widen what the role prompt already forbids.
      const policy = INTERNAL_ROLE_PROMPTS[role].tool_policy;
      expect({ role, policy }).toEqual({ role, policy: ["no tools", "read-only tools"].includes(policy) ? policy : `${policy} is not read-only` });
    }

    // `arch-explorer` is architecture discovery: the Host's own read-only
    // research agent, and shipping a second definition would fork that boundary.
    expect(Object.keys(CLAUDE_HOST_PROVIDED_ROLE_AGENTS)).toEqual(["arch-explorer"]);
    expect(existsSync(resolve(ROOT, "plugins/immune-brain/agents/immune-brain-arch-explorer.md"))).toBe(false);
  });

  it("the build check fails when a committed read-only definition differs from the generated one", () => {
    expect(readonlyRoleDefinitionDrift(ROOT)).toBeNull();

    const root = mkdtempSync(join(tmpdir(), "readonly-drift-"));
    try {
      const spec = CLAUDE_READONLY_ROLE_AGENTS.qa;
      mkdirSync(join(root, "plugins/immune-brain/runtime/prompts"), { recursive: true });
      mkdirSync(join(root, "plugins/immune-brain/agents"), { recursive: true });
      // The drift check walks every mapped role, so the temp root needs all of
      // their prompt sources and committed definitions, not just the mutated one.
      for (const mapped of Object.values(CLAUDE_READONLY_ROLE_AGENTS)) {
        writeFileSync(join(root, mapped.prompt), readFileSync(resolve(ROOT, mapped.prompt), "utf8"));
        writeFileSync(join(root, mapped.definition), readFileSync(resolve(ROOT, mapped.definition), "utf8"));
      }

      // A hand-widened boundary: one shell tool added to a role that declares none.
      const committed = readFileSync(resolve(ROOT, spec.definition), "utf8");
      writeFileSync(join(root, spec.definition), committed.replace("tools: Read, Grep, Glob", "tools: Read, Grep, Glob, Bash"));
      expect(readonlyRoleDefinitionDrift(root)).toContain("drifted from a fresh generate");

      // And a hand-added instruction the role prompt does not carry.
      writeFileSync(join(root, spec.definition), `${committed}Hand-added instruction.\n`);
      expect(readonlyRoleDefinitionDrift(root)).toContain("drifted from a fresh generate");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("leaves the Pi role mapping and dispatch envelope unchanged", () => {
    // The native definitions add a Claude dispatch route; they do not move the
    // Pi one. `loopRoleSubagentFor` is the Pi mapping and stays as it was.
    expect(loopRoleSubagentFor("code-review")).toBe("Review");
    expect(loopRoleSubagentFor("arch-explorer")).toBe("Explore");
    for (const role of ["qa", "ui-review", "advisory-reviewer", "executor", "test-fixer", "pr-fix", "compounder"] as const)
      expect(loopRoleSubagentFor(role)).toBe("general-purpose");

    const dispatch = buildLoopRoleDispatch({ role: "advisory-reviewer", context: { task_id: "package-task", target_id: "t1" } });
    expect(dispatch.call).toMatchObject({
      subagent_type: "general-purpose",
      inherit_context: false,
      isolated: true,
      run_in_background: false,
    });
    expect(dispatch.call.prompt).toContain("internal role: advisory-reviewer");
    expect(dispatch.call.prompt).toContain("tool_policy: no tools");
    // The Pi boundary stays prompt text: the envelope carries no agent name.
    expect(dispatch.call.prompt).not.toContain("immune-brain:immune-brain-advisory-reviewer");
  });

  it("does not fork the public Skill contracts", () => {
    const dist = readdirSync(resolve(PLUGIN_ROOT, "dist")).filter((name) => name.startsWith("imm-") && name.endsWith(".md"));
    expect(dist.sort()).toEqual(["imm-brainstorm.md", "imm-doc-prune.md", "imm-doc-slim.md", "imm-planner.md", "imm-pr-fix.md", "imm-retro.md", "imm-run.md"]);
  });
});
