import { describe, expect, test } from "bun:test";
import { summarizeTestSize } from "../scripts/test-size-report.ts";

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
});
