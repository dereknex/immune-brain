import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// ponytail: global 2-year threshold, per-file scan if throughput matters split by directory
const TWO_YEARS_MS = 2 * 365.25 * 24 * 60 * 60 * 1000;
const TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;

function isNearFutureViolation(iso: string, nowMs: number): boolean {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return false;
  return ts > nowMs && ts < nowMs + TWO_YEARS_MS;
}

function collectTestFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) collectTestFiles(full, out);
    else if (full.endsWith(".ts") || full.endsWith(".js")) out.push(full);
  }
  return out;
}

describe("fixture expiry convention", () => {
  test("hardcoded absolute timestamps are not near-future (<2y)", () => {
    const now = Date.now();
    const files = collectTestFiles("tests");
    const violations: string[] = [];
    for (const file of files) {
      if (file.endsWith("fixture-expiry-convention.test.ts")) continue;
      const content = readFileSync(file, "utf8");
      let m: RegExpExecArray | null;
      TIMESTAMP_RE.lastIndex = 0;
      while ((m = TIMESTAMP_RE.exec(content)) !== null) {
        if (isNearFutureViolation(m[0], now)) violations.push(`${file}:${m[0]}`);
      }
    }
    expect(violations).toEqual([]);
  });

  test("guard logic: past and far-future pass, near-future fails", () => {
    const now = Date.parse("2026-08-20T00:00:00.000Z");
    // deliberately past fixtures must not be flagged
    expect(isNearFutureViolation("2026-08-12T00:00:00.000Z", now)).toBe(false);
    expect(isNearFutureViolation("2026-08-12T10:00:00.000Z", now)).toBe(false);
    expect(isNearFutureViolation("2020-01-01T00:00:00.000Z", now)).toBe(false);
    expect(isNearFutureViolation("2026-08-01T00:00:00.000Z", now)).toBe(false);
    // far-future convention must pass
    expect(isNearFutureViolation("2099-01-01T00:00:00.000Z", now)).toBe(false);
    // near-future (<2y) must fail
    expect(isNearFutureViolation("2026-09-01T00:00:00.000Z", now)).toBe(true);
    expect(isNearFutureViolation("2027-08-19T00:00:00.000Z", now)).toBe(true);
    // exactly ~2y ahead should pass (>=2y)
    expect(isNearFutureViolation("2028-08-20T00:00:00.000Z", now)).toBe(false);
    // 1 day beyond 2y should pass
    expect(isNearFutureViolation("2028-08-21T00:00:00.000Z", now)).toBe(false);
  });
});
