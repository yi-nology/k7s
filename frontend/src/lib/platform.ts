/**
 * Platform feature flags.
 *
 * Centralises which features are available on each platform so that
 * UI components, overlays, and sidebar entries can be gated from one
 * place instead of scattering `IS_IPADOS` checks everywhere.
 *
 * On iPadOS we remove heavyweight / desktop-oriented features that
 * have poor touch-screen ergonomics or are unnecessary for a mobile
 * monitoring-and-triage workflow.
 */

import { IS_IPADOS } from '../providers/transport';

/** A feature that can be independently enabled or disabled per platform. */
export type FeatureId =
  | 'ai-assistant'
  | 'helm-market'
  | 'sbom'
  | 'security-audit'
  | 'image-repos'
  | 'image-transfer'
  | 'pod-files'
  | 'topology'
  | 'ingress-editor'
  | 'grafana'
  | 'templates'
  | 'diff'
  | 'plugins'
  | 'yaml-editor';          // CodeMirror editing (read-only YAML view stays)

/**
 * Features disabled on iPadOS.  Everything not listed here is enabled
 * by default on all platforms.
 */
const DISABLED_ON_IPADOS: ReadonlySet<FeatureId> = new Set([
  'ai-assistant',
  'helm-market',
  'sbom',
  'security-audit',
  'image-repos',
  'image-transfer',
  'pod-files',
  'topology',
  'ingress-editor',
  'grafana',
  'templates',
  'diff',
  'plugins',
  'yaml-editor',
]);

/** Check whether a feature is available on the current platform. */
export function featureEnabled(id: FeatureId): boolean {
  if (IS_IPADOS) return !DISABLED_ON_IPADOS.has(id);
  return true;
}

/**
 * FeatureIds that name a sidebar overlay entry. Everything in this list is
 * gated in App via `IPADOS_HIDDEN_OVERLAYS.has(key)`.
 */
const OVERLAY_KEYS: readonly FeatureId[] = [
  'helm-market',
  'pod-files',
  'image-repos',
  'image-transfer',
  'sbom',
  'topology',
  'ingress-editor',
  'grafana',
  'templates',
  'diff',
  'plugins',
];

/**
 * Overlay keys hidden on the CURRENT platform. Populated only on iPadOS —
 * empty on desktop, so `.has(key)` gates render iPad-only exclusions
 * without hiding anything on the desktop build.
 */
export const IPADOS_HIDDEN_OVERLAYS = new Set<string>(
  IS_IPADOS ? OVERLAY_KEYS.filter((k) => DISABLED_ON_IPADOS.has(k)) : [],
);

/** Whether the AI floating button / panel should render. */
export const AI_ENABLED = featureEnabled('ai-assistant');

/** Whether the YAML tab should allow editing (vs. read-only view). */
export const YAML_EDITOR_ENABLED = featureEnabled('yaml-editor');
