/**
 * The app version, baked in at build time from package.json (see the
 * `define` block in vite.config.ts). Falls back to "dev" when the define is
 * absent (unit tests run through vitest's node transform).
 */
export const APP_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
