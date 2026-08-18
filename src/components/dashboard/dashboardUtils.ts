/**
 * Dashboard utility functions.
 *
 * Extracted to reduce Dashboard.tsx size and improve reusability.
 */

export function aggregatePercent(perNode: number[]): number {
  if (perNode.length === 0) return 0;
  const sum = perNode.reduce((a, b) => a + b, 0);
  return sum / perNode.length;
}

export function meterColor(p: number): string {
  if (p < 60) return 'var(--status-ok)';
  if (p < 85) return 'var(--status-warn)';
  return 'var(--status-err)';
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Parse a Kubernetes resource quantity string into a comparable number.
 *
 * CPU: "100m" → 100, "1" → 1000, "500m" → 500  (all in millicores)
 * Memory: "128Mi" → 128, "1Gi" → 1024, "512Ki" → 0.5  (all in MiB)
 * Plain numbers (pods, services, etc.): parsed directly.
 *
 * Returns 0 for empty or unparseable strings so a missing "USED" value
 * renders as a zero-fill bar rather than crashing the math.
 *
 * The optional `key` parameter disambiguates core counts from plain
 * integers: the CPU heuristic only fires when `key` contains "cpu".
 */
export function parseResourceValue(s: string, key?: string): number {
  if (!s || s === '\u2014') return 0;
  const trimmed = s.trim();

  // CPU — millicores ("100m") or cores ("1", "2")
  if (trimmed.endsWith('m')) {
    return parseInt(trimmed, 10) || 0;
  }

  // Memory — binary suffixes
  const memMatch = trimmed.match(/^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti|Pi|Ei)$/);
  if (memMatch) {
    const val = parseFloat(memMatch[1]);
    const unit = memMatch[2];
    const multipliers: Record<string, number> = {
      Ki: 1 / 1024,
      Mi: 1,
      Gi: 1024,
      Ti: 1024 * 1024,
      Pi: 1024 * 1024 * 1024,
      Ei: 1024 * 1024 * 1024 * 1024,
    };
    return val * (multipliers[unit] ?? 1);
  }

  // Plain number (pods, services, secrets, …) — or a core count ("4")
  const num = parseFloat(trimmed);
  if (isNaN(num)) return 0;
  // CPU core-count heuristic: only apply when the resource key contains
  // "cpu". Without the key guard, values like pods=50 would be
  // misinterpreted as 50000 millicores.
  if (num <= 64 && (!key || key.toLowerCase().includes('cpu'))) {
    return num * 1000; // cores → millicores
  }
  return num;
}

/**
 * Parse a ResourceQuota HARD or USED value into a Map of resource name → raw
 * value string.  The backend serialises these as JSON objects
 * (e.g. `{"cpu":"4","memory":"8Gi"}`), but the original kubectl-style
 * comma-separated `key=value` format is kept as a fallback.
 */
export function parseQuotaMap(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw || raw === '\u2014') return map;

  // Try JSON first
  try {
    const obj = JSON.parse(raw);
    if (typeof obj === 'object' && obj !== null) {
      for (const [k, v] of Object.entries(obj)) {
        map.set(k, String(v));
      }
      return map;
    }
  } catch {
    // Not JSON, try comma-separated format
  }

  // Fallback: comma-separated key=value
  for (const part of raw.split(',')) {
    const eq = part.indexOf('=');
    if (eq > 0) {
      map.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
    }
  }
  return map;
}
