// Vitest stand-in for Next's built-in `server-only` marker (vitest.config.ts aliases it here). Next resolves the real
// one at build time, where importing a server-only module from a client component fails the build.
export {};
