/**
 * Tests for McpPanel — MCP/AI integration settings.
 *
 * Covers: rendering, config cards, copy buttons, URL display.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { McpPanel } from './McpPanel';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';

let view: RenderResult;

// Mock window.location.origin
const originalLocation = window.location;

beforeEach(() => {
  Object.defineProperty(window, 'location', {
    value: { origin: 'http://localhost:3000' },
    writable: true,
  });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'location', {
    value: originalLocation,
    writable: true,
  });
});

describe('McpPanel', () => {
  describe('rendering', () => {
    it('renders the panel', () => {
      view = render(<McpPanel />);
      expect(view.container.firstChild).not.toBeNull();
    });

    it('renders MCP badge', () => {
      view = render(<McpPanel />);
      expect(view.queryByText('MCP')).not.toBeNull();
    });

    it('renders the MCP endpoint URL', () => {
      view = render(<McpPanel />);
      expect(view.queryByText(/localhost:3000\/mcp/)).not.toBeNull();
    });
  });

  describe('config cards', () => {
    it('renders Claude Desktop card', () => {
      view = render(<McpPanel />);
      expect(view.queryByText(/Claude Desktop/)).not.toBeNull();
    });

    it('renders Claude Code card', () => {
      view = render(<McpPanel />);
      expect(view.queryByText(/Claude Code/)).not.toBeNull();
    });

    it('renders Cursor card', () => {
      view = render(<McpPanel />);
      expect(view.queryByText(/Cursor/)).not.toBeNull();
    });

    it('renders JSON config blocks', () => {
      view = render(<McpPanel />);
      const codeBlocks = view.container.querySelectorAll('pre code');
      expect(codeBlocks.length).toBeGreaterThanOrEqual(3);
    });

    it('includes k7s-local in config', () => {
      view = render(<McpPanel />);
      expect(view.queryByText(/k7s-local/)).not.toBeNull();
    });
  });

  describe('copy buttons', () => {
    it('renders copy buttons for each card', () => {
      view = render(<McpPanel />);
      const copyBtns = view.container.querySelectorAll('button');
      // At least 3 copy buttons (one per card) + possibly extra for Claude Code CLI
      expect(copyBtns.length).toBeGreaterThanOrEqual(3);
    });
  });
});
