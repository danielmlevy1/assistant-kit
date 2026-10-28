import { describe, expect, it } from "vitest";
import { handlerFetch, runConformance } from "../src/index.js";
import { sampleApp, URL_ } from "./fixture.js";

describe("runConformance", () => {
  it("passes a conforming app and never executes a write", async () => {
    const { routes, items, nonces } = sampleApp();
    const r = await runConformance({ url: URL_, token: "u1", fetch: handlerFetch(routes) });
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.app).toBe("sample");
    expect(items).toHaveLength(1);
    expect(nonces.used.size).toBe(0);
  });

  it("fails an app that executes without checking the token", async () => {
    const { routes } = sampleApp();
    const naive = {
      GET: routes.GET,
      async POST(req: Request) {
        const body = (await req.clone().json()) as any;
        if (body.execute) return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
        return routes.POST(req);
      },
    };
    const r = await runConformance({ url: URL_, token: "u1", fetch: handlerFetch(naive) });
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name === "refuses a tampered proposal")?.ok).toBe(false);
  });

  it("fails an unreachable manifest", async () => {
    const r = await runConformance({ url: URL_, token: "u1", fetch: (async () => new Response("nope", { status: 404 })) as typeof fetch });
    expect(r.ok).toBe(false);
    expect(r.checks[0].name).toBe("manifest");
  });
});
