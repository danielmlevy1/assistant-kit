// `@daniellevy/assistant-kit/conformance`: the runner and manifest validator
// without zod, for consumers that only check apps (the proxy's daily check).
export { CONTRACT_VERSION, validateManifest, type Manifest, type ManifestTool } from "./manifest.js";
export { runConformance, handlerFetch, type ConformanceCheck, type ConformanceOptions, type ConformanceResult } from "./conformance.js";
