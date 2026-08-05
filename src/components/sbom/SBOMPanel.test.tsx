/**
 * Tests for SBOMPanel — main SBOM panel component.
 *
 * Covers: rendering, tab switching, close button, export, error/success states.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SBOMPanel } from './SBOMPanel';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';

// Mock the provider.
const mockSbomExport = vi.fn();
vi.mock('../../providers', () => ({
  getProvider: () => ({
    sbomExport: mockSbomExport,
    sbomGenerateImage: vi.fn().mockResolvedValue({
      id: 'test-sbom',
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
      ],
      dependencies: [],
      vulnerabilities: [],
      createdAt: '2024-01-01T00:00:00Z',
    }),
    sbomListHistory: vi.fn().mockResolvedValue([]),
    sbomGet: vi.fn().mockResolvedValue({
      id: 'test-sbom',
      source: { kind: 'image', imageRef: 'nginx:1.25', namespace: 'default' },
      format: 'cyclonedx',
      specVersion: '1.5',
      metadata: { tool: 'syft', toolVersion: '0.100.0', scanDurationMs: 1200 },
      components: [],
      dependencies: [],
      vulnerabilities: [],
      createdAt: '2024-01-01T00:00:00Z',
    }),
  }),
}));

// Mock child components to isolate SBOMPanel tests.
vi.mock('./ImageSBOMTab', () => ({
  ImageSBOMTab: ({ onResult }: { onResult: (r: unknown) => void }) => {
    return (
      <div data-testid="image-sbom-tab">
        <span>ImageSBOMTab</span>
        <button onClick={() => onResult({ id: 'mock-id' })}>Trigger Result</button>
      </div>
    );
  },
}));

vi.mock('./HistoryTab', () => ({
  HistoryTab: ({ onSelect }: { onSelect: (s: unknown) => void }) => {
    return (
      <div data-testid="history-tab">
        <span>HistoryTab</span>
        <button onClick={() => onSelect({ id: 'history-id' })}>Select History</button>
      </div>
    );
  },
}));

let view: RenderResult;

afterEach(() => {
  cleanup();
  mockSbomExport.mockReset();
});

describe('SBOMPanel', () => {
  describe('rendering', () => {
    it('renders the panel container', () => {
      view = render(<SBOMPanel />);
      expect(view.container.firstChild).not.toBeNull();
    });

    it('renders the title', () => {
      view = render(<SBOMPanel />);
      expect(view.queryByText('SBOM')).not.toBeNull();
    });

    it('renders tab buttons', () => {
      view = render(<SBOMPanel />);
      expect(view.queryByText('Image')).not.toBeNull();
      expect(view.queryByText('History')).not.toBeNull();
    });

    it('renders the export button', () => {
      view = render(<SBOMPanel />);
      // The export button has title="Export"
      const exportBtn = view.container.querySelector('button[title="Export"]');
      expect(exportBtn).not.toBeNull();
    });
  });

  describe('close button', () => {
    it('does not render close button when onClose is not provided', () => {
      view = render(<SBOMPanel />);
      // When no onClose is provided, only the export button (title="Export")
      // and tab buttons should exist; the actions area has exactly 1 button.
      const actionsDiv = view.container.querySelector('header > div:last-child');
      expect(actionsDiv).not.toBeNull();
      const actionButtons = actionsDiv!.querySelectorAll('button');
      expect(actionButtons).toHaveLength(1);
      expect(actionButtons[0].getAttribute('title')).toBe('Export');
    });

    it('renders close button when onClose is provided', () => {
      const onClose = vi.fn();
      view = render(<SBOMPanel onClose={onClose} />);
      // With onClose, the actions area should have 2 buttons: export + close.
      const actionsDiv = view.container.querySelector('header > div:last-child');
      expect(actionsDiv).not.toBeNull();
      const actionButtons = actionsDiv!.querySelectorAll('button');
      expect(actionButtons).toHaveLength(2);
    });

    it('calls onClose when close button is clicked', () => {
      const onClose = vi.fn();
      view = render(<SBOMPanel onClose={onClose} />);
      // The close button is the last button in the actions area (after export).
      const actionsDiv = view.container.querySelector('header > div:last-child');
      const actionButtons = actionsDiv!.querySelectorAll('button');
      const closeBtn = actionButtons[actionButtons.length - 1];
      view.click(closeBtn);
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  describe('tab switching', () => {
    it('shows ImageSBOMTab by default', () => {
      view = render(<SBOMPanel />);
      expect(view.queryByTestId('image-sbom-tab')).not.toBeNull();
    });

    it('switches to Cluster tab when clicked', () => {
      view = render(<SBOMPanel />);
      const clusterBtn = view.queryByText(/Cluster/);
      expect(clusterBtn).not.toBeNull();
      view.click(clusterBtn!);
      expect(view.queryByText('Cluster-wide SBOM scanning is coming soon.')).not.toBeNull();
    });

    it('switches to History tab when clicked', () => {
      view = render(<SBOMPanel />);
      const historyBtn = view.queryByText('History');
      expect(historyBtn).not.toBeNull();
      view.click(historyBtn!);
      expect(view.queryByTestId('history-tab')).not.toBeNull();
    });

    it('switches back to Image tab from another tab', () => {
      view = render(<SBOMPanel />);
      // Switch to History
      view.click(view.queryByText('History')!);
      expect(view.queryByTestId('history-tab')).not.toBeNull();
      // Switch back to Image
      view.click(view.queryByText('Image')!);
      expect(view.queryByTestId('image-sbom-tab')).not.toBeNull();
    });
  });

  describe('export', () => {
    it('does nothing when export is clicked with no SBOM data', () => {
      view = render(<SBOMPanel />);
      const exportBtn = view.container.querySelector('button[title="Export"]')!;
      view.click(exportBtn);
      // No error or success message should appear
      expect(view.queryByText(/Exported/)).toBeNull();
      expect(view.queryByText(/Export failed/)).toBeNull();
    });

    it('shows success message after successful export', async () => {
      mockSbomExport.mockResolvedValue('/tmp/sbom-test-sbom.json');
      view = render(<SBOMPanel />);

      // First, trigger an SBOM result via the mocked ImageSBOMTab
      const triggerBtn = view.queryByText('Trigger Result');
      expect(triggerBtn).not.toBeNull();
      view.click(triggerBtn!);

      // Now click export
      const exportBtn = view.container.querySelector('button[title="Export"]')!;
      view.click(exportBtn);

      // Wait for async
      await new Promise((r) => setTimeout(r, 50));
      expect(view.queryByText(/Exported to/)).not.toBeNull();
    });

    it('shows error message when export fails', async () => {
      mockSbomExport.mockRejectedValue(new Error('disk full'));
      view = render(<SBOMPanel />);

      // Trigger SBOM result
      const triggerBtn = view.queryByText('Trigger Result');
      view.click(triggerBtn!);

      // Click export
      const exportBtn = view.container.querySelector('button[title="Export"]')!;
      view.click(exportBtn);

      await new Promise((r) => setTimeout(r, 50));
      expect(view.queryByText(/Export failed/)).not.toBeNull();
    });
  });

  describe('status display', () => {
    it('does not show error message by default', () => {
      view = render(<SBOMPanel />);
      expect(view.queryByText(/Export failed/)).toBeNull();
    });

    it('does not show success message by default', () => {
      view = render(<SBOMPanel />);
      expect(view.queryByText(/Exported to/)).toBeNull();
    });

    it('clears previous messages on new export attempt', async () => {
      // First export fails
      mockSbomExport.mockRejectedValueOnce(new Error('fail'));
      view = render(<SBOMPanel />);

      // Trigger SBOM result
      view.click(view.queryByText('Trigger Result')!);

      // Click export (fails)
      view.click(view.container.querySelector('button[title="Export"]')!);
      await new Promise((r) => setTimeout(r, 50));
      expect(view.queryByText(/Export failed/)).not.toBeNull();

      // Second export succeeds
      mockSbomExport.mockResolvedValueOnce('/tmp/out.json');
      view.click(view.container.querySelector('button[title="Export"]')!);
      await new Promise((r) => setTimeout(r, 50));
      expect(view.queryByText(/Exported to/)).not.toBeNull();
      // Old error should be cleared
      expect(view.queryByText(/Export failed/)).toBeNull();
    });
  });
});
