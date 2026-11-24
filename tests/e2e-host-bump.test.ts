// Weekly Host bump (Spec e2e-release-gate D3, S10-AC1): the script rewrites tests/e2e/hosts.json
// from registry versions, leaves a current file byte-identical, and the weekly workflow schedules
// it and opens a pull request.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bumpHosts, compareVersions, REGISTRY_PACKAGES, renderHosts, run } from "../scripts/bump-e2e-hosts";

const ROOT = resolve(import.meta.dir, "..");
const CURRENT = { claude: { pinned: "2.1.330", minimum: "2.1.330" }, pi: { pinned: "1.5.2" } };

describe("bumpHosts", () => {
	test("raises each pin to a newer registry version and never touches minimum", () => {
		const { next, changes } = bumpHosts(CURRENT, { claude: "2.2.0", pi: "1.5.10" });
		expect(next).toEqual({ claude: { pinned: "2.2.0", minimum: "2.1.330" }, pi: { pinned: "1.5.10" } });
		expect(changes).toEqual([
			{ host: "claude", from: "2.1.330", to: "2.2.0" },
			{ host: "pi", from: "1.5.2", to: "1.5.10" },
		]);
	});

	test("compares versions numerically, not lexically", () => {
		expect(compareVersions("1.5.10", "1.5.2")).toBe(1);
		expect(compareVersions("2.1.330", "2.1.330")).toBe(0);
		expect(compareVersions("1.9.9", "1.10.0")).toBe(-1);
	});

	test("a current or older registry version changes nothing", () => {
		expect(bumpHosts(CURRENT, { claude: "2.1.330", pi: "1.5.2" }).changes).toEqual([]);
		expect(bumpHosts(CURRENT, { claude: "2.1.329", pi: "1.4.0" }).changes).toEqual([]);
	});

	test("a pre-release registry version is refused instead of pinned", () => {
		expect(() => bumpHosts(CURRENT, { claude: "2.2.0-beta.1", pi: "1.5.2" })).toThrow("not a plain x.y.z version");
	});
});

describe("run", () => {
	const dir = mkdtempSync(join(tmpdir(), "imm-host-bump-"));
	afterAll(() => rmSync(dir, { recursive: true, force: true }));
	const stub = (versions: Record<string, string>) => async (name: string) => {
		const version = versions[name];
		if (!version) throw new Error(`unexpected registry lookup for ${name}`);
		return version;
	};
	const hostsFile = (name: string, content: string): string => {
		const path = join(dir, name);
		writeFileSync(path, content);
		return path;
	};

	test("rewrites hosts.json from stubbed registry versions", async () => {
		const path = hostsFile("bumped.json", renderHosts(CURRENT));
		const result = await run(stub({ [REGISTRY_PACKAGES.claude]: "2.1.400", [REGISTRY_PACKAGES.pi]: "1.6.0" }), path);
		expect(result.changed).toBe(true);
		expect(readFileSync(path, "utf8")).toBe('{\n\t"claude": {\n\t\t"pinned": "2.1.400",\n\t\t"minimum": "2.1.330"\n\t},\n\t"pi": {\n\t\t"pinned": "1.6.0"\n\t}\n}\n');
	});

	test("leaves the file byte-identical when versions are current, even if it is formatted differently", async () => {
		const original = '{ "claude": { "pinned": "2.1.330", "minimum": "2.1.330" }, "pi": { "pinned": "1.5.2" } }';
		const path = hostsFile("current.json", original);
		const result = await run(stub({ [REGISTRY_PACKAGES.claude]: "2.1.330", [REGISTRY_PACKAGES.pi]: "1.5.2" }), path);
		expect(result).toEqual({ changed: false, changes: [] });
		expect(readFileSync(path, "utf8")).toBe(original);
	});

	test("a registry failure leaves the file untouched and rejects", async () => {
		const original = renderHosts(CURRENT);
		const path = hostsFile("failed.json", original);
		await expect(run(stub({ [REGISTRY_PACKAGES.claude]: "2.2.0" }), path)).rejects.toThrow("unexpected registry lookup");
		expect(readFileSync(path, "utf8")).toBe(original);
	});

	test("the committed hosts.json already uses the rendered format", () => {
		const committed = readFileSync(join(ROOT, "tests/e2e/hosts.json"), "utf8");
		expect(renderHosts(JSON.parse(committed))).toBe(committed);
	});
});

describe("e2e-host-bump workflow", () => {
	type Step = { name?: string; id?: string; run?: string; if?: string; shell?: string; env?: Record<string, string> };
	const workflow = Bun.YAML.parse(readFileSync(join(ROOT, ".github/workflows/e2e-host-bump.yml"), "utf8")) as {
		on: { schedule?: { cron: string }[]; workflow_dispatch?: unknown };
		permissions: Record<string, string>;
		jobs: Record<string, { steps: Step[] }>;
	};
	const steps = Object.values(workflow.jobs).flatMap((job) => job.steps);
	const indexOf = (predicate: (step: Step) => boolean): number => steps.findIndex(predicate);

	test("runs weekly and on demand", () => {
		expect(workflow.on.schedule).toHaveLength(1);
		const fields = (workflow.on.schedule as { cron: string }[])[0].cron.split(/\s+/);
		expect(fields).toHaveLength(5);
		expect(fields.slice(2, 4)).toEqual(["*", "*"]);
		expect(/^[0-7]$/.test(fields[4])).toBe(true);
		expect("workflow_dispatch" in workflow.on).toBe(true);
	});

	test("bumps, installs the new Hosts and runs L1 before opening a pull request", () => {
		const bump = indexOf((step) => Boolean(step.run?.includes("scripts/bump-e2e-hosts.ts")));
		const install = indexOf((step) => Boolean(step.run?.includes("tests/e2e/hosts.json") && step.run.includes("npm install")));
		const journeys = indexOf((step) => step.run?.trim() === "bun run e2e");
		const pullRequest = indexOf((step) => Boolean(step.run?.includes("gh pr create")));
		expect(bump).toBeGreaterThanOrEqual(0);
		expect(install).toBeGreaterThan(bump);
		expect(journeys).toBeGreaterThan(install);
		expect(pullRequest).toBeGreaterThan(journeys);
	});

	test("a registry failure fails the bump step: its script is not piped, and any piped step runs under bash pipefail", () => {
		const bump = steps.find((step) => step.run?.includes("scripts/bump-e2e-hosts.ts")) as Step;
		expect(bump.shell).toBe("bash");
		expect(bump.run).not.toMatch(/scripts\/bump-e2e-hosts\.ts[^\n]*\|/);
		for (const step of steps.filter((candidate) => /[^|]\|[^|]/.test(candidate.run ?? ""))) expect(step.shell).toBe("bash");
	});

	test("only changed pins install, run L1 and open a pull request", () => {
		for (const step of steps.filter((candidate) => /npm install|bun run e2e|gh pr create/.test(candidate.run ?? ""))) {
			expect(step.if).toContain("steps.bump.outputs.changed == 'true'");
		}
	});

	test("may write branches and pull requests, nothing else", () => {
		expect(workflow.permissions).toEqual({ contents: "write", "pull-requests": "write" });
	});

	test("a failed L1 run still opens the pull request and then fails the job", () => {
		const journeys = steps.find((step) => step.run?.trim() === "bun run e2e") as Step & { "continue-on-error"?: boolean };
		expect(journeys["continue-on-error"]).toBe(true);
		expect(journeys.id).toBe("e2e");
		const last = steps[steps.length - 1];
		expect(last.if).toContain("steps.e2e.outcome == 'failure'");
		expect(last.run).toContain("exit 1");
	});
});
