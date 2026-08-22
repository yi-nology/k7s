/**
 * Helper functions for template rendering.
 *
 * These are pure, stateless functions that produce YAML fragments from
 * user-supplied values. They are tested in `templates.test.ts`.
 */

/**
 * Render a `labels:` YAML block from a Record<string, string>.
 *
 * @param labels - The labels object (or anything — returns "" for non-objects).
 * @param indent - Number of spaces to prepend to each line.
 * @returns YAML fragment, or "" when there are no labels.
 *
 * @example
 * ```ts
 * labelsBlock({ app: "wiki", tier: "web" }, 6);
 * // "      app: wiki\n      tier: web"
 * ```
 */
export function labelsBlock(labels: unknown, indent: number): string {
  if (!labels || typeof labels !== 'object') return '';
  const pad = ' '.repeat(indent);
  const entries = Object.entries(labels as Record<string, string>).filter(
    ([k, v]) => k.length > 0 && v !== undefined && v !== null
  );
  if (entries.length === 0) return '';
  return entries.map(([k, v]) => `${pad}${k}: ${v}`).join('\n');
}

/**
 * Format `{cpu, memory}` as a YAML `resources.requests:` block at the requested indent.
 *
 * Either field may be empty; the block is omitted entirely when both are.
 * The +4 / +2 spacing matches the standard k8s manifest style so the result
 * diffs cleanly against `kubectl get -o yaml` output.
 *
 * @param res - Object with optional `cpu` and `memory` string fields.
 * @param indent - Base indentation in spaces.
 * @returns YAML fragment, or "" when both fields are empty.
 *
 * @example
 * ```ts
 * resourcesRequestsBlock({ cpu: "100m", memory: "128Mi" }, 8);
 * // "        resources:\n          requests:\n            cpu: 100m\n            memory: 128Mi"
 * ```
 */
export function resourcesRequestsBlock(res: unknown, indent: number): string {
  if (!res || typeof res !== 'object' || Array.isArray(res)) return '';
  const r = res as { cpu?: string; memory?: string };
  const lines: string[] = [];
  const pad0 = ' '.repeat(indent);
  const pad2 = ' '.repeat(indent + 2);
  if (r.cpu) {
    lines.push(`${pad0}resources:`);
    lines.push(`${pad2}requests:`);
    lines.push(`${' '.repeat(indent + 4)}cpu: ${r.cpu}`);
  }
  if (r.memory) {
    if (!r.cpu) {
      lines.push(`${pad0}resources:`);
      lines.push(`${pad2}requests:`);
    }
    lines.push(`${' '.repeat(indent + 4)}memory: ${r.memory}`);
  }
  return lines.join('\n');
}

/**
 * Clamp an integer value into a range, with a fallback for unparseable input.
 *
 * @param raw - The value to clamp (string, number, or anything else).
 * @param min - Lower bound (inclusive).
 * @param max - Upper bound (inclusive).
 * @param fallback - Value to use when `raw` is NaN or not a number.
 * @returns The clamped integer.
 *
 * @example
 * ```ts
 * clampInt("42", 1, 100, 10); // 42
 * clampInt("abc", 1, 100, 10); // 10
 * clampInt(200, 1, 100, 10);   // 100
 * ```
 */
export function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : typeof raw === 'number' ? raw : NaN;
  if (isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
