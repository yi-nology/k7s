/**
 * Tests for OnboardingWizard — the first-run 3-step guide (Task 9).
 *
 * Covers: step-1 rendering when open, nothing when closed, the step-2 gate on
 * connection.phase === 'connected', finish() writing the 'k7s.onboarded' flag +
 * default namespace + closing, and Esc/backdrop dismissal ALSO writing the
 * flag (dismissal marks onboarding done — the wizard must never nag twice,
 * which matters because the flag key is new and pre-upgrade installs would
 * otherwise see the wizard on every launch).
 *
 * These tests assert localized copy, so they pin the locale to "en"
 * explicitly (same contract as the global setup pin — kept explicit so the
 * assertion text and the locale stay visually coupled in the file).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { useStore } from '../../store';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';
import { OnboardingWizard } from './OnboardingWizard';
import { ONBOARDED_STORAGE_KEY } from '../../lib/onboarded';
import type { DataProvider } from '../../providers/types';

// The wizard reaches the cluster only through getProvider().importKubeconfig()
// (the same seam the command palette uses). Mocked here so step transitions
// resolve without a real picker.
const importKubeconfig = vi.hoisted(() => vi.fn());
vi.mock('../../providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers')>();
  return {
    ...actual,
    getProvider: () => ({ importKubeconfig }) as unknown as DataProvider,
  };
});

/**
 * Some vitest environments don't ship a working `localStorage` (the one Node
 * ships experimentally throws without `--localstorage-file`). Install a tiny
 * in-memory stub so the onboarded flag round-trips — same contract as
 * i18n.test.ts's installStorageStub.
 */
function installStorageStub(): void {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get: () => ({
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    }),
  });
}

let view: RenderResult;

function resetStore(overrides: Record<string, unknown> = {}) {
  useStore.setState({
    onboardingOpen: true,
    // Locale pin — these tests assert English copy.
    settings: { ...useStore.getState().settings, language: 'en' },
    connection: { phase: 'idle', context: null, clusterName: null },
    namespace: 'all',
    ...overrides,
  });
}

beforeEach(() => {
  installStorageStub();
  importKubeconfig.mockReset();
  importKubeconfig.mockResolvedValue({ contexts: [], path: '/tmp/kubeconfig' });
  resetStore();
});

afterEach(() => {
  cleanup();
  // Restore the (possibly missing) original localStorage so the next test
  // file sees the same environment it started with.
  Object.defineProperty(window, 'localStorage', { configurable: true, value: undefined });
});

/** Flush the wizard's async click handler (importKubeconfig → setStep). */
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

/** Advance to a step: 'import' | 'conn' | 'prefs' (requires the mocked provider). */
async function goToStep(step: 'conn' | 'prefs') {
  view = render(<OnboardingWizard />);
  view.click(view.getByText('Choose file…'));
  await flush();
  if (step === 'prefs') {
    act(() => {
      useStore.setState({
        connection: { phase: 'connected', context: 'ctx-a', clusterName: 'cluster-a' },
      });
    });
    view.click(view.getByText('Next'));
  }
}

describe('OnboardingWizard', () => {
  it('renders step 1 (import) when open', () => {
    view = render(<OnboardingWizard />);
    expect(view.queryByText('Import cluster')).not.toBeNull();
    expect(view.queryByText('Choose file…')).not.toBeNull();
  });

  it('renders nothing when closed', () => {
    resetStore({ onboardingOpen: false });
    view = render(<OnboardingWizard />);
    expect(view.container.innerHTML).toBe('');
  });

  it('step 2 waits for the connection before enabling Next', async () => {
    view = render(<OnboardingWizard />);
    view.click(view.getByText('Choose file…'));
    await flush();

    // Still connecting — the wait copy shows and Next stays disabled.
    act(() => {
      useStore.setState({ connection: { phase: 'connecting', context: 'ctx-a', clusterName: null } });
    });
    expect(view.queryByText(/Connecting…/)).not.toBeNull();
    const next = view.getByText('Next');
    expect(next.hasAttribute('disabled')).toBe(true);

    // Connected — the cluster name shows and Next unlocks.
    act(() => {
      useStore.setState({
        connection: { phase: 'connected', context: 'ctx-a', clusterName: 'cluster-a' },
      });
    });
    expect(view.queryByText('Connected: cluster-a')).not.toBeNull();
    expect(view.getByText('Next').hasAttribute('disabled')).toBe(false);
  });

  it('finish() sets the onboarded flag, the namespace, and closes the wizard', async () => {
    await goToStep('prefs');
    expect(view.queryByText('Default namespace')).not.toBeNull();

    view.click(view.getByText('Go to overview'));
    expect(window.localStorage.getItem(ONBOARDED_STORAGE_KEY)).toBe('1');
    expect(useStore.getState().namespace).toBe('default');
    expect(useStore.getState().onboardingOpen).toBe(false);
  });

  it('Esc dismissal marks onboarding done and closes the wizard', async () => {
    view = render(<OnboardingWizard />);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(useStore.getState().onboardingOpen).toBe(false);
    // Dismissal is completion: the flag is written so the wizard never
    // re-opens on the next launch.
    expect(window.localStorage.getItem(ONBOARDED_STORAGE_KEY)).toBe('1');
    // And it stays closed (no re-open path once the flag is set).
    view = render(<OnboardingWizard />);
    expect(view.container.innerHTML).toBe('');
  });

  it('backdrop dismissal marks onboarding done and closes the wizard', async () => {
    await goToStep('conn');
    // The backdrop is the wizard's outermost element; the dialog stops
    // propagation so only an actual backdrop click dismisses.
    const backdrop = view.container.firstElementChild as HTMLElement;
    view.click(backdrop);
    expect(useStore.getState().onboardingOpen).toBe(false);
    expect(window.localStorage.getItem(ONBOARDED_STORAGE_KEY)).toBe('1');
  });
});
