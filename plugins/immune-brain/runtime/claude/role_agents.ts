import type { InternalRole } from "../role_prompt_bridge";

/**
 * Claude plugin agent definitions for the read-only internal roles.
 *
 * A native definition is the strictest boundary the Host can express for these
 * roles: `Read, Grep, Glob` grants no write, shell or dispatch tool, while the
 * Pi mapping leaves the same boundary as prompt text. `INTERNAL_ROLE_PROMPTS`
 * declares `no tools` or `read-only tools` for every role here; a native
 * definition cannot express an empty allowlist without inheriting every tool,
 * so read-only-without-shell is what ships.
 *
 * The bodies are generated from the matching `runtime/prompts/` source by
 * `scripts/build-claude-plugin.ts`, never maintained by hand.
 */
export interface ClaudeReadonlyRoleAgent {
	/** The plugin-qualified agent type the Claude `Agent` tool accepts. */
	readonly agent: string;
	/** Repository-relative definition the plugin build generates. */
	readonly definition: string;
	/** The role prompt source the definition body is generated from. */
	readonly prompt: string;
	/** Frontmatter `description`: when the Host may select this agent. */
	readonly description: string;
}

export const CLAUDE_READONLY_ROLE_AGENTS = {
	qa: {
		agent: "immune-brain:immune-brain-qa",
		definition: "plugins/immune-brain/agents/immune-brain-qa.md",
		prompt: "plugins/immune-brain/runtime/prompts/qa.md",
		description:
			"Immune-Brain QA authority. Judges recorded execution evidence against one active target and returns one decision.",
	},
	"ui-review": {
		agent: "immune-brain:immune-brain-ui-review",
		definition: "plugins/immune-brain/agents/immune-brain-ui-review.md",
		prompt: "plugins/immune-brain/runtime/prompts/ui-review.md",
		description:
			"Immune-Brain UI Review authority. Read-only review of a bounded UI change surface and its evidence.",
	},
	"advisory-reviewer": {
		agent: "immune-brain:immune-brain-advisory-reviewer",
		definition: "plugins/immune-brain/agents/immune-brain-advisory-reviewer.md",
		prompt: "plugins/immune-brain/runtime/prompts/advisory-reviewer.md",
		description:
			"Immune-Brain advisory reviewer for one explicit lens. Read-only advice; synthesis stays with the coordinating Parent.",
	},
} as const satisfies Record<string, ClaudeReadonlyRoleAgent>;

/** The read-only roles that ship a generated native definition. */
export type ClaudeReadonlyRole = keyof typeof CLAUDE_READONLY_ROLE_AGENTS;

export const CLAUDE_READONLY_ROLES = Object.keys(
	CLAUDE_READONLY_ROLE_AGENTS,
) as ClaudeReadonlyRole[];

/** The tool allowlist every generated read-only definition declares. */
export const CLAUDE_READONLY_TOOLS = ["Read", "Grep", "Glob"] as const;

/**
 * The read-only internal roles that ship no definition because the Host already
 * provides the agent. `arch-explorer` is architecture discovery: Claude's own
 * `Explore` agent is the read-only research agent, and shipping a second
 * definition would fork a boundary the Host owns.
 */
export const CLAUDE_HOST_PROVIDED_ROLE_AGENTS = {
	"arch-explorer": { agent: "Explore" },
} as const satisfies Record<string, { agent: string }>;

/**
 * Roles that are not dispatched as native Claude agents.
 *
 * `code-review` ships its own definition with a wider allowlist (it must run
 * read-only Git commands), so it is not part of this table. The remaining roles
 * write: `executor`, `test-fixer` and `pr-fix` mutate the workspace, and
 * `compounder` writes learning storage. A write-capable role stays bounded by
 * its dispatch envelope and the Parent, not by an agent definition.
 */
export const CLAUDE_NATIVE_AGENT_ROLES = new Set<InternalRole>([
	...CLAUDE_READONLY_ROLES,
	...(Object.keys(CLAUDE_HOST_PROVIDED_ROLE_AGENTS) as InternalRole[]),
]);
