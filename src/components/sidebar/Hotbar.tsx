/**
 * Hotbar: a quick-switch bar at the bottom of the sidebar for pinning
 * favorite clusters/contexts. Renders up to 8 slots; each shows the first
 * two letters of the context name. Clicking a slot switches to that context.
 * Right-clicking a slot shows a "Remove" menu. Empty slots show "+" to pin
 * the current context.
 */

import { useCallback, useRef, useState } from 'react';
import styles from './Hotbar.module.css';
import { useStore } from '../../store';
import { useClickOutside } from '../../hooks/useClickOutside';
import { connectTo } from '../../lib/connect';
import { cx } from '../../lib/cx';
import { useTranslation } from '../../hooks/useI18n';

const MAX_SLOTS = 8;

/** First two letters of the context name, uppercased. */
function initials(name: string): string {
  return name.slice(0, 2).toUpperCase() || '??';
}

export function Hotbar() {
  const { t } = useTranslation();
  const hotbar = useStore((s) => s.hotbar);
  const connection = useStore((s) => s.connection);
  const addHotbarItem = useStore((s) => s.addHotbarItem);
  const removeHotbarItem = useStore((s) => s.removeHotbarItem);

  const [menuTarget, setMenuTarget] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useClickOutside(menuRef, () => setMenuTarget(null), menuTarget !== null);

  const handleSlotClick = useCallback(
    (context: string) => {
      if (context !== connection.context) void connectTo(context);
    },
    [connection.context]
  );

  const handleContextMenu = useCallback((e: React.MouseEvent, context: string) => {
    e.preventDefault();
    setMenuTarget(context);
  }, []);

  const handleRemove = useCallback(
    (context: string) => {
      removeHotbarItem(context);
      setMenuTarget(null);
    },
    [removeHotbarItem]
  );

  const handleAdd = useCallback(() => {
    const current = connection.context;
    if (current) addHotbarItem(current);
  }, [connection.context, addHotbarItem]);

  const emptySlots = MAX_SLOTS - hotbar.length;

  return (
    <div className={styles.hotbar} role="toolbar" aria-label={t('sidebar.hotbar.title', 'Quick switcher')}>
      {hotbar.map((ctx) => {
        const isActive = ctx === connection.context;
        return (
          <div key={ctx} style={{ position: 'relative' }} className={styles.slotWrap}>
            <button
              type="button"
              className={cx(styles.slot, isActive && styles.slotActive)}
              title={ctx}
              aria-label={t('sidebar.hotbar.switchTo', `Switch to ${ctx}`, ctx)}
              aria-current={isActive ? 'true' : undefined}
              onClick={() => handleSlotClick(ctx)}
              onContextMenu={(e) => handleContextMenu(e, ctx)}
            >
              {initials(ctx)}
            </button>
            {menuTarget === ctx && (
              <div className={styles.menu} ref={menuRef}>
                <button
                  type="button"
                  className={styles.menuItem}
                  onClick={() => handleRemove(ctx)}
                >
                  {t('sidebar.hotbar.removeFromHotbar')}
                </button>
              </div>
            )}
          </div>
        );
      })}
      {/* Empty "+" slots — only show one if there's room and a context is connected. */}
      {emptySlots > 0 && connection.context && (
        <button
          type="button"
          className={`${styles.slot} ${styles.slotEmpty}`}
          title={t('sidebar.hotbar.pinContext')}
          onClick={handleAdd}
        >
          +
        </button>
      )}
    </div>
  );
}
