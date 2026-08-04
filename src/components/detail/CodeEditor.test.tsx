/**
 * Tests for CodeEditor — CodeMirror wrapper for YAML editing.
 *
 * Covers: rendering, mount, editable vs read-only modes.
 * Note: CodeMirror is complex; tests focus on the React wrapper behavior.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodeEditor } from './CodeEditor';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';

// Mock CodeMirror modules to avoid heavy dependencies.
vi.mock('@codemirror/state', () => ({
  Compartment: class {
    of() { return []; }
    reconfigure() { return []; }
  },
  EditorState: {
    create: vi.fn(() => ({})),
    readOnly: { of: vi.fn(() => []) },
  },
}));

vi.mock('@codemirror/view', () => ({
  EditorView: Object.assign(
    class {
      static theme: unknown = vi.fn(() => ({}));
      static lineWrapping: unknown = [];
      static editable: unknown = { of: vi.fn(() => []) };
      destroy = vi.fn();
      dispatch = vi.fn();
    },
    {
      updateListener: { of: vi.fn(() => []) },
    }
  ),
  lineNumbers: vi.fn(() => []),
  keymap: { of: vi.fn(() => []) },
}));

vi.mock('@codemirror/commands', () => ({
  defaultKeymap: [],
  history: vi.fn(() => []),
  historyKeymap: [],
}));

vi.mock('@codemirror/lang-yaml', () => ({
  yaml: vi.fn(() => []),
}));

vi.mock('@codemirror/language', () => ({
  HighlightStyle: { define: vi.fn(() => ({})) },
  syntaxHighlighting: vi.fn(() => []),
}));

vi.mock('@lezer/highlight', () => ({
  tags: {
    propertyName: 'propertyName',
    string: 'string',
    special: vi.fn(() => 'special'),
    number: 'number',
    bool: 'bool',
    null: 'null',
    atom: 'atom',
    punctuation: 'punctuation',
    separator: 'separator',
    meta: 'meta',
  },
}));

// Mock the theme hook.
vi.mock('../../hooks/useTheme', () => ({
  useResolvedTheme: () => 'dark',
}));

let view: RenderResult;

afterEach(() => {
  cleanup();
});

describe('CodeEditor', () => {
  describe('rendering', () => {
    it('renders a container div', () => {
      view = render(<CodeEditor value="test yaml" editable={false} />);
      expect(view.container.firstChild).not.toBeNull();
    });

    it('renders with a host div', () => {
      view = render(<CodeEditor value="apiVersion: v1" editable={false} />);
      const div = view.container.querySelector('div');
      expect(div).not.toBeNull();
    });
  });

  describe('props', () => {
    it('accepts value prop', () => {
      view = render(<CodeEditor value="kind: Pod" editable={false} />);
      expect(view.container.firstChild).not.toBeNull();
    });

    it('accepts editable true', () => {
      view = render(<CodeEditor value="test" editable={true} />);
      expect(view.container.firstChild).not.toBeNull();
    });

    it('accepts editable false', () => {
      view = render(<CodeEditor value="test" editable={false} />);
      expect(view.container.firstChild).not.toBeNull();
    });

    it('accepts onChange callback', () => {
      const onChange = vi.fn();
      view = render(<CodeEditor value="test" editable={true} onChange={onChange} />);
      expect(view.container.firstChild).not.toBeNull();
    });

    it('works without onChange', () => {
      view = render(<CodeEditor value="test" editable={true} />);
      expect(view.container.firstChild).not.toBeNull();
    });
  });

  describe('styles', () => {
    it('has flex layout style', () => {
      view = render(<CodeEditor value="test" editable={false} />);
      const div = view.container.firstChild as HTMLElement;
      // flex: 1 gets expanded by the browser to "1 1 0%" or similar
      expect(div?.style.flex).toContain('1');
    });

    it('has minHeight zero for scrolling', () => {
      view = render(<CodeEditor value="test" editable={false} />);
      const div = view.container.firstChild as HTMLElement;
      // Browser may normalize "0" to "0" or "0px"
      expect(div?.style.minHeight === '0' || div?.style.minHeight === '0px').toBe(true);
    });

    it('has overflow hidden', () => {
      view = render(<CodeEditor value="test" editable={false} />);
      const div = view.container.firstChild as HTMLElement;
      expect(div?.style.overflow).toBe('hidden');
    });
  });
});
