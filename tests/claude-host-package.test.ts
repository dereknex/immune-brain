import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { buildClaudePlugin, checkClaudePlugin } from "../scripts/build-claude-plugin";
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
const SKILLS = ["imm-brainstorm", "imm-planner", "imm-loop", "imm-pr-fix", "imm-doc-prune", "imm-agent-doc-maintain"];

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
      "approve_breaking_intent_revision",
      "stop",
      "repair_authority_state",
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
      "plugins/immune-brain/skills/imm-loop/SKILL.md",
    ]) expect(files).toContain(required);
    expect(files.some((path: string) => path.startsWith("tests/"))).toBe(false);
    expect(files.some((path: string) => path.startsWith(".cursor-plugin/"))).toBe(false);
  });

  it("does not fork the six Skill contracts", () => {
    const dist = readdirSync(resolve(PLUGIN_ROOT, "dist")).filter((name) => name.startsWith("imm-") && name.endsWith(".md"));
    expect(dist.sort()).toEqual(["imm-agent-doc-maintain.md", "imm-brainstorm.md", "imm-doc-prune.md", "imm-loop.md", "imm-planner.md", "imm-pr-fix.md"]);
  });
});
