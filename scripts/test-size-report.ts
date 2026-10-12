#!/usr/bin/env bun
// Read-only test-suite size report. It observes tracked files and exits 0; it is
// not a CI gate. Usage: bun scripts/test-size-report.ts [--json] [--top N] [--max-lines N]
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
    if (!CODE_RE.test(file.path) || EXCLUDED_RE.test(file.path)) continue
    const lines = lineCount(file.text)
    if (TEST_RE.test(file.path)) {
      tests.push({ path: file.path, lines, cases: file.text.match(CASE_RE)?.length ?? 0 })
    } else if (!/(?:^|\/)tests\//.test(file.path)) {
      sourceLines += lines
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

function numberFlag(args: string[], name: string, fallback: number): number {
  const index = args.indexOf(name)
  if (index < 0) return fallback
  const value = Number(args[index + 1])
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} needs a non-negative integer`)
  return value
}

if (import.meta.main) {
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
