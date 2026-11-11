// `imm-session`: the Parent's command surface over the Supervised Session Port.
//
// Every verb names its provider explicitly; nothing is auto-detected and no
// provider stands in for another. Each call admits the provider, probes it,
// then runs one verb and prints one JSON object. Exit 0 on success, 1 on a
// port refusal (the JSON names it), 2 on a usage error. `close` takes the
// record of a close the batch runner accepted under the Executor close rule.

import { createHerdrCoreSessionProvider } from "./herdr_core_provider";
import { createHerdrSessionProvider } from "./herdr_provider";
import {
	admitSessionProvider,
	EXECUTOR_HOSTS,
	refuse,
	type ExecutorHostKind,
	type OutputSource,
	type Refusal,
	type SupervisedSessionPort,
} from "./supervised_session_port";

export interface CliOutcome {
	stdout: string;
	stderr: string;
	returncode: number;
}

export const SESSION_VERBS = ["probe", "create", "send", "await", "observe", "read", "stop", "close", "reconcile"] as const;

const USAGE = [
	"imm-session <verb> --provider herdr|herdr-core [options]",
	"  probe",
	"  create --cwd <lane_path> --label <name> --host claude-code|pi|antigravity --entry <drive entry> [--resume <handle>] [--env KEY=VALUE]... [-- <host arguments>]",
	"  send <handle> --text <instruction>",
	"  await <handle>... [--timeout-ms <ms>]   (several handles: the first transition, with its handle)",
	"  observe <handle>",
	"  read <handle> [--source visible|scrollback]",
	"  stop <handle>",
	"  close <handle> --task <task_id> --recorded-at <lane_session_close.recorded_at>",
	"  reconcile <handle>...",
].join("\n");

export function resolveSessionProvider(name: string | undefined, env: Record<string, string | undefined>): SupervisedSessionPort | Refusal {
	if (name === "herdr") return createHerdrSessionProvider({ env });
	if (name === "herdr-core") return createHerdrCoreSessionProvider({ env });
	return refuse("invalid_input", `unknown session provider ${JSON.stringify(name ?? "")}; name one explicitly (herdr, herdr-core); there is no fallback`);
}

function usage(message: string): CliOutcome {
	return { stdout: "", stderr: `invalid_session_command: ${message}\n${USAGE}\n`, returncode: 2 };
}

function emit<T extends { ok: boolean }>(result: T): CliOutcome {
	return { stdout: `${JSON.stringify(result)}\n`, stderr: "", returncode: result.ok ? 0 : 1 };
}

interface Parsed { positional: string[]; flags: Map<string, string>; env: Record<string, string>; rest: string[] }

const VALUE_FLAGS = new Set(["--provider", "--cwd", "--label", "--host", "--entry", "--resume", "--text", "--timeout-ms", "--source", "--task", "--recorded-at"]);

function parse(args: string[]): Parsed | string {
	const positional: string[] = [];
	const flags = new Map<string, string>();
	const env: Record<string, string> = {};
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--") return { positional, flags, env, rest: args.slice(index + 1) };
		if (arg === "--env") {
			const pair = args[index + 1];
			const at = pair?.indexOf("=") ?? -1;
			if (!pair || at <= 0) return "--env needs KEY=VALUE";
			const key = pair.slice(0, at);
			if (key in env) return `--env ${key} given twice`;
			env[key] = pair.slice(at + 1);
			index++;
			continue;
		}
		if (arg.startsWith("--")) {
			if (!VALUE_FLAGS.has(arg)) return `unknown option ${arg}`;
			const value = args[index + 1];
			if (value === undefined) return `${arg} needs a value`;
			if (flags.has(arg)) return `${arg} given twice`;
			flags.set(arg, value);
			index++;
			continue;
		}
		positional.push(arg);
	}
	return { positional, flags, env, rest: [] };
}

