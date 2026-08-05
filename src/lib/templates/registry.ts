/**
 * Template registry and rendering helpers.
 *
 * Refactored into smaller modules for high cohesion and low coupling.
 */

import type { Template } from './types';
import { WORKLOAD_TEMPLATES } from './templates/workloads';
import { NETWORKING_TEMPLATES } from './templates/networking';
import { CONFIG_TEMPLATES } from './templates/config';
import { STORAGE_TEMPLATES } from './templates/storage';

// Combine all templates
const TEMPLATES: Template[] = [
  ...WORKLOAD_TEMPLATES,
  ...NETWORKING_TEMPLATES,
  ...CONFIG_TEMPLATES,
  ...STORAGE_TEMPLATES,
];

// Re-export helper functions
export { labelsBlock, resourcesRequestsBlock, clampInt } from './helpers';

/** List all available templates. */
export function listTemplates(): Template[] {
  return TEMPLATES;
}

/** Find a template by id. */
export function getTemplate(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

/**
 * Render a template by id with the given values.
 * Throws if the template is not found.
 */
export function renderTemplate(id: string, values: Record<string, unknown>): string {
  const t = getTemplate(id);
  if (!t) throw new Error(`template not found: ${id}`);
  return t.render(values);
}

/**
 * Extract default values from a template's params.
 */
export function defaultValuesFor(t: Template): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of t.params) {
    out[p.key] = p.default ?? '';
  }
  return out;
}
