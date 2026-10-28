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
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { canonical } from "./canonical.js";
/**
 * An hour, because a confirm card can sit on screen while someone gets on with
 * their day. Safe only because the nonce is single-use.
 */
export const TOKEN_TTL_MS = 60 * 60 * 1000;
function material(p, nonce, exp) {
    return `assistant-kit/v1|${canonical({
        app: p.app,
        uid: p.uid,
        tool: p.tool,
        input: p.input ?? {},
        summary: p.summary,
    })}|${nonce}|${exp}`;
}
function mac(secret, p, nonce, exp) {
    return createHmac("sha256", secret).update(material(p, nonce, exp)).digest("base64url");
}
/** Throws `confirm_token_unconfigured` without a secret: fail closed. */
export function mintConfirmToken(secret, p, now = Date.now()) {
    if (!secret)
        throw new Error("confirm_token_unconfigured");
    const nonce = randomUUID();
    const exp = now + TOKEN_TTL_MS;
    return Buffer.from(`v1.${nonce}.${exp}.${mac(secret, p, nonce, exp)}`).toString("base64url");
}
/** Check shape, expiry and signature, then burn the nonce. */
export async function verifyConfirmToken(secret, p, token, nonces, now = Date.now()) {
    if (!secret)
        return { ok: false, reason: "confirm_token_unconfigured" };
    if (typeof token !== "string" || !token)
        return { ok: false, reason: "confirm_token_missing" };
    const parts = Buffer.from(token, "base64url").toString("utf8").split(".");
    if (parts.length !== 4 || parts[0] !== "v1")
        return { ok: false, reason: "confirm_token_malformed" };
    const [, nonce, expStr, given] = parts;
    const exp = Number(expStr);
    if (!nonce || !given || !Number.isFinite(exp))
        return { ok: false, reason: "confirm_token_malformed" };
    if (now > exp)
        return { ok: false, reason: "confirm_token_expired" };
    const a = Buffer.from(given);
    const b = Buffer.from(mac(secret, p, nonce, exp));
    if (a.length !== b.length || !timingSafeEqual(a, b))
        return { ok: false, reason: "confirm_token_mismatch" };
    // Any failure to burn is treated as a replay: refusing a legitimate write is
    // far cheaper than running one twice.
    const fresh = await nonces.burn(p.uid, nonce, exp).catch(() => false);
    return fresh ? { ok: true } : { ok: false, reason: "confirm_token_replayed" };
}
/** Human-readable reason, safe to show in a chat reply. */
export function explainTokenFailure(reason) {
    switch (reason) {
        case "confirm_token_unconfigured":
            return "The app isn't configured to verify confirmations (AGENT_CONFIRM_SECRET is unset), so nothing was changed.";
        case "confirm_token_missing":
            return "That action didn't carry a confirmation, so it wasn't run.";
        case "confirm_token_expired":
            return "That confirmation expired. Ask again and confirm the new one.";
        case "confirm_token_replayed":
            return "That confirmation was already used, so nothing was changed.";
        case "confirm_token_mismatch":
            return "That action didn't match what was proposed, so it wasn't run.";
        default:
            return "That confirmation couldn't be verified, so nothing was changed.";
    }
}
/** In-memory store for tests and local dev. Not for production. */
export function memoryNonceStore() {
    const used = new Set();
    return {
        used,
        async burn(uid, nonce) {
            const key = `${uid}/${nonce}`;
            if (used.has(key))
                return false;
            used.add(key);
            return true;
        },
    };
}
