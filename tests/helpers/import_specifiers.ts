// Shared TypeScript import-specifier collector for boundary tests.
//
// Regex-based on purpose (no new tooling): it first masks comments and the
// contents of string/template literals, so a quoted path or an import-looking
// comment is never reported, then matches the import forms on the masked text
// and reads each specifier back from the original source by offset.

export type ImportForm =
	| "import-from" // import a from "x" / import { a,\n b } from "x"
	| "import-type" // import type { A } from "x"
	| "export-from" // export * from "x" / export { a } from "x" / export type {..} from "x"
	| "side-effect" // import "x"
	| "import-call" // import("x") and type-position import("x").T
	| "require"; // require("x")

export interface ImportSpecifier {
	form: ImportForm;
	/** Literal module specifier, or null for a computed `import(expr)` argument. */
	specifier: string | null;
	/** Raw argument text of an `import(...)` call (first argument), else the specifier. */
	argument: string;
	/** 1-based source line of the import keyword. */
	line: number;
}

const MASK = "\u0000";

const REGEX_PRECEDERS = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);
const REGEX_KEYWORDS = new Set(["return", "typeof", "case", "do", "else", "in", "of", "void", "delete", "throw", "yield", "await"]);

/**
 * Same-length copy of `source` where comments become spaces (newlines kept) and
 * the contents of string and template literals become MASK characters. Quote
 * characters and code inside `${...}` stay, so the structure remains matchable.
 */
function maskSource(source: string): string {
	const out = source.split("");
	const n = source.length;
	// Stack of brace depths for template substitutions: when the matching `}`
	// closes a `${`, scanning resumes inside the template literal.
	const templateResume: number[] = [];
	let braceDepth = 0;
	let lastSignificant = "";
	let lastWord = "";
	let i = 0;

	const blank = (from: number, to: number): void => {
		for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
	};
	const maskRange = (from: number, to: number): void => {
		for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = MASK;
	};
	const scanTemplate = (start: number): number => {
		// start points just after the opening backtick or a closing `}` of `${`.
		let k = start;
		while (k < n) {
			const ch = source[k];
			if (ch === "\\") {
				maskRange(k, Math.min(k + 2, n));
				k += 2;
				continue;
			}
			if (ch === "`") return k + 1;
			if (ch === "$" && source[k + 1] === "{") {
				templateResume.push(braceDepth);
				braceDepth++;
				return k + 2;
			}
			maskRange(k, k + 1);
			k++;
		}
		return n;
	};

	while (i < n) {
		const ch = source[i];
		const next = source[i + 1];
		if (ch === "/" && next === "/") {
			const end = source.indexOf("\n", i);
			const stop = end === -1 ? n : end;
			blank(i, stop);
			i = stop;
			continue;
		}
		if (ch === "/" && next === "*") {
			const end = source.indexOf("*/", i + 2);
			const stop = end === -1 ? n : end + 2;
			blank(i, stop);
			i = stop;
			continue;
		}
		if (ch === '"' || ch === "'") {
			let k = i + 1;
			while (k < n && source[k] !== ch && source[k] !== "\n") k += source[k] === "\\" ? 2 : 1;
			maskRange(i + 1, Math.min(k, n));
			i = Math.min(k, n - 1) + 1;
			lastSignificant = ch;
			lastWord = "";
			continue;
		}
		if (ch === "`") {
			i = scanTemplate(i + 1);
			lastSignificant = "`";
			lastWord = "";
			continue;
		}
		if (ch === "{") {
			braceDepth++;
		} else if (ch === "}") {
			braceDepth--;
			if (templateResume.length > 0 && templateResume[templateResume.length - 1] === braceDepth) {
				templateResume.pop();
				i = scanTemplate(i + 1);
				lastSignificant = "`";
				lastWord = "";
				continue;
			}
		}
		if (ch === "/") {
			// Regex literal vs. division: a regex can only follow an operator-like
			// token or a keyword such as `return`.
			const startsRegex = REGEX_PRECEDERS.has(lastSignificant) || REGEX_KEYWORDS.has(lastWord);
			if (startsRegex) {
				let k = i + 1;
				let inClass = false;
				while (k < n && source[k] !== "\n") {
					const c = source[k];
					if (c === "\\") {
						k += 2;
						continue;
					}
					if (c === "[") inClass = true;
					else if (c === "]") inClass = false;
					else if (c === "/" && !inClass) break;
					k++;
				}
				if (source[k] === "/") {
					maskRange(i + 1, k);
					i = k + 1;
					lastSignificant = "/";
					lastWord = "";
					continue;
				}
			}
		}
		if (/[\w$]/.test(ch)) {
			let k = i;
			while (k < n && /[\w$]/.test(source[k])) k++;
			lastWord = source.slice(i, k);
			lastSignificant = "a";
			i = k;
			continue;
		}
		if (!/\s/.test(ch)) {
			lastSignificant = ch;
			lastWord = "";
		}
		i++;
	}
	return out.join("");
}

