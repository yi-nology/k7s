/**
 * Hover-revealed quick actions at the tail of a table row (P3 Task 3).
 *
 * Two 24px icon buttons, absolutely positioned inside the row's LAST cell by
 * the table (see `.quick` / `.tdQuick` in ResourceTable.module.css) so the
 * cluster floats over the cell's tail without adding a column or shifting any
 * width:
 *
 * - 详情: runs the exact same handler a plain row click runs — the button and
 *   the row can never disagree about what "open this" means. For events rows
 *   the whole cluster is not rendered at all (same rule as the context menu).
 * - ⋯: opens the row context menu anchored at the button, through the same
 *   menu state a right-click uses — one menu, two entry points.
 *
 * Both buttons stop propagation so the row's own click handler doesn't
 * double-fire: each action runs its handler exactly once.
 */

import { Info, MoreHorizontal } from 'lucide-react';
import { useTranslation } from '../../hooks/useI18n';
import type { Row } from '../../providers/types';
import styles from './ResourceTable.module.css';

/** Viewport coordinates to anchor the context menu at — the ⋯ button's
 *  top-left, matching what RowContextMenu expects from a right-click. */
export interface QuickMenuAt {
  x: number;
  y: number;
}

interface RowQuickActionsProps {
  row: Row;
  /** 详情 — same behavior as clicking the row itself. */
  onOpenDetail: (row: Row) => void;
  /** ⋯ — open the row context menu at the given viewport position. */
  onOpenMenu: (row: Row, at: QuickMenuAt) => void;
}

export function RowQuickActions({ row, onOpenDetail, onOpenMenu }: RowQuickActionsProps) {
  const { t } = useTranslation();

  const openDetail = (e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenDetail(row);
  };

  const openMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    // Viewport coords (fixed-position menu in a body portal), read from the
    // button so the menu drops from where the user's pointer already is.
    const r = e.currentTarget.getBoundingClientRect();
    onOpenMenu(row, { x: r.left, y: r.bottom });
  };

  return (
    <span className={styles.quick} data-quick-actions>
      <button
        type="button"
        className={styles.quickBtn}
        aria-label={t('table.quick.detail', 'Detail')}
        title={t('table.quick.detail', 'Detail')}
        onClick={openDetail}
      >
        <Info size={14} />
      </button>
      <button
        type="button"
        className={styles.quickBtn}
        aria-label={t('table.quick.more', 'More actions')}
        title={t('table.quick.more', 'More actions')}
        onClick={openMenu}
      >
        <MoreHorizontal size={14} />
      </button>
    </span>
  );
}
