import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname } from "node:path";

function git(root: string, ...args: string[]): string | null {
	try {
		return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return null;
	}
}

export function projectIdentity(root: string): string {
	const origin = git(root, "remote", "get-url", "origin");
	if (origin) {
		let host: string;
		let path: string;
		try {
			const url = new URL(origin);
			host = url.hostname.toLowerCase();
			path = url.pathname;
			if (!host) throw new Error("missing host");
		} catch {
			const match = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(origin);
			if (!match) throw new Error("origin URL is not supported");
			host = match[1].toLowerCase();
			path = match[2];
		}
		return `${host}/${path.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "")}`;
	}
	const common = git(root, "rev-parse", "--path-format=absolute", "--git-common-dir");
	return realpathSync(common ? dirname(common) : root);
}
