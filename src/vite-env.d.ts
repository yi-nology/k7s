/// <reference types="vite/client" />

// Typed access to the app's Vite env vars (see providers/index.ts).
interface ImportMetaEnv {
  /** "1" enables demo mode (MockProvider instead of the real Tauri backend). */
  readonly VITE_DEMO?: string;
  /**
   * Demo-only stress fixture for table virtualization (B21): a row count that
   * pads the mock pods list to that many synthetic rows, e.g.
   * `VITE_DEMO=1 VITE_STRESS=5000 npm run dev`. Ignored outside demo mode.
   */
  readonly VITE_STRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Tauri's webview attaches a non-standard `path` (the absolute filesystem path)
// to File objects dropped from the OS or picked via the native dialog. The DOM
// lib doesn't know about it, so `as any` was the escape hatch — declare it here
// so callers stay typed. (Web browsers don't populate this; it's Tauri-only.)
interface File {
  readonly path?: string;
}
