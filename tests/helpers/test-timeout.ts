import { setDefaultTimeout } from "bun:test";

// Preloaded by bunfig.toml for every bun test run (Spec branch-boundary D1).
// Concurrent focused runs contend for CPU and git subprocesses, so Bun's 5000 ms
// default reports load as failure. A file's own setDefaultTimeout or a
// per-test timeout still takes precedence.
export const DEFAULT_TEST_TIMEOUT_MS = 30_000;

setDefaultTimeout(DEFAULT_TEST_TIMEOUT_MS);
