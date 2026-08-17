/**
 * The xterm terminal behind the Shell tabs — shared by the pod shell (B4/B19) and
 * the node debug shell (B53).
 *
 * Enhancements over the original:
 * - @xterm/addon-search (Ctrl-F terminal search)
 * - @xterm/addon-web-links (clickable URLs)
 * - Configurable fontSize and scrollback from settings
 * - Clipboard handling (Cmd-C/V in Tauri webview)
 */

import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { useResolvedTheme } from '../../hooks/useTheme';
import { useStore } from '../../store';
import { termTheme } from '../../lib/theme';

/** Anything that can receive keystrokes and a terminal size. */
export interface Resizable {
  resize(cols: number, rows: number): void;
}

export interface TerminalHandles {
  /** Attach to the host element. */
  hostRef: React.RefObject<HTMLDivElement | null>;
  /** The live terminal, or null before mount / after disposal. */
  termRef: React.RefObject<Terminal | null>;
  /** Set this so panel resizes are forwarded to the running session. */
  sessionRef: React.RefObject<Resizable | null>;
  /** The search addon, for programmatic search. */
  searchRef: React.RefObject<SearchAddon | null>;
}

/**
 * Create and own a terminal, rebuilt whenever `key` changes.
 *
 * `key` is the identity of what the terminal is attached to (pod uid + container,
 * or node name). Changing it means a genuinely different target, so the scrollback
 * *should* go — unlike a reconnect, which must not rebuild.
 */
export function useTerminal(key: string | null): TerminalHandles {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const sessionRef = useRef<Resizable | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const theme = useResolvedTheme();
  const fontSize = useStore((s) => s.settings.terminalFontSize);
  const scrollback = useStore((s) => s.settings.terminalScrollback);

  useEffect(() => {
    if (!hostRef.current || !key) return;

    const host = hostRef.current;
    const term = new Terminal({
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      fontSize,
      cursorBlink: true,
      scrollback,
      theme: termTheme(host),
    });

    // Addons
    const fit = new FitAddon();
    const search = new SearchAddon();
    const webLinks = new WebLinksAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(webLinks);
    term.open(host);
    fit.fit();

    termRef.current = term;
    searchRef.current = search;

    // Clipboard handling for Tauri webview (Cmd-C/V).
    term.attachCustomKeyEventHandler((e) => {
      // Cmd-C / Ctrl-C: copy selection if any, otherwise let xterm handle (SIGINT).
      if ((e.metaKey || e.ctrlKey) && e.key === 'c' && e.type === 'keydown') {
        const sel = term.getSelection();
        if (sel) {
          void navigator.clipboard.writeText(sel);
          return false; // prevent xterm's default copy
        }
        return true; // no selection → let Ctrl-C through as SIGINT
      }
      // Cmd-V / Ctrl-V: paste from clipboard.
      if ((e.metaKey || e.ctrlKey) && e.key === 'v' && e.type === 'keydown') {
        void navigator.clipboard.readText().then((text) => {
          if (text && sessionRef.current) {
            // Write through the session handle so it reaches the container.
            (sessionRef.current as { input?: (d: string) => void }).input?.(text);
          }
        });
        return false;
      }
      return true;
    });

    // Refit + report size when the panel resizes.
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        sessionRef.current?.resize(term.cols, term.rows);
      } catch {
        /* element detached mid-resize */
      }
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      webLinks.dispose();
      search.dispose();
      term.dispose();
      termRef.current = null;
      searchRef.current = null;
    };
  }, [key, fontSize, scrollback]);

  // Palette changes re-theme in place rather than rebuilding.
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = termTheme(hostRef.current);
  }, [theme, key]);

  // Hot-update fontSize when settings change (without rebuilding terminal).
  useEffect(() => {
    if (termRef.current) termRef.current.options.fontSize = fontSize;
  }, [fontSize]);

  return { hostRef, termRef, sessionRef, searchRef };
}
