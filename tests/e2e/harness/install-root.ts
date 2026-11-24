// The tarball install root every journey runs from (Spec e2e-release-gate D2): the plugin
// is packed with `npm pack` exactly as it would publish, extracted into a temp root, and
// the Host loads the plugin directory from that extract. Black box: process boundaries only.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const REPO_ROOT = resolve(import.meta.dir, "../../..");

export interface InstallRoot {
	/** The temp directory that owns the tarball, the extract and every other journey scratch path. */
	root: string;
	tarball: string;
	/** The extracted package root (what npm would unpack into node_modules/immune-brain). */
	packageDir: string;
	/** The Claude Code plugin directory inside the extract: pass it to `claude --plugin-dir`. */
	claudePluginDir: string;
	/** The directory holding bin/imm-* from the extract. */
	binDir: string;
	cleanup(): void;
}

async function run(command: string[], cwd: string): Promise<string> {
	const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe", env: process.env });
	const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	if (code !== 0) throw new Error(`${command.join(" ")} exited ${code}: ${stderr.trim() || stdout.trim()}`);
	return stdout;
}

/** Fails when a checked-in built plugin directory no longer matches its sources. */
export async function assertBuiltPluginsCurrent(): Promise<void> {
	for (const script of ["scripts/build-claude-plugin.ts", "scripts/build-antigravity-plugin.ts"]) {
		try {
			await run(["bun", script, "--check"], REPO_ROOT);
		} catch (error) {
			throw new Error(`plugin_build_stale: ${script} --check failed: ${(error as Error).message}`);
		}
	}
}

/** Packs the repository once and extracts it into a fresh temp root. */
export async function createInstallRoot(): Promise<InstallRoot> {
	await assertBuiltPluginsCurrent();
	const root = mkdtempSync(join(tmpdir(), "imm-e2e-"));
	try {
		const packed = JSON.parse(await run(["npm", "pack", "--ignore-scripts", "--json", "--pack-destination", root], REPO_ROOT)) as Array<{ filename: string }>;
		const tarball = join(root, packed[0].filename);
		const extract = join(root, "extract");
		await run(["mkdir", "-p", extract], root);
		await run(["tar", "-xzf", tarball, "-C", extract], root);
		const packageDir = join(extract, "package");
		const claudePluginDir = join(packageDir, "plugins/immune-brain");
		for (const required of [".claude-plugin/plugin.json", ".mcp.json", "dist/claude/mcp-server.mjs", "bin/imm-kernel"]) {
			if (!existsSync(join(claudePluginDir, required))) throw new Error(`install_root_incomplete: the packed tarball lacks plugins/immune-brain/${required}`);
		}
		return { root, tarball, packageDir, claudePluginDir, binDir: join(claudePluginDir, "bin"), cleanup: () => rmSync(root, { recursive: true, force: true }) };
	} catch (error) {
		rmSync(root, { recursive: true, force: true });
		throw error;
	}
}
