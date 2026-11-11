// Supervised Session Port conformance (ADR 0038, docs/reference/supervised-session-port.md).
// Every provider runs the same behaviors through the port. The Herdr adapter
// runs against a stand-in `herdr` executable on PATH, so its real exec seam,
// argument spelling and output parsing are exercised; so does the herdr-core
// adapter against a stand-in `hc`.

import { afterEach, describe, expect, it } from "bun:test";
import { createFakeSessionProvider } from "../plugins/immune-brain/runtime/session/fake_provider";
import { herdrSubject, type SessionSubject as Subject } from "./helpers/fake-herdr";
import { herdrCoreSubject } from "./helpers/fake-herdr-core";
import {
	admitSessionProvider,
	REQUIRED_CAPABILITIES,
	type CloseRecord,
	type SessionHandle,
	type SupervisedSessionPort,
} from "../plugins/immune-brain/runtime/session/supervised_session_port";

function fakeSubject(): Subject {
	const { port, control } = createFakeSessionProvider();
	return { port, control: { ...control, foreignHandle: () => "fake:not-mine" }, provenance: "detected", cleanup: () => {} };
}

const SUBJECTS: Array<[string, () => Subject]> = [["fake", fakeSubject], ["herdr", () => herdrSubject()], ["herdr-core", () => herdrCoreSubject()]];

const INPUT = { cwd: "/lanes/slice-a", label: "slice-a", host: "claude-code" as const, hostArgs: ["--plugin-dir", "/p"], entry: "/immune-brain:drive slice-a" };
const PROOF: CloseRecord = { task_id: "slice-a", recorded_at: "2020-01-01T00:00:00.000Z" };

async function created(port: SupervisedSessionPort): Promise<SessionHandle> {
	const result = await port.createSession(INPUT);
	if (!result.ok) throw new Error(`create refused: ${result.reason}`);
	return result.handle;
}

