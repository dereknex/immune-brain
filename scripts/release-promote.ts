#!/usr/bin/env bun
// Promote a published immune-brain version to the default install channels, or roll back.
//
// Spec docs/specs/e2e-release-gate.spec.md D7. A merged version PR publishes npm `next` only
// (release.yml). This script, run by the manual promote workflow, is the only writer of the
// `stable` branch, the `immune-brain-vX-stable` tags and the npm `latest` dist-tag:
//
//   release-promote.ts <X>             fast-forward stable to the commit tagged immune-brain-vX,
//                                      tag immune-brain-vX-stable, run npm dist-tag add ... latest
//   release-promote.ts --rollback      move stable and npm latest back to the newest
//                                      immune-brain-v*-stable tag below the current stable commit
//
// Every refusal happens before the first write and carries a stable code. Every write is
// preceded by a check, so a rerun after a mid-sequence failure performs only the missing steps.
// `--git` and `--npm` replace the executables so tests run against a temp repository with a
// bare remote and a stub npm.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const EVIDENCE_CONTRACT = "immune_brain/e2e_release_evidence/v1";
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const STABLE_TAG_PATTERN = /^immune-brain-v(\d+\.\d+\.\d+)-stable$/;

export type PromoteCode =
  | "invalid_arguments"
  | "invalid_version"
  | "evidence_missing"
  | "evidence_invalid"
  | "evidence_version_mismatch"
  | "evidence_commit_mismatch"
  | "evidence_mode_unsupported"
  | "checklist_unchecked"
  | "release_tag_missing"
  | "stable_not_fast_forward"
  | "stable_tag_conflict"
  | "stable_branch_missing"
  | "no_previous_stable_tag"
  | "npm_version_missing"
  | "git_failed"
  | "npm_failed";

export class PromoteError extends Error {
  constructor(readonly code: PromoteCode, message: string) {
    super(message);
    this.name = "PromoteError";
  }
}

export interface PromoteOptions {
  repo: string;
  remote: string;
  branch: string;
  packageName: string;
  git: string;
  npm: string;
  evidencePath?: string;
}

export interface PromoteResult {
  mode: "promote" | "rollback";
  version: string;
  commit: string;
  /** Writes performed, in order. Empty when the target state already held. */
  actions: string[];
}

interface Runner {
  git(args: string[], allowFailure?: boolean): { status: number; stdout: string };
  npm(args: string[], allowFailure?: boolean): { status: number; stdout: string };
}

