/**
 * TemplatePicker — Phase 4 of KubePi parity.
 *
 * A two-pane picker: left = template list (each pinned to a k8s KindId
 * via `Template.kind`), right = the form + live YAML preview. Submitting
 * calls `applyYamlBundle` (created/updated per doc) and surfaces the
 * per-document result.
 *
 * Form fields come from two sources:
 *   - `Template.params` — the original simple fields (text, number,
 *     boolean). Rendered one per label/input row.
 *   - `Template.extras` — optional structured fields (labels, resources)
 *     added in the Bxx form-wizard pass. Rendered as their own sections
 *     below the simple params.
 *
 * Why the values dict has three shapes living together (string,
 * Record, {cpu, memory}):
 *   - `params` produce string values (the form's <input> world).
 *   - `extras.labels` is a key→value map.
 *   - `extras.resources` is a small object.
 * The render function receives all three and embeds them at the right
 * YAML positions. The helpers `labelsBlock` and `resourcesRequestsBlock`
 * in `lib/templates.ts` do the actual YAML formatting.
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { getProvider } from "../../providers";
import type { ApplyResult } from "../../providers/types";
import {
  defaultValuesFor,
  listTemplates,
  renderTemplate,
  type Template,
  type TemplateExtras,
} from "../../lib/templates";
import { useTranslation } from "../../hooks/useI18n";
import { useStore } from "../../store";
import styles from "./TemplatePicker.module.css";

/**
 * The values dict the render function gets. The renderer's signature is
 * `Record<string, unknown>`, so this is the source of truth on what the
 * wizard actually feeds in. The `labels` and `resources` keys are
 * conventional — none of the templates' `params` use these names, so
 * the namespacing is unambiguous.
 */
interface TemplateValues {
  /** Substituted into the template's `{{key}}` placeholders. */
  [key: string]: string | Record<string, string> | { cpu?: string; memory?: string } | undefined;
  labels?: Record<string, string>;
  resources?: { cpu?: string; memory?: string };
}

/** Build the initial values for a template, including any `extras`. */
function initialValuesFor(t: Template): TemplateValues {
  return {
    ...defaultValuesFor(t),
    ...(t.extras?.labels ? { labels: { ...t.extras.labels.default } } : {}),
    ...(t.extras?.resources
      ? { resources: { ...t.extras.resources.default } }
      : {}),
  } as TemplateValues;
}

