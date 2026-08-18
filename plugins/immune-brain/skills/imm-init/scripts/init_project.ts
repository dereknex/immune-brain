#!/usr/bin/env bun
import { resolve } from "node:path"
import { ensureManagedBootstrap } from "../../../runtime/managed_path_router"

export const ROOT = resolve(import.meta.dir, "..")
export const TEMPLATES = resolve(ROOT, "templates")

export const DIRS = [".imm/memory", "docs/specs", "docs/brainstorms", "docs/plans"]
export const FILES: Record<string, string> = {
  "IMMUNE.md": "IMMUNE.template.md",
  "CONTEXT.md": "CONTEXT.template.md",
  "AGENTS.md": "AGENTS.md",
  ".imm/memory/MEMORY.md": "MEMORY.md",
}

export interface InitReport {
  root: string
  created_directories: string[]
  created_files: string[]
  updated_files: string[]
  skipped_files: string[]
  ready_for: string[]
  bootstrap: "initialized" | "complete"
}

export function buildReport(rootPath: string): InitReport {
  const root = resolve(rootPath)
  const bootstrap = ensureManagedBootstrap(root)
  const initialized = bootstrap === "initialized"
  return {
    root,
    created_directories: initialized ? [...DIRS] : [],
    created_files: initialized ? Object.keys(FILES) : [],
    updated_files: [],
    skipped_files: initialized ? [] : Object.keys(FILES),
    ready_for: ["imm-brainstorm", "imm-planner", "imm-loop"],
    bootstrap,
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
  try {
    const report = buildReport(root)
    if (json) {
      console.log(JSON.stringify(report, null, 2))
      return 0
    }
    console.log(`Target root: ${report.root}`)
    console.log(`Bootstrap: ${report.bootstrap}`)
    for (const key of ["created_directories", "created_files", "updated_files", "skipped_files"] as const) {
      console.log(`${key}:`)
      for (const path of report[key]) console.log(`  - ${path}`)
    }
    console.log("Ready for: imm-brainstorm, imm-planner, imm-loop")
    return 0
  } catch (error) {
    console.error(`bootstrap_rejected: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}

if (import.meta.main) process.exit(main())
