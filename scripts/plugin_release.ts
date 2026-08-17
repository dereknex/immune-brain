#!/usr/bin/env bun
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { applyBump, currentVersion, validateManifests, versionFromTag } from "./plugin_versioning"

class ReleaseError extends Error {}

function canonicalTag(version: string): string {
  versionFromTag(`immune-brain-v${version}`)
  return `immune-brain-v${version}`
}
function run(args: string[], cwd: string) {
  return spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8" })
}
function tagExists(root: string, tag: string): boolean {
  return run(["git", "rev-parse", "--verify", `refs/tags/${tag}`], root).status === 0
}
function detectBranch(root: string): string {
  const res = run(["git", "rev-parse", "--abbrev-ref", "HEAD"], root)
  if (res.status !== 0) throw new ReleaseError(`Cannot detect current branch: ${res.stderr || res.stdout}`.trim())
  const branch = res.stdout.trim()
  if (!branch || branch === "HEAD") throw new ReleaseError("Cannot push from detached HEAD; pass --branch explicitly")
  return branch
}
function alreadyPushed(text: string): boolean {
  const lower = text.toLowerCase()
  return lower.includes("everything up-to-date") || lower.includes("already exists")
}

function prepareReleaseFlow(root: string, opts: any): any {
  const dryRun = !opts.apply
  const phases: any[] = []
  const current = currentVersion(root).toString()
  const bump = opts.target
    ? applyBump(root, opts.target, dryRun)
    : { package: "@immune-brain/agent-skills", current_version: current, target_version: current, files: [], dry_run: dryRun, changed: false }
  phases.push({ ...bump, phase: "bump", status: dryRun ? "planned" : "applied" })

  const validation = validateManifests(root)
  phases.push({ ...validation, phase: "validate", status: dryRun ? "planned" : "passed" })

  const version = opts.target ? bump.target_version : validation.version
  const tag = canonicalTag(version)
  const tagCommand = ["git", "tag", "-a", tag, "-m", `Release immune-brain ${version}`]
  if (dryRun) phases.push({ phase: "tag", version, tag, command: tagCommand, dry_run: true, status: "planned" })
  else if (tagExists(root, tag)) phases.push({ phase: "tag", version, tag, command: tagCommand, dry_run: false, status: "already_exists" })
  else {
    const res = run(tagCommand, root)
    if (res.status !== 0) throw new ReleaseError(`Tag creation failed: ${res.stderr || res.stdout}`.trim())
    phases.push({ phase: "tag", version, tag, command: tagCommand, dry_run: false, status: "created" })
  }

  const branch = opts.branch || detectBranch(root)
  const pushCommands = [["git", "push", opts.remote, branch], ["git", "push", opts.remote, tag]]
  if (dryRun) phases.push({ phase: "push", version, tag, remote: opts.remote, branch, commands: pushCommands, dry_run: true, status: "planned" })
  else {
    if (!tagExists(root, tag)) throw new ReleaseError(`Cannot push missing tag ${tag}`)
    const branchRes = run(pushCommands[0], root)
    const tagRes = run(pushCommands[1], root)
    if (branchRes.status !== 0 && !alreadyPushed(`${branchRes.stdout}\n${branchRes.stderr}`)) throw new ReleaseError(`Branch push failed: ${branchRes.stderr || branchRes.stdout}`.trim())
    if (tagRes.status !== 0 && !alreadyPushed(`${tagRes.stdout}\n${tagRes.stderr}`)) throw new ReleaseError(`Tag push failed: ${tagRes.stderr || tagRes.stdout}`.trim())
    phases.push({ phase: "push", version, tag, remote: opts.remote, branch, commands: pushCommands, dry_run: false, status: alreadyPushed(`${branchRes.stdout}\n${branchRes.stderr}`) && alreadyPushed(`${tagRes.stdout}\n${tagRes.stderr}`) ? "already_pushed" : "pushed" })
  }

  const artifactPath = opts.artifactPath || root
  const manifestPath = "package.json"
  if (!opts.adapterCommand.length) {
    phases.push({ phase: "publish", version, tag, adapter: "none", artifact_path: artifactPath, manifest_path: manifestPath, dry_run: dryRun, status: "blocked", reason: "package_adapter_not_configured" })
  } else {
    const payload: Record<string, string> = { version, tag, manifest_path: manifestPath, artifact_path: artifactPath }
    const command = opts.adapterCommand.map((part: string) => payload[part] ?? part)
    if (dryRun) phases.push({ phase: "publish", version, tag, adapter: "command", artifact_path: artifactPath, manifest_path: manifestPath, dry_run: true, status: "planned", command })
    else {
      const res = run(command, root)
      const out = `${res.stdout}\n${res.stderr}`.toLowerCase()
      if (out.includes("already published")) phases.push({ phase: "publish", version, tag, adapter: "command", artifact_path: artifactPath, manifest_path: manifestPath, dry_run: false, status: "already_published", command })
      else if (res.status !== 0) throw new ReleaseError(`Package publish failed: ${res.stderr || res.stdout}`.trim())
      else phases.push({ phase: "publish", version, tag, adapter: "command", artifact_path: artifactPath, manifest_path: manifestPath, dry_run: false, status: "published", command })
    }
  }
  return { package: "@immune-brain/agent-skills", dry_run: dryRun, phases }
}

function parse(argv: string[]): any {
  const opts: any = { repoRoot: ".", remote: "origin", branch: undefined, target: undefined, artifactPath: undefined, adapterCommand: [], apply: false, json: false }
  const args = [...argv]
  const command = args.shift()
  if (command !== "release") throw new ReleaseError("usage: plugin_release.ts release [--target patch|minor|major|X.Y.Z] [--branch main] [--remote origin] [--apply] [--json] [--adapter-command ...]")
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "--repo-root") opts.repoRoot = args[++i]
    else if (a === "--target") opts.target = args[++i]
    else if (a === "--branch") opts.branch = args[++i]
    else if (a === "--remote") opts.remote = args[++i]
    else if (a === "--artifact-path") opts.artifactPath = resolve(args[++i])
    else if (a === "--apply") opts.apply = true
    else if (a === "--json") opts.json = true
    else if (a === "--adapter-command") opts.adapterCommand = args.slice(i + 1), i = args.length
    else throw new ReleaseError(`Unknown argument: ${a}`)
  }
  opts.repoRoot = resolve(opts.repoRoot)
  return opts
}

function printFlow(flow: any): void {
  console.log(`package: ${flow.package}`)
  console.log(`mode: ${flow.dry_run ? "dry-run" : "apply"}`)
  for (const phase of flow.phases) {
    console.log(`${phase.phase}: ${phase.status}`)
    if (phase.version) console.log(`  version: ${phase.version}`)
    if (phase.tag) console.log(`  tag: ${phase.tag}`)
    if (phase.reason) console.log(`  reason: ${phase.reason}`)
  }
}

function main(argv = process.argv.slice(2)): number {
  try {
    const opts = parse(argv)
    const flow = prepareReleaseFlow(opts.repoRoot, opts)
    if (opts.json) console.log(JSON.stringify(flow, null, 2))
    else printFlow(flow)
    return 0
  } catch (error: any) {
    console.error(`error: ${error.message}`)
    return 2
  }
}

if (import.meta.main) process.exit(main())
