// P2B2 mutation authority consumption port. NOT exported from kernel/index.ts.
// Uses the shared capability registry factory; mutation-specific binding
// validation, action digest, findings digest enforcement, and projection
// remain here.

import { createHash } from "node:crypto";

import {
	MUTATION_AUTHORITY_CAPABILITY_BRAND,
	type AuthorityAuditDescriptor,
	type MutationAuthorityCapabilityV2,
	type MutationAuthorityKind,
	type TaskAction,
} from "./types";
import { createCapabilityRegistry } from "./capability_registry";

export interface CapabilityBindingV2 {
	authority_kind: MutationAuthorityKind;
	task_id: string;
	action_digest: string;
	expected_record_hash: string;
	intent_revision: number;
	intent_content_hash: string;
	diff_hash: string;
	actor_id: string;
	confirmation_ref: string;
	expires_at: string;
	/** Normalized findings digest required for request_rework; null for other operations. */
	findings_digest: string | null;
}

export interface ValidatedAuthorityV2 {
	audit: AuthorityAuditDescriptor;
	action_digest: string;
	expected_record_hash: string;
	intent_revision: number;
	intent_content_hash: string;
	diff_hash: string;
	task_id: string;
}

export interface MutationAuthorityInspection {
	task_id: string;
	action: TaskAction;
	expected_record_hash: string;
	intent_revision: number;
	intent_content_hash: string;
	diff_hash: string;
	/** Present only for request_rework bindings. */
	findings_digest?: string;
}

export interface MutationAuthorityRegistry {
	readonly brand: symbol;
	/** Issue one capability bound to an exact binding. Library primitive; no production caller in P2B2. */
	issue(binding: CapabilityBindingV2, issuedAt?: string): MutationAuthorityCapabilityV2;
	/** Inspect without consuming. Fails on missing, expired, mismatched, or reused capability. */
	inspect(
		capability: MutationAuthorityCapabilityV2 | undefined,
		expected: MutationAuthorityInspection,
		now?: number,
	): ValidatedAuthorityV2;
	/** Consume irreversibly. Returns the validated authority. */
	consume(
		capability: MutationAuthorityCapabilityV2,
		expected: MutationAuthorityInspection,
		now?: number,
	): ValidatedAuthorityV2;
	isConsumed(capability: MutationAuthorityCapabilityV2): boolean;
}

export function digestOfAction(action: TaskAction): string {
	const { expected_record_hash: _r, expected_workspace_hash: _w, diff_hash: _d, ...rest } = action;
	return createHash("sha256")
		.update(JSON.stringify(rest))
		.digest("hex");
}

export function createMutationAuthorityRegistry(): MutationAuthorityRegistry {
	const inner = createCapabilityRegistry<CapabilityBindingV2, MutationAuthorityInspection, ValidatedAuthorityV2, MutationAuthorityCapabilityV2>(
		MUTATION_AUTHORITY_CAPABILITY_BRAND,
		{
			validateBinding(binding, issuedAt) {
				const missing: string[] = [];
				for (const [key, value] of Object.entries(binding)) {
					if (key === "findings_digest") continue;
					if (value === undefined || value === null || value === "") missing.push(key);
				}
				if (missing.length > 0)
					throw new Error(`authority capability binding is incomplete: ${missing.join(", ")}`);
				if (binding.findings_digest !== null && !/^sha256:[a-f0-9]{64}$/.test(binding.findings_digest))
					throw new Error("authority capability findings_digest must be a canonical sha256 hash");
				if (Number.isNaN(Date.parse(binding.expires_at)) || Date.parse(binding.expires_at) <= Date.parse(issuedAt))
					throw new Error("authority capability must have a future expiry");
			},
			validateAndProject(state, expected, now) {
				if (Date.parse(state.expires_at) <= now)
					throw new Error("authority capability has expired");
				const actionDigest = digestOfAction(expected.action);
				if (state.action_digest !== actionDigest)
					throw new Error("authority capability action digest mismatch");
				if (state.task_id !== expected.task_id)
					throw new Error("authority capability task mismatch");
				if (state.expected_record_hash !== expected.expected_record_hash)
					throw new Error("authority capability record hash mismatch");
				if (state.intent_revision !== expected.intent_revision)
					throw new Error("authority capability intent revision mismatch");
				if (state.intent_content_hash !== expected.intent_content_hash)
					throw new Error("authority capability intent hash mismatch");
				if (state.diff_hash !== expected.diff_hash)
					throw new Error("authority capability diff hash mismatch");
				if (expected.findings_digest !== undefined) {
					if (state.findings_digest === null)
						throw new Error("authority capability is not bound to findings");
					if (state.findings_digest !== expected.findings_digest)
						throw new Error("authority capability findings digest mismatch");
				}
				return {
					audit: {
						authority_kind: state.authority_kind,
						actor_id: state.actor_id,
						confirmation_ref: state.confirmation_ref,
						issued_at: state.issued_at,
						expires_at: state.expires_at,
					},
					action_digest: actionDigest,
					expected_record_hash: state.expected_record_hash,
					intent_revision: state.intent_revision,
					intent_content_hash: state.intent_content_hash,
					diff_hash: state.diff_hash,
					task_id: state.task_id,
				};
			},
		},
		"authority",
	);

	return {
		brand: inner.brand,
		issue: inner.issue.bind(inner),
		inspect(
			capability: MutationAuthorityCapabilityV2 | undefined,
			expected: MutationAuthorityInspection,
			now = Date.now(),
		): ValidatedAuthorityV2 {
			if (!capability)
				throw new Error("privileged action requires an opaque authority capability");
			try {
				return inner.inspect(capability, expected, now);
			} catch (err) {
				if (err instanceof Error && err.message.includes("not recognized by this registry"))
					throw new Error("privileged action requires an opaque authority capability");
				throw err;
			}
		},
		consume(
			capability: MutationAuthorityCapabilityV2,
			expected: MutationAuthorityInspection,
			now = Date.now(),
		): ValidatedAuthorityV2 {
			try {
				return inner.consume(capability, expected, now);
			} catch (err) {
				if (err instanceof Error && err.message.includes("not recognized by this registry"))
					throw new Error("privileged action requires an opaque authority capability");
				throw err;
			}
		},
		isConsumed: inner.isConsumed.bind(inner),
	};
}
