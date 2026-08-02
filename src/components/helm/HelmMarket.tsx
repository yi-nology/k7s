/**
 * HelmMarket — the chart marketplace panel (Phase 1 of KubePi parity).
 *
 * Three views, stacked into one component for the marketplace tab:
 *   - "repos"   — manage chart repos (add/remove/refresh)
 *   - "charts"  — search across cached indexes
 *   - "release" — installed releases (the existing helm kind)
 *
 * The right-hand side of the panel handles the install/upgrade wizard.
 * We keep the wizard out of this file because it grows quickly: a separate
 * file means editing one doesn't force-read the other.
 *
 * Live helm-op log lines (during install/upgrade) are streamed through
 * `onHelmOpLog`; we surface them as a footer in the wizard rather than
 * spawning a side panel, so the user can scroll back through what the
 * backend said.
 */
import { useEffect, useMemo, useState } from "react";
import { getProvider } from "../../providers";
import type { HelmChartSummary, HelmRepo } from "../../providers/types";
import { useTranslation } from "../../hooks/useI18n";
import { HelmInstallWizard } from "./HelmInstallWizard";
import styles from "./HelmMarket.module.css";

type Tab = "charts" | "repos";

export function HelmMarket({ onClose }: { onClose?: () => void } = {}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("charts");
  const [repos, setRepos] = useState<HelmRepo[]>([]);
  const [query, setQuery] = useState("");
  const [charts, setCharts] = useState<HelmChartSummary[]>([]);
  const [loadingCharts, setLoadingCharts] = useState(false);
  const [selected, setSelected] = useState<HelmChartSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load repos once on mount and whenever the user adds/removes one.
  const reloadRepos = useMemo(
    () => () => {
      getProvider()
        .helmListRepos()
        .then(setRepos)
        .catch((e: unknown) => setError(String(e)));
    },
    [],
  );
  useEffect(reloadRepos, [reloadRepos]);

  // Refresh search results when query or repo set changes.
  useEffect(() => {
    let cancelled = false;
    setLoadingCharts(true);
    setError(null);
    getProvider()
      .helmSearchCharts(query)
      .then((rows) => {
        if (!cancelled) setCharts(rows);
      })
      .catch((e: unknown) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoadingCharts(false));
    return () => {
      cancelled = true;
    };
  }, [query, repos.length]);

  return (
    <div className={styles.market}>
      {onClose && (
        <header className={styles.header}>
          <h2>{t("helm.title", "Helm Market")}</h2>
          <button className={styles.close} onClick={onClose}>
            {t("helm.close", "Close")}
          </button>
        </header>
      )}
      <div className={styles.tabs} role="tablist">
        <button
          role="tab"
          aria-selected={tab === "charts"}
          className={tab === "charts" ? styles.tabActive : styles.tab}
          onClick={() => setTab("charts")}
        >
          {t("helm.tabs.charts", "Charts")}
        </button>
        <button
          role="tab"
          aria-selected={tab === "repos"}
          className={tab === "repos" ? styles.tabActive : styles.tab}
          onClick={() => setTab("repos")}
        >
          {t("helm.tabs.repos", "Repositories")}
          <span className={styles.count}>({repos.length})</span>
        </button>
        <div className={styles.spacer} />
        {tab === "charts" && (
          <input
            className={styles.search}
            placeholder={t("helm.search.placeholder", "Search charts…")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        {tab === "repos" && (
          <button
            className={styles.primary}
            onClick={async () => {
              try {
                await getProvider().helmUpdateAllRepos();
                reloadRepos();
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            {t("helm.repos.refreshAll", "Refresh all")}
          </button>
        )}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {tab === "charts" ? (
        <div className={styles.split}>
          <div className={styles.list}>
            {loadingCharts && charts.length === 0 ? (
              <div className={styles.empty}>…</div>
            ) : charts.length === 0 ? (
              <div className={styles.empty}>
                {query
                  ? t("helm.empty.noMatch", "No charts match this search")
                  : t("helm.empty.noRepos", "No repos yet — add one in Repositories")}
              </div>
            ) : (
              <ul className={styles.charts}>
                {charts.map((c) => (
                  <li
                    key={`${c.repo}/${c.name}`}
                    className={
                      selected?.repo === c.repo && selected?.name === c.name
                        ? styles.chartActive
                        : styles.chart
                    }
                    onClick={() => setSelected(c)}
                  >
                    <div className={styles.chartName}>{c.name}</div>
                    <div className={styles.chartMeta}>
                      <span className={styles.chartRepo}>{c.repo}</span>
                      <span className={styles.chartVersion}>
                        v{c.version}
                      </span>
                    </div>
                    <div className={styles.chartDesc}>
                      {c.description || ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className={styles.detail}>
            {selected ? (
              <HelmInstallWizard
                chart={selected}
                onDone={() => setSelected(null)}
              />
            ) : (
              <div className={styles.empty}>
                {t("helm.detail.pickChart", "Pick a chart on the left to install")}
              </div>
            )}
          </div>
        </div>
      ) : (
        <HelmRepos
          repos={repos}
          onChange={reloadRepos}
          onError={setError}
        />
      )}
    </div>
  );
}

function HelmRepos({
  repos,
  onChange,
  onError,
}: {
  repos: HelmRepo[];
  onChange: () => void;
  onError: (msg: string) => void;
}) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");

  return (
    <div className={styles.repos}>
      {repos.length === 0 ? (
        <div className={styles.empty}>
          {t("helm.repos.empty", "No repos yet")}
        </div>
      ) : (
        <ul className={styles.repoList}>
          {repos.map((r) => (
            <li key={r.name} className={styles.repo}>
              <div className={styles.repoMain}>
                <div className={styles.repoName}>{r.name}</div>
                <div className={styles.repoUrl}>{r.url}</div>
                {r.description && (
                  <div className={styles.repoDesc}>{r.description}</div>
                )}
              </div>
              <div className={styles.repoStatus}>
                {r.lastError ? (
                  <span className={styles.err} title={r.lastError}>
                    ● {t("helm.repos.error", "error")}
                  </span>
                ) : r.lastRefreshed ? (
                  <span className={styles.ok}>
                    ● {t("helm.repos.ok", "fresh")}
                  </span>
                ) : (
                  <span className={styles.muted}>
                    ● {t("helm.repos.never", "never refreshed")}
                  </span>
                )}
              </div>
              <div className={styles.repoActions}>
                <button
                  className={styles.btn}
                  onClick={async () => {
                    try {
                      await getProvider().helmUpdateRepo(r.name);
                      onChange();
                    } catch (e) {
                      onError(String(e));
                      onChange();
                    }
                  }}
                >
                  {t("helm.repos.refresh", "Refresh")}
                </button>
                <button
                  className={styles.btnDanger}
                  onClick={async () => {
                    if (!confirm(t("helm.repos.confirmRemove", `Remove repo "${r.name}"?`))) {
                      return;
                    }
                    try {
                      await getProvider().helmRemoveRepo(r.name);
                      onChange();
                    } catch (e) {
                      onError(String(e));
                    }
                  }}
                >
                  {t("helm.repos.remove", "Remove")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <form
          className={styles.repoForm}
          onSubmit={async (e) => {
            e.preventDefault();
            // Already in flight — `<button type="submit" disabled>` covers the
            // native path, but a programmatic .submit() (or a browser that
            // ignores `disabled` on the submit) can still reach this handler.
            // Guard here so a double-fire doesn't queue two helm adds.
            if (submitting) return;
            setSubmitting(true);
            try {
              await getProvider().helmAddRepo({ name, url, description });
              setName("");
              setUrl("");
              setDescription("");
              setAdding(false);
              onChange();
            } catch (err) {
              onError(String(err));
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <input
            required
            // Helm repo names follow the same charset as DNS labels: lowercase
            // letters, digits, and `-`. The browser surfaces a `patternMismatch`
            // validation message before submit, so the user can't accidentally
            // send `my repo /` to the backend (which fails the provider-side
            // validation with a less helpful error).
            pattern="[a-z0-9][a-z0-9-]*"
            title={t("helm.repos.form.nameTitle", "lowercase letters, digits, and '-'")}
            placeholder={t("helm.repos.form.name", "name")}
            value={name}
            disabled={submitting}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            required
            type="url"
            placeholder={t("helm.repos.form.url", "https://charts.example.com")}
            value={url}
            disabled={submitting}
            onChange={(e) => setUrl(e.target.value)}
          />
          <input
            placeholder={t("helm.repos.form.desc", "description (optional)")}
            value={description}
            disabled={submitting}
            onChange={(e) => setDescription(e.target.value)}
          />
          <button
            className={styles.primary}
            type="submit"
            disabled={submitting}
          >
            {submitting
              ? t("helm.repos.form.adding", "Adding…")
              : t("helm.repos.form.add", "Add")}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => setAdding(false)}
          >
            {t("helm.repos.form.cancel", "Cancel")}
          </button>
        </form>
      ) : (
        <button
          className={styles.primary}
          onClick={() => setAdding(true)}
          style={{ marginTop: "var(--space-3)" }}
        >
          {t("helm.repos.add", "Add repository")}
        </button>
      )}
    </div>
  );
}
