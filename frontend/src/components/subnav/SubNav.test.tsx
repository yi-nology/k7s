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
    customKindCounts: undefined,
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

  it('collapses the Custom Resources group by default and expands on toggle', () => {
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
    // The group is a collapsed toggle (with its count) — the CRD kind tab
    // itself is NOT rendered until the user expands it: operator-installed
    // CRD definitions are noise next to ConfigMap/Secret by default.
    const toggle = view.getByText('Custom Resources');
    expect(toggle).toBeTruthy();
    expect(view.queryByText('1')).toBeTruthy();
    expect(view.queryByRole('tab', { name: 'Application' })).toBeNull();
    view.click(toggle);
    const app = view.queryByRole('tab', { name: 'Application' });
    expect(app).not.toBeNull();
    view.click(app!);
    expect(useStore.getState().nav).toBe('argoproj.io/applications');
    // Custom kinds default to the config section (sectionForKind).
    expect(useStore.getState().section).toBe('config');
  });

  it('auto-expands the Custom Resources group when a custom kind is active', () => {
    useStore.setState({
      nav: 'argoproj.io/applications',
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
    // Deep links / palette navigation to a CRD kind must not hide the active
    // tab behind a collapsed group.
    const app = view.queryByRole('tab', { name: 'Application' });
    expect(app).not.toBeNull();
    expect(app?.className).toContain('active');
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

  // ---- P4 Task 4: customKindCounts filtering ----

  const CUSTOM_KINDS_MULTI = [
    {
      id: 'argoproj.io/applications',
      group: 'argoproj.io',
      version: 'v1alpha1',
      kind: 'Application',
      plural: 'applications',
      namespaced: true,
    },
    {
      id: 'argoproj.io/appprojects',
      group: 'argoproj.io',
      version: 'v1alpha1',
      kind: 'AppProject',
      plural: 'appprojects',
      namespaced: true,
    },
    {
      id: 'cert-manager.io/clusterissuers',
      group: 'cert-manager.io',
      version: 'v1',
      kind: 'ClusterIssuer',
      plural: 'clusterissuers',
      namespaced: false,
    },
  ];

  it('hides custom kinds with 0 instances when counts are loaded', () => {
    useStore.setState({
      nav: 'configmaps',
      section: 'config',
      customKinds: CUSTOM_KINDS_MULTI,
      customKindCounts: {
        'argoproj.io/applications': 5,
        'argoproj.io/appprojects': 0,
        'cert-manager.io/clusterissuers': 0,
      },
    });
    view = render(<SubNav section="config" />);
    // Expand the custom group to see the tabs
    view.click(view.getByText('Custom Resources'));
    // Application (count 5) is visible
    expect(view.queryByRole('tab', { name: 'Application' })).not.toBeNull();
    // AppProject (count 0) is hidden
    expect(view.queryByRole('tab', { name: 'AppProject' })).toBeNull();
    // ClusterIssuer (count 0) is hidden
    expect(view.queryByRole('tab', { name: 'ClusterIssuer' })).toBeNull();
  });

  it('never hides the active custom kind even if its count is 0', () => {
    useStore.setState({
      nav: 'argoproj.io/appprojects',
      section: 'config',
      customKinds: CUSTOM_KINDS_MULTI,
      customKindCounts: {
        'argoproj.io/applications': 5,
        'argoproj.io/appprojects': 0,
        'cert-manager.io/clusterissuers': 0,
      },
    });
    view = render(<SubNav section="config" />);
    // Active kind auto-expands the group and is always visible
    const appProject = view.queryByRole('tab', { name: 'AppProject' });
    expect(appProject).not.toBeNull();
    expect(appProject?.className).toContain('active');
    // Non-active, non-zero count kind is also visible
    expect(view.queryByRole('tab', { name: 'Application' })).not.toBeNull();
    // Non-active zero-count kind is hidden
    expect(view.queryByRole('tab', { name: 'ClusterIssuer' })).toBeNull();
  });

  it('badge shows filtered (non-empty) count', () => {
    useStore.setState({
      nav: 'configmaps',
      section: 'config',
      customKinds: CUSTOM_KINDS_MULTI,
      customKindCounts: {
        'argoproj.io/applications': 5,
        'argoproj.io/appprojects': 0,
        'cert-manager.io/clusterissuers': 3,
      },
    });
    view = render(<SubNav section="config" />);
    // Badge shows 2 (non-zero kinds), not 3 (total kinds)
    expect(view.queryByText('2')).toBeTruthy();
    expect(view.queryByText('3')).toBeNull();
  });

  it('shows all custom kinds when counts are not loaded (undefined)', () => {
    useStore.setState({
      nav: 'configmaps',
      section: 'config',
      customKinds: CUSTOM_KINDS_MULTI,
      customKindCounts: undefined,
    });
    view = render(<SubNav section="config" />);
    view.click(view.getByText('Custom Resources'));
    // All kinds are visible when counts haven't loaded
    expect(view.queryByRole('tab', { name: 'Application' })).not.toBeNull();
    expect(view.queryByRole('tab', { name: 'AppProject' })).not.toBeNull();
    expect(view.queryByRole('tab', { name: 'ClusterIssuer' })).not.toBeNull();
    // Badge shows total count
    expect(view.queryByText('3')).toBeTruthy();
  });

  it('shows tooltip when some custom kinds are hidden', () => {
    useStore.setState({
      nav: 'configmaps',
      section: 'config',
      customKinds: CUSTOM_KINDS_MULTI,
      customKindCounts: {
        'argoproj.io/applications': 5,
        'argoproj.io/appprojects': 0,
        'cert-manager.io/clusterissuers': 0,
      },
    });
    view = render(<SubNav section="config" />);
    const toggle = view.getByText('Custom Resources').closest('button');
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute('title')).toBeTruthy();
  });

  it('does not show tooltip when all custom kinds have instances', () => {
    useStore.setState({
      nav: 'configmaps',
      section: 'config',
      customKinds: CUSTOM_KINDS_MULTI,
      customKindCounts: {
        'argoproj.io/applications': 5,
        'argoproj.io/appprojects': 2,
        'cert-manager.io/clusterissuers': 3,
      },
    });
    view = render(<SubNav section="config" />);
    const toggle = view.getByText('Custom Resources').closest('button');
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute('title')).toBeNull();
  });
});
