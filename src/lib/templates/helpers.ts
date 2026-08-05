/**
 * Helper functions for template rendering.
 */

/**
 * Render a `labels:` YAML block from a Record<string, string>.
 * Returns "" when the record is empty or not a plain object.
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
 * Format `{cpu, memory}` as a YAML `resources.requests:` block at the
 * requested indent. Either field may be empty; the block is omitted
 * entirely when both are. Indents:
 *   indent+0 → `resources:`
 *   indent+2 → `requests:`
 *   indent+4 → `cpu:` / `memory:`
 *
 * The +4 / +2 spacing matches the standard k8s manifest style so the
 * result diffs cleanly against `kubectl get -o yaml` output.
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
 * Clamp an integer value into a range.
 */
export function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : typeof raw === 'number' ? raw : NaN;
  if (isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
