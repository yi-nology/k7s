/**
 * Tests for ImageSBOMTab — image SBOM generation and display.
 *
 * Covers: rendering image selector, format selector, generating SBOM,
 * displaying component list, displaying vulnerability list, empty state,
 * error handling.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageSBOMTab } from './ImageSBOMTab';
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
const mockSbomGenerateImage = vi.fn();

vi.mock('../../providers', async () => {
  const { formatError } = await import('../../providers/errorHandler');
  return {
    getProvider: () => ({
      sbomGenerateImage: mockSbomGenerateImage,
    }),
    formatError,
  };
});

// Mock child table components to isolate ImageSBOMTab tests.
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

/** Factory for a mock SbomResult. */
function makeSbomResult(overrides: Partial<SbomResult> = {}): SbomResult {
  return {
    id: 'sbom-img-1',
    source: { kind: 'image', imageRef: 'nginx:1.25', namespace: 'default' },
    format: 'cyclonedx',
    specVersion: '1.5',
    metadata: { tool: 'syft', toolVersion: '0.100.0', scanDurationMs: 1200 },
    components: [
      {
        name: 'react',
        version: '18.2.0',
        componentType: 'library',
        licenses: ['MIT'],
        hashes: [],
      },
      {
        name: 'lodash',
        version: '4.17.21',
        componentType: 'library',
        licenses: ['MIT'],
        hashes: [],
      },
    ],
    dependencies: [],
    vulnerabilities: [
      {
        id: 'CVE-2024-0001',
        severity: 'critical',
        affectedComponents: ['lodash'],
        description: 'Prototype pollution',
        fixedVersion: '4.17.22',
      },
    ],
    createdAt: '2024-06-15T10:30:00Z',
    ...overrides,
  };
}

let view: RenderResult;

afterEach(() => {
  cleanup();
  mockSbomGenerateImage.mockReset();
});

