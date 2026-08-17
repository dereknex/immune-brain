#!/usr/bin/env bun
// ponytail: a focused link fixer — rewrites only links whose verified-correct
// target exists. Retired Python/.imm refs with no successor are reported, not
// guessed. Pairs with scripts/detect-stale-refs.ts (which stays read-only).
//
// Usage:
//   bun scripts/fix-broken-links.ts --preview docs/ plugins/immune-brain/
//   bun scripts/fix-broken-links.ts --write  docs/ plugins/immune-brain/
//   bun scripts/fix-broken-links.ts --historicalize docs/ plugins/immune-brain/ README.md
//
// `--historicalize` converts each dead `[text](url)` link to inline code
// `` `text` `` (path text preserved) and inserts a Historical note banner at
// the file top (after frontmatter). Pairs with detect-stale-refs.ts (read-only).
// Rewrites performed (only when the replacement target exists on disk):
//   1. .imm/specs/<name>.md  -> docs/specs/<name>.md          (migrated specs)
//   2. /Users/.../agent-skills/<rel>  -> <rel>                 (abs-path → repo-relative)
//   3. file:///.../agent-skills/<rel> -> <rel>                  (file:// URI → repo-relative)
//   4. ./<rel> or ../<rel> whose resolved target exists        (normalize, no path change to text)
//
// Reported, NOT rewritten: .imm/*.py, .imm/imm_core/*.py, tests/test_*.py,
// nonexistent skills/, cross-worktree paths, and any target that doesn't exist.
import { existsSync, readFileSync, readdirSync, writeFileSync, statSync } from "node:fs"
import { join, relative, resolve, dirname, basename, normalize } from "node:path"

const REPO_ROOT = process.cwd()
const WS_PATTERNS = [
  /\/Users\/derek\/[Ww]orkspaces\/agent-skills\//, // current workspace
  /\/Users\/derek\/agent-skills\//,                  // older flat layout
]

const MD_LINK_RE = /(\[([^\]]*)\]\(([^)]+)\))/g
const DEAD_REASON_RE = /missing|gone|retired|outside|unhandled/
const BANNER_HISTORICAL = "> Historical note: pre-TypeScript-migration artifact; file paths reference the retired Python runtime/tests."
const BANNER_NOTE = "> Note: retired Python file paths appear as inline code and refer to the pre-TypeScript-migration runtime."

function walk(dir: string, out: string[] = []): string[] {
  let entries: ReturnType<typeof readdirSync>
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git") continue
    const full = join(dir, e.name)
    if (e.isSymbolicLink()) continue
    if (e.isDirectory()) walk(full, out)
    else if (e.isFile() && e.name.endsWith(".md")) out.push(full)
  }
  return out
}

type Action =
  | { kind: "rewrite"; old: string; replacement: string; reason: string }
  | { kind: "skip"; reason: string }

