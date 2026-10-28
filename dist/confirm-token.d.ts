/**
 * Confirm tokens: bind an executed write to a proposal the app actually made.
 *
 * Lifted from recipes `lib/agent/confirm-token.ts`, with two changes:
 *   - the signed material also covers the app id and the caller's uid, so a
 *     token minted for one user (or one app) can't be replayed as another;
 *   - the nonce burn is part of `verify` (through a `NonceStore`), so a caller
 *     can't verify and forget to burn.
 *
 * HONEST CEILING: this does NOT prove the user tapped confirm. That can only be
 * asserted by the UI that drew the button. It closes forged, mutated, expired
 * and replayed executes, which is the part an app can enforce.
 */
/**
 * An hour, because a confirm card can sit on screen while someone gets on with
 * their day. Safe only because the nonce is single-use.
 */
export declare const TOKEN_TTL_MS: number;
export interface SignedProposal {
    app: string;
    uid: string;
    tool: string;
    input: unknown;
    summary: string;
}
export type TokenFailure = "confirm_token_unconfigured" | "confirm_token_missing" | "confirm_token_malformed" | "confirm_token_expired" | "confirm_token_mismatch" | "confirm_token_replayed";
/** Where burnt nonces live. `burn` must be atomic: false if already used. */
export interface NonceStore {
    burn(uid: string, nonce: string, expiresAt: number): Promise<boolean>;
}
/** Throws `confirm_token_unconfigured` without a secret: fail closed. */
export declare function mintConfirmToken(secret: string | undefined, p: SignedProposal, now?: number): string;
export type TokenCheck = {
    ok: true;
} | {
    ok: false;
    reason: TokenFailure;
};
/** Check shape, expiry and signature, then burn the nonce. */
export declare function verifyConfirmToken(secret: string | undefined, p: SignedProposal, token: unknown, nonces: NonceStore, now?: number): Promise<TokenCheck>;
/** Human-readable reason, safe to show in a chat reply. */
export declare function explainTokenFailure(reason: TokenFailure): string;
/** In-memory store for tests and local dev. Not for production. */
export declare function memoryNonceStore(): NonceStore & {
    used: Set<string>;
};
