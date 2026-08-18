/**
 * Keyboard shortcuts help dialog — opened via ? key or command palette.
 *
 * Groups shortcuts by context: Global, Table, Editor, Terminal.
 * Data-driven so it stays in sync with the actual keybindings.
 */

import { Dialog } from './Dialog';
import styles from './ShortcutsHelp.module.css';
import { useTranslation } from '../../hooks/useI18n';

interface ShortcutGroup {
  title: string;
  shortcuts: { keys: string; description: string }[];
}

function useShortcutGroups(): ShortcutGroup[] {
  const { t } = useTranslation();
  return [
    {
      title: t('shortcuts.global', 'Global'),
      shortcuts: [
        { keys: '⌘K', description: t('shortcuts.palette', 'Command palette') },
        { keys: ':', description: t('shortcuts.paletteK9s', 'Command palette (k9s)') },
        { keys: '⌘F', description: t('shortcuts.filter', 'Focus filter') },
        { keys: '/', description: t('shortcuts.filterVim', 'Focus filter (vim)') },
        { keys: 'Esc', description: t('shortcuts.esc', 'Close / clear / deselect') },
        { keys: '?', description: t('shortcuts.help', 'This help') },
      ],
    },
    {
      title: t('shortcuts.table', 'Table'),
      shortcuts: [
        { keys: 'j / ↓', description: t('shortcuts.nextRow', 'Next row') },
        { keys: 'k / ↑', description: t('shortcuts.prevRow', 'Previous row') },
        { keys: 'Enter', description: t('shortcuts.openRow', 'Open detail') },
        { keys: 'gg', description: t('shortcuts.firstRow', 'First row') },
        { keys: 'G', description: t('shortcuts.lastRow', 'Last row') },
        { keys: '⌘T', description: t('shortcuts.openInTab', 'Open in new tab') },
      ],
    },
    {
      title: t('shortcuts.detail', 'Detail Panel'),
      shortcuts: [
        { keys: '[ / ]', description: t('shortcuts.cycleTabs', 'Cycle tabs') },
        { keys: '{ / }', description: t('shortcuts.cycleDetailTabs', 'Cycle detail tabs') },
        { keys: '⌘W', description: t('shortcuts.closeTab', 'Close tab / panel') },
      ],
    },
    {
      title: t('shortcuts.editor', 'Editor'),
      shortcuts: [
        { keys: '⌘S', description: t('shortcuts.editorSave', 'Preview / Save') },
        { keys: '⌘F', description: t('shortcuts.editorSearch', 'Search in editor') },
        { keys: '⌘⇧F', description: t('shortcuts.editorReplace', 'Search and replace') },
        { keys: '⌘Z', description: t('shortcuts.editorUndo', 'Undo') },
        { keys: '⌘⇧Z', description: t('shortcuts.editorRedo', 'Redo') },
      ],
    },
    {
      title: t('shortcuts.terminal', 'Terminal'),
      shortcuts: [
        { keys: '⌘F', description: t('shortcuts.termSearch', 'Search in terminal') },
        { keys: '⌘C', description: t('shortcuts.termCopy', 'Copy selection') },
        { keys: '⌘V', description: t('shortcuts.termPaste', 'Paste') },
        { keys: '⌘L', description: t('shortcuts.termClear', 'Clear (via shell)') },
      ],
    },
  ];
}

interface ShortcutsHelpProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutsHelp({ open, onClose }: ShortcutsHelpProps) {
  const groups = useShortcutGroups();
  const { t } = useTranslation();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('shortcuts.title', 'Keyboard Shortcuts')}
      size="md"
    >
      <div className={styles.groups}>
        {groups.map((group) => (
          <div key={group.title} className={styles.group}>
            <div className={styles.groupTitle}>{group.title}</div>
            <div className={styles.list}>
              {group.shortcuts.map((s) => (
                <div key={s.keys} className={styles.row}>
                  <kbd className={styles.kbd}>{s.keys}</kbd>
                  <span className={styles.desc}>{s.description}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
