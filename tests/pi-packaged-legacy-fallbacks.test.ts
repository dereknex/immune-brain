import { describe, expect, it } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SOURCE_POLICY = resolve(
	ROOT,
	"docs/reference/automatic-subagent-activation-policy.md",
);
const DIST_POLICY = resolve(
	ROOT,
	"plugins/immune-brain/dist/docs/reference/automatic-subagent-activation-policy.md",
);
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
	it("keeps the packaged activation reference generated from the source", () => {
		const source = readFileSync(SOURCE_POLICY, "utf8");
		const packaged = readFileSync(DIST_POLICY, "utf8");
		expect(source).toContain(
			"The policy inherits the split gate from\n`docs/specs/workflow-skill-subagent-orchestration.spec.md`:",
		);
		expect(packaged).toContain(
			"The policy inherits the split gate from the workflow skill subagent\norchestration spec in the source repository:",
		);
	});

	it("removes retired planner mutation and dispatcher fallbacks", () => {
		const planner = readFileSync(DIST_PLANNER, "utf8");
		expectRetiredGuidanceAbsent(planner, "imm-planner.md");
		expect(planner).toContain("imm-plan <plan-path> --json");
		expect(planner).toContain("imm-kernel intent author");
		expect(planner).toContain("/imm-canary-new");
		expect(planner).toContain("/imm-canary-enroll");
	});

	it("treats Compounder as post-closure learning capture", () => {
		const compounder = readFileSync(DIST_COMPOUNDER, "utf8");
		expectRetiredGuidanceAbsent(compounder, "imm-compounder.md");
		expect(compounder).toContain(
			"# Internal Compounder",
		);
	});

	it("describes static catalog-reference integrity", () => {
		const policy = readFileSync(SOURCE_POLICY, "utf8");
		expectRetiredGuidanceAbsent(
			policy,
			"automatic-subagent-activation-policy.md",
		);
		expect(policy).toContain(
			"Catalog `policy_ref`/`spec_ref` integrity is enforced by build and",
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
			const policy = readFileSync(
				join(
					pkgDir,
					"plugins/immune-brain/dist/docs/reference/automatic-subagent-activation-policy.md",
				),
				"utf8",
			);
			expectRetiredGuidanceAbsent(planner, "packed/imm-planner.md");
			expectRetiredGuidanceAbsent(compounder, "packed/imm-compounder.md");
			expectRetiredGuidanceAbsent(
				policy,
				"packed/automatic-subagent-activation-policy.md",
			);
			expect(planner).toContain("imm-kernel intent author");
			expect(compounder).toContain(
				"# Internal Compounder",
			);
			expect(policy).toContain(
				"Catalog `policy_ref`/`spec_ref` integrity is enforced by build and",
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
