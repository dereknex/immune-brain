import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface SkillRegistryEntry {
	name: string;
	path: string;
	role: string;
	title: string;
	role_class: string;
	canonical?: boolean;
	canonical_skill?: string;
	mode?: string;
	boundary: string;
	next_actions: string[];
}

const FIELD_RE = /^\s{4}([a-z_]+):\s*(.*?)\s*$/;
const ARRAY_RE = /^\[(.*)\]$/;

function scalar(value: string): string | boolean {
	if (value === "true") return true;
	if (value === "false") return false;
	return value.replace(/^['"]|['"]$/g, "");
}

export function parseSkillRegistry(text: string): SkillRegistryEntry[] {
	const entries: SkillRegistryEntry[] = [];
	let current: Partial<SkillRegistryEntry> | null = null;

	const flush = () => {
		if (!current?.name) return;
		entries.push({
			name: current.name,
			path: current.path || "",
			role: current.role || "",
			title: current.title || current.name,
			role_class: current.role_class || "",
			canonical: current.canonical,
			canonical_skill: current.canonical_skill,
			mode: current.mode,
			boundary: current.boundary || "",
			next_actions: current.next_actions || [],
		});
	};

	for (const rawLine of text.split("\n")) {
		const name = /^\s{2}-\s+name:\s*(.+?)\s*$/.exec(rawLine);
		if (name) {
			flush();
			current = { name: name[1] };
			continue;
		}
		if (!current) continue;
		const field = FIELD_RE.exec(rawLine);
		if (!field) continue;
		const [, key, rawValue] = field;
		const array = ARRAY_RE.exec(rawValue);
		const value = array
			? array[1]
					.split(",")
					.map((item) => item.trim())
					.filter(Boolean)
			: scalar(rawValue);
		if (key === "next_actions") current.next_actions = value as string[];
		else if (key === "canonical") current.canonical = value as boolean;
		else if (
			[
				"path",
				"role",
				"title",
				"role_class",
				"canonical_skill",
				"mode",
				"boundary",
			].includes(key)
		) {
			(current as Record<string, unknown>)[key] = value;
		}
	}
	flush();
	return entries;
}

export function readSkillRegistry(repoRoot: string): SkillRegistryEntry[] {
	return parseSkillRegistry(
		readFileSync(
			resolve(repoRoot, "plugins/immune-brain/skills/registry.yaml"),
			"utf8",
		),
	);
}

function displayRole(entry: SkillRegistryEntry): string {
	const compatibility = entry.canonical_skill
		? `compat -> \`${entry.canonical_skill}\`${entry.mode ? ` (${entry.mode})` : ""}`
		: entry.canonical
			? "canonical"
			: "";
	return [entry.role, entry.role_class, compatibility]
		.filter(Boolean)
		.join("; ");
}

export function renderReadmeRoleSection(entries: SkillRegistryEntry[]): string {
	const rows = entries
		.map(
			(entry) =>
				`| \`${entry.name}\` | ${displayRole(entry)} | ${entry.boundary.replace(/\|/g, "\\|")} |`,
		)
		.join("\n");
	return `### Registry-derived role map

| Entry | Role | Boundary |
| ------- | ---- | -------- |
${rows}`;
}

export const REGISTRY_CANONICAL = "plugins/immune-brain/skills/registry.yaml";
export const REGISTRY_COPIES = ["plugins/immune-brain/dist/registry.yaml"];
export const README_ROLE_MARKER = "<!-- GENERATED: skill-registry-role-map -->";
