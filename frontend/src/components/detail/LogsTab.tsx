/**
 * Logs tab UI (Design §4-Logs, B29): filter/search, container cycler, timestamp
 * toggle, follow/pause, the previous-container toggle and since window, save to
 * file, the streaming viewport (auto-scrolls while following), and the footer.
 * The stream lifecycle lives in useLogStream.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import styles from './LogsTab.module.css';
import { useStore } from '../../store';
import { formatError, getProvider } from '../../providers';
import { useLogStream } from '../../hooks/useLogStream';
import { useTranslation } from '../../hooks/useI18n';
import { cx } from '../../lib/cx';
import { findLogMatches, hasPrevious, sinceSeconds, SINCE_OPTIONS } from '../../lib/logview';
import { rowWindow } from '../../lib/virtual';
import { useSelectedRow } from '../../hooks/useStoreHooks';
import { LOG_LEVELS } from './logUtils';
import { LogRow } from './LogRow';

/**
 * Above this many *rendered* lines the viewport switches to fixed-height
 * windowing (rowWindow + spacer divs) — logBufferCap goes up to 5000 and a
 * full DOM of that size stutters on every streamed line. Windowing needs a
 * constant row height, so windowed mode pins each row to one line (see
 * `.viewportWindowed .line` in the CSS module): wrapped rows have
 * unpredictable heights and would drift the window out of step with the
 * scrollbar. Under the threshold nothing changes, wrap included.
 */
const WINDOW_THRESHOLD = 500;

/** Rows kept rendered beyond each edge of the visible span. */
const OVERSCAN = 10;

