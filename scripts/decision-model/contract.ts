// Decision-model contract: input categories, provider kinds, unavailable
// reasons, the provider adapter seam and the result envelope (Spec
// docs/specs/decision-model-core.spec.md D2, D4, D5).
//
// This module is offline tooling. Nothing under plugins/immune-brain imports
// it, and it imports nothing from there (ADR 0006: the runtime never invokes
// a model).

/** Categories any configured provider may receive. `issue_text` is public: the repository is public (A15, BR-DEC-6). */
export const NON_SENSITIVE_CATEGORIES = ["pr_comment", "issue_text", "command_text", "session_event"] as const;
/** Categories a provider receives only when `egress` lists them for its kind. */
export const SENSITIVE_CATEGORIES = ["finding", "diff", "goal_scope", "spec_source"] as const;

export type NonSensitiveCategory = (typeof NON_SENSITIVE_CATEGORIES)[number];
export type SensitiveCategory = (typeof SENSITIVE_CATEGORIES)[number];
export type InputCategory = NonSensitiveCategory | SensitiveCategory;

export function isSensitiveCategory(value: string): value is SensitiveCategory {
	return (SENSITIVE_CATEGORIES as readonly string[]).includes(value);
}

export function isNonSensitiveCategory(value: string): value is NonSensitiveCategory {
	return (NON_SENSITIVE_CATEGORIES as readonly string[]).includes(value);
}

/** Kinds the parser knows; each has an adapter. */
export const PROVIDER_KINDS = ["clef", "fake", "jev"] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export function isProviderKind(value: unknown): value is ProviderKind {
	return typeof value === "string" && (PROVIDER_KINDS as readonly string[]).includes(value);
}

export const UNAVAILABLE_REASONS = [
	"no_binding",
	"no_local_config",
	"unknown_profile",
	"config_invalid",
	"unsupported_provider_kind",
	"egress_denied",
	"credential_missing",
	"provider_error",
	"invalid_response",
] as const;
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];

export type QuestionType = "choice";

/** One registered decision site (Spec D6). */
export interface ApplicationPoint {
	readonly id: string;
	readonly question_type: QuestionType;
	readonly input_category: InputCategory;
	/** Ordered option ids; also the order of `criteria`. */
	readonly options: readonly string[];
	readonly criteria: Readonly<Record<string, string>>;
	readonly instructions: string;
	readonly threshold_set: { readonly version: string; readonly values: Readonly<Record<string, number>> | null };
}

export type PointRegistry = Readonly<Record<string, ApplicationPoint>>;

export type ProbabilityMap = Record<string, number>;

export interface ClefProfile {
	kind: "clef";
	model: "clef" | "clef-flash";
	account_id_env: string;
	token_env: string;
	context_window?: number;
	timeout_ms?: number;
}

export interface FakeProfile {
	kind: "fake";
	answers: Record<string, ProbabilityMap>;
	default?: ProbabilityMap;
}

export interface JevProfile {
	kind: "jev";
	api_key_env: string;
	/** Default https://api.typesafe.ai (unverified; see providers/jev.ts). */
	base_url?: string;
	context_window?: number;
	timeout_ms?: number;
}

export type Profile = ClefProfile | FakeProfile | JevProfile;

export interface DecideRequest {
	point: string;
	/** Text or JSON; sent to the provider as Clef's `state`. */
	state: unknown;
	trace_id?: string;
}

/** What an adapter returns before `decide()` validates it against the option set. */
export interface ProviderAnswer {
	model: string;
	model_version: string | null;
	probabilities: ProbabilityMap;
	choice: string;
	confidence: number;
	input_tokens: number | null;
	context_window: number | null;
}

export type Unavailable = { status: "unavailable"; reason: UnavailableReason; detail: string };

export type AdapterResult = { ok: true; answer: ProviderAnswer } | { ok: false; reason: UnavailableReason; detail: string };

export interface AdapterCall {
	point: ApplicationPoint;
	profile: Profile;
	profile_name: string;
	request: DecideRequest;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface AdapterDeps {
	env: Readonly<Record<string, string | undefined>>;
	fetch: FetchLike;
}

export type ProviderAdapter = (call: AdapterCall, deps: AdapterDeps) => Promise<AdapterResult>;

export type Truncation = "possible" | "none" | "unknown";

export interface Envelope {
	application_point: string;
	question_type: QuestionType;
	option_set: string[];
	probabilities: ProbabilityMap;
	choice: string;
	confidence: number;
	provider_kind: ProviderKind;
	profile: string;
	model: string;
	model_version: string | null;
	threshold_set_version: string;
	input_tokens: number | null;
	context_window: number | null;
	truncation: Truncation;
}

export type DecideResult = { status: "decided"; envelope: Envelope } | Unavailable;

export interface DecideDeps extends AdapterDeps {
	/** Directory holding `.imm/decision-bindings.json` and `.imm/decision-models.local.json`. */
	root: string;
	now?: () => Date;
	/** Test seam: replaces the code-owned registry (and the point ids the bindings parser accepts). */
	registry?: PointRegistry;
	/** Test seam: replaces adapters by kind. */
	adapters?: Partial<Record<ProviderKind, ProviderAdapter>>;
}

export function unavailable(reason: UnavailableReason, detail: string): Unavailable {
	return { status: "unavailable", reason, detail };
}
