/**
 * The two HTTP calls every app exposes to the assistant, as Web-standard
 * handlers (Next.js App Router route exports work as-is).
 *
 *   GET  {base}            → manifest
 *   POST {base} { tool, input }   → read: { ok, result }
 *                                   write: { ok, proposal: { tool, input, summary, preview?, confirmToken } }
 *   POST {base} { execute: proposal } → verify token, burn nonce, run once → { ok, result, undo? }
 *     undo (tools with an `undo` hook): a signed proposal of the write that puts
 *     things back, minted like any other. It runs only if it is executed in turn.
 *
 * Errors are always { ok: false, code, error } with 400 / 401 / 403 / 422 / 500.
 */

import { ZodError } from "zod";
import {
  explainTokenFailure,
  mintConfirmToken,
  verifyConfirmToken,
  type NonceStore,
} from "./confirm-token.js";
import { buildManifest, ToolError, type AnyTool, type ToolContext, type WriteTool } from "./tool.js";
import type { Manifest } from "./manifest.js";

export interface AssistantRoutesOptions {
  /** App id, matching the proxy's registry (e.g. "recipes"). */
  app: string;
  tools: AnyTool[];
  /** Resolve the caller from the request (usually a Firebase ID token). Null → 401. */
  verifyUser(request: Request): Promise<{ uid: string } | null>;
  nonceStore: NonceStore;
  /** Defaults to process.env.AGENT_CONFIRM_SECRET. */
  secret?: () => string | undefined;
  /** Log unexpected failures (never user data). Defaults to console.error. */
  onError?: (err: unknown, tool?: string) => void;
}

export interface AssistantRoutes {
  manifest: Manifest;
  GET(request: Request): Promise<Response>;
  POST(request: Request): Promise<Response>;
  OPTIONS(request: Request): Promise<Response>;
}

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS },
  });
}

function fail(status: number, code: string, error: string, extra: Record<string, unknown> = {}): Response {
  return json({ ok: false, code, error, ...extra }, status);
}

function zodIssues(err: ZodError) {
  return err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

export function createAssistantRoutes(opts: AssistantRoutesOptions): AssistantRoutes {
  const manifest = buildManifest(opts.app, opts.tools);
  const byName = new Map(opts.tools.map((t) => [t.name, t]));
  const secret = opts.secret ?? (() => process.env.AGENT_CONFIRM_SECRET);
  const onError = opts.onError ?? ((err, tool) => console.error(`[assistant-kit] ${opts.app}${tool ? `/${tool}` : ""}`, err));

  async function runSafely(tool: AnyTool, fn: () => Promise<Response>): Promise<Response> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ToolError) return fail(422, "tool_error", err.message);
      if (err instanceof ZodError) return fail(400, "invalid_input", "Input doesn't match the tool's schema.", { issues: zodIssues(err) });
      onError(err, tool.name);
      return fail(500, "internal", "The app hit an error running that tool.");
    }
  }

  // Propose a write and sign it. Shared by calls and by undo proposals.
  async function proposeSigned(ctx: ToolContext, tool: WriteTool, rawInput: unknown, key: string) {
    const parsed = tool.input.parse(rawInput ?? {});
    const p = await tool.propose(ctx, parsed);
    // Re-parse a resolved input so what's signed is exactly what execute will accept.
    const input = p.input !== undefined ? tool.input.parse(p.input) : parsed;
    const summary = p.summary.trim();
    const confirmToken = mintConfirmToken(key, { app: opts.app, uid: ctx.uid, tool: tool.name, input, summary });
    return { app: opts.app, tool: tool.name, input, summary, ...(p.preview !== undefined ? { preview: p.preview } : {}), confirmToken };
  }

  // The undo proposal for a write that just ran, or undefined. Never fails the write.
  async function undoFor(ctx: ToolContext, tool: WriteTool, input: Record<string, unknown>, result: unknown) {
    if (!tool.undo) return undefined;
    try {
      const target = await tool.undo(ctx, input, result);
      if (!target) return undefined;
      const inverse = byName.get(target.tool);
      if (!inverse || inverse.kind !== "write") throw new Error(`undo names "${target.tool}", which is not a write tool of this app`);
      const key = secret();
      if (!key) return undefined;
      return await proposeSigned(ctx, inverse, target.input, key);
    } catch (err) {
      onError(err, `${tool.name} (undo)`);
      return undefined;
    }
  }

  async function handleCall(ctx: ToolContext, body: Record<string, unknown>): Promise<Response> {
    const tool = byName.get(String(body.tool ?? ""));
    if (!tool) return fail(400, "unknown_tool", `No tool named "${String(body.tool ?? "")}".`);
    const parsed = tool.input.safeParse(body.input ?? {});
    if (!parsed.success) return fail(400, "invalid_input", "Input doesn't match the tool's schema.", { issues: zodIssues(parsed.error) });

    return runSafely(tool, async () => {
      if (tool.kind === "read") {
        return json({ ok: true, result: await tool.run(ctx, parsed.data) });
      }
      const key = secret();
      if (!key) return fail(500, "confirm_token_unconfigured", explainTokenFailure("confirm_token_unconfigured"));
      return json({ ok: true, proposal: await proposeSigned(ctx, tool, parsed.data, key) });
    });
  }

  async function handleExecute(ctx: ToolContext, execute: Record<string, unknown>): Promise<Response> {
    const tool = byName.get(String(execute.tool ?? ""));
    if (!tool) return fail(400, "unknown_tool", `No tool named "${String(execute.tool ?? "")}".`);
    if (tool.kind !== "write") return fail(400, "not_a_write", `"${tool.name}" is a read tool; call it directly.`);

    const check = await verifyConfirmToken(
      secret(),
      { app: opts.app, uid: ctx.uid, tool: tool.name, input: execute.input, summary: String(execute.summary ?? "") },
      execute.confirmToken,
      opts.nonceStore,
    );
    if (!check.ok) return fail(403, check.reason, explainTokenFailure(check.reason));

    // The signature already pins the input; parsing gives the tool typed data.
    const parsed = tool.input.safeParse(execute.input ?? {});
    if (!parsed.success) return fail(400, "invalid_input", "Input doesn't match the tool's schema.", { issues: zodIssues(parsed.error) });
    return runSafely(tool, async () => {
      const result = await tool.run(ctx, parsed.data);
      const undo = await undoFor(ctx, tool, parsed.data, result);
      return json({ ok: true, result, ...(undo ? { undo } : {}) });
    });
  }

  return {
    manifest,

    async GET() {
      return json(manifest);
    },

    async OPTIONS() {
      return new Response(null, { status: 204, headers: CORS });
    },

    async POST(request: Request) {
      let user: { uid: string } | null = null;
      try {
        user = await opts.verifyUser(request);
      } catch {
        user = null;
      }
      if (!user?.uid) return fail(401, "unauthorized", "Sign in again.");

      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return fail(400, "bad_request", "Body must be JSON.");
      }
      if (!body || typeof body !== "object") return fail(400, "bad_request", "Body must be a JSON object.");

      const ctx: ToolContext = { app: opts.app, uid: user.uid, request };
      if (body.execute && typeof body.execute === "object") {
        return handleExecute(ctx, body.execute as Record<string, unknown>);
      }
      return handleCall(ctx, body);
    },
  };
}
