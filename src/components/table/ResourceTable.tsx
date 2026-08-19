/**
 * The generic resource table (Design §3), used for every kind. Columns come from
 * the kind's metadata; rows come from the store and are namespace-filtered,
 * metrics-overlaid (pods/nodes), and tone-colored. Rows open the detail panel on
 * click, except the read-only Events feed (B14).
 *
 * Large tables render only the rows near the viewport (B21). Filtering, metrics
 * overlay and sorting all still run over the full dataset — only what reaches the
 * DOM is windowed. See `VIRTUAL_THRESHOLD` for why small tables opt out entirely.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Lock, Download } from 'lucide-react';
import styles from './ResourceTable.module.css';
import { rowsFor, useStore } from '../../store';
import { useNow } from '../../hooks/useNow';
import { useTableKeys } from '../../hooks/useTableKeys';
import { useTranslation } from '../../hooks/useI18n';
import { useNav, useNamespace, useTableFilter, useEventsSince, useSort, useSelection, useCustomKinds } from '../../hooks/useStoreHooks';
import { toneColor } from '../../lib/tone';
import { isClusterScoped, isRolloutKind, kindMeta, navIdForKind } from '../../lib/kinds';
import { toCsv, downloadCsv } from '../../lib/exportCsv';
import { sortRows } from '../../lib/sort';
import { parseFilter, matchesFilter } from '../../lib/filter';
import { eventWithinSince, SINCE_OPTIONS, type SinceOption } from '../../lib/events';
import { scrollToShow } from '../../lib/virtual';
import type { NavTarget, NodeMetricsMap, PodMetricsMap, Row } from '../../providers/types';
import {
  applyClick,
  pruneSelection,
  selectedInOrder,
  selectionForContextMenu,
} from '../../lib/selection';
import { RowContextMenu, type ContextMenuAt } from '../actions/RowContextMenu';
import { headerHeight, columnWidth, renderCell, overlayMetrics } from './tableUtils';
import { useVirtualRows } from './useVirtualRows';

/** Stable empty objects — used when a kind doesn't need metrics/podRows, so the
 *  selector returns the same reference every time and skips the rows recompute. */
const EMPTY_POD_METRICS: PodMetricsMap = {};
const EMPTY_NODE_METRICS: NodeMetricsMap = {};
const EMPTY_POD_ROWS: Row[] = [];

/** Kinds the create-workload wizard can actually build (Deployment /
 * StatefulSet / DaemonSet — see workloadSpec.ts KIND_OF). NOT every kind in
 * the workloads section: jobs/cronjobs/pods/helm live there too, but routing
 * them to the wizard would open a builder that cannot create their kind. */
const WIZARD_KINDS = new Set(['deployments', 'statefulsets', 'daemonsets']);

