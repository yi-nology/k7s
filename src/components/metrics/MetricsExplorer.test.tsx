/**
 * Tests for MetricsExplorer — the PromQL query panel.
 *
 * Covers: rendering, header, close button, mode toggle, query input.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetricsExplorer } from './MetricsExplorer';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';

// Mock the provider.
vi.mock('../../providers', () => ({
  getProvider: () => ({
    metricsList: vi.fn().mockResolvedValue([
      { name: 'prometheus', url: 'http://prom:9090' },
    ]),
    metricsQuery: vi.fn().mockResolvedValue({ series: [] }),
    metricsQueryRange: vi.fn().mockResolvedValue({ series: [] }),
    savedQueriesList: vi.fn().mockResolvedValue([]),
    savedQueriesUpsert: vi.fn().mockResolvedValue(undefined),
    savedQueriesRemove: vi.fn().mockResolvedValue(undefined),
    savedQueriesRun: vi.fn().mockResolvedValue({ series: [] }),
    savedQueriesClearCache: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock PlotChart to avoid Plotly dependency.
vi.mock('../detail/PlotChart', () => ({
  Plot: ({ title }: { title: string }) => <div data-testid="plot">{title}</div>,
}));

let view: RenderResult;

afterEach(() => {
  cleanup();
});

describe('MetricsExplorer', () => {
  it('renders the panel', () => {
    view = render(<MetricsExplorer />);
    expect(view.container.firstChild).not.toBeNull();
  });

  it('renders the title', () => {
    view = render(<MetricsExplorer />);
    expect(view.queryByText('Metrics Explorer')).not.toBeNull();
  });

  it('renders close button when onClose is provided', () => {
    const onClose = vi.fn();
    view = render(<MetricsExplorer onClose={onClose} />);
    expect(view.queryByText('Close')).not.toBeNull();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    view = render(<MetricsExplorer onClose={onClose} />);
    const closeBtn = view.queryByText('Close');
    if (closeBtn) view.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders source section', () => {
    view = render(<MetricsExplorer />);
    expect(view.queryByText('Source')).not.toBeNull();
  });

  it('renders Prometheus selector', () => {
    view = render(<MetricsExplorer />);
    expect(view.queryByText('Prometheus')).not.toBeNull();
  });

  it('renders mode toggle', () => {
    view = render(<MetricsExplorer />);
    expect(view.queryByText('Instant')).not.toBeNull();
    expect(view.queryByText('Range')).not.toBeNull();
  });

  it('renders query section', () => {
    view = render(<MetricsExplorer />);
    expect(view.queryByText('Query')).not.toBeNull();
  });

  it('renders run button', () => {
    view = render(<MetricsExplorer />);
    expect(view.queryByText('Run')).not.toBeNull();
  });

  it('renders save button', () => {
    view = render(<MetricsExplorer />);
    expect(view.queryByText('Save')).not.toBeNull();
  });

  it('renders result section', () => {
    view = render(<MetricsExplorer />);
    expect(view.queryByText('Result')).not.toBeNull();
  });

  it('renders range presets in range mode', () => {
    view = render(<MetricsExplorer />);
    expect(view.queryByText('5m')).not.toBeNull();
    expect(view.queryByText('15m')).not.toBeNull();
    expect(view.queryByText('1h')).not.toBeNull();
    expect(view.queryByText('6h')).not.toBeNull();
    expect(view.queryByText('24h')).not.toBeNull();
  });

  it('renders empty state message', () => {
    view = render(<MetricsExplorer />);
    expect(view.queryByText('Run a query to see metrics')).not.toBeNull();
  });
});
