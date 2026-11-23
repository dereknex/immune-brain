// A stand-in for the interactive terminal a Herdr pane gives a Host (Spec e2e-release-gate D4).
// Lane Executors and Review sessions are started as interactive `claude` / `pi` processes and
// receive their entry through `herdr agent prompt`. fake-herdr has no terminal to type into, so
// the journey puts this shim first on PATH as `claude` and `pi`: it records how it was
// launched, waits for fake-herdr to record the entry prompt for its pane, then runs the real
// pinned binary non-interactively with that prompt. Black box: process boundaries only.
//
// Usage: bun host-shim.ts <claude|pi> [host args...]
// Env: E2E_REAL_CLAUDE / E2E_REAL_PI (real binaries), E2E_HERDR_STATE (fake-herdr state file),
// E2E_LAUNCH_LOG (JSONL file every launch is appended to).

import { appendFileSync, existsSync, readFileSync } from "node:fs";

const [name, ...args] = process.argv.slice(2);
const real = process.env[name === "pi" ? "E2E_REAL_PI" : "E2E_REAL_CLAUDE"];
const pane = process.env.HERDR_PANE_ID ?? null;
const record = (extra: Record<string, unknown>) => {
	if (process.env.E2E_LAUNCH_LOG) appendFileSync(process.env.E2E_LAUNCH_LOG, `${JSON.stringify({ at: new Date().toISOString(), host: name, pane, cwd: process.cwd(), args, ...extra })}\n`);
};
if (!real || !existsSync(real)) {
	record({ event: "launch_failed", reason: "real binary not configured" });
	process.stderr.write(`host-shim: E2E_REAL_${name.toUpperCase()} is not a binary\n`);
	process.exit(127);
}

const printMode = args.includes("-p") || args.includes("--print");
let prompt: string | null = null;
if (!printMode) {
	record({ event: "launch" });
	const state = process.env.E2E_HERDR_STATE;
	const deadline = Date.now() + 180_000;
	while (!prompt && Date.now() < deadline) {
		try {
			const prompts: string[] = JSON.parse(readFileSync(state as string, "utf8")).panes?.[pane as string]?.prompts ?? [];
			if (prompts.length) prompt = prompts[prompts.length - 1];
		} catch { /* state mid-write */ }
		if (!prompt) await Bun.sleep(100);
	}
	if (!prompt) {
		record({ event: "entry_never_delivered" });
		process.stderr.write("host-shim: no entry prompt arrived for this pane\n");
		process.exit(1);
	}
	record({ event: "entry", prompt });
}

// The prompt goes straight after -p: several Host options are variadic and would swallow a later positional.
const command = printMode ? [real, ...args] : [real, "-p", prompt as string, ...args, ...(name === "claude" ? ["--output-format", "stream-json", "--verbose", ...(args.includes("--permission-mode") ? [] : ["--dangerously-skip-permissions"])] : [])];
// Pi's Kernel mutations require its TUI, so Pi runs interactively under a pty with the prompt as its initial message; the pane's supervisor stops it.
const piCommand = ["sh", "-c", "sleep 86400 | python3 -I -c 'import pty,sys; sys.exit(pty.spawn(sys.argv[1:]) >> 8)' \"$@\"", "sh", real, prompt as string, ...args];
const child = Bun.spawn(name === "pi" && !printMode ? piCommand : command, { stdin: "ignore", stdout: "inherit", stderr: "inherit", env: process.env });
process.exit(await child.exited);