export function ResourceTable() {
  const nav = useNav();
  const namespace = useNamespace();
  const { tableFilter, setTableFilter } = useTableFilter();
  const { eventsSince, setEventsSince } = useEventsSince();
  const { sortCol, sortDir, toggleSort } = useSort();
  const allRows = useStore((s) => rowsFor(s.rows, nav));
  // Only subscribe to the metrics that the current nav kind actually uses.
  // podMetrics/nodeMetrics change every ~15s (metrics poll); skipping the
  // subscription for kinds that don't overlay metrics avoids a full table
  // re-render on every tick.
  const needsPodMetrics = nav === 'pods' || isRolloutKind(nav);
  const needsNodeMetrics = nav === 'nodes';
  const podMetrics = useStore((s) => (needsPodMetrics ? s.podMetrics : EMPTY_POD_METRICS));
  const nodeMetrics = useStore((s) => (needsNodeMetrics ? s.nodeMetrics : EMPTY_NODE_METRICS));
  // The full pods list, used to derive per-namespace pod counts (B12) and
  // workload aggregated metrics. Only subscribe when the current kind needs it.
  const needsPodRows = nav === 'namespaces' || isRolloutKind(nav);
  const podRows = useStore((s) => (needsPodRows ? s.rows.pods : EMPTY_POD_ROWS));
  const selectedUid = useStore((s) => s.selectedRow?.uid ?? null);
  const selectRow = useStore((s) => s.selectRow);
  const selection = useSelection();
  const setSelection = useStore((s) => s.setSelection);
  const clearSelection = useStore((s) => s.clearSelection);
  const navigateTo = useStore((s) => s.navigateTo);
  const openDetailTab = useStore((s) => s.openDetailTab);
  const customKinds = useCustomKinds();
  // Open the create-from-template overlay. Lives on the generic toolbar so any
  // kind page (Deployments, Pods, Nodes, …) gets the affordance — the picker
  // itself filters to the templates available for the cluster (Bxx).
  const openOverlay = useStore((s) => s.openOverlay);
  const watchStatus = useStore((s) => s.watchStatus);
  const { locale, t } = useTranslation();

  // Age columns re-render on a 30s tick.
  const now = useNow();

  // Undefined only for a nav pointing at a kind this cluster doesn't have — e.g.
  // a persisted CRD kind after switching to a cluster without that CRD (B15).
  const meta = kindMeta(nav, customKinds);
  const columns = meta?.columns ?? [];

  // An event row navigates to the object it's about, but only when that object's
  // kind is one we list (B33). Other kinds resolve to null so the row stays inert
  // — the same read-only feel as B14, now the exception rather than the rule.
  const eventTarget = useCallback(
    (row: Row): NavTarget | null => {
      const inv = row.involved;
      if (!inv) return null;
      const kind = navIdForKind(inv.kind, inv.apiVersion, customKinds);
      return kind ? { kind, namespace: inv.namespace, name: inv.name } : null;
    },
    [customKinds]
  );

  // Whether a row responds to a click: every kind but events (always), and an
  // event only when its target resolves.
  const rowClickable = useCallback(
    (row: Row): boolean => (nav === 'events' ? eventTarget(row) !== null : true),
    [nav, eventTarget]
  );

  /**
   * The visible rows' uids, in display order.
   *
   * A ref because the ordered list is computed *below* (it depends on the filter,
   * the metrics overlay, and the sort) while the click handler is defined above
   * it, and because range selection needs the order at click time rather than at
   * render time. Keyed by uid throughout — indices move under sorting and the
   * 30-second age re-render.
   */
  const orderedUidsRef = useRef<string[]>([]);

  /**
   * Click a row. Modifiers extend the selection instead of replacing it (B39).
   *
   * `selectRow` deliberately still runs for a plain click — it also resets the
   * detail panel's per-object state — but a modified click must *not*, or
   * ⌘-clicking a second pod would swap the panel out from under the selection
   * you were building.
   */
  const onSelect = useCallback(
    (
      row: Row,
      mods?: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; button?: number }
    ) => {
      if (nav === 'events') {
        const target = eventTarget(row);
        if (target) navigateTo(target);
        return;
      }
      // ⌘ on macOS, Ctrl elsewhere. Mapped here, once, so lib/selection stays
      // platform-agnostic.
      const cmd = (mods?.metaKey ?? false) || (mods?.ctrlKey ?? false);
      const range = mods?.shiftKey ?? false;
      const middle = mods?.button === 1;
      // Ctrl/Cmd+Click or middle-click: open the resource in a new detail tab.
      if ((cmd && !range) || middle) {
        openDetailTab(nav, row);
        return;
      }
      // Shift+Click (with or without Cmd/Ctrl): range/toggle selection.
      if (range) {
        const current = useStore.getState().selection;
        const toggle = cmd;
        setSelection(applyClick(current, orderedUidsRef.current, row.uid, { range, toggle }));
        return;
      }
      selectRow(row);
    },
    [nav, eventTarget, navigateTo, selectRow, setSelection, openDetailTab]
  );

  // Namespace filter (cluster-scoped kinds ignore it), text filter, metrics overlay,
  // then optional column sort. When no column is chosen, server order is preserved
  // (which is what orders the Events feed — Warnings first, then newest).
  // Parse the filter once per keystroke; it splits into label selectors and free
  // text (B33). With no `key=value` term this is the pre-B33 substring filter.
  const parsed = useMemo(() => parseFilter(tableFilter), [tableFilter]);
  const rows = useMemo(() => {
    const filtered = allRows.filter((r) => {
      // Namespace filter — cluster-scoped kinds ignore it. Events are namespaced
      // (despite living in the Cluster nav group), so the filter narrows them.
      if (!isClusterScoped(nav, customKinds) && namespace !== 'all' && r.namespace !== namespace) {
        return false;
      }
      // Events time-range filter: map_event puts the last-seen epoch (ms) as the
      // sort key on the AGE cell (index 4). Only the events kind carries it, so
      // this is a no-op for every other kind.
      if (nav === 'events' && eventsSince !== 'all') {
        const seenMs = r.cells[4]?.sort;
        if (typeof seenMs === 'number' && !eventWithinSince(seenMs, eventsSince, now)) {
          return false;
        }
      }
      return matchesFilter(r, parsed, nav);
    });
    const overlaid = overlayMetrics(nav, filtered, podMetrics, nodeMetrics, podRows);
    return sortCol === null ? overlaid : sortRows(overlaid, sortCol, sortDir, now);
  }, [
    nav,
    allRows,
    namespace,
    parsed,
    eventsSince,
    now,
    podMetrics,
    nodeMetrics,
    podRows,
    sortCol,
    sortDir,
    customKinds,
  ]);

  const selectionSet = useMemo(() => new Set(selection.selected), [selection]);
  const orderedUids = useMemo(() => rows.map((r) => r.uid), [rows]);
  orderedUidsRef.current = orderedUids;

  // Drop selected rows that are no longer visible (B39). Filtering, sorting and
  // watch updates can hide rows the selection still names, and a bulk action must
  // never act on something the user can no longer see it selected.
  useEffect(() => {
    const pruned = pruneSelection(selection, orderedUids);
    // pruneSelection preserves identity when nothing changed, so this can't loop.
    if (pruned !== selection) setSelection(pruned);
  }, [orderedUids, selection, setSelection]);

  // ---- row context menu (B39) ----
  const [menuAt, setMenuAt] = useState<ContextMenuAt | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);

  /** The rows a context-menu action would apply to, in display order. */
  const menuRows = useMemo(() => selectedInOrder(selection, rows), [selection, rows]);

  const onRowContextMenu = useCallback(
    (e: React.MouseEvent, row: Row) => {
      // Events navigate rather than act, so there is nothing to offer.
      if (nav === 'events') return;
      e.preventDefault();
      // Right-clicking outside the selection collapses to this row; inside it,
      // the selection stands (see selectionForContextMenu). Read from the store
      // for the same staleness reason as onSelect.
      setSelection(selectionForContextMenu(useStore.getState().selection, row.uid));
      setMenuError(null);
      setMenuAt({ x: e.clientX, y: e.clientY });
    },
    [nav, setSelection]
  );

  // Keyboard navigation: highlighted row index + `/`-to-focus the filter.
  const filterRef = useRef<HTMLInputElement>(null);
  const highlight = useTableKeys(rows, onSelect, () => filterRef.current?.focus(), nav);

  // Windowing (B21). Sorting/filtering above still run over the full dataset;
  // only what reaches the DOM is trimmed.
  const scrollRef = useRef<HTMLDivElement>(null);
  const { virtual, window: win } = useVirtualRows(scrollRef, rows.length);
  const visible = virtual ? rows.slice(win.start, win.end) : rows;

  /** Bring row `index` on screen, whichever rendering mode is in play. */
  const revealRow = useCallback(
    (index: number) => {
      const el = scrollRef.current;
      if (!el || index < 0) return;
      if (virtual) {
        // A windowed row may not exist in the DOM at all, so its position is
        // computed rather than scrollIntoView'd.
        const to = scrollToShow(index, el.scrollTop, el.clientHeight, ROW_HEIGHT, headerHeight(el));
        if (to !== null) el.scrollTop = to;
      } else {
        // Natural row heights here, so let the browser measure it.
        el.querySelector(`[data-row-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
      }
    },
    [virtual]
  );

  // Keep the keyboard highlight on screen.
  useEffect(() => {
    revealRow(highlight);
  }, [highlight, revealRow]);

  // Same for a row selected from somewhere other than this table — the command
  // palette jumps straight to an object (B28), and landing on it scrolled out of
  // sight would make the jump feel like it missed. Keyed on the uid rather than
  // the index so a live row update (a restart count ticking) doesn't yank the
  // scroll back while you're reading elsewhere.
  useEffect(() => {
    if (!selectedUid) return;
    revealRow(rows.findIndex((r) => r.uid === selectedUid));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUid, nav]);

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <div className={styles.search}>
          <span className={styles.searchIcon}>⌕</span>
          <input
            ref={filterRef}
            className={styles.searchInput}
            value={tableFilter}
            onChange={(e) => setTableFilter(e.target.value)}
            placeholder={t('table.filterPlaceholder')}
            aria-label={t('table.filterPlaceholder')}
            data-table-filter
            data-filter-input
          />
        </div>
        {selection.selected.length > 1 && (
          <div className={styles.selectionBar} data-testid="selection-bar">
            <span className={styles.selectionCount}>
              {selection.selected.length} {t('table.selected')}
            </span>
            <button
              className={styles.selectionClear}
              onClick={clearSelection}
              title={t('chrome.common.dismiss')}
            >
              ×
            </button>
          </div>
        )}
        {/* Events time-range filter. The watcher keeps a live snapshot capped at
            the newest 500; this narrows it to a window so "what just happened"
            isn't drowned in older rows. Cluster-scoped past --event-ttl is gone
            upstream, so "all" is already bounded by the API server. */}
        {nav === 'events' && (
          <select
            className={styles.sinceSelect}
            value={eventsSince}
            onChange={(e) => setEventsSince(e.target.value as SinceOption)}
            title={t('events.howFarBack')}
            data-testid="events-since"
          >
            {SINCE_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o === 'all' ? t('events.sinceAll') : t('events.sinceLast', o)}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className={styles.newBtn}
          title={t('table.csvExportTitle', 'Export table as CSV')}
          data-testid="export-csv"
          onClick={() => {
            if (!meta) return;
            const csv = toCsv(columns, rows);
            downloadCsv(`${nav}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
          }}
        >
          <Download size={14} />
        </button>
        {/* "New" affordance. Mirrors the sidebar Tools → Templates entry so the
            create path is reachable from any kind page, not only via the
            sidebar. The icon matches the sidebar's `✚` so the two surfaces
            feel like one feature, not two. Routing (P2): the kinds the wizard
            can build (WIZARD_KINDS — Deployment/STS/DS only) get the
            create-workload wizard, ingresses get the ingress editor
            (form-create capable, previously unreachable), everything else —
            including jobs/cronjobs/pods/helm, which the wizard cannot
            create — keeps the generic template picker. */}
        <button
          type="button"
          className={styles.newBtn}
          onClick={() =>
            openOverlay(
              nav === 'ingresses'
                ? 'ingress-editor'
                : WIZARD_KINDS.has(nav)
                  ? 'wizard'
                  : 'templates'
            )
          }
          title={t('table.newTitle', 'Create a resource from a YAML template')}
          data-testid="new-resource"
        >
          <span className={styles.newIcon} aria-hidden="true">
            +
          </span>
          <span>{t('table.new', 'New')}</span>
        </button>
      </div>
      <div className={styles.wrap} ref={scrollRef}>
        <table
          className={`${styles.table} ${styles.tableFixed}`}
          role="grid"
          aria-label={t('table.ariaLabel', `${nav} resources`)}
        >
          {/* Fixed layout takes its widths from <col>, and divides the width
            equally when there are none — which would squeeze NAME to the same
            share as RESTARTS. Always rendered so columns stay consistent
            regardless of row count. */}
          {
            <colgroup>
              {columns.map((col) => (
                <col key={col} style={{ width: columnWidth(col) }} />
              ))}
            </colgroup>
          }
          <thead>
            <tr>
              {columns.map((col, i) => (
                <th
                  key={col}
                  className={styles.th}
                  onClick={() => toggleSort(i)}
                  aria-sort={
                    sortCol === i ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
                  }
                >
                  {col}
                  {sortCol === i && (
                    <span className={styles.sortArrow} aria-hidden="true">
                      {sortDir === 'asc' ? ' ▲' : ' ▼'}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Spacers stand in for the rows outside the window, so the scrollbar
              reflects the whole list rather than what's rendered. */}
            {win.padTop > 0 && <tr style={{ height: win.padTop }} />}
            {visible.map((row, i) => {
              const index = virtual ? win.start + i : i;
              // Two distinct things (B39): the row whose detail panel is open, and
              // the rows a bulk action would hit. They coincide for a plain click,
              // but a ⌘-click adds to the selection without moving the panel — so a
              // row can be in the selection without being the panel's row.
              const selected = row.uid === selectedUid;
              const inSelection = selectionSet.has(row.uid);
              return (
                <tr
                  key={row.uid}
                  data-row-index={index}
                  role="row"
                  aria-selected={selected || inSelection}
                  className={[
                    styles.row,
                    virtual ? styles.rowFixed : '',
                    rowClickable(row) ? styles.rowClickable : '',
                    selected ? styles.rowSelected : '',
                    inSelection && !selected ? styles.rowInSelection : '',
                    index === highlight ? styles.rowHighlight : '',
                  ].join(' ')}
                  // Height comes from the same constant the spacer math uses, so the
                  // two cannot drift apart. Natural height when not windowed.
                  style={virtual ? { height: ROW_HEIGHT } : undefined}
                  onClick={(e) => onSelect(row, e)}
                  onAuxClick={(e) => {
                    if (e.button === 1) onSelect(row, { ...e, button: 1 });
                  }}
                  onContextMenu={(e) => onRowContextMenu(e, row)}
                >
                  {row.cells.map((cell, j) => (
                    // When the cell carries a status dot, renderCell returns a
                    // fully-styled <span> that owns its own color — so the <td>
                    // stays neutral and the pill stands out instead of being
                    // tinted by the table's tone.
                    <td
                      key={j}
                      role="gridcell"
                      className={styles.td}
                      style={cell.dot ? undefined : { color: toneColor(cell.tone) }}
                    >
                      {renderCell(cell, now, locale)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {win.padBottom > 0 && <tr style={{ height: win.padBottom }} />}
          </tbody>
        </table>
        {rows.length === 0 && watchStatus[nav] === 'forbidden' ? (
          <div className={styles.forbidden}>
            <Lock size={20} />
            <span>
              {t('table.forbidden', 'No permission to view this resource (RBAC Forbidden)')}
            </span>
          </div>
        ) : rows.length === 0 ? (
          <div className={styles.empty}>
            {/* Differentiate the message by cause: "no resources match filter"
                only when the user typed a filter; otherwise the cause is the
                namespace picker (or an empty kind) and we don't claim a filter
                was at fault. */}
            <span>
              {tableFilter.trim() === ''
                ? t('table.emptyNone', 'no resources')
                : t('table.empty', 'no resources match filter')}
            </span>
            {/* Empty wizard-buildable kind with no filter: the empty state is
                the real problem ("nothing to look at"), so offer the way out.
                WIZARD_KINDS only — jobs/pods/helm are workload-section kinds
                the wizard cannot build (they'd open a Deployment builder),
                and an empty ConfigMap list is normal, not something to create
                your way out of. */}
            {tableFilter.trim() === '' && WIZARD_KINDS.has(nav) && (
              <button
                type="button"
                className={styles.emptyCta}
                data-testid="empty-cta"
                onClick={() => openOverlay('wizard')}
              >
                {t('table.emptyCta', 'Create your first workload')}
              </button>
            )}
          </div>
        ) : null}
      </div>

      {/* Bulk-action failures (B39). In the table rather than the detail panel,
          because a bulk action can be run entirely from the row menu with no
          panel open — reporting into the panel would silently swallow it. */}
      {menuError && (
        <button
          type="button"
          className={styles.actionError}
          onClick={() => setMenuError(null)}
          title={t('chrome.common.dismiss')}
        >
          {menuError}
        </button>
      )}

      {menuAt && menuRows.length > 0 && (
        <RowContextMenu
          at={menuAt}
          kind={nav}
          rows={menuRows}
          onError={setMenuError}
          scrollHost={scrollRef.current}
          onClose={() => setMenuAt(null)}
          onGone={clearSelection}
        />
      )}
    </div>
  );
}

/**
 * Row height used by the windowing math (B21), and the single source of it: it's
 * applied to windowed rows inline, so the spacer arithmetic and the real layout
 * cannot disagree. The design's rows are 26px.
 */
const ROW_HEIGHT = 26;

// Utility functions extracted to ./tableUtils.ts:
// - headerHeight: sticky header height calculation
// - columnWidth: column width calculation based on header name

// useVirtualRows hook extracted to ./useVirtualRows.ts

// renderCell and overlayMetrics functions extracted to ./tableUtils.ts
