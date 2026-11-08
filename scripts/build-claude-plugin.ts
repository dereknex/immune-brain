#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { stampPluginManifest, validateManifests } from "./plugin_versioning";
import {
	REVIEWER_DISPATCH_RULES,
	STATIC_REVIEW_RULES,
	currentReviewContractHash,
} from "../plugins/immune-brain/runtime/role_prompt_bridge";
import {
	CLAUDE_READONLY_ROLE_AGENTS,
	CLAUDE_READONLY_TOOLS,
} from "../plugins/immune-brain/runtime/claude/role_agents";

const SRC = "plugins/immune-brain/runtime/claude/mcp_server.ts";
const OUT = "plugins/immune-brain/dist/claude/mcp-server.mjs";

/**
 * The one place the packaged reviewer definition is generated from.
 *
 * The body is the `code-review` role prompt (the same bytes the Pi Host
 * dispatches), then the static review rules the runtime composes into every
 * Review prompt — which include the `inspected_paths` statement — then the
 * dispatch rules. Nothing is restated by hand, so the
 * definition cannot drift from the instructions a dispatched reviewer is meant
 * to carry.
 */
const REVIEWER_PROMPT_SRC = "plugins/immune-brain/runtime/prompts/code-review.md";
const REVIEWER_DEFINITION_OUT = "plugins/immune-brain/agents/immune-brain-reviewer.md";
const VERIFIER_PROMPT_SRC = "plugins/immune-brain/runtime/prompts/review-verifier.md";
const VERIFIER_DEFINITION_OUT = "plugins/immune-brain/agents/immune-brain-review-verifier.md";
const AUTHORITY_REVIEW_SKILL_OUT = "plugins/immune-brain/skills/authority-review/SKILL.md";

const REVIEWER_FRONTMATTER = `---
name: immune-brain-reviewer
description: Independent Immune-Brain Review authority. Read-only evidence review against an immutable snapshot.
tools: Read, Grep, Glob, Bash
---`;

export function generateReviewerDefinition(root: string): string {
	const rolePrompt = readFileSync(resolve(root, REVIEWER_PROMPT_SRC), "utf8").trim();
	return [
		REVIEWER_FRONTMATTER,
		rolePrompt,
		...STATIC_REVIEW_RULES,
		...REVIEWER_DISPATCH_RULES,
		"",
	].join("\n\n");
}

export function generateVerifierDefinition(root: string): string {
	return [
		"---\nname: immune-brain-review-verifier\ndescription: Read-only verification of blocking Review findings against an immutable revision.\ntools: Read, Grep, Glob, Bash\n---",
		readFileSync(resolve(root, VERIFIER_PROMPT_SRC), "utf8").trim(),
	].join("\n\n") + "\n";
}

/**
 * The packaged `authority-review` skill a CLI reviewer loads (D12).
 *
 * Its body is the `code-review` role prompt and the static review rules — the
 * same inputs `currentReviewContractHash()` hashes — so a reviewer reading the
 * skill carries exactly the contract the Kernel bound. The stamp is how a
 * reviewer whose install differs notices: it compares the packet's line with
 * its own and answers with the mismatch line instead of reviewing.
 */
export function generateAuthorityReviewSkill(root: string): string {
	const rolePrompt = readFileSync(resolve(root, REVIEWER_PROMPT_SRC), "utf8").trim();
	const hash = currentReviewContractHash();
	return [
		[
			"---",
			"name: authority-review",
			"description: Invoked by the drive Review stage with one per-task review packet path. Read that packet and return its structured verdict.",
			"---",
		].join("\n"),
		rolePrompt,
		...STATIC_REVIEW_RULES,
		`Review contract hash: ${hash}`,
		`The packet's first line reads \`review_contract_hash: <hash>\`. Compare it with ${hash} before reading any other line. If it differs, reply with exactly \`REVIEW_CONTRACT_MISMATCH ${hash}\` and stop; your install carries different review instructions than the Host that bound this Review.`,
		"The packet states the Review turn budget and the verdict shapes. Return exactly one JSON object, never prose around it; if coverage cannot finish inside the turn budget, return the incomplete shape instead of a coverage finding.",
		"",
	].join("\n\n");
}

export function authorityReviewSkillDrift(root: string): string | null {
	return definitionDrift(root, generateAuthorityReviewSkill(root), AUTHORITY_REVIEW_SKILL_OUT, `${REVIEWER_PROMPT_SRC} plus the static review rules`);
}

