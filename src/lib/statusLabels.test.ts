/**
 * Tests for statusLabels — the fixed status → localized label/hint table.
 *
 * The table (not the i18n dictionaries) owns these strings: the vocabulary is
 * fixed and one-to-one with backend statuses, so a data table with zh/en
 * columns beats dictionary keys. See statusLabels.ts for the rationale.
 */

import { describe, it, expect } from 'vitest';
import { localizeStatus } from './statusLabels';

describe('localizeStatus', () => {
  it('localizes common pod statuses to zh with raw in hint', () => {
    const s = localizeStatus('CrashLoopBackOff', 'zh');
    expect(s?.label).toBe('崩溃循环');
    expect(s?.raw).toBe('CrashLoopBackOff');
    expect(s?.hint.length).toBeGreaterThan(0);
  });
  it('covers the K8s status vocabulary', () => {
    for (const [raw, zh] of [
      ['Running', '运行中'], ['Pending', '待调度'], ['ContainerCreating', '容器创建中'],
      ['ImagePullBackOff', '镜像拉取失败'], ['Evicted', '已驱逐'], ['Terminating', '终止中'],
      ['Completed', '已完成'], ['Succeeded', '成功'], ['Failed', '失败'],
      ['Ready', '就绪'], ['Bound', '已绑定'], ['Active', '活跃'], ['Unknown', '未知'],
    ] as const) expect(localizeStatus(raw, 'zh')?.label).toBe(zh);
  });
  it('returns null for unknown statuses', () => {
    expect(localizeStatus('SomeNewState', 'zh')).toBeNull();
  });
  it('en locale keeps raw label', () => {
    expect(localizeStatus('CrashLoopBackOff', 'en')?.label).toBe('CrashLoopBackOff');
  });

  it('gives every vocabulary entry a non-empty hint in both locales', () => {
    const vocab = [
      'Running', 'Pending', 'ContainerCreating', 'CrashLoopBackOff', 'ImagePullBackOff',
      'Evicted', 'Terminating', 'Completed', 'Succeeded', 'Failed', 'Error',
      'Ready', 'Bound', 'Active', 'Unknown',
    ];
    for (const raw of vocab) {
      for (const locale of ['zh', 'en'] as const) {
        const s = localizeStatus(raw, locale);
        expect(s, `${raw}/${locale}`).not.toBeNull();
        expect(s?.hint.length, `${raw}/${locale} hint`).toBeGreaterThan(0);
        expect(s?.raw, `${raw}/${locale} raw`).toBe(raw);
      }
    }
  });
  it('gives the major failure statuses short en hints (not the raw echo)', () => {
    for (const raw of ['CrashLoopBackOff', 'ImagePullBackOff', 'Evicted', 'Failed', 'Error']) {
      const s = localizeStatus(raw, 'en');
      expect(s?.hint, raw).not.toBe(raw);
      expect(s?.hint.length, raw).toBeGreaterThan(0);
    }
  });
});
