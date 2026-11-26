// The literal-user authority identity, spelled once.
//
// Audit survey before the convergence (122 settled records under .imm/audit/,
// counting every `actor_id` in each record): `literal-user` appears 220 times
// across 54 records — the spelling Pi has recorded since the first managed
// task. The shortened `user` appears 4 times, all of them in three
// Claude-Host-era records, and the Kernel's own batch validation already
// demanded "a literal-user actor_id" while accepting the string "user". The
// converged spelling is therefore `literal-user`.
//
// Settled records are never rewritten: the reader keeps accepting both
// spellings, so a historical `user` audit or a batch capability issued before
// the convergence still validates and stays byte-identical. Every newly written
// record carries the canonical spelling.

export const LITERAL_USER_ACTOR_ID = "literal-user";

/** Spellings that mean the literal user. Both are read; only one is written. */
const LITERAL_USER_SPELLINGS: ReadonlySet<string> = new Set([LITERAL_USER_ACTOR_ID, "user"]);

/** True for a historical or current literal-user actor. */
export function isLiteralUserActor(actorId: string): boolean {
	return LITERAL_USER_SPELLINGS.has(actorId);
}

/**
 * The spelling to record. A historical `user` is read as what it meant and
 * recorded as the canonical identity; every other actor is passed through
 * unchanged.
 */
export function canonicalActorId(actorId: string): string {
	return actorId === "user" ? LITERAL_USER_ACTOR_ID : actorId;
}
