import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { setDefaultTimeout } from "bun:test";

const tempRoot = realpathSync(tmpdir());
const configured = process.env.XDG_CONFIG_HOME;
const relativeConfig = configured && isAbsolute(configured) ? relative(tempRoot, resolve(configured)) : "..";
if (!configured || relativeConfig === ".." || relativeConfig.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(relativeConfig)) {
	process.env.XDG_CONFIG_HOME = mkdtempSync(`${tempRoot}/imm-test-config-`);
}

// Preloaded by bunfig.toml for every bun test run (Spec branch-boundary D1).
// Concurrent focused runs contend for CPU and git subprocesses, so Bun's 5000 ms
// default reports load as failure. A file's own setDefaultTimeout or a
// per-test timeout still takes precedence.
export const DEFAULT_TEST_TIMEOUT_MS = 30_000;

setDefaultTimeout(DEFAULT_TEST_TIMEOUT_MS);
