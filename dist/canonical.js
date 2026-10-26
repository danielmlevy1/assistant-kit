/**
 * Stable JSON: keys sorted at every depth and `undefined` dropped, so a
 * round-trip through the proxy and the browser (which may reorder keys or drop
 * undefined) can't change what was signed.
 */
export function canonical(value) {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value) ?? "null";
    if (Array.isArray(value))
        return `[${value.map((v) => (v === undefined ? "null" : canonical(v))).join(",")}]`;
    const entries = Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}
