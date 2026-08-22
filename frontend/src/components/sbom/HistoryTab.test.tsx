/**
 * Tests for HistoryTab — SBOM scan history list.
 *
 * Covers: rendering history list, empty state, loading state, timestamps,
 * image name display, status display, row click selection.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryTab } from './HistoryTab';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';
import { clearProviderQueryCache } from '../../hooks/useProviderQuery';
import type { SbomSummary, SbomResult } from '../../providers/types/sbom';

// Mock useTranslation so we don't depend on the store.
vi.mock('../../hooks/useI18n', () => ({
  useTranslation: () => ({
    locale: 'en',
    t: (_key: string, fallback: string) => fallback,
  }),
}));

// Mock provider functions.
const mockSbomListHistory = vi.fn();
const mockSbomGet = vi.fn();

vi.mock('../../providers', async () => {
  const { formatError } = await import('../../providers/errorHandler');
  return {
    getProvider: () => ({
      sbomListHistory: mockSbomListHistory,
      sbomGet: mockSbomGet,
    }),
    formatError,
  };
});

/** Factory for a mock SbomSummary (image source). */
function makeImageSummary(overrides: Partial<SbomSummary> = {}): SbomSummary {
  return {
    id: 'sbom-1',
    source: { kind: 'image', imageRef: 'nginx:1.25', namespace: 'default' },
    format: 'cyclonedx',
    componentCount: 42,
    vulnerabilityCount: 3,
    tool: 'syft',
    createdAt: '2024-06-15T10:30:00Z',
    ...overrides,
  };
}

/** Factory for a mock SbomSummary (cluster source). */
function makeClusterSummary(overrides: Partial<SbomSummary> = {}): SbomSummary {
  return {
    id: 'sbom-cluster-1',
    source: { kind: 'cluster', context: 'production' },
    format: 'spdx',
    componentCount: 120,
    vulnerabilityCount: 12,
    tool: 'syft',
    createdAt: '2024-06-16T14:00:00Z',
    ...overrides,
  };
}

/** Factory for a mock SbomResult (returned by sbomGet). */
function makeSbomResult(overrides: Partial<SbomResult> = {}): SbomResult {
  return {
    id: 'sbom-1',
    source: { kind: 'image', imageRef: 'nginx:1.25', namespace: 'default' },
    format: 'cyclonedx',
    specVersion: '1.5',
    metadata: { tool: 'syft', toolVersion: '0.100.0', scanDurationMs: 1200 },
    components: [],
    dependencies: [],
    vulnerabilities: [],
    createdAt: '2024-06-15T10:30:00Z',
    ...overrides,
  };
}

let view: RenderResult;

beforeEach(() => {
  // HistoryTab caches its list under a fixed key; without clearing it, a
  // later mount would reuse the previous test's cached data instead of the
  // fresh mock below.
  clearProviderQueryCache();
});

afterEach(() => {
  cleanup();
  mockSbomListHistory.mockReset();
  mockSbomGet.mockReset();
});

