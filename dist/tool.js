/**
 * Tool definitions. Each app declares its tools next to its write cores; the
 * manifest (names, descriptions, JSON Schemas) is generated from these, so the
 * assistant's view of an app can't drift from the code that runs.
 */
import { z } from "zod";
import { canonical } from "./canonical.js";
import { createHash } from "node:crypto";
import { CONTRACT_VERSION, TOOL_NAME } from "./manifest.js";
/** Throw from `propose` or `run` for a refusal the user should see verbatim. */
export class ToolError extends Error {
    constructor(message) {
        super(message);
        this.name = "ToolError";
    }
}
export function defineTool(def) {
    if (!TOOL_NAME.test(def.name))
        throw new Error(`Tool name "${def.name}" must be snake_case, under 48 chars.`);
    if (!def.description?.trim())
        throw new Error(`Tool "${def.name}" needs a description.`);
    if (def.probe !== undefined)
        def.input.parse(def.probe);
    return def;
}
function jsonSchema(schema) {
    const out = z.toJSONSchema(schema, { io: "input", unrepresentable: "throw" });
    delete out.$schema;
    return out;
}
export function buildManifest(app, tools) {
    const seen = new Set();
    for (const t of tools) {
        if (seen.has(t.name))
            throw new Error(`Duplicate tool name "${t.name}".`);
        seen.add(t.name);
    }
    const list = tools.map((t) => ({
        name: t.name,
        description: t.description.trim(),
        kind: t.kind,
        input_schema: jsonSchema(t.input),
        ...(t.probe !== undefined ? { probe: t.probe } : {}),
    }));
    const toolsVersion = createHash("sha256")
        .update(canonical({ app, contractVersion: CONTRACT_VERSION, tools: list }))
        .digest("hex")
        .slice(0, 16);
    return { app, contractVersion: CONTRACT_VERSION, toolsVersion, tools: list };
}
