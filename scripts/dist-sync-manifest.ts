// Single source of truth for the packaged `dist/` sync contract.
//
// The plugin ships a self-contained `plugins/immune-brain/dist/` tree so that an
// installed plugin can load reference docs without the full source repository.
// Some packaged docs are exact mirrors of their `docs/` source; others are
// deterministically adapted for the packaged context (for example, stripping
// `upstreams/` submodule paths that the package does not ship).
//
// Both `scripts/sync-dist-docs.ts` and `tests/dist-docs-sync-contract.test.ts`
// import this module so the classification cannot drift between the tool that
// regenerates `dist/` and the test that guards it.

export type DistDocMode = "mirror" | "adapted";

export interface DistDocEntry {
	/** Path relative to both `docs/` (source) and `plugins/immune-brain/dist/docs/` (packaged). */
	rel: string;
	mode: DistDocMode;
	/** Required for `adapted` entries: why the packaged copy intentionally diverges. */
	reason?: string;
	/** Exact source-to-package replacements. Each source fragment must occur once. */
	replacements?: Array<{ from: string; to: string }>;
}

/**
 * Every file under `plugins/immune-brain/dist/docs/` must be listed here. The
 * contract test fails if a packaged doc is present on disk but missing from this
 * manifest, so new packaged references are always classified explicitly.
 */
export const DIST_DOC_ENTRIES: DistDocEntry[] = [
	// ── mirror: must stay byte-identical to the `docs/` source ──
	{ rel: "reference/immune-brain-config.md", mode: "mirror" },
	{ rel: "reference/ux-heuristic-checklist.md", mode: "mirror" },
	{ rel: "reference/HANDOFF-template.md", mode: "mirror" },
	{ rel: "reference/design-contract-audit-rubric.md", mode: "mirror" },
	{ rel: "reference/design-contract-review-checklist.md", mode: "mirror" },
	{ rel: "reference/subagent-dispatch-protocol.md", mode: "mirror" },
	{ rel: "reference/i18n-review-checklist.md", mode: "mirror" },
	{ rel: "reference/planning-artifact-retention.md", mode: "mirror" },
	{ rel: "reference/planning-quality-gate.md", mode: "mirror" },
	{ rel: "reference/code-quality-guard.md", mode: "mirror" },

	// ── adapted: intentionally divergent packaged copies ──
	// (none currently; empty by design until a packaged doc needs divergence)
];

/**
 * BASELINE.md is maintained in three locations that must stay identical. The
 * root copy is canonical; the skills and dist copies are regenerated from it.
 * (`tests/baseline-packaging-contract.test.ts` also asserts this equality.)
 */
export const BASELINE_CANONICAL = "plugins/immune-brain/BASELINE.md";
export const BASELINE_COPIES = [
	"plugins/immune-brain/skills/BASELINE.md",
	"plugins/immune-brain/dist/BASELINE.md",
];

import { REGISTRY_CANONICAL, REGISTRY_COPIES } from "./skill-registry.ts";
export { REGISTRY_CANONICAL, REGISTRY_COPIES };

export const DOCS_SOURCE_DIR = "docs";
export const DIST_DOCS_DIR = "plugins/immune-brain/dist/docs";
export const ROLE_PROMPT_SOURCE_DIR = "plugins/immune-brain/runtime/prompts";
export const ROLE_PROMPT_DIST_DIR = "plugins/immune-brain/dist/role-prompts";
export const ROLE_PROMPT_FILES = [
	"qa.md",
	"code-review.md",
	"ui-review.md",
	"executor.md",
	"test-fixer.md",
	"pr-fix.md",
	"arch-explorer.md",
	"advisory-reviewer.md",
	"compounder.md",
] as const;

export const MIRROR_ENTRIES = DIST_DOC_ENTRIES.filter(
	(e) => e.mode === "mirror",
);
export const ADAPTED_ENTRIES = DIST_DOC_ENTRIES.filter(
	(e) => e.mode === "adapted",
);
export const GENERATED_ADAPTED_ENTRIES = ADAPTED_ENTRIES.filter(
	(e) => (e.replacements?.length || 0) > 0,
);
export const MANUAL_ADAPTED_ENTRIES = ADAPTED_ENTRIES.filter(
	(e) => !e.replacements?.length,
);

// ── packaged-contract source-of-truth ───────────────────────────────────────
// Every file under `plugins/immune-brain/dist/` must have a declared relationship.
// The skill entry points (SKILL.md) are minimal loaders; the packaged contracts
// (dist/imm-*.md) are the full agent instructions and are therefore their own
// authoring source. Byte identity is intentionally NOT the invariant for these
// pairs (skill ≈5KB vs dist ≈30KB is legitimate).
export type PackagedContractKind = "mirror" | "adapted" | "owned";

