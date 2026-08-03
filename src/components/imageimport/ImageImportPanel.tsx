/**
 * ImageImportPanel — get images into an air-gapped (intranet, no public
 * internet) cluster. Two complementary paths, picked by a top tab bar:
 *
 *   • **To Node** — load a local `.tar` directly into a node's container runtime
 *     via a temporary privileged pod. For clusters with no internal registry.
 *   • **To Registry** — copy an image into a configured private registry via
 *     skopeo. For clusters that DO have an internal registry (Harbor/Nexus);
 *     all nodes then pull from it.
 *
 * The two paths exist because real air-gapped clusters fall into both camps.
 * See `docs/superpowers/specs/2026-08-03-image-import-design.md` §1 for why
 * they're complementary, not redundant.
 *
 * Desktop (Tauri) only — the web shell has no local-disk access. On web the
 * panel shows a notice instead of the form.
 */
import { useEffect, useMemo, useState } from "react";
import { getProvider, IS_TAURI } from "../../providers";
import type {
  ArchiveInfo,
  ImageRegistry,
  ImageSyncResult,
  ImportImageResult,
  Row,
  SkopeoAvailability,
} from "../../providers/types";
import { useTranslation } from "../../hooks/useI18n";
import { rowsFor, useStore } from "../../store";
import styles from "./ImageImportPanel.module.css";

type Tab = "to-node" | "to-registry";

