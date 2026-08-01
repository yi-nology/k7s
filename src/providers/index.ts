/**
 * Provider injection — single entry point for "which data source".
 *
 * `VITE_DEMO=1` (vite env) → MockProvider; otherwise → TauriProvider.
 * Components import `useProvider()` and never see either directly.
 */

import { TauriProvider } from "./tauri/TauriProvider";
import { MockProvider } from "./mock/MockProvider";

import type { DataProvider } from "./types";

/**
 * The single shared provider instance. Picked at module load time
 * (vite replaces `import.meta.env.VITE_DEMO` at build).
 *
 * - `npm run dev`     → MockProvider if VITE_DEMO=1
 * - `npm run tauri:dev` → TauriProvider (no env var)
 */
const useMock =
  typeof import.meta !== "undefined" &&
  (import.meta as { env?: Record<string, string> }).env?.VITE_DEMO === "1";

export const provider: DataProvider = useMock
  ? new MockProvider()
  : new TauriProvider();

export { TauriProvider, MockProvider };
export type { DataProvider } from "./types";
