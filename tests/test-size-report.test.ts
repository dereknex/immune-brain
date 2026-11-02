import { describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseNumstat, summarizeDiffSize, summarizeTestSize } from "../scripts/test-size-report.ts";

const SCRIPT = resolve(import.meta.dir, "../scripts/test-size-report.ts");

describe("test size report", () => {
  test("separates test, support and source code and flags oversized test files", () => {
    const report = summarizeTestSize(
      [
        { path: "tests/a.test.ts", text: 'test("one", () => {});\n  it.each([1, 2])("two %d", () => {});\n' },
        { path: "tests/b.test.ts", text: "x\n".repeat(5) },
        { path: "tests/helpers/h.ts", text: "support\n" },
        { path: "src/main.ts", text: "a\nb\nc\nd\n" },
        { path: "plugins/x/dist/bundle.mjs", text: "generated\n".repeat(50) },
        { path: "README.md", text: "ignored\n" },
      ],
      { top: 1, maxLines: 4 },
    );
    expect(report).toEqual({
      testFiles: 2,
      testCases: 2,
      testLines: 7,
      sourceLines: 4,
      testToSourceRatio: 1.75,
      largest: [{ path: "tests/b.test.ts", lines: 5, cases: 0 }],
      overLimit: [{ path: "tests/b.test.ts", lines: 5, cases: 0 }],
    });
  });

  test("reports a zero ratio when there is no source", () => {
    expect(summarizeTestSize([{ path: "t.test.ts", text: "" }], { top: 5, maxLines: 10 }).testToSourceRatio).toBe(0);
  });

  test("diff mode counts test and source lines only and leaves the ratio null without source change", () => {
    const report = summarizeDiffSize([
      { path: "tests/x.test.ts", added: 10, deleted: 2 },
      { path: "src/a.ts", added: 3, deleted: 1 },
      { path: "tests/helpers/h.ts", added: 5, deleted: 0 },
      { path: "plugins/x/dist/b.mjs", added: 50, deleted: 50 },
      { path: "README.md", added: 4, deleted: 0 },
      { path: "src/logo.ts", added: null, deleted: null },
    ]);
    expect(report).toEqual({
      testLinesAdded: 10,
      testLinesDeleted: 2,
      sourceLinesAdded: 3,
      sourceLinesDeleted: 1,
      ratio: 2.5,
    });
    expect(summarizeDiffSize([{ path: "tests/x.test.ts", added: 7, deleted: 0 }]).ratio).toBeNull();
  });

  test("parses numstat -z records, keeping paths verbatim and binary counts null", () => {
    expect(parseNumstat("")).toEqual([]);
    const entries = parseNumstat("3\t1\tsrc/a.ts\x002\t0\tsrc/with space.ts\x00-\t-\timg.png\x00");
    expect(entries).toEqual([
      { path: "src/a.ts", added: 3, deleted: 1 },
      { path: "src/with space.ts", added: 2, deleted: 0 },
      { path: "img.png", added: null, deleted: null },
    ]);
    expect(summarizeDiffSize(entries.slice(2))).toEqual({
      testLinesAdded: 0,
      testLinesDeleted: 0,
      sourceLinesAdded: 0,
      sourceLinesDeleted: 0,
      ratio: null,
    });
  });

  test("--diff measures a range in the caller's checkout and rejects bad ranges", () => {
    const repo = mkdtempSync(join(tmpdir(), "test-size-diff-"));
    try {
      const git = (...args: string[]) =>
        execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], {
          cwd: repo,
          stdio: "pipe",
        });
      git("init", "-q");
      mkdirSync(join(repo, "tests"));
      writeFileSync(join(repo, "main.ts"), "a\nb\nc\n");
      writeFileSync(join(repo, "tests/m.test.ts"), "x\n");
      git("add", ".");
      git("commit", "-q", "-m", "base");
      writeFileSync(join(repo, "main.ts"), "a\nB\nC\n");
      writeFileSync(join(repo, "tests/m.test.ts"), "x\n1\n2\n3\n4\n");
      git("commit", "-q", "-am", "change");

      const run = (...args: string[]) => spawnSync("bun", [SCRIPT, ...args], { cwd: repo, encoding: "utf8" });
      const ok = run("--diff", "HEAD~1..HEAD", "--json");
      expect(ok.status).toBe(0);
      expect(JSON.parse(ok.stdout)).toEqual({
        range: "HEAD~1..HEAD",
        testLinesAdded: 4,
        testLinesDeleted: 0,
        sourceLinesAdded: 2,
        sourceLinesDeleted: 2,
        ratio: 1,
      });

      const bad = run("--diff", "nosuch..HEAD");
      expect(bad.status).toBe(1);
      expect(bad.stdout).toBe("");
      expect(bad.stderr).toContain("nosuch..HEAD");

      const missing = run("--diff");
      expect(missing.status).toBe(1);
      expect(missing.stdout).toBe("");
      expect(missing.stderr).toContain("usage:");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
