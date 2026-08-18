/**
 * Tests for Sidebar — the 5-section rail (P1 IA rework).
 *
 * The sidebar no longer enumerates resource kinds (NavList is gone); it renders
 * exactly one button per section in SECTION_ORDER, marks the store's active
 * section, and keeps the ClusterSwitcher / WatchFooter chrome. Labels are
 * asserted in Chinese, so each test pins the locale to zh first (the default
 * is en until the Task 6 locale flip).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../store';
import { Sidebar } from './Sidebar';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';

let view: RenderResult;

function resetStore() {
  useStore.setState({
    nav: 'pods',
    section: 'overview',
    namespace: 'all',
    connection: { phase: 'idle', context: null, clusterName: null },
    watchCount: 0,
    rows: useStore.getState().rows,
    customKinds: [],
    watchStatus: {},
    overlay: null,
    settings: { ...useStore.getState().settings, language: 'zh' },
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  cleanup();
});

describe('Sidebar (5-section rail)', () => {
  it('renders exactly the 5 sections', () => {
    view = render(<Sidebar open onClose={() => {}} onToggle={() => {}} />);
    for (const label of ['概览', '工作负载', '配置与网络', '存储', '运维工具']) {
      expect(view.querySelector(`[title="${label}"]`)).not.toBeNull();
    }
    // "Exactly" — the rail holds one button per section, nothing else.
    expect(view.querySelectorAll('button[class*="railItem"]').length).toBe(5);
  });

  it('marks the active section', () => {
    useStore.setState({ section: 'workloads' });
    view = render(<Sidebar open onClose={() => {}} onToggle={() => {}} />);
    const active = view.querySelector('[title="工作负载"]');
    expect(active).not.toBeNull();
    expect((active as HTMLElement).className).toContain('active');
    // Only the active section carries the state.
    expect(view.querySelector('[title="概览"]')?.className).not.toContain('active');
  });
});
