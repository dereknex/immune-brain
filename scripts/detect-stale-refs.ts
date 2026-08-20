#!/usr/bin/env bun
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const SKILL_REF_RE = /skills\/([a-z][a-z0-9-]*\/SKILL\.md)/g
const DOC_REF_RE = /(docs\/(?:specs|plans)\/[^\s)"'`\]]+\.md)/g
const LEGACY_SPEC_RE = /(\.imm\/specs\/[^\s)"'`\]]+\.md)/g
const RETIRED_RUNTIME_RE = /dist\/\.imm\/imm_core|\.imm\/imm_core|\.imm\/imm-plan\.py|immune_brain_runtime\.py|\.mcp\.json|list-tools/g

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(path))
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(path)
  }
  return out
}
function markdownTargets(path: string): string[] {
  if (!existsSync(path)) return []
  try {
    readdirSync(path)
    return walk(path)
  } catch {
    return path.endsWith(".md") ? [path] : []
  }
}
function loadRegistrySkills(root: string): Set<string> {
  const path = join(root, "skills", "registry.yaml")
  const skills = new Set<string>()
  if (!existsSync(path)) return skills
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith("path:")) skills.add(line.split(":", 2)[1].trim())
  }
  return skills
}
function isPlaceholderRef(ref: string): boolean {
  return ref.includes("<") || ref.includes(">") || ref.includes("*")
}

function docExistsWithArchive(root: string, docPath: string): boolean {
  if (existsSync(join(root, docPath))) return true
  if (docPath.startsWith("docs/specs/")) {
    const base = docPath.slice("docs/specs/".length)
    if (!base.startsWith("archive/")) {
      const archived = join(root, "docs/specs/archive", base)
      if (existsSync(archived)) return true
    }
  }
  if (docPath.startsWith("docs/plans/")) {
    const base = docPath.slice("docs/plans/".length)
    if (!base.startsWith("archive/")) {
      const archived = join(root, "docs/plans/archive", base)
      if (existsSync(archived)) return true
    }
  }
  return false
}

function legacyExistsWithArchive(root: string, legacy: string): boolean {
  if (existsSync(join(root, legacy))) return true
  const migrated = legacy.replace(".imm/specs/", "docs/specs/")
  if (docExistsWithArchive(root, migrated)) return true
  return false
}

function scanFile(path: string, root: string, validSkills: Set<string>): any[] {
  let content = ""
  try { content = readFileSync(path, "utf8") } catch { return [] }
  const rel = relative(root, path)
  const findings: any[] = []
  for (const [idx, line] of content.split(/\r?\n/).entries()) {
    const lineNo = idx + 1
    for (const match of line.matchAll(SKILL_REF_RE)) {
      const skillPath = `skills/${match[1]}`
      if (isPlaceholderRef(skillPath)) continue
      if (!validSkills.has(skillPath) && !existsSync(join(root, skillPath))) findings.push({ file: rel, line: lineNo, type: "stale_skill_ref", ref: skillPath })
    }
    for (const match of line.matchAll(DOC_REF_RE)) {
      const docPath = match[1]
      if (isPlaceholderRef(docPath)) continue
      if (!docExistsWithArchive(root, docPath)) findings.push({ file: rel, line: lineNo, type: "broken_doc_link", ref: docPath })
    }
    for (const match of line.matchAll(LEGACY_SPEC_RE)) {
      const legacy = match[1]
      if (isPlaceholderRef(legacy)) continue
      if (!legacyExistsWithArchive(root, legacy)) findings.push({ file: rel, line: lineNo, type: "broken_legacy_spec", ref: legacy })
    }
  }
  return findings
}

function scanRuntimeTruthFile(path: string, root: string): any[] {
  let content = ""
  try { content = readFileSync(path, "utf8") } catch { return [] }
  const rel = relative(root, path)
  const findings: any[] = []
  for (const [idx, line] of content.split(/\r?\n/).entries()) {
    for (const match of line.matchAll(RETIRED_RUNTIME_RE)) {
      findings.push({ file: rel, line: idx + 1, type: "retired_runtime_current_ref", ref: match[0] })
    }
  }
  return findings
}

function printFindings(findings: any[]): number {
  if (!findings.length) {
    console.log("No stale references found.")
    return 0
  }
  console.log(`Found ${findings.length} stale reference(s):\n`)
  for (const f of findings) console.log(`  ${f.file}:${f.line} [${f.type}] -> ${f.ref}`)
  const counts: Record<string, number> = {}
  for (const f of findings) counts[f.type] = (counts[f.type] || 0) + 1
  console.log(`\nSummary: ${JSON.stringify(counts)}`)
  return 1
}

function main(argv = process.argv.slice(2)): number {
  const runtimeTruth = argv.includes("--runtime-truth")
  const targetArgs = argv.filter((arg) => arg !== "--runtime-truth")
  if (targetArgs.length === 0) {
    console.error(`Usage: detect-stale-refs.ts [--runtime-truth] <docs_directory_or_file> [...]`)
    return 1
  }
  const root = process.cwd()
  const targets = targetArgs.map((arg) => resolve(root, arg))
  const missing = targets.filter((target) => !existsSync(target))
  if (missing.length > 0) {
    console.error(`Error: ${missing[0]} does not exist`)
    return 1
  }
  const paths = targets
    .flatMap(markdownTargets)
    .filter((p) => !relative(root, p).split(/[\\/]/).includes("upstreams"))
  if (runtimeTruth) return printFindings(paths.flatMap((p) => scanRuntimeTruthFile(p, root)))

  const validSkills = loadRegistrySkills(root)
  return printFindings(paths.flatMap((p) => scanFile(p, root, validSkills)))
}

if (import.meta.main) process.exit(main())
