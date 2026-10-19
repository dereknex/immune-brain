import { expect, it } from "bun:test";

// Driven by tests/test-runtime-config.test.ts through a child bun test process;
// FIXTURE_CASE selects which case runs so each exit status is observed alone.
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const selected = process.env.FIXTURE_CASE;

it.if(selected === "default")("passes past Bun's 5000 ms default", async () => {
	await sleep(6000);
	expect(true).toBe(true);
});

it.if(selected === "explicit")("still honors an explicit shorter timeout", async () => {
	await sleep(400);
	expect(true).toBe(true);
}, 200);