export function LogsTab() {
  // Drive the stream for as long as this tab is mounted.
  useLogStream();

  const pod = useSelectedRow();
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
  // Wrap toggle — defaults to true (matching original behavior).
  const [wrap, setWrap] = useState(true);
  // Level filter — defaults to 'ALL' (show everything).
  const [levelFilter, setLevelFilter] = useState<string>('ALL');

  // Multi-container pods get an "all" option ("") first; "(all)" is its label and
  // turns on the per-line container tag column.
  const containers = pod?.pod?.containers ?? [];
  const options = containers.length > 1 ? [...containers, ''] : containers;
  const current = options.length ? options[containerIndex % options.length] : '';
  const containerLabel = current === '' ? t('logs.containerAll') : current;
  const showContainerTag = current === '' && containers.length > 1;

  // --- Highlight + navigate search ---

  const lineRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Filter logBuffer by level. Memoized: the streaming buffer changes on
  // every appended line, and both the render list and the match list below
  // derive from this one array without re-running the filter twice.
  const filteredBuffer = useMemo(
    () => (levelFilter === 'ALL' ? logBuffer : logBuffer.filter((line) => line.level === levelFilter)),
    [logBuffer, levelFilter]
  );

  // Matches are computed against the *rendered* list, not the raw buffer:
  // with a level filter active the viewport maps over filteredBuffer, so
  // buffer-based indices highlighted and jumped to wrong rows.
  const matchIndices = useMemo(() => findLogMatches(filteredBuffer, logSearch), [filteredBuffer, logSearch]);
  const [currentMatchIdx, setCurrentMatchIdx] = useState(-1);
  // A new match set (query/buffer/level change) restarts navigation at the top.
  useEffect(() => {
    setCurrentMatchIdx(matchIndices.length > 0 ? 0 : -1);
  }, [matchIndices]);

  // --- Virtualized viewport (large buffers only) ---
  // Mirrors the resource table's windowing (lib/virtual + useVirtualRows):
  // track scroll + viewport size, derive the rendered slice, and stand in for
  // the unrendered rows with spacer divs so the scrollbar stays honest.

  // Auto-scroll to the bottom on new lines, but only while following.
  const viewportRef = useRef<HTMLDivElement>(null);

  // Row height is measured, not hardcoded: it follows the user's font size.
  // The probe is a hidden single-line `.line`; until it reports a real height
  // (or when the buffer is short) the full list renders as before.
  const probeRef = useRef<HTMLDivElement>(null);
  const [rowHeight, setRowHeight] = useState(0);
  useLayoutEffect(() => {
    const el = probeRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setRowHeight(el.getBoundingClientRect().height));
    ro.observe(el);
    setRowHeight(el.getBoundingClientRect().height);
    return () => ro.disconnect();
  }, []);

  const windowed = filteredBuffer.length > WINDOW_THRESHOLD && rowHeight > 0;
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  // A ref so the scroll handler doesn't have to be re-attached when it flips.
  const windowedRef = useRef(windowed);
  windowedRef.current = windowed;

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onScroll = () => {
      // Short lists render whole; re-rendering them on every scroll event
      // would be pure waste. The effect below repairs the state when this
      // stops (the browser can clamp scrollTop while windowing is off).
      if (windowedRef.current) setScrollTop(el.scrollTop);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    setViewportH(el.clientHeight);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  }, []);

  // Seed scrollTop whenever windowing engages — the handler above ignored
  // scrolling while it was off, so the state can be stale by now. Windowing
  // around an abandoned offset would render rows behind a huge spacer.
  useEffect(() => {
    if (windowed && viewportRef.current) setScrollTop(viewportRef.current.scrollTop);
  }, [windowed]);

  const rowSlice = useMemo(
    () =>
      windowed
        ? rowWindow(filteredBuffer.length, scrollTop, viewportH, rowHeight, OVERSCAN)
        : { start: 0, end: filteredBuffer.length, padTop: 0, padBottom: 0 },
    [windowed, filteredBuffer.length, scrollTop, viewportH, rowHeight]
  );

  const goToMatch = useCallback(
    (idx: number) => {
      if (matchIndices.length === 0) return;
      const wrapped = ((idx % matchIndices.length) + matchIndices.length) % matchIndices.length;
      setCurrentMatchIdx(wrapped);
      const lineIdx = matchIndices[wrapped];
      const el = lineRefs.current.get(lineIdx);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      // Windowed viewport: the target row is not mounted, so there is no ref
      // to scrollIntoView. Jump by row offset instead — the scroll listener
      // re-renders the window around the new offset, which mounts the row.
      if (windowed && viewportRef.current) {
        const vp = viewportRef.current;
        vp.scrollTop = Math.max(0, lineIdx * rowHeight - vp.clientHeight / 2);
      }
    },
    [matchIndices, windowed, rowHeight]
  );

  const nextMatch = useCallback(() => goToMatch(currentMatchIdx + 1), [goToMatch, currentMatchIdx]);
  const prevMatch = useCallback(() => goToMatch(currentMatchIdx - 1), [goToMatch, currentMatchIdx]);

  // Offered only when a container has actually restarted — see hasPrevious.
  const showPrevious = hasPrevious(pod?.pod?.restarts);

  /** Save the *full* log (not the ring buffer) to a file the user picks. */
  async function save() {
    if (!pod) return;
    setSaveNote(t('logs.saveInProgress'));
    try {
      const result = await getProvider().saveLogs(
        { kind: 'pods', namespace: pod.namespace, name: pod.name },
        current,
        { sinceSeconds: sinceSeconds(since), previous }
      );
      // null means the dialog was cancelled — not an error, and not worth a note.
      setSaveNote(result ? t('logs.saved', result.lines) : null);
    } catch (e) {
      setSaveNote(t('logs.saveFailed', formatError(e)));
    }
  }

  // The note is feedback, not state; it shouldn't linger over the next question.
  useEffect(() => {
    if (!saveNote || saveNote === t('logs.saveInProgress')) return;
    const timer = setTimeout(() => setSaveNote(null), 4000);
    return () => clearTimeout(timer);
  }, [saveNote, t]);

  // Auto-scroll to the bottom on new lines, but only while following. With
  // windowing on, scrollHeight is dominated by the bottom spacer, which is
  // exactly the full-list height — so following works unchanged.
  useLayoutEffect(() => {
    if (following && viewportRef.current) {
      const el = viewportRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [logBuffer.length, following]);

  // When resuming (following flips on), jump to bottom immediately.
  useEffect(() => {
    if (following && viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    }
  }, [following]);

  return (
    <>
      <div className={styles.toolbar}>
        <div className={styles.toolbarPrimary}>
          <div className={styles.search}>
            <span className={styles.searchIcon}>⌕</span>
            <input
              className={styles.searchInput}
              value={logSearch}
              onChange={(e) => setLogSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { if (e.shiftKey) prevMatch(); else nextMatch(); }
                if (e.key === 'Escape') setLogSearch('');
              }}
              placeholder={t('logs.searchPlaceholder')}
            />
          </div>

          {logSearch && matchIndices.length > 0 && (
            <>
              <span className={styles.matchCount}>
                {currentMatchIdx + 1}/{matchIndices.length}
              </span>
              <button
                className={styles.navBtn}
                onClick={prevMatch}
                title={t('logs.prevMatch', 'Previous')}
              >
                ↑
              </button>
              <button
                className={styles.navBtn}
                onClick={nextMatch}
                title={t('logs.nextMatch', 'Next')}
              >
                ↓
              </button>
            </>
          )}
          {logSearch && matchIndices.length === 0 && (
            <span className={styles.matchCount}>{t('logs.noMatches', '0 matches')}</span>
          )}

          {/* Container cycler (cycles through the pod's containers, plus "all"). */}
          <button
            type="button"
            className={styles.button}
            onClick={cycleContainer}
            title={t('logs.container')}
          >
            <span className={styles.buttonGlyph}>▣</span>
            {containerLabel}
            {options.length > 1 && <span className={styles.buttonChevron}>▼</span>}
          </button>
        </div>

        <div className={styles.toolbarSecondary}>
          {/* Timestamp toggle. */}
          <button
            type="button"
            className={cx(styles.toggle, showTimestamps && styles.toggleActive)}
            onClick={toggleTimestamps}
          >
            {t('logs.ts')}
          </button>

          {/* How far back to read. */}
          <select
            className={styles.select}
            value={since}
            onChange={(e) => setLogSince(e.target.value as (typeof SINCE_OPTIONS)[number])}
            title={t('logs.howFarBack')}
          >
            {SINCE_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o === 'all' ? t('logs.sinceAll') : t('logs.sinceLast', o)}
              </option>
            ))}
          </select>

          {/* Previous container — only offered when there *is* one to read (B29).
              A pod that has never restarted has no previous generation, and asking
              for one is a 400. */}
          {showPrevious && (
            <button
              type="button"
              className={cx(styles.toggle, previous && styles.toggleActive)}
              onClick={() => setLogPrevious(!previous)}
              title={t('logs.previousTitle')}
            >
              {t('logs.previous')}
            </button>
          )}

          <button
            type="button"
            className={styles.button}
            onClick={() => void save()}
            title={t('logs.saveTitle')}
          >
            <span className={styles.buttonGlyph}>⇩</span>
            {t('logs.save')}
          </button>

          {/* Wrap toggle */}
          <button
            type="button"
            className={cx(styles.toggle, wrap && styles.toggleActive)}
            onClick={() => setWrap(!wrap)}
            title={t('logs.wrap', 'Wrap lines')}
          >
            {t('logs.wrap', 'Wrap')}
          </button>

          {/* Follow / pause. Meaningless for a previous read: that container is
              dead, so there is nothing to follow. */}
          {!previous && (
            <button
              type="button"
              className={`${styles.follow} ${following ? styles.following : styles.paused}`}
              onClick={toggleFollow}
            >
              {following ? t('logs.pause') : t('logs.follow')}
            </button>
          )}
        </div>
      </div>

      {/* Level filter chips */}
      <div className={styles.levelChips}>
        {LOG_LEVELS.map((lvl) => (
          <button
            key={lvl}
            type="button"
            className={cx(styles.levelChip, levelFilter === lvl && styles.levelChipActive)}
            onClick={() => setLevelFilter(lvl)}
          >
            {lvl}
          </button>
        ))}
      </div>

      <div
        className={cx(styles.viewport, windowed && styles.viewportWindowed)}
        ref={viewportRef}
        style={{ whiteSpace: wrap ? 'pre-wrap' : 'pre' }}
      >
        {/* Hidden single-line probe — measures the row height the windowing
            math is computed from (see the virtualization block above). */}
        <div ref={probeRef} className={styles.line} aria-hidden="true" style={{ position: 'absolute', visibility: 'hidden', pointerEvents: 'none' }}>
          {'\u200b'}
        </div>
        {/* Spacers stand in for the unrendered rows on either side of the
            window, keeping the scrollbar proportional to the full list. */}
        {rowSlice.padTop > 0 && <div style={{ height: rowSlice.padTop }} aria-hidden="true" />}
        {filteredBuffer.slice(rowSlice.start, rowSlice.end).map((line, i) => {
          const idx = rowSlice.start + i;
          return (
            <div
              key={idx}
              ref={(el) => {
                if (el) lineRefs.current.set(idx, el);
                else lineRefs.current.delete(idx);
              }}
            >
              <LogRow
                line={line}
                showTs={showTimestamps}
                showContainer={showContainerTag}
                query={logSearch}
                isCurrentMatch={matchIndices[currentMatchIdx] === idx}
              />
            </div>
          );
        })}
        {rowSlice.padBottom > 0 && <div style={{ height: rowSlice.padBottom }} aria-hidden="true" />}
      </div>

      <div className={styles.footer}>
        <span>{t('logs.linesCount', filteredBuffer.length)}{levelFilter !== 'ALL' ? ` (${logBuffer.length} total)` : ''}</span>
        <span>
          {t('logs.container')}: {containerLabel}
        </span>
        {saveNote && <span className={styles.saveNote}>{saveNote}</span>}
        {previous ? (
          <span style={{ color: 'var(--status-warn)' }}>{t('logs.previousContainer')}</span>
        ) : (
          <span style={{ color: following ? 'var(--status-ok)' : 'var(--status-warn)' }}>
            {following ? t('logs.streaming') : t('logs.paused')}
          </span>
        )}
      </div>
    </>
  );
}

// LogRow component extracted to ./LogRow.tsx
