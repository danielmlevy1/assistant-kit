import { z } from "zod";
import { createAssistantRoutes, defineTool, memoryNonceStore, ToolError } from "../src/index.js";

export function sampleApp(opts: { secret?: string | undefined } = { secret: "test-secret" }) {
  const items: { id: string; name: string }[] = [{ id: "a", name: "milk" }];
  const nonces = memoryNonceStore();
  const tools = [
    defineTool({
      name: "list_items",
      kind: "read",
      description: "List the grocery items.",
      input: z.object({ query: z.string().optional() }),
      probe: {},
      run: async (_ctx, input) => items.filter((i) => !input.query || i.name.includes(input.query)),
    }),
    defineTool({
      name: "add_item",
      kind: "write",
      description: "Add a grocery item.",
      input: z.object({ name: z.string().min(1), quantity: z.number().optional() }),
      probe: { name: "conformance probe" },
      propose: async (_ctx, input) => ({ summary: `Add “${input.name}” to the grocery list` }),
      run: async (_ctx, input) => {
        const item = { id: String(items.length + 1), name: input.name };
        items.push(item);
        return item;
      },
    }),
    defineTool({
      name: "remove_item",
      kind: "write",
      description: "Remove a grocery item.",
      input: z.object({ id: z.string() }),
      propose: async (_ctx, input) => {
        const item = items.find((i) => i.id === input.id);
        if (!item) throw new ToolError("No such item.");
        return { summary: `Remove “${item.name}”` };
      },
      run: async (_ctx, input) => {
        const at = items.findIndex((i) => i.id === input.id);
        items.splice(at, 1);
        return { removed: input.id };
      },
    }),
  ];
  const routes = createAssistantRoutes({
    app: "sample",
    tools,
    nonceStore: nonces,
    secret: () => opts.secret,
    verifyUser: async (req) => {
      const m = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "");
      return m ? { uid: m[1] } : null;
    },
    onError: () => {},
  });
  return { routes, items, nonces };
}

export const URL_ = "https://app.test/api/assistant";

export async function call(routes: { POST(r: Request): Promise<Response> }, body: unknown, uid: string | null = "u1") {
  const res = await routes.POST(
    new Request(URL_, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(uid ? { Authorization: `Bearer ${uid}` } : {}) },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, data: (await res.json()) as any };
}
