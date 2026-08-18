/**
 * Tests for the 5-section registry (P1 IA refactor). Kind ids are validated
 * against KIND_META in kinds.tsx — e.g. the Helm release kind's id is `helm`,
 * not `helmreleases`.
 */

import { describe, expect, it } from 'vitest';
import { kindsForSection, SECTION_ORDER, sectionForKind } from './sections';

describe('sectionForKind', () => {
  it('routes workload kinds to workloads', () => {
    expect(sectionForKind('pods')).toBe('workloads');
    expect(sectionForKind('deployments')).toBe('workloads');
    expect(sectionForKind('helm')).toBe('workloads');
  });

  it('routes config/network/rbac/cluster kinds to config', () => {
    for (const k of [
      'configmaps',
      'secrets',
      'services',
      'ingresses',
      'serviceaccounts',
      'nodes',
      'namespaces',
      'events',
    ] as const) {
      expect(sectionForKind(k)).toBe('config');
    }
  });

  it('routes storage kinds to storage', () => {
    for (const k of [
      'persistentvolumes',
      'persistentvolumeclaims',
      'storageclasses',
    ] as const) {
      expect(sectionForKind(k)).toBe('storage');
    }
  });

});

describe('SECTION_ORDER / kindsForSection', () => {
  it('has exactly 5 sections in order', () => {
    expect(SECTION_ORDER).toEqual(['overview', 'workloads', 'config', 'storage', 'tools']);
  });

  it('every resource kind appears in exactly one non-tool section', () => {
    const all = [
      ...kindsForSection('workloads'),
      ...kindsForSection('config'),
      ...kindsForSection('storage'),
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it('lists the curated sub-nav kinds for each section', () => {
    expect(kindsForSection('workloads')).toEqual([
      'deployments',
      'statefulsets',
      'daemonsets',
      'jobs',
      'cronjobs',
      'pods',
      'helm',
    ]);
    expect(kindsForSection('storage')).toEqual([
      'persistentvolumeclaims',
      'persistentvolumes',
      'storageclasses',
    ]);
  });

  it('has no kinds in the overview and tools sections', () => {
    expect(kindsForSection('overview')).toEqual([]);
    expect(kindsForSection('tools')).toEqual([]);
  });
});
