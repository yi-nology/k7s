/**
 * Tests for ToolsPage — the ops-tools catalog (P1 IA rework, Task 4).
 *
 * The old sidebar Tools group's entries became categorized cards. Each card is
 * a plain button that routes through the store's existing `openOverlay(key)`
 * (signature: one required OverlayKey + an optional podRef the catalog never
 * passes — asserted as a single-argument call), so the overlay panels and
 * App's rendering mechanism stay untouched.
 *
 * English assertions run against a pinned 'en' locale (mirroring SubNav.test);
 * the last test flips to zh to prove both the category headings
 * (tools.category.*) and the card labels (chrome.sidebar.tools.*) go through
 * the dictionary. On desktop IPADOS_HIDDEN_OVERLAYS is empty, so all 14 cards
 * render; iPadOS-only exclusions are covered by lib/platform filtering inline.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store';
import { ToolsPage } from './ToolsPage';
import { cleanup, render, type RenderResult } from '../../test/componentUtils';

let view: RenderResult;

/** The real action, captured before any test swaps in a mock. */
const realOpenOverlay = useStore.getState().openOverlay;

function resetStore() {
  useStore.setState({
    settings: { ...useStore.getState().settings, language: 'en' },
    openOverlay: realOpenOverlay,
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  cleanup();
});

describe('ToolsPage', () => {
  it('renders the six category headings with their tool cards', () => {
    view = render(<ToolsPage />);
    // tools.category.* headings (en dictionary).
    expect(view.getByText('Observability')).toBeTruthy();
    expect(view.getByText('Helm')).toBeTruthy();
    expect(view.getByText('Images')).toBeTruthy();
    expect(view.getByText('Security')).toBeTruthy();
    expect(view.getByText('Network')).toBeTruthy();
    expect(view.getByText('Cluster Tools')).toBeTruthy();
    // A representative card per registry group (chrome.sidebar.tools.*).
    expect(view.getByText('Helm Market')).toBeTruthy();
    expect(view.getByText('Service Topology')).toBeTruthy();
    // Full desktop catalog: 14 cards across the 6 categories.
    expect(view.querySelectorAll('button').length).toBe(14);
  });

  it('opens the matching overlay when a card is clicked', () => {
    const openOverlay = vi.fn();
    useStore.setState({ openOverlay: openOverlay as never });
    view = render(<ToolsPage />);
    const card = view.container.querySelector('button[title="Helm Market"]');
    expect(card).not.toBeNull();
    view.click(card as HTMLElement);
    // Real signature: openOverlay(key, podRef?) — the catalog passes only the key.
    expect(openOverlay).toHaveBeenCalledWith('helm-market');
    expect(openOverlay).toHaveBeenCalledTimes(1);
  });

  it('localizes category headings and card labels in zh', () => {
    useStore.setState({
      settings: { ...useStore.getState().settings, language: 'zh' },
    });
    view = render(<ToolsPage />);
    expect(view.getByText('可观测性')).toBeTruthy();
    expect(view.getByText('Helm 应用')).toBeTruthy();
    expect(view.getByText('镜像')).toBeTruthy();
    expect(view.getByText('安全合规')).toBeTruthy();
    expect(view.getByText('网络诊断')).toBeTruthy();
    expect(view.getByText('集群工具')).toBeTruthy();
    // Card labels come from the existing chrome.sidebar.tools.* entries.
    expect(view.getByText('Helm 市场')).toBeTruthy();
    expect(view.getByText('服务拓扑')).toBeTruthy();
  });
});
