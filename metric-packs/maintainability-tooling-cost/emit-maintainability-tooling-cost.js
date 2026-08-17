#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const targetPath = process.argv[2] || process.env.PLUGIN_EVAL_TARGET;
const targetKind = process.argv[3] || process.env.PLUGIN_EVAL_TARGET_KIND || "skill";

if (!targetPath) {
  fail("Missing target path. plugin-eval should append target path and target kind.");
}

const absoluteTarget = path.resolve(process.cwd(), targetPath);

if (!fs.existsSync(absoluteTarget)) {
  fail(`Target does not exist: ${absoluteTarget}`);
}

const checks = [];
const metrics = [];

const skillFiles = collectSkillFiles(absoluteTarget, targetKind);
const textUnits = skillFiles.map((file) => ({
  file,
  relativeFile: path.relative(absoluteTarget, file) || path.basename(file),
  text: fs.readFileSync(file, "utf8"),
}));

const combinedText = textUnits.map((unit) => unit.text).join("\n\n");
const estimatedTokens = estimateTokens(combinedText);
const codeFenceLines = countCodeFenceLines(combinedText);
const repeatedLineRatio = calculateRepeatedLineRatio(combinedText);
const toolRefs = collectToolReferences(combinedText);
const boundedToolRefs = toolRefs.filter((ref) => hasNearbyBoundaryLanguage(combinedText, ref.index));
const vagueToolRefs = collectVagueToolReferences(combinedText);
const dangerousCommandRefs = collectDangerousCommandReferences(combinedText);
const maxSkillLines = Math.max(0, ...textUnits.map((unit) => countLines(unit.text)));
const avgSkillLines = textUnits.length
  ? textUnits.reduce((sum, unit) => sum + countLines(unit.text), 0) / textUnits.length
  : 0;

emitMaintainabilityChecks();
emitToolQualityChecks();
emitTokenCostChecks();
emitMetrics();

process.stdout.write(JSON.stringify({ checks, metrics }, null, 2));

function emitMaintainabilityChecks() {
  if (targetKind === "skill") {
    const skillText = textUnits[0] ? textUnits[0].text : "";
    const frontmatter = extractFrontmatter(skillText);
    const hasFrontmatter = frontmatter !== null;
    const hasName = frontmatter !== null && /^name:\s*\S/m.test(frontmatter);
    const hasDescription = frontmatter !== null && /^description:\s*.+/m.test(frontmatter);

    addCheck({
      id: "maintainability-skill-frontmatter",
      category: "maintainability",
      severity: hasFrontmatter && hasName && hasDescription ? "info" : "warning",
      status: hasFrontmatter && hasName && hasDescription ? "pass" : "warn",
      message: hasFrontmatter && hasName && hasDescription
        ? "Skill frontmatter includes stable name and description fields."
        : "Skill frontmatter should include stable name and description fields.",
      evidence: [
        `frontmatter=${hasFrontmatter}`,
        `name=${hasName}`,
        `description=${hasDescription}`,
      ],
      remediation: [
        "Add YAML frontmatter with name and description so evaluators and hosts can route the skill deterministically.",
      ],
    });
  }

  if (targetKind === "plugin") {
    const manifestPath = path.join(absoluteTarget, ".codex-plugin", "plugin.json");
    let manifestOk = false;
    let manifestEvidence = `missing=${path.relative(absoluteTarget, manifestPath)}`;

    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        manifestOk = Boolean(manifest.name || manifest.id) && Boolean(manifest.version);
        manifestEvidence = `hasNameOrId=${Boolean(manifest.name || manifest.id)}, version=${Boolean(manifest.version)}`;
      } catch (error) {
        manifestEvidence = `invalidJson=${error.message}`;
      }
    }

    addCheck({
      id: "maintainability-plugin-manifest",
      category: "maintainability",
      severity: manifestOk ? "info" : "warning",
      status: manifestOk ? "pass" : "warn",
      message: manifestOk
        ? "Plugin manifest exposes stable identity metadata."
        : "Plugin manifest should expose stable identity metadata.",
      evidence: [manifestEvidence],
      remediation: [
        "Add or fix .codex-plugin/plugin.json with stable name or id plus version.",
      ],
    });
  }

  const oversized = textUnits.filter((unit) => countLines(unit.text) > 220);
  addCheck({
    id: "maintainability-skill-size",
    category: "maintainability",
    severity: oversized.length ? "warning" : "info",
    status: oversized.length ? "warn" : "pass",
    message: oversized.length
      ? "Some skill files are large enough to become hard to maintain."
      : "Skill file sizes are within the maintainability budget.",
    evidence: oversized.length
      ? oversized.map((unit) => `${unit.relativeFile}: ${countLines(unit.text)} lines`)
      : [`maxSkillLines=${maxSkillLines}`],
    remediation: [
      "Move long examples, references, or scripts out of SKILL.md and link to focused supporting files.",
    ],
  });

  const missingWorkflow = textUnits.filter((unit) => !/^##?\s+(workflow|usage|rules|instructions|steps)\b/im.test(unit.text));
  addCheck({
    id: "maintainability-operational-structure",
    category: "maintainability",
    severity: missingWorkflow.length ? "warning" : "info",
    status: missingWorkflow.length ? "warn" : "pass",
    message: missingWorkflow.length
      ? "Some skill files do not expose an obvious operational structure."
      : "Skill files expose recognizable operational sections.",
    evidence: missingWorkflow.length
      ? missingWorkflow.map((unit) => unit.relativeFile)
      : [`skillFiles=${textUnits.length}`],
    remediation: [
      "Use clear sections such as Workflow, Rules, or Steps so future edits have an obvious place to land.",
    ],
  });
}

