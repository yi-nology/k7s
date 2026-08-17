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

/**
 * List all available templates.
 *
 * @returns Array of all registered templates (workloads, networking, config, storage).
 *
 * @example
 * ```ts
 * const templates = listTemplates();
 * templates.forEach(t => console.log(t.id, t.title));
 * ```
 */
export function listTemplates(): Template[] {
  return TEMPLATES;
}

/**
 * Find a template by id.
 *
 * @param id - The template id (e.g. "deployment", "service", "configmap").
 * @returns The template, or undefined if not found.
 */
export function getTemplate(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

/**
 * Render a template by id with the given values.
 *
 * Substitutes `{{key}}` placeholders in the template's YAML with the
 * corresponding values from the dict. Throws if the template is not found.
 *
 * @param id - The template id.
 * @param values - Parameter values (merged params + extras).
 * @returns The rendered YAML string (possibly multi-document).
 * @throws {Error} When the template id is not found.
 *
 * @example
 * ```ts
 * const yaml = renderTemplate("deployment", { name: "wiki", image: "nginx:latest", replicas: "3" });
 * ```
 */
export function renderTemplate(id: string, values: Record<string, unknown>): string {
  const t = getTemplate(id);
  if (!t) throw new Error(`template not found: ${id}`);
  return t.render(values);
}

/**
 * Extract default values from a template's params.
 *
 * Builds a `key -> default` dict from the template's parameter definitions,
 * suitable for seeding a form.
 *
 * @param t - The template to extract defaults from.
 * @returns A record of parameter key to its default value string.
 */
export function defaultValuesFor(t: Template): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of t.params) {
    out[p.key] = p.default ?? '';
  }
  return out;
}
