import { snapshotDigest, type SnapshotDescriptor, type AssuranceVerdict } from "./coordinator";
import { runFixedVerification, VerificationAbortedError, type FrozenRunner, type VerificationDescriptor } from "./verification";
import { qaFindingId } from "./qa_findings";

export interface QaVerificationProgressInput {
	index: number;
	total: number;
	acceptance_id: string;
	phase: "running" | "passed" | "failed";
	elapsed_ms: number;
}

export async function runDeterministicQa(
	snapshot: SnapshotDescriptor,
	descriptors: Map<string, VerificationDescriptor>,
	runner: FrozenRunner,
	options: {
		signal?: AbortSignal;
		onProgress?: (progress: QaVerificationProgressInput) => void;
		runVerification?: typeof runFixedVerification;
	} = {},
): Promise<AssuranceVerdict> {
	if (snapshot.role !== "qa") throw new Error("deterministic QA requires qa role");
	if (options.signal?.aborted) throw new VerificationAbortedError();
	const findings: NonNullable<AssuranceVerdict["findings"]> = [];
	const runVerification = options.runVerification ?? runFixedVerification;
	for (const [offset, item] of snapshot.acceptance.entries()) {
		if (options.signal?.aborted) throw new VerificationAbortedError();
		const descriptor = descriptors.get(item.id);
		if (!descriptor) throw new Error(`verification descriptor missing for ${item.id}`);
		const startedAt = Date.now();
		options.onProgress?.({
			index: offset + 1,
			total: snapshot.acceptance.length,
			acceptance_id: item.id,
			phase: "running",
			elapsed_ms: 0,
		});
		const result = await runVerification(snapshot.root, descriptor, runner, {
			signal: options.signal,
		});
		if (options.signal?.aborted) throw new VerificationAbortedError();
		const failed = result.exit_code !== 0 || result.timed_out;
		options.onProgress?.({
			index: offset + 1,
			total: snapshot.acceptance.length,
			acceptance_id: item.id,
			phase: failed ? "failed" : "passed",
			elapsed_ms: Date.now() - startedAt,
		});
		if (failed) {
			// Findings become durable authority records; never include verifier output.
			findings.push({
				id: qaFindingId(item.id, snapshotDigest(snapshot)),
				kind: "blocking",
				acceptance_id: item.id,
				summary: `verification failed (exit ${result.exit_code}${result.timed_out ? ", timed out" : ""}) stdout=${Buffer.byteLength(result.stdout)}B stderr=${Buffer.byteLength(result.stderr)}B`,
				findings_digest: "",
			});
		}
	}
	if (findings.length > 0) {
		return {
			contract: "assurance_kernel/assurance_verdict/v2",
			role: "qa",
			task_id: snapshot.task_id,
			snapshot_digest: snapshotDigest(snapshot),
			decision: "rework",
			findings,
		};
	}
	return {
		contract: "assurance_kernel/assurance_verdict/v2",
		role: "qa",
		task_id: snapshot.task_id,
		snapshot_digest: snapshotDigest(snapshot),
		decision: "pass",
		approval: {
			kind: "qa",
			authority_role: "qa",
			summary: `all ${snapshot.acceptance.length} fixed verification descriptor(s) passed`,
		},
	};
}

