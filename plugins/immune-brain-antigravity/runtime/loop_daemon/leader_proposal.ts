/**
 * Loop Daemon: Leader Proposal (S2)
 *
 * Implements D2.4 of docs/specs/loop-leader.spec.md (BR-REQ-2, BR-REQ-3,
 * BR-DEC-3). The leader is model text, so its reply is parsed strictly and
 * never executed here: a proposal becomes typed items, and every item is
 * validated against the closed handler catalogue, the project catalog and the
 * targets the briefing actually named. The whole proposal is refused on output
 * that is not one JSON object, a wrong contract or a stale fingerprint; a single
 * item is refused on its own field. Nothing in this module reaches GitHub or
 * writes state — `S2` journals what was accepted and refuses everything else.
 */

import { isLoopHandler, type LoopHandler } from "./handlers.ts";

export const LOOP_LEADER_PROPOSAL_CONTRACT = "immune_brain/loop_leader_proposal/v1" as const;
/** At most 20 items per proposal (D2.4). */
export const LEADER_PROPOSAL_MAX_ITEMS = 20;
/** A dispatch brief over 16 KiB is refused with its item (D2.4). */
export const LEADER_BRIEF_MAX_BYTES = 16 * 1024;

export const LEADER_PROPOSAL_ACTIONS = ["next", "priority", "shape", "dispatch", "resolve", "note"] as const;
export type LeaderProposalActionName = (typeof LEADER_PROPOSAL_ACTIONS)[number];
export const LEADER_RESOLVE_KINDS = ["resume", "release", "replan", "ask_owner"] as const;
export type LeaderResolveKind = (typeof LEADER_RESOLVE_KINDS)[number];

export type LeaderProposalItem =
	| { target: string; action: "next"; handler: LoopHandler }
	| { target: string; action: "priority"; rank: number }
	| { target: string; action: "shape"; plan: "task" | "initiative"; reason: string }
	| { target: string; action: "dispatch"; role: string; subject: string; brief: string }
	| { target: string; action: "resolve"; kind: LeaderResolveKind; context?: string }
	| { target: string; action: "note"; text: string };

export interface LeaderProposal {
	contract: typeof LOOP_LEADER_PROPOSAL_CONTRACT;
	briefing_fingerprint: string;
	items: LeaderProposalItem[];
}

/** One item the parser refused, with the reason code the journal records. */
export interface LeaderProposalRejection {
	index: number;
	target: string | null;
	reason: string;
}

export type LeaderProposalParse =
	| { ok: false; reason: string }
	| { ok: true; proposal: LeaderProposal; rejected: LeaderProposalRejection[] };

export interface LeaderProposalInput {
	/** The fingerprint of the briefing the session was shown. */
	fingerprint: string;
	/** Every target the briefing named; an item about anything else is refused. */
	targets: readonly string[];
	/** Every role name in the project catalog; a dispatch to anything else is refused. */
	roles: readonly string[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

function parseItem(raw: unknown, input: LeaderProposalInput): { item: LeaderProposalItem } | { reason: string; target: string | null } {
	if (!isObject(raw)) return { reason: "item_not_object", target: null };
	const target = text(raw.target) ? raw.target : null;
	const refuse = (reason: string) => ({ reason, target });
	if (target === null) return refuse("item_target_missing");
	if (!input.targets.includes(target)) return refuse("item_unknown_target");
	if (!text(raw.action) || !(LEADER_PROPOSAL_ACTIONS as readonly string[]).includes(raw.action))
		return refuse("item_action_unknown");
	switch (raw.action) {
		case "next":
			if (!isLoopHandler(raw.handler)) return refuse("item_unknown_handler");
			return { item: { target, action: "next", handler: raw.handler } };
		case "priority":
			if (!Number.isSafeInteger(raw.rank)) return refuse("item_priority_rank_invalid");
			return { item: { target, action: "priority", rank: raw.rank as number } };
		case "shape":
			if (raw.plan !== "task" && raw.plan !== "initiative") return refuse("item_shape_invalid");
			if (!text(raw.reason)) return refuse("item_shape_invalid");
			return { item: { target, action: "shape", plan: raw.plan, reason: raw.reason } };
		case "dispatch":
			if (!text(raw.role) || !input.roles.includes(raw.role)) return refuse("item_unknown_role");
			if (!text(raw.subject)) return refuse("item_dispatch_subject_missing");
			if (typeof raw.brief !== "string") return refuse("item_dispatch_brief_missing");
			if (Buffer.byteLength(raw.brief, "utf8") > LEADER_BRIEF_MAX_BYTES) return refuse("item_brief_too_large");
			return { item: { target, action: "dispatch", role: raw.role, subject: raw.subject, brief: raw.brief } };
		case "resolve": {
			if (!text(raw.kind) || !(LEADER_RESOLVE_KINDS as readonly string[]).includes(raw.kind))
				return refuse("item_resolve_kind_unknown");
			const kind = raw.kind as LeaderResolveKind;
			// `ask_owner` is a question to the owner: without its context it carries nothing.
			if (kind === "ask_owner" && !text(raw.context)) return refuse("item_ask_owner_context_missing");
			return { item: text(raw.context) ? { target, action: "resolve", kind, context: raw.context } : { target, action: "resolve", kind } };
		}
		default:
			if (!text(raw.text)) return refuse("item_note_empty");
			return { item: { target, action: "note", text: raw.text } };
	}
}

/**
 * Parse one leader reply. `ok: false` means the whole proposal is refused and
 * nothing is journaled as a proposal; `ok: true` may still carry refused items,
 * each with its own reason and no side effect.
 */
export function parseLeaderProposal(bytes: string, input: LeaderProposalInput): LeaderProposalParse {
	let parsed: unknown;
	try {
		parsed = JSON.parse(bytes);
	} catch {
		return { ok: false, reason: "proposal_not_json" };
	}
	if (!isObject(parsed)) return { ok: false, reason: "proposal_not_json" };
	if (parsed.contract !== LOOP_LEADER_PROPOSAL_CONTRACT) return { ok: false, reason: "proposal_contract_mismatch" };
	if (parsed.briefing_fingerprint !== input.fingerprint) return { ok: false, reason: "proposal_fingerprint_mismatch" };
	if (!Array.isArray(parsed.items)) return { ok: false, reason: "proposal_items_missing" };
	if (parsed.items.length > LEADER_PROPOSAL_MAX_ITEMS) return { ok: false, reason: "proposal_items_exceeded" };
	const items: LeaderProposalItem[] = [];
	const rejected: LeaderProposalRejection[] = [];
	parsed.items.forEach((raw, index) => {
		const result = parseItem(raw, input);
		if ("item" in result) items.push(result.item);
		else rejected.push({ index, target: result.target, reason: result.reason });
	});
	return {
		ok: true,
		proposal: { contract: LOOP_LEADER_PROPOSAL_CONTRACT, briefing_fingerprint: input.fingerprint, items },
		rejected,
	};
}
