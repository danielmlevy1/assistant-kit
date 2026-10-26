/**
 * Tool definitions. Each app declares its tools next to its write cores; the
 * manifest (names, descriptions, JSON Schemas) is generated from these, so the
 * assistant's view of an app can't drift from the code that runs.
 */

import { z } from "zod";
import { canonical } from "./canonical.js";
import { createHash } from "node:crypto";
import { CONTRACT_VERSION, TOOL_NAME, type Manifest, type ManifestTool } from "./manifest.js";

export type { ToolKind } from "./manifest.js";
import type { ToolKind } from "./manifest.js";

export interface ToolContext {
  app: string;
  uid: string;
  request: Request;
}

/** Throw from `propose` or `run` for a refusal the user should see verbatim. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
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

export function defineTool<S extends Schema, R>(def: ReadTool<S, R>): ReadTool<S, R>;
export function defineTool<S extends Schema, R>(def: WriteTool<S, R>): WriteTool<S, R>;
export function defineTool(def: AnyTool): AnyTool {
  if (!TOOL_NAME.test(def.name)) throw new Error(`Tool name "${def.name}" must be snake_case, under 48 chars.`);
  if (!def.description?.trim()) throw new Error(`Tool "${def.name}" needs a description.`);
  if (def.probe !== undefined) def.input.parse(def.probe);
  return def;
}

function jsonSchema(schema: Schema): Record<string, unknown> {
  const out = z.toJSONSchema(schema, { io: "input", unrepresentable: "throw" }) as Record<string, unknown>;
  delete out.$schema;
  return out;
}

export function buildManifest(app: string, tools: AnyTool[]): Manifest {
  const seen = new Set<string>();
  for (const t of tools) {
    if (seen.has(t.name)) throw new Error(`Duplicate tool name "${t.name}".`);
    seen.add(t.name);
  }
  const list: ManifestTool[] = tools.map((t) => ({
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
