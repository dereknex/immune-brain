/**
 * Host-native UI language for Immune-Brain TUI text (Task Rail sentences,
 * authority dialog titles/actions, progress summaries). This layer is
 * deterministic extension code, so conversational AGENTS.md reply-language
 * rules cannot reach it; users opt in with IMM_UX_LANGUAGE (for example
 * `zh`). Anything unrecognized keeps English, the published default.
 *
 * Boundary: only sentence-level interaction text follows this setting.
 * Machine contracts and domain terms (state enums, operation ids, Task /
 * Intent / Claim / Acceptance field labels, hashes, paths, CLI commands)
 * always stay literal, as do agent-facing Tool result reasons and
 * diagnostic notifications.
 */
export type UxLanguage = "en" | "zh";

export function resolveUxLanguage(
	env: Readonly<Record<string, string | undefined>> = process.env,
): UxLanguage {
	const raw = env.IMM_UX_LANGUAGE?.trim().toLowerCase();
	if (raw === "zh" || raw === "zh-cn" || raw === "zh-tw" || raw === "chinese" || raw === "中文")
		return "zh";
	return "en";
}

/** Pick the interaction sentence for the resolved language. */
export function uxText(lang: UxLanguage, en: string, zh: string): string {
	return lang === "zh" ? zh : en;
}
