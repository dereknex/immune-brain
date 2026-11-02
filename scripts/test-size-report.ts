#!/usr/bin/env bun
// Read-only test-suite size report. It observes tracked files and exits 0; it is
// not a CI gate. Usage: bun scripts/test-size-report.ts [--json] [--top N] [--max-lines N]
//                     bun scripts/test-size-report.ts --diff <range> [--json]
// The --diff mode reports one change's added test lines against its changed source
// lines, measured in the caller's checkout (cwd).
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const CODE_RE = /\.(?:ts|tsx|js|mjs)$/
const TEST_RE = /\.test\.(?:ts|tsx|js|mjs)$/
// Generated or vendored output distorts the source baseline.
const EXCLUDED_RE = /(?:^|\/)(?:node_modules|dist|benchmark-results)\//
// One declared case per test/it call; test.each counts once.
const CASE_RE = /^\s*(?:test|it)(?:\.(?:each|skip|only|todo|if)\b[^(]*\([^)]*\))?\s*\(/gm

export interface TrackedFile {
  path: string
  text: string
}

export interface TestFileSize {
  path: string
  lines: number
  cases: number
}

export interface TestSizeReport {
  testFiles: number
  testCases: number
  testLines: number
  sourceLines: number
  testToSourceRatio: number
  largest: TestFileSize[]
  overLimit: TestFileSize[]
}

export interface NumstatEntry {
  path: string
  // null for a binary entry, whose line counts Git reports as "-".
  added: number | null
  deleted: number | null
}

export interface DiffSizeReport {
  testLinesAdded: number
  testLinesDeleted: number
  sourceLinesAdded: number
  sourceLinesDeleted: number
  // Added test lines per changed (added + deleted) source line; null when no source changed.
  ratio: number | null
}

// Shared by both modes: generated output, non-code files and non-test files under
// tests/ (helpers, fixtures) count as neither test nor source.
function classify(path: string): "test" | "source" | null {
  if (!CODE_RE.test(path) || EXCLUDED_RE.test(path)) return null
  if (TEST_RE.test(path)) return "test"
  return /(?:^|\/)tests\//.test(path) ? null : "source"
}

function lineCount(text: string): number {
  if (text.length === 0) return 0
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0)
}

export function summarizeTestSize(
  files: TrackedFile[],
  options: { top: number; maxLines: number },
): TestSizeReport {
  const tests: TestFileSize[] = []
  let sourceLines = 0
  for (const file of files) {
    const kind = classify(file.path)
    if (kind === "test") {
      tests.push({ path: file.path, lines: lineCount(file.text), cases: file.text.match(CASE_RE)?.length ?? 0 })
    } else if (kind === "source") {
      sourceLines += lineCount(file.text)
    }
  }
  const bySize = [...tests].sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path))
  const testLines = tests.reduce((sum, file) => sum + file.lines, 0)
  return {
    testFiles: tests.length,
    testCases: tests.reduce((sum, file) => sum + file.cases, 0),
    testLines,
    sourceLines,
    testToSourceRatio: sourceLines === 0 ? 0 : Number((testLines / sourceLines).toFixed(2)),
    largest: bySize.slice(0, options.top),
    overLimit: bySize.filter((file) => file.lines > options.maxLines),
  }
}

// Parses `git diff --numstat -z --no-renames` output: one `added\tdeleted\tpath\0`
// record per file, with the path kept verbatim.
export function parseNumstat(output: string): NumstatEntry[] {
  const entries: NumstatEntry[] = []
  for (const record of output.split("\0")) {
    if (record.length === 0) continue
    const first = record.indexOf("\t")
    const second = record.indexOf("\t", first + 1)
    if (first < 0 || second < 0) throw new Error(`unexpected numstat record: ${JSON.stringify(record)}`)
    const count = (field: string) => (field === "-" ? null : Number(field))
    entries.push({
      added: count(record.slice(0, first)),
      deleted: count(record.slice(first + 1, second)),
      path: record.slice(second + 1),
    })
  }
  return entries
}

export function summarizeDiffSize(entries: NumstatEntry[]): DiffSizeReport {
  const report = { testLinesAdded: 0, testLinesDeleted: 0, sourceLinesAdded: 0, sourceLinesDeleted: 0 }
  for (const entry of entries) {
    if (entry.added === null || entry.deleted === null) continue
    const kind = classify(entry.path)
    if (kind === "test") {
      report.testLinesAdded += entry.added
      report.testLinesDeleted += entry.deleted
    } else if (kind === "source") {
      report.sourceLinesAdded += entry.added
      report.sourceLinesDeleted += entry.deleted
    }
  }
  const changedSource = report.sourceLinesAdded + report.sourceLinesDeleted
  return {
    ...report,
    ratio: changedSource === 0 ? null : Number((report.testLinesAdded / changedSource).toFixed(2)),
  }
}

function diffMode(args: string[]): void {
  const range = args[args.indexOf("--diff") + 1]
  if (range === undefined || range.startsWith("-")) {
    console.error("usage: bun scripts/test-size-report.ts --diff <range> [--json]")
    process.exit(1)
  }
  let output: string
  try {
    output = execFileSync("git", ["diff", "--numstat", "-z", "--no-renames", range, "--"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? "").trim().split("\n")[0]
    console.error(`test-size-report: cannot diff ${range}${stderr ? `: ${stderr}` : ""}`)
    process.exit(1)
  }
  const report = summarizeDiffSize(parseNumstat(output))
  if (args.includes("--json")) {
    console.log(JSON.stringify({ range, ...report }, null, 2))
  } else {
    console.log(`range: ${range}`)
    console.log(`test lines added: ${report.testLinesAdded}`)
    console.log(`test lines deleted: ${report.testLinesDeleted}`)
    console.log(`source lines added: ${report.sourceLinesAdded}`)
    console.log(`source lines deleted: ${report.sourceLinesDeleted}`)
    console.log(`added test / changed source ratio: ${report.ratio ?? "n/a (no source change)"}`)
  }
}

function numberFlag(args: string[], name: string, fallback: number): number {
  const index = args.indexOf(name)
  if (index < 0) return fallback
  const value = Number(args[index + 1])
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} needs a non-negative integer`)
  return value
}

if (import.meta.main && process.argv.includes("--diff")) {
  diffMode(process.argv.slice(2))
} else if (import.meta.main) {
  const args = process.argv.slice(2)
  const root = resolve(import.meta.dir, "..")
  const paths = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter((path) => CODE_RE.test(path))
  const files = paths.map((path) => ({ path, text: readFileSync(join(root, path), "utf8") }))
  const report = summarizeTestSize(files, {
    top: numberFlag(args, "--top", 10),
    maxLines: numberFlag(args, "--max-lines", 1500),
  })
  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(`test files: ${report.testFiles}`)
    console.log(`test cases: ${report.testCases}`)
    console.log(`test lines: ${report.testLines}`)
    console.log(`source lines: ${report.sourceLines}`)
    console.log(`test/source ratio: ${report.testToSourceRatio}`)
    console.log("largest test files:")
    for (const file of report.largest) console.log(`  ${file.lines}\t${file.cases} cases\t${file.path}`)
    console.log(`over line limit: ${report.overLimit.length}`)
    for (const file of report.overLimit) console.log(`  ${file.lines}\t${file.path}`)
  }
}
