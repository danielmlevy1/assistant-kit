import { describe, expect, it } from "vitest";
import { memoryNonceStore, mintConfirmToken, TOKEN_TTL_MS, verifyConfirmToken, type SignedProposal } from "../src/index.js";

const S = "secret";
const base: SignedProposal = { app: "recipes", uid: "u1", tool: "add_item", input: { name: "milk", quantity: 2 }, summary: "Add milk" };

describe("confirm tokens", () => {
  it("verifies an untouched proposal once", async () => {
    const nonces = memoryNonceStore();
    const token = mintConfirmToken(S, base);
    expect(await verifyConfirmToken(S, base, token, nonces)).toEqual({ ok: true });
    expect(await verifyConfirmToken(S, base, token, nonces)).toEqual({ ok: false, reason: "confirm_token_replayed" });
  });

  it("ignores key order", async () => {
    const token = mintConfirmToken(S, base);
    const reordered = { ...base, input: { quantity: 2, name: "milk" } };
    expect((await verifyConfirmToken(S, reordered, token, memoryNonceStore())).ok).toBe(true);
  });

  it.each([
    ["input", { input: { name: "milk", quantity: 3 } }],
    ["summary", { summary: "Add oat milk" }],
    ["tool", { tool: "remove_item" }],
    ["uid", { uid: "someone-else" }],
    ["app", { app: "tax" }],
  ])("refuses a changed %s", async (_label, change) => {
    const token = mintConfirmToken(S, base);
    const r = await verifyConfirmToken(S, { ...base, ...change }, token, memoryNonceStore());
    expect(r).toEqual({ ok: false, reason: "confirm_token_mismatch" });
  });

  it("refuses a token signed with another secret", async () => {
    const token = mintConfirmToken("other", base);
    expect(await verifyConfirmToken(S, base, token, memoryNonceStore())).toEqual({ ok: false, reason: "confirm_token_mismatch" });
  });

  it("expires after the TTL", async () => {
    const now = 1_000_000;
    const token = mintConfirmToken(S, base, now);
    expect((await verifyConfirmToken(S, base, token, memoryNonceStore(), now + TOKEN_TTL_MS - 1)).ok).toBe(true);
    expect(await verifyConfirmToken(S, base, token, memoryNonceStore(), now + TOKEN_TTL_MS + 1)).toEqual({ ok: false, reason: "confirm_token_expired" });
  });

  it("fails closed without a secret", async () => {
    expect(() => mintConfirmToken(undefined, base)).toThrow("confirm_token_unconfigured");
    const token = mintConfirmToken(S, base);
    expect(await verifyConfirmToken(undefined, base, token, memoryNonceStore())).toEqual({ ok: false, reason: "confirm_token_unconfigured" });
  });

  it("rejects missing and malformed tokens", async () => {
    const n = memoryNonceStore();
    expect(await verifyConfirmToken(S, base, undefined, n)).toEqual({ ok: false, reason: "confirm_token_missing" });
    expect(await verifyConfirmToken(S, base, "garbage", n)).toEqual({ ok: false, reason: "confirm_token_malformed" });
    expect(await verifyConfirmToken(S, base, Buffer.from("v1.a.b.c").toString("base64url"), n)).toEqual({ ok: false, reason: "confirm_token_malformed" });
  });

  it("treats a failing nonce store as a replay", async () => {
    const token = mintConfirmToken(S, base);
    const broken = { burn: async () => { throw new Error("firestore down"); } };
    expect(await verifyConfirmToken(S, base, token, broken)).toEqual({ ok: false, reason: "confirm_token_replayed" });
  });
});