export function TemplatePicker({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const templates = useMemo(() => listTemplates(), []);
  // The current nav kind drives auto-selection: a user landing on the
  // StatefulSets page and clicking "+ New" shouldn't have to scroll the
  // template list to find the StatefulSet entry.
  const currentKind = useStore((s) => s.nav);
  const [selected, setSelected] = useState<Template | null>(null);
  const [values, setValues] = useState<TemplateValues>({});
  const [result, setResult] = useState<ApplyResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const initialSelection = useMemo(
    () => templates.find((tt) => tt.kind === currentKind) ?? null,
    [templates, currentKind],
  );

  // Seed the picker on mount + when the user navigates to a different
  // kind while the overlay is open. The effect clears prior `result` /
  // `error` so a fresh kind starts with a clean slate.
  useEffect(() => {
    if (initialSelection) {
      setSelected(initialSelection);
      setValues(initialValuesFor(initialSelection));
    } else {
      setSelected(null);
      setValues({});
    }
    setResult([]);
    setError(null);
  }, [initialSelection]);

  const yamlPreview = useMemo(() => {
    if (!selected) return "";
    try {
      return renderTemplate(selected.id, values);
    } catch (e) {
      return `# error: ${String(e)}`;
    }
  }, [selected, values]);

  const pickTemplate = (tt: Template) => {
    setSelected(tt);
    setValues(initialValuesFor(tt));
    setResult([]);
    setError(null);
  };

  const apply = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const r = await getProvider().applyYamlBundle(yamlPreview);
      setResult(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    void apply();
  };

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <h2>{t("tpl.title", "Create from template")}</h2>
        {onClose && (
          <button className={styles.btn} onClick={onClose}>
            {t("tpl.close", "Close")}
          </button>
        )}
      </header>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.body}>
        <aside className={styles.side}>
          {templates.map((tt) => (
            <div
              key={tt.id}
              className={
                selected?.id === tt.id ? styles.itemActive : styles.item
              }
              onClick={() => pickTemplate(tt)}
            >
              <div className={styles.itemTitle}>
                {t(`tpl.titles.${tt.id}`, tt.title)}
              </div>
              <div className={styles.itemDesc}>
                {t(`tpl.descs.${tt.id}`, tt.description)}
              </div>
            </div>
          ))}
        </aside>
        <main className={styles.main}>
          {selected ? (
            <form onSubmit={onSubmit} className={styles.formRoot}>
              <h3>{t(`tpl.titles.${selected.id}`, selected.title)}</h3>
              <div className={styles.form}>
                {selected.params.map((p) => {
                  // The form's `value` attribute is `string | number` —
                  // a strict subset of the values dict's index
                  // signature. Narrow with a runtime type check so the
                  // extras' `labels` / `resources` keys (which never
                  // collide with a `param.key` but are wider types)
                  // don't trip TS.
                  const raw = values[p.key];
                  const value = typeof raw === "string" ? raw : (p.default ?? "");
                  return (
                    <label key={p.key} className={styles.field}>
                      <span>{p.label}</span>
                      {p.kind === "boolean" ? (
                        <input
                          type="checkbox"
                          checked={value === "true"}
                          onChange={(e) =>
                            setValues({
                              ...values,
                              [p.key]: e.target.checked ? "true" : "false",
                            })
                          }
                        />
                      ) : (
                        <input
                          type={p.kind === "number" ? "number" : "text"}
                          value={value}
                          required={p.required ?? true}
                          pattern={p.pattern}
                          min={p.min}
                          max={p.max}
                          placeholder={p.default}
                          onChange={(e) =>
                            setValues({ ...values, [p.key]: e.target.value })
                          }
                        />
                      )}
                      {p.help && <small>{p.help}</small>}
                    </label>
                  );
                })}
                {selected.extras && (
                  <ExtrasSection
                    extras={selected.extras}
                    labels={values.labels ?? {}}
                    resources={values.resources ?? {}}
                    onLabelsChange={(labels) =>
                      setValues({ ...values, labels })
                    }
                    onResourcesChange={(resources) =>
                      setValues({ ...values, resources })
                    }
                  />
                )}
              </div>
              <h3 style={{ marginTop: "var(--space-3)" }}>
                {t("tpl.preview", "YAML preview")}
              </h3>
              <pre className={styles.preview}>{yamlPreview}</pre>
              <div className={styles.actions}>
                <button
                  className={styles.primary}
                  type="submit"
                  disabled={busy}
                >
                  {busy
                    ? t("tpl.applying", "Applying…")
                    : t("tpl.apply", "Apply")}
                </button>
              </div>
              {result.length > 0 && (
                <ul className={styles.results}>
                  {result.map((r, i) => (
                    <li
                      key={i}
                      className={
                        r.action === "failed"
                          ? styles.resultErr
                          : styles.resultOk
                      }
                    >
                      {r.action} {r.kind}/{r.name}
                      {r.namespace ? ` (${r.namespace})` : ""}
                      {r.error ? ` — ${r.error}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </form>
          ) : (
            <div className={styles.empty}>
              {t("tpl.pick", "Pick a template on the left")}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

/**
 * The structured "extras" — labels (key-value table) and resource
 * requests (cpu + memory). Rendered as a single section below the
 * simple params, with sub-headers so the user can tell at a glance
 * which input belongs to which.
 *
 * The labels table is intentionally simple: a flat list of `<input>`
 * rows with `+` / `×` buttons. A `key:""` row is allowed (the
 * renderer drops empty keys) so the user can add a row, then fill in
 * the key. Removing a row deletes the entry immediately.
 */
function ExtrasSection({
  extras,
  labels,
  resources,
  onLabelsChange,
  onResourcesChange,
}: {
  extras: TemplateExtras;
  labels: Record<string, string>;
  resources: { cpu?: string; memory?: string };
  onLabelsChange: (labels: Record<string, string>) => void;
  onResourcesChange: (r: { cpu?: string; memory?: string }) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.extras}>
      {extras.labels && (
        <fieldset className={styles.extrasBlock}>
          <legend>{t("tpl.extras.labels", "Labels")}</legend>
          <LabelsEditor labels={labels} onChange={onLabelsChange} />
        </fieldset>
      )}
      {extras.resources && (
        <fieldset className={styles.extrasBlock}>
          <legend>{t("tpl.extras.resources", "Resource requests")}</legend>
          <div className={styles.resourcesRow}>
            <label className={styles.resourceField}>
              <span>{t("tpl.extras.cpu", "CPU")}</span>
              <input
                type="text"
                value={resources.cpu ?? ""}
                placeholder={extras.resources.default.cpu ?? "100m"}
                onChange={(e) =>
                  onResourcesChange({ ...resources, cpu: e.target.value })
                }
              />
            </label>
            <label className={styles.resourceField}>
              <span>{t("tpl.extras.memory", "Memory")}</span>
              <input
                type="text"
                value={resources.memory ?? ""}
                placeholder={extras.resources.default.memory ?? "128Mi"}
                onChange={(e) =>
                  onResourcesChange({ ...resources, memory: e.target.value })
                }
              />
            </label>
          </div>
        </fieldset>
      )}
    </div>
  );
}

function LabelsEditor({
  labels,
  onChange,
}: {
  labels: Record<string, string>;
  onChange: (labels: Record<string, string>) => void;
}) {
  const { t } = useTranslation();
  // Render the dict as an ordered list of (key, value) pairs. Sorting
  // keeps the YAML preview stable across re-renders, which would
  // otherwise jiggle every time the user typed in a field.
  const entries = useMemo(
    () =>
      Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)),
    [labels],
  );
  return (
    <div className={styles.labelsTable}>
      {entries.map(([k, v], i) => (
        <div key={`${i}-${k}`} className={styles.labelsRow}>
          <input
            type="text"
            value={k}
            placeholder={t("tpl.extras.keyPlaceholder", "key")}
            className={styles.labelsKey}
            onChange={(e) => {
              const next = { ...labels };
              const val = next[k];
              delete next[k];
              next[e.target.value] = val ?? "";
              onChange(next);
            }}
          />
          <span className={styles.labelsEq}>=</span>
          <input
            type="text"
            value={v}
            placeholder={t("tpl.extras.valuePlaceholder", "value")}
            className={styles.labelsValue}
            onChange={(e) => onChange({ ...labels, [k]: e.target.value })}
          />
          <button
            type="button"
            className={styles.labelsDel}
            onClick={() => {
              const next = { ...labels };
              delete next[k];
              onChange(next);
            }}
            title={t("tpl.extras.remove", "remove")}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className={styles.labelsAdd}
        onClick={() => onChange({ ...labels, "": "" })}
      >
        + {t("tpl.extras.addLabel", "Add label")}
      </button>
    </div>
  );
}
