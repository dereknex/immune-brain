import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(import.meta.dir, "../scripts/release-promote.ts");
const VERSIONS = ["9.0.0", "9.1.0", "9.2.0"] as const;

// Stub npm: `view` succeeds for versions listed in versions.txt, `dist-tag ls` prints latest.txt,
// `dist-tag add <pkg>@<v> latest` rewrites latest.txt. Every call is appended to calls.log.
const STUB_NPM = `#!/bin/sh
D="$STUB_NPM_DIR"
echo "$*" >> "$D/calls.log"
case "$1 $2" in
  "dist-tag ls") echo "latest: $(cat "$D/latest.txt")" ;;
  "dist-tag add") [ "$4" = latest ] && echo "\${3##*@}" > "$D/latest.txt" ;;
  "view "*) grep -qx "\${2##*@}" "$D/versions.txt" && echo "\${2##*@}" || exit 1 ;;
  *) exit 64 ;;
esac
`;

interface Fixture {
  root: string;
  work: string;
  remote: string;
  npmDir: string;
  /** commit of each release, tagged immune-brain-v<version> */
  commits: Record<string, string>;
}

let fx: Fixture;

function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_") || key.startsWith("HERDR_")) delete env[key];
  return { ...env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.test", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.test" };
}

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: gitEnv() });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function remoteRefs(): string {
  return git(fx.remote, "for-each-ref", "--format=%(refname) %(objectname)");
}

function npmCalls(): string[] {
  return readFileSync(join(fx.npmDir, "calls.log"), "utf8").split("\n").filter(Boolean);
}

function distTagAdds(): string[] {
  return npmCalls().filter((call) => call.startsWith("dist-tag add"));
}

function latest(): string {
  return readFileSync(join(fx.npmDir, "latest.txt"), "utf8").trim();
}

const attempt = (result: "pass" | "fail") => ({ result, duration_ms: 1200, log_sha256: "a".repeat(64) });
const LIVE_PAIRS: [string, string][] = [["J1", "claude"], ["J4", "claude"], ["J4", "pi"], ["J4", "antigravity"]];

/** Live-mode journeys: every required pair passing on its first attempt, unless `change` rewrites one. */
function liveJourneys(change: (id: string, host: string) => unknown | undefined = () => undefined): unknown[] {
  return LIVE_PAIRS.flatMap(([id, host]) => {
    const changed = change(id, host);
    if (changed === null) return [];
    return [changed ?? { id, host, result: "pass", attempts: [attempt("pass")] }];
  });
}