export async function runSessionCli(
	args: string[],
	env: Record<string, string | undefined>,
	resolve: typeof resolveSessionProvider = resolveSessionProvider,
): Promise<CliOutcome> {
	const [verb, ...tail] = args;
	if (!verb || !(SESSION_VERBS as readonly string[]).includes(verb)) return usage(`unknown verb ${JSON.stringify(verb ?? "")}`);
	const parsed = parse(tail);
	if (typeof parsed === "string") return usage(parsed);
	const { positional, flags, env: hostEnv, rest } = parsed;
	if (rest.length > 0 && verb !== "create") return usage("only create takes host arguments after --");
	if (Object.keys(hostEnv).length > 0 && verb !== "create") return usage("only create takes --env");

	const port = resolve(flags.get("--provider"), env);
	if ("ok" in port && port.ok === false) return emit(port);
	const provider = port as SupervisedSessionPort;
	const admitted = admitSessionProvider(provider);
	if (!admitted.ok) return emit(admitted);
	const probed = await provider.probe();
	if (!probed.ok) return emit(probed);

	const handle = positional[0];
	const needHandle = () => (positional.length === 1 ? null : usage(`${verb} takes exactly one handle`));
	switch (verb) {
		case "probe":
			if (positional.length > 0) return usage("probe takes no handle");
			return emit({ ok: true, provider: provider.provider, missing_optional: admitted.missing_optional });
		case "create": {
			if (positional.length > 0) return usage("create takes no positional argument");
			const host = flags.get("--host");
			if (!host || !(EXECUTOR_HOSTS as readonly string[]).includes(host)) return usage(`--host must be one of ${EXECUTOR_HOSTS.join(", ")}`);
			const cwd = flags.get("--cwd");
			const label = flags.get("--label");
			const entry = flags.get("--entry");
			if (!cwd || !label || !entry) return usage("create needs --cwd, --label and --entry");
			const resume = flags.get("--resume");
			return emit(await provider.createSession({
				cwd, label, host: host as ExecutorHostKind, entry, hostArgs: rest,
				...(resume ? { resume } : {}),
				...(Object.keys(hostEnv).length > 0 ? { env: hostEnv } : {}),
			}));
		}
		case "send": {
			const bad = needHandle();
			if (bad) return bad;
			const text = flags.get("--text");
			if (!text) return usage("send needs --text");
			return emit(await provider.sendInstruction(handle, text));
		}
		case "await": {
			if (positional.length === 0) return usage("await needs at least one handle");
			if (new Set(positional).size !== positional.length) return usage("await names each handle once");
			const raw = flags.get("--timeout-ms");
			if (raw !== undefined && !/^\d+$/.test(raw)) return usage("--timeout-ms must be a whole number of milliseconds");
			const bound = raw === undefined ? {} : { timeoutMs: Number(raw) };
			if (positional.length === 1) return emit(await provider.awaitTransition(handle, raw === undefined ? undefined : bound));
			// Several sessions: the first transition wins and names its handle; the
			// other waits are aborted and awaited, so no wait process outlives the call.
			const controller = new AbortController();
			const waits = positional.map(each => provider.awaitTransition(each, { ...bound, signal: controller.signal }).then(result => ({ each, result })));
			const first = await Promise.race(waits);
			controller.abort();
			await Promise.allSettled(waits);
			if (first.result.ok && first.result.transition === "timeout") return emit(first.result);
			return emit({ ...first.result, handle: first.each });
		}
		case "observe": {
			const bad = needHandle();
			if (bad) return bad;
			return emit(await provider.observeState(handle));
		}
		case "read": {
			const bad = needHandle();
			if (bad) return bad;
			const source = flags.get("--source") ?? "visible";
			if (source !== "visible" && source !== "scrollback") return usage("--source must be visible or scrollback");
			return emit(await provider.readOutput(handle, source as OutputSource));
		}
		case "stop": {
			const bad = needHandle();
			if (bad) return bad;
			return emit(await provider.stopSession(handle));
		}
		case "close": {
			const bad = needHandle();
			if (bad) return bad;
			const task = flags.get("--task");
			const recordedAt = flags.get("--recorded-at");
			if (!task || !recordedAt) return usage("close needs --task and --recorded-at from an accepted lane_session_close");
			return emit(await provider.closeSession(handle, { task_id: task, recorded_at: recordedAt }));
		}
		case "reconcile":
			if (positional.length === 0) return usage("reconcile needs at least one handle");
			return emit(await provider.reconcile(positional));
	}
	return usage(`unknown verb ${verb}`);
}