function emitToolQualityChecks() {
  const boundedRatio = toolRefs.length ? boundedToolRefs.length / toolRefs.length : 1;
  addCheck({
    id: "tool-quality-bounded-tool-use",
    category: "tool-calling-quality",
    severity: boundedRatio >= 0.6 ? "info" : "warning",
    status: boundedRatio >= 0.6 ? "pass" : "warn",
    message: boundedRatio >= 0.6
      ? "Most tool references include nearby boundary language."
      : "Tool references should more often say when, why, or under what limits to use the tool.",
    evidence: [
      `toolRefs=${toolRefs.length}`,
      `boundedToolRefs=${boundedToolRefs.length}`,
      `boundedRatio=${boundedRatio.toFixed(2)}`,
    ],
    remediation: [
      "Near each tool or command reference, state the trigger condition, expected input, and stopping condition.",
    ],
  });

  addCheck({
    id: "tool-quality-vague-tooling-language",
    category: "tool-calling-quality",
    severity: vagueToolRefs.length ? "warning" : "info",
    status: vagueToolRefs.length ? "warn" : "pass",
    message: vagueToolRefs.length
      ? "Vague tool-use language appears without naming concrete tools or commands."
      : "No vague tool-use language was detected.",
    evidence: vagueToolRefs.length
      ? vagueToolRefs.slice(0, 8)
      : ["vagueToolRefs=0"],
    remediation: [
      "Replace phrases like 'use tools as needed' with concrete tool names, command names, or explicit fallback behavior.",
    ],
  });

  const guardedDangerousRefs = dangerousCommandRefs.filter((ref) => hasNearbySafetyLanguage(combinedText, ref.index));
  addCheck({
    id: "tool-quality-risky-command-guards",
    category: "tool-calling-quality",
    severity: dangerousCommandRefs.length === guardedDangerousRefs.length ? "info" : "warning",
    status: dangerousCommandRefs.length === guardedDangerousRefs.length ? "pass" : "warn",
    message: dangerousCommandRefs.length === guardedDangerousRefs.length
      ? "Risky command mentions include nearby safety language."
      : "Risky command mentions need explicit approval or safety language nearby.",
    evidence: [
      `riskyCommandRefs=${dangerousCommandRefs.length}`,
      `guardedRiskyCommandRefs=${guardedDangerousRefs.length}`,
    ],
    remediation: [
      "For commands such as rm, git reset, chmod, or curl-to-shell patterns, require approval, a dry run, or a clearly bounded target.",
    ],
  });
}

