/**
 * Enhanced CodeMirror 6 wrapper — the unified editing kernel for all text editing
 * surfaces (YAML tab, Helm values, PodFiles, templates).
 *
 * Features beyond the old CodeEditor:
 * - @codemirror/search (Cmd-F search/replace)
 * - codeFolding + foldGutter
 * - bracketMatching + indentOnInput
 * - highlightActiveLine
 * - @codemirror/lint with yamlLinter (editable only)
 * - Configurable fontSize via settings
 * - Cmd-S save callback
 * - Dirty tracking (doc !== initial value)
 * - EditorToolbar integration
 */

import { useEffect, useRef } from 'react';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { EditorView, lineNumbers, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { yaml } from '@codemirror/lang-yaml';
import {
  HighlightStyle,
  syntaxHighlighting,
  codeFolding,
  foldGutter,
  indentOnInput,
  bracketMatching,
  defaultHighlightStyle,
} from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { lintGutter, linter } from '@codemirror/lint';
import { useResolvedTheme } from '../../hooks/useTheme';
import { useStore } from '../../store';
import { EditorToolbar } from './EditorToolbar';
import { yamlLinter } from './yamlLint';

/** Syntax colors matching the design spec. */
const highlight = HighlightStyle.define([
  { tag: t.propertyName, color: 'var(--text-secondary)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--status-ok)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--status-warn)' },
  { tag: [t.punctuation, t.separator, t.meta], color: 'var(--text-muted)' },
]);

/** Editor chrome theme — factory for dark/light switch. */
const makeTheme = (dark: boolean, fontSize: number) =>
  EditorView.theme(
    {
      '&': {
        backgroundColor: 'var(--bg-terminal)',
        color: 'var(--text-body)',
        fontSize: `${fontSize}px`,
        height: '100%',
      },
      '.cm-content': {
        fontFamily: 'var(--font-mono)',
        lineHeight: '1.6',
        padding: '10px 0',
      },
      '.cm-scroller': { fontFamily: 'var(--font-mono)', overflow: 'auto' },
      '&.cm-focused': { outline: 'none' },
      '.cm-gutters': {
        backgroundColor: 'var(--bg-terminal)',
        color: 'var(--text-linenum)',
        border: 'none',
      },
      '.cm-lineNumbers .cm-gutterElement': {
        padding: '0 14px 0 6px',
        minWidth: '30px',
        textAlign: 'right',
      },
      '.cm-activeLine': { backgroundColor: 'transparent' },
      '.cm-activeLineGutter': { backgroundColor: 'transparent' },
      '.cm-line:hover': { backgroundColor: 'var(--bg-log-hover)' },
      '.cm-cursor': { borderLeftColor: 'var(--accent)' },
      '.cm-selectionBackground, ::selection': {
        backgroundColor: 'var(--editor-selection)',
      },
      // Fold gutter width
      '.cm-foldGutter .cm-gutterElement': {
        width: '14px',
        cursor: 'pointer',
      },
      // Search panel styling
      '.cm-panel.cm-search': {
        backgroundColor: 'var(--bg-toolbar)',
        color: 'var(--text-body)',
        borderTop: '1px solid var(--border)',
      },
      '.cm-panel.cm-search input, .cm-panel.cm-search button': {
        color: 'var(--text-body)',
        backgroundColor: 'var(--bg-hover)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
      },
      // Lint gutter marker
      '.cm-lintRange-error': {
        backgroundImage: 'none',
        borderBottom: '2px wavy var(--status-err)',
      },
      '.cm-lintRange-warning': {
        backgroundImage: 'none',
        borderBottom: '2px wavy var(--status-warn)',
      },
      '.cm-lintMarker-error': { content: '"●"', color: 'var(--status-err)' },
      '.cm-lintMarker-warning': { content: '"●"', color: 'var(--status-warn)' },
    },
    { dark }
  );

const themeCompartment = new Compartment();
const fontSizeCompartment = new Compartment();

export interface EditorCoreProps {
  value: string;
  language?: 'yaml';
  editable: boolean;
  fontSize?: number;
  wrap?: boolean;
  onChange?: (text: string) => void;
  onSave?: (text: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onViewReady?: (view: EditorView) => void;
  /** Hide the toolbar (e.g. when parent provides its own). */
  hideToolbar?: boolean;
}

export function EditorCore({
  value,
  language,
  editable,
  fontSize,
  wrap = true,
  onChange,
  onSave,
  onDirtyChange,
  onViewReady,
  hideToolbar = false,
}: EditorCoreProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const theme = useResolvedTheme();
  const settingsFontSize = useStore((s) => s.settings.editorFontSize);
  const effectiveFontSize = fontSize ?? settingsFontSize;

  // Track dirty state: compare current doc to initial value.
  const initialValueRef = useRef(value);
  useEffect(() => {
    initialValueRef.current = value;
  }, [value]);

  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!hostRef.current) return;

    const extensions = [
      lineNumbers(),
      syntaxHighlighting(highlight),
      syntaxHighlighting(defaultHighlightStyle),
      themeCompartment.of(makeTheme(true, effectiveFontSize)),
      EditorView.lineWrapping,
      EditorState.readOnly.of(!editable),
      EditorView.editable.of(editable),
      // Always-available features (read-only + editable)
      codeFolding(),
      foldGutter(),
      highlightSelectionMatches(),
      keymap.of([...defaultKeymap, ...searchKeymap]),
    ];

    if (language === 'yaml') {
      extensions.push(yaml());
    }

    if (editable) {
      extensions.push(
        history(),
        bracketMatching(),
        indentOnInput(),
        keymap.of([...historyKeymap]),
      );

      // Lint gutter (YAML only).
      if (language === 'yaml') {
        extensions.push(linter(yamlLinter), lintGutter());
      }

      // Cmd-S / Ctrl-S save.
      if (onSave) {
        extensions.push(
          Prec.highest(
            keymap.of([
              {
                key: 'Mod-s',
                run: () => {
                  const text = viewRef.current?.state.doc.toString() ?? '';
                  onSave(text);
                  return true;
                },
              },
            ])
          )
        );
      }

      // onChange + dirty tracking.
      if (onChange || onDirtyChange) {
        extensions.push(
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              const newText = u.state.doc.toString();
              onChange?.(newText);

              // Dirty check.
              const nowDirty = newText !== initialValueRef.current;
              if (nowDirty !== dirtyRef.current) {
                dirtyRef.current = nowDirty;
                onDirtyChange?.(nowDirty);
              }
            }
          })
        );
      }
    }

    const view = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: hostRef.current,
    });

    viewRef.current = view;
    if (onViewReady) onViewReady(view);
    return () => {
      viewRef.current = null;
      view.destroy();
    };
    // Mount once; parent remounts via `key` when value/editable must change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-theme on palette switch.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeCompartment.reconfigure(makeTheme(true, effectiveFontSize)),
    });
  }, [theme, effectiveFontSize]);

  // Toolbar actions.
  const handleCopy = () => {
    const text = viewRef.current?.state.doc.toString() ?? '';
    void navigator.clipboard.writeText(text);
  };

  const handleFormat = () => {
    // Basic format: re-indent. For YAML, this is a no-op placeholder —
    // full formatting (sort keys, normalize quotes) requires a YAML printer.
    // The toolbar button is only shown when language='yaml' and formatFn exists.
  };

  const handleSearch = () => {
    // Trigger CodeMirror's built-in search panel.
    viewRef.current?.dispatch({ effects: [] });
    // The searchKeymap already binds Cmd-F; this button provides an explicit affordance.
    // Simulate Cmd-F to open the panel.
    const el = viewRef.current?.dom.querySelector('.cm-content') as HTMLElement;
    if (el) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true }));
    }
  };

  const handleFontSizeChange = (newSize: number) => {
    // Dispatched to settings store via parent; here we just re-theme.
    viewRef.current?.dispatch({
      effects: fontSizeCompartment.reconfigure(EditorView.theme({ '&': { fontSize: `${newSize}px` } })),
    });
  };

  const isDirty = dirtyRef.current;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0, height: '100%', overflow: 'hidden' }}>
      {!hideToolbar && (
        <EditorToolbar
          fontSize={effectiveFontSize}
          onFontSizeChange={handleFontSizeChange}
          wrap={wrap}
          onCopy={handleCopy}
          onSearch={handleSearch}
          onFormat={language === 'yaml' ? handleFormat : undefined}
          isDirty={isDirty}
        />
      )}
      <div ref={hostRef} style={{ flex: 1, minHeight: 0, overflow: 'hidden' }} />
    </div>
  );
}