const LEAD = String.raw`(?<![\w$.])`;

function lineOf(source: string, offset: number): number {
	let line = 1;
	for (let k = 0; k < offset; k++) if (source[k] === "\n") line++;
	return line;
}

/** Index of the `)` matching the `(` at `open` in masked text, or -1. */
function matchingParen(masked: string, open: number): number {
	let depth = 0;
	for (let k = open; k < masked.length; k++) {
		if (masked[k] === "(") depth++;
		else if (masked[k] === ")" && --depth === 0) return k;
	}
	return -1;
}

export function collectImportSpecifiers(source: string): ImportSpecifier[] {
	const masked = maskSource(source);
	const found: Array<ImportSpecifier & { offset: number }> = [];

	const literalFrom = (match: RegExpMatchArray & { indices?: Array<[number, number]> }, group: number): string => {
		const [start, end] = match.indices![group];
		return source.slice(start, end);
	};
	const push = (form: ImportForm, offset: number, specifier: string | null, argument: string): void => {
		found.push({ form, specifier, argument, line: lineOf(source, offset), offset });
	};

	const importFrom = new RegExp(`${LEAD}import\\s+(type\\s+)?[\\w$\\s{},*]*?\\bfrom\\s*(["'])(\\u0000*)\\2`, "gd");
	for (const match of masked.matchAll(importFrom)) {
		const specifier = literalFrom(match, 3);
		push(match[1] ? "import-type" : "import-from", match.index!, specifier, specifier);
	}

	const exportFrom = new RegExp(`${LEAD}export\\s+(?:type\\s+)?(?:\\*(?:\\s+as\\s+[\\w$]+)?|\\{[^}]*\\})\\s*from\\s*(["'])(\\u0000*)\\1`, "gd");
	for (const match of masked.matchAll(exportFrom)) {
		const specifier = literalFrom(match, 2);
		push("export-from", match.index!, specifier, specifier);
	}

	const sideEffect = new RegExp(`${LEAD}import\\s*(["'])(\\u0000*)\\1`, "gd");
	for (const match of masked.matchAll(sideEffect)) {
		const specifier = literalFrom(match, 2);
		push("side-effect", match.index!, specifier, specifier);
	}

	const requireCall = new RegExp(`${LEAD}require\\s*\\(\\s*(["'])(\\u0000*)\\1\\s*\\)`, "gd");
	for (const match of masked.matchAll(requireCall)) {
		const specifier = literalFrom(match, 2);
		push("require", match.index!, specifier, specifier);
	}

	for (const match of masked.matchAll(new RegExp(`${LEAD}import\\s*\\(`, "g"))) {
		const open = match.index! + match[0].length - 1;
		const close = matchingParen(masked, open);
		if (close === -1) continue;
		const inner = masked.slice(open + 1, close);
		const literal = new RegExp(`^\\s*(["'])(\\u0000*)\\1\\s*(?:,|$)`).exec(inner);
		if (literal) {
			const start = open + 1 + inner.indexOf(literal[1]) + 1;
			const specifier = source.slice(start, start + literal[2].length);
			push("import-call", match.index!, specifier, specifier);
		} else {
			push("import-call", match.index!, null, source.slice(open + 1, close).replace(/\/\*[\s\S]*?\*\//g, "").trim());
		}
	}

	return found.sort((a, b) => a.offset - b.offset).map(({ offset: _offset, ...rest }) => rest);
}
