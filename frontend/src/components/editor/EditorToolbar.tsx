/**
 * Unified toolbar for EditorCore — provides copy, search, format, font size, wrap toggle.
 * Shown above the editor; read-only views show a reduced set.
 */

import { useState } from 'react';
import { Copy, Search, AlignLeft, Minus, Plus } from 'lucide-react';
import styles from './EditorCore.module.css';
import { useTranslation } from '../../hooks/useI18n';

interface EditorToolbarProps {
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  wrap: boolean;
  onCopy: () => void;
  onSearch: () => void;
  onFormat?: () => void;
  isDirty?: boolean;
}

const FONT_MIN = 9;
const FONT_MAX = 18;

export function EditorToolbar({
  fontSize,
  onFontSizeChange,
  wrap: _wrap,
  onCopy,
  onSearch,
  onFormat,
  isDirty,
}: EditorToolbarProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={styles.toolbar}>
      <div className={styles.toolbarGroup}>
        <button
          type="button"
          className={styles.toolbarBtn}
          onClick={handleCopy}
          title={t('editor.copy', 'Copy')}
          aria-label={t('editor.copy', 'Copy')}
        >
          <Copy size={13} />
          {copied && <span style={{ marginLeft: 2, fontSize: 10 }}>✓</span>}
        </button>
        <button
          type="button"
          className={styles.toolbarBtn}
          onClick={onSearch}
          title={t('editor.search', 'Search (⌘F)')}
          aria-label={t('editor.search', 'Search')}
        >
          <Search size={13} />
        </button>
        {onFormat && (
          <button
            type="button"
            className={styles.toolbarBtn}
            onClick={onFormat}
            title={t('editor.format', 'Format')}
            aria-label={t('editor.format', 'Format')}
          >
            <AlignLeft size={13} />
          </button>
        )}
      </div>

      <div className={styles.toolbarSep} />

      <div className={styles.toolbarGroup}>
        <button
          type="button"
          className={styles.toolbarBtn}
          onClick={() => onFontSizeChange(Math.max(FONT_MIN, fontSize - 1))}
          title={t('editor.fontDecrease', 'Decrease font size')}
          aria-label={t('editor.fontDecrease', 'Decrease font size')}
        >
          <Minus size={12} />
        </button>
        <span className={styles.toolbarLabel}>{fontSize}px</span>
        <button
          type="button"
          className={styles.toolbarBtn}
          onClick={() => onFontSizeChange(Math.min(FONT_MAX, fontSize + 1))}
          title={t('editor.fontIncrease', 'Increase font size')}
          aria-label={t('editor.fontIncrease', 'Increase font size')}
        >
          <Plus size={12} />
        </button>
      </div>

      {isDirty && (
        <span className={styles.dirtyDot} title={t('editor.unsaved', 'Unsaved changes')} />
      )}
    </div>
  );
}
