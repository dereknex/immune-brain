import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { currentReviewContractHash } from "../../plugins/immune-brain/runtime/role_prompt_bridge.ts";
import { evaluateCases, writeRunArtifact } from "./run.ts";

const stamp = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const model = process.argv[3] ?? "nextty/codex/gpt-6.1-sol";
const sample = Number(process.argv[4] ?? 2);
if (!Number.isSafeInteger(sample) || sample < 1) throw new Error("sample must be a positive integer");
const corpusPath = "tests/fixtures/review-eval/corpus.jsonl";
const rolePrompt = "plugins/immune-brain/runtime/prompts/code-review.md";
const corpusBytes = readFileSync(corpusPath, "utf8");
const all = corpusBytes.trim().split("\n").map((line) => JSON.parse(line));
if (all.some((item: { gold: string }) => item.gold !== "unlabeled")) throw new Error("restricted baseline requires an unlabelled corpus; use run.ts for labelled cases");
const selected = all.filter((item: { clean: boolean }) => item.clean).slice(0, sample);
const reviewContractHash = currentReviewContractHash();
const started = Date.now();
const result = evaluateCases(".", selected, { model, rolePrompt: readFileSync(rolePrompt, "utf8") });
const gold = all.filter((item: { gold: string }) => item.gold !== "unlabeled").length;
const clean = all.filter((item: { clean: boolean }) => item.clean).length;

writeRunArtifact("benchmark-results/review-eval", `${stamp}-${model.split("/").at(-1)!}`, {
	contract: "immune_brain/review_eval_run/v1",
	created_at: new Date().toISOString(),
	config: { model, role_prompt: rolePrompt },
	corpus: corpusPath,
	corpus_sha256: `sha256:${createHash("sha256").update(corpusBytes).digest("hex")}`,
	review_contract_sha256: reviewContractHash,
	corpus_cases: all.length,
	gold_labeled: gold,
	sampling: { rule: `first ${sample} clean cases in corpus order`, selected: selected.length, of_clean: clean },
	channel: "offline reviewer replay in an isolated checkout; no live Kernel state, no Managed role, no TaskRecord",
	restriction: `${gold} of ${all.length} corpus cases carry a human gold label, so recall and confirmed-false matching are unmeasured and only the clean-case FP rate is measured; the baseline cannot supply the recall half of the merge gate.`,
	elapsed_ms: Date.now() - started,
	retried_after_termination: result.retries,
	cases: result.cases,
	scores: result.scores,
});
process.stdout.write(`${JSON.stringify({ model, elapsed_ms: Date.now() - started, scores: result.scores })}\n`);
