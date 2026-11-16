// A private scratch directory that lives only for one callback. Modules that
// must never delete user state (the unattended Lane modules) use this instead of
// removing paths themselves; the only path removed here is the one just created.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Run `fn` with a fresh directory under the system temp dir, removed afterwards. */
export function withTempDirectory<T>(prefix: string, fn: (directory: string) => T): T {
	const directory = mkdtempSync(join(tmpdir(), prefix));
	try {
		return fn(directory);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}
