import { spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

export type ExecutorHost = "claude-code" | "pi" | "antigravity";
export interface ExecutorPreferences { executor_host?: ExecutorHost; executor_model?: string; executor_effort?: string }
export interface ExecutorChoice { host: ExecutorHost; model?: string; effort?: string; not_applied: string[] }

/** A model and effort are meaningful only in the layer that selected the Host. */
export function chooseExecutor(layers: ExecutorPreferences[], fallback: ExecutorHost): ExecutorChoice {
	const hostLayer = layers.findIndex(layer => layer.executor_host !== undefined);
	const host = hostLayer < 0 ? fallback : layers[hostLayer]!.executor_host!;
	const selected = hostLayer < 0 ? {} : layers[hostLayer]!;
	const not_applied: string[] = [];
	for (const key of ["executor_model", "executor_effort"] as const) {
		if (layers.some((layer, i) => i !== hostLayer && layer[key] !== undefined)) not_applied.push(key);
	}
	return { host, ...(selected.executor_model ? { model: selected.executor_model } : {}),
		...(selected.executor_effort ? { effort: selected.executor_effort } : {}), not_applied };
}

export function executorArguments(choice: ExecutorChoice, pluginDir: string, taskId: string): string[] {
	if (choice.host === "antigravity") {
		return [
			"--dangerously-skip-permissions",
			...(choice.model ? ["--model", choice.model] : []),
			...(choice.effort ? ["--effort", choice.effort] : []),
			"--print",
			`/drive ${taskId}`,
		];
	}
	return ["--print", ...(choice.host === "claude-code" ? ["--plugin-dir", pluginDir] : []),
		...(choice.model ? ["--model", choice.model] : []),
		...(choice.effort ? [choice.host === "claude-code" ? "--effort" : "--thinking", choice.effort] : []),
		`${choice.host === "claude-code" ? "/immune-brain:drive" : "/skill:drive"} ${taskId}`];
}

export interface LaneExit {
	repository: string;
	lane_path: string;
	generation: number;
	pid: number;
	code: number | null;
	signal: NodeJS.Signals | null;
}
export interface LaneGeneration {
	repository: string;
	lane_path: string;
	generation: number;
	pid: number | null;
	owner_pid: number;
	state: "starting" | "running" | "exited" | "stopped_by_parent" | "interrupted" | "unobservable" | "unavailable";
	exit: LaneExit | null;
	baseline: string;
	no_progress: number;
	handled_generation?: number;
}
export interface LaneGenerationStore {
	read(): LaneGeneration | null;
	update(fn: (current: LaneGeneration | null) => LaneGeneration): LaneGeneration;
}
interface Handle {
	child: ChildProcess;
	done: Promise<LaneGeneration>;
	termination: "stopped_by_parent" | "interrupted" | null;
}

/** Handles stay with the owning Host process; durable state never invents an exit event. */
export class LaneSupervisor {
	private readonly handles = new Map<string, Handle>();

	async run(input: {
		key: string; repository: string; lanePath: string; taskId: string; choice: ExecutorChoice;
		pluginDir: string; store: LaneGenerationStore; baseline: string; waitMs: number; graceMs: number;
		signal?: AbortSignal; stop?: boolean; restart?: boolean;
	}): Promise<{ state: "running" | "exited" | "unobservable" | "stopped" | "unavailable"; generation: number | null; exit: LaneExit | null }> {
		let current = input.store.read();
		let handle = this.handles.get(input.key);
		if (current && (current.repository !== input.repository || current.lane_path !== input.lanePath)) throw new Error("lane_executor_identity_mismatch");
		if (!handle && current && (current.state === "starting" || current.state === "running" || current.state === "unobservable")) {
			if (current.state !== "starting") current = input.store.update(value => {
				if (!value || value.generation !== current!.generation) throw new Error("lane_executor_generation_changed");
				return { ...value, state: "unobservable", exit: null };
			});
			return { state: "unobservable", generation: current.generation, exit: null };
		}
		if (input.stop && !handle) return { state: "stopped", generation: current?.generation ?? null, exit: null };
		if (!handle && current && ["stopped_by_parent", "interrupted"].includes(current.state) && !input.restart)
			return { state: "stopped", generation: current.generation, exit: current.exit };
		if (!handle && (input.signal?.aborted || (current?.state === "exited" && !input.restart)))
			return { state: current?.state === "exited" ? "exited" : "stopped", generation: current?.generation ?? null, exit: current?.exit ?? null };
		if (!handle && !input.stop) {
			const binaryName = input.choice.host === "claude-code" ? "claude" : input.choice.host === "antigravity" ? "agy" : "pi";
			const executable = (process.env.PATH ?? "").split(delimiter).map(dir => join(dir || ".", binaryName))
				.find(path => { try { accessSync(path, constants.X_OK); return true; } catch { return false; } });
			if (!executable) return { state: "unavailable", generation: current?.generation ?? null, exit: null };
			const previous = current;
			current = input.store.update(value => {
				if ((value?.generation ?? 0) !== (previous?.generation ?? 0) || (value && value.state !== "unavailable" && (!input.restart || !["exited", "stopped_by_parent", "interrupted"].includes(value.state)))) throw new Error("lane_executor_generation_changed");
				return { repository: input.repository, lane_path: input.lanePath, generation: value?.state === "unavailable" ? value.generation : (value?.generation ?? 0) + 1,
					pid: null, owner_pid: process.pid, state: "starting", exit: null, baseline: input.baseline, no_progress: value?.no_progress ?? 0,
					...(value?.handled_generation ? { handled_generation: value.handled_generation } : {}) };
			});
			const generation = current.generation;
			const child = spawn(executable, executorArguments(input.choice, input.pluginDir, input.taskId),
				{ cwd: input.lanePath, stdio: "ignore" });
			const started = new Promise<boolean>(resolve => { child.once("spawn", () => resolve(true)); child.once("error", () => resolve(false)); });
			if (!child.pid) {
				await started;
				input.store.update(value => { if (!value || value.generation !== generation) throw new Error("lane_executor_generation_changed"); return { ...value, state: "unavailable" }; });
				return { state: "unavailable", generation, exit: null };
			}
			const pid = child.pid;
			const newHandle: Handle = { child, termination: null, done: null as unknown as Promise<LaneGeneration> };
			newHandle.done = new Promise((resolve, reject) => child.once("exit", (code, signal) => {
				try {
					const stored = input.store.update(value => {
						if (!value || value.generation !== generation || value.pid !== pid) throw new Error("lane_executor_generation_changed");
						const exit = { repository: input.repository, lane_path: input.lanePath, generation, pid, code, signal };
						return { ...value, state: newHandle.termination ?? "exited", exit };
					});
					resolve(stored);
				} catch (error) { reject(error); }
				finally { this.handles.delete(input.key); }
			}));
			void newHandle.done.catch(() => {});
			try {
				current = input.store.update(value => {
					if (!value || value.generation !== generation || value.state !== "starting") throw new Error("lane_executor_generation_changed");
					return { ...value, pid, state: "running" };
				});
			} catch (error) {
				child.kill("SIGTERM");
				const killTimer = setTimeout(() => child.kill("SIGKILL"), input.graceMs);
				void newHandle.done.finally(() => clearTimeout(killTimer)).catch(() => {});
				throw error;
			}
			this.handles.set(input.key, newHandle);
			handle = newHandle;
			if (!await started) {
				this.handles.delete(input.key);
				input.store.update(value => { if (!value || value.generation !== generation) throw new Error("lane_executor_generation_changed"); return { ...value, pid: null, state: "unavailable", exit: null }; });
				return { state: "unavailable", generation, exit: null };
			}
		}
		if (!handle) return { state: "exited", generation: current?.generation ?? null, exit: current?.exit ?? null };
		const active = handle;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let abort: (() => void) | undefined;
		let interrupted: (() => void) | undefined;
		const interruption = new Promise<"interrupted">(resolve => { interrupted = () => resolve("interrupted"); });
		const terminate = (reason: "stopped_by_parent" | "interrupted") => {
			if (active.termination) return;
			active.termination = reason;
			active.child.kill("SIGTERM");
			const killTimer = setTimeout(() => active.child.kill("SIGKILL"), input.graceMs);
			void active.done.finally(() => clearTimeout(killTimer));
			interrupted?.();
		};
		if (input.stop) terminate("stopped_by_parent");
		if (input.signal?.aborted) terminate("interrupted");
		const timeout = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), input.waitMs); });
		if (input.signal && !input.signal.aborted) { abort = () => terminate("interrupted"); input.signal.addEventListener("abort", abort, { once: true }); }
		try {
			let result = await Promise.race([active.done, timeout, interruption]);
			if (result === "interrupted") result = await active.done;
			if (!result) return { state: "running", generation: current!.generation, exit: null };
			return { state: result.state === "exited" ? "exited" : "stopped", generation: result.generation, exit: result.exit };
		} finally {
			if (timer) clearTimeout(timer);
			if (abort) input.signal?.removeEventListener("abort", abort);
		}
	}
}

