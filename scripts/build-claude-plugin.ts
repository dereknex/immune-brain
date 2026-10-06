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
} from "../plugins/immune-brain/runtime/role_prompt_bridge";

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

const REVIEWER_FRONTMATTER = `---
name: immune-brain-reviewer
description: Independent Immune-Brain Review authority. Read-only evidence review against an immutable snapshot.
tools: Read, Grep, Glob, Bash
---`;

function generateReviewerDefinition(root: string): string {
	const rolePrompt = readFileSync(resolve(root, REVIEWER_PROMPT_SRC), "utf8").trim();
	return [
		REVIEWER_FRONTMATTER,
		rolePrompt,
		...STATIC_REVIEW_RULES,
		...REVIEWER_DISPATCH_RULES,
		"",
	].join("\n\n");
}

/**
 * Compare the committed reviewer definition against a fresh generate.
 *
 * Returned as a message rather than thrown so a caller can check it without a
 * bundle compile, and so a test can point it at a temporary root.
 */
export function reviewerDefinitionDrift(root: string): string | null {
	const definition = resolve(root, REVIEWER_DEFINITION_OUT);
	if (readFileSync(definition, "utf8") !== generateReviewerDefinition(root)) {
		return `${REVIEWER_DEFINITION_OUT} drifted from a fresh generate of ${REVIEWER_PROMPT_SRC} plus the static review rules`;
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
	const drift = reviewerDefinitionDrift(root);
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
