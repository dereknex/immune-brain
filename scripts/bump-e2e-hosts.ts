// Weekly Host bump (Spec e2e-release-gate D3, S10-AC1): rewrite tests/e2e/hosts.json to the
// latest published `claude` and `pi` versions.
//
// The weekly workflow runs `bun scripts/bump-e2e-hosts.ts`; when it changes the file, the workflow
// opens a pull request and runs L1 against the new versions. The script only ever raises
// `claude.pinned` and `pi.pinned`: `claude.minimum` is the supported floor and is never touched,
// and a registry version that is not newer than the pin leaves the file byte-identical.
// `bumpHosts` and `renderHosts` are the pure steps; `run` takes the registry lookup so tests stub it.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const HOSTS_PATH = resolve(import.meta.dir, "../tests/e2e/hosts.json");
export const REGISTRY_PACKAGES = { claude: "@anthropic-ai/claude-code", pi: "@earendil-works/pi-coding-agent" } as const;

export interface HostPins {
	claude: { pinned: string; minimum: string };
	pi: { pinned: string };
}
export type HostName = keyof typeof REGISTRY_PACKAGES;
export type LatestVersions = Record<HostName, string>;
export interface HostChange {
	host: HostName;
	from: string;
	to: string;
}

const RELEASE = /^(\d+)\.(\d+)\.(\d+)$/;

/** Compares two plain `x.y.z` versions; a pre-release or malformed value is not comparable and throws. */
export function compareVersions(a: string, b: string): number {
	const left = RELEASE.exec(a);
	const right = RELEASE.exec(b);
	if (!left || !right) throw new Error(`not a plain x.y.z version: ${left ? b : a}`);
	for (let i = 1; i <= 3; i++) {
		const diff = Number(left[i]) - Number(right[i]);
		if (diff) return diff < 0 ? -1 : 1;
	}
	return 0;
}

/** Raises each pin to its latest version when that is strictly newer; returns the new pins and what moved. */
export function bumpHosts(current: HostPins, latest: LatestVersions): { next: HostPins; changes: HostChange[] } {
	const next: HostPins = { claude: { ...current.claude }, pi: { ...current.pi } };
	const changes: HostChange[] = [];
	for (const host of Object.keys(REGISTRY_PACKAGES) as HostName[]) {
		const from = current[host].pinned;
		const to = latest[host];
		if (compareVersions(to, from) > 0) {
			next[host].pinned = to;
			changes.push({ host, from, to });
		}
	}
	return { next, changes };
}

/** The file format hosts.json already uses: tab-indented JSON with a trailing newline. */
export const renderHosts = (pins: HostPins): string => `${JSON.stringify(pins, null, "\t")}\n`;

export type VersionLookup = (packageName: string) => Promise<string>;

/** Reads the `latest` dist-tag of an npm package from the public registry. */
export const registryLookup: VersionLookup = async (packageName) => {
	const response = await fetch(`https://registry.npmjs.org/${packageName.replace("/", "%2F")}/latest`, { headers: { accept: "application/json" } });
	if (!response.ok) throw new Error(`registry lookup for ${packageName} failed: HTTP ${response.status}`);
	const version = ((await response.json()) as { version?: unknown }).version;
	if (typeof version !== "string") throw new Error(`registry lookup for ${packageName} returned no version`);
	return version;
};

export interface BumpResult {
	changed: boolean;
	changes: HostChange[];
}

/** Bumps the file at `path`; it is rewritten only when a pin moves, so a current file stays byte-identical. */
export async function run(lookup: VersionLookup = registryLookup, path: string = HOSTS_PATH): Promise<BumpResult> {
	const current = JSON.parse(readFileSync(path, "utf8")) as HostPins;
	const [claude, pi] = await Promise.all([lookup(REGISTRY_PACKAGES.claude), lookup(REGISTRY_PACKAGES.pi)]);
	const { next, changes } = bumpHosts(current, { claude, pi });
	if (changes.length) writeFileSync(path, renderHosts(next));
	return { changed: changes.length > 0, changes };
}

if (import.meta.main) {
	try {
		const { changed, changes } = await run();
		if (!changed) console.log("e2e hosts: pins are current, tests/e2e/hosts.json unchanged");
		for (const change of changes) console.log(`e2e hosts: ${change.host} ${change.from} -> ${change.to}`);
	} catch (error) {
		console.error(`e2e hosts: ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	}
}
