import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")

// Spec remove-redundant-checks S5. Both halves are asserted: a sentence that
// restates a rule a named code site enforces is gone, and every prompt-only
// rule it sat beside is still there. The batch contract's restating sentences
// retired with `dist/drive-batch.md` itself (retire-unattended-batch).
const SOURCES = {
  drive: "plugins/immune-brain/dist/drive.md",
  skill: "plugins/immune-brain/skills/authority-review/SKILL.md",
  executor: "plugins/immune-brain/runtime/prompts/executor.md",
} as const

type SourceKey = keyof typeof SOURCES

interface Anchor {
  source: SourceKey
  id: string
  phrase: string
}

const DELETED: Anchor[] = [
  { source: "drive", id: "I2", phrase: "Freezing a snapshot still refuses those paths" },
  { source: "drive", id: "I3", phrase: "TaskRecord and the Kernel projection own lifecycle, artifact state, freshness, and next obligation" },
  { source: "drive", id: "I5", phrase: "Host native-gate failures pause with same-Host recovery and never auto-retry" },
  { source: "drive", id: "I9", phrase: "must equal the frozen snapshot" },
  { source: "drive", id: "I10", phrase: "material and critical work additionally require fresh independent Review" },
  { source: "drive", id: "I11", phrase: "invalidates the snapshot and discards that verdict" },
  { source: "drive", id: "I14", phrase: "Never repeat a mutation merely to obtain its result" },
  { source: "drive", id: "I14", phrase: "Kernel CAS and freshness checks remain mandatory" },
  { source: "drive", id: "I15", phrase: "A snapshot exhausted by two `incomplete` Reviews" },
  { source: "drive", id: "I18", phrase: "Hard no-touch paths remain prohibited" },
  { source: "drive", id: "I22", phrase: "The third native-operation failure" },
  { source: "drive", id: "I24", phrase: "Kernel revalidation removes only the redundant claim without user interaction" },
  { source: "drive", id: "I24", phrase: "A Managed native authority failure stays fail-closed" },
  { source: "drive", id: "I25", phrase: "it is an observation, never execution readiness" },
  { source: "drive", id: "I25", phrase: "`review_preparation_failed` keeps the batch running/enrolled" },
  { source: "drive", id: "I27", phrase: "capped at 16 KiB" },
  { source: "drive", id: "I27", phrase: "at most 2048 bytes" },
  { source: "drive", id: "I27", phrase: "at most 64 in-scope paths" },
  { source: "drive", id: "I28", phrase: "Provider quota or interruption is not Review budget exhaustion" },
  { source: "drive", id: "I28", phrase: "Malformed or stale reviewer output is not a verdict" },
  { source: "drive", id: "I31", phrase: "which never blocks the Loop" },
  { source: "drive", id: "I31", phrase: "never use it as evidence, a Loop blocker" },
  { source: "skill", id: "H1", phrase: "verify `base_head`, `review_commit`, its single parent" },
  { source: "skill", id: "H5", phrase: "without approval or findings" },
  { source: "executor", id: "PR1", phrase: "stopped or excluded work never counts as Parent success" },
]

const KEPT: Anchor[] = [
  { source: "drive", id: "I1", phrase: "Ordinary host input stays host-native; it never creates an execution binding" },
  { source: "drive", id: "I6", phrase: "implement the enrolled acceptance in the current conversation" },
  { source: "drive", id: "I7", phrase: "disclose changed files beyond it as `beyond_estimate` in Review evidence" },
  { source: "drive", id: "I8", phrase: "stop with that ownership conflict instead of staging the whole file" },
  { source: "drive", id: "I12", phrase: "Never dispatch the authority Review as an Agent" },
  { source: "drive", id: "I13", phrase: "Revision ownership: the Loop owner prepares a scope or acceptance revision in the executing session" },
  { source: "drive", id: "I16", phrase: "Resume from authority facts, not prose" },
  { source: "drive", id: "I17", phrase: "The workflow stages are distinct and never inferred from one another" },
  { source: "drive", id: "I19", phrase: "Any scope-only revision that keeps the bound Spec path is `compatible` through `revise_intent`" },
  { source: "drive", id: "I20", phrase: "only a side-effect-free rejection is retried, at most twice" },
  { source: "drive", id: "I21", phrase: "`plan_changed`, `head_moved` and a claim conflict are never retried" },
  { source: "drive", id: "I23", phrase: "A defect inside the existing goal and acceptance is rework under the Execution Loop, not a revision" },
  { source: "drive", id: "I26", phrase: "dispose each identified finding explicitly by `resolve_finding` or evidence-bound `refute_finding`" },
  { source: "drive", id: "I29", phrase: "Missing tools, credentials, invalid projections, or repeated unchanged failures stop with a concrete cause" },
  { source: "drive", id: "I30", phrase: "Reviewers are read-only and bound to the frozen snapshot" },
  { source: "drive", id: "K5", phrase: "A gate failure preserves the candidate and reports its stable reason plus exactly one same-Host recovery action" },
]

function normalize(text: string): string {
  return text.replace(/\s+/g, " ")
}

function readCorpus(root = REPO_ROOT): Record<SourceKey, string> {
  const corpus = {} as Record<SourceKey, string>
  for (const key of Object.keys(SOURCES) as SourceKey[]) {
    corpus[key] = normalize(readFileSync(resolve(root, SOURCES[key]), "utf-8"))
  }
  return corpus
}

function violations(corpus: Record<SourceKey, string>): string[] {
  const found: string[] = []
  for (const anchor of DELETED) {
    if (corpus[anchor.source].includes(anchor.phrase)) found.push(`deleted ${anchor.id} still occurs: ${anchor.phrase}`)
  }
  for (const anchor of KEPT) {
    if (!corpus[anchor.source].includes(anchor.phrase)) found.push(`kept ${anchor.id} is missing: ${anchor.phrase}`)
  }
  return found
}

describe("prompt dedupe contract", () => {
  it("deletes every restating S5 sentence and keeps every prompt-only rule", () => {
    expect(violations(readCorpus())).toEqual([])
  })

  it("states the unchanged-observation stop without a number", () => {
    const drive = readCorpus().drive
    expect(drive).toContain("Unchanged observations stop with one recovery action")
    expect(drive).not.toMatch(/\b(three|3)\b[^.]{0,40}unchanged observations?/i)
  })

  it("fails when a kept prompt-only rule is removed from a fixture copy", () => {
    const dropped = KEPT.find((anchor) => anchor.id === "I17")
    if (!dropped) throw new Error("kept rule I17 is not listed")
    const corpus = readCorpus()
    corpus[dropped.source] = corpus[dropped.source].replace(dropped.phrase, "")
    expect(violations(corpus)).toEqual([`kept I17 is missing: ${dropped.phrase}`])
  })
})
