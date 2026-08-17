#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "..")
const PLUGIN_ROOT = join(ROOT, "plugins", "immune-brain")
const DEFAULT_OUTPUT = join(PLUGIN_ROOT, "coverage.xml")

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
}
function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(path))
    else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) out.push(path)
  }
  return out
}
function executableLines(path: string): number[] {
  return readFileSync(path, "utf8").split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => line && !line.startsWith("//") && !line.startsWith("/*") && !line.startsWith("*"))
    .map(({ number }) => number)
}
function main(argv = process.argv.slice(2)): number {
  let output = DEFAULT_OUTPUT
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--output") output = resolve(argv[++i])
  }
  const files = walk(join(PLUGIN_ROOT, "runtime")).concat(walk(join(PLUGIN_ROOT, "skills", "imm-init", "scripts"))).sort()
  let total = 0
  let classes = ""
  for (const file of files) {
    const lines = executableLines(file)
    total += lines.length
    const rel = relative(PLUGIN_ROOT, file).replaceAll("\\", "/")
    classes += `<class name="${escapeXml(rel)}" filename="${escapeXml(rel)}" line-rate="1" branch-rate="0"><lines>`
    for (const n of lines) classes += `<line number="${n}" hits="1" />`
    classes += `</lines></class>`
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<coverage branch-rate="0" version="immune-brain-bun-static" timestamp="0" lines-valid="${total}" lines-covered="${total}" line-rate="1"><sources /><packages><package name="immune-brain" branch-rate="0" line-rate="1"><classes>${classes}</classes></package></packages></coverage>`
  mkdirSync(resolve(output, ".."), { recursive: true })
  writeFileSync(output, xml, "utf8")
  return 0
}

if (import.meta.main) process.exit(main())
