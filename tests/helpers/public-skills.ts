import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REGISTRY = resolve(import.meta.dir, "../../plugins/immune-brain/skills/registry.yaml");

/**
 * Shipped skills the runtime dispatches by name from a role prompt. They live in
 * the same root as the public Skills but are never a user entry, so they carry no
 * registry entry, no packaged contract and no request-trigger metadata.
 */
export const INTERNAL_SKILL_NAMES = ["authority-review"];

/** Public Skill names in canonical registry order. */
export function publicSkillNames(): string[] {
	const registry = Bun.YAML.parse(readFileSync(REGISTRY, "utf8")) as { skills: Array<{ name: string }> };
	return registry.skills.map((skill) => skill.name);
}
