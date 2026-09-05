import { describe, expect, it } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const RETIRED_PACKAGED_ACTIVATION = [
	"plugins/immune-brain/dist/docs/specs/automatic-subagent-activation.spec.md",
	"plugins/immune-brain/dist/docs/reference/automatic-subagent-activation-policy.md",
	"plugins/immune-brain/dist/docs/reference/review-host-dispatch-protocol.md",
	"plugins/immune-brain/dist/docs/reference/subagent-trigger-catalog.yaml",
] as const;
const DIST_PLANNER = resolve(ROOT, "plugins/immune-brain/dist/imm-planner.md");
const DIST_COMPOUNDER = resolve(
	ROOT,
	"plugins/immune-brain/dist/role-prompts/compounder.md",
);
const LEGACY_RUNTIME = "runtime/immune_brain_runtime.ts";
const RETIRED_COMMANDS = [
	"imm-plan --sync",
	"imm_plan_validate(sync=true)",
	"imm-finish",
	"imm-heal",
	"imm-activation-plan",
];

function extractTarball(): { dir: string; pkgDir: string } {
	const dir = mkdtempSync(join(tmpdir(), "r4-packaged-fallbacks-"));
	const result = spawnSync(
		"npm",
		["pack", "--silent", "--pack-destination", dir],
		{
			cwd: ROOT,
			encoding: "utf8",
			timeout: 300_000,
		},
	);
	if (result.status !== 0) {
		throw new Error(`npm pack failed: ${result.stderr || result.stdout}`);
	}
	const name = result.stdout.trim().split("\n").pop() ?? "";
	execFileSync("tar", ["-xzf", join(dir, name), "-C", dir], {
		stdio: "ignore",
	});
	return { dir, pkgDir: join(dir, "package") };
}

function expectRetiredGuidanceAbsent(content: string, path: string): void {
	expect({ path, hasLegacyRuntime: content.includes(LEGACY_RUNTIME) }).toEqual({
		path,
		hasLegacyRuntime: false,
	});
	for (const token of RETIRED_COMMANDS) {
		expect({ path, token, present: content.includes(token) }).toEqual({
			path,
			token,
			present: false,
		});
	}
}

describe("packaged legacy CLI fallbacks", () => {
	it("keeps retired activation references out of the current package surface", () => {
		expect(
			existsSync(resolve(ROOT, "docs/archives/automatic-subagent-activation-policy.md")),
		).toBe(true);
		for (const rel of RETIRED_PACKAGED_ACTIVATION)
			expect({ rel, present: existsSync(resolve(ROOT, rel)) }).toEqual({
				rel,
				present: false,
			});
	});

	it("removes retired planner mutation and dispatcher fallbacks", () => {
		const planner = readFileSync(DIST_PLANNER, "utf8");
		expectRetiredGuidanceAbsent(planner, "imm-planner.md");
		expect(planner).toContain("Historical prose Plans are read-only artifacts");
		expect(planner).toContain("imm-kernel intent author");
		expect(planner).toContain("current Host's native Enrollment");
		expect(planner).not.toContain("imm_canary_enrollment");
		expect(planner).not.toContain("/imm-canary-new");
		expect(planner).not.toContain("/imm-canary-enroll");
	});

	it("treats Compounder as post-closure learning capture", () => {
		const compounder = readFileSync(DIST_COMPOUNDER, "utf8");
		expectRetiredGuidanceAbsent(compounder, "imm-compounder.md");
		expect(compounder).toContain(
			"# Internal Compounder",
		);
	});

	it("ships the corrected contracts in a real npm pack artifact", () => {
		const { dir, pkgDir } = extractTarball();
		try {
			const planner = readFileSync(
				join(pkgDir, "plugins/immune-brain/dist/imm-planner.md"),
				"utf8",
			);
			const compounder = readFileSync(
				join(pkgDir, "plugins/immune-brain/dist/role-prompts/compounder.md"),
				"utf8",
			);
			for (const rel of RETIRED_PACKAGED_ACTIVATION)
				expect({ rel, present: existsSync(join(pkgDir, rel)) }).toEqual({
					rel,
					present: false,
				});
			expectRetiredGuidanceAbsent(planner, "packed/imm-planner.md");
			expectRetiredGuidanceAbsent(compounder, "packed/imm-compounder.md");
			expect(planner).toContain("current Host's native Enrollment");
			expect(planner).not.toContain("imm_canary_enrollment");
			expect(planner).not.toContain("/imm-canary-new");
			expect(planner).not.toContain("/imm-canary-enroll");
			expect(compounder).toContain(
				"# Internal Compounder",
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
