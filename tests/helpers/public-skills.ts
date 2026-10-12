import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REGISTRY = resolve(import.meta.dir, "../../plugins/immune-brain/skills/registry.yaml");

/** Public Skill names in canonical registry order. */
export function publicSkillNames(): string[] {
	const registry = Bun.YAML.parse(readFileSync(REGISTRY, "utf8")) as { skills: Array<{ name: string }> };
	return registry.skills.map((skill) => skill.name);
}
