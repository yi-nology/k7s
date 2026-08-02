/**
 * Settings panel (B23) — a modal over the app, opened by the sidebar's gear.
 *
 * Every change is applied and persisted immediately: there's no Save button,
 * because there's nothing here worth a confirmation step and a Cancel would imply
 * a rollback we don't implement. Values are sanitised on the way in (see
 * lib/settings.ts), so a half-typed field can't reach a ring buffer or a poll loop.
 *
 * Settings that can't take effect until the next connect say so, rather than
 * quietly doing nothing.
 *
 * The Theme and Language rows are the only ones the user will care to change
 * mid-session: the rest feed backend poll intervals, which only take effect on
 * reconnect, and a change there benefits from a clear "applies on next connect"
 * hint. Theme + language, in contrast, are immediate — and we keep them at the
 * top so the user can see the effect while the panel is still open.
 */

import { useEffect } from "react";
import styles from "./SettingsPanel.module.css";
import { useStore } from "../../store";
import { LIMITS, DEFAULT_SETTINGS, sanitizeSettings, type Settings } from "../../lib/settings";
import { asTheme, type Theme } from "../../lib/theme";
import { asLocale, LOCALES, type Locale } from "../../lib/i18n";
import { useTranslation } from "../../hooks/useI18n";

export function SettingsPanel() {
  const open = useStore((s) => s.settingsOpen);
  const setOpen = useStore((s) => s.setSettingsOpen);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const connected = useStore((s) => s.connection.phase === "connected");
  const { t } = useTranslation();

  // Esc closes, matching every other overlay in the app.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;

  /** Apply one field, sanitised against the rest of the current settings. */
  const update = (patch: Partial<Settings>) => setSettings(sanitizeSettings({ ...settings, ...patch }));

  // Theme options carry the underlying value as the <option value>, so the
  // values are still "dark" / "light" / "system" — the localised label is just
  // what the user sees. This keeps the pref file format stable across locales.
  const themeOptions: { value: Theme; label: string }[] = [
    { value: "system", label: t("settings.theme.system") },
    { value: "dark", label: t("settings.theme.dark") },
    { value: "light", label: t("settings.theme.light") },
  ];
  const langOptions: { value: Locale; label: string }[] = LOCALES.map((l) => ({
    value: l,
    label: t(`settings.language.${l}` as const),
  }));

  return (
    // Clicking the backdrop closes; clicking the panel must not bubble up to it.
    <div className={styles.backdrop} onClick={() => setOpen(false)}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>{t("chrome.settings.title")}</span>
          <span className={styles.close} title={t("chrome.common.close")} onClick={() => setOpen(false)}>
            ×
          </span>
        </div>

        <div className={styles.body}>
          {/* Theme + language at the top: the two settings whose effect is visible
              while the panel is still open, so the user can see what they picked
              without dismissing the dialog. */}
          <Row label={t("settings.theme.label")} hint={t("settings.theme.hint")}>
            <select
              className={styles.select}
              value={settings.theme}
              onChange={(e) => update({ theme: asTheme(e.target.value) })}
            >
              {themeOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Row>

          <Row label={t("settings.language.label")} hint={t("settings.language.hint")}>
            <select
              className={styles.select}
              value={settings.language}
              onChange={(e) => update({ language: asLocale(e.target.value) })}
            >
              {langOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Row>

          <Row
            label={t("settings.logBuffer.label")}
            hint={t(
              "settings.logBuffer.hint",
              LIMITS.logBufferCap.min,
              LIMITS.logBufferCap.max,
            )}
          >
            <input
              className={styles.number}
              type="number"
              min={LIMITS.logBufferCap.min}
              max={LIMITS.logBufferCap.max}
              value={settings.logBufferCap}
              onChange={(e) => update({ logBufferCap: Number(e.target.value) })}
            />
          </Row>

          <Row
            label={t("settings.metricsPoll.label")}
            hint={t(
              "settings.metricsPoll.hint",
              LIMITS.metricsIntervalSecs.min,
              LIMITS.metricsIntervalSecs.max,
              connected,
            )}
          >
            <input
              className={styles.number}
              type="number"
              min={LIMITS.metricsIntervalSecs.min}
              max={LIMITS.metricsIntervalSecs.max}
              value={settings.metricsIntervalSecs}
              onChange={(e) => update({ metricsIntervalSecs: Number(e.target.value) })}
            />
          </Row>

          <Row
            label={t("settings.statusPoll.label")}
            hint={t(
              "settings.statusPoll.hint",
              LIMITS.statusIntervalSecs.min,
              LIMITS.statusIntervalSecs.max,
              connected,
            )}
          >
            <input
              className={styles.number}
              type="number"
              min={LIMITS.statusIntervalSecs.min}
              max={LIMITS.statusIntervalSecs.max}
              value={settings.statusIntervalSecs}
              onChange={(e) => update({ statusIntervalSecs: Number(e.target.value) })}
            />
          </Row>

          <Row label={t("settings.defaultNamespace.label")} hint={t("settings.defaultNamespace.hint")}>
            <input
              className={styles.text}
              value={settings.defaultNamespace}
              onChange={(e) => update({ defaultNamespace: e.target.value })}
              placeholder={t("settings.defaultNamespace.placeholder")}
            />
          </Row>

          <Row label={t("settings.shellCommand.label")} hint={t("settings.shellCommand.hint")}>
            <input
              className={styles.text}
              value={settings.shellCommand}
              onChange={(e) => update({ shellCommand: e.target.value })}
              placeholder={t("settings.shellCommand.placeholder")}
            />
          </Row>

          <Row label={t("settings.nodeShellImage.label")} hint={t("settings.nodeShellImage.hint")}>
            <input
              className={styles.text}
              value={settings.nodeShellImage}
              onChange={(e) => update({ nodeShellImage: e.target.value })}
              placeholder={t("settings.nodeShellImage.placeholder")}
            />
          </Row>
        </div>

        <div className={styles.footer}>
          <span className={styles.note}>{t("chrome.settings.footerNote")}</span>
          <span className={styles.reset} onClick={() => setSettings(DEFAULT_SETTINGS)}>
            {t("chrome.settings.reset")}
          </span>
        </div>
      </div>
    </div>
  );
}

/** One labelled setting with its control and an explanatory hint. */
function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.row}>
      <div className={styles.labels}>
        <div className={styles.label}>{label}</div>
        <div className={styles.hint}>{hint}</div>
      </div>
      {children}
    </div>
  );
}