describe.each(SUBJECTS)("Supervised Session Port conformance: %s", (_name, make) => {
	let subject: Subject;
	afterEach(() => subject?.cleanup());
	const start = () => (subject = make());

	it("is admitted with every required capability and the current port protocol", async () => {
		const { port } = start();
		const admitted = admitSessionProvider(port);
		expect(admitted.ok).toBe(true);
		for (const name of REQUIRED_CAPABILITIES) expect(typeof (port as unknown as Record<string, unknown>)[name]).toBe("function");
		expect(await port.probe()).toEqual({ ok: true });
	});

	it("creates exactly one session that receives the entry once and reports working", async () => {
		const { port, control } = start();
		const result = await port.createSession(INPUT);
		expect(result).toMatchObject({ ok: true, entry_submitted: true, state: "working", provenance: subject.provenance });
		if (!result.ok) return;
		expect(control.sessionCount()).toBe(1);
		expect(control.submitted(result.handle)).toEqual([INPUT.entry]);
	});

	it("reports a start dialog as blocked without submitting the entry", async () => {
		const { port, control } = start();
		control.blockNextStart();
		const result = await port.createSession(INPUT);
		expect(result).toMatchObject({ ok: true, entry_submitted: false, state: "blocked" });
		if (result.ok) expect(control.submitted(result.handle)).toEqual([]);
	});

	it("refuses invalid create input before touching the provider", async () => {
		const { port, control } = start();
		expect(await port.createSession({ ...INPUT, label: "x".repeat(33) })).toMatchObject({ ok: false, code: "invalid_input" });
		expect(control.sessionCount()).toBe(0);
	});

	it("observes a state with provenance and reports unknown instead of inventing one", async () => {
		const { port, control } = start();
		const handle = await created(port);
		control.setState(handle, "blocked");
		expect(await port.observeState(handle)).toEqual({ ok: true, state: "blocked", provenance: subject.provenance });
		control.setState(handle, "unknown");
		expect(await port.observeState(handle)).toEqual({ ok: true, state: "unknown", provenance: "none" });
	});

	it.each(["working", "blocked", "unknown"] as const)("sends nothing to a %s session", async state => {
		const { port, control } = start();
		const handle = await created(port);
		control.setState(handle, state);
		expect(await port.sendInstruction(handle, "correct the approach")).toMatchObject({ ok: false, code: "state_refused", handle });
		expect(control.submitted(handle)).toEqual([INPUT.entry]);
	});

	it.each(["idle", "done"] as const)("delivers one instruction to a %s session", async state => {
		const { port, control } = start();
		const handle = await created(port);
		control.setState(handle, state);
		expect(await port.sendInstruction(handle, "correct the approach")).toMatchObject({ ok: true, state: "working" });
		expect(control.submitted(handle)).toEqual([INPUT.entry, "correct the approach"]);
	});

	it("resubmits the entry in the same session only when it stopped working", async () => {
		const { port, control } = start();
		const handle = await created(port);
		expect(await port.createSession({ ...INPUT, resume: handle })).toMatchObject({ ok: false, code: "state_refused" });
		control.setState(handle, "idle");
		expect(await port.createSession({ ...INPUT, resume: handle })).toMatchObject({ ok: true, handle, entry_submitted: true });
		expect(control.sessionCount()).toBe(1);
		expect(control.submitted(handle)).toEqual([INPUT.entry, INPUT.entry]);
	});

	it("returns from a wait at once when the session is not working", async () => {
		const { port, control } = start();
		const handle = await created(port);
		control.setState(handle, "idle");
		expect(await port.awaitTransition(handle)).toMatchObject({ ok: true, transition: "changed", state: "idle" });
	});

	it("wakes a wait when a working session becomes blocked", async () => {
		const { port, control } = start();
		const handle = await created(port);
		const waiting = port.awaitTransition(handle, { timeoutMs: 5_000 });
		setTimeout(() => control.setState(handle, "blocked"), 100);
		expect(await waiting).toMatchObject({ ok: true, transition: "changed", state: "blocked", provenance: subject.provenance });
	});

	it("reports a timeout without guessing a state", async () => {
		const { port } = start();
		const handle = await created(port);
		expect(await port.awaitTransition(handle, { timeoutMs: 150 })).toEqual({ ok: true, transition: "timeout", state: "unknown", provenance: "none" });
	});

	it("ends an aborted wait promptly as a timeout", async () => {
		const { port } = start();
		const handle = await created(port);
		const controller = new AbortController();
		const started = Date.now();
		const waiting = port.awaitTransition(handle, { signal: controller.signal });
		setTimeout(() => controller.abort(), 100);
		expect(await waiting).toEqual({ ok: true, transition: "timeout", state: "unknown", provenance: "none" });
		expect(Date.now() - started).toBeLessThan(3_000);
	});

	it("reports an exited session as exited, not done", async () => {
		const { port, control } = start();
		const handle = await created(port);
		control.exit(handle);
		expect(await port.awaitTransition(handle, { timeoutMs: 1_000 })).toEqual({ ok: true, transition: "exited", state: "unknown", provenance: "none" });
	});

	it("labels output with the source it was read from", async () => {
		const { port, control } = start();
		const handle = await created(port);
		control.setOutput(handle, "Executor transcript");
		expect(await port.readOutput(handle, "scrollback")).toEqual({ ok: true, text: "Executor transcript", source: "scrollback" });
	});

	it("refuses every verb on a handle it does not own", async () => {
		const { port, control } = start();
		const foreign = control.foreignHandle();
		for (const result of [
			await port.observeState(foreign),
			await port.sendInstruction(foreign, "x"),
			await port.awaitTransition(foreign, { timeoutMs: 50 }),
			await port.readOutput(foreign, "visible"),
			await port.stopSession(foreign),
			await port.closeSession(foreign, PROOF),
			await port.createSession({ ...INPUT, resume: foreign }),
		]) expect(result).toMatchObject({ ok: false, code: "not_owned" });
	});

	it("refuses to close without the runner's accepted close record, naming what is missing", async () => {
		const { port } = start();
		const handle = await created(port);
		const refused = await port.closeSession(handle, { task_id: "", recorded_at: "yesterday" });
		expect(refused).toMatchObject({ ok: false, code: "close_unproven" });
		if (!refused.ok) expect(refused.reason).toStartWith("no accepted lane_session_close record: task_id, recorded_at");
		expect(await port.closeSession(handle, PROOF)).toEqual({ ok: true });
	});

	it("stops an owned session", async () => {
		const { port } = start();
		const handle = await created(port);
		expect(await port.stopSession(handle)).toEqual({ ok: true });
		expect(await port.awaitTransition(handle, { timeoutMs: 1_000 })).toMatchObject({ transition: "exited" });
	});

	it("reconciles only the handles it is given, marking foreign ones", async () => {
		const { port, control } = start();
		const handle = await created(port);
		control.setState(handle, "idle");
		const foreign = control.foreignHandle();
		expect(await port.reconcile([handle, foreign])).toEqual({
			ok: true,
			sessions: [
				{ handle, state: "idle", provenance: subject.provenance },
				{ handle: foreign, state: "unknown", provenance: "none", refused: "not_owned" },
			],
		});
	});
});

describe("Supervised Session Port admission", () => {
	it("refuses a provider that lacks a required capability or speaks another port protocol", () => {
		const { port } = createFakeSessionProvider();
		const { reconcile: _dropped, ...partial } = port;
		expect(admitSessionProvider(partial as SupervisedSessionPort)).toMatchObject({ ok: false, code: "provider_unavailable" });
		expect(admitSessionProvider({ ...port, protocolVersion: 2 })).toMatchObject({ ok: false, code: "protocol_mismatch" });
	});

	it("names each missing optional capability so its degrade can be reported", () => {
		const { port } = createFakeSessionProvider();
		const admitted = admitSessionProvider(port);
		expect(admitted).toMatchObject({ ok: true });
		if (admitted.ok) expect(admitted.missing_optional).toEqual(["waitForState", "subscribeEvents", "snapshot", "manageWorktree", "reportState", "attachSession"]);
	});
});
