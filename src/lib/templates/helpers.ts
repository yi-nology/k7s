/**
 * Helper functions for template rendering.
 */

/**
 * Render a `labels:` YAML block from a Record<string, string>.
 * Returns "" when the record is empty or not a plain object.
 */
export function labelsBlock(labels: unknown, indent: number): string {
  if (!labels || typeof labels !== 'object' || Array.isArray(labels)) return '';
  const entries = Object.entries(labels as Record<string, string>).filter(
    ([, v]) => typeof v === 'string' && v.length > 0
  );
  if (entries.length === 0) return '';
  const pad = ' '.repeat(indent);
  return entries.map(([k, v]) => `${pad}${k}: ${v}`).join('\n');
}

/**
 * Render a `resources.requests:` YAML block from a Record<string, string>.
 * Returns "" when the record is empty or not a plain object.
 */
export function resourcesRequestsBlock(res: unknown, indent: number): string {
  if (!res || typeof res !== 'object' || Array.isArray(res)) return '';
  const entries = Object.entries(res as Record<string, string>).filter(
    ([, v]) => typeof v === 'string' && v.length > 0
  );
  if (entries.length === 0) return '';
  const pad = ' '.repeat(indent);
  const pad2 = ' '.repeat(indent + 2);
  return [
    `${pad}resources:`,
    `${pad}  requests:`,
    ...entries.map(([k, v]) => `${pad2}${k}: ${v}`),
  ].join('\n');
}

/**
 * Clamp an integer value into a range.
 */
export function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : typeof raw === 'number' ? raw : NaN;
  if (isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
