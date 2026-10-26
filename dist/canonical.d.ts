/**
 * Stable JSON: keys sorted at every depth and `undefined` dropped, so a
 * round-trip through the proxy and the browser (which may reorder keys or drop
 * undefined) can't change what was signed.
 */
export declare function canonical(value: unknown): string;
