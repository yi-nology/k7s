/**
 * Tests for SubNav — the per-section kind tab strip (P1 IA rework).
 *
 * workloads renders one flat group of tabs (no headings); config renders the
 * SECTION_SUBGROUPS groups plus a trailing "Custom Resources" group fed by the
 * store's discovered CRD kinds; storage renders its single subgroup. The active
 * tab mirrors the store's `nav`, and clicking a tab routes through `setNav`
 * (which also re-derives `section` — asserted so the SubNav can't regress into
 * a setSection-only navigation).
 *
 * English assertions run against the default 'en' locale (pinned in beforeEach,
 * mirroring Sidebar.test.tsx's explicit zh pin); the last test flips to zh to
 * prove the group headings and kind labels go through the dictionary.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../store';
import { SubNav } from './SubNav';
import { cleanup, render, type RenderResult } from '../../test/componentUtils';

let view: RenderResult;

function resetStore() {
  useStore.setState({
    nav: 'pods',
    section: 'overview',
    customKinds: [],
    settings: { ...useStore.getState().settings, language: 'en' },
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  cleanup();
});

describe('SubNav', () => {
  it('lists workload kinds as flat tabs and marks the active one', () => {
    useStore.setState({ nav: 'deployments', section: 'workloads' });
    view = render(<SubNav section="workloads" />);
    const dep = view.queryByRole('tab', { name: 'Deployments' });
    expect(dep).not.toBeNull();
    expect(dep?.className).toContain('active');
    // Flat: one button per WORKLOAD_KINDS entry (Task 1 registry order) and no
    // group headings in the strip.
    expect(view.querySelectorAll('button[role="tab"]').length).toBe(7);
    expect(view.container.querySelector('[class*="groupLabel"]')).toBeNull();
    // A non-active tab must not carry the state.
    expect(view.queryByRole('tab', { name: 'Pods' })?.className).not.toContain('active');
  });

  it('switches the nav kind (and re-derives the section) when a tab is clicked', () => {
    useStore.setState({ nav: 'deployments', section: 'workloads' });
    view = render(<SubNav section="workloads" />);
    view.click(view.getByText('Pods'));
    expect(useStore.getState().nav).toBe('pods');
    // setNav derives the section from the kind — no separate section write.
    expect(useStore.getState().section).toBe('workloads');
  });

  it('renders grouped subnav for the config section', () => {
    useStore.setState({ nav: 'configmaps', section: 'config' });
    view = render(<SubNav section="config" />);
    // Group headings from subnav.group.* (en): config/network/access/cluster…
    expect(view.getByText('Configuration')).toBeTruthy();
    expect(view.getByText('Network')).toBeTruthy();
    expect(view.getByText('Access Control')).toBeTruthy();
    expect(view.getByText('Cluster')).toBeTruthy();
    // …and every subgroup kind is reachable as a tab.
    expect(view.queryByRole('tab', { name: 'Nodes' })).not.toBeNull();
    expect(view.queryByRole('tab', { name: 'Ingresses' })).not.toBeNull();
    // No CRDs on this cluster → no dangling "Custom Resources" heading.
    expect(view.queryByText('Custom Resources')).toBeNull();
  });

  it('appends discovered CRD kinds under the Custom Resources group', () => {
    useStore.setState({
      nav: 'configmaps',
      section: 'config',
      customKinds: [
        {
          id: 'argoproj.io/applications',
          group: 'argoproj.io',
          version: 'v1alpha1',
          kind: 'Application',
          plural: 'applications',
          namespaced: true,
        },
      ],
    });
    view = render(<SubNav section="config" />);
    expect(view.getByText('Custom Resources')).toBeTruthy();
    const app = view.queryByRole('tab', { name: 'Application' });
    expect(app).not.toBeNull();
    expect(app?.className).not.toContain('active');
    view.click(app!);
    expect(useStore.getState().nav).toBe('argoproj.io/applications');
    // Custom kinds default to the config section (sectionForKind).
    expect(useStore.getState().section).toBe('config');
  });

  it('renders the storage section kinds as a single grouped strip', () => {
    useStore.setState({ nav: 'persistentvolumeclaims', section: 'storage' });
    view = render(<SubNav section="storage" />);
    expect(view.getByText('Storage')).toBeTruthy();
    const pvc = view.queryByRole('tab', { name: 'PersistentVolumeClaims' });
    expect(pvc).not.toBeNull();
    expect(pvc?.className).toContain('active');
    expect(view.queryByRole('tab', { name: 'PersistentVolumes' })).not.toBeNull();
    expect(view.queryByRole('tab', { name: 'StorageClasses' })).not.toBeNull();
  });

  it('localizes group headings and kind labels in zh', () => {
    useStore.setState({
      nav: 'nodes',
      section: 'config',
      customKinds: [
        {
          id: 'cert-manager.io/certificates',
          group: 'cert-manager.io',
          version: 'v1',
          kind: 'Certificate',
          plural: 'certificates',
          namespaced: true,
        },
      ],
      settings: { ...useStore.getState().settings, language: 'zh' },
    });
    view = render(<SubNav section="config" />);
    expect(view.getByText('访问控制')).toBeTruthy();
    expect(view.getByText('自定义资源')).toBeTruthy();
    expect(view.getByText('配置')).toBeTruthy();
    const node = view.queryByRole('tab', { name: '节点' });
    expect(node).not.toBeNull();
    expect(node?.className).toContain('active');
  });
});
