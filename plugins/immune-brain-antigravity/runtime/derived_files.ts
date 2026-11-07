import { spawnSync } from "node:child_process";
import { delimiter, join } from "node:path";
import { readSecureProjectFile } from "./kernel/storage";

export const DERIVED_FILES_PATH = "docs/agents/derived-files.json";
export interface DerivedCommand { executable: string; argv: string[] }
export interface DerivedFile { id: string; sources: string[]; outputs: string[]; generate: DerivedCommand; check: DerivedCommand }

function object(value: unknown, fields: string[], field: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`invalid ${field}: expected object`);
	for (const key of Object.keys(value)) if (!fields.includes(key)) throw new Error(`invalid ${field}.${key}: unknown field`);
	return value as Record<string, unknown>;
}
function paths(value: unknown, field: string, glob: boolean): string[] {
	if (!Array.isArray(value) || !value.length) throw new Error(`invalid ${field}: expected non-empty paths`);
	return value.map(path => {
		if (typeof path !== "string" || !path || path.startsWith("/") || /[\\\0\r\n:]/.test(path) ||
			path.split("/").some(part => !part || part === "." || part === ".." || part.toLowerCase() === ".git") ||
			(!glob && /[*?\[\]{}]/.test(path))) throw new Error(`invalid ${field}: expected repository-relative path`);
		return path;
	});
}
function command(value: unknown, field: string): DerivedCommand {
	const entry = object(value, ["executable", "argv"], field);
	if (typeof entry.executable !== "string" || !entry.executable.trim() || /[\0\r\n]/.test(entry.executable))
		throw new Error(`invalid ${field}.executable`);
	if (!Array.isArray(entry.argv) || entry.argv.some(arg => typeof arg !== "string" || arg.includes("\0")))
		throw new Error(`invalid ${field}.argv`);
	return { executable: entry.executable, argv: entry.argv as string[] };
}
export function parseDerivedFiles(value: unknown): DerivedFile[] {
	const declaration = object(value, ["contract", "entries"], "derived_files");
	if (declaration.contract !== "immune_brain/derived_files/v1") throw new Error("invalid derived_files.contract");
	if (!Array.isArray(declaration.entries)) throw new Error("invalid derived_files.entries");
	const ids = new Set<string>();
	const outputs = new Set<string>();
	return declaration.entries.map((value, index) => {
		const field = `entries[${index}]`;
		const entry = object(value, ["id", "sources", "outputs", "generate", "check"], field);
		if (typeof entry.id !== "string" || !entry.id.trim() || ids.has(entry.id)) throw new Error(`invalid ${field}.id`);
		ids.add(entry.id);
		const declaredOutputs = paths(entry.outputs, `${field}.outputs`, false);
		for (const output of declaredOutputs) {
			if (outputs.has(output)) throw new Error(`invalid ${field}.outputs: duplicate output ${output}`);
			outputs.add(output);
		}
		return { id: entry.id, sources: paths(entry.sources, `${field}.sources`, true), outputs: declaredOutputs,
			generate: command(entry.generate, `${field}.generate`), check: command(entry.check, `${field}.check`) };
	});
}
export function readDerivedFiles(root: string): DerivedFile[] {
	try { return parseDerivedFiles(JSON.parse(readSecureProjectFile(root, DERIVED_FILES_PATH))); }
	catch (error) {
		if (error instanceof Error && error.message === `source_missing: ${DERIVED_FILES_PATH}`) return [];
		throw error;
	}
}
export function readDerivedFilesAt(root: string, commit: string): DerivedFile[] {
	const listed = spawnSync("git", ["-C", root, "ls-tree", "-z", commit, "--", DERIVED_FILES_PATH], { encoding: "utf8" });
	if (listed.status !== 0) throw new Error("cannot read frozen derived_files declaration");
	if (!listed.stdout) return [];
	if (!/^100(?:644|755) blob /.test(listed.stdout)) throw new Error("invalid derived_files: expected regular file");
	const shown = spawnSync("git", ["-C", root, "cat-file", "blob", `${commit}:${DERIVED_FILES_PATH}`], { encoding: "utf8" });
	if (shown.status !== 0) throw new Error("cannot read frozen derived_files declaration");
	return parseDerivedFiles(JSON.parse(shown.stdout));
}
export function runDerivedCommand(root: string, command: DerivedCommand, dependencyRoot = root): void {
	const result = spawnSync(command.executable, command.argv, { cwd: root, encoding: "utf8", timeout: 300000, maxBuffer: 131072,
		env: { ...process.env, NODE_PATH: [join(dependencyRoot, "node_modules"), process.env.NODE_PATH].filter(Boolean).join(delimiter) } });
	if (result.error || result.status !== 0 || result.signal)
		throw new Error(`derived command failed: ${command.executable} ${command.argv.join(" ")}`);
}
