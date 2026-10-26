import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";

export interface ReviewPacket {
	path: string;
	sha256: string;
}

export const REVIEW_PACKET_INSTRUCTION = "Verify the packet sha256 before reading its instructions; on a mismatch reply exactly: review packet digest mismatch";

export function packetDigest(content: string): string {
	return createHash("sha256").update(content, "utf8").digest("hex");
}

export function reviewPacketHandle(input: { taskId: string; operationId: string; packet: ReviewPacket }): string {
	if (!isAbsolute(input.packet.path) || /[\r\n]/.test(input.packet.path) || !/^[a-f0-9]{64}$/.test(input.packet.sha256))
		throw new Error("invalid review packet identity");
	if (!/^[A-Za-z0-9._-]+$/.test(input.operationId) || !/^[A-Za-z0-9._-]+$/.test(input.taskId))
		throw new Error("invalid review reservation identity");
	return [
		`<!-- immune-brain:operation_id=${input.operationId} task_id=${input.taskId} -->`,
		`Review packet: ${input.packet.path}`,
		`Packet sha256: ${input.packet.sha256}`,
		REVIEW_PACKET_INSTRUCTION,
	].join("\n");
}

export function parseReviewPacketHandle(prompt: string): { taskId: string; operationId: string; packet: ReviewPacket } | undefined {
	const lines = prompt.split("\n");
	if (lines.length !== 4) return;
	const marker = /^<!-- immune-brain:operation_id=([A-Za-z0-9._-]+) task_id=([A-Za-z0-9._-]+) -->$/.exec(lines[0]);
	if (!marker || !lines[1].startsWith("Review packet: ") || !lines[2].startsWith("Packet sha256: ")) return;
	const result = { operationId: marker[1], taskId: marker[2], packet: { path: lines[1].slice(15), sha256: lines[2].slice(15) } };
	try { if (reviewPacketHandle(result) === prompt) return result; } catch { /* malformed handle */ }
}
