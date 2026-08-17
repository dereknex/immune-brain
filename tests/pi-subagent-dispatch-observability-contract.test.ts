import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

describe("Pi subagent dispatch observability contract", () => {
	test("canonical and packaged protocol are byte-identical", () => {
		expect(read("plugins/immune-brain/dist/docs/reference/subagent-dispatch-protocol.md")).toBe(
			read("docs/reference/subagent-dispatch-protocol.md"),
		);
	});

	test("dispatch protocol requires background visibility and push completion", () => {
		const protocol = read("docs/reference/subagent-dispatch-protocol.md");
		expect(protocol).toContain("run_in_background: true");
		expect(protocol).toContain("250ms");
		expect(protocol).toContain("Footer/Widget");
		expect(protocol).toContain("telemetry unavailable");
		expect(protocol).toContain("snapshot/准备 30 秒");
		expect(protocol).toContain("`Agent` receipt 120 秒");
		expect(protocol).toContain("Quick 为 5 分钟 soft / 15 分钟 stop");
		expect(protocol).toContain("Soft expiry 只投影 `slow`");
		expect(protocol).toContain("不得轮询 `get_subagent_result`");
		expect(protocol).toContain("nested delegation 一律禁止");
		expect(protocol).toContain("恰好一个 primary reviewer");
		expect(protocol).toContain("turn 预算按 workload 缩放（Quick 12 / Standard 16 / Heavy 24）");
		expect(protocol).toContain("`neighborhood_files`（同状态机 context）");
		expect(protocol).toContain("`path_provenance` 明确标记每个 bundled path");
		expect(protocol).toContain("canonical `scope_hint` 内的 Git index");
		expect(protocol).toContain("terminal、cancellation、timeout 与 race path");
		expect(protocol).toContain("finding summary 必须以受影响的 bundle path 开头");
		expect(protocol).toContain("不存在从 initial dispatch 起算的单一端到端总预算");
		expect(protocol).toContain("Σ descriptor timeout + 2 分钟");
		expect(protocol).toContain("超过 60 分钟必须在首个 verifier 前拒绝");
		expect(protocol).toContain("跨 session advisory/tombstone persistence 属于后续独立切片");
		expect(protocol).toContain("不得自动重试");
		expect(protocol).not.toContain("Review 总预算为 300 秒");
		expect(protocol).toContain("最多两个相互独立的 advisory/discovery children");
		expect(protocol).toContain("`(task_id, operation_id, role)` 去重");
		expect(protocol).toContain("single-terminal CAS");
		expect(protocol).toContain("status 经显式 allowlist 验证为 terminal");
		expect(protocol).toContain("standard Agent 与 injected adapter result 各自与 host terminal receipt 保持独立");
		expect(protocol).toContain("绝不能用于 verdict parsing 或赋给 `hostTerminalReceipt`");
		expect(protocol).toContain("Pre-dispatch preparation failure/cancellation 只结束本地 startup lifecycle");
		expect(protocol).toContain("进入 `dispatch_unknown`、保留 immutable evidence 且不发布 terminal");
		expect(protocol).toContain("validated native failure status 必须作为该 resolved receipt 内的 failure payload");
		expect(protocol).toContain("Host receipt rejection 属于未验证 settlement");
		expect(protocol).toContain("helper 必须 reject、保留 ownership 与 immutable evidence");
		expect(protocol).toContain("late injected handle 也不得回退到 local result");
		expect(protocol).toContain("branded `native_terminal` receipt resolve");
	});

	test("Kernel routing contracts select automatic assurance without polling", () => {
		for (const path of [
			"plugins/immune-brain/skills/imm-canary-work/SKILL.md",
			"plugins/immune-brain/dist/imm-canary-work.md",
			"plugins/immune-brain/skills/imm-work/SKILL.md",
			"plugins/immune-brain/dist/imm-work.md",
			"plugins/immune-brain/skills/imm-loop/SKILL.md",
			"plugins/immune-brain/dist/imm-loop.md",
		]) {
			const contract = read(path);
			expect(contract).toContain("advance_assurance");
			expect(contract).toMatch(/follow-?up/i);
			expect(contract).toMatch(/poll|轮询/i);
		}
		const canary = read("plugins/immune-brain/dist/imm-canary-work.md");
		expect(canary).toContain("exactly one");
		expect(canary).toContain("30-second preparation");
		expect(canary).toContain("120-second standard `Agent` receipt");
		expect(canary).toContain("Quick is 5m soft/15m stop");
		expect(canary).toContain("60-minute maximum");
		expect(canary).not.toContain("300-second Review ceiling");
		expect(canary).toContain("literal-user confirmation");
		expect(canary).toContain("status is\n  validated as terminal");
		expect(canary).toContain("results use separate\n  host-created terminal deferreds");
		expect(canary).toContain("used for verdict parsing or assigned as terminal authority");
		expect(canary).toContain("preparation failure or cancellation remains local");
		expect(canary).toContain("enters `dispatch_unknown`, retains immutable evidence");
		expect(canary).toContain("failure status\n  resolves the branded host receipt with a failure payload");
		expect(canary).toContain("Host receipt rejection remains nonterminal");
		expect(canary).toContain("retains settlement ownership and immutable evidence");
		expect(canary).toContain("late injected handles never fall back to\n  local result");
		expect(canary).toContain("returns branded `native_terminal`");
		expect(canary).toContain("retain ownership on helper rejection");
		const sourceCanary = read("plugins/immune-brain/skills/imm-canary-work/SKILL.md");
		expect(sourceCanary).toContain("status is validated\nas terminal");
		expect(sourceCanary).toContain("results use separate host-created\nterminal deferreds");
		expect(sourceCanary).toContain("used for verdict\nparsing or assigned as terminal authority");
		expect(sourceCanary).toContain("preparation failure or cancellation remains local");
		expect(sourceCanary).toContain("enters\n`dispatch_unknown`, retains immutable evidence");
		expect(sourceCanary).toContain("failure status resolves the branded\nhost receipt with a failure payload");
		expect(sourceCanary).toContain("Host receipt\nrejection remains nonterminal");
		expect(sourceCanary).toContain("retains settlement ownership\nand immutable evidence");
		expect(sourceCanary).toContain("late injected handles never fall back to local result");
		expect(sourceCanary).toContain("returns branded `native_terminal`");
		expect(sourceCanary).toContain("retain\nownership on helper rejection");
	});

	test("runtime uses one push follow-up and keeps native telemetry honest", () => {
		const source = read("plugins/immune-brain/.pi-extension/imm-canary-work.ts");
		const progression = read("plugins/immune-brain/.pi-extension/pi-canary-assurance-progression.ts");
		const presenter = read("plugins/immune-brain/.pi-extension/pi-canary-assurance.ts");
		const nativeReview = read("plugins/immune-brain/.pi-extension/pi-canary-native-review.ts");
		// The lifecycle constants and review-pipeline vocabulary are owned by
		// the progression module (single source of truth); the adapter must not
		// re-define them or smuggle in a second runtime path.
		expect(progression).toContain("REVIEW_PREPARATION_TIMEOUT_MS = 30_000");
		expect(progression).toContain("REVIEW_DISPATCH_TIMEOUT_MS = 120_000");
		expect(progression).toContain("REVIEW_VERDICT_VALIDATION_TIMEOUT_MS = 30_000");
		expect(progression).toContain("REVIEW_TIMING_PROFILES");
		expect(progression).toContain("softDeadlineSeconds: 5 * 60");
		expect(progression).toContain("stopThresholdSeconds: 60 * 60");
		expect(progression).toContain("deriveQaJobTimeoutMs");
		expect(progression).toContain("reviewTurnBudget");
		expect(progression).toContain('case "quick": return 12');
		expect(progression).toContain('case "standard": return 16');
		expect(progression).toContain('case "heavy": return 24');
		expect(progression).toContain("STANDARD_AGENT_RESULT_TOOL");
		expect(progression).not.toContain("job.hostTerminalReceipt ?? job.handle.result");
		expect(progression).not.toContain("job.hostTerminalReceipt = job.handle.result");
		expect(progression).toContain("resolveHandleResult");
		expect(progression).toContain("resolveHostTerminal");
		expect(progression).toContain("const advisoryResult = job.hostTerminalReceipt");
		expect(progression).not.toContain("this.ports.startReview ? handle.result");
		expect(progression).toContain('settlement: "native_terminal"');
		expect(progression).toContain("const receipt = await terminal");
		expect(progression).not.toContain("await terminal.then(");
		expect(progression).toContain("terminalReceiptObserved");
		expect(nativeReview).toContain("semanticNeighborhoodReviewPrompt");
		expect(nativeReview).toContain("neighborhood_files entry");
		expect(nativeReview).toContain("path_provenance is authoritative");
		expect(nativeReview).toContain("terminal, cancellation, timeout, and race path");
		expect(nativeReview).toContain("Reference a bundle path at the start of each finding summary");
		expect(nativeReview).toContain("NATIVE_REVIEW_FAILURE_STATUSES.has(status)");
		expect(progression).toContain("native review cancellation remains unsettled");
		expect(nativeReview).toContain('["completed", "steered", "wrapped_up"]');
		expect(progression).not.toContain("subagents:rpc");
		expect(source).not.toContain("REVIEW_JOB_TIMEOUT_SECONDS = ");
		expect(source).not.toContain("REVIEW_SPAWN_TIMEOUT_MS = ");
		expect(source).not.toContain("subagents:rpc");
		expect(read("plugins/immune-brain/.pi-extension/pi-canary-native-review.ts")).toContain("get_subagent_result");
		expect(presenter).toContain("triggerTurn: true");
		expect(presenter).toContain('deliverAs: "followUp"');
		expect(presenter).toContain("native activity telemetry unavailable");
	});
});
