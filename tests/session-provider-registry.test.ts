// Session provider registry (unified-lane-sessions S2, SPR-A1/A2).
// Role-indexed descriptors, pure resolveSessionProvider, and CLI adapter wiring.

import { describe, expect, it } from "bun:test";
import { runSessionCli } from "../plugins/immune-brain/runtime/session/cli";
import {
	checkProviderConformance,
	HERDR_CORE_DESCRIPTOR,
	HERDR_DESCRIPTOR,
	resolveSessionProvider,
	SESSION_PROVIDER_REGISTRY,
	type SessionProviderDescriptor,
} from "../plugins/immune-brain/runtime/session/provider_registry";
import type { SupervisedSessionPort } from "../plugins/immune-brain/runtime/session/supervised_session_port";
import { herdrSubject } from "./helpers/fake-herdr";

const ENV_INSIDE = { HERDR_ENV: "1", HERDR_WORKSPACE_ID: "ws1" } as Record<string, string | undefined>;
const ENV_OUTSIDE = { HERDR_ENV: undefined, HERDR_WORKSPACE_ID: undefined } as Record<string, string | undefined>;

describe("session provider registry", () => {
	it("lists exactly herdr and herdr-core for config", () => {
		expect(SESSION_PROVIDER_REGISTRY.map(d => d.name).sort()).toEqual(["herdr", "herdr-core"]);
	});

	it("herdr requires HERDR_ENV=1 and a workspace and admits executor hosts with find and exit proof", () => {
		expect(HERDR_DESCRIPTOR.checkEnv(ENV_INSIDE)).toEqual({ ok: true });
		expect(HERDR_DESCRIPTOR.checkEnv({ ...ENV_INSIDE, HERDR_ENV: undefined }).ok).toBe(false);
		expect(HERDR_DESCRIPTOR.checkEnv({ ...ENV_INSIDE, HERDR_WORKSPACE_ID: "" }).ok).toBe(false);
		expect(HERDR_DESCRIPTOR.roles.executor).toMatchObject({
			hosts: ["claude-code", "pi", "antigravity"],
			workspace: "local_path",
			find_by_key: true,
			exit_proof: true,
		});
	});

	it("herdr-core admits no executor host and no exit proof", () => {
		expect(HERDR_CORE_DESCRIPTOR.roles.executor?.hosts).toEqual([]);
		expect(HERDR_CORE_DESCRIPTOR.roles.executor?.exit_proof).toBe(false);
	});

	it("imm-session builds adapters from the registry and rejects fake or unknown providers", async () => {
		const { env, stateFile: _stateFile } = herdrSubject();
		void _stateFile;
		for (const provider of ["fake", "unknown_name"]) {
			const out = await runSessionCli(["probe", "--provider", provider], env);
			expect(out.returncode).toBe(1);
			expect(JSON.parse(out.stdout)).toMatchObject({ ok: false, code: "invalid_input" });
		}
	});
});

