import { readFileSync as readPacket } from "node:fs";
import { parseReviewPacketHandle, reviewPacketHandle, packetDigest } from "../plugins/immune-brain/runtime/assurance/review_packet";
import { writeTestReviewPacket } from "./helpers/review-packet-fixture";
import { expect, test } from "bun:test";
import {
	promptDigest,
	reservedAgentParams,
	semanticNeighborhoodReviewPrompt,
} from "../plugins/immune-brain/.pi-extension/pi-canary-native-review.ts";

const params = reservedAgentParams({
	taskId: "task-12345678",
	operationId: "op-12345678",
	prompt: "review the immutable bundle",
	writePacket: writeTestReviewPacket,
});

test("reserved native review parameters are foreground-only and deterministic", () => {
	expect(params).toMatchObject({
		subagent_type: "Review",
		inherit_context: false,
		isolated: true,
		isolation: "off",
		run_in_background: false,
		max_turns: 16,
		resume: "",
		schedule: "",
	});
	expect(params).toMatchObject({ name: "", model: "", thinking: "" });
	expect(params.prompt.split("\n")).toHaveLength(4);
	const handle = parseReviewPacketHandle(params.prompt)!;
	const content = readPacket(handle.packet.path, "utf8");
	expect(content).toBe(semanticNeighborhoodReviewPrompt("review the immutable bundle"));
	expect(packetDigest(content)).toBe(handle.packet.sha256);
	expect(params.prompt).not.toContain("immutable bundle");
	expect(params.description).toContain("12345678");
	expect(promptDigest(params.prompt)).toMatch(/^sha256:[0-9a-f]{64}$/);
});

test("packet handles round-trip exact UTF-8 paths and reject malformed identities", () => {
	const identity = { taskId: "task-1", operationId: "op-1", packet: { path: "/tmp/review 空间/review-packet-op-1.md", sha256: packetDigest("instructions") } };
	const prompt = reviewPacketHandle(identity);
	expect(parseReviewPacketHandle(prompt)).toEqual(identity);
	for (const malformed of [prompt + "\n", prompt.replace("Packet sha256:", "Packet hash:"), prompt.slice(0, -1), prompt.replace(identity.packet.sha256, "0"), prompt.replace(identity.packet.path, "relative.md")])
		expect(parseReviewPacketHandle(malformed)).toBeUndefined();
	for (const path of ["relative.md", "/tmp/packet\nother", "/tmp/packet\rother"])
		expect(() => reviewPacketHandle({ ...identity, packet: { ...identity.packet, path } })).toThrow("invalid review packet identity");
	expect(() => reviewPacketHandle({ ...identity, operationId: "bad id" })).toThrow("invalid review reservation identity");
});

test("review prompt embeds provenance and strict JSON instructions", () => {
	const prompt = semanticNeighborhoodReviewPrompt("base");
	expect(prompt).toContain("base");
	expect(prompt).toContain("immutable bundle");
	expect(prompt).not.toContain("get_subagent_result");
});
