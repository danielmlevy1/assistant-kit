/**
 * Conformance runner: proves an app's assistant endpoint honours contract v1.
 * Used by each app's tests (in-process, via a `fetch` that calls the handlers)
 * and by the proxy's daily check (over HTTPS with a real credential).
 *
 * It never executes a write: a write probe is proposed, then executed only
 * with a tampered summary or no token, both of which must be refused.
 */
export interface ConformanceOptions {
    /** The app's assistant URL, e.g. https://daniellevy.app/recipes/api/assistant */
    url: string;
    /** Bearer credential for a real user. */
    token: string;
    fetch?: typeof fetch;
}
export interface ConformanceCheck {
    name: string;
    ok: boolean;
    detail?: string;
}
export interface ConformanceResult {
    ok: boolean;
    app?: string;
    toolsVersion?: string;
    checks: ConformanceCheck[];
}
export declare function runConformance(opts: ConformanceOptions): Promise<ConformanceResult>;
/** A `fetch` that calls route handlers in-process, for app tests. */
export declare function handlerFetch(handlers: {
    GET(r: Request): Promise<Response>;
    POST(r: Request): Promise<Response>;
}): typeof fetch;
