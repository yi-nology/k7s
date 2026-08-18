/**
 * Template utility functions for TemplatePicker.
 *
 * Extracted to reduce TemplatePicker.tsx size and improve reusability.
 */

import type { Template } from '../../lib/templates';
import { defaultValuesFor } from '../../lib/templates';

export interface TemplateValues {
  [key: string]: string | Record<string, string> | { cpu?: string; memory?: string } | undefined;
  labels?: Record<string, string>;
  resources?: { cpu?: string; memory?: string };
}

/** Build the initial values for a template, including any `extras`. */
export function initialValuesFor(t: Template): TemplateValues {
  return {
    ...defaultValuesFor(t),
    ...(t.extras?.labels ? { labels: { ...t.extras.labels.default } } : {}),
    ...(t.extras?.resources ? { resources: { ...t.extras.resources.default } } : {}),
  } as TemplateValues;
}