function emitTokenCostChecks() {
  addCheck({
    id: "token-cost-total-budget",
    category: "token-cost",
    severity: estimatedTokens <= 2500 ? "info" : "warning",
    status: estimatedTokens <= 2500 ? "pass" : "warn",
    message: estimatedTokens <= 2500
      ? "Estimated instruction footprint is within the local budget."
      : "Estimated instruction footprint is above the local budget.",
    evidence: [`estimatedTokens=${estimatedTokens}`, "budgetTokens=2500"],
    remediation: [
      "Keep SKILL.md concise and move rarely needed examples or references into separate files loaded on demand.",
    ],
  });

  addCheck({
    id: "token-cost-inline-code-volume",
    category: "token-cost",
    severity: codeFenceLines <= 80 ? "info" : "warning",
    status: codeFenceLines <= 80 ? "pass" : "warn",
    message: codeFenceLines <= 80
      ? "Inline fenced-code volume is within budget."
      : "Inline fenced-code volume may increase prompt cost unnecessarily.",
    evidence: [`codeFenceLines=${codeFenceLines}`, "budgetLines=80"],
    remediation: [
      "Move long examples or generated templates into scripts or reference files and load them only when needed.",
    ],
  });

  addCheck({
    id: "token-cost-repetition",
    category: "token-cost",
    severity: repeatedLineRatio <= 0.18 ? "info" : "warning",
    status: repeatedLineRatio <= 0.18 ? "pass" : "warn",
    message: repeatedLineRatio <= 0.18
      ? "Repeated instruction lines are within budget."
      : "Repeated instruction lines may be inflating prompt cost.",
    evidence: [`repeatedLineRatio=${repeatedLineRatio.toFixed(2)}`, "budgetRatio=0.18"],
    remediation: [
      "Deduplicate repeated rules and prefer one canonical instruction with references where needed.",
    ],
  });
}

function emitMetrics() {
  const boundedRatio = toolRefs.length ? boundedToolRefs.length / toolRefs.length : 1;
  const maintainabilityScore = clamp(
    100
      - Math.max(0, maxSkillLines - 220) * 0.25
      - Math.max(0, repeatedLineRatio - 0.18) * 120
      - Math.max(0, avgSkillLines - 160) * 0.15,
    0,
    100,
  );
  const toolQualityScore = clamp(
    100
      - (1 - boundedRatio) * 45
      - vagueToolRefs.length * 6
      - Math.max(0, dangerousCommandRefs.length - dangerousCommandRefs.filter((ref) => hasNearbySafetyLanguage(combinedText, ref.index)).length) * 12,
    0,
    100,
  );
  const tokenCostScore = clamp(
    100
      - Math.max(0, estimatedTokens - 2500) / 30
      - Math.max(0, codeFenceLines - 80) * 0.35
      - Math.max(0, repeatedLineRatio - 0.18) * 100,
    0,
    100,
  );

  addMetric("maintainability-score", "maintainability", round(maintainabilityScore), "points", bandForScore(maintainabilityScore));
  addMetric("tool-calling-quality-score", "tool-calling-quality", round(toolQualityScore), "points", bandForScore(toolQualityScore));
  addMetric("token-cost-score", "token-cost", round(tokenCostScore), "points", bandForScore(tokenCostScore));
  addMetric("estimated-instruction-tokens", "token-cost", estimatedTokens, "tokens", bandForTokenCount(estimatedTokens));
  addMetric("bounded-tool-reference-ratio", "tool-calling-quality", round(boundedRatio), "ratio", bandForRatio(boundedRatio));
  addMetric("skill-file-count", "maintainability", textUnits.length, "count", textUnits.length ? "good" : "poor");
}

