/**
 * TemplatePicker — Phase 4 of KubePi parity.
 *
 * A two-pane picker: left = template list, right = the form + live YAML
 * preview. Submitting calls `applyYamlBundle` (created/updated per doc),
 * then surfaces the per-document result.
 */
import { useMemo, useState, type FormEvent } from "react";
import { getProvider } from "../../providers";
import type { ApplyResult } from "../../providers/types";
import {
  defaultValuesFor,
  listTemplates,
  renderTemplate,
  type Template,
} from "../../lib/templates";
import { useTranslation } from "../../hooks/useI18n";
import styles from "./TemplatePicker.module.css";

export function TemplatePicker({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const templates = useMemo(() => listTemplates(), []);
  const [selected, setSelected] = useState<Template | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ApplyResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const yamlPreview = useMemo(() => {
    if (!selected) return "";
    try {
      return renderTemplate(selected.id, values);
    } catch (e) {
      return `# error: ${String(e)}`;
    }
  }, [selected, values]);

  const pickTemplate = (t: Template) => {
    setSelected(t);
    setValues(defaultValuesFor(t));
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
                {selected.params.map((p) => (
                  <label key={p.key} className={styles.field}>
                    <span>{p.label}</span>
                    {p.kind === "boolean" ? (
                      <input
                        type="checkbox"
                        checked={values[p.key] === "true"}
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
                        value={values[p.key] ?? p.default}
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
                ))}
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
