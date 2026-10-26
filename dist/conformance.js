/**
 * Conformance runner: proves an app's assistant endpoint honours contract v1.
 * Used by each app's tests (in-process, via a `fetch` that calls the handlers)
 * and by the proxy's daily check (over HTTPS with a real credential).
 *
 * It never executes a write: a write probe is proposed, then executed only
 * with a tampered summary or no token, both of which must be refused.
 */
import { validateManifest } from "./manifest.js";
export async function runConformance(opts) {
    const f = opts.fetch ?? fetch;
    const checks = [];
    const check = (name, ok, detail) => {
        checks.push({ name, ok, ...(detail ? { detail } : {}) });
        return ok;
    };
    const post = async (body, auth = true) => {
        const res = await f(opts.url, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${opts.token}` } : {}) },
            body: JSON.stringify(body),
        });
        const data = (await res.json().catch(() => ({})));
        return { status: res.status, data };
    };
    let manifest;
    try {
        const res = await f(opts.url, { method: "GET" });
        manifest = (await res.json());
        const errors = validateManifest(manifest);
        if (!check("manifest", res.ok && !errors.length, errors.join("; ") || (res.ok ? undefined : `HTTP ${res.status}`))) {
            return { ok: false, checks };
        }
    }
    catch (err) {
        check("manifest", false, err instanceof Error ? err.message : String(err));
        return { ok: false, checks };
    }
    const unauth = await post({ tool: manifest.tools[0].name, input: {} }, false);
    check("rejects unauthenticated calls", unauth.status === 401, `HTTP ${unauth.status}`);
    const unknown = await post({ tool: "__no_such_tool__", input: {} });
    check("rejects unknown tools", unknown.status === 400 && unknown.data.code === "unknown_tool", `HTTP ${unknown.status}`);
    for (const t of manifest.tools.filter((x) => x.kind === "read" && x.probe !== undefined)) {
        const r = await post({ tool: t.name, input: t.probe });
        check(`read ${t.name}`, r.status === 200 && r.data.ok === true, r.data.error ?? `HTTP ${r.status}`);
    }
    if (!manifest.tools.some((x) => x.kind === "read" && x.probe !== undefined)) {
        check("has a read probe", false, "no read tool declares a probe");
    }
    const write = manifest.tools.find((x) => x.kind === "write" && x.probe !== undefined);
    if (write) {
        const proposed = await post({ tool: write.name, input: write.probe });
        const proposal = proposed.data.proposal;
        if (check(`propose ${write.name}`, proposed.status === 200 && typeof proposal?.confirmToken === "string", proposed.data.error ?? `HTTP ${proposed.status}`)) {
            const tampered = await post({ execute: { ...proposal, summary: `${proposal.summary} (tampered)` } });
            check("refuses a tampered proposal", tampered.status === 403 && tampered.data.code === "confirm_token_mismatch", `HTTP ${tampered.status} ${tampered.data.code ?? ""}`.trim());
            const { confirmToken: _drop, ...unsigned } = proposal;
            const missing = await post({ execute: unsigned });
            check("refuses an unsigned proposal", missing.status === 403 && missing.data.code === "confirm_token_missing", `HTTP ${missing.status} ${missing.data.code ?? ""}`.trim());
        }
    }
    else if (manifest.tools.some((x) => x.kind === "write")) {
        check("has a write probe", false, "no write tool declares a probe");
    }
    return { ok: checks.every((c) => c.ok), app: manifest.app, toolsVersion: manifest.toolsVersion, checks };
}
/** A `fetch` that calls route handlers in-process, for app tests. */
export function handlerFetch(handlers) {
    return (async (input, init) => {
        const req = new Request(input instanceof Request ? input.url : String(input), init);
        return req.method === "GET" ? handlers.GET(req) : handlers.POST(req);
    });
}
