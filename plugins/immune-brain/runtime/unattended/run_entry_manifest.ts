// The non-blocking execution manifest a confirmed batch start returns (Spec D6,
// ADR 0025). Host-neutral: each Host supplies its own intent reader, so Claude
// and Pi print the same children, risk, scope and verification commands.
import type { TaskIntentV1 } from "../kernel/types";

/** One child of a confirmed batch start, as the Loop prints it before working. */
export interface RunEntryManifestChild {
	task_id: string;
	slice_id: string;
	risk: string;
	scope: string[];
	verification: string[];
}

export interface RunEntryManifest {
	children: RunEntryManifestChild[];
}

function manifestVerification(verification: string): string {
	try {
		const command = (JSON.parse(verification) as { command?: { executable?: unknown; argv?: unknown } }).command;
		if (typeof command?.executable === "string" && Array.isArray(command.argv))
			return [command.executable, ...command.argv.map(String)].join(" ");
	} catch { /* a plain command string */ }
	return verification;
}

export function runEntryManifest(
	children: ReadonlyArray<{ task_id: string; slice_id: string; risk?: string }>,
	readIntent: (taskId: string) => Pick<TaskIntentV1, "risk" | "scope_hint" | "acceptance">,
): RunEntryManifest {
	return {
		children: children.map((child) => {
			let intent: Pick<TaskIntentV1, "risk" | "scope_hint" | "acceptance"> | null = null;
			try { intent = readIntent(child.task_id); } catch { /* listed without its intent */ }
			return {
				task_id: child.task_id,
				slice_id: child.slice_id,
				risk: child.risk ?? intent?.risk ?? "unknown",
				scope: intent ? [...intent.scope_hint] : [],
				verification: intent ? [...new Set(intent.acceptance.map((item) => manifestVerification(item.verification)))] : [],
			};
		}),
	};
}
