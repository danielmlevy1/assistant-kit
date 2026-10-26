// `@daniellevy/assistant-kit/conformance`: the runner and manifest validator
// without zod, for consumers that only check apps (the proxy's daily check).
export { CONTRACT_VERSION, validateManifest } from "./manifest.js";
export { runConformance, handlerFetch } from "./conformance.js";
