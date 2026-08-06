/**
 * Tests for ClusterSBOMTab — cluster-wide SBOM generation and display.
 *
 * Covers: rendering scan button, format selector, generating SBOM,
 * displaying component list, displaying vulnerability list, empty state,
 * error handling.
 *
 * Note: SBOMPanel currently shows a "coming soon" placeholder instead of
 * this component for the Cluster tab. These tests verify ClusterSBOMTab
 * is functional and ready for integration.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClusterSBOMTab } from './ClusterSBOMTab';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';
import type { SbomResult, SbomComponent, SbomVulnerability } from '../../providers/types/sbom';

// Mock useTranslation so we don't depend on the store.
vi.mock('../../hooks/useI18n', () => ({
  useTranslation: () => ({
    locale: 'en',
    t: (_key: string, fallback: string) => fallback,
  }),
}));

// Mock provider functions.
const mockSbomGenerateCluster = vi.fn();

vi.mock('../../providers', async () => {
  const { formatError } = await import('../../providers/errorHandler');
  return {
    getProvider: () => ({
      sbomGenerateCluster: mockSbomGenerateCluster,
    }),
    formatError,
  };
});

// Mock child table components to isolate ClusterSBOMTab tests.
vi.mock('./ComponentTable', () => ({
  ComponentTable: ({ components }: { components: SbomComponent[] }) => (
    <div data-testid="component-table">
      <span>Components: {components.length}</span>
    </div>
  ),
}));

vi.mock('./VulnTable', () => ({
  VulnTable: ({ vulns }: { vulns: SbomVulnerability[] }) => (
    <div data-testid="vuln-table">
      <span>Vulns: {vulns.length}</span>
    </div>
  ),
}));

/** Factory for a mock SbomResult (cluster source). */
function makeClusterSbomResult(overrides: Partial<SbomResult> = {}): SbomResult {
  return {
    id: 'sbom-cluster-1',
    source: { kind: 'cluster', context: 'production' },
    format: 'cyclonedx',
    specVersion: '1.5',
    metadata: { tool: 'syft', toolVersion: '0.100.0', scanDurationMs: 5000 },
    components: [
      {
        name: 'nginx',
        version: '1.25.0',
        componentType: 'application',
        licenses: ['Apache-2.0'],
        hashes: [],
      },
      {
        name: 'openssl',
        version: '3.0.0',
        componentType: 'library',
        licenses: ['Apache-2.0'],
        hashes: [],
      },
    ],
    dependencies: [],
    vulnerabilities: [
      {
        id: 'CVE-2024-1000',
        severity: 'high',
        affectedComponents: ['openssl'],
        description: 'Buffer overflow',
        fixedVersion: '3.0.1',
      },
    ],
    createdAt: '2024-06-15T10:30:00Z',
    ...overrides,
  };
}

let view: RenderResult;

afterEach(() => {
  cleanup();
  mockSbomGenerateCluster.mockReset();
});

