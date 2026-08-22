/**
 * Tests for PropertiesTab — the properties detail tab.
 *
 * Covers: loading state, error state, field grid rendering, table rendering,
 * chip rendering, nav links, section headers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { useStore } from '../../store';
import { PropertiesTab } from './PropertiesTab';
import { render, cleanup, createMockPodRow, type RenderResult } from '../../test/componentUtils';
import type { Properties } from '../../providers/types';

// Mock the provider module.
const mockGetProperties = vi.fn();
const mockGetSecretData = vi.fn();
vi.mock('../../providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers')>();
  return {
    ...actual,
    getProvider: () => ({
      getProperties: mockGetProperties,
      getSecretData: mockGetSecretData,
    }),
  };
});

let view: RenderResult;

function resetStore() {
  useStore.setState({
    nav: 'pods',
    selectedRow: null,
  });
}

const MOCK_PROPS: Properties = {
  sections: [
    {
      title: 'Overview',
      body: {
        type: 'fields',
        fields: [
          { label: 'Node', value: { text: 'node-1', tone: 'primary' } },
          { label: 'Status', value: { text: 'Running', tone: 'ok' } },
          { label: 'IP', value: { text: '10.0.0.5', tone: 'secondary' } },
        ],
      },
    },
    {
      title: 'Containers',
      emptyNote: 'No containers',
      body: {
        type: 'table',
        columns: ['Name', 'Image', 'Status'],
        rows: [
          [
            { text: 'app', tone: 'primary' },
            { text: 'nginx:latest', tone: 'secondary' },
            { text: 'Running', tone: 'ok' },
          ],
        ],
      },
    },
    {
      title: 'Labels',
      emptyNote: 'No labels',
      body: {
        type: 'chips',
        chips: [
          { key: 'app', value: 'nginx' },
          { key: 'env', value: 'prod' },
        ],
      },
    },
  ],
};

beforeEach(() => {
  resetStore();
  mockGetProperties.mockReset();
  mockGetSecretData.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('PropertiesTab', () => {
  describe('loading state', () => {
    it('shows loading text while fetching properties', () => {
      mockGetProperties.mockReturnValue(new Promise(() => {})); // never resolves
      const pod = createMockPodRow({ uid: 'pod-1', name: 'nginx' });
      useStore.setState({ nav: 'pods', selectedRow: pod });
      view = render(<PropertiesTab />);
      expect(view.container.textContent).toContain('loading properties');
    });
  });

  describe('error state', () => {
    it('shows error message when fetch fails', async () => {
      mockGetProperties.mockRejectedValue(new Error('fetch failed'));
      const pod = createMockPodRow({ uid: 'pod-1', name: 'nginx' });
      useStore.setState({ nav: 'pods', selectedRow: pod });
      view = render(<PropertiesTab />);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      expect(view.queryByText('fetch failed')).not.toBeNull();
    });
  });

  describe('field grid', () => {
    it('renders field labels and values', async () => {
      mockGetProperties.mockResolvedValue(MOCK_PROPS);
      const pod = createMockPodRow({ uid: 'pod-1', name: 'nginx' });
      useStore.setState({ nav: 'pods', selectedRow: pod });
      view = render(<PropertiesTab />);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      expect(view.queryByText('Node')).not.toBeNull();
      expect(view.queryByText('node-1')).not.toBeNull();
      expect(view.queryByText('Status')).not.toBeNull();
      expect(view.queryByText('Running')).not.toBeNull();
    });
  });

  describe('table rendering', () => {
    it('renders table headers', async () => {
      mockGetProperties.mockResolvedValue(MOCK_PROPS);
      const pod = createMockPodRow({ uid: 'pod-1', name: 'nginx' });
      useStore.setState({ nav: 'pods', selectedRow: pod });
      view = render(<PropertiesTab />);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      expect(view.queryByText('Name')).not.toBeNull();
      expect(view.queryByText('Image')).not.toBeNull();
      expect(view.queryByText('Status')).not.toBeNull();
    });

    it('renders table rows', async () => {
      mockGetProperties.mockResolvedValue(MOCK_PROPS);
      const pod = createMockPodRow({ uid: 'pod-1', name: 'nginx' });
      useStore.setState({ nav: 'pods', selectedRow: pod });
      view = render(<PropertiesTab />);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      expect(view.queryByText('app')).not.toBeNull();
      expect(view.queryByText('nginx:latest')).not.toBeNull();
    });

    it('shows row count in section header', async () => {
      mockGetProperties.mockResolvedValue(MOCK_PROPS);
      const pod = createMockPodRow({ uid: 'pod-1', name: 'nginx' });
      useStore.setState({ nav: 'pods', selectedRow: pod });
      view = render(<PropertiesTab />);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      // Section header should include "(1)" for the Containers table
      expect(view.queryByText(/Containers.*\(1\)/)).not.toBeNull();
    });
  });

  describe('chip rendering', () => {
    it('renders chip key-value pairs', async () => {
      mockGetProperties.mockResolvedValue(MOCK_PROPS);
      const pod = createMockPodRow({ uid: 'pod-1', name: 'nginx' });
      useStore.setState({ nav: 'pods', selectedRow: pod });
      view = render(<PropertiesTab />);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      expect(view.queryByText('app')).not.toBeNull();
      expect(view.queryByText('nginx')).not.toBeNull();
      expect(view.queryByText('env')).not.toBeNull();
      expect(view.queryByText('prod')).not.toBeNull();
    });
  });

  describe('section headers', () => {
    it('renders section titles', async () => {
      mockGetProperties.mockResolvedValue(MOCK_PROPS);
      const pod = createMockPodRow({ uid: 'pod-1', name: 'nginx' });
      useStore.setState({ nav: 'pods', selectedRow: pod });
      view = render(<PropertiesTab />);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      expect(view.queryByText('Overview')).not.toBeNull();
      expect(view.queryByText(/Containers/)).not.toBeNull();
      expect(view.queryByText('Labels')).not.toBeNull();
    });
  });

  describe('empty table', () => {
    it('shows empty note when table has no rows', async () => {
      const emptyProps: Properties = {
        sections: [
          {
            title: 'Taints',
            emptyNote: 'No taints',
            body: { type: 'table', columns: ['Key', 'Value'], rows: [] },
          },
        ],
      };
      mockGetProperties.mockResolvedValue(emptyProps);
      const pod = createMockPodRow({ uid: 'pod-1', name: 'nginx' });
      useStore.setState({ nav: 'pods', selectedRow: pod });
      view = render(<PropertiesTab />);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      expect(view.queryByText('No taints')).not.toBeNull();
    });
  });
});
