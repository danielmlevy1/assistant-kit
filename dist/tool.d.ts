/**
 * Tool definitions. Each app declares its tools next to its write cores; the
 * manifest (names, descriptions, JSON Schemas) is generated from these, so the
 * assistant's view of an app can't drift from the code that runs.
 */
import { z } from "zod";
import { type Manifest } from "./manifest.js";
export type { ToolKind } from "./manifest.js";
export interface ToolContext {
    app: string;
    uid: string;
    request: Request;
}
/** Throw from `propose` or `run` for a refusal the user should see verbatim. */
export declare class ToolError extends Error {
    constructor(message: string);
}
type Schema = z.ZodObject<z.ZodRawShape>;
interface ToolBase<S extends Schema> {
    /** snake_case, unique within the app. The proxy prefixes it (`recipes__plan_meal`). */
    name: string;
    /** Written for the model: when to use it, what it returns, what it can't do. */
    description: string;
    /** Must be a z.object without transforms: the same parse runs at propose and execute. */
    input: S;
    /**
     * A harmless input for the conformance check. Read tools are called with it;
     * a write tool's probe is proposed but never executed.
     */
    probe?: z.input<S>;
}
export interface ReadTool<S extends Schema = Schema, R = unknown> extends ToolBase<S> {
    kind: "read";
    run(ctx: ToolContext, input: z.output<S>): Promise<R>;
}
export interface Proposal<I> {
    /** One line shown on the confirm card, written by the app, never by the model. */
    summary: string;
    /** Optional resolved input (ids looked up, titles filled in). This is what gets signed and executed. */
    input?: I;
    /** Extra display data for the confirm card. Not signed, never executed. */
    preview?: unknown;
}
export interface WriteTool<S extends Schema = Schema, R = unknown> extends ToolBase<S> {
    kind: "write";
    /** Check the write against live data and describe it. Writes nothing. */
    propose(ctx: ToolContext, input: z.output<S>): Promise<Proposal<z.output<S>>>;
    /** Perform exactly this one write through the app's write core. */
    run(ctx: ToolContext, input: z.output<S>): Promise<R>;
}
export type AnyTool = ReadTool<any, any> | WriteTool<any, any>;
export declare function defineTool<S extends Schema, R>(def: ReadTool<S, R>): ReadTool<S, R>;
export declare function defineTool<S extends Schema, R>(def: WriteTool<S, R>): WriteTool<S, R>;
export declare function buildManifest(app: string, tools: AnyTool[]): Manifest;
