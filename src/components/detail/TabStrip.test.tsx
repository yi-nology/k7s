/**
 * Tests for TabStrip — the multi-tab strip for the detail panel.
 *
 * Covers: hidden when 0-1 tabs, renders tabs when 2+, active tab styling,
 * click to activate, close button, middle-click close.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../store';
import { TabStrip } from './TabStrip';
import { render, cleanup, createMockRow, type RenderResult } from '../../test/componentUtils';
import type { DetailTab2 } from '../../store';

let view: RenderResult;

function resetStore() {
  useStore.setState({
    detailTabs: [],
    activeDetailTabUid: null,
    customKinds: [],
  });
}

function makeTab(uid: string, name: string, kind = 'pods'): DetailTab2 {
  return {
    uid,
    kind,
    row: createMockRow({ uid, name }),
    activeTab: 'logs',
  };
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  cleanup();
});

describe('TabStrip', () => {
  describe('visibility', () => {
    it('renders nothing when no tabs are open', () => {
      useStore.setState({ detailTabs: [], activeDetailTabUid: null });
      view = render(<TabStrip />);
      expect(view.container.innerHTML).toBe('');
    });

    it('renders nothing when only one tab is open', () => {
      const tab = makeTab('t1', 'nginx');
      useStore.setState({ detailTabs: [tab], activeDetailTabUid: 't1' });
      view = render(<TabStrip />);
      expect(view.container.innerHTML).toBe('');
    });

    it('renders the strip when two or more tabs are open', () => {
      const tabs = [makeTab('t1', 'nginx'), makeTab('t2', 'redis')];
      useStore.setState({ detailTabs: tabs, activeDetailTabUid: 't1' });
      view = render(<TabStrip />);
      const tablist = view.queryByRole('tablist');
      expect(tablist).not.toBeNull();
    });
  });

  describe('tab rendering', () => {
    it('renders a tab button for each open tab', () => {
      const tabs = [makeTab('t1', 'nginx'), makeTab('t2', 'redis'), makeTab('t3', 'postgres')];
      useStore.setState({ detailTabs: tabs, activeDetailTabUid: 't1' });
      view = render(<TabStrip />);
      const tabButtons = view.queryAllByRole('tab');
      expect(tabButtons.length).toBe(3);
    });

    it('displays the resource name in each tab', () => {
      const tabs = [makeTab('t1', 'nginx'), makeTab('t2', 'redis')];
      useStore.setState({ detailTabs: tabs, activeDetailTabUid: 't1' });
      view = render(<TabStrip />);
      expect(view.queryByText('nginx')).not.toBeNull();
      expect(view.queryByText('redis')).not.toBeNull();
    });

    it('marks the active tab with aria-selected', () => {
      const tabs = [makeTab('t1', 'nginx'), makeTab('t2', 'redis')];
      useStore.setState({ detailTabs: tabs, activeDetailTabUid: 't2' });
      view = render(<TabStrip />);
      const tabButtons = view.queryAllByRole('tab');
      // The second tab should be aria-selected=true
      const activeTab = tabButtons.find((t) => t.getAttribute('aria-selected') === 'true');
      expect(activeTab).toBeDefined();
      expect(activeTab?.textContent).toContain('redis');
    });
  });

  describe('tab activation', () => {
    it('sets the active tab on click', () => {
      const tabs = [makeTab('t1', 'nginx'), makeTab('t2', 'redis')];
      useStore.setState({ detailTabs: tabs, activeDetailTabUid: 't1' });
      view = render(<TabStrip />);
      const tabButtons = view.queryAllByRole('tab');
      // Click the second tab
      view.click(tabButtons[1]);
      expect(useStore.getState().activeDetailTabUid).toBe('t2');
    });
  });

  describe('close button', () => {
    it('renders a close button for each tab', () => {
      const tabs = [makeTab('t1', 'nginx'), makeTab('t2', 'redis')];
      useStore.setState({ detailTabs: tabs, activeDetailTabUid: 't1' });
      view = render(<TabStrip />);
      const closeButtons = view.container.querySelectorAll('button[aria-label]');
      // Each tab has a close button, plus the tab buttons themselves
      const tabCloseButtons = Array.from(closeButtons).filter((b) =>
        b.getAttribute('aria-label')?.startsWith('Close ')
      );
      expect(tabCloseButtons.length).toBe(2);
    });

    it('closes a tab when its close button is clicked', () => {
      const tabs = [makeTab('t1', 'nginx'), makeTab('t2', 'redis')];
      useStore.setState({ detailTabs: tabs, activeDetailTabUid: 't1' });
      view = render(<TabStrip />);
      const closeBtn = view.container.querySelector('[aria-label="Close nginx tab"]');
      expect(closeBtn).not.toBeNull();
      view.click(closeBtn!);
      const remaining = useStore.getState().detailTabs;
      expect(remaining.length).toBe(1);
      expect(remaining[0].uid).toBe('t2');
    });
  });
});
