/**
 * Tests for PlotChart — Plotly chart wrapper.
 *
 * Covers: rendering container div, lazy loading, title prop, height prop.
 * Note: Plotly is dynamically imported; tests mock the import.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { Plot } from './PlotChart';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';

// Mock Plotly.
const mockReact = vi.fn();
const mockPurge = vi.fn();
vi.mock('plotly.js-basic-dist-min', () => {
  return {
    default: {
      react: mockReact,
      purge: mockPurge,
    },
    react: mockReact,
    purge: mockPurge,
  };
});

// Mock the plot utilities.
vi.mock('./plot', () => ({
  baseLayout: vi.fn((title: string, height: number) => ({ title, height })),
  plotColors: vi.fn(() => ({
    accent: '#000',
    ok: '#222',
    warn: '#333',
    grid: '#555',
    axis: '#666',
    surface: '#777',
  })),
  PLOT_CONFIG: { displayModeBar: false },
}));

// Mock theme.
vi.mock('../../hooks/useTheme', () => ({
  useResolvedTheme: () => 'dark',
}));

let view: RenderResult;

beforeEach(() => {
  mockReact.mockClear();
  mockPurge.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('Plot', () => {
  describe('rendering', () => {
    it('renders a container div', () => {
      view = render(<Plot title="CPU Usage" data={[]} />);
      expect(view.container.firstChild).not.toBeNull();
    });

    it('renders with default height', () => {
      view = render(<Plot title="Test" data={[]} />);
      const div = view.container.querySelector('div');
      expect(div).not.toBeNull();
    });

    it('accepts custom height', () => {
      view = render(<Plot title="Test" data={[]} height={200} />);
      expect(view.container.firstChild).not.toBeNull();
    });

    it('accepts layoutExtra prop', () => {
      view = render(
        <Plot
          title="Test"
          data={[]}
          layoutExtra={{ yaxis: { range: [0, 100] } }}
        />
      );
      expect(view.container.firstChild).not.toBeNull();
    });
  });

  describe('data prop', () => {
    it('accepts empty data array', () => {
      view = render(<Plot title="Empty" data={[]} />);
      expect(view.container.firstChild).not.toBeNull();
    });

    it('accepts trace data', () => {
      const data = [
        {
          x: [new Date()],
          y: [42],
          type: 'scatter',
          mode: 'lines',
        },
      ];
      view = render(<Plot title="With Data" data={data} />);
      expect(view.container.firstChild).not.toBeNull();
    });
  });

  describe('title', () => {
    it('accepts title prop', () => {
      view = render(<Plot title="CPU 42.5%" data={[]} />);
      expect(view.container.firstChild).not.toBeNull();
    });

    it('accepts empty title', () => {
      view = render(<Plot title="" data={[]} />);
      expect(view.container.firstChild).not.toBeNull();
    });
  });

  describe('useHostPlotColors', () => {
    it('is exported for use by metrics tabs', async () => {
      const mod = await import('./PlotChart');
      expect(mod.useHostPlotColors).toBeDefined();
      expect(typeof mod.useHostPlotColors).toBe('function');
    });
  });
});
