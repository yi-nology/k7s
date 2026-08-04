/**
 * Template type definitions.
 *
 * Split from lib/templates.ts during the large-file refactor.
 */

export interface TemplateParam {
  /** Field key, also the placeholder name in `{{key}}` substitutions. */
  key: string;
  /** Human label shown in the form. */
  label: string;
  /** Default value. */
  default: string;
  /** Input kind: text, number, or boolean. */
  kind: 'text' | 'number' | 'boolean';
  /**
   * Optional validation regex. Only consulted for `kind: "text"` inputs; the
   * browser applies it as a native `pattern` attribute.
   */
  pattern?: string;
  /** One-line help text. */
  help?: string;
  /**
   * Optional lower / upper bound for `kind: "number"` inputs. The form mirrors
   * these as the native `min` / `max` attributes so the browser surfaces
   * out-of-range values to the user; the renderer in `clampInt` enforces the
   * same bounds as a server-side safety net. Bounds are inclusive.
   */
  min?: number;
  max?: number;
  /**
   * Whether the form should refuse submission with an empty value. Defaults
   * to `true` for `kind: "text" | "number"` and `false` for `kind: "boolean"`
   * (a checkbox's "empty" state is `false`, which is still a value). The form
   * mirrors this as the native `required` attribute so the browser surfaces a
   * "Please fill out this field" tooltip instead of silently falling through
   * to the renderer's `||` default — the pass-13 follow-up noted that the
   * silent fallback hides user intent (a user clearing a field expects a
   * validation error, not a quietly-rendered "default" name).
   */
  required?: boolean;
}

export interface TemplateExtras {
  /**
   * Pod-level labels. Rendered as `spec.template.metadata.labels` for
   * workloads (the place that `matchLabels` and Service selectors
   * actually consult) and as `metadata.labels` for non-workload kinds.
   * The form renders a key-value table; empty keys are stripped.
   */
  labels?: {
    default: Record<string, string>;
  };
  /**
   * Resource requests, rendered as
   * `spec.template.spec.containers[0].resources.requests`. Either
   * field can be empty — the renderer emits only the lines the user
   * filled in. The single-container assumption is the same one the
   * templates already make; multi-container resource requests are
   * the YAML editor's job.
   */
  resources?: {
    default: { cpu?: string; memory?: string };
  };
}

export interface Template {
  id: string;
  /**
   * The k7s `KindId` this template creates. The picker uses it to pre-select
   * the template that matches the user's current page (e.g. landing on the
   * StatefulSets view opens the StatefulSet template). Optional: a template
   * without a `kind` (e.g. an Ingress that fronts a Service on any kind) is
   * still listed but never auto-selected.
   */
  kind?: string;
  /**
   * Title shown in the picker. The English canonical name (also the YAML
   * `kind:` for the rendered resource) and the i18n fallback for the
   * `tpl.titles.<id>` dictionary key — the picker passes it as the second
   * argument to `t()` so a missing translation still renders sensibly.
   */
  title: string;
  /**
   * One-line description. English canonical copy and the i18n fallback for
   * `tpl.descs.<id>`; same fallback contract as `title`.
   */
  description: string;
  /** Parameters the form renders. */
  params: TemplateParam[];
  /**
   * Optional form sections beyond `params`. Each becomes a labelled card
   * in the wizard form, alongside the simple `params` fields. Values
   * are passed to the render function under their own keys in the
   * `values` dict:
   *   - `labels`: `Record<string, string>` (key→value)
   *   - `resources`: `{ cpu?: string; memory?: string }`
   */
  extras?: TemplateExtras;
  /**
   * Render to a (possibly multi-document) YAML bundle. Implementations
   * substitute `{{key}}` from `values` (the merged `params` + `extras`
   * dict) and produce a string of one or more YAML documents separated
   * by `---`.
   */
  render: (values: Record<string, unknown>) => string;
}
