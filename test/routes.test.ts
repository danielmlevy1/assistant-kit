import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildManifest, defineTool } from "../src/index.js";
import { call, sampleApp, URL_ } from "./fixture.js";

describe("manifest", () => {
  it("lists tools with JSON schemas and a stable version", async () => {
    const { routes } = sampleApp();
    const m = (await (await routes.GET(new Request(URL_))).json()) as any;
    expect(m.app).toBe("sample");
    expect(m.contractVersion).toBe(1);
    expect(m.tools.map((t: any) => t.name)).toEqual(["list_items", "add_item", "remove_item", "restore_item"]);
    const add = m.tools.find((t: any) => t.name === "add_item");
    expect(add.input_schema).toMatchObject({ type: "object", required: ["name"] });
    expect(add.input_schema.$schema).toBeUndefined();
    expect(sampleApp().routes.manifest.toolsVersion).toBe(m.toolsVersion);
  });

  it("changes toolsVersion when a schema changes", () => {
    const mk = (s: z.ZodObject<any>) =>
      buildManifest("x", [defineTool({ name: "t", kind: "read", description: "d", input: s, run: async () => null })]).toolsVersion;
    expect(mk(z.object({ a: z.string() }))).not.toBe(mk(z.object({ a: z.number() })));
  });

  it("rejects bad tool names and duplicates", () => {
    expect(() => defineTool({ name: "Bad-Name", kind: "read", description: "d", input: z.object({}), run: async () => null })).toThrow();
    const t = defineTool({ name: "t", kind: "read", description: "d", input: z.object({}), run: async () => null });
    expect(() => buildManifest("x", [t, t])).toThrow(/Duplicate/);
  });
});

describe("calls", () => {
  it("runs a read tool", async () => {
    const { routes } = sampleApp();
    const r = await call(routes, { tool: "list_items", input: { query: "mi" } });
    expect(r).toEqual({ status: 200, data: { ok: true, result: [{ id: "a", name: "milk" }] } });
  });

  it("proposes a write without writing, then executes it exactly once", async () => {
    const { routes, items } = sampleApp();
    const p = await call(routes, { tool: "add_item", input: { name: "eggs" } });
    expect(p.status).toBe(200);
    expect(p.data.proposal).toMatchObject({ app: "sample", tool: "add_item", input: { name: "eggs" }, summary: "Add “eggs” to the grocery list" });
    expect(items).toHaveLength(1);

    const e = await call(routes, { execute: p.data.proposal });
    expect(e.status).toBe(200);
    expect(e.data).toMatchObject({ ok: true, result: { id: "2", name: "eggs" } });
    expect(items).toHaveLength(2);

    const again = await call(routes, { execute: p.data.proposal });
    expect(again.status).toBe(403);
    expect(again.data.code).toBe("confirm_token_replayed");
    expect(items).toHaveLength(2);
  });

  it("refuses an execute with a changed input", async () => {
    const { routes, items } = sampleApp();
    const p = await call(routes, { tool: "add_item", input: { name: "eggs" } });
    const e = await call(routes, { execute: { ...p.data.proposal, input: { name: "caviar" } } });
    expect(e.status).toBe(403);
    expect(e.data.code).toBe("confirm_token_mismatch");
    expect(items).toHaveLength(1);
  });

  it("refuses another user's proposal", async () => {
    const { routes } = sampleApp();
    const p = await call(routes, { tool: "add_item", input: { name: "eggs" } }, "u1");
    const e = await call(routes, { execute: p.data.proposal }, "u2");
    expect(e.data.code).toBe("confirm_token_mismatch");
  });

  it("refuses executing a read tool", async () => {
    const { routes } = sampleApp();
    const e = await call(routes, { execute: { tool: "list_items", input: {} } });
    expect(e.status).toBe(400);
    expect(e.data.code).toBe("not_a_write");
  });

  it("returns 401 without a user, 400 for bad input or unknown tools", async () => {
    const { routes } = sampleApp();
    expect((await call(routes, { tool: "list_items" }, null)).status).toBe(401);
    const bad = await call(routes, { tool: "add_item", input: { name: 5 } });
    expect(bad.status).toBe(400);
    expect(bad.data.code).toBe("invalid_input");
    expect(bad.data.issues[0].path).toBe("name");
    expect((await call(routes, { tool: "nope" })).data.code).toBe("unknown_tool");
  });

  it("surfaces ToolError as 422 with the message", async () => {
    const { routes } = sampleApp();
    const r = await call(routes, { tool: "remove_item", input: { id: "zzz" } });
    expect(r).toEqual({ status: 422, data: { ok: false, code: "tool_error", error: "No such item." } });
  });

  it("fails closed without a secret", async () => {
    const { routes } = sampleApp({ secret: undefined });
    const r = await call(routes, { tool: "add_item", input: { name: "eggs" } });
    expect(r.status).toBe(500);
    expect(r.data.code).toBe("confirm_token_unconfigured");
    expect((await call(routes, { tool: "list_items", input: {} })).status).toBe(200);
  });

  it("answers CORS preflight", async () => {
    const { routes } = sampleApp();
    const r = await routes.OPTIONS(new Request(URL_, { method: "OPTIONS" }));
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-headers")).toMatch(/Authorization/);
  });
});

