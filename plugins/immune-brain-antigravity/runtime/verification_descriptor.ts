// One host-neutral parser for project-owned verification. Historical TaskRecords
// retain their verification strings; only v2 descriptors are executable.
import { isAbsolute } from "node:path";

export const VERIFICATION_DESCRIPTOR_CONTRACT = "assurance_kernel/verification_descriptor/v2" as const;
export const VERIFICATION_DESCRIPTOR_BOUNDS = {
	max_arg_tokens: 64,
	max_arg_token_bytes: 512,
	max_cwd_depth: 32,
	max_timeout_ms: 600_000,
	max_output_bytes: 262_144,
	max_descriptor_bytes: 65_536,
	max_writable_paths: 32,
} as const;

export interface VerificationCommand {
	executable: string;
	argv: string[];
	cwd: string;
	timeout_ms: number;
	max_output_bytes: number;
}
export interface VerificationEnvironment {
	prepare: VerificationCommand | null;
	writable_paths: string[];
}
export interface VerificationDescriptor {
	contract: typeof VERIFICATION_DESCRIPTOR_CONTRACT;
	command: VerificationCommand;
	environment: VerificationEnvironment;
}

export class VerificationDescriptorError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "VerificationDescriptorError";
	}
}

function object(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new VerificationDescriptorError(`${label} must be an object`);
	const raw = value as Record<string, unknown>;
	if (Object.keys(raw).some(key => !fields.includes(key)))
		throw new VerificationDescriptorError(`${label} has an unknown field`);
	return raw;
}

export function verificationRelativePath(value: unknown, label: string): string {
	if (typeof value !== "string" || !value || value.length > 512 || /[\x00-\x1f\x7f\\]/.test(value)
		|| isAbsolute(value) || value.startsWith("~") || value.split("/").includes("..")
		|| value.split("/").includes(".git") || value.split("/").length > VERIFICATION_DESCRIPTOR_BOUNDS.max_cwd_depth)
		throw new VerificationDescriptorError(`${label} must stay inside the repository`);
	return value.split("/").filter(part => part && part !== ".").join("/") || ".";
}

function bound(value: unknown, max: number, label: string): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max)
		throw new VerificationDescriptorError(`${label} exceeds the host bound`);
	return value;
}

function command(value: unknown): VerificationCommand {
	const raw = object(value, ["executable", "argv", "cwd", "timeout_ms", "max_output_bytes"], "verification command");
	if (typeof raw.executable !== "string") throw new VerificationDescriptorError("verification executable is invalid");
	let executable: string = raw.executable;
	if (executable.startsWith("./")) {
		const path = verificationRelativePath(executable, "verification executable");
		if (path === ".") throw new VerificationDescriptorError("verification executable must be a file");
		executable = `./${path}`;
	} else if (!/^[A-Za-z0-9_][A-Za-z0-9_.+-]{0,127}$/.test(executable)) {
		throw new VerificationDescriptorError("verification executable must be a host tool name or ./project-file");
	}
	if (!Array.isArray(raw.argv) || raw.argv.length > VERIFICATION_DESCRIPTOR_BOUNDS.max_arg_tokens)
		throw new VerificationDescriptorError("verification argv must be a bounded array");
	for (const arg of raw.argv) {
		if (typeof arg !== "string" || Buffer.byteLength(arg) > VERIFICATION_DESCRIPTOR_BOUNDS.max_arg_token_bytes || /[\x00-\x1f\x7f]/.test(arg))
			throw new VerificationDescriptorError("verification argv must contain bounded literal strings");
	}
	return {
		executable,
		argv: raw.argv as string[],
		cwd: verificationRelativePath(raw.cwd, "verification cwd"),
		timeout_ms: bound(raw.timeout_ms, VERIFICATION_DESCRIPTOR_BOUNDS.max_timeout_ms, "verification timeout_ms"),
		max_output_bytes: bound(raw.max_output_bytes, VERIFICATION_DESCRIPTOR_BOUNDS.max_output_bytes, "verification max_output_bytes"),
	};
}

export function parseVerificationDescriptor(text: string): VerificationDescriptor {
	if (Buffer.byteLength(text) > VERIFICATION_DESCRIPTOR_BOUNDS.max_descriptor_bytes)
		throw new VerificationDescriptorError("verification descriptor exceeds the byte bound");
	let value: unknown;
	try { value = JSON.parse(text); }
	catch { throw new VerificationDescriptorError("verification string is not valid JSON"); }
	if (value && typeof value === "object" && "contract" in value
		&& value.contract === "assurance_kernel/verification_descriptor/v1")
		throw new VerificationDescriptorError("verification_contract_migration_required: revise the verification definition to v2 before execution");
	const raw = object(value, ["contract", "command", "environment"], "verification descriptor");
	if (raw.contract !== VERIFICATION_DESCRIPTOR_CONTRACT)
		throw new VerificationDescriptorError("verification descriptor contract is invalid");
	const env = raw.environment === undefined ? {} : object(raw.environment, ["prepare", "writable_paths"], "verification environment");
	const writable = env.writable_paths ?? [];
	if (!Array.isArray(writable) || writable.length > VERIFICATION_DESCRIPTOR_BOUNDS.max_writable_paths)
		throw new VerificationDescriptorError("verification writable_paths exceeds the host bound");
	const paths = writable.map(path => verificationRelativePath(path, "verification writable path")).sort();
	if (paths.includes(".") || new Set(paths).size !== paths.length
		|| paths.some((path, i) => paths.some((other, j) => j !== i && path.startsWith(`${other}/`))))
		throw new VerificationDescriptorError("verification writable paths must be distinct non-overlapping directories");
	return {
		contract: VERIFICATION_DESCRIPTOR_CONTRACT,
		command: command(raw.command),
		environment: { prepare: env.prepare === undefined || env.prepare === null ? null : command(env.prepare), writable_paths: paths },
	};
}

export function canonicalDescriptorBytes(descriptor: VerificationDescriptor): string {
	return `${JSON.stringify(descriptor, null, 2)}\n`;
}
