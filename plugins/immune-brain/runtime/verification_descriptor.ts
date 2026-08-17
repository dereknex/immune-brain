// Shared verification_descriptor/v1 pure parser.
//
// The complete `acceptance[].verification` string of a TaskIntent is accepted
// only as strict canonical JSON for `assurance_kernel/verification_descriptor/v1`.
// Never execute free text, an executable path, a shell string, PATH lookup,
// environment overrides, or a cwd outside the repository. The production runner
// registry contains only the host-resolved `bun` runner.
//
// This module is the single parser implementation for the wire contract. Pi
// assurance (`.pi-extension/pi-canary-verification.ts`) re-exports it and keeps
// runner resolution/execution extension-owned. Kernel intent author/validate
// consume the same implementation, so the two consumers cannot drift.
//
// JSON whitespace and key ordering are NOT eligibility conditions: parsing is
// whitespace/order-insensitive. `canonicalDescriptorBytes` produces the
// deterministic bytes that Planner authoring binds.

import { isAbsolute, sep } from "node:path";

export const VERIFICATION_DESCRIPTOR_CONTRACT =
	"assurance_kernel/verification_descriptor/v1" as const;

export interface VerificationDescriptor {
	contract: typeof VERIFICATION_DESCRIPTOR_CONTRACT;
	runner_id: "bun";
	runner_version: string;
	argv: string[];
	cwd: string;
	timeout_ms: number;
	max_output_bytes: number;
}

const DESCRIPTOR_FIELDS = [
	"contract",
	"runner_id",
	"runner_version",
	"argv",
	"cwd",
	"timeout_ms",
	"max_output_bytes",
] as const;

const MAX_ARGV_TOKENS = 64;
const MAX_ARGV_TOKEN_BYTES = 512;
const MAX_CWD_DEPTH = 32;
const MAX_TIMEOUT_MS = 600_000;
const MAX_OUTPUT_BYTES = 262_144;

export class VerificationDescriptorError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "VerificationDescriptorError";
	}
}

/** Parse the complete verification string as strict canonical JSON. */
export function parseVerificationDescriptor(text: string): VerificationDescriptor {
	const trimmed = text.trim();
	if (!trimmed) throw new VerificationDescriptorError("verification string is empty");
	let raw: Record<string, unknown>;
	try {
		raw = JSON.parse(trimmed) as Record<string, unknown>;
	} catch {
		throw new VerificationDescriptorError("verification string is not valid JSON");
	}
	const unknown = Object.keys(raw).filter((key) => !DESCRIPTOR_FIELDS.includes(key as never));
	if (unknown.length > 0)
		throw new VerificationDescriptorError(`verification descriptor has unknown field: ${unknown[0]}`);
	if (raw.contract !== VERIFICATION_DESCRIPTOR_CONTRACT)
		throw new VerificationDescriptorError("verification descriptor contract is invalid");
	if (raw.runner_id !== "bun")
		throw new VerificationDescriptorError(
			`verification runner must be bun; got ${String(raw.runner_id)}`,
		);
	if (typeof raw.runner_version !== "string" || !raw.runner_version.trim())
		throw new VerificationDescriptorError("verification runner_version is invalid");
	if (!Array.isArray(raw.argv) || raw.argv.length === 0)
		throw new VerificationDescriptorError("verification argv must be a non-empty array");
	if (raw.argv.length > MAX_ARGV_TOKENS)
		throw new VerificationDescriptorError("verification argv exceeds the token bound");
	for (const token of raw.argv) {
		if (typeof token !== "string" || !token.trim())
			throw new VerificationDescriptorError("verification argv tokens must be non-empty strings");
		if (Buffer.byteLength(token) > MAX_ARGV_TOKEN_BYTES)
			throw new VerificationDescriptorError("verification argv token exceeds the byte bound");
		if (/[\x00-\x1f\x7f]/.test(token))
			throw new VerificationDescriptorError("verification argv token contains control characters");
		if (
			token.includes("..") ||
			token.includes("\\") ||
			token.startsWith("/") ||
			token.startsWith("~") ||
			token.includes("$") ||
			token.includes(";") ||
			token.includes("&") ||
			token.includes("|") ||
			token.includes(">") ||
			token.includes("<") ||
			token.includes("`") ||
			token.includes("*") ||
			token.includes("?") ||
			token.includes("[") ||
			token.includes("]") ||
			token.includes("{") ||
			token.includes("}") ||
			token.includes("(") ||
			token.includes(")") ||
			token.includes(" ") ||
			token.includes("\t")
		)
			throw new VerificationDescriptorError(
				`verification argv token is not a safe literal: ${token}`,
			);
	}
	if (typeof raw.cwd !== "string" || !raw.cwd.trim())
		throw new VerificationDescriptorError("verification cwd is invalid");
	if (isAbsolute(raw.cwd) || raw.cwd.includes("\\"))
		throw new VerificationDescriptorError("verification cwd must be repository-relative");
	if (raw.cwd === ".." || raw.cwd.startsWith(`..${sep}`) || raw.cwd.split(sep).includes(".."))
		throw new VerificationDescriptorError("verification cwd escapes the repository");
	if (raw.cwd.split(sep).filter(Boolean).length > MAX_CWD_DEPTH)
		throw new VerificationDescriptorError("verification cwd exceeds the depth bound");
	if (typeof raw.timeout_ms !== "number" || !Number.isFinite(raw.timeout_ms) || raw.timeout_ms < 1)
		throw new VerificationDescriptorError("verification timeout_ms must be a finite positive integer");
	if (!Number.isInteger(raw.timeout_ms) || raw.timeout_ms > MAX_TIMEOUT_MS)
		throw new VerificationDescriptorError("verification timeout_ms exceeds the host ceiling");
	if (
		typeof raw.max_output_bytes !== "number" ||
		!Number.isFinite(raw.max_output_bytes) ||
		raw.max_output_bytes < 1
	)
		throw new VerificationDescriptorError(
			"verification max_output_bytes must be a finite positive integer",
		);
	if (!Number.isInteger(raw.max_output_bytes) || raw.max_output_bytes > MAX_OUTPUT_BYTES)
		throw new VerificationDescriptorError(
			"verification max_output_bytes exceeds the host ceiling",
		);
	return {
		contract: VERIFICATION_DESCRIPTOR_CONTRACT,
		runner_id: "bun",
		runner_version: raw.runner_version,
		argv: raw.argv as string[],
		cwd: raw.cwd,
		timeout_ms: raw.timeout_ms,
		max_output_bytes: raw.max_output_bytes,
	};
}

/** Canonical bytes of the parsed descriptor (for digest binding). */
export function canonicalDescriptorBytes(descriptor: VerificationDescriptor): string {
	return `${JSON.stringify(descriptor, null, 2)}\n`;
}

/** Re-exported bounds for host-side consistency checks. */
export const VERIFICATION_DESCRIPTOR_BOUNDS = {
	max_arg_tokens: MAX_ARGV_TOKENS,
	max_arg_token_bytes: MAX_ARGV_TOKEN_BYTES,
	max_cwd_depth: MAX_CWD_DEPTH,
	max_timeout_ms: MAX_TIMEOUT_MS,
	max_output_bytes: MAX_OUTPUT_BYTES,
} as const;
