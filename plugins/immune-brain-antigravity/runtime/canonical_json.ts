/**
 * Stable JSON serialization compatible with Python's
 * `json.dumps(obj, sort_keys=True, ensure_ascii=False)` default separators.
 *
 * Signatures depend on this byte representation, so keep the spaces after
 * commas and colons explicit rather than delegating to JSON.stringify.
 */
export function stableStringify(value: unknown): string {
	if (value === null || value === undefined) return "null";
	if (typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(", ")}]`;
	}
	const obj = value as Record<string, unknown>;
	return `{${Object.keys(obj)
		.sort()
		.map((key) => `${JSON.stringify(key)}: ${stableStringify(obj[key])}`)
		.join(", ")}}`;
}