describe("undo", () => {
  it("marks undoable writes in the manifest", () => {
    const tools = sampleApp().routes.manifest.tools;
    expect(tools.find((t) => t.name === "remove_item")?.undoable).toBe(true);
    expect(tools.find((t) => t.name === "restore_item")?.undoable).toBeUndefined();
    expect(tools.find((t) => t.name === "list_items")?.undoable).toBeUndefined();
  });

  it("returns a signed undo proposal that puts things back once", async () => {
    const { routes, items } = sampleApp();
    const p = await call(routes, { tool: "remove_item", input: { id: "a" } });
    const e = await call(routes, { execute: p.data.proposal });
    expect(items).toHaveLength(0);
    expect(e.data.undo).toMatchObject({ app: "sample", tool: "restore_item", input: { id: "a" }, summary: "Put “milk” back on the grocery list" });
    expect(typeof e.data.undo.confirmToken).toBe("string");

    const u = await call(routes, { execute: e.data.undo });
    expect(u.status).toBe(200);
    expect(items.map((i) => i.name)).toEqual(["milk"]);
    expect(u.data.undo).toBeUndefined(); // restore_item has no undo of its own

    expect((await call(routes, { execute: e.data.undo })).data.code).toBe("confirm_token_replayed");
  });

  it("binds the undo to the same user", async () => {
    const { routes, items } = sampleApp();
    const p = await call(routes, { tool: "remove_item", input: { id: "a" } }, "u1");
    const e = await call(routes, { execute: p.data.proposal }, "u1");
    expect((await call(routes, { execute: e.data.undo }, "u2")).data.code).toBe("confirm_token_mismatch");
    expect(items).toHaveLength(0);
  });

  it("refuses an undo whose input was changed", async () => {
    const { routes } = sampleApp();
    const p = await call(routes, { tool: "add_item", input: { name: "eggs" } });
    const e = await call(routes, { execute: p.data.proposal });
    expect(e.data.undo).toMatchObject({ tool: "remove_item", input: { id: "2" } });
    const r = await call(routes, { execute: { ...e.data.undo, input: { id: "a" } } });
    expect(r.data.code).toBe("confirm_token_mismatch");
  });

  it("still reports the write when the undo hook fails", async () => {
    const { routes, items } = sampleApp({ secret: "test-secret", brokenUndo: true });
    const p = await call(routes, { tool: "add_item", input: { name: "eggs" } });
    const e = await call(routes, { execute: p.data.proposal });
    expect(e).toEqual({ status: 200, data: { ok: true, result: { id: "2", name: "eggs" } } });
    expect(items).toHaveLength(2);
  });

  it("only lets write tools declare undo", () => {
    expect(() =>
      defineTool({ name: "t", kind: "read", description: "d", input: z.object({}), run: async () => null, undo: () => null } as any),
    ).toThrow(/only write tools/);
  });
});
