import { describe, expect, it } from "bun:test"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"

const PLUGIN_ROOT = resolve(import.meta.dir, "..")
const REGISTRY_PATH = resolve(PLUGIN_ROOT, "skills/registry.yaml")

interface RegistryEntry {
  name: string
  path: string
}

/**
 * Minimal parser for the fixed-shape skills/registry.yaml. Each skill block is a
 * `- name:` line followed by a `path:` line. Avoids a YAML dependency while still
 * enforcing the fields this contract cares about.
 */
function parseRegistry(text: string): RegistryEntry[] {
  const entries: RegistryEntry[] = []
  let current: Partial<RegistryEntry> | null = null
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\s+$/, "")
    const nameMatch = /^\s*-\s+name:\s*(.+?)\s*$/.exec(line)
    if (nameMatch) {
      if (current?.name && current?.path) entries.push(current as RegistryEntry)
      current = { name: nameMatch[1] }
      continue
    }
    const pathMatch = /^\s+path:\s*(.+?)\s*$/.exec(line)
    if (pathMatch && current) current.path = pathMatch[1]
  }
  if (current?.name && current?.path) entries.push(current as RegistryEntry)
  return entries
}

function frontmatterField(filePath: string, field: string): string | null {
  const text = readFileSync(filePath, "utf-8")
  const match = new RegExp(`^${field}:\\s*(.+?)\\s*$`, "m").exec(
    text.split(/^---\s*$/m)[1] ?? "",
  )
  return match ? match[1] : null
}

function distReference(skillPath: string): string | null {
  const match = /dist\/([A-Za-z0-9_-]+\.md)/.exec(readFileSync(skillPath, "utf-8"))
  return match ? match[1] : null
}

const registry = parseRegistry(readFileSync(REGISTRY_PATH, "utf-8"))

describe("skill registry consistency", () => {
  it("publishes the three Managed Skills and two standalone host-native Skills", () => {
    expect(registry.map((entry) => entry.name)).toEqual([
      "imm-brainstorm",
      "imm-planner",
      "imm-loop",
      "imm-pr-fix",
      "imm-doc-prune",
    ])
  })

  it("every registry entry has a matching SKILL.md whose name field agrees", () => {
    const offenders: string[] = []
    for (const entry of registry) {
      const expectedPath = `skills/${entry.name}/SKILL.md`
      if (entry.path !== expectedPath) {
        offenders.push(`${entry.name}: registry path ${entry.path} !== ${expectedPath}`)
        continue
      }
      const skillPath = resolve(PLUGIN_ROOT, entry.path)
      if (!existsSync(skillPath)) {
        offenders.push(`${entry.name}: missing SKILL.md at ${entry.path}`)
        continue
      }
      const name = frontmatterField(skillPath, "name")
      if (name !== entry.name) {
        offenders.push(`${entry.name}: SKILL.md frontmatter name is ${name}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("every SKILL.md links to an existing dist file whose name field agrees", () => {
    const offenders: string[] = []
    for (const entry of registry) {
      const skillPath = resolve(PLUGIN_ROOT, entry.path)
      if (!existsSync(skillPath)) continue
      const distFile = distReference(skillPath)
      if (!distFile) {
        offenders.push(`${entry.name}: SKILL.md does not reference a dist/*.md file`)
        continue
      }
      if (distFile !== `${entry.name}.md`) {
        offenders.push(`${entry.name}: dist reference ${distFile} !== ${entry.name}.md`)
      }
      const distPath = resolve(PLUGIN_ROOT, "dist", distFile)
      if (!existsSync(distPath)) {
        offenders.push(`${entry.name}: missing dist file ${distFile}`)
        continue
      }
      const distName = frontmatterField(distPath, "name")
      if (distName !== entry.name) {
        offenders.push(`${entry.name}: dist frontmatter name is ${distName}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("every skills/*/SKILL.md directory is registered (no orphans)", () => {
    const skillsDir = resolve(PLUGIN_ROOT, "skills")
    const onDisk = readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((name) => existsSync(resolve(skillsDir, name, "SKILL.md")))
      .sort()
    const registered = registry.map((e) => e.name).sort()
    expect(onDisk).toEqual(registered)
  })

  it("no SKILL.md description contains stray CJK characters", () => {
    const offenders: string[] = []
    for (const entry of registry) {
      const skillPath = resolve(PLUGIN_ROOT, entry.path)
      if (!existsSync(skillPath)) continue
      const description = frontmatterField(skillPath, "description") ?? ""
      if (/[\u4e00-\u9fff]/.test(description)) offenders.push(entry.name)
    }
    expect(offenders).toEqual([])
  })
})
