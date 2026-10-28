/**
 * The manifest shape and its validator. No zod and no Node built-ins here, so
 * the conformance runner (and the proxy, which only consumes manifests) can
 * load it without the tool-definition side of the kit.
 */
export declare const CONTRACT_VERSION = 1;
export declare const TOOL_NAME: RegExp;
export type ToolKind = "read" | "write";
export interface ManifestTool {
    name: string;
    description: string;
    kind: ToolKind;
    input_schema: Record<string, unknown>;
    probe?: unknown;
}
export interface Manifest {
    app: string;
    contractVersion: number;
    toolsVersion: string;
    tools: ManifestTool[];
}
/** Shape check shared by the conformance runner and anyone consuming a manifest. */
export declare function validateManifest(m: unknown): string[];
