import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync, symlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	normalizeCurrentIteration,
	buildLedgerRevision,
	canonicalizeTrustedPlanIdentity,
	buildClosedPlanArchive,
	buildTransitionRecord,
	validateTransitionState,
  collectReviewChangedFiles,
	type ClosedPlanArchive,
	type TransitionRecord,
} from "../plugins/immune-brain/runtime/state_ledger";

function currentEvidence(changedFile: string): Record<string, unknown> {
	return {
		evidence_schema: "structured-v1",
		changed_files: [changedFile],
		status: "passed",
		checks: [
			{
				kind: "command",
				command: "bun test",
				status: "passed",
				exit_code: 0,
				summary: "fixture passed",
			},
		],
		notes: "",
	};
}

function makeClosedState(
	overrides: Record<string, unknown> = {},
): Record<string, any> {
	return {
		schema_version: 3,
		closed_plan_history: [],
		plan_transition_history: [],
		steps: {
			"1": {
				step_id: "U1",
				state: "closed",
				result: "r1",
				verification: "v1",
				execution_evidence: currentEvidence("src-1.ts"),
			},
			"2": {
				step_id: "U2",
				state: "closed",
				result: "r2",
				verification: "v2",
				execution_evidence: currentEvidence("src-2.ts"),
			},
		},
		pending_follow_up: null,
		last_review: { decision: "pass", evidence: "QA passed" },
		validated_plan_snapshot: {
			plan_path: "docs/plans/predecessor.md",
			plan_signature: "sig-pred",
			steps: [
				{ number: 1, step_id: "U1", result: "r1", verification: "v1" },
				{ number: 2, step_id: "U2", result: "r2", verification: "v2" },
			],
		},
		history: [
			{
				at: "2026-07-28T10:00:00Z",
				action: "finish_reset",
				details: { plan_path: "docs/plans/predecessor.md" },
			},
		],
		review_follow_up_start_index: 0,
		follow_up_history: [],
		requires_replan: false,
		runtime_status: "idle",
		reset_reason: "intentional_reset",
		plan_path: "docs/plans/predecessor.md",
		plan_signature: "sig-pred",
		review_state: {
			gates: {
				"imm-code-review": {
					gate: "imm-code-review",
					decision: "pass",
					reviewed_changed_files: ["src.ts"],
					changed_files_signature: "abc123",
					evidence_ref: "review ok",
					reviewer_skill: "imm-code-review",
					reviewed_at: "2026-07-28T09:48:00Z",
				},
			},
		},
		...overrides,
	};
}

describe("schema version matrix", () => {
	it("rejects schema v2 in ordinary normalization", () => {
		const state = makeClosedState({ schema_version: 2 });
		expect(() => normalizeCurrentIteration(state)).toThrow(
			"Unsupported schema_version 2",
		);
	});

	it("preserves current schema v3", () => {
		const normalized = normalizeCurrentIteration(makeClosedState()) as any;
		expect(normalized.schema_version).toBe(3);
		expect(Array.isArray(normalized.closed_plan_history)).toBe(true);
		expect(Array.isArray(normalized.plan_transition_history)).toBe(true);
	});

	it("rejects a missing schema version", () => {
		const state = makeClosedState({ schema_version: undefined });
		expect(() => normalizeCurrentIteration(state)).toThrow(
			"Unsupported schema_version undefined",
		);
	});

	it("rejects v3 with missing transition collections", () => {
		const state = makeClosedState({
			closed_plan_history: undefined,
			plan_transition_history: undefined,
		});
		expect(() =>
			validateTransitionState(normalizeCurrentIteration(state)),
		).toThrow();
	});

	it("rejects v3 with malformed transition collections", () => {
		const state = makeClosedState({
			schema_version: 3,
			closed_plan_history: "not-an-array",
			plan_transition_history: [],
		});
		expect(() =>
			validateTransitionState(normalizeCurrentIteration(state)),
		).toThrow();
	});

	it("rejects unknown future schema versions", () => {
		const state = makeClosedState({ schema_version: 99 });
		expect(() =>
			validateTransitionState(normalizeCurrentIteration(state)),
		).toThrow();
	});
});