describe('ImageSBOMTab', () => {
  describe('rendering image selector', () => {
    it('renders an input field for image reference', () => {
      view = render(<ImageSBOMTab onResult={vi.fn()} />);
      const input = view.container.querySelector('input[type="text"]');
      expect(input).not.toBeNull();
    });

    it('renders a placeholder in the input field', () => {
      view = render(<ImageSBOMTab onResult={vi.fn()} />);
      const input = view.container.querySelector('input[type="text"]') as HTMLInputElement;
      expect(input.placeholder).toContain('image ref');
    });

    it('renders a generate button', () => {
      view = render(<ImageSBOMTab onResult={vi.fn()} />);
      expect(view.queryByText('Generate')).not.toBeNull();
    });
  });

  describe('format selector', () => {
    it('renders a format dropdown', () => {
      view = render(<ImageSBOMTab onResult={vi.fn()} />);
      const select = view.container.querySelector('select');
      expect(select).not.toBeNull();
    });

    it('defaults to CycloneDX format', () => {
      view = render(<ImageSBOMTab onResult={vi.fn()} />);
      const select = view.container.querySelector('select') as HTMLSelectElement;
      expect(select.value).toBe('cyclonedx');
    });

    it('offers CycloneDX and SPDX options', () => {
      view = render(<ImageSBOMTab onResult={vi.fn()} />);
      expect(view.queryByText('CycloneDX')).not.toBeNull();
      expect(view.queryByText('SPDX')).not.toBeNull();
    });
  });

  describe('loading SBOM for selected image', () => {
    it('calls sbomGenerateImage with image ref and format on button click', async () => {
      const result = makeSbomResult();
      mockSbomGenerateImage.mockResolvedValue(result);

      view = render(<ImageSBOMTab onResult={vi.fn()} />);
      const input = view.container.querySelector('input[type="text"]')! as HTMLElement;
      view.change(input, 'nginx:1.25');

      const button = view.queryByText('Generate')!;
      view.click(button);

      await vi.waitFor(() => {
        expect(mockSbomGenerateImage).toHaveBeenCalledWith('nginx:1.25', 'cyclonedx');
      });
    });

    it('calls sbomGenerateImage on Enter key in input', async () => {
      const result = makeSbomResult();
      mockSbomGenerateImage.mockResolvedValue(result);

      view = render(<ImageSBOMTab onResult={vi.fn()} />);
      const input = view.container.querySelector('input[type="text"]')! as HTMLElement;
      view.change(input, 'redis:7');
      view.keyDown(input, 'Enter');

      await vi.waitFor(() => {
        expect(mockSbomGenerateImage).toHaveBeenCalledWith('redis:7', 'cyclonedx');
      });
    });

    it('does not call sbomGenerateImage when input is empty', () => {
      view = render(<ImageSBOMTab onResult={vi.fn()} />);
      const button = view.queryByText('Generate')!;
      view.click(button);

      expect(mockSbomGenerateImage).not.toHaveBeenCalled();
    });

    it('calls onResult callback with the SBOM result', async () => {
      const onResult = vi.fn();
      const result = makeSbomResult();
      mockSbomGenerateImage.mockResolvedValue(result);

      view = render(<ImageSBOMTab onResult={onResult} />);
      const input = view.container.querySelector('input[type="text"]')! as HTMLElement;
      view.change(input, 'nginx:1.25');
      view.click(view.queryByText('Generate')! as HTMLElement);

      await vi.waitFor(() => {
        expect(onResult).toHaveBeenCalledWith(result);
      });
    });
  });

  describe('displaying component list', () => {
    it('shows component count after generation', async () => {
      const result = makeSbomResult({
        components: [
          {
            name: 'react',
            version: '18.2.0',
            componentType: 'library',
            licenses: ['MIT'],
            hashes: [],
          },
          {
            name: 'lodash',
            version: '4.17.21',
            componentType: 'library',
            licenses: ['MIT'],
            hashes: [],
          },
        ],
      });
      mockSbomGenerateImage.mockResolvedValue(result);

      view = render(<ImageSBOMTab onResult={vi.fn()} />);
      const input = view.container.querySelector('input[type="text"]')! as HTMLElement;
      view.change(input, 'nginx:1.25');
      view.click(view.queryByText('Generate')! as HTMLElement);

      await vi.waitFor(() => {
        expect(view.queryByText(/Components.*2/)).not.toBeNull();
      });
    });

    it('renders the ComponentTable after generation', async () => {
      const result = makeSbomResult();
      mockSbomGenerateImage.mockResolvedValue(result);

      view = render(<ImageSBOMTab onResult={vi.fn()} />);
      const input = view.container.querySelector('input[type="text"]')! as HTMLElement;
      view.change(input, 'nginx:1.25');
      view.click(view.queryByText('Generate')! as HTMLElement);

      await vi.waitFor(() => {
        expect(view.queryByTestId('component-table')).not.toBeNull();
      });
    });
  });

  describe('displaying vulnerability list', () => {
    it('shows vulnerability count after generation', async () => {
      const result = makeSbomResult({
        vulnerabilities: [
          { id: 'CVE-2024-0001', severity: 'critical', affectedComponents: ['lodash'] },
        ],
      });
      mockSbomGenerateImage.mockResolvedValue(result);

      view = render(<ImageSBOMTab onResult={vi.fn()} />);
      const input = view.container.querySelector('input[type="text"]')! as HTMLElement;
      view.change(input, 'nginx:1.25');
      view.click(view.queryByText('Generate')! as HTMLElement);

      await vi.waitFor(() => {
        expect(view.queryByText(/Vulnerabilities.*1/)).not.toBeNull();
      });
    });

    it('renders the VulnTable when vulnerabilities exist', async () => {
      const result = makeSbomResult({
        vulnerabilities: [
          { id: 'CVE-2024-0001', severity: 'critical', affectedComponents: ['lodash'] },
        ],
      });
      mockSbomGenerateImage.mockResolvedValue(result);

      view = render(<ImageSBOMTab onResult={vi.fn()} />);
      const input = view.container.querySelector('input[type="text"]')! as HTMLElement;
      view.change(input, 'nginx:1.25');
      view.click(view.queryByText('Generate')! as HTMLElement);

      await vi.waitFor(() => {
        expect(view.queryByTestId('vuln-table')).not.toBeNull();
      });
    });

    it('does not render VulnTable when there are no vulnerabilities', async () => {
      const result = makeSbomResult({ vulnerabilities: [] });
      mockSbomGenerateImage.mockResolvedValue(result);

      view = render(<ImageSBOMTab onResult={vi.fn()} />);
      const input = view.container.querySelector('input[type="text"]')! as HTMLElement;
      view.change(input, 'nginx:1.25');
      view.click(view.queryByText('Generate')! as HTMLElement);

      await vi.waitFor(() => {
        expect(view.queryByTestId('component-table')).not.toBeNull();
      });
      expect(view.queryByTestId('vuln-table')).toBeNull();
    });
  });

  describe('empty state', () => {
    it('does not show component or vuln tables before generation', () => {
      view = render(<ImageSBOMTab onResult={vi.fn()} />);
      expect(view.queryByTestId('component-table')).toBeNull();
      expect(view.queryByTestId('vuln-table')).toBeNull();
    });

    it('does not show metadata info before generation', () => {
      view = render(<ImageSBOMTab onResult={vi.fn()} />);
      expect(view.queryByText(/Tool/)).toBeNull();
      expect(view.queryByText(/Duration/)).toBeNull();
    });
  });

  describe('error handling', () => {
    it('shows error message when generation fails', async () => {
      mockSbomGenerateImage.mockRejectedValue(new Error('image not found'));

      view = render(<ImageSBOMTab onResult={vi.fn()} />);
      const input = view.container.querySelector('input[type="text"]')! as HTMLElement;
      view.change(input, 'bad-image:latest');
      view.click(view.queryByText('Generate')! as HTMLElement);

      await vi.waitFor(() => {
        expect(view.queryByText(/image not found/)).not.toBeNull();
      });
    });
  });
});