/** Decide the corrected link target for a single link URL. */
function planLink(rawLink: string, srcFile: string): Action {
  let link = rawLink.trim()
  if (/^(https?:|mailto:|#|data:|javascript:)/i.test(link)) return { kind: "skip", reason: "external/anchor" }

  // strip file:// scheme
  let isFileUri = false
  if (/^file:/i.test(link)) {
    isFileUri = true
    link = link.replace(/^file:\/\/localhost/i, "").replace(/^file:\/\//i, "")
  }

  // separate fragment
  const hashIdx = link.indexOf("#")
  let fragment = ""
  if (hashIdx >= 0) {
    fragment = link.slice(hashIdx)
    link = link.slice(0, hashIdx)
  }
  // separate title " \"title\""
  const titleMatch = link.match(/\s+"[^"]*"\s*$/)
  let title = ""
  if (titleMatch) {
    title = titleMatch[0]
    link = link.slice(0, titleMatch.index)
  }
  if (!link) return { kind: "skip", reason: "anchor-only" }

  // 1. .imm/specs/X -> docs/specs/X
  if (link.startsWith(".imm/specs/")) {
    const name = basename(link)
    const migrated = `docs/specs/${name}`
    if (existsSync(join(REPO_ROOT, migrated))) {
      return { kind: "rewrite", old: rawLink, replacement: rebuild(migrated, fragment, title), reason: "migrated spec" }
    }
    return { kind: "skip", reason: "legacy spec gone (no migrated target)" }
  }

  // 2. abs-path or file:// URI under a known workspace prefix -> repo-relative
  if (link.startsWith("/")) {
    let rel: string | null = null
    for (const re of WS_PATTERNS) {
      const m = link.match(re)
      if (m) { rel = link.slice(m[0].length); break }
    }
    if (!rel) {
      // /agent-skills/<rest> shape (prefix already stripped)
      const m = link.match(/\/agent-skills\/(.*)$/)
      if (m) rel = m[1]
    }
    if (rel) {
      rel = rel.replace(/^\/+/, "")
      // abs-path may also reduce to a migrated .imm/specs/ — apply same migration
      if (rel.startsWith(".imm/specs/")) {
        const name = basename(rel)
        const migrated = `docs/specs/${name}`
        if (existsSync(join(REPO_ROOT, migrated))) {
          return { kind: "rewrite", old: rawLink, replacement: rebuild(migrated, fragment, title), reason: "abs-path migrated spec → repo-relative" }
        }
      }
      if (existsSync(join(REPO_ROOT, rel))) {
        return { kind: "rewrite", old: rawLink, replacement: rebuild(rel, fragment, title), reason: "abs-path → repo-relative" }
      }
      return { kind: "skip", reason: "abs-path target missing" }
    }
    return { kind: "skip", reason: "abs-path outside workspace" }
  }

  // 3. relative link — verify it resolves from the file dir OR the repo root
  //    (docs frequently use repo-relative links); if so leave as-is.
  if (!link.startsWith("/")) {
    const fromFile = resolve(dirname(srcFile), link)
    const fromRoot = join(REPO_ROOT, link)
    if (existsSync(fromFile) || existsSync(fromRoot)) {
      const norm = normalize(link)
      if (norm !== link) {
        return { kind: "rewrite", old: rawLink, replacement: rebuild(norm, fragment, title), reason: "normalize relative" }
      }
      return { kind: "skip", reason: "relative target exists" }
    }
    // relative but missing — classify the dead kind for reporting
    const lower = link.toLowerCase()
    if (lower.startsWith(".imm/") && lower.endsWith(".py")) return { kind: "skip", reason: "retired .imm python" }
    if (lower.startsWith(".imm/imm_core/") && lower.endsWith(".py")) return { kind: "skip", reason: "retired .imm/imm_core python" }
    if (lower.startsWith("tests/") && lower.endsWith(".py")) return { kind: "skip", reason: "retired python test" }
    if (lower.startsWith(".imm/")) return { kind: "skip", reason: "retired .imm path" }
    return { kind: "skip", reason: "relative target missing" }
  }

  return { kind: "skip", reason: "unhandled" }
}

function rebuild(path: string, fragment: string, title: string): string {
  return path + fragment + title
}

function bannerFor(file: string): string {
  const rel = relative(REPO_ROOT, file).replace(/\\/g, "/")
  if (rel.startsWith("docs/plans/") || rel.startsWith("docs/specs/")) return BANNER_HISTORICAL
  return BANNER_NOTE
}

function insertBanner(content: string, banner: string): string {
  if (content.includes(banner)) return content
  const lines = content.split(/\r?\n/)
  let insertAt = 0
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1)
    if (end >= 0) insertAt = end + 1
  }
  // skip a leading blank line after frontmatter, then place banner + blank line
  while (insertAt < lines.length && lines[insertAt].trim() === "") insertAt++
  lines.splice(insertAt, 0, banner, "")
  return lines.join("\n")
}

function main(argv: string[]): number {
  const write = argv.includes("--write")
  const preview = argv.includes("--preview")
  const historicalize = argv.includes("--historicalize")
  const targets = argv.filter((a) => !a.startsWith("--"))
  if (targets.length === 0 || (!write && !preview && !historicalize)) {
    console.error("Usage: fix-broken-links.ts --preview|--write|--historicalize <dirs-or-files...>")
    return 1
  }
  const modes = [write, preview, historicalize].filter(Boolean).length
  if (modes !== 1) {
    console.error("Pick one mode: --preview, --write, or --historicalize")
    return 1
  }

  const files = targets.flatMap((t) => {
    const abs = resolve(REPO_ROOT, t)
    if (!existsSync(abs)) { console.error(`missing: ${t}`); process.exit(1) }
    try { statSync(abs); if (abs.endsWith(".md")) return [abs] } catch {}
    return walk(abs)
  })

  let rewritten = 0, skipped = 0, historicalized = 0, bannersAdded = 0
  const skipReasons: Record<string, number> = {}
  const dead: { file: string; line: number; link: string; reason: string }[] = []
  const changedFiles = new Set<string>()

  for (const file of files) {
    const original = readFileSync(file, "utf8")
    const re = new RegExp(MD_LINK_RE)
    let m: RegExpExecArray | null
    let result = ""
    let last = 0
    let fileHadDead = false
    while ((m = re.exec(original)) !== null) {
      result += original.slice(last, m.index)
      const full = m[1]      // [text](url)
      const text = m[2]      // link text
      const url = m[3]       // url part
      const action = planLink(url, file)
      if (action.kind === "rewrite") {
        rewritten++
        changedFiles.add(file)
        const newText = full.replace(/\]\(([^)]*)\)$/, `](${action.replacement})`)
        result += newText
      } else if (historicalize && DEAD_REASON_RE.test(action.reason) && (/[\/\\]/.test(url) || /\.\w{1,8}$/.test(url))) {
        historicalized++
        changedFiles.add(file)
        fileHadDead = true
        const code = text.trim() ? text : url
        result += "`" + code.replace(/`/g, "") + "`"
      } else {
        skipped++
        skipReasons[action.reason] = (skipReasons[action.reason] || 0) + 1
        if (DEAD_REASON_RE.test(action.reason) && (/[\/\\]/.test(url) || /\.\w{1,8}$/.test(url))) {
          const lineNo = original.slice(0, m.index).split("\n").length
          dead.push({ file: relative(REPO_ROOT, file), line: lineNo, link: url, reason: action.reason })
        }
        result += full
      }
      last = m.index + full.length
    }
    result += original.slice(last)

    if (historicalize && fileHadDead) {
      const banner = bannerFor(file)
      const before = result
      result = insertBanner(result, banner)
      if (result !== before) bannersAdded++
    }

    if ((write || historicalize) && result !== original) {
      writeFileSync(file, result)
    }
  }

  console.log(`Files scanned: ${files.length}`)
  console.log(`Links rewritten: ${rewritten}`)
  if (historicalize) {
    console.log(`Links historicalized (dead → inline code): ${historicalized}`)
    console.log(`Banners added: ${bannersAdded}`)
  }
  console.log(`Links skipped: ${skipped}`)
  console.log(`Skip reasons:`, skipReasons)
  console.log(`Dead links reported (NOT rewritten): ${dead.length}`)
  if (dead.length) {
    console.log(`\nDead links reported (NOT rewritten): ${dead.length}`)
    const byReason: Record<string, number> = {}
    for (const d of dead) byReason[d.reason] = (byReason[d.reason] || 0) + 1
    console.log("  by reason:", byReason)
    for (const d of dead.slice(0, 40)) {
      console.log(`  ${d.file}:${d.line}  [${d.reason}]  ${d.link.slice(0, 80)}`)
    }
    if (dead.length > 40) console.log(`  ... and ${dead.length - 40} more`)
  }
  return 0
}

main(process.argv.slice(2))