describe("ledger revision", () => {
	it("produces a stable lowercase hex string", () => {
		const rev = buildLedgerRevision(makeClosedState());
		expect(rev).toMatch(/^[0-9a-f]{64}$/);
	});

	it("ignores JSON key order and whitespace", () => {
		const state1 = makeClosedState();
		const state2 = JSON.parse(JSON.stringify(state1));
		// Reverse key order in a nested object
		const keys = Object.keys(state2.steps["1"]).reverse();
		state2.steps["1"] = Object.fromEntries(
			keys.map((k) => [k, state2.steps["1"][k]]),
		);
		expect(buildLedgerRevision(state1)).toBe(buildLedgerRevision(state2));
	});

	it("changes when an unknown persisted field is added", () => {
		const state1 = makeClosedState();
		const state2 = makeClosedState({ custom_extension: "new-value" });
		expect(buildLedgerRevision(state1)).not.toBe(buildLedgerRevision(state2));
	});

	it("changes when authority state changes", () => {
		const state1 = makeClosedState();
		const state2 = makeClosedState({ runtime_status: "active" });
		expect(buildLedgerRevision(state1)).not.toBe(buildLedgerRevision(state2));
	});
});

describe("canonical plan identity", () => {
	it("resolves relative paths to normalized repo-relative form", () => {
		const root = mkdtempSync(join(tmpdir(), "imm-canon-"));
		const planDir = join(root, "docs", "plans");
		mkdirSync(planDir, { recursive: true });
		writeFileSync(join(planDir, "plan.md"), "# Plan\n");
		expect(canonicalizeTrustedPlanIdentity("docs/plans/plan.md", root)).toBe(
			"docs/plans/plan.md",
		);
	});

	it("resolves absolute paths to repo-relative form", () => {
		const root = mkdtempSync(join(tmpdir(), "imm-canon-"));
		const planDir = join(root, "docs", "plans");
		mkdirSync(planDir, { recursive: true });
		writeFileSync(join(planDir, "plan.md"), "# Plan\n");
		expect(
			canonicalizeTrustedPlanIdentity(join(root, "docs/plans/plan.md"), root),
		).toBe("docs/plans/plan.md");
	});

	it("resolves dot and dot-dot aliases", () => {
		const root = mkdtempSync(join(tmpdir(), "imm-canon-"));
		const planDir = join(root, "docs", "plans");
		mkdirSync(planDir, { recursive: true });
		writeFileSync(join(planDir, "plan.md"), "# Plan\n");
		expect(
			canonicalizeTrustedPlanIdentity("docs/./plans/../plans/plan.md", root),
		).toBe("docs/plans/plan.md");
	});

	it("rejects paths outside the project root", () => {
		const root = mkdtempSync(join(tmpdir(), "imm-canon-"));
		const outside = mkdtempSync(join(tmpdir(), "imm-outside-"));
		writeFileSync(join(outside, "evil.md"), "# Evil\n");
		expect(() =>
			canonicalizeTrustedPlanIdentity(join(outside, "evil.md"), root),
		).toThrow();
	});

	it("rejects symlinked plan files", () => {
		const root = mkdtempSync(join(tmpdir(), "imm-canon-"));
		const planDir = join(root, "docs", "plans");
		mkdirSync(planDir, { recursive: true });
		writeFileSync(join(root, "real.md"), "# Real\n");
		try {
			symlinkSync(join(root, "real.md"), join(planDir, "link.md"));
		} catch {
			// symlinks may not be supported on all platforms
			return;
		}
		expect(() =>
			canonicalizeTrustedPlanIdentity("docs/plans/link.md", root),
		).toThrow();
	});

	it("rejects non-existent plan files", () => {
		const root = mkdtempSync(join(tmpdir(), "imm-canon-"));
		expect(() =>
			canonicalizeTrustedPlanIdentity("docs/plans/missing.md", root),
		).toThrow();
	});
});

