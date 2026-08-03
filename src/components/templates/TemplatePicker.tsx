/**
 * TemplatePicker — the create-from-template overlay (Bxx wizard pass).
 *
 * The picker is a single-screen form, not a multi-step wizard. The shape:
 *
 *   ┌─ Header ─────────────────────────────────────────────┐
 *   │  Create from template                          [×]   │
 *   ├─ Kind bar ───────────────────────────────────────────┤
 *   │  Kind: [Deployment ▼]   Single-container …          │
 *   ├─ Form (scrollable) ─────────────────────────────────┤
 *   │  ┌─ Basic ────────────────────────────────────────┐  │
 *   │  │ Name     [___]   Image  [___]                 │  │
 *   │  │ Replicas [_]     Port   [_]                  │  │
 *   │  │ Namespace [___]                              │  │
 *   │  └──────────────────────────────────────────────┘  │
 *   │  ┌─ Labels ──[+ Add label]─────────────────────┐   │
 *   │  │ [app: my-app ×] [tier: web ×]               │   │
 *   │  │ [key=value                              ] [+] │   │
 *   │  └──────────────────────────────────────────────┘  │
 *   │  ┌─ Resource requests ─────────────────────────┐   │
 *   │  │ CPU [___]  Memory [___]                    │   │
 *   │  └──────────────────────────────────────────────┘  │
 *   │  ▾ YAML preview                                    │
 *   │  ┌────────────────────────────────────────────┐    │
 *   │  │ apiVersion: apps/v1                       │    │
 *   │  │ ...                                         │    │
 *   │  └────────────────────────────────────────────┘    │
 *   ├─ Footer (sticky) ───────────────────────────────────┤
 *   │  [Cancel]                          [Apply →]       │
 *   └────────────────────────────────────────────────────┘
 *
 * Design notes:
 *  - The old side list of templates is gone — replaced by a single
 *    `<select>` in the kind bar. With 11 templates, the side list was
 *    a 220px column the user had to scroll to find the right entry.
 *    A dropdown is the same UX with a tenth of the screen real estate.
 *  - The description of the currently-selected kind lives next to the
 *    dropdown, so the user still sees what each kind is for without
 *    having to switch.
 *  - Form sections are <fieldset> cards, not bare <h3> headers, so
 *    each one has a visible boundary in the dark UI.
 *  - The Apply button is in a sticky footer; long YAML previews don't
 *    push it off-screen.
 *  - Labels are a chip list (GitHub-style) instead of the old
 *    `key = value [×]` rows, which read more like a single line of
 *    text and were visually noisy.
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
 * conventional — none of the templates' `params` use these names.
 */
interface TemplateValues {
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

/**
 * Parse the chip-editor's `key=value` input. Returns `null` for an
 * unparseable line (empty / key-only-after-trim), so the caller can
 * decide whether to commit silently or surface a hint. Splitting the
 * first `=` (not the last) matches `kubectl label` and the way every
 * shell tool handles KEY=VAL — a value containing `=` is left intact.
 */
export function parseLabelDraft(
  draft: string,
): { key: string; value: string } | null {
  const line = draft.trim();
  if (!line) return null;
  const eq = line.indexOf("=");
  let key: string;
  let value: string;
  if (eq === -1) {
    key = line;
    value = "";
  } else {
    key = line.slice(0, eq).trim();
    value = line.slice(eq + 1).trim();
  }
  if (!key) return null;
  return { key, value };
}

export function TemplatePicker({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const templates = useMemo(() => listTemplates(), []);
  const currentKind = useStore((s) => s.nav);
  const [selected, setSelected] = useState<Template | null>(null);
  const [values, setValues] = useState<TemplateValues>({});
  const [result, setResult] = useState<ApplyResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Default the YAML preview to expanded so the user can verify before
  // submit; the toggle is for the long-preview case where the form
  // gets crowded.
  const [yamlOpen, setYamlOpen] = useState(true);

  const initialSelection = useMemo(
    () => templates.find((tt) => tt.kind === currentKind) ?? null,
    [templates, currentKind],
  );

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
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label={t("tpl.close", "Close")}
          >
            ×
          </button>
        )}
      </header>

      {error && <div className={styles.error}>{error}</div>}

      <form onSubmit={onSubmit} className={styles.formRoot}>
        <div className={styles.kindBar}>
          <label className={styles.kindLabel}>
            {t("tpl.kind", "Kind")}
            <select
              className={styles.kindSelect}
              value={selected?.id ?? ""}
              onChange={(e) => {
                const next = templates.find((tt) => tt.id === e.target.value);
                if (next) pickTemplate(next);
              }}
            >
              {/* No template auto-selected: render a placeholder option
                  so the dropdown isn't empty. The body below shows the
                  "pick a kind" hint. */}
              {!selected && (
                <option value="" disabled>
                  {t("tpl.pick", "Pick a template on the left")}
                </option>
              )}
              {templates.map((tt) => (
                <option key={tt.id} value={tt.id}>
                  {t(`tpl.titles.${tt.id}`, tt.title)}
                </option>
              ))}
            </select>
          </label>
          {selected && (
            <p className={styles.kindDesc}>
              {t(`tpl.descs.${selected.id}`, selected.description)}
            </p>
          )}
        </div>

