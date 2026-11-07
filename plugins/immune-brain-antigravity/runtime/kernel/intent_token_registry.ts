// R2C2 internal intent-token registry. NOT exported from kernel/index.ts.
// Owns the opaque brand, identity store, and single-use inspect/consume
// operations shared between the R2C1 reader (mint) and the R2C2 application
// port (inspect/consume).

const TOKEN_BRAND = Symbol("assurance-kernel-task-intent-identity-token");

export interface TaskIntentIdentityToken {
	readonly [TOKEN_BRAND]: true;
}

export interface TokenIdentity {
	canonical_root: string;
	sidecar_path: string;
	path_dev: number;
	path_ino: number;
	fd_dev: number;
	fd_ino: number;
	fd_size: number;
	fd_mtime_ms: number;
	source_bytes_sha256: string;
	intent_content_hash: string;
}

const tokenIdentities = new WeakMap<object, TokenIdentity>();
const consumedTokens = new WeakSet<object>();

export function isIntentIdentityToken(value: unknown): value is TaskIntentIdentityToken {
	return (
		!!value &&
		typeof value === "object" &&
		(value as TaskIntentIdentityToken)[TOKEN_BRAND] === true
	);
}

export function mintToken(identity: TokenIdentity): TaskIntentIdentityToken {
	const token = Object.freeze(
		Object.defineProperty({}, TOKEN_BRAND, {
			value: true,
			enumerable: false,
			writable: false,
			configurable: false,
		}),
	) as TaskIntentIdentityToken;
	tokenIdentities.set(token, identity);
	return token;
}

function identityOf(token: TaskIntentIdentityToken): TokenIdentity {
	const identity = tokenIdentities.get(token);
	if (!identity) throw new Error("intent identity token is not recognized");
	return identity;
}

/** Inspect a prior/current token pair without consuming. Returns identities. */
export function inspectIntentTokenPair(
	prior: TaskIntentIdentityToken,
	current: TaskIntentIdentityToken,
): { prior: TokenIdentity; current: TokenIdentity } {
	if (!isIntentIdentityToken(prior) || !isIntentIdentityToken(current))
		throw new Error("intent identity tokens are required");
	if (consumedTokens.has(prior) || consumedTokens.has(current))
		throw new Error("intent identity token is already consumed");
	const priorIdentity = identityOf(prior);
	const currentIdentity = identityOf(current);
	if (priorIdentity.canonical_root !== currentIdentity.canonical_root)
		throw new Error("intent token canonical root mismatch");
	return { prior: priorIdentity, current: currentIdentity };
}

/** Consume one token irreversibly. Returns its identity. */
export function consumeIntentToken(token: TaskIntentIdentityToken): TokenIdentity {
	if (!isIntentIdentityToken(token))
		throw new Error("intent identity token is required");
	if (consumedTokens.has(token))
		throw new Error("intent identity token is already consumed");
	const identity = identityOf(token);
	consumedTokens.add(token);
	return identity;
}