describe("closed plan archive whitelist", () => {
	const finishTimestamp = "2026-07-28T10:17:47Z";

	function buildArchive(
		overrides: Record<string, unknown> = {},
	): ClosedPlanArchive {
		const state = makeClosedState(overrides);
		return buildClosedPlanArchive(state, {
			canonical_plan_path: "docs/plans/predecessor.md",
			plan_signature: "sig-pred",
			validated_plan_snapshot: state.validated_plan_snapshot,
			finish_timestamp: finishTimestamp,
		});
	}

	it("includes archive id, canonical identity, signature, snapshot, steps, review, and finish timestamp", () => {
		const archive = buildArchive();
		expect(archive.archive_id).toMatch(/^[0-9a-f]{64}$/);
		expect(archive.plan_path).toBe("docs/plans/predecessor.md");
		expect(archive.plan_signature).toBe("sig-pred");
		expect(archive.validated_plan_snapshot).toEqual(
			makeClosedState().validated_plan_snapshot,
		);
		expect(archive.steps).toHaveLength(2);
		expect(archive.steps[0].step_id).toBe("U1");
		expect(
			(archive.review_state as any).gates["imm-code-review"].decision,
		).toBe("pass");
		expect(archive.finish_timestamp).toBe(finishTimestamp);
	});

	it("includes only follow-ups from the review marker onward", () => {
		const preMarker = {
			id: "fu-0",
			state: "closed",
			execution_evidence: { changed_files: ["old.ts"] },
		};
		const currentFu = {
			id: "fu-1",
			state: "closed",
			execution_evidence: { changed_files: ["cur.ts"] },
		};
		const state = makeClosedState({
			follow_up_history: [preMarker, currentFu],
			review_follow_up_start_index: 1,
		});
		const archive = buildClosedPlanArchive(state, {
			canonical_plan_path: "docs/plans/predecessor.md",
			plan_signature: "sig-pred",
			validated_plan_snapshot: state.validated_plan_snapshot,
			finish_timestamp: finishTimestamp,
		});
		expect(archive.follow_ups).toEqual([currentFu]);
		expect(archive.follow_ups).not.toContain(preMarker);
	});

	it("excludes arbitrary top-level extensions", () => {
		const state = makeClosedState({
			secret_token: "s3cret",
			raw_transcript: "session data",
		});
		const archive = buildArchive(state);
		const json = JSON.stringify(archive);
		expect(json).not.toContain("secret_token");
		expect(json).not.toContain("raw_transcript");
	});

	it("excludes prior archives, transitions, and global history", () => {
		const priorArchive = { archive_id: "old", plan_path: "docs/plans/old.md" };
		const priorTransition = { transition_id: "old-t" };
		const state = makeClosedState({
			schema_version: 3,
			closed_plan_history: [priorArchive],
			plan_transition_history: [priorTransition],
			history: [{ at: "2026-01-01T00:00:00Z", action: "old_event" }],
		});
		const archive = buildClosedPlanArchive(state, {
			canonical_plan_path: "docs/plans/predecessor.md",
			plan_signature: "sig-pred",
			validated_plan_snapshot: state.validated_plan_snapshot,
			finish_timestamp: finishTimestamp,
		});
		const json = JSON.stringify(archive);
		expect(json).not.toContain("old_event");
		expect(json).not.toContain("priorArchive");
		// Prior collections are not nested inside the archive
		expect(archive).not.toHaveProperty("closed_plan_history");
		expect(archive).not.toHaveProperty("plan_transition_history");
	});

	it("deep-copies archive payloads so later mutations cannot change them", () => {
		const state = makeClosedState();
		const archive = buildArchive(state);
		// Mutate the original state after archiving
		state.steps["1"].step_id = "MUTATED";
		state.review_state.gates["imm-code-review"].decision = "rework";
		expect(archive.steps[0].step_id).toBe("U1");
		expect(
			(archive.review_state as any).gates["imm-code-review"].decision,
		).toBe("pass");
	});

	it("produces deterministic archive id for identical inputs", () => {
		const a1 = buildArchive();
		const a2 = buildArchive();
		expect(a1.archive_id).toBe(a2.archive_id);
	});
});