/**
 * The Executor writes its Lane record while the Parent polls it, so a projection can be overtaken between its two
 * reads ("recovery projection changed"). That is transient by construction: read again a bounded number of times,
 * and let any other error, or a mismatch that persists, surface unchanged.
 */
async function projectStable<T>(project: () => Promise<T>, attempts = 6, delayMs = 25): Promise<T> {
	for (let attempt = 1; ; attempt++) {
		try { return await project(); }
		catch (error) {
			if (attempt >= attempts || !/recovery projection changed/.test(error instanceof Error ? error.message : String(error))) throw error;
			await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
		}
	}
}

/** Observe Kernel progress only after the process has actually exited. */
export async function superviseLane(
	supervisor: LaneSupervisor,
	input: Parameters<LaneSupervisor["run"]>[0] & {
		project: () => Promise<{ record_revision: string; lifecycle: string; next_obligation: string; open_user_decision_count: number }>;
	},
): Promise<Awaited<ReturnType<LaneSupervisor["run"]>> & { reason?: string }> {
	const project = () => projectStable(input.project);
	/** Account for one exited generation exactly once: progress resets the counter, none adds to it. */
	const markHandled = (generation: NonNullable<ReturnType<typeof input.store.read>>, advanced: boolean) => input.store.update(value => {
		if (!value || value.generation !== generation.generation || value.state !== "exited") throw new Error("lane_executor_generation_changed");
		if (value.handled_generation === value.generation) return value;
		return { ...value, handled_generation: value.generation, no_progress: advanced ? 0 : value.no_progress + 1 };
	});
	let projection = await project();
	const deadline = Date.now() + input.waitMs;
	for (;;) {
		const before = input.store.read();
		if (before?.no_progress && before.no_progress >= 2 && before.handled_generation === before.generation)
			return { state: "exited", generation: before.generation, exit: before.exit, reason: "lane_executor_no_progress" };
		const mayBeLive = before && ["starting", "running", "unobservable"].includes(before.state);
		if (!input.stop && !mayBeLive && (projection.lifecycle !== "active" || projection.next_obligation === "awaiting_user" || projection.open_user_decision_count > 0)) {
			// An exit seen only between calls is accounted for here as well: otherwise a decision answered in the same
			// call would re-attach to this exit instead of starting the next generation (Spec D11).
			if (before?.state === "exited") markHandled(before, projection.record_revision !== before.baseline);
			return { state: "exited", generation: before?.generation ?? null, exit: before?.exit ?? null };
		}
		const restart = !!before && ["exited", "stopped_by_parent", "interrupted"].includes(before.state) && before.handled_generation === before.generation;
		const observation = await supervisor.run({ ...input, baseline: projection.record_revision, restart, waitMs: Math.max(0, deadline - Date.now()) });
		if (observation.state !== "exited" || observation.generation === null) return observation;
		const generation = input.store.read();
		if (!generation || generation.generation !== observation.generation || generation.state !== "exited") throw new Error("lane_executor_generation_changed");
		projection = await project();
		const advanced = projection.record_revision !== generation.baseline;
		const observed = markHandled(generation, advanced);
		if (projection.lifecycle !== "active" || projection.next_obligation === "awaiting_user" || projection.open_user_decision_count > 0 || advanced)
			return observation;
		if (observed.no_progress >= 2) return { ...observation, reason: "lane_executor_no_progress" };
	}
}
