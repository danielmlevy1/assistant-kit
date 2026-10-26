/**
 * The two HTTP calls every app exposes to the assistant, as Web-standard
 * handlers (Next.js App Router route exports work as-is).
 *
 *   GET  {base}            → manifest
 *   POST {base} { tool, input }   → read: { ok, result }
 *                                   write: { ok, proposal: { tool, input, summary, preview?, confirmToken } }
 *   POST {base} { execute: proposal } → verify token, burn nonce, run once → { ok, result }
 *
 * Errors are always { ok: false, code, error } with 400 / 401 / 403 / 422 / 500.
 */
import { type NonceStore } from "./confirm-token.js";
import { type AnyTool } from "./tool.js";
import type { Manifest } from "./manifest.js";
export interface AssistantRoutesOptions {
    /** App id, matching the proxy's registry (e.g. "recipes"). */
    app: string;
    tools: AnyTool[];
    /** Resolve the caller from the request (usually a Firebase ID token). Null → 401. */
    verifyUser(request: Request): Promise<{
        uid: string;
    } | null>;
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
export declare function createAssistantRoutes(opts: AssistantRoutesOptions): AssistantRoutes;