describe("transition record", () => {
	function buildRecord(
		overrides: Record<string, unknown> = {},
	): TransitionRecord {
		return buildTransitionRecord({
			predecessor_archive_id: "archive-123",
			predecessor_plan_path: "docs/plans/predecessor.md",
			predecessor_plan_signature: "sig-pred",
			successor_plan_path: "docs/plans/successor.md",
			successor_plan_signature: "sig-succ",
			predecessor_phase: "P1",
			successor_phase: "P2",
			roadmap_source: "docs/specs/roadmap.spec.md",
			declared_candidate: "P2",
      successor_candidate: "none",
      terminated_predecessor: false,
			approved_revision: "rev-abc",
			...overrides,
    } as any);
	}

	it("produces a deterministic transition id", () => {
		const r1 = buildRecord();
		const r2 = buildRecord();
		expect(r1.transition_id).toMatch(/^[0-9a-f]{64}$/);
		expect(r1.transition_id).toBe(r2.transition_id);
	});

	it("changes transition id when successor identity changes", () => {
		const r1 = buildRecord();
		const r2 = buildRecord({
			successor_plan_path: "docs/plans/other.md",
			successor_plan_signature: "sig-other",
		});
		expect(r1.transition_id).not.toBe(r2.transition_id);
	});

	it("includes approved revision in transition identity", () => {
		const r1 = buildRecord({ approved_revision: "rev-abc" });
		const r2 = buildRecord({ approved_revision: "rev-xyz" });
		expect(r1.transition_id).not.toBe(r2.transition_id);
	});

	it("stores declaration, validation, approval, and activation as separate fields", () => {
		const r = buildRecord();
		expect(r.declaration).toBeDefined();
		expect(r.declaration.predecessor_plan_path).toBe(
			"docs/plans/predecessor.md",
		);
		expect(r.declaration.declared_candidate).toBe("P2");
		expect(r.validation).toBeDefined();
		expect(typeof r.validation.validated_at).toBe("string");
		expect(r.approval).toBeDefined();
		expect(r.approval.actor).toBe("user");
		expect(r.approval.approved_revision).toBe("rev-abc");
		expect(r.activation).toBeDefined();
		expect(typeof r.activation.committed_at).toBe("string");
	});

	it("references the predecessor archive", () => {
		const r = buildRecord();
		expect(r.predecessor_archive_ref).toBe("archive-123");
	});

  it("persists the derived transition kind and successor candidate", () => {
    const r = buildRecord() as any;
    expect(r.transition_kind).toBe("phase_advance");
    expect(r.validation.successor_candidate).toBe("none");
  });
});

function buildReviewArchive(
  planPath: string,
  planSignature: string,
  changedFile: string,
): ClosedPlanArchive {
  const state = makeClosedState({
    plan_path: planPath,
    plan_signature: planSignature,
    steps: {
      "1": {
        step_id: "U1",
        state: "closed",
        execution_evidence: currentEvidence(changedFile),
      },
    },
    validated_plan_snapshot: {
      plan_path: planPath,
      plan_signature: planSignature,
      steps: [],
    },
  });
  return buildClosedPlanArchive(state, {
    canonical_plan_path: planPath,
    plan_signature: planSignature,
    validated_plan_snapshot: state.validated_plan_snapshot,
    finish_timestamp: "2026-08-13T10:00:00Z",
  });
}