export function ImageImportPanel({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("to-node");

  // Web shell: no local-disk access. Show a notice instead of the form.
  if (!IS_TAURI) {
    return (
      <div className={styles.panel}>
        <Header onClose={onClose} title={t("imageImport.title", "Import Image")} t={t} />
        <div className={styles.notice}>
          {t("imageImport.desktopOnly", "Image import is only available in the desktop app.")}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <Header onClose={onClose} title={t("imageImport.title", "Import Image")} t={t} />

      <div className={styles.tabBar} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "to-node"}
          className={styles.tabBtn}
          data-active={tab === "to-node"}
          onClick={() => setTab("to-node")}
        >
          {t("imageImport.tabToNode", "To Node")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "to-registry"}
          className={styles.tabBtn}
          data-active={tab === "to-registry"}
          onClick={() => setTab("to-registry")}
        >
          {t("imageImport.tabToRegistry", "To Registry")}
        </button>
      </div>

      {tab === "to-node" ? (
        <ToNodeSection onClose={onClose} />
      ) : (
        <ToRegistrySection onClose={onClose} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// To Node — load a local .tar into a node's container runtime.
// ---------------------------------------------------------------------------

function ToNodeSection({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const nodeRows = useStore((s) => rowsFor(s.rows, "nodes"));
  const nodes = useMemo(() => nodeRows.map(nodeOption).filter((n) => n.name), [nodeRows]);

  const [node, setNode] = useState("");
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportImageResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canImport = !busy && node !== "" && path !== "";

  const pickFile = async () => {
    setError(null);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        title: t("imageImport.chooseFile", "Select image archive"),
        multiple: false,
        filters: [{ name: "Image archive", extensions: ["tar"] }],
      });
      if (typeof selected === "string") {
        setPath(selected);
        setResult(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const runImport = async () => {
    if (!canImport) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await getProvider().importImageToNode(node, path);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.body}>
        <section className={styles.callout}>
          <p className={styles.calloutTitle}>
            {t("imageImport.whatTitle", "What this does")}
          </p>
          <p className={styles.calloutText}>
            {t("imageImport.description", "")}
          </p>
        </section>

        <section className={styles.form}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              {t("imageImport.node", "Target node")}
            </span>
            <select
              className={styles.select}
              value={node}
              onChange={(e) => {
                setNode(e.target.value);
                setResult(null);
              }}
            >
              <option value="" disabled>
                {t("imageImport.pickNode", "Select a node…")}
              </option>
              {nodes.map((n) => (
                <option key={n.name} value={n.name}>
                  {n.name}
                  {n.status ? `  (${n.status})` : ""}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              {t("imageImport.archive", "Image archive")}
            </span>
            <div className={styles.fileRow}>
              <button
                type="button"
                className={styles.fileBtn}
                onClick={() => void pickFile()}
                disabled={busy}
              >
                {t("imageImport.chooseFile", "Choose .tar file…")}
              </button>
              <span className={styles.fileName} title={path}>
                {path ? path.split("/").pop() : ""}
              </span>
            </div>
          </label>
        </section>

        {result && (
          <section className={styles.result}>
            {result.error ? (
              <div className={styles.resultErr}>{result.error}</div>
            ) : (
              <>
                <div className={styles.resultRuntime}>
                  <span className={styles.resultLabel}>
                    {t("imageImport.runtime", "Runtime")}
                  </span>
                  <span className={styles.resultValue}>{result.runtime}</span>
                </div>
                <div className={styles.resultImages}>
                  <span className={styles.resultLabel}>
                    {t("imageImport.loadedImages", "Loaded images")}
                  </span>
                  {result.images.length > 0 ? (
                    <ul className={styles.imageList}>
                      {result.images.map((img, i) => (
                        <li key={i} className={styles.imageItem}>
                          {img}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className={styles.resultValue}>
                      {t("imageImport.noImages", "(no image refs parsed from output)")}
                    </span>
                  )}
                </div>
                {result.output && (
                  <details className={styles.outputDetails}>
                    <summary className={styles.outputSummary}>
                      {t("imageImport.rawOutput", "Raw output")}
                    </summary>
                    <pre className={styles.outputPre}>{result.output}</pre>
                  </details>
                )}
              </>
            )}
          </section>
        )}
      </div>

      <footer className={styles.footer}>
        <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={busy}>
          {t("imageImport.close", "Close")}
        </button>
        <button
          type="button"
          className={styles.importBtn}
          disabled={!canImport}
          onClick={() => void runImport()}
        >
          {busy
            ? t("imageImport.importing", "Importing…")
            : t("imageImport.import", "Import")}
        </button>
      </footer>
    </>
  );
}

// ---------------------------------------------------------------------------
// To Registry — copy an image into a configured private registry via skopeo.
// ---------------------------------------------------------------------------

function ToRegistrySection({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const provider = getProvider();

  // Skopeo availability + configured registries — fetched once on mount. The
  // tab is gated on skopeo being present; without it the form is useless.
  const [skopeo, setSkopeo] = useState<SkopeoAvailability | null>(null);
  const [registries, setRegistries] = useState<ImageRegistry[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [avail, regs] = await Promise.all([
          provider.imageSyncStatus(),
          provider.imageRegistryList(),
        ]);
        if (!cancelled) {
          setSkopeo(avail);
          setRegistries(regs);
        }
      } catch {
        // Non-fatal: the form still renders, the copy attempt will surface
        // a real error if skopeo is missing.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [provider]);

  const [source, setSource] = useState("");
  const [path, setPath] = useState("");
  const [destRegistry, setDestRegistry] = useState("");
  const [destRepo, setDestRepo] = useState("");
  const [destTag, setDestTag] = useState("");
  const [srcCreds, setSrcCreds] = useState("");
  const [insecureSrc, setInsecureSrc] = useState(false);
  const [insecureDest, setInsecureDest] = useState(false);

  const [busy, setBusy] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [archiveInfo, setArchiveInfo] = useState<ArchiveInfo | null>(null);
  const [result, setResult] = useState<ImageSyncResult | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const skopeoMissing = skopeo !== null && !skopeo.available;

  const pickFile = async () => {
    setError(null);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        title: t("imageImport.chooseFile", "Select image archive"),
        multiple: false,
        filters: [{ name: "Image archive", extensions: ["tar"] }],
      });
      if (typeof selected === "string") {
        setPath(selected);
        setSource(`docker-archive:${selected}`);
        setArchiveInfo(null);
        setResult(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const inspect = async () => {
    if (!path) return;
    setInspecting(true);
    setError(null);
    try {
      const info = await provider.imageInspectArchive(path);
      setArchiveInfo(info);
      // Prefill repo/tag from the archive's first tag if the user hasn't typed.
      if (!destRepo && info.repoTags[0]) {
        const first = info.repoTags[0];
        const idx = first.lastIndexOf(":");
        setDestRepo(idx > 0 ? first.slice(0, idx) : first);
        setDestTag(idx > 0 ? first.slice(idx + 1) : "latest");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInspecting(false);
    }
  };

  const canCopy =
    !busy &&
    !skopeoMissing &&
    source.trim() !== "" &&
    destRegistry !== "" &&
    destRepo.trim() !== "";

  const runCopy = async () => {
    if (!canCopy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setLogLines([]);
    try {
      const r = await provider.imageCopy(
        source.trim(),
        destRegistry,
        destRepo.trim(),
        destTag.trim() || "latest",
        srcCreds.trim() || null,
        insecureSrc,
        insecureDest,
        (line) => setLogLines((prev) => [...prev, line]),
      );
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // skopeo not installed: show the install hint instead of the form.
  if (skopeoMissing) {
    return (
      <>
        <div className={styles.body}>
          <div className={styles.callout}>
            <p className={styles.calloutText}>
              {t("imageImport.registry.skopeoMissing", "skopeo is not installed.")}
            </p>
            {skopeo?.version && (
              <p className={styles.calloutText}>{skopeo.version}</p>
            )}
          </div>
        </div>
        <footer className={styles.footer}>
          <button type="button" className={styles.cancelBtn} onClick={onClose}>
            {t("imageImport.close", "Close")}
          </button>
        </footer>
      </>
    );
  }

  return (
    <>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.body}>
        <section className={styles.callout}>
          <p className={styles.calloutTitle}>
            {t("imageImport.registry.whatTitle", "What this does")}
          </p>
          <p className={styles.calloutText}>
            {t("imageImport.registry.description", "")}
          </p>
        </section>

        {registries.length === 0 ? (
          <div className={styles.noticeInline}>
            {t(
              "imageImport.registry.noRegistries",
              "No registries configured — add one in Image Registries first.",
            )}
          </div>
        ) : (
          <section className={styles.form}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                {t("imageImport.archive", "Image archive")}
              </span>
              <div className={styles.fileRow}>
                <button
                  type="button"
                  className={styles.fileBtn}
                  onClick={() => void pickFile()}
                  disabled={busy}
                >
                  {t("imageImport.chooseFile", "Choose .tar file…")}
                </button>
                <span className={styles.fileName} title={path}>
                  {path ? path.split("/").pop() : ""}
                </span>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => void inspect()}
                  disabled={!path || inspecting || busy}
                >
                  {inspecting
                    ? t("imageImport.registry.inspecting", "Inspecting…")
                    : t("imageImport.registry.inspect", "Inspect tar")}
                </button>
              </div>
            </label>

            {archiveInfo && (
              <div className={styles.archiveInfo}>
                <div>
                  <strong>{archiveInfo.name || "(no name)"}</strong>
                  {archiveInfo.repoTags.map((tg) => (
                    <span key={tg} className={styles.tagChip}>{tg}</span>
                  ))}
                </div>
                <div className={styles.archiveMeta}>
                  {archiveInfo.architecture}/{archiveInfo.os} ·{" "}
                  {formatBytes(archiveInfo.sizeBytes)} · {archiveInfo.digest.slice(0, 19)}…
                </div>
                {!(archiveInfo.os === "linux" && archiveInfo.architecture === "amd64") && (
                  <div className={styles.warn}>
                    {t(
                      "imageImport.registry.archWarn",
                      "Warning: not linux/amd64 — may not run on your cluster.",
                    )
                      .replace("{arch}", archiveInfo.architecture)
                      .replace("{os}", archiveInfo.os)}
                  </div>
                )}
              </div>
            )}

            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                {t("imageImport.registry.registry", "Destination registry")}
              </span>
              <select
                className={styles.select}
                value={destRegistry}
                onChange={(e) => setDestRegistry(e.target.value)}
              >
                <option value="" disabled>
                  {t("imageImport.registry.pickRegistry", "Select a registry…")}
                </option>
                {registries.map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.name} ({r.url})
                  </option>
                ))}
              </select>
            </label>

            <div className={styles.twoCol}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>
                  {t("imageImport.registry.repo", "Destination repo")}
                </span>
                <input
                  type="text"
                  className={styles.input}
                  value={destRepo}
                  placeholder="library/nginx"
                  onChange={(e) => setDestRepo(e.target.value)}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>
                  {t("imageImport.registry.tag", "Destination tag")}
                </span>
                <input
                  type="text"
                  className={styles.input}
                  value={destTag}
                  placeholder="1.25"
                  onChange={(e) => setDestTag(e.target.value)}
                />
              </label>
            </div>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                {t("imageImport.registry.source", "Source")}
              </span>
              <input
                type="text"
                className={styles.input}
                value={source}
                placeholder="docker-archive:/path/to/img.tar  or  docker://nginx:1.25"
                onChange={(e) => setSource(e.target.value)}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                {t("imageImport.registry.srcCreds", "Source credentials")}
              </span>
              <input
                type="text"
                className={styles.input}
                value={srcCreds}
                placeholder="user:pass"
                onChange={(e) => setSrcCreds(e.target.value)}
              />
              <small className={styles.fieldHelp}>
                {t("imageImport.registry.srcCredsHelp", "user:pass for a private source registry.")}
              </small>
            </label>

            <div className={styles.checkRow}>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={insecureSrc}
                  onChange={(e) => setInsecureSrc(e.target.checked)}
                />
                {t("imageImport.registry.insecureSrc", "Skip source TLS verify")}
              </label>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={insecureDest}
                  onChange={(e) => setInsecureDest(e.target.checked)}
                />
                {t("imageImport.registry.insecureDest", "Skip destination TLS verify")}
              </label>
            </div>

            {(logLines.length > 0 || result) && (
              <section className={styles.logSection}>
                <div className={styles.resultLabel}>
                  {t("imageImport.registry.log", "Progress log")}
                </div>
                <pre className={styles.logPre}>
                  {logLines.join("\n")}
                  {result ? `\n${result.summary}` : ""}
                </pre>
              </section>
            )}
          </section>
        )}
      </div>

      <footer className={styles.footer}>
        <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={busy}>
          {t("imageImport.close", "Close")}
        </button>
        <button
          type="button"
          className={styles.importBtn}
          disabled={!canCopy}
          onClick={() => void runCopy()}
        >
          {busy
            ? t("imageImport.registry.copying", "Copying…")
            : t("imageImport.registry.copy", "Copy to registry")}
        </button>
      </footer>
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared helpers / sub-components
// ---------------------------------------------------------------------------

function Header({
  title,
  onClose,
  t,
}: {
  title: string;
  onClose?: () => void;
  t: (k: string, fallback: string) => string;
}) {
  return (
    <header className={styles.header}>
      <h2>{title}</h2>
      {onClose && (
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          aria-label={t("imageImport.close", "Close")}
        >
          ×
        </button>
      )}
    </header>
  );
}

function nodeOption(row: Row): { name: string; status: string } {
  const name = String(row.cells[0] ?? row.name ?? "");
  const status = String(row.cells[1] ?? "");
  return { name, status };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}
