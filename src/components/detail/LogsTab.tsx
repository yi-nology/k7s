/**
 * Logs tab UI (Design §4-Logs, B29): filter/search, container cycler, timestamp
 * toggle, follow/pause, the previous-container toggle and since window, save to
 * file, the streaming viewport (auto-scrolls while following), and the footer.
 * The stream lifecycle lives in useLogStream.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import styles from "./LogsTab.module.css";
import { useStore } from "../../store";
import { getProvider } from "../../providers";
import { useLogStream } from "../../hooks/useLogStream";
import { useTranslation } from "../../hooks/useI18n";
import { hasPrevious, sinceSeconds, SINCE_OPTIONS } from "../../lib/logview";
import type { LogLine } from "../../providers/types";

/** Color per log level for the level column. */
const LEVEL_COLOR: Record<string, string> = {
  INFO: "var(--accent)",
  WARN: "var(--status-warn)",
  ERROR: "var(--status-err)",
  DEBUG: "var(--text-muted)",
};

/** Message tint: ERROR/WARN get soft tints, everything else is secondary. */
function msgColor(level: string): string {
  if (level === "ERROR") return "var(--status-err-msg)";
  if (level === "WARN") return "var(--status-warn-msg)";
  return "var(--text-secondary)";
}

export function LogsTab() {
  // Drive the stream for as long as this tab is mounted.
  useLogStream();

  const pod = useStore((s) => s.selectedRow);
  const logBuffer = useStore((s) => s.logBuffer);
  const logSearch = useStore((s) => s.logSearch);
  const setLogSearch = useStore((s) => s.setLogSearch);
  const showTimestamps = useStore((s) => s.showTimestamps);
  const toggleTimestamps = useStore((s) => s.toggleTimestamps);
  const following = useStore((s) => s.following);
  const toggleFollow = useStore((s) => s.toggleFollow);
  const containerIndex = useStore((s) => s.containerIndex);
  const cycleContainer = useStore((s) => s.cycleContainer);
  const previous = useStore((s) => s.logPrevious);
  const setLogPrevious = useStore((s) => s.setLogPrevious);
  const since = useStore((s) => s.logSince);
  const setLogSince = useStore((s) => s.setLogSince);
  const { t } = useTranslation();

  // Transient save feedback: which file was written, or why it wasn't.
  const [saveNote, setSaveNote] = useState<string | null>(null);

  // Multi-container pods get an "all" option ("") first; "(all)" is its label and
  // turns on the per-line container tag column.
  const containers = pod?.pod?.containers ?? [];
  const options = containers.length > 1 ? [...containers, ""] : containers;
  const current = options.length ? options[containerIndex % options.length] : "";
  const containerLabel = current === "" ? t("logs.containerAll") : current;
  const showContainerTag = current === "" && containers.length > 1;

  // Client-side filter on message + level (buffer itself is untouched).
  const filtered = useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    if (!q) return logBuffer;
    return logBuffer.filter(
      (l) => l.msg.toLowerCase().includes(q) || l.level.toLowerCase().includes(q),
    );
  }, [logBuffer, logSearch]);

  // Offered only when a container has actually restarted — see hasPrevious.
  const showPrevious = hasPrevious(pod?.pod?.restarts);

  /** Save the *full* log (not the ring buffer) to a file the user picks. */
  async function save() {
    if (!pod) return;
    setSaveNote(t("logs.saveInProgress"));
    try {
      const result = await getProvider().saveLogs(
        { kind: "pods", namespace: pod.namespace, name: pod.name },
        current,
        { sinceSeconds: sinceSeconds(since), previous },
      );
      // null means the dialog was cancelled — not an error, and not worth a note.
      setSaveNote(result ? t("logs.saved", result.lines) : null);
    } catch (e) {
      setSaveNote(t("logs.saveFailed", e instanceof Error ? e.message : String(e)));
    }
  }

  // The note is feedback, not state; it shouldn't linger over the next question.
  useEffect(() => {
    if (!saveNote || saveNote === t("logs.saveInProgress")) return;
    const timer = setTimeout(() => setSaveNote(null), 4000);
    return () => clearTimeout(timer);
  }, [saveNote, t]);

  // Auto-scroll to the bottom on new lines, but only while following.
  const viewportRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (following && viewportRef.current) {
      const el = viewportRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [filtered.length, following]);

  // When resuming (following flips on), jump to bottom immediately.
  useEffect(() => {
    if (following && viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    }
  }, [following]);

  return (
    <>
      <div className={styles.toolbar}>
        <div className={styles.search}>
          <span className={styles.searchIcon}>⌕</span>
          <input
            className={styles.searchInput}
            value={logSearch}
            onChange={(e) => setLogSearch(e.target.value)}
            placeholder={t("logs.filterPlaceholder")}
          />
        </div>

        {/* Container cycler (cycles through the pod's containers, plus "all"). */}
        <div className={styles.button} onClick={cycleContainer} title={t("logs.container")}>
          <span className={styles.buttonGlyph}>▣</span>
          {containerLabel}
          {options.length > 1 && <span className={styles.buttonChevron}>▼</span>}
        </div>

        {/* Timestamp toggle. */}
        <div
          className={`${styles.toggle} ${showTimestamps ? styles.toggleActive : ""}`}
          onClick={toggleTimestamps}
        >
          {t("logs.ts")}
        </div>

        {/* How far back to read. */}
        <select
          className={styles.select}
          value={since}
          onChange={(e) => setLogSince(e.target.value as (typeof SINCE_OPTIONS)[number])}
          title={t("logs.howFarBack")}
        >
          {SINCE_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o === "all" ? t("logs.sinceAll") : t("logs.sinceLast", o)}
            </option>
          ))}
        </select>

        {/* Previous container — only offered when there *is* one to read (B29).
            A pod that has never restarted has no previous generation, and asking
            for one is a 400. */}
        {showPrevious && (
          <div
            className={`${styles.toggle} ${previous ? styles.toggleActive : ""}`}
            onClick={() => setLogPrevious(!previous)}
            title={t("logs.previousTitle")}
          >
            {t("logs.previous")}
          </div>
        )}

        <div className={styles.button} onClick={() => void save()} title={t("logs.saveTitle")}>
          <span className={styles.buttonGlyph}>⇩</span>
          {t("logs.save")}
        </div>

        {/* Follow / pause. Meaningless for a previous read: that container is
            dead, so there is nothing to follow. */}
        {!previous && (
          <div
            className={`${styles.follow} ${following ? styles.following : styles.paused}`}
            onClick={toggleFollow}
          >
            {following ? t("logs.pause") : t("logs.follow")}
          </div>
        )}
      </div>

      <div className={styles.viewport} ref={viewportRef}>
        {filtered.map((line, i) => (
          <LogRow key={i} line={line} showTs={showTimestamps} showContainer={showContainerTag} />
        ))}
      </div>

      <div className={styles.footer}>
        <span>{t("logs.linesCount", filtered.length)}</span>
        <span>{t("logs.container")}: {containerLabel}</span>
        {saveNote && <span className={styles.saveNote}>{saveNote}</span>}
        {previous ? (
          <span style={{ color: "var(--status-warn)" }}>{t("logs.previousContainer")}</span>
        ) : (
          <span style={{ color: following ? "var(--status-ok)" : "var(--status-warn)" }}>
            {following ? t("logs.streaming") : t("logs.paused")}
          </span>
        )}
      </div>
    </>
  );
}

/** A single log line row: timestamp (optional), container tag (in "all" mode),
 *  level column, message. */
function LogRow({
  line,
  showTs,
  showContainer,
}: {
  line: LogLine;
  showTs: boolean;
  showContainer: boolean;
}) {
  return (
    <div className={styles.line}>
      {showTs && <span className={styles.lineTs}>{line.ts}</span>}
      {showContainer && <span className={styles.lineContainer}>{line.container}</span>}
      <span className={styles.lineLevel} style={{ color: LEVEL_COLOR[line.level] ?? "var(--text-muted)" }}>
        {line.level}
      </span>
      <span className={styles.lineMsg} style={{ color: msgColor(line.level) }}>
        {line.msg}
      </span>
    </div>
  );
}
