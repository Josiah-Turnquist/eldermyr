// src/boot/client.ts
//
// Browser client entry point for the Realms of Eldermyr v3 rebuild.
//
// This is a P0 scaffold placeholder. The real boot sequence (mount canvas,
// open the ws connection, drive the render loop) lands in P1 once the monolith
// is split into src/{sim,content,render,ui,audio}. It exists now so that
// `tsc --noEmit` has type-check input and esbuild has a bundle entry point.

/** Marker export so the module is non-empty under strict + isolatedModules. */
export const CLIENT_ENTRY_READY = false as const;