describe("resolveSessionProvider", () => {
	it("selects herdr inside Herdr", () => {
		const resolved = resolveSessionProvider({ role: "executor", providers: ["herdr", "herdr-core"], host: "pi", env: ENV_INSIDE });
		expect(resolved).toMatchObject({ ok: true, provider: "herdr" });
	});

	it("refuses lane_session_unavailable listing both providers and recoveries outside Herdr", () => {
		for (const env of [{ ...ENV_INSIDE, HERDR_ENV: "0" }, { ...ENV_INSIDE, HERDR_WORKSPACE_ID: "" }]) {
			const resolved = resolveSessionProvider({ role: "executor", providers: ["herdr", "herdr-core"], host: "pi", env });
			expect(resolved.ok).toBe(false);
			if (resolved.ok) continue;
			expect(resolved.code).toBe("lane_session_unavailable");
			expect(resolved.reasons.map(r => r.provider).sort()).toEqual(["herdr", "herdr-core"]);
			for (const reason of resolved.reasons) {
				expect(reason.reason.length).toBeGreaterThan(0);
				expect(reason.recovery.length).toBeGreaterThan(0);
			}
		}
	});

	it("selects an injected herdr-core for pi while refusing claude-code", () => {
		const injected: SessionProviderDescriptor[] = [
			{ ...HERDR_DESCRIPTOR },
			{
				...HERDR_CORE_DESCRIPTOR,
				checkEnv: () => ({ ok: true }),
				roles: { executor: { hosts: ["pi"], workspace: "local_path", find_by_key: true, exit_proof: false } },
			},
		];
		expect(resolveSessionProvider({ role: "executor", providers: ["herdr", "herdr-core"], host: "pi", env: ENV_OUTSIDE, registry: injected })).toMatchObject({ ok: true, provider: "herdr-core" });
		const refused = resolveSessionProvider({ role: "executor", providers: ["herdr", "herdr-core"], host: "claude-code", env: ENV_OUTSIDE, registry: injected });
		expect(refused.ok).toBe(false);
		if (!refused.ok) expect(refused.code).toBe("lane_session_unavailable");
	});

	it("skips descriptors with find_by_key false", () => {
		const registry: SessionProviderDescriptor[] = [
			{
				name: "herdr",
				checkEnv: () => ({ ok: true }),
				recovery: "r1",
				factory: () => { throw new Error("must not call factory"); },
				roles: { executor: { hosts: ["pi"], workspace: "local_path", find_by_key: false, exit_proof: true } },
			},
			{
				name: "herdr-core",
				checkEnv: () => ({ ok: true }),
				recovery: "r2",
				factory: () => { throw new Error("must not call factory"); },
				roles: { executor: { hosts: ["pi"], workspace: "local_path", find_by_key: true, exit_proof: false } },
			},
		];
		const resolved = resolveSessionProvider({ role: "executor", providers: ["herdr", "herdr-core"], host: "pi", env: ENV_OUTSIDE, registry });
		expect(resolved).toMatchObject({ ok: true, provider: "herdr-core" });
		const refused = resolveSessionProvider({ role: "executor", providers: ["herdr"], host: "pi", env: ENV_OUTSIDE, registry });
		expect(refused.ok).toBe(false);
		if (!refused.ok) {
			expect(refused.code).toBe("lane_session_unavailable");
			expect(refused.reasons).toMatchObject([{ provider: "herdr", reason: "no find_by_key" }]);
		}
	});

	it("invokes zero adapter factory, probe, or createSession calls", async () => {
		let factoryCalls = 0;
		const registry: SessionProviderDescriptor[] = [
			{
				name: "herdr",
				checkEnv: () => ({ ok: true }),
				recovery: "r",
				factory: () => {
					factoryCalls++;
					throw new Error("factory must not run during resolve");
				},
				roles: { executor: { hosts: ["pi"], workspace: "local_path", find_by_key: true, exit_proof: true } },
			},
		];
		const resolved = resolveSessionProvider({ role: "executor", providers: ["herdr"], host: "pi", env: ENV_INSIDE, registry });
		expect(resolved).toMatchObject({ ok: true, provider: "herdr" });
		expect(factoryCalls).toBe(0);
		// Resolve returns a descriptor, never a live port: no probe or createSession exists to call.
		expect(typeof (resolved as { descriptor?: unknown }).descriptor).toBe("object");
	});

	it("a descriptor claiming find or exit proof without the method fails conformance", () => {
		const { port } = herdrSubject();
		const withoutFind = { ...port, findSession: undefined, closeWithProof: undefined } as unknown as SupervisedSessionPort;
		expect(checkProviderConformance(HERDR_DESCRIPTOR, withoutFind).ok).toBe(false);
		expect(checkProviderConformance(HERDR_DESCRIPTOR, port).ok).toBe(true);
	});
});
