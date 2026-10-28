/**
 * The manifest shape and its validator. No zod and no Node built-ins here, so
 * the conformance runner (and the proxy, which only consumes manifests) can
 * load it without the tool-definition side of the kit.
 */
export const CONTRACT_VERSION = 1;
export const TOOL_NAME = /^[a-z][a-z0-9_]{0,47}$/;
/** Shape check shared by the conformance runner and anyone consuming a manifest. */
export function validateManifest(m) {
    const errors = [];
    const o = m;
    if (!o || typeof o !== "object")
        return ["manifest is not an object"];
    if (typeof o.app !== "string" || !o.app)
        errors.push("app missing");
    if (o.contractVersion !== CONTRACT_VERSION)
        errors.push(`contractVersion is ${String(o.contractVersion)}, expected ${CONTRACT_VERSION}`);
    if (typeof o.toolsVersion !== "string" || !o.toolsVersion)
        errors.push("toolsVersion missing");
    if (!Array.isArray(o.tools) || !o.tools.length)
        return [...errors, "tools missing or empty"];
    const names = new Set();
    for (const t of o.tools) {
        const label = typeof t?.name === "string" ? t.name : "(unnamed)";
        if (!TOOL_NAME.test(String(t?.name)))
            errors.push(`${label}: bad name`);
        if (names.has(label))
            errors.push(`${label}: duplicate`);
        names.add(label);
        if (typeof t?.description !== "string" || !t.description)
            errors.push(`${label}: no description`);
        if (t?.kind !== "read" && t?.kind !== "write")
            errors.push(`${label}: kind must be read or write`);
        if (!t?.input_schema || t.input_schema.type !== "object")
            errors.push(`${label}: input_schema must be an object schema`);
    }
    return errors;
}
