import { randomUUID } from "node:crypto";
import {
	commitEnrollmentPreconditions,
	commitUnbornEnrollmentPreconditions,
	initializeEnrollmentGitBase,
	inspectEnrollmentGitBase,
} from "../../plugins/immune-brain/runtime/assurance/enrollment_git_base";
import { LITERAL_USER_ACTOR_ID } from "../../plugins/immune-brain/runtime/kernel/actor_identity";
import {
	enrollmentScopeDisclosure,
	EnrollmentRehearsalError,
	enrollTask,
	singleTaskEnrollmentDirt,
} from "../../plugins/immune-brain/runtime/kernel/enrollment";
import {
	createEnrollmentAuthorityRegistry,
	type EnrollmentCapabilityBinding,
} from "../../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { readTaskIntent } from "../../plugins/immune-brain/runtime/kernel/intent";
import { preparePiCanary, revalidatePiCanary } from "../../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import { inspectSpecBinding } from "../../plugins/immune-brain/runtime/kernel/spec_binding";

/**
 * Test setup: enroll one TaskIntent at the Kernel, with no Host tool and no
 * native gate. Production enrolls only inside a Lane (drive-always-lanes D1,
 * D2, D10); this reproduces the Kernel steps of the retired in-place Enrollment
 * (workspace-clean check, git base, preparation, atomic commit) so tests that
 * need an active TaskRecord can reach one without a Host adapter.
 */
export async function enrollTaskForTest(
	cwd: string,
	taskId: string,
	options: { signal?: AbortSignal; now?: string; beforeCommit?: () => void } = {},
) {
	const now = options.now ?? new Date().toISOString();
	commitEnrollmentPreconditions(cwd, taskId, options.signal);
	let preparation = await preparePiCanary(cwd, { task_id: taskId, now });
	const intent = readTaskIntent(cwd, taskId);
	const gitBase = inspectEnrollmentGitBase(cwd);
	const disclosure = enrollmentScopeDisclosure(cwd, taskId);
	// The point where the retired Host gate waited for the user: tests mutate the workspace here to model drift.
	options.beforeCommit?.();
	if (gitBase.state !== "unborn" && inspectSpecBinding(intent.intent).ok) {
		const dirt = singleTaskEnrollmentDirt(cwd, intent.intent_ref.path, intent.intent);
		if (dirt.length > 0) throw new EnrollmentRehearsalError([`workspace_not_clean: ${dirt.join(", ")}`]);
	}
	const { unchanged } = await revalidatePiCanary(cwd, { task_id: taskId, now }, preparation);
	if (!unchanged) throw new Error("workspace changed after preparation");
	if (!preparation.intent) throw new Error("enrollment requires a readable TaskIntent");
	preparation = initializeEnrollmentGitBase(cwd, { task_id: taskId, now }, preparation, gitBase, options.signal);
	let claimedScopePaths: string[] = [];
	if (gitBase.state === "unborn") {
		const late = commitUnbornEnrollmentPreconditions(cwd, { task_id: taskId, now }, preparation, options.signal);
		preparation = late.preparation;
		claimedScopePaths = late.claimed_scope_paths;
	}
	if (!preparation.intent) throw new Error("Enrollment requires a readable TaskIntent");
	const binding: EnrollmentCapabilityBinding = {
		task_id: taskId,
		intent_path: preparation.intent.path,
		intent_revision: preparation.intent.revision,
		intent_content_hash: preparation.intent.content_hash,
		preparation_digest: preparation.digest,
		actor_id: LITERAL_USER_ACTOR_ID,
		confirmation_ref: `test-enrollment-${randomUUID().slice(0, 8)}`,
		nonce: randomUUID(),
	};
	return enrollTask(cwd, createEnrollmentAuthorityRegistry(), {
		binding,
		now,
		disclosed_scope_paths: [...disclosure.paths, ...claimedScopePaths],
	});
}
