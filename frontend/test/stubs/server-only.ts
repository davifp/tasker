// No-op stand-in for `server-only` — the real module intentionally throws in
// any non-server import path (RSC dev + prod bundles). Under vitest we are
// running the code from Node with no browser bundle in play, so the guard
// serves no purpose and blocks us from unit-testing server modules.
export {};
