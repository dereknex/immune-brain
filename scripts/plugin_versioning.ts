#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const PACKAGE_MANIFEST = "package.json"
const PLUGIN_MANIFEST = "plugins/immune-brain/.claude-plugin/plugin.json"
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const TAG_RE = /^immune-brain-v(?<version>(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*))$/

class VersionError extends Error {}

class SemVer {
  constructor(public major: number, public minor: number, public patch: number) {}
  static parse(value: string): SemVer {
    const match = SEMVER_RE.exec(value)
    if (!match) throw new VersionError(`Invalid SemVer: ${value}`)
    return new SemVer(Number(match[1]), Number(match[2]), Number(match[3]))
  }
  bump(kind: string): SemVer {
    if (kind === "major") return new SemVer(this.major + 1, 0, 0)
    if (kind === "minor") return new SemVer(this.major, this.minor + 1, 0)
    if (kind === "patch") return new SemVer(this.major, this.minor, this.patch + 1)
    throw new VersionError(`Unknown bump kind: ${kind}`)
  }
  compare(other: SemVer): number {
    return this.major - other.major || this.minor - other.minor || this.patch - other.patch
  }
  toString(): string { return `${this.major}.${this.minor}.${this.patch}` }
}

function usage(): never {
  console.error("usage: plugin_versioning.ts [--repo-root <path>] {bump <major|minor|patch|X.Y.Z> [--dry-run] [--force] | stamp | validate [--tag <immune-brain-vX.Y.Z>]}")
  process.exit(2)
}

function parseGlobalArgs(argv: string[]): { root: string; rest: string[] } {
  let root = "."
  const rest: string[] = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--repo-root") {
      if (i + 1 >= argv.length) usage()
      root = argv[++i]
    } else rest.push(argv[i])
  }
  return { root: resolve(root), rest }
}

function readManifest(path: string): any {
  try { return JSON.parse(readFileSync(path, "utf8")) }
  catch (error: any) { throw new VersionError(`Malformed JSON in ${path}: ${error.message}`) }
}
function writeManifest(path: string, manifest: any): void {
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n", "utf8")
}
function manifestPath(root: string, rel: string): string { return resolve(root, rel) }

function packageVersion(root: string): string {
  const manifest = readManifest(manifestPath(root, PACKAGE_MANIFEST))
  if (typeof manifest.version !== "string") throw new VersionError(`Missing string version in ${PACKAGE_MANIFEST}`)
  SemVer.parse(manifest.version)
  return manifest.version
}

function requirePluginPath(root: string): string {
  const path = manifestPath(root, PLUGIN_MANIFEST)
  if (!existsSync(path)) throw new VersionError(`Missing ${PLUGIN_MANIFEST}`)
  return path
}

export function stampPluginManifest(root = "."): { version: string; files: string[] } {
  const version = packageVersion(root)
  const path = requirePluginPath(root)
  const plugin = readManifest(path)
  plugin.version = version
  writeManifest(path, plugin)
  return { version, files: [PLUGIN_MANIFEST] }
}

export function loadManifestVersions(root = "."): Record<string, string> {
  const version = packageVersion(root)
  const path = requirePluginPath(root)
  const plugin = readManifest(path)
  if (typeof plugin.version !== "string") throw new VersionError(`Missing string version in ${PLUGIN_MANIFEST}`)
  SemVer.parse(plugin.version)
  if (plugin.version !== version) throw new VersionError(`${PLUGIN_MANIFEST} version ${plugin.version} does not match ${PACKAGE_MANIFEST} ${version}`)
  return { [PACKAGE_MANIFEST]: version, [PLUGIN_MANIFEST]: plugin.version }
}

export function currentVersion(root = "."): SemVer {
  const versions = loadManifestVersions(root)
  return SemVer.parse(versions[PACKAGE_MANIFEST])
}

export function versionFromTag(tag: string): SemVer {
  const match = TAG_RE.exec(tag)
  if (!match?.groups?.version) throw new VersionError(`Invalid release tag: ${tag}; expected immune-brain-vX.Y.Z`)
  return SemVer.parse(match.groups.version)
}

export function validateManifests(root = ".", tag?: string): any {
  const versions = loadManifestVersions(root)
  const version = SemVer.parse(versions[PACKAGE_MANIFEST])
  const result: any = { package: "@immune-brain/agent-skills", version: version.toString(), files: Object.keys(versions), valid: true }
  if (tag) {
    const tagVersion = versionFromTag(tag)
    if (tagVersion.compare(version) !== 0) throw new VersionError(`Tag ${tag} does not match manifest version ${version}`)
    result.tag = tag
  }
  return result
}

export function buildBumpPlan(root: string, target: string, force = false): any {
  const current = currentVersion(root)
  const resolved = ["major", "minor", "patch"].includes(target) ? current.bump(target) : SemVer.parse(target)
  if (resolved.compare(current) < 0 && !force) throw new VersionError(`Target version ${resolved} is lower than current version ${current}; use --force to allow downgrade`)
  requirePluginPath(root)
  return { package: "@immune-brain/agent-skills", current_version: current.toString(), target_version: resolved.toString(), files: [PACKAGE_MANIFEST, PLUGIN_MANIFEST] }
}

export function applyBump(root: string, target: string, dryRun = false, force = false): any {
  const plan = buildBumpPlan(root, target, force)
  if (dryRun) return { ...plan, dry_run: true, changed: false }
  const path = manifestPath(root, PACKAGE_MANIFEST)
  const manifest = readManifest(path)
  manifest.version = plan.target_version
  writeManifest(path, manifest)
  const pluginPath = requirePluginPath(root)
  const plugin = readManifest(pluginPath)
  plugin.version = plan.target_version
  writeManifest(pluginPath, plugin)
  return { ...plan, dry_run: false, changed: plan.current_version !== plan.target_version }
}

function printBump(result: any): void {
  console.log(`package: ${result.package}`)
  console.log(`mode: ${result.dry_run ? "dry-run" : "applied"}`)
  console.log(`current_version: ${result.current_version}`)
  console.log(`target_version: ${result.target_version}`)
  console.log("files:")
  for (const path of result.files) console.log(`  - ${path}`)
}
function printValidate(result: any): void {
  console.log(`package: ${result.package}`)
  console.log(`version: ${result.version}`)
  if (result.tag) console.log(`tag: ${result.tag}`)
  console.log("version_status: aligned")
  console.log("files:")
  for (const path of result.files) console.log(`  - ${path}`)
}

export function main(argv = process.argv.slice(2)): number {
  const { root, rest } = parseGlobalArgs(argv)
  const command = rest.shift()
  try {
    if (command === "bump") {
      const target = rest.find((a) => !a.startsWith("--"))
      if (!target) usage()
      printBump(applyBump(root, target, rest.includes("--dry-run"), rest.includes("--force")))
      return 0
    }
    if (command === "stamp") {
      const stamped = stampPluginManifest(root)
      console.log(`package: @immune-brain/agent-skills`)
      console.log(`version: ${stamped.version}`)
      console.log("files:")
      for (const path of stamped.files) console.log(`  - ${path}`)
      return 0
    }
    if (command === "validate") {
      const tagIdx = rest.indexOf("--tag")
      const tag = tagIdx >= 0 ? rest[tagIdx + 1] : undefined
      printValidate(validateManifests(root, tag))
      return 0
    }
    usage()
  } catch (error: any) {
    if (error instanceof VersionError) {
      console.error(`error: ${error.message}`)
      return 2
    }
    throw error
  }
}

if (import.meta.main) process.exit(main())