        <div className={styles.body}>
          {selected ? (
            <>
              <section className={styles.section}>
                <h3 className={styles.sectionTitle}>
                  {t("tpl.section.basic", "Basic")}
                </h3>
                <div className={styles.fields}>
                  {selected.params.map((p) => {
                    const raw = values[p.key];
                    const value =
                      typeof raw === "string" ? raw : (p.default ?? "");
                    return (
                      <label
                        key={p.key}
                        className={styles.field}
                        data-wide={p.help ? "true" : "false"}
                      >
                        <span className={styles.fieldLabel}>{p.label}</span>
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
                              setValues({
                                ...values,
                                [p.key]: e.target.value,
                              })
                            }
                          />
                        )}
                        {p.help && <small className={styles.fieldHelp}>{p.help}</small>}
                      </label>
                    );
                  })}
                </div>
              </section>

              {selected.extras && (
                <ExtrasSection
                  extras={selected.extras}
                  labels={values.labels ?? {}}
                  resources={values.resources ?? {}}
                  onLabelsChange={(labels) => setValues({ ...values, labels })}
                  onResourcesChange={(resources) =>
                    setValues({ ...values, resources })
                  }
                />
              )}

              <section className={styles.section}>
                <button
                  type="button"
                  className={styles.yamlToggle}
                  onClick={() => setYamlOpen((o) => !o)}
                  aria-expanded={yamlOpen}
                >
                  <span className={styles.yamlChevron} data-open={yamlOpen}>
                    ▾
                  </span>
                  {t("tpl.preview", "YAML preview")}
                </button>
                {yamlOpen && (
                  <pre className={styles.preview}>{yamlPreview}</pre>
                )}
              </section>
            </>
          ) : (
            <div className={styles.empty}>
              {t("tpl.pick", "Pick a template on the left")}
            </div>
          )}
        </div>

        <footer className={styles.footer}>
          <button
            type="button"
            className={styles.cancelBtn}
            onClick={onClose}
            disabled={busy}
          >
            {t("tpl.cancel", "Cancel")}
          </button>
          <button
            type="submit"
            className={styles.applyBtn}
            disabled={busy || !selected}
          >
            {busy
              ? t("tpl.applying", "Applying…")
              : t("tpl.apply", "Apply")}
          </button>
        </footer>
      </form>

      {result.length > 0 && (
        <ul className={styles.results}>
          {result.map((r, i) => (
            <li
              key={i}
              className={r.action === "failed" ? styles.resultErr : styles.resultOk}
            >
              {r.action} {r.kind}/{r.name}
              {r.namespace ? ` (${r.namespace})` : ""}
              {r.error ? ` — ${r.error}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The structured "extras" — labels (chip list) and resource requests
 * (CPU + memory inputs). Rendered as their own section card.
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
    <>
      {extras.labels && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>
            {t("tpl.extras.labels", "Labels")}
          </h3>
          <LabelsEditor labels={labels} onChange={onLabelsChange} />
        </section>
      )}
      {extras.resources && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>
            {t("tpl.extras.resources", "Resource requests")}
          </h3>
          <div className={styles.resourcesRow}>
            <label className={styles.resourceField}>
              <span className={styles.fieldLabel}>
                {t("tpl.extras.cpu", "CPU")}
              </span>
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
              <span className={styles.fieldLabel}>
                {t("tpl.extras.memory", "Memory")}
              </span>
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
        </section>
      )}
    </>
  );
}

/**
 * Chip-style labels editor. Each label is a removable pill showing
 * `key: value`; a single text input below accepts `key=value` (or
 * just `key`) and adds it on Enter / `+`. An empty key is dropped
 * silently so a half-typed line never produces invalid YAML.
 *
 * Why chip pattern over the prior `key = value [×]` rows:
 *  - Reading "10 labels" at a glance is easier with chips than with
 *    a 10-row table.
 *  - Removal is one click on a single × (not "find the right row,
 *    click the × at the end").
 *  - The `key=value` input is the same shape kubectl users know,
 *    and works with paste.
 */
function LabelsEditor({
  labels,
  onChange,
}: {
  labels: Record<string, string>;
  onChange: (labels: Record<string, string>) => void;
}) {
  const { t } = useTranslation();
  // Insertion order matters: chips appear in the order the user added
  // them, not sorted alphabetically. Object key order in JS is
  // insertion order for string keys, so we just iterate.
  const entries = Object.entries(labels);
  const [draft, setDraft] = useState("");

  const commit = () => {
    const parsed = parseLabelDraft(draft);
    if (!parsed) return;
    onChange({ ...labels, [parsed.key]: parsed.value });
    setDraft("");
  };

  return (
    <div className={styles.labelsWrap}>
      {entries.length > 0 && (
        <div className={styles.chipList}>
          {entries.map(([k, v]) => (
            <span key={k} className={styles.chip}>
              <span className={styles.chipKey}>{k}</span>
              {v !== "" && (
                <>
                  <span className={styles.chipSep}>:</span>
                  <span className={styles.chipVal}>{v}</span>
                </>
              )}
              <button
                type="button"
                className={styles.chipX}
                onClick={() => {
                  const next = { ...labels };
                  delete next[k];
                  onChange(next);
                }}
                aria-label={t("tpl.extras.remove", "remove")}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className={styles.labelAdd}>
        <input
          type="text"
          value={draft}
          placeholder={t(
            "tpl.extras.addPlaceholder",
            "key=value, then ⏎",
          )}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
        />
        <button
          type="button"
          className={styles.labelAddBtn}
          onClick={commit}
          disabled={!draft.trim()}
        >
          +
        </button>
      </div>
    </div>
  );
}
