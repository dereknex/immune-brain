import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("canonical and packaged dispatch protocol remain synchronized", () => {
	expect(read("plugins/immune-brain/dist/docs/reference/subagent-dispatch-protocol.md")).toBe(read("docs/reference/subagent-dispatch-protocol.md"));
});

test("dispatch contracts keep Role-only execution configuration ownership", () => {
	const required = [
		"Immune-Brain owns Role, evidence, authority, tool policy, and output contracts.",
		"Pi Host owns model, provider, and thinking defaults.",
		"Immune-Brain does not define\nmodel tiers, provider mapping, cost routing, or provider fallback.",
		"complete foreground `Agent` envelope",
		"without a verdict to apply those observed bytes; a provided verdict must match",
		"Dispatch/result correlation is part of the local authority",
	];
	for (const path of [
		"docs/reference/subagent-dispatch-protocol.md",
		"plugins/immune-brain/dist/docs/reference/subagent-dispatch-protocol.md",
	]) {
		const contract = read(path);
		for (const statement of required) expect(contract).toContain(statement);
	}
});

test("dispatch contracts name the native Claude route and keep the Pi boundary as prompt text", () => {
	const required = [
		"On the Claude Host a read-only internal role is dispatched through the `Agent`",
		"immune-brain:immune-brain-qa",
		"immune-brain:immune-brain-ui-review",
		"immune-brain:immune-brain-advisory-reviewer",
		"the Host's own read-only research agent",
		"The agent definition, not prompt text, bounds the role's tools",
		"On Pi the agent configuration belongs to the Pi user, and the read-only boundary",
		"remains prompt text plus the `tool_policy` the delegation packet declares",
	];
	for (const path of [
		"docs/reference/subagent-dispatch-protocol.md",
		"plugins/immune-brain/dist/docs/reference/subagent-dispatch-protocol.md",
	]) {
		const contract = read(path);
		for (const statement of required) expect({ path, statement: contract.includes(statement) }).toEqual({ path, statement: true });

		// Architecture exploration uses the Host's Explore agent and ships no
		// definition of its own.
		expect(contract).toContain("| `arch-explorer` | the Host's `Explore` agent |");
		expect(contract).not.toContain("immune-brain:immune-brain-arch-explorer");

		// Every shipped allowlist is read-only without shell: a write, shell or
		// dispatch tool in one would let a read-only role act.
		const allowlists = [...contract.matchAll(/^tools: (.+)$/gm)].map((m) => m[1].trim());
		const rows = [...contract.matchAll(/^\| `(qa|ui-review|advisory-reviewer)` \| `[^`]+` \| `(.+)` \|$/gm)];
		expect(rows.map((row) => row[2])).toEqual(["Read, Grep, Glob", "Read, Grep, Glob", "Read, Grep, Glob"]);
		for (const denied of ["Edit", "Write", "Bash", "Agent", "WebFetch"]) {
			expect({ denied, present: rows.some((row) => row[2].split(",").map((t) => t.trim()).includes(denied)) }).toEqual({ denied, present: false });
		}
		expect(allowlists).toEqual([]);

		// Existing Pi dispatch statements are unchanged.
		expect(contract).toContain("## Pi Agent Invocation");
		expect(contract).toContain('subagent_type: "general-purpose"');
		expect(contract).toContain("Pi `Agent` has no `readonly` parameter");
	}
});

test("interactive dispatch contracts are foreground-only and do not poll", () => {
	for (const path of [
		"plugins/immune-brain/.pi-extension/pi-canary-assurance-progression.ts",
	]) {
		const source = read(path);
		for (const forbidden of ["get_subagent_result", "setTimeout(", "setInterval(", "setStatus(", "setWidget(", "deliverFollowUp"]) expect(source).not.toContain(forbidden);
	}
});

test("canonical Loop contract describes direct QA and Parent-mediated Review verdict flow", () => {
	const contract = read("plugins/immune-brain/dist/drive.md");
	expect(contract).toContain("advance_assurance");
	expect(contract).toMatch(/foreground|前台/i);
	expect(contract).toMatch(/submit_review|structured verdict/);
	for (const statement of ["Provider quota", "Review budget exhaustion", "fresh QA", "recovery_action", "attestations[].advisory_findings"]) {
		expect(contract).toContain(statement);
	}
	const batch = read("plugins/immune-brain/dist/drive-batch.md");
	expect(batch).toContain("batch_lane_unreadable");
	expect(batch).toContain("Decisions and Recovery");
});

/**
 * S3 AC3 (Spec review-cli-stage D3-D7, D10, D12): the drive contracts run the
 * CLI reviewer, and only the advisory and verifier dispatches stay on Agents.
 */
describe("authority review cli contract", () => {
	const canonical = "docs/reference/subagent-dispatch-protocol.md";
	const mirrors = [
		"plugins/immune-brain/dist/docs/reference/subagent-dispatch-protocol.md",
		"plugins/immune-brain-antigravity/dist/docs/reference/subagent-dispatch-protocol.md",
	];

	test("the drive contracts run review_command and name the missing-profile stop", () => {
		for (const path of [
			"plugins/immune-brain/dist/drive.md",
			"plugins/immune-brain/dist/drive-batch.md",
			"plugins/immune-brain-antigravity/dist/drive.md",
			"plugins/immune-brain-antigravity/dist/drive-batch.md",
		]) {
			const contract = read(path);
			expect({ path, statement: contract.includes("review_command") }).toEqual({ path, statement: true });
			expect({ path, statement: contract.includes("review_profile_required") }).toEqual({ path, statement: true });
		}
	});

	test("the drive contract dispatches no reviewer Agent for authority Review", () => {
		const contract = read("plugins/immune-brain/dist/drive.md");
		expect(contract).not.toContain('subagent_type: "Review"');
	});

	test("the protocol names the authority-review skill and keeps advisory and verifier dispatch", () => {
		for (const path of [canonical, ...mirrors]) {
			const contract = read(path);
			expect(contract).toContain("authority-review");
			// Advisory dispatch keeps its Agent envelope.
			expect(contract).toContain('subagent_type: "general-purpose"');
			// Findings verification keeps its Host Agent dispatch.
			expect(contract).toContain("Findings verification returns a complete foreground `Agent` envelope");
		}
		for (const mirror of mirrors) expect(read(mirror)).toBe(read(canonical));
	});
});
