/**
 * Unified error handler for provider operations.
 *
 * Provides a consistent way to handle errors from provider calls with
 * automatic toast notifications. Can be used to wrap any async operation
 * with standardized error handling.
 *
 * Usage:
 *   import { withErrorHandling, getErrorHandler } from './errorHandler';
 *
 *   // Wrap a provider call:
 *   const result = await withErrorHandling(
 *     () => provider.applyYaml(ref, text),
 *     'Apply YAML'
 *   );
 *
 *   // Or use the global handler directly:
 *   getErrorHandler().showError('Operation failed', error.message);
 */

/** Callback type for showing error toasts. */
export type ErrorReporter = (title: string, message: string) => void;

/** Global error reporter instance. Set once at app startup. */
let globalReporter: ErrorReporter | null = null;

/** Global success reporter instance. Set once at app startup. */
let globalSuccessReporter: ErrorReporter | null = null;

/**
 * Set the global error reporter. Called once from the app root after
 * the toast system is initialized.
 */
export function setErrorReporter(reporter: ErrorReporter): void {
  globalReporter = reporter;
}

/**
 * Get the current error reporter. Returns a no-op if not yet initialized
 * (e.g., during early boot or in tests).
 */
export function getErrorReporter(): ErrorReporter {
  return globalReporter ?? defaultReporter;
}

/**
 * Set the global success reporter — the green-toast counterpart of
 * {@link setErrorReporter}. Same `(title, message) => void` shape so callers
 * (e.g. the wizard's apply-success path) read exactly like error reports.
 * Called once from the app root after the toast system is initialized.
 */
export function setSuccessReporter(reporter: ErrorReporter): void {
  globalSuccessReporter = reporter;
}

/**
 * Get the current success reporter. Falls back to a console log if not yet
 * initialized — a success report is never worth crashing over.
 */
export function getSuccessReporter(): ErrorReporter {
  return globalSuccessReporter ?? defaultSuccessReporter;
}

/** Default reporter: logs to console (used before toast system is ready). */
function defaultReporter(title: string, message: string): void {
  console.error(`[k7s] ${title}: ${message}`);
}

/** Default success reporter: console log until the toast system is ready. */
function defaultSuccessReporter(title: string, message: string): void {
  console.info(`[k7s] ${title}: ${message}`);
}

/**
 * Wrap an async operation with unified error handling.
 *
 * Catches errors, reports them via the global error reporter, and re-throws
 * so callers can still handle failures locally if needed.
 *
 * @param op - The async operation to wrap.
 * @param title - Human-readable operation name for the error toast.
 * @returns The result of the operation.
 * @throws The original error after reporting it.
 */
export async function withErrorHandling<T>(op: () => Promise<T>, title: string): Promise<T> {
  try {
    return await op();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    getErrorReporter()(title, message);
    throw e;
  }
}

/**
 * Wrap an async operation with error handling that returns null on failure
 * instead of throwing. Useful for non-critical operations where the caller
 * wants to degrade gracefully.
 *
 * @param op - The async operation to wrap.
 * @param title - Human-readable operation name for the error toast.
 * @returns The result of the operation, or null on failure.
 */
export async function withErrorHandlingOrNull<T>(
  op: () => Promise<T>,
  title: string
): Promise<T | null> {
  try {
    return await op();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    getErrorReporter()(title, message);
    return null;
  }
}

/**
 * Extract a human-readable error message from an unknown error value.
 * Standardizes the various ways errors can be represented in JS.
 */
export function formatError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return String(e);
}
