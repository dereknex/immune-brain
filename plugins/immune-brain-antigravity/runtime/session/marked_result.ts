// The result of an advisory child that ran in a supervised session (#426 S2).
//
// The child is told to end its reply with a line `IMM-ADVISORY-BEGIN`, its
// result, and a line `IMM-ADVISORY-END`. The dispatch text spells each marker
// in two parts, so the echoed prompt never contains a whole marker and cannot
// be mistaken for a result. A Host TUI may decorate a line (a bullet, an
// indent), so a marker line is one that ends with the marker after a
// non-word prefix. No complete pair means no result: the caller treats the
// output as `result_untrusted` and discards it.

export const ADVISORY_BEGIN = "IMM-ADVISORY-BEGIN";
export const ADVISORY_END = "IMM-ADVISORY-END";

/** The sentence appended to an advisory dispatch run in a session. */
export const ADVISORY_RESULT_INSTRUCTION =
	"When you are done, reply with a line that is IMM-ADVISORY- followed by BEGIN, then your complete result, then a line that is IMM-ADVISORY- followed by END. Write nothing after that line.";

function isMarker(line: string, marker: string): boolean {
	const at = line.lastIndexOf(marker);
	if (at < 0 || line.slice(at + marker.length).trim() !== "") return false;
	return !/[A-Za-z0-9-]/.test(line.slice(0, at).trim().slice(-1));
}

/** The text of the last complete BEGIN/END pair, or null when there is none. */
export function extractMarkedResult(text: string, begin = ADVISORY_BEGIN, end = ADVISORY_END): string | null {
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	for (let start = lines.length - 1; start >= 0; start--) {
		if (!isMarker(lines[start], begin)) continue;
		const stop = lines.findIndex((line, index) => index > start && isMarker(line, end));
		if (stop < 0) continue;
		const body = lines.slice(start + 1, stop);
		const indent = Math.min(...body.filter((line) => line.trim()).map((line) => line.length - line.trimStart().length));
		return body.map((line) => line.slice(Number.isFinite(indent) ? indent : 0).trimEnd()).join("\n").trim();
	}
	return null;
}