function collectSkillFiles(target, kind) {
  const stat = fs.statSync(target);

  if (stat.isFile()) {
    return [target];
  }

  if (kind === "skill") {
    const direct = path.join(target, "SKILL.md");
    return fs.existsSync(direct) ? [direct] : findFiles(target, "SKILL.md");
  }

  return findFiles(target, "SKILL.md");
}

function findFiles(root, basename) {
  const found = [];
  const ignored = new Set([".git", "node_modules", ".next", "dist", "build", ".venv", "__pycache__"]);

  walk(root);
  return found.sort();

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name === basename) {
        found.push(fullPath);
      }
    }
  }
}

function extractFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match ? match[1] : null;
}

function collectToolReferences(text) {
  const pattern = /\b(apply_patch|spawn_agent|wait_agent|web\.run|image_gen|tool_search|plugin-eval|node|npm|pnpm|bun|python3?|ruby|cargo|go|swift|xcodebuild|git|gh|curl|kubectl|docker|wrangler|playwright)\b/g;
  return collectMatches(text, pattern);
}

function collectVagueToolReferences(text) {
  const pattern = /\b(use tools as needed|call tools as needed|run commands as needed|use the appropriate tool|use relevant tools)\b/gi;
  return collectMatches(text, pattern).map((match) => snippetAround(text, match.index));
}

function collectDangerousCommandReferences(text) {
  const pattern = /\b(rm\s+-rf|git\s+reset|git\s+checkout\s+--|chmod\s+-R|curl\b[^`\n|]*\|\s*(sh|bash)|sudo\b)\b/gi;
  return collectMatches(text, pattern);
}

function collectMatches(text, pattern) {
  const matches = [];
  let match;
  while ((match = pattern.exec(text)) !== null) {
    matches.push({ text: match[0], index: match.index });
  }
  return matches;
}

function hasNearbyBoundaryLanguage(text, index) {
  const snippet = windowAround(text, index, 220).toLowerCase();
  return /\b(when|if|only|prefer|avoid|must|should|do not|before|after|fallback|verify|stop|approval|ask|require)\b/.test(snippet);
}

function hasNearbySafetyLanguage(text, index) {
  const snippet = windowAround(text, index, 260).toLowerCase();
  return /\b(approval|ask|confirm|dry run|bounded|safe|never|avoid|do not|backup|verify|explicit)\b/.test(snippet);
}

function windowAround(text, index, radius) {
  return text.slice(Math.max(0, index - radius), Math.min(text.length, index + radius));
}

function snippetAround(text, index) {
  return windowAround(text, index, 90).replace(/\s+/g, " ").trim();
}

function countLines(text) {
  if (!text) return 0;
  return text.split(/\r?\n/).length;
}

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function countCodeFenceLines(text) {
  const lines = text.split(/\r?\n/);
  let inFence = false;
  let count = 0;

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) count += 1;
  }

  return count;
}

function calculateRepeatedLineRatio(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 24 && !line.startsWith("|"));
  if (!lines.length) return 0;

  const seen = new Set();
  let repeated = 0;
  for (const line of lines) {
    if (seen.has(line)) repeated += 1;
    seen.add(line);
  }
  return repeated / lines.length;
}

function addCheck({ id, category, severity, status, message, evidence, remediation }) {
  checks.push({ id, category, severity, status, message, evidence, remediation });
}

function addMetric(id, category, value, unit, band) {
  metrics.push({ id, category, value, unit, band });
}

function bandForScore(score) {
  if (score >= 85) return "good";
  if (score >= 65) return "ok";
  return "poor";
}

function bandForTokenCount(tokens) {
  if (tokens <= 1800) return "good";
  if (tokens <= 2500) return "ok";
  return "poor";
}

function bandForRatio(ratio) {
  if (ratio >= 0.8) return "good";
  if (ratio >= 0.6) return "ok";
  return "poor";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
