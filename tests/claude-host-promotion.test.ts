import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { REQUIRED_SCENARIOS, validateConformanceReport } from "../scripts/claude-host-conformance";
import { MIN_CLAUDE_CODE_VERSION } from "../plugins/immune-brain/runtime/claude/capability";

const ROOT = resolve(import.meta.dir, "..");

describe("claude host promotion", () => {
  it("binds the real-Host conformance report to public support claims without treating it as QA authority", () => {
    const version = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).version as string;
    const report = validateConformanceReport(ROOT, version);
    expect(report.minimum_version).toBe(MIN_CLAUDE_CODE_VERSION);
    expect(report.authority).toBe("hitl-evidence");
    expect(Object.keys(report.scenarios).sort()).toEqual([...REQUIRED_SCENARIOS].sort());
    for (const id of REQUIRED_SCENARIOS) {
      expect(report.scenarios[id]?.result).toBe("pass");
      expect(report.scenarios[id]?.notes.length).toBeGreaterThan(0);
    }
    expect(report.plugin_validate).toBe("pass");
    expect(report.package_version).toBe(version);
    const readme = readFileSync(resolve(ROOT, "README.md"), "utf8");
    const zh = readFileSync(resolve(ROOT, "README.zh-CN.md"), "utf8");
    expect(readme).toContain("Claude Code");
    expect(readme).toContain("Pi and Claude Code are the supported hosts");
    expect(zh).toContain("Claude Code");
    expect(readme).toContain(MIN_CLAUDE_CODE_VERSION);
    expect(readme).toContain("docs/verification/claude-code-host-conformance.md");
    expect(readme).not.toContain("Pi remains the only host");
    const reportText = readFileSync(resolve(ROOT, "docs/verification/claude-code-host-conformance.md"), "utf8");
    expect(reportText).toContain("not a QA attestation");
    expect(reportText).toContain("not Kernel authority");
    expect(reportText).toContain(`package_version: ${version}`);
  });
});
