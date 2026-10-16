// Announced to the frame during the handshake. test/repro-version.mjs fails the
// build if MODULE_VERSION drifts from package.json (2026.0.9-beta.N -> 2026.0.9.N).
export const MODULE_VERSION = '2026.0.9.5'
export const MODULE_BUILD_DATE = 'Oct 16 2026'
