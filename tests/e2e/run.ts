// `bun run e2e [journey...]` runs the L1 Host journeys; `bun run e2e:record <journey>` re-records
// their cassettes against the real API (maintainer credentials, never a QA descriptor).
// Journeys are tests/e2e/<name>.e2e.ts. They are deliberately not named *.test.ts, so the
// default `bun test` never collects them (Spec e2e-release-gate D5).

import { readdirSync } from "node:fs";
import { resolve } from "node:path";

const here = import.meta.dir;
const args = process.argv.slice(2);
const record = args.includes("--record");
const requested = args.filter((arg) => !arg.startsWith("--"));
const available = readdirSync(here).filter((name) => name.endsWith(".e2e.ts")).map((name) => name.slice(0, -".e2e.ts".length)).sort();

const unknown = requested.filter((name) => !available.includes(name));
if (unknown.length || (record && !requested.length)) {
	console.error(unknown.length ? `unknown_journey: ${unknown.join(", ")} (available: ${available.join(", ")})` : "record_journey_required: bun run e2e:record <journey>");
	process.exit(2);
}

const journeys = requested.length ? requested : available;
// bunfig.toml ignores tests/e2e for `bun test`; the explicit pattern here replaces that ignore for this run only.
const child = Bun.spawn(["bun", "test", "--timeout", "600000", "--path-ignore-patterns", "node_modules/**", ...journeys.map((name) => `./tests/e2e/${name}.e2e.ts`)], {
	cwd: resolve(here, "../.."),
	stdout: "inherit",
	stderr: "inherit",
	env: { ...process.env, E2E: "1", ...(record ? { E2E_RECORD: "1" } : {}) },
});
process.exit(await child.exited);