describe('ClusterSBOMTab', () => {
  describe('rendering scan button', () => {
    it('renders the Scan Cluster button', () => {
      view = render(<ClusterSBOMTab onResult={vi.fn()} />);
      expect(view.queryByText('Scan Cluster')).not.toBeNull();
    });

    it('renders the button as a clickable element', () => {
      view = render(<ClusterSBOMTab onResult={vi.fn()} />);
      const button = view.queryByText('Scan Cluster');
      expect(button).not.toBeNull();
      expect(button!.tagName).toBe('BUTTON');
    });
  });

  describe('format selector', () => {
    it('renders a format dropdown', () => {
      view = render(<ClusterSBOMTab onResult={vi.fn()} />);
      const select = view.container.querySelector('select');
      expect(select).not.toBeNull();
    });

    it('defaults to CycloneDX format', () => {
      view = render(<ClusterSBOMTab onResult={vi.fn()} />);
      const select = view.container.querySelector('select') as HTMLSelectElement;
      expect(select.value).toBe('cyclonedx');
    });

    it('offers CycloneDX and SPDX options', () => {
      view = render(<ClusterSBOMTab onResult={vi.fn()} />);
      expect(view.queryByText('CycloneDX')).not.toBeNull();
      expect(view.queryByText('SPDX')).not.toBeNull();
    });
  });

  describe('generating cluster SBOM', () => {
    it('calls sbomGenerateCluster with selected format on button click', async () => {
      const result = makeClusterSbomResult();
      mockSbomGenerateCluster.mockResolvedValue(result);

      view = render(<ClusterSBOMTab onResult={vi.fn()} />);
      view.click(view.queryByText('Scan Cluster')!);

      await vi.waitFor(() => {
        expect(mockSbomGenerateCluster).toHaveBeenCalledWith('cyclonedx');
      });
    });

    it('calls onResult callback with the SBOM result', async () => {
      const onResult = vi.fn();
      const result = makeClusterSbomResult();
      mockSbomGenerateCluster.mockResolvedValue(result);

      view = render(<ClusterSBOMTab onResult={onResult} />);
      view.click(view.queryByText('Scan Cluster')!);

      await vi.waitFor(() => {
        expect(onResult).toHaveBeenCalledWith(result);
      });
    });

    it('passes selected format when changed to SPDX', async () => {
      const result = makeClusterSbomResult({ format: 'spdx' });
      mockSbomGenerateCluster.mockResolvedValue(result);

      view = render(<ClusterSBOMTab onResult={vi.fn()} />);
      const select = view.container.querySelector('select') as HTMLSelectElement;
      // Directly set value on <select> and dispatch change event.
      select.value = 'spdx';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      view.click(view.queryByText('Scan Cluster')!);

      await vi.waitFor(() => {
        expect(mockSbomGenerateCluster).toHaveBeenCalledWith('spdx');
      });
    });
  });

  describe('displaying component list', () => {
    it('shows component count after generation', async () => {
      const result = makeClusterSbomResult();
      mockSbomGenerateCluster.mockResolvedValue(result);

      view = render(<ClusterSBOMTab onResult={vi.fn()} />);
      view.click(view.queryByText('Scan Cluster')!);

      await vi.waitFor(() => {
        expect(view.queryByText(/Components.*2/)).not.toBeNull();
      });
    });

    it('renders the ComponentTable after generation', async () => {
      const result = makeClusterSbomResult();
      mockSbomGenerateCluster.mockResolvedValue(result);

      view = render(<ClusterSBOMTab onResult={vi.fn()} />);
      view.click(view.queryByText('Scan Cluster')!);

      await vi.waitFor(() => {
        expect(view.queryByTestId('component-table')).not.toBeNull();
      });
    });
  });

  describe('displaying vulnerability list', () => {
    it('shows vulnerability count after generation', async () => {
      const result = makeClusterSbomResult();
      mockSbomGenerateCluster.mockResolvedValue(result);

      view = render(<ClusterSBOMTab onResult={vi.fn()} />);
      view.click(view.queryByText('Scan Cluster')!);

      await vi.waitFor(() => {
        expect(view.queryByText(/Vulnerabilities.*1/)).not.toBeNull();
      });
    });

    it('renders the VulnTable when vulnerabilities exist', async () => {
      const result = makeClusterSbomResult();
      mockSbomGenerateCluster.mockResolvedValue(result);

      view = render(<ClusterSBOMTab onResult={vi.fn()} />);
      view.click(view.queryByText('Scan Cluster')!);

      await vi.waitFor(() => {
        expect(view.queryByTestId('vuln-table')).not.toBeNull();
      });
    });

    it('does not render VulnTable when there are no vulnerabilities', async () => {
      const result = makeClusterSbomResult({ vulnerabilities: [] });
      mockSbomGenerateCluster.mockResolvedValue(result);

      view = render(<ClusterSBOMTab onResult={vi.fn()} />);
      view.click(view.queryByText('Scan Cluster')!);

      await vi.waitFor(() => {
        expect(view.queryByTestId('component-table')).not.toBeNull();
      });
      expect(view.queryByTestId('vuln-table')).toBeNull();
    });
  });

  describe('empty state', () => {
    it('does not show component or vuln tables before generation', () => {
      view = render(<ClusterSBOMTab onResult={vi.fn()} />);
      expect(view.queryByTestId('component-table')).toBeNull();
      expect(view.queryByTestId('vuln-table')).toBeNull();
    });

    it('does not show metadata info before generation', () => {
      view = render(<ClusterSBOMTab onResult={vi.fn()} />);
      expect(view.queryByText(/Components/)).toBeNull();
      expect(view.queryByText(/Vulnerabilities/)).toBeNull();
    });
  });

  describe('error handling', () => {
    it('shows error message when cluster scan fails', async () => {
      mockSbomGenerateCluster.mockRejectedValue(new Error('cluster unreachable'));

      view = render(<ClusterSBOMTab onResult={vi.fn()} />);
      view.click(view.queryByText('Scan Cluster')!);

      await vi.waitFor(() => {
        expect(view.queryByText(/cluster unreachable/)).not.toBeNull();
      });
    });
  });
});