function writeEvidence(version: string, overrides: Record<string, unknown> = {}): void {
  const dir = join(fx.work, "docs/evidence/e2e-live");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${version}.json`),
    JSON.stringify({
      contract: "immune_brain/e2e_release_evidence/v1",
      version,
      commit: fx.commits[version],
      mode: "live",
      hosts: { claude: "2.1.330", pi: "1.5.2", herdr: "0.9.5" },
      journeys: liveJourneys(),
      checklist: [],
      ...overrides,
    }),
  );
}

function pushStable(version: string, withTag = true): void {
  git(fx.work, "push", "origin", `${fx.commits[version]}:refs/heads/stable`);
  if (withTag) tagStable(version);
}

function tagStable(version: string): void {
  git(fx.work, "tag", `immune-brain-v${version}-stable`, fx.commits[version]);
  git(fx.work, "push", "origin", `refs/tags/immune-brain-v${version}-stable`);
}

function run(...args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("bun", [SCRIPT, ...args, "--repo", fx.work, "--npm", join(fx.root, "npm")], {
    encoding: "utf8",
    env: { ...gitEnv(), STUB_NPM_DIR: fx.npmDir },
  });
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), "release-promote-"));
  const remote = join(root, "remote.git");
  const work = join(root, "work");
  const npmDir = join(root, "npm-state");
  mkdirSync(npmDir);
  git(root, "init", "--bare", "-b", "main", remote);
  git(root, "init", "-b", "main", work);
  git(work, "remote", "add", "origin", remote);
  const commits: Record<string, string> = {};
  for (const version of VERSIONS) {
    writeFileSync(join(work, "version.txt"), version);
    git(work, "add", "version.txt");
    git(work, "commit", "-m", `chore: version packages ${version}`);
    git(work, "tag", `immune-brain-v${version}`);
    commits[version] = git(work, "rev-parse", "HEAD");
  }
  git(work, "push", "origin", "main", "--tags");
  writeFileSync(join(root, "npm"), STUB_NPM);
  chmodSync(join(root, "npm"), 0o755);
  writeFileSync(join(npmDir, "versions.txt"), `${VERSIONS.join("\n")}\n`);
  writeFileSync(join(npmDir, "latest.txt"), "9.0.0\n");
  writeFileSync(join(npmDir, "calls.log"), "");
  fx = { root, work, remote, npmDir, commits };
});

afterEach(() => {
  rmSync(fx.root, { recursive: true, force: true });
});

describe("release-promote promote mode", () => {
  it("fast-forwards stable, tags -stable and moves npm latest; a rerun writes nothing", () => {
    pushStable("9.0.0");
    writeEvidence("9.1.0");

    const first = run("9.1.0");
    expect(first.stderr).toBe("");
    expect(first.status).toBe(0);
    expect(JSON.parse(first.stdout).actions).toEqual([
      `push stable -> ${fx.commits["9.1.0"]}`,
      "tag immune-brain-v9.1.0-stable",
      "npm latest -> 9.1.0",
    ]);
    expect(git(fx.remote, "rev-parse", "refs/heads/stable")).toBe(fx.commits["9.1.0"]);
    expect(git(fx.remote, "rev-parse", "refs/tags/immune-brain-v9.1.0-stable")).toBe(fx.commits["9.1.0"]);
    expect(distTagAdds()).toEqual(["dist-tag add immune-brain@9.1.0 latest"]);
    expect(latest()).toBe("9.1.0");

    const refsAfterFirst = remoteRefs();
    const second = run("9.1.0");
    expect(second.status).toBe(0);
    expect(JSON.parse(second.stdout).actions).toEqual([]);
    expect(remoteRefs()).toBe(refsAfterFirst);
    expect(distTagAdds()).toHaveLength(1);
  });

  it("promotes live evidence whose J1 passed on its retry", () => {
    pushStable("9.0.0");
    writeEvidence("9.1.0", { journeys: liveJourneys((id, host) => (id === "J1" && host === "pi" ? { id, host, result: "pass", attempts: [attempt("fail"), attempt("pass")] } : undefined)) });

    const result = run("9.1.0");
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(latest()).toBe("9.1.0");
  });

  it("finishes only the missing steps after a run that stopped before npm", () => {
    pushStable("9.0.0");
    writeEvidence("9.1.0");
    pushStable("9.1.0", false);

    const result = run("9.1.0");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).actions).toEqual(["tag immune-brain-v9.1.0-stable", "npm latest -> 9.1.0"]);
  });

  const refusals: { name: string; code: string; arrange: () => string }[] = [
    {
      name: "evidence commit differs from the release commit",
      code: "evidence_commit_mismatch",
      arrange: () => (writeEvidence("9.1.0", { commit: fx.commits["9.0.0"] }), "9.1.0"),
    },
    {
      name: "evidence version differs from the requested version",
      code: "evidence_version_mismatch",
      arrange: () => (writeEvidence("9.1.0", { version: "9.0.0" }), "9.1.0"),
    },
    {
      name: "the evidence is checklist mode with every item checked",
      code: "evidence_mode_unsupported",
      arrange: () => (writeEvidence("9.1.0", { mode: "checklist", hosts: {}, journeys: [], checklist: [{ item: "dogfooded on next", checked: true }, { item: "marketplace install checked", checked: true }] }), "9.1.0"),
    },
    {
      name: "live evidence has a failing J1 result",
      code: "live_journey_failed",
      arrange: () => (writeEvidence("9.1.0", { journeys: liveJourneys((id, host) => (id === "J1" && host === "claude" ? { id, host, result: "fail", attempts: [attempt("fail"), attempt("fail")] } : undefined)) }), "9.1.0"),
    },
    {
      name: "live evidence has a failing J4 result",
      code: "live_journey_failed",
      arrange: () => (writeEvidence("9.1.0", { journeys: liveJourneys((id, host) => (id === "J4" && host === "antigravity" ? { id, host, result: "fail", attempts: [attempt("fail"), attempt("fail")] } : undefined)) }), "9.1.0"),
    },
    {
      name: "live evidence has no J1 record for claude",
      code: "live_journey_missing",
      arrange: () => (writeEvidence("9.1.0", { journeys: liveJourneys((id, host) => (id === "J1" && host === "claude" ? null : undefined)) }), "9.1.0"),
    },
    {
      name: "live evidence has no J4 records at all",
      code: "live_journey_missing",
      arrange: () => (writeEvidence("9.1.0", { journeys: liveJourneys((id) => (id === "J1" ? undefined : null)) }), "9.1.0"),
    },
    {
      name: "a recorded pass is contradicted by its failing attempt",
      code: "evidence_invalid",
      arrange: () => (writeEvidence("9.1.0", { journeys: liveJourneys((id, host) => (id === "J1" && host === "claude" ? { id, host, result: "pass", attempts: [attempt("fail")] } : undefined)) }), "9.1.0"),
    },
    {
      name: "live evidence records no Host versions",
      code: "evidence_invalid",
      arrange: () => (writeEvidence("9.1.0", { hosts: {} }), "9.1.0"),
    },
    {
      name: "the immune-brain-vX tag is missing",
      code: "release_tag_missing",
      arrange: () => (writeEvidence("9.3.0", { commit: fx.commits["9.2.0"] }), "9.3.0"),
    },
    {
      name: "stable is not an ancestor of the release commit",
      code: "stable_not_fast_forward",
      arrange: () => {
        git(fx.work, "checkout", "-q", "-b", "diverged", fx.commits["9.0.0"]);
        writeFileSync(join(fx.work, "version.txt"), "diverged");
        git(fx.work, "commit", "-qam", "diverged stable");
        git(fx.work, "push", "origin", "HEAD:refs/heads/stable");
        git(fx.work, "checkout", "-q", "main");
        writeEvidence("9.1.0");
        return "9.1.0";
      },
    },
    {
      name: "the version string is malformed",
      code: "invalid_version",
      arrange: () => "9.1",
    },
    {
      name: "the evidence mode is unknown",
      code: "evidence_mode_unsupported",
      arrange: () => (writeEvidence("9.1.0", { mode: "dry-run" }), "9.1.0"),
    },
    {
      name: "the -stable tag already points at another commit",
      code: "stable_tag_conflict",
      arrange: () => {
        git(fx.work, "tag", "immune-brain-v9.1.0-stable", fx.commits["9.0.0"]);
        git(fx.work, "push", "origin", "refs/tags/immune-brain-v9.1.0-stable");
        writeEvidence("9.1.0");
        return "9.1.0";
      },
    },
    {
      name: "the version is not on npm",
      code: "npm_version_missing",
      arrange: () => {
        writeFileSync(join(fx.npmDir, "versions.txt"), "9.0.0\n");
        writeEvidence("9.1.0");
        return "9.1.0";
      },
    },
  ];

  for (const refusal of refusals) {
    it(`refuses with ${refusal.code} before any write when ${refusal.name}`, () => {
      pushStable("9.0.0");
      const version = refusal.arrange();
      const refsBefore = remoteRefs();

      const result = run(version);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain(`release-promote refused ${refusal.code}:`);
      expect(remoteRefs()).toBe(refsBefore);
      expect(distTagAdds()).toEqual([]);
      expect(latest()).toBe("9.0.0");
    });
  }
});

describe("release-promote --rollback", () => {
  it("moves stable and npm latest to the newest -stable tag below the current stable commit", () => {
    for (const version of VERSIONS) tagStable(version);
    pushStable("9.2.0", false);
    writeFileSync(join(fx.npmDir, "latest.txt"), "9.2.0\n");

    const result = run("--rollback");
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(git(fx.remote, "rev-parse", "refs/heads/stable")).toBe(fx.commits["9.1.0"]);
    expect(distTagAdds()).toEqual(["dist-tag add immune-brain@9.1.0 latest"]);
    expect(latest()).toBe("9.1.0");
    expect(git(fx.remote, "rev-parse", "refs/tags/immune-brain-v9.2.0-stable")).toBe(fx.commits["9.2.0"]);
  });

  it("refuses before any write when no -stable tag lies below stable", () => {
    pushStable("9.0.0");
    const refsBefore = remoteRefs();

    const result = run("--rollback");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("release-promote refused no_previous_stable_tag:");
    expect(remoteRefs()).toBe(refsBefore);
    expect(distTagAdds()).toEqual([]);
  });

  it("refuses when the remote has no stable branch", () => {
    const result = run("--rollback");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("release-promote refused stable_branch_missing:");
    expect(distTagAdds()).toEqual([]);
  });
});
