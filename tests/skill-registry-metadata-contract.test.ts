import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const SKILLS_REGISTRY = resolve(REPO_ROOT, "plugins/immune-brain/skills/registry.yaml")
const DIST_REGISTRY = resolve(REPO_ROOT, "plugins/immune-brain/dist/registry.yaml")

// Allowed `role` (coarse function axis) and `role_class` (authority/behavior axis)
// vocabularies. Adding a new value is a deliberate act that must update this guard,
// preventing silent metadata drift in the unvalidated registry fields.
const ROLE_ENUM = new Set([
  "plan",
  "coordinate",
  "execute",
  "qa",
  "reviewer",
  "brainstorm",
  "explorer",
  "compound",
  "bootstrap",
  "design",
])

const ROLE_CLASS_ENUM = new Set([
  "authority",
  "coordinator",
  "advisory",
  "advisory_host",
  "review_host",
  "framing",
  "discovery",
  "bootstrap",
  "repair",
  "active-step-bounded-executor",
])

// Runtime/CLI primitives that are valid `next_actions` targets but are not
// installable skills (e.g. the demoted imm-autowork checkpoint command).
const RUNTIME_PRIMITIVES = new Set(["imm-autowork"])

interface SkillEntry {
  name: string
  role: string
  title: string
  role_class: string
  next_actions: string[]
  boundary: string
}

function parseRegistry(text: string): SkillEntry[] {
  const entries: SkillEntry[] = []
  let current: Partial<SkillEntry> | null = null
  const flush = () => {
    if (current?.name) entries.push(current as SkillEntry)
  }
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\s+$/, "")
    const nameMatch = /^\s*-\s+name:\s*(.+?)\s*$/.exec(line)
    if (nameMatch) {
      flush()
      current = { name: nameMatch[1], next_actions: [] }
      continue
    }
    if (!current) continue
    const roleMatch = /^\s+role:\s*(.+?)\s*$/.exec(line)
    if (roleMatch) current.role = roleMatch[1]
    const titleMatch = /^\s+title:\s*(.+?)\s*$/.exec(line)
    if (titleMatch) current.title = titleMatch[1]
    const roleClassMatch = /^\s+role_class:\s*(.+?)\s*$/.exec(line)
    if (roleClassMatch) current.role_class = roleClassMatch[1]
    const boundaryMatch = /^\s+boundary:\s*(.+?)\s*$/.exec(line)
    if (boundaryMatch) current.boundary = boundaryMatch[1]
    const nextMatch = /^\s+next_actions:\s*\[(.*)\]\s*$/.exec(line)
    if (nextMatch) {
      current.next_actions = nextMatch[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    }
  }
  flush()
  return entries
}

const skillsEntries = parseRegistry(readFileSync(SKILLS_REGISTRY, "utf-8"))
const distEntries = parseRegistry(readFileSync(DIST_REGISTRY, "utf-8"))
const registeredNames = new Set(skillsEntries.map((e) => e.name))

describe("skill registry metadata contract", () => {
  it("parses a non-empty registry", () => {
    expect(skillsEntries.length).toBeGreaterThan(0)
  })

  it("every skill uses an allowed role value", () => {
    const offenders = skillsEntries
      .filter((e) => !ROLE_ENUM.has(e.role))
      .map((e) => `${e.name}: role=${e.role}`)
    expect(offenders).toEqual([])
  })

  it("every skill uses an allowed role_class value", () => {
    const offenders = skillsEntries
      .filter((e) => !ROLE_CLASS_ENUM.has(e.role_class))
      .map((e) => `${e.name}: role_class=${e.role_class}`)
    expect(offenders).toEqual([])
  })

  it("every next_actions target is a registered skill or a known runtime primitive", () => {
    const offenders: string[] = []
    for (const entry of skillsEntries) {
      for (const target of entry.next_actions) {
        if (!registeredNames.has(target) && !RUNTIME_PRIMITIVES.has(target)) {
          offenders.push(`${entry.name}: dangling next_action -> ${target}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it("every skill declares a non-empty boundary", () => {
    const offenders = skillsEntries
      .filter((e) => !e.boundary || e.boundary.length === 0)
      .map((e) => e.name)
    expect(offenders).toEqual([])
  })

  it("source and dist registries carry identical per-skill metadata", () => {
    const serialize = (e: SkillEntry) =>
      JSON.stringify({
        name: e.name,
        role: e.role,
        title: e.title,
        role_class: e.role_class,
        next_actions: e.next_actions,
        boundary: e.boundary,
      })
    const source = skillsEntries.map(serialize).sort()
    const dist = distEntries.map(serialize).sort()
    expect(dist).toEqual(source)
  })
})