function buildReviewTransition(input: {
  archive: ClosedPlanArchive;
  successorPath: string;
  successorSignature: string;
  predecessorPhase?: string;
  successorPhase?: string;
  declaredCandidate?: string;
  successorCandidate?: string;
  kind?: string;
}): TransitionRecord {
  const transition = buildTransitionRecord({
    predecessor_archive_id: input.archive.archive_id,
    predecessor_plan_path: input.archive.plan_path,
    predecessor_plan_signature: input.archive.plan_signature,
    successor_plan_path: input.successorPath,
    successor_plan_signature: input.successorSignature,
    predecessor_phase: input.predecessorPhase ?? "E1",
    successor_phase: input.successorPhase ?? "E1",
    roadmap_source: "docs/specs/roadmap.spec.md",
    declared_candidate: input.declaredCandidate ?? "E2",
    successor_candidate: input.successorCandidate ?? "E2",
    terminated_predecessor: false,
    approved_revision: "rev",
  });
  if (input.kind && input.kind !== transition.transition_kind) {
    transition.transition_kind = input.kind as any;
  }
  return transition;
}

describe("same-phase cumulative review scope", () => {
  it("unions a three-Plan explicit continuation chain", () => {
    const first = buildReviewArchive("docs/plans/u1.md", "sig-u1", "u1.ts");
    const second = buildReviewArchive("docs/plans/u2.md", "sig-u2", "u2.ts");
    const firstEdge = buildReviewTransition({
      archive: first,
      successorPath: "docs/plans/u2.md",
      successorSignature: "sig-u2",
    });
    const secondEdge = buildReviewTransition({
      archive: second,
      successorPath: "docs/plans/u3.md",
      successorSignature: "sig-u3",
    });
    const state = makeClosedState({
      plan_path: "docs/plans/u3.md",
      plan_signature: "sig-u3",
      steps: {
        "1": {
          step_id: "U3",
          state: "closed",
          execution_evidence: currentEvidence("u3.ts"),
        },
      },
      closed_plan_history: [first, second],
      plan_transition_history: [firstEdge, secondEdge],
    });

    expect(collectReviewChangedFiles(state)).toEqual([
      "u1.ts",
      "u2.ts",
      "u3.ts",
    ]);
  });

  it("starts a fresh scope after a Phase advance, terminated replacement, or legacy edge", () => {
    const archive = buildReviewArchive("docs/plans/e1.md", "sig-e1", "e1.ts");
    const phaseAdvance = buildReviewTransition({
      archive,
      successorPath: "docs/plans/e2.md",
      successorSignature: "sig-e2",
      successorPhase: "E2",
      successorCandidate: "none",
      kind: "phase_advance",
    });
    const state = makeClosedState({
      plan_path: "docs/plans/e2.md",
      plan_signature: "sig-e2",
      steps: {
        "1": {
          step_id: "E2",
          state: "closed",
          execution_evidence: currentEvidence("e2.ts"),
        },
      },
      closed_plan_history: [archive],
      plan_transition_history: [phaseAdvance],
    });
    expect(collectReviewChangedFiles(state)).toEqual(["e2.ts"]);

    const terminatedReplacement = buildTransitionRecord({
      predecessor_archive_id: archive.archive_id,
      predecessor_plan_path: archive.plan_path,
      predecessor_plan_signature: archive.plan_signature,
      successor_plan_path: "docs/plans/e1-replacement.md",
      successor_plan_signature: "sig-e1-replacement",
      predecessor_phase: "E1",
      successor_phase: "E1",
      roadmap_source: "docs/specs/roadmap.spec.md",
      declared_candidate: "E2",
      successor_candidate: "E2",
      terminated_predecessor: true,
      approved_revision: "rev",
    });
    state.plan_path = "docs/plans/e1-replacement.md";
    state.plan_signature = "sig-e1-replacement";
    state.plan_transition_history = [terminatedReplacement];
    expect(terminatedReplacement.transition_kind).toBe(
      "terminated_replacement",
    );
    expect(collectReviewChangedFiles(state)).toEqual(["e2.ts"]);

    const legacyEdge = structuredClone(phaseAdvance) as any;
    delete legacyEdge.transition_kind;
    state.plan_transition_history = [legacyEdge];
    expect(collectReviewChangedFiles(state)).toEqual(["e2.ts"]);
  });

  it("fails closed for a malformed continuation archive reference", () => {
    const archive = buildReviewArchive("docs/plans/u1.md", "sig-u1", "u1.ts");
    const edge = buildReviewTransition({
      archive,
      successorPath: "docs/plans/u2.md",
      successorSignature: "sig-u2",
    }) as any;
    edge.predecessor_archive_ref = "missing";
    const state = makeClosedState({
      plan_path: "docs/plans/u2.md",
      plan_signature: "sig-u2",
      closed_plan_history: [archive],
      plan_transition_history: [edge],
    });
    expect(() => collectReviewChangedFiles(state)).toThrow(
      "content hash is invalid",
    );
  });

  it("fails closed for archive identity and content-hash drift", () => {
    const archive = buildReviewArchive("docs/plans/u1.md", "sig-u1", "u1.ts");
    const edge = buildReviewTransition({
      archive,
      successorPath: "docs/plans/u2.md",
      successorSignature: "sig-u2",
    }) as any;
    const state = makeClosedState({
      plan_path: "docs/plans/u2.md",
      plan_signature: "sig-u2",
      closed_plan_history: [archive],
      plan_transition_history: [edge],
    });
    edge.declaration.predecessor_plan_path = "docs/plans/other.md";
    expect(() => collectReviewChangedFiles(state)).toThrow(
      "content hash is invalid",
    );
    edge.declaration.predecessor_plan_path = archive.plan_path;
    (archive.steps[0] as any).execution_evidence.changed_files = ["tampered.ts"];
    expect(() => collectReviewChangedFiles(state)).toThrow("content hash");
  });

  it("fails closed for ambiguous incoming edges and cycles", () => {
    const first = buildReviewArchive("docs/plans/u1.md", "sig-u1", "u1.ts");
    const second = buildReviewArchive("docs/plans/u2.md", "sig-u2", "u2.ts");
    const firstEdge = buildReviewTransition({
      archive: first,
      successorPath: "docs/plans/u2.md",
      successorSignature: "sig-u2",
    });
    const duplicateIncoming = structuredClone(firstEdge) as any;
    duplicateIncoming.transition_id = "other-transition";
    const ambiguousState = makeClosedState({
      plan_path: "docs/plans/u2.md",
      plan_signature: "sig-u2",
      closed_plan_history: [first],
      plan_transition_history: [firstEdge, duplicateIncoming],
    });
    expect(() => collectReviewChangedFiles(ambiguousState)).toThrow(
      "ambiguous incoming transition",
    );

    const cycleEdge = buildReviewTransition({
      archive: second,
      successorPath: "docs/plans/u1.md",
      successorSignature: "sig-u1",
    });
    const cycleState = makeClosedState({
      plan_path: "docs/plans/u1.md",
      plan_signature: "sig-u1",
      closed_plan_history: [first, second],
      plan_transition_history: [firstEdge, cycleEdge],
    });
    expect(() => collectReviewChangedFiles(cycleState)).toThrow("cycle");
  });

  it("rejects unknown and Phase-inconsistent explicit kinds", () => {
    const archive = buildReviewArchive("docs/plans/u1.md", "sig-u1", "u1.ts");
    const edge = buildReviewTransition({
      archive,
      successorPath: "docs/plans/u2.md",
      successorSignature: "sig-u2",
    }) as any;
    const state = makeClosedState({
      closed_plan_history: [archive],
      plan_transition_history: [edge],
    });
    edge.transition_kind = "invented";
    expect(() => validateTransitionState(state)).toThrow("transition_kind");
    edge.transition_kind = "phase_advance";
    expect(() => validateTransitionState(state)).toThrow(
      "canonical authority facts",
    );
  });

  it("rejects a locally consistent multi-field kind substitution", () => {
    const archive = buildReviewArchive("docs/plans/e1.md", "sig-e1", "e1.ts");
    const edge = buildReviewTransition({
      archive,
      successorPath: "docs/plans/e2.md",
      successorSignature: "sig-e2",
      successorPhase: "E2",
      successorCandidate: "none",
      kind: "phase_advance",
    }) as any;
    edge.transition_kind = "same_phase_continuation";
    edge.declaration.predecessor_phase = "E2";
    edge.validation.successor_candidate = "E2";
    const state = makeClosedState({
      plan_path: "docs/plans/e2.md",
      plan_signature: "sig-e2",
      steps: {
        "1": {
          step_id: "E2",
          state: "closed",
          execution_evidence: currentEvidence("e2.ts"),
        },
      },
      closed_plan_history: [archive],
      plan_transition_history: [edge],
    });
    expect(() => collectReviewChangedFiles(state)).toThrow(
      "content hash is invalid",
    );
  });

  it("tolerates legacy closed follow-ups without execution evidence", () => {
    const state = makeClosedState({
      steps: {
        "1": {
          step_id: "U1",
          state: "closed",
          execution_evidence: currentEvidence("u1.ts"),
        },
      },
      follow_up_history: [
        {
          id: "fu-legacy-debug",
          state: "closed",
          round: 56,
          opened_at: "2026-08-12T14:20:00Z",
          closed_at: "2026-08-12T14:24:15Z",
          change_goal: "debug closure",
          verification_hint: "none",
          scope: ["debug.ts"],
          origin_review: { gate: "imm-code-review", evidence_ref: "ev" },
          execution_evidence: null,
        },
      ],
      review_follow_up_start_index: 0,
    });
    expect(collectReviewChangedFiles(state)).toEqual(["u1.ts"]);
  });

  it("fails closed on present-but-malformed changed_files evidence", () => {
    const state = makeClosedState({
      steps: {
        "1": {
          step_id: "U1",
          state: "closed",
          execution_evidence: currentEvidence("u1.ts"),
        },
      },
      follow_up_history: [
        {
          id: "fu-corrupt",
          state: "closed",
          round: 57,
          opened_at: "2026-08-12T14:20:00Z",
          closed_at: "2026-08-12T14:24:33Z",
          change_goal: "corrupt fixture",
          verification_hint: "none",
          scope: ["debug.ts"],
          origin_review: { gate: "imm-code-review", evidence_ref: "ev" },
          execution_evidence: { changed_files: "not-an-array" },
        },
      ],
      review_follow_up_start_index: 0,
    });
    expect(() => collectReviewChangedFiles(state)).toThrow(
      "malformed changed_files evidence",
    );
  });

  it("tolerates null-evidence follow-ups inside a continuation archive", () => {
    const legacyArchiveState = makeClosedState({
      plan_path: "docs/plans/u1.md",
      plan_signature: "sig-u1",
      steps: {
        "1": {
          step_id: "U1",
          state: "closed",
          execution_evidence: currentEvidence("u1.ts"),
        },
      },
      follow_up_history: [
        {
          id: "fu-legacy-debug",
          state: "closed",
          round: 56,
          opened_at: "2026-08-12T14:20:00Z",
          closed_at: "2026-08-12T14:24:15Z",
          change_goal: "debug closure",
          verification_hint: "none",
          scope: ["debug.ts"],
          origin_review: { gate: "imm-code-review", evidence_ref: "ev" },
          execution_evidence: null,
        },
      ],
      review_follow_up_start_index: 0,
      validated_plan_snapshot: {
        plan_path: "docs/plans/u1.md",
        plan_signature: "sig-u1",
        steps: [],
      },
    });
    const first = buildClosedPlanArchive(legacyArchiveState, {
      canonical_plan_path: "docs/plans/u1.md",
      plan_signature: "sig-u1",
      validated_plan_snapshot: legacyArchiveState.validated_plan_snapshot,
      finish_timestamp: "2026-08-13T10:00:00Z",
    });
    const firstEdge = buildReviewTransition({
      archive: first,
      successorPath: "docs/plans/u2.md",
      successorSignature: "sig-u2",
    });
    const state = makeClosedState({
      plan_path: "docs/plans/u2.md",
      plan_signature: "sig-u2",
      steps: {
        "1": {
          step_id: "U2",
          state: "closed",
          execution_evidence: currentEvidence("u2.ts"),
        },
      },
      closed_plan_history: [first],
      plan_transition_history: [firstEdge],
    });
    expect(collectReviewChangedFiles(state)).toEqual(["u1.ts", "u2.ts"]);
  });
});

