#!/usr/bin/env bun
// Regenerate packaged `plugins/immune-brain/dist/` copies from canonical docs.
// Mirror entries are copied exactly; generated adapted entries apply explicit
// replacements declared in `dist-sync-manifest.ts`.
//
// Usage:
//   bun scripts/sync-dist-docs.ts            # write mirror copies + BASELINE
//   bun scripts/sync-dist-docs.ts --check    # report drift, write nothing (exit 1 on drift)

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import {
	BASELINE_CANONICAL,
	BASELINE_COPIES,
	DIST_DOCS_DIR,
	DOCS_SOURCE_DIR,
	MIRROR_ENTRIES,
	GENERATED_ADAPTED_ENTRIES,
	MANUAL_ADAPTED_ENTRIES,
	PACKAGED_CONTRACT_ENTRIES,
	SKILL_OWNED_ENTRIES,
	renderDistDoc,
	REGISTRY_CANONICAL,
	REGISTRY_COPIES,
	ROLE_PROMPT_SOURCE_DIR,
	ROLE_PROMPT_DIST_DIR,
	ROLE_PROMPT_FILES,
} from "./dist-sync-manifest.ts";
import {
	README_ROLE_MARKER,
	readSkillRegistry,
	renderReadmeRoleSection,
} from "./skill-registry.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");

interface Pair {
	label: string;
	source: string;
	target: string;
	render?: (source: string) => string;
}

const pairs: Pair[] = [];
for (const entry of [...MIRROR_ENTRIES, ...GENERATED_ADAPTED_ENTRIES]) {
	pairs.push({
		label: `dist/docs/${entry.rel}`,
		source: resolve(REPO_ROOT, DOCS_SOURCE_DIR, entry.rel),
		target: resolve(REPO_ROOT, DIST_DOCS_DIR, entry.rel),
		render:
			entry.mode === "adapted"
				? (source) => renderDistDoc(entry, source)
				: undefined,
	});
}
for (const copy of BASELINE_COPIES) {
	pairs.push({
		label: copy,
		source: resolve(REPO_ROOT, BASELINE_CANONICAL),
		target: resolve(REPO_ROOT, copy),
	});
}
for (const copy of REGISTRY_COPIES) {
	pairs.push({
		label: copy,
		source: resolve(REPO_ROOT, REGISTRY_CANONICAL),
		target: resolve(REPO_ROOT, copy),
	});
}
for (const file of ROLE_PROMPT_FILES) {
	pairs.push({
		label: `${ROLE_PROMPT_DIST_DIR}/${file}`,
		source: resolve(REPO_ROOT, ROLE_PROMPT_SOURCE_DIR, file),
		target: resolve(REPO_ROOT, ROLE_PROMPT_DIST_DIR, file),
	});
}

let driftCount = 0;
let wroteCount = 0;
const missingSources: string[] = [];

const readmePath = resolve(REPO_ROOT, "plugins/immune-brain/README.md");
const readmeEndMarker = "<!-- END GENERATED: skill-registry-role-map -->";
function renderReadme(source: string): string {
	const start = source.indexOf(README_ROLE_MARKER);
	const end = source.indexOf(
		readmeEndMarker,
		start + README_ROLE_MARKER.length,
	);
	if (start < 0 || end < 0) {
		throw new Error(`README.md is missing ${README_ROLE_MARKER} markers`);
	}
	const generated = renderReadmeRoleSection(readSkillRegistry(REPO_ROOT));
	return `${source.slice(0, start + README_ROLE_MARKER.length)}\n${generated}\n${source.slice(end)}`;
}

const readmeBefore = readFileSync(readmePath, "utf8");
const readmeAfter = renderReadme(readmeBefore);
if (readmeBefore !== readmeAfter) {
	driftCount++;
	if (checkOnly) console.log("DRIFT plugins/immune-brain/README.md role map");
	else {
		writeFileSync(readmePath, readmeAfter);
		wroteCount++;
		console.log("sync  plugins/immune-brain/README.md role map");
	}
}

for (const { label, source, target, render } of pairs) {
	if (!existsSync(source)) {
		missingSources.push(label);
		continue;
	}
	const canonicalText = readFileSync(source, "utf-8");
	const sourceText = render ? render(canonicalText) : canonicalText;
	const targetText = existsSync(target) ? readFileSync(target, "utf-8") : null;
	if (targetText === sourceText) continue;

	driftCount++;
	if (checkOnly) {
		console.log(`DRIFT ${label}`);
		continue;
	}
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, sourceText);
	wroteCount++;
	console.log(`sync  ${label}`);
}

if (missingSources.length > 0) {
	console.error(
		`\nMissing canonical source for:\n  ${missingSources.join("\n  ")}`,
	);
}

if (MANUAL_ADAPTED_ENTRIES.length > 0) {
	console.log(
		`\nSkipped ${MANUAL_ADAPTED_ENTRIES.length} manually adapted packaged copies:`,
	);
	for (const entry of MANUAL_ADAPTED_ENTRIES)
		console.log(`  dist/docs/${entry.rel}`);
}

if (SKILL_OWNED_ENTRIES.length > 0) {
	console.log(
		`\nSkipped ${SKILL_OWNED_ENTRIES.length} owned packaged contracts (self-sourced, loader references them):`,
	);
	for (const entry of SKILL_OWNED_ENTRIES)
		console.log(`  dist/${entry.packaged} <- skills/${entry.skill}/SKILL.md (owned)`);
}

// ── enumeration guard: every file under dist/ must be declared ─────────────
function listFiles(dir: string): string[] {
	return readdirSync(dir, { recursive: true })
		.map((p) => resolve(dir, typeof p === "string" ? p : p.toString()))
		.filter((p) => statSync(p).isFile());
}
const DIST_ROOT_ABS = resolve(REPO_ROOT, "plugins/immune-brain/dist");
const onDiskPackaged = listFiles(DIST_ROOT_ABS)
	.map((p) => relative(DIST_ROOT_ABS, p).split(sep).join("/"))
	.sort();
const declaredPackaged = PACKAGED_CONTRACT_ENTRIES.map((e) => e.packaged).sort();
const uncovered = onDiskPackaged.filter((p) => !declaredPackaged.includes(p));
const missingDeclared = declaredPackaged.filter((p) => !onDiskPackaged.includes(p));
if (uncovered.length > 0 || missingDeclared.length > 0) {
	if (uncovered.length > 0)
		console.error(`\nUndeclared packaged contract(s) under dist/:\n  ${uncovered.join("\n  ")}`);
	if (missingDeclared.length > 0)
		console.error(`\nDeclared packaged contract(s) missing on disk:\n  ${missingDeclared.join("\n  ")}`);
	if (checkOnly) {
		console.error("\nPackaged contract enumeration failed. Update scripts/dist-sync-manifest.ts.");
		process.exit(1);
	} else {
		// fail even in write mode when enumeration is off — must be declared and present
		process.exit(1);
	}
}

if (checkOnly) {
	if (driftCount > 0 || missingSources.length > 0) {
		console.error(
			`\n${driftCount} generated packaged doc(s) out of sync. Run: bun scripts/sync-dist-docs.ts`,
		);
		process.exit(1);
	}
	console.log("\nAll generated packaged docs are in sync.");
} else {
	console.log(
		`\nDone: ${wroteCount} file(s) updated, ${pairs.length - wroteCount - missingSources.length} already in sync.`,
	);
	if (missingSources.length > 0) process.exit(1);
}
