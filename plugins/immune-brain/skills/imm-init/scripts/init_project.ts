#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

export const ROOT = resolve(import.meta.dir, "..")
export const TEMPLATES = resolve(ROOT, "templates")
export const START = "<!-- IMMUNE-BRAIN:START -->"
export const END = "<!-- IMMUNE-BRAIN:END -->"

export const DIRS = [".imm/memory", "docs/specs", "docs/brainstorms", "docs/plans"]
export const FILES: Record<string, string> = {
  "IMMUNE.md": "IMMUNE.template.md",
  "CONTEXT.md": "CONTEXT.template.md",
  "AGENTS.md": "AGENTS.md",
  ".imm/memory/MEMORY.md": "MEMORY.md",
}
export const ENTRY_POINTERS = new Set(["AGENTS.md"])

export interface InitReport {
  root: string
  created_directories: string[]
  created_files: string[]
  updated_files: string[]
  skipped_files: string[]
  ready_for: string[]
}

function template(name: string): string {
  return readFileSync(resolve(TEMPLATES, name), "utf8")
}
function immuneSection(text: string): string {
  const start = text.indexOf(START)
  const end = text.indexOf(END)
  if (start === -1 || end === -1 || end < start) throw new Error("template missing IMMUNE-BRAIN bounded section")
  return text.slice(start, end + END.length)
}
export function ensureDirectories(root: string): string[] {
  const created: string[] = []
  for (const rel of DIRS) {
    const dest = resolve(root, rel)
    if (!existsSync(dest)) {
      mkdirSync(dest, { recursive: true })
      created.push(rel)
    }
  }
  return created
}
export function ensureFiles(root: string): [string[], string[], string[]] {
  const created: string[] = []
  const updated: string[] = []
  const skipped: string[] = []
  for (const [rel, templateName] of Object.entries(FILES)) {
    const dest = resolve(root, rel)
    const text = template(templateName)
    if (!existsSync(dest)) {
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, text, "utf8")
      created.push(rel)
    } else if (!ENTRY_POINTERS.has(rel)) {
      skipped.push(rel)
    } else {
      const existing = readFileSync(dest, "utf8")
      if (existing.includes(START) && existing.includes(END)) skipped.push(rel)
      else {
        writeFileSync(dest, `${existing.trimEnd()}\n\n${immuneSection(text)}\n`, "utf8")
        updated.push(rel)
      }
    }
  }
  return [created, updated, skipped]
}
export function buildReport(rootPath: string): InitReport {
  const root = resolve(rootPath)
  const createdDirectories = ensureDirectories(root)
  const [createdFiles, updatedFiles, skippedFiles] = ensureFiles(root)
  return {
    root,
    created_directories: createdDirectories,
    created_files: createdFiles,
    updated_files: updatedFiles,
    skipped_files: skippedFiles,
    ready_for: ["direct", "imm-brainstorm", "imm-planner"],
  }
}
function main(argv = process.argv.slice(2)): number {
  let root = "."
  let json = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") root = argv[++i]
    else if (argv[i] === "--json") json = true
    else {
      console.error(`Unknown argument: ${argv[i]}`)
      return 2
    }
  }
  const report = buildReport(root)
  if (json) {
    console.log(JSON.stringify(report, null, 2))
    return 0
  }
  console.log(`Target root: ${report.root}`)
  for (const key of ["created_directories", "created_files", "updated_files", "skipped_files"] as const) {
    console.log(`${key}:`)
    for (const path of report[key]) console.log(`  - ${path}`)
  }
  console.log("Ready for: direct, imm-brainstorm, imm-planner")
  return 0
}

if (import.meta.main) process.exit(main())
