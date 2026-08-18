/**
 * Tests for the 5-section registry (P1 IA refactor). Kind ids are validated
 * against KIND_META in kinds.tsx — e.g. the Helm release kind's id is `helm`,
 * not `helmreleases`.
 */

import { describe, expect, it } from 'vitest';
import { kindsForSection, SECTION_ORDER, sectionForKind } from './sections';
import { KIND_ORDER } from './kinds';

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

  // Registry coverage: a kind that ships in KIND_META but has no section home
  // is unreachable except through ⌘K — exactly how 8 kinds silently went
  // missing from the SubNav once. This test fails whenever a new kind is added
  // to kinds.tsx without a curated list (or an explicit exclusion below).
  it('every KIND_META kind is curated in exactly one section or explicitly excluded', () => {
    // Deliberately NOT in any curated list:
    // - replicasets: hidden by design — a Deployment's ReplicaSets are viewed
    //   from the Deployment's detail page, not browsed standalone.
    const EXCLUDED: ReadonlySet<string> = new Set(['replicasets']);

    const curated = [
      ...kindsForSection('workloads'),
      ...kindsForSection('config'),
      ...kindsForSection('storage'),
    ];
    const seen = new Map<string, number>();
    for (const k of curated) seen.set(k, (seen.get(k) ?? 0) + 1);
    const duplicated = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
    expect(duplicated).toEqual([]);

    const missing = KIND_ORDER.filter((k) => !seen.has(k) && !EXCLUDED.has(k));
    expect(missing).toEqual([]);
    // And the allowlist must not rot: every entry is a real kind, absent from
    // the curated lists on purpose.
    for (const k of EXCLUDED) {
      expect(KIND_ORDER).toContain(k);
      expect(seen.has(k)).toBe(false);
    }
  });
});