/**
 * Compare one committed agent definition against a fresh generate.
 *
 * Returned as a message rather than thrown so a caller can check it without a
 * bundle compile, and so a test can point it at a temporary root.
 */
function definitionDrift(root: string, generated: string, out: string, sources: string): string | null {
	const definition = resolve(root, out);
	if (readFileSync(definition, "utf8") !== generated) return `${out} drifted from a fresh generate of ${sources}`;
	return null;
}

export function reviewerDefinitionDrift(root: string): string | null {
	return definitionDrift(root, generateReviewerDefinition(root), REVIEWER_DEFINITION_OUT, `${REVIEWER_PROMPT_SRC} plus the static review rules`)
		?? definitionDrift(root, generateVerifierDefinition(root), VERIFIER_DEFINITION_OUT, VERIFIER_PROMPT_SRC)
		?? authorityReviewSkillDrift(root);
}

/**
 * The read-only role definitions: one frontmatter with the strictest expressible
 * tool boundary, and a body taken from the matching role prompt source.
 *
 * These roles declare `no tools` in `INTERNAL_ROLE_PROMPTS`. A native definition
 * cannot express an empty allowlist without inheriting every tool, so they ship
 * read-only without shell instead — narrower than the reviewer, which needs
 * `Bash` for read-only Git commands.
 */
export function generateReadonlyRoleDefinitions(root: string): Array<{ out: string; content: string; sources: string }> {
	return Object.values(CLAUDE_READONLY_ROLE_AGENTS).map((spec) => {
		const out = spec.definition;
		const name = out.slice(out.lastIndexOf("/") + 1).replace(/\.md$/, "");
		const body = readFileSync(resolve(root, spec.prompt), "utf8").trim();
		return {
			out,
			content: [
				[
					"---",
					`name: ${name}`,
					`description: ${spec.description}`,
					`tools: ${CLAUDE_READONLY_TOOLS.join(", ")}`,
					"---",
				].join("\n"),
				body,
				"",
			].join("\n\n"),
			sources: spec.prompt,
		};
	});
}

export function readonlyRoleDefinitionDrift(root: string): string | null {
	for (const generated of generateReadonlyRoleDefinitions(root)) {
		const drift = definitionDrift(root, generated.content, generated.out, generated.sources);
		if (drift) return drift;
	}
	return null;
}

function compile(root: string, outfile: string): void {
	mkdirSync(dirname(outfile), { recursive: true });
	const result = spawnSync("bun", ["build", SRC, "--target=node", "--outfile", outfile, "--packages=bundle"], {
		cwd: root,
		encoding: "utf8",
	});
	if (result.status !== 0) throw new Error(result.stderr || result.stdout || "bun build failed");
}

export function buildClaudePlugin(root = resolve(import.meta.dir, "..")): { out: string; version: string } {
	const { version } = stampPluginManifest(root);
	const out = resolve(root, OUT);
	compile(root, out);
	writeFileSync(resolve(root, REVIEWER_DEFINITION_OUT), generateReviewerDefinition(root));
	writeFileSync(resolve(root, VERIFIER_DEFINITION_OUT), generateVerifierDefinition(root));
	for (const generated of generateReadonlyRoleDefinitions(root)) {
		mkdirSync(dirname(resolve(root, generated.out)), { recursive: true });
		writeFileSync(resolve(root, generated.out), generated.content);
	}
	mkdirSync(dirname(resolve(root, AUTHORITY_REVIEW_SKILL_OUT)), { recursive: true });
	writeFileSync(resolve(root, AUTHORITY_REVIEW_SKILL_OUT), generateAuthorityReviewSkill(root));
	return { out, version };
}

export function checkClaudePlugin(root = resolve(import.meta.dir, "..")): void {
	validateManifests(root);
	const committed = resolve(root, OUT);
	const tmp = join(tmpdir(), `mcp-server-check-${randomUUID()}.mjs`);
	compile(root, tmp);
	const expected = readFileSync(committed);
	const actual = readFileSync(tmp);
	if (!expected.equals(actual)) {
		throw new Error(`${OUT} drifted from a fresh bun build of ${SRC}`);
	}
	const drift = reviewerDefinitionDrift(root) ?? readonlyRoleDefinitionDrift(root);
	if (drift) throw new Error(drift);
}

if (import.meta.main) {
	if (process.argv.includes("--check")) {
		checkClaudePlugin();
		console.log("claude plugin bundle is current");
	} else {
		const built = buildClaudePlugin();
		console.log(`built ${built.out} @ ${built.version}`);
	}
}
