// The contract identifiers one runtime reads and writes in a worktree's
// Authority Store. A lane-mode batch reads every Lane's Kernel state with the
// coordinator's own runtime, so the coordinator and the runtime a Lane
// Executor loads must agree on these identifiers; a plugin version number
// proves nothing (two different builds can carry the same one).
//
// `runtime_contracts.json` is the same set as data, shipped next to this
// module, so a coordinator can read another runtime's identifiers without
// executing its code. A test keeps the two in step.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TASK_TOMBSTONE_CONTRACT } from "./backend_claim";
import { KERNEL_STORE_SCHEMA_VERSION } from "./storage_paths";
import { TASK_RECORD_CONTRACT_V4 } from "./types";

export const RUNTIME_CONTRACTS_MANIFEST = "runtime_contracts.json";

export interface RuntimeContracts {
	contract: "immune_brain/runtime_contracts/v1";
	task_record: string;
	task_tombstone: string;
	assurance_projection: string;
	kernel_store_schema: number;
}

/** The identifiers this running runtime supports. */
export const RUNTIME_CONTRACTS: RuntimeContracts = {
	contract: "immune_brain/runtime_contracts/v1",
	task_record: TASK_RECORD_CONTRACT_V4,
	task_tombstone: TASK_TOMBSTONE_CONTRACT,
	assurance_projection: "assurance_kernel/assurance_projection/v1",
	kernel_store_schema: KERNEL_STORE_SCHEMA_VERSION,
};

const KEYS = ["task_record", "task_tombstone", "assurance_projection", "kernel_store_schema"] as const;

/** Where this running runtime's code was loaded from, for a refusal that names both sides. */
export function runningRuntimeSource(): string {
	try {
		return dirname(fileURLToPath(import.meta.url));
	} catch {
		return "unknown";
	}
}

/**
 * Read another runtime's identifiers from its manifest. `runtimeDir` is either
 * the `runtime/kernel` directory or a plugin root that contains one. Null when
 * no manifest exists there; a malformed manifest throws.
 */
export function readRuntimeContracts(runtimeDir: string): { contracts: RuntimeContracts; path: string } | null {
	const candidates = [
		join(runtimeDir, RUNTIME_CONTRACTS_MANIFEST),
		join(runtimeDir, "kernel", RUNTIME_CONTRACTS_MANIFEST),
		join(runtimeDir, "runtime", "kernel", RUNTIME_CONTRACTS_MANIFEST),
		join(runtimeDir, "plugins", "immune-brain", "runtime", "kernel", RUNTIME_CONTRACTS_MANIFEST),
	];
	const path = candidates.find((candidate) => existsSync(candidate));
	if (!path) return null;
	const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	if (raw.contract !== "immune_brain/runtime_contracts/v1")
		throw new Error(`${path} is not an immune_brain/runtime_contracts/v1 manifest`);
	for (const key of KEYS) {
		const value = raw[key];
		if (key === "kernel_store_schema" ? !Number.isSafeInteger(value) : typeof value !== "string" || !value)
			throw new Error(`${path} has an invalid ${key}`);
	}
	return { contracts: raw as unknown as RuntimeContracts, path: resolve(path) };
}

/** The identifiers on which two runtimes disagree; empty when they can read each other's state. */
export function runtimeContractDifferences(a: RuntimeContracts, b: RuntimeContracts): string[] {
	return KEYS.filter((key) => a[key] !== b[key]).map((key) => `${key}: ${String(a[key])} != ${String(b[key])}`);
}
