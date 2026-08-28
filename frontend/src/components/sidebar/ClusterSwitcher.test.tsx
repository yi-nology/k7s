/**
 * Tests for ClusterSwitcher — cluster/context switcher in sidebar.
 *
 * Covers: rendering, initials badge, status display, dropdown toggle,
 * context list, active context highlighting.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { useStore, type OpenMenu } from '../../store';
import { ClusterSwitcher } from './ClusterSwitcher';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';
import type { ContextInfo } from '../../providers/types';
import { KubeconfigImportError } from '../../providers/transport';
import { setErrorReporter, setSuccessReporter } from '../../providers/errorHandler';

// Mock connectTo.
vi.mock('../../lib/connect', () => ({
  connectTo: vi.fn().mockResolvedValue(undefined),
}));

// Mock useClickOutside.
vi.mock('../../hooks/useClickOutside', () => ({
  useClickOutside: vi.fn(),
}));

// Mock importKubeconfigViaInput — hoisted so tests can script outcomes.
const importViaInput = vi.hoisted(() => vi.fn());
vi.mock('../../providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers')>();
  return {
    ...actual,
    importKubeconfigViaInput: importViaInput,
  };
});

let view: RenderResult;

function resetStore() {
  useStore.setState({
    connection: { phase: 'idle', context: null, clusterName: null },
    clusterStatus: null,
    contexts: [],
    openMenu: null,
    toggleMenu: (menu: Exclude<OpenMenu, null>) => useStore.setState({ openMenu: menu }),
    closeMenus: () => useStore.setState({ openMenu: null }),
    setContexts: (ctx: ContextInfo[]) => useStore.setState({ contexts: ctx }),
    addImportedFile: vi.fn(),
  });
}

beforeEach(() => {
  resetStore();
  importViaInput.mockReset();
  importViaInput.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  // Detach the toast reporters this file installs — the default (unset)
  // reporters fall back to console, keeping other test files unpolluted.
  setErrorReporter(() => {});
  setSuccessReporter(() => {});
});

describe('ClusterSwitcher', () => {
  describe('rendering', () => {
    it('renders the switcher', () => {
      view = render(<ClusterSwitcher />);
      expect(view.container.firstChild).not.toBeNull();
    });

    it('shows no cluster when idle', () => {
      view = render(<ClusterSwitcher />);
      expect(view.queryByText(/No cluster|noCluster/i)).not.toBeNull();
    });

    it('shows cluster name when connected', () => {
      useStore.setState({
        connection: { phase: 'connected', context: 'minikube', clusterName: 'minikube' },
      });
      view = render(<ClusterSwitcher />);
      expect(view.queryByText('minikube')).not.toBeNull();
    });

    it('shows disconnected status when idle', () => {
      view = render(<ClusterSwitcher />);
      expect(view.queryByText(/Disconnected|disconnected/i)).not.toBeNull();
    });

    it('shows connected status', () => {
      useStore.setState({
        connection: { phase: 'connected', context: 'prod', clusterName: 'prod' },
        clusterStatus: {
          connected: true,
          version: 'v1.30.0',
          apiLatencyMs: 5,
          nodesReady: 3,
          nodesTotal: 3,
          cpuPercent: 50,
          memPercent: 60,
        },
      });
      view = render(<ClusterSwitcher />);
      expect(view.queryByText(/connected/i)).not.toBeNull();
    });

    it('shows connecting status', () => {
      useStore.setState({
        connection: { phase: 'connecting', context: 'prod', clusterName: 'prod' },
      });
      view = render(<ClusterSwitcher />);
      expect(view.queryByText(/connecting/i)).not.toBeNull();
    });
  });

  describe('initials badge', () => {
    it('shows first two letters of cluster name', () => {
      useStore.setState({
        connection: { phase: 'connected', context: 'minikube', clusterName: 'minikube' },
      });
      view = render(<ClusterSwitcher />);
      expect(view.queryByText('MI')).not.toBeNull();
    });

    it('shows initials for no-cluster fallback', () => {
      useStore.setState({
        connection: { phase: 'idle', context: null, clusterName: null },
      });
      view = render(<ClusterSwitcher />);
      // When no cluster, name is i18n fallback "no cluster" → initials "NO"
      const badge = view.container.querySelector('[class*="badge"]');
      expect(badge).not.toBeNull();
      expect(badge?.textContent).toBeTruthy();
    });
  });

  describe('import errors', () => {
    /** Open the switcher menu and click the import entry. */
    async function clickImport() {
      view = render(<ClusterSwitcher />);
      // The toggle button's label span ("No cluster" under the reset store);
      // the click bubbles up to the button.
      view.click(view.getByText(/No cluster/i));
      view.click(view.getByText(/Import kubeconfig/i));
      await act(async () => {
        await Promise.resolve();
      });
    }

    it('reports structured validation issues through the error reporter', async () => {
      const reported: Array<[string, string]> = [];
      setErrorReporter((title, message) => reported.push([title, message]));
      importViaInput.mockRejectedValue(
        new KubeconfigImportError('kubeconfig validation failed (1 issue(s)):', [
          {
            severity: 'error',
            code: 'missingClusterRef',
            message: "cluster 'nope' not found",
            context: 'c1',
          },
        ])
      );

      await clickImport();

      expect(reported).toHaveLength(1);
      expect(reported[0][0]).toBe('Import kubeconfig failed');
      expect(reported[0][1]).toContain("cluster 'nope' not found");
    });

    it('reports plain failures via their message', async () => {
      const reported: Array<[string, string]> = [];
      setErrorReporter((title, message) => reported.push([title, message]));
      importViaInput.mockRejectedValue(new Error("couldn't parse bad.yaml: boom"));

      await clickImport();

      expect(reported).toHaveLength(1);
      expect(reported[0][1]).toContain("couldn't parse bad.yaml: boom");
    });

    it('reports success warnings through the success reporter', async () => {
      const successes: Array<[string, string]> = [];
      setSuccessReporter((title, message) => successes.push([title, message]));
      importViaInput.mockResolvedValue({
        contexts: [{ name: 'c1', cluster: 'cl', current: false }],
        path: 'kubeconfig',
        issues: [
          { severity: 'warning', code: 'noCaBundle', message: 'https without a CA bundle', context: 'c1' },
        ],
      });

      await clickImport();

      expect(successes).toHaveLength(1);
      expect(successes[0][1]).toContain('https without a CA bundle');
    });
  });

  describe('dropdown', () => {
    it('toggles menu on button click', () => {
      view = render(<ClusterSwitcher />);
      const button = view.container.querySelector('button');
      expect(button).not.toBeNull();
      view.click(button!);
      expect(useStore.getState().openMenu).toBe('cluster');
    });

    it('shows context list when open', () => {
      useStore.setState({
        openMenu: 'cluster',
        contexts: [
          { name: 'minikube', cluster: 'minikube', current: true },
          { name: 'prod', cluster: 'prod-cluster', current: false },
        ],
      });
      view = render(<ClusterSwitcher />);
      expect(view.queryByText('minikube')).not.toBeNull();
      expect(view.queryByText('prod')).not.toBeNull();
    });

    it('shows cluster info for each context', () => {
      useStore.setState({
        openMenu: 'cluster',
        contexts: [{ name: 'ctx-1', cluster: 'my-cluster', current: false }],
      });
      view = render(<ClusterSwitcher />);
      expect(view.queryByText('my-cluster')).not.toBeNull();
    });

    it('highlights active context', () => {
      useStore.setState({
        openMenu: 'cluster',
        connection: { phase: 'connected', context: 'ctx-1', clusterName: 'ctx-1' },
        contexts: [
          { name: 'ctx-1', cluster: 'c1', current: true },
          { name: 'ctx-2', cluster: 'c2', current: false },
        ],
      });
      view = render(<ClusterSwitcher />);
      const activeRows = view.container.querySelectorAll('[class*="menuRowActive"]');
      expect(activeRows.length).toBe(1);
    });

    it('shows no-contexts message when empty', () => {
      useStore.setState({
        openMenu: 'cluster',
        contexts: [],
      });
      view = render(<ClusterSwitcher />);
      expect(view.queryByText(/No contexts|noContexts/i)).not.toBeNull();
    });
  });

  describe('file input', () => {
    it('renders hidden file input for import', () => {
      view = render(<ClusterSwitcher />);
      const fileInput = view.queryByTestId('kubeconfig-file-input');
      expect(fileInput).not.toBeNull();
    });
  });

  describe('import button', () => {
    it('renders import kubeconfig button when menu is open', () => {
      useStore.setState({
        openMenu: 'cluster',
        contexts: [],
      });
      view = render(<ClusterSwitcher />);
      expect(view.queryByText(/Import|import/i)).not.toBeNull();
    });
  });
});