export interface PackagedContractEntry {
	/** Path relative to `plugins/immune-brain/dist/` */
	packaged: string;
	/** Repo-relative source path, or null when the packaged file is its own source */
	source: string | null;
	kind: PackagedContractKind;
	reason?: string;
	/** For owned skill contracts, the owning skill name */
	skill?: string;
}

export const SKILL_OWNED_ENTRIES: PackagedContractEntry[] = [
	{
		packaged: "imm-brainstorm.md",
		source: null,
		kind: "owned",
		reason:
			"Packaged contract is its own authoring source; plugins/immune-brain/skills/imm-brainstorm/SKILL.md is a minimal loader that references it. Legitimate size difference, no byte identity.",
		skill: "imm-brainstorm",
	},
	{
		packaged: "imm-loop.md",
		source: null,
		kind: "owned",
		reason:
			"Packaged contract is its own authoring source; plugins/immune-brain/skills/imm-loop/SKILL.md is a minimal loader that references it. Legitimate size difference, no byte identity.",
		skill: "imm-loop",
	},
	{
		packaged: "imm-planner.md",
		source: null,
		kind: "owned",
		reason:
			"Packaged contract is its own authoring source; plugins/immune-brain/skills/imm-planner/SKILL.md is a minimal loader that references it. Legitimate size difference, no byte identity.",
		skill: "imm-planner",
	},
	{
		packaged: "imm-pr-fix.md",
		source: null,
		kind: "owned",
		reason:
			"Packaged contract is its own authoring source; plugins/immune-brain/skills/imm-pr-fix/SKILL.md is a minimal loader that references it. Legitimate size difference, no byte identity.",
		skill: "imm-pr-fix",
	},
	{
		packaged: "imm-doc-prune.md",
		source: null,
		kind: "owned",
		reason:
			"Packaged contract is its own authoring source; plugins/immune-brain/skills/imm-doc-prune/SKILL.md is a minimal loader that references it. Legitimate size difference, no byte identity.",
		skill: "imm-doc-prune",
	},
	{
		packaged: "imm-agent-doc-maintain.md",
		source: null,
		kind: "owned",
		reason:
			"Packaged contract is its own authoring source; plugins/immune-brain/skills/imm-agent-doc-maintain/SKILL.md is a minimal loader that references it. Legitimate size difference, no byte identity.",
		skill: "imm-agent-doc-maintain",
	},
];

export const PACKAGED_CONTRACT_ENTRIES: PackagedContractEntry[] = [
	// dist/docs/* entries
	...DIST_DOC_ENTRIES.map((e) => ({
		packaged: `docs/${e.rel}`,
		source: `${DOCS_SOURCE_DIR}/${e.rel}`,
		kind: e.mode as PackagedContractKind,
		reason: e.reason,
	})),
	// role prompts are exact mirrors of runtime prompts
	...ROLE_PROMPT_FILES.map(
		(file) =>
			({
				packaged: `role-prompts/${file}`,
				source: `${ROLE_PROMPT_SOURCE_DIR}/${file}`,
				kind: "mirror" as PackagedContractKind,
			}) as PackagedContractEntry,
	),
	// top-level mirrors
	{
		packaged: "BASELINE.md",
		source: BASELINE_CANONICAL,
		kind: "mirror",
		reason: "Mirrored canonical BASELINE.md.",
	},
	{
		packaged: "registry.yaml",
		source: REGISTRY_CANONICAL,
		kind: "mirror",
		reason: "Mirrored canonical registry.yaml.",
	},
	// owned skill contracts — self-sourced, loader references them
	...SKILL_OWNED_ENTRIES,
	{
		packaged: "claude/mcp-server.mjs",
		source: "plugins/immune-brain/runtime/claude/mcp_server.ts",
		kind: "adapted",
		reason: "Generated Node stdio bundle; drift is guarded by tests/claude-host-package.test.ts.",
	},
];

export function renderDistDoc(entry: DistDocEntry, source: string): string {
	let rendered = source;
	for (const replacement of entry.replacements || []) {
		const occurrences = rendered.split(replacement.from).length - 1;
		if (occurrences !== 1) {
			throw new Error(
				`${entry.rel}: expected adapted source fragment exactly once, found ${occurrences}`,
			);
		}
		rendered = rendered.replace(replacement.from, replacement.to);
	}
	return rendered;
}
