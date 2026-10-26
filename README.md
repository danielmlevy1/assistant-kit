# assistant-kit

Shared code for the suite assistant (v2). Each app declares its tools with this kit; the proxy's `api/assistant.js` is the only place a model reasons, and it reaches apps through the two calls below. Design: launcher-site `docs/suite/assistant-design.md`.

## Install (in an app)

```json
"@daniellevy/assistant-kit": "github:danielmlevy1/assistant-kit#v0.1.0",
"zod": "^4.1.0"
```

`dist/` is committed so a git install needs no build step. CI fails if it is stale: run `npm run build` before committing.

## Contract v1

One URL per app, `{basePath}/api/assistant`:

| Call | Body | Response |
|---|---|---|
| `GET` | | manifest `{ app, contractVersion: 1, toolsVersion, tools: [{ name, description, kind, input_schema, probe? }] }` |
| `POST` | `{ tool, input }` (read) | `{ ok: true, result }` |
| `POST` | `{ tool, input }` (write) | `{ ok: true, proposal: { app, tool, input, summary, preview?, confirmToken } }`, nothing written |
| `POST` | `{ execute: proposal }` | verify token, burn nonce, run once: `{ ok: true, result }` |

Errors are `{ ok: false, code, error }`: 400 `unknown_tool` / `invalid_input` / `not_a_write` / `bad_request`, 401 `unauthorized`, 403 `confirm_token_*`, 422 `tool_error` (a refusal written for the user), 500 `internal` / `confirm_token_unconfigured`.

Rules every app keeps:
- The summary on the confirm card is written by the app's `propose`, never by the model.
- Confirm tokens are HMAC (`AGENT_CONFIRM_SECRET`) over app + uid + tool + canonical input + summary, with a single-use nonce and a 60-minute expiry. No secret means writes fail closed. A token proves the write is the one proposed, not that the user tapped confirm.
- Delete means archive, except where the app's own UI already hard-deletes.
- Ownership and sharing fields never appear in a write tool's schema.

## Defining tools

```ts
import { z } from "zod";
import { defineTool, ToolError } from "@daniellevy/assistant-kit";

export const addGroceryItem = defineTool({
  name: "add_grocery_item",
  kind: "write",
  description: "Add one line to the grocery list.",
  input: z.object({ name: z.string().min(1), quantity: z.number().optional() }),
  probe: { name: "conformance probe" },          // proposed by the daily check, never executed
  propose: async (ctx, input) => ({ summary: `Add “${input.name}” to the grocery list` }),
  run: async (ctx, input) => addGroceryItemCore(ctx.uid, input),
});
```

- Input schemas are `z.object`s without transforms (the same parse runs at propose and execute). Descriptions are written for the model and live next to the code, so they can't drift.
- `propose` may return a resolved `input` (an id looked up, a title filled in); that is what gets signed and executed. Throw `ToolError` for a refusal the user should read.
- Give at least one read tool and one write tool a `probe`.

## Routes (Next.js)

```ts
// app/api/assistant/route.ts
export const { GET, POST, OPTIONS } = createAssistantRoutes({ app: "recipes", tools, verifyUser, nonceStore });
```

`verifyUser(request)` returns `{ uid }` or null. `nonceStore.burn(uid, nonce, expiresAt)` must be atomic (a Firestore `create()`).

## Conformance

`runConformance({ url, token, fetch? })` checks the manifest, auth, unknown tools, every read probe, and that a write probe's proposal is refused when tampered with or unsigned. It never executes a write. Apps run it in vitest with `handlerFetch(routes)`; the proxy's daily check imports `@daniellevy/assistant-kit/conformance` (no zod needed) and runs the same checks over HTTPS.

## Releasing

Bump `version`, `npm run build`, commit, tag `vX.Y.Z`, then bump the tag in each app.
