// Runs one provider command and collects its output. Shared by the session
// adapters so each keeps only its own command spelling and parsing.

import { spawn } from "node:child_process";

export interface ExecResult {
	code: number | null;
	stdout: string;
	stderr: string;
	/** The executable was not found. */
	missing?: boolean;
	/** The caller aborted the command and its process was terminated. */
	aborted?: boolean;
}

export type CommandExec = (command: string, args: string[], signal?: AbortSignal) => Promise<ExecResult>;

/** Runs a command; an aborted signal terminates it, so no waiting process outlives its caller. */
export function runCommand(env: Record<string, string | undefined>, command: string, args: string[], signal?: AbortSignal): Promise<ExecResult> {
	return new Promise(resolve => {
		let stdout = "";
		let stderr = "";
		let settled = false;
		if (signal?.aborted) { resolve({ code: null, stdout, stderr, aborted: true }); return; }
		const child = spawn(command, args, { env: env as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] });
		const abort = () => { child.kill("SIGTERM"); finish({ code: null, stdout, stderr, aborted: true }); };
		const finish = (result: ExecResult) => {
			if (settled) return;
			settled = true;
			signal?.removeEventListener("abort", abort);
			resolve(result);
		};
		signal?.addEventListener("abort", abort, { once: true });
		child.stdout.on("data", chunk => { stdout += chunk; });
		child.stderr.on("data", chunk => { stderr += chunk; });
		child.once("error", (error: NodeJS.ErrnoException) => finish({ code: null, stdout, stderr: stderr || error.message, missing: error.code === "ENOENT" }));
		child.once("close", code => finish({ code, stdout, stderr }));
	});
}

export function parseJson(text: string): unknown {
	try { return JSON.parse(text); } catch { return undefined; }
}

export function pick(value: unknown, path: string[]): unknown {
	let current = value;
	for (const key of path) {
		if (current === null || typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[key];
	}
	return current;
}

/** The first `x.y.z` in a version banner, or null. */
export function parseVersion(text: string): [number, number, number] | null {
	const match = /(\d+)\.(\d+)\.(\d+)/.exec(text);
	return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function versionAtLeast(version: [number, number, number], minimum: [number, number, number]): boolean {
	for (let index = 0; index < 3; index++) {
		if (version[index] !== minimum[index]) return version[index] > minimum[index];
	}
	return true;
}