describe('HistoryTab', () => {
  describe('loading state', () => {
    it('shows loading indicator while fetching history', () => {
      mockSbomListHistory.mockReturnValue(new Promise(() => {})); // never resolves
      view = render(<HistoryTab onSelect={vi.fn()} />);
      expect(view.queryByText('Loading...')).not.toBeNull();
    });
  });

  describe('rendering history list', () => {
    it('renders a table with history items', async () => {
      mockSbomListHistory.mockResolvedValue([
        makeImageSummary(),
        makeImageSummary({
          id: 'sbom-2',
          source: { kind: 'image', imageRef: 'redis:7', namespace: 'default' },
        }),
      ]);
      view = render(<HistoryTab onSelect={vi.fn()} />);
      // Wait for the async load.
      await vi.waitFor(() => {
        expect(view.container.querySelector('table')).not.toBeNull();
      });
      const rows = view.container.querySelectorAll('tbody tr');
      expect(rows).toHaveLength(2);
    });

    it('renders column headers', async () => {
      mockSbomListHistory.mockResolvedValue([makeImageSummary()]);
      view = render(<HistoryTab onSelect={vi.fn()} />);
      await vi.waitFor(() => {
        expect(view.queryByText('Source')).not.toBeNull();
      });
      expect(view.queryByText('Format')).not.toBeNull();
      expect(view.queryByText('Components')).not.toBeNull();
      expect(view.queryByText('Vulns')).not.toBeNull();
      expect(view.queryByText('Tool')).not.toBeNull();
      expect(view.queryByText('Date')).not.toBeNull();
    });

    it('renders component and vulnerability counts', async () => {
      mockSbomListHistory.mockResolvedValue([
        makeImageSummary({
          componentCount: 42,
          vulnerabilityCount: 3,
        }),
      ]);
      view = render(<HistoryTab onSelect={vi.fn()} />);
      await vi.waitFor(() => {
        expect(view.queryByText('42')).not.toBeNull();
      });
      expect(view.queryByText('3')).not.toBeNull();
    });

    it('renders tool name', async () => {
      mockSbomListHistory.mockResolvedValue([makeImageSummary({ tool: 'syft' })]);
      view = render(<HistoryTab onSelect={vi.fn()} />);
      await vi.waitFor(() => {
        expect(view.queryByText('syft')).not.toBeNull();
      });
    });
  });

  describe('empty state', () => {
    it('shows empty message when history is empty', async () => {
      mockSbomListHistory.mockResolvedValue([]);
      view = render(<HistoryTab onSelect={vi.fn()} />);
      await vi.waitFor(() => {
        expect(view.queryByText('No SBOM history yet')).not.toBeNull();
      });
    });

    it('does not render table when history is empty', async () => {
      mockSbomListHistory.mockResolvedValue([]);
      view = render(<HistoryTab onSelect={vi.fn()} />);
      await vi.waitFor(() => {
        expect(view.queryByText('No SBOM history yet')).not.toBeNull();
      });
      expect(view.container.querySelector('table')).toBeNull();
    });
  });

  describe('image name display', () => {
    it('shows image ref for image source', async () => {
      mockSbomListHistory.mockResolvedValue([
        makeImageSummary({
          source: { kind: 'image', imageRef: 'nginx:1.25', namespace: 'default' },
        }),
      ]);
      view = render(<HistoryTab onSelect={vi.fn()} />);
      await vi.waitFor(() => {
        expect(view.queryByText('nginx:1.25')).not.toBeNull();
      });
    });

    it('shows cluster context for cluster source', async () => {
      mockSbomListHistory.mockResolvedValue([makeClusterSummary()]);
      view = render(<HistoryTab onSelect={vi.fn()} />);
      await vi.waitFor(() => {
        expect(view.queryByText('Cluster: production')).not.toBeNull();
      });
    });
  });

  describe('timestamp display', () => {
    it('displays a formatted date from createdAt', async () => {
      mockSbomListHistory.mockResolvedValue([
        makeImageSummary({ createdAt: '2024-06-15T10:30:00Z' }),
      ]);
      view = render(<HistoryTab onSelect={vi.fn()} />);
      await vi.waitFor(() => {
        // toLocaleString() should produce a string containing the year.
        const row = view.container.querySelector('tbody tr');
        expect(row).not.toBeNull();
        // The date cell should contain "2024" somewhere.
        expect(row!.textContent).toContain('2024');
      });
    });
  });

  describe('format display', () => {
    it('shows format in uppercase', async () => {
      mockSbomListHistory.mockResolvedValue([makeImageSummary({ format: 'cyclonedx' })]);
      view = render(<HistoryTab onSelect={vi.fn()} />);
      await vi.waitFor(() => {
        expect(view.queryByText('CYCLONEDX')).not.toBeNull();
      });
    });

    it('shows SPDX format in uppercase', async () => {
      mockSbomListHistory.mockResolvedValue([makeImageSummary({ format: 'spdx' })]);
      view = render(<HistoryTab onSelect={vi.fn()} />);
      await vi.waitFor(() => {
        expect(view.queryByText('SPDX')).not.toBeNull();
      });
    });
  });

  describe('row click selection', () => {
    it('calls onSelect with the SBOM result when a row is clicked', async () => {
      const onSelect = vi.fn();
      const sbomResult = makeSbomResult({ id: 'sbom-1' });
      mockSbomListHistory.mockResolvedValue([makeImageSummary({ id: 'sbom-1' })]);
      mockSbomGet.mockResolvedValue(sbomResult);

      view = render(<HistoryTab onSelect={onSelect} />);
      await vi.waitFor(() => {
        expect(view.container.querySelector('tbody tr')).not.toBeNull();
      });

      const row = view.container.querySelector('tbody tr')! as HTMLElement;
      view.click(row);

      await vi.waitFor(() => {
        expect(mockSbomGet).toHaveBeenCalledWith('sbom-1');
        expect(onSelect).toHaveBeenCalledWith(sbomResult);
      });
    });
  });

  describe('error handling', () => {
    it('shows error message when history fetch fails', async () => {
      mockSbomListHistory.mockRejectedValue(new Error('network error'));
      view = render(<HistoryTab onSelect={vi.fn()} />);
      await vi.waitFor(() => {
        expect(view.queryByText(/network error/)).not.toBeNull();
      });
    });

    it('shows error message when SBOM detail fetch fails', async () => {
      const onSelect = vi.fn();
      mockSbomListHistory.mockResolvedValue([makeImageSummary({ id: 'sbom-1' })]);
      mockSbomGet.mockRejectedValue(new Error('not found'));

      view = render(<HistoryTab onSelect={onSelect} />);
      await vi.waitFor(() => {
        expect(view.container.querySelector('tbody tr')).not.toBeNull();
      });

      view.click(view.container.querySelector('tbody tr')! as HTMLElement);

      await vi.waitFor(() => {
        // The mock t() returns the fallback arg (the error string).
        expect(view.queryByText(/not found/)).not.toBeNull();
      });
    });
  });
});