function makeRunner(options: PromoteOptions): Runner {
  const run = (exe: string, code: PromoteCode, args: string[], allowFailure = false) => {
    const result = spawnSync(exe, args, {
      cwd: options.repo,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    if (result.error) throw new PromoteError(code, `${exe} could not run: ${result.error.message}`);
    const status = result.status ?? 1;
    if (status !== 0 && !allowFailure) {
      throw new PromoteError(code, `${exe} ${args.join(" ")} exited ${status}: ${(result.stderr || result.stdout).trim()}`);
    }
    return { status, stdout: result.stdout.trim() };
  };
  return {
    git: (args, allowFailure) => run(options.git, "git_failed", args, allowFailure),
    npm: (args, allowFailure) => run(options.npm, "npm_failed", args, allowFailure),
  };
}

function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}

interface Evidence {
  version: string;
  commit: string;
  mode: string;
  checklist: { item: string; checked: boolean }[];
}

function readEvidence(path: string): Evidence {
  if (!existsSync(path)) throw new PromoteError("evidence_missing", `no evidence file at ${path}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new PromoteError("evidence_invalid", `evidence is not valid JSON: ${(error as Error).message}`);
  }
  const record = parsed as Record<string, unknown> | null;
  if (!record || typeof record !== "object" || record.contract !== EVIDENCE_CONTRACT) {
    throw new PromoteError("evidence_invalid", `evidence contract must be ${EVIDENCE_CONTRACT}`);
  }
  if (typeof record.version !== "string" || typeof record.commit !== "string" || typeof record.mode !== "string") {
    throw new PromoteError("evidence_invalid", "evidence needs string version, commit and mode");
  }
  const checklist = record.checklist ?? [];
  if (!Array.isArray(checklist) || checklist.some((entry) => !entry || typeof entry.item !== "string" || typeof entry.checked !== "boolean")) {
    throw new PromoteError("evidence_invalid", "evidence checklist entries need a string item and a boolean checked");
  }
  return { version: record.version, commit: record.commit, mode: record.mode, checklist };
}

function remoteRef(runner: Runner, remote: string, ref: string): string | null {
  const out = runner.git(["ls-remote", remote, ref]).stdout;
  const line = out.split("\n").find((entry) => entry.endsWith(`\t${ref}`));
  return line ? line.split("\t")[0] : null;
}

function localCommit(runner: Runner, ref: string): string | null {
  const result = runner.git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], true);
  return result.status === 0 ? result.stdout : null;
}

function isAncestor(runner: Runner, ancestor: string, descendant: string): boolean {
  return runner.git(["merge-base", "--is-ancestor", ancestor, descendant], true).status === 0;
}

function fetchChannelState(runner: Runner, options: PromoteOptions): string | null {
  runner.git(["fetch", "--quiet", options.remote, "--tags"]);
  const stable = remoteRef(runner, options.remote, `refs/heads/${options.branch}`);
  if (stable) {
    runner.git(["fetch", "--quiet", options.remote, `+refs/heads/${options.branch}:refs/remotes/${options.remote}/${options.branch}`]);
  }
  return stable;
}

function npmLatest(runner: Runner, options: PromoteOptions): string | null {
  const out = runner.npm(["dist-tag", "ls", options.packageName]).stdout;
  const line = out.split("\n").find((entry) => entry.startsWith("latest:"));
  return line ? line.slice("latest:".length).trim() : null;
}

function requireNpmVersion(runner: Runner, options: PromoteOptions, version: string): void {
  const result = runner.npm(["view", `${options.packageName}@${version}`, "version"], true);
  if (result.status !== 0 || result.stdout !== version) {
    throw new PromoteError("npm_version_missing", `${options.packageName}@${version} is not published on npm`);
  }
}

export function promote(version: string, options: PromoteOptions): PromoteResult {
  if (!VERSION_PATTERN.test(version)) {
    throw new PromoteError("invalid_version", `version must match ${VERSION_PATTERN}: ${JSON.stringify(version)}`);
  }
  const runner = makeRunner(options);
  const evidencePath = options.evidencePath ?? resolve(options.repo, "docs/evidence/e2e-live", `${version}.json`);
  const evidence = readEvidence(evidencePath);

  const releaseTag = `immune-brain-v${version}`;
  const stableTag = `${releaseTag}-stable`;
  const stableSha = fetchChannelState(runner, options);
  const release = localCommit(runner, `refs/tags/${releaseTag}`);
  if (!release) throw new PromoteError("release_tag_missing", `tag ${releaseTag} does not exist`);

  if (evidence.commit !== release) {
    throw new PromoteError("evidence_commit_mismatch", `evidence commit ${evidence.commit} is not the ${releaseTag} commit ${release}`);
  }
  if (evidence.version !== version) {
    throw new PromoteError("evidence_version_mismatch", `evidence version ${evidence.version} is not ${version}`);
  }
  if (evidence.mode !== "checklist") {
    throw new PromoteError("evidence_mode_unsupported", `evidence mode ${JSON.stringify(evidence.mode)} is not accepted by this promote`);
  }
  const unchecked = evidence.checklist.filter((entry) => !entry.checked).map((entry) => entry.item);
  if (evidence.checklist.length === 0 || unchecked.length > 0) {
    throw new PromoteError("checklist_unchecked", unchecked.length ? `unchecked: ${unchecked.join("; ")}` : "checklist has no items");
  }
  if (stableSha && !isAncestor(runner, stableSha, release)) {
    throw new PromoteError("stable_not_fast_forward", `${options.branch} (${stableSha}) is not an ancestor of ${release}`);
  }
  const remoteStableTag = remoteRef(runner, options.remote, `refs/tags/${stableTag}`);
  const localStableTag = localCommit(runner, `refs/tags/${stableTag}`);
  for (const existing of [remoteStableTag, localStableTag]) {
    if (existing && existing !== release) throw new PromoteError("stable_tag_conflict", `${stableTag} already points at ${existing}, not ${release}`);
  }
  requireNpmVersion(runner, options, version);
  const latest = npmLatest(runner, options);

  // Writes. Each is skipped when its target state already holds.
  const actions: string[] = [];
  if (stableSha !== release) {
    runner.git(["push", options.remote, `${release}:refs/heads/${options.branch}`]);
    actions.push(`push ${options.branch} -> ${release}`);
  }
  if (!localStableTag) runner.git(["tag", stableTag, release]);
  if (!remoteStableTag) {
    runner.git(["push", options.remote, `refs/tags/${stableTag}`]);
    actions.push(`tag ${stableTag}`);
  }
  if (latest !== version) {
    runner.npm(["dist-tag", "add", `${options.packageName}@${version}`, "latest"]);
    actions.push(`npm latest -> ${version}`);
  }
  return { mode: "promote", version, commit: release, actions };
}

export function rollback(options: PromoteOptions): PromoteResult {
  const runner = makeRunner(options);
  const stableSha = fetchChannelState(runner, options);
  if (!stableSha) throw new PromoteError("stable_branch_missing", `remote ${options.remote} has no ${options.branch} branch`);

  const tags = runner.git(["tag", "--list", "immune-brain-v*-stable"]).stdout.split("\n").filter(Boolean);
  const candidates = tags
    .map((tag) => ({ tag, version: STABLE_TAG_PATTERN.exec(tag)?.[1], commit: localCommit(runner, `refs/tags/${tag}`) }))
    .filter((entry): entry is { tag: string; version: string; commit: string } => Boolean(entry.version && entry.commit))
    .filter((entry) => entry.commit !== stableSha && isAncestor(runner, entry.commit, stableSha))
    .sort((a, b) => compareVersions(b.version, a.version));
  const target = candidates[0];
  if (!target) throw new PromoteError("no_previous_stable_tag", `no immune-brain-v*-stable tag lies below ${options.branch} (${stableSha})`);
  requireNpmVersion(runner, options, target.version);
  const latest = npmLatest(runner, options);

  // npm first: if the branch push then fails, a rerun resolves the same target from the
  // unmoved branch instead of stepping back one more release.
  const actions: string[] = [];
  if (latest !== target.version) {
    runner.npm(["dist-tag", "add", `${options.packageName}@${target.version}`, "latest"]);
    actions.push(`npm latest -> ${target.version}`);
  }
  runner.git(["push", `--force-with-lease=refs/heads/${options.branch}:${stableSha}`, options.remote, `${target.commit}:refs/heads/${options.branch}`]);
  actions.push(`push ${options.branch} -> ${target.commit} (${target.tag})`);
  return { mode: "rollback", version: target.version, commit: target.commit, actions };
}

export function parseArgs(argv: string[]): { mode: "promote" | "rollback"; version?: string; options: PromoteOptions } {
  const options: PromoteOptions = { repo: process.cwd(), remote: "origin", branch: "stable", packageName: "immune-brain", git: "git", npm: "npm" };
  const flags: Record<string, keyof PromoteOptions> = {
    "--repo": "repo", "--remote": "remote", "--branch": "branch", "--package": "packageName", "--git": "git", "--npm": "npm", "--evidence": "evidencePath",
  };
  const positional: string[] = [];
  let isRollback = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--rollback") isRollback = true;
    else if (arg in flags) {
      const value = argv[(i += 1)];
      if (value === undefined) throw new PromoteError("invalid_arguments", `${arg} needs a value`);
      options[flags[arg]] = arg === "--repo" ? resolve(value) : value;
    } else if (arg.startsWith("--")) throw new PromoteError("invalid_arguments", `unknown option ${arg}`);
    else positional.push(arg);
  }
  if (isRollback) {
    if (positional.length) throw new PromoteError("invalid_arguments", "--rollback takes no version");
    return { mode: "rollback", options };
  }
  if (positional.length !== 1) throw new PromoteError("invalid_arguments", "usage: release-promote.ts <version> | --rollback");
  return { mode: "promote", version: positional[0], options };
}

export function main(argv: string[]): number {
  try {
    const parsed = parseArgs(argv);
    const result = parsed.mode === "rollback" ? rollback(parsed.options) : promote(parsed.version as string, parsed.options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    if (!(error instanceof PromoteError)) throw error;
    process.stderr.write(`release-promote refused ${error.code}: ${error.message}\n`);
    return error.code === "git_failed" || error.code === "npm_failed" ? 1 : 2;
  }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
