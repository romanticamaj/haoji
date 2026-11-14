// RN's tsconfig omits @types/node (which would clash with RN's own timer types).
// Test files reference `global`; type it as globalThis so `global.fetch` etc. resolve.
declare var global: typeof globalThis;
