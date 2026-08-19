import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildAdvisoryDispatchEnvelope,
  resolveImmuneBrainLocalRoot,
} from "../plugins/immune-brain/runtime/advisory_dispatch";
import {
  buildWorkProbeInvocationEnvelopes,
  resolveWorkProbeDispatch,
} from "../plugins/immune-brain/runtime/work_probes";

describe("Pi-only runtime host contract", () => {
  it("binds local state, advisory dispatch, and work probes to Pi", () => {
    const home = mkdtempSync(join(tmpdir(), "imm-pi-only-"));
    try {
      const localRoot = resolveImmuneBrainLocalRoot({ home_dir: home });
      expect(localRoot.root).toBe(join(home, ".pi/agent/immune-brain"));
      expect("agent_id" in localRoot).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }

    const advisory = buildAdvisoryDispatchEnvelope({
      candidate: "imm-advisory-reviewer",
      lens: "security",
      prompt: "review only",
      model: "anthropic/claude-sonnet",
    });
    expect(advisory).toMatchObject({
      ok: true,
      host: "pi",
      primitive: "Agent",
      call: {
        subagent_type: "general-purpose",
        model: "anthropic/claude-sonnet",
        inherit_context: false,
      },
    });

    const probes = buildWorkProbeInvocationEnvelopes({
      plan_identity: "plan",
      step: {
        number: 1,
        step_id: "U1",
        parallel_probes: [{ scope: "runtime", output: "map", readonly: true }],
      },
    });
    expect(probes[0]).toMatchObject({
      runtime: "pi",
      dispatch_call: {
        tool: "Agent",
        args: {
          inherit_context: false,
          run_in_background: false,
        },
      },
    });
    expect(resolveWorkProbeDispatch({
      activation_mode: "auto",
      activation_mode_reason: "config_default",
      dispatch_available: true,
      authorized: true,
    }).dispatch).toBe(true);
  });
});
