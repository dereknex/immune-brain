import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { LITERAL_USER_ACTOR_ID } from "../../plugins/immune-brain/runtime/kernel/actor_identity";
import {
	enrollmentScopeDisclosure,
	enrollTask,
} from "../../plugins/immune-brain/runtime/kernel/enrollment";
import {
	createEnrollmentAuthorityRegistry,
	type EnrollmentCapabilityBinding,
} from "../../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { readTaskIntent } from "../../plugins/immune-brain/runtime/kernel/intent";
import { preparePiCanary } from "../../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import { inspectSpecBinding } from "../../plugins/immune-brain/runtime/kernel/spec_binding";

/**
 * Test setup: enroll one TaskIntent at the Kernel, with no Host tool and no
 * native gate. Production enrolls only inside a Lane (drive-always-lanes D1,
 * D2, D10); this reproduces the Lane's staging of planning inputs
 * (`copyLanePlanningInput`) and the Kernel Enrollment, so tests that need an
 * active TaskRecord can reach one without a Host adapter. Nothing is committed:
 * Enrollment records the user's HEAD as the task's Git base (ADR 0036).
 */
export async function enrollTaskForTest(cwd: string, taskId: string) {
	const now = new Date().toISOString();
	const read = readTaskIntent(cwd, taskId);
	const spec = inspectSpecBinding(read.intent);
	// A Lane skips a bound Spec it cannot read; a fixture may name one that is absent.
	const paths = [read.intent_ref.path, ...(spec.ok && spec.binding ? [spec.binding.active] : [])]
		.filter((path) => existsSync(join(cwd, path)));
	execFileSync("git", ["add", "--", ...paths], { cwd, stdio: ["ignore", "pipe", "pipe"] });
	const preparation = preparePiCanary(cwd, { task_id: taskId, now });
	const disclosure = enrollmentScopeDisclosure(cwd, taskId);
	if (!preparation.intent) throw new Error("enrollment requires a readable TaskIntent");
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
		disclosed_scope_paths: disclosure.paths,
	});
}
