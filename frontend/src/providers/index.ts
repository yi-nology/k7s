/**
 * Provider selection. Exactly one {@link DataProvider} is constructed for the app:
 *   - demo mode (VITE_DEMO=1): MockProvider — runs anywhere, no cluster
 *   - desktop:                TauriProvider — talks to the Rust backend over Tauri IPC
 *   - browser:                HttpProvider — talks to the k7s-web axum server
 *
 * The first two are picked at module load time; the third is decided by
 * {@link IS_TAURI}, which is `false` in a plain browser tab. Components import
 * `getProvider()` and never see a concrete class, keeping the three
 * implementations interchangeable.
 */

import type { DataProvider } from './types';
import { MockProvider } from './mock/MockProvider';
import { TauriProvider } from './tauri/TauriProvider';
import { HttpProvider } from './HttpProvider';
import { IS_DEMO, IS_TAURI } from './transport';

/** Single shared instance for the lifetime of the app. */
let instance: DataProvider | null = null;

/** Return the app's data provider (constructed lazily, once). */
export function getProvider(): DataProvider {
  if (instance) return instance;
  if (IS_DEMO) {
    instance = new MockProvider();
  } else if (IS_TAURI) {
    instance = new TauriProvider();
  } else {
    instance = new HttpProvider();
  }
  // `instance` is now non-null; the `!` is the same assertion the call
  // sites would have to make anyway. The type narrows after the if-else
  // chain because each branch assigns the field.
  return instance!;
}

export { TauriProvider, MockProvider, HttpProvider };
export { importKubeconfigViaInput } from './HttpProvider';
export { IS_DEMO, IS_TAURI } from './transport';
export type { DataProvider } from './types';

// Unified error handling utilities.
export {
  withErrorHandling,
  withErrorHandlingOrNull,
  setErrorReporter,
  getErrorReporter,
  setSuccessReporter,
  getSuccessReporter,
  formatError,
} from './errorHandler';
export type { ErrorReporter } from './errorHandler';