describe("linear archive growth", () => {
	it("three transitions add exactly one archive and record each without nesting", () => {
		const finishTs = "2026-07-28T10:17:47Z";
		let history: any[] = [];
		let transitions: any[] = [];
		for (let i = 1; i <= 3; i++) {
			const state = makeClosedState({
				plan_path: `docs/plans/plan-${i}.md`,
				plan_signature: `sig-${i}`,
				validated_plan_snapshot: {
					plan_path: `docs/plans/plan-${i}.md`,
					plan_signature: `sig-${i}`,
					steps: [{ number: 1, step_id: "U1", result: "r", verification: "v" }],
				},
				history: [
					{
						at: finishTs,
						action: "finish_reset",
						details: { plan_path: `docs/plans/plan-${i}.md` },
					},
				],
			});
			const archive = buildClosedPlanArchive(state, {
				canonical_plan_path: `docs/plans/plan-${i}.md`,
				plan_signature: `sig-${i}`,
				validated_plan_snapshot: state.validated_plan_snapshot,
				finish_timestamp: finishTs,
			});
			const record = buildTransitionRecord({
				predecessor_archive_id: archive.archive_id,
				predecessor_plan_path: `docs/plans/plan-${i}.md`,
				predecessor_plan_signature: `sig-${i}`,
				successor_plan_path: `docs/plans/plan-${i + 1}.md`,
				successor_plan_signature: `sig-${i + 1}`,
				predecessor_phase: `P${i}`,
				successor_phase: `P${i + 1}`,
				roadmap_source: "docs/specs/roadmap.spec.md",
				declared_candidate: `P${i + 1}`,
        successor_candidate: i < 3 ? `P${i + 2}` : "none",
        terminated_predecessor: false,
				approved_revision: `rev-${i}`,
			});
			history = [...history, archive];
			transitions = [...transitions, record];
			// Verify no nesting: archives don't contain prior archives
			const json = JSON.stringify(archive);
			expect(json).not.toContain("closed_plan_history");
			expect(json).not.toContain("plan_transition_history");
		}
		expect(history).toHaveLength(3);
		expect(transitions).toHaveLength(3);
		// All archive ids and transition ids are unique
		expect(new Set(history.map((a) => a.archive_id)).size).toBe(3);
		expect(new Set(transitions.map((t) => t.transition_id)).size).toBe(3);
	});
});

describe("duplicate and non-linear history rejection", () => {
	it("rejects duplicate transition ids in plan_transition_history", () => {
		const record = buildTransitionRecord({
			predecessor_archive_id: "a1",
			predecessor_plan_path: "docs/plans/p.md",
			predecessor_plan_signature: "s1",
			successor_plan_path: "docs/plans/s.md",
			successor_plan_signature: "s2",
			predecessor_phase: "P1",
			successor_phase: "P2",
			roadmap_source: "docs/specs/r.md",
			declared_candidate: "P2",
      successor_candidate: "none",
      terminated_predecessor: false,
			approved_revision: "rev",
		});
		const state = makeClosedState({
			schema_version: 3,
			closed_plan_history: [],
			plan_transition_history: [record, record],
		});
		expect(() =>
			validateTransitionState(normalizeCurrentIteration(state)),
		).toThrow();
	});
});
