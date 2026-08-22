/**
 * Mock resource CRUD operations.
 */

import type {
  ApplyResult,
  DocDryRun,
  EventItem,
  Properties,
  ResourceRef,
  Revision,
  SecretEntry,
  YamlDiff,
  Row,
  KindId,
  CustomKind,
  Unsub,
} from '../types';
import { KIND_ORDER } from '../../lib/kinds';
import { MOCK_CUSTOM_KINDS, buildCustomRows, buildKindRows } from './data';
import { eventsForPodName } from './events';
import { mockProperties } from './properties';
import { yamlForPodName, yamlForGeneric } from './yaml';

export class MockResourcesMixin {
  protected yamlCache = new Map<string, string>();
  protected resourceCbs = new Set<(kind: KindId, rows: Row[]) => void>();
  protected customKindCbs = new Set<(kinds: CustomKind[]) => void>();

  /** Emit a fresh snapshot of every kind to all resource subscribers. */
  protected emitAllRows(): void {
    for (const kind of KIND_ORDER) {
      const rows = buildKindRows(kind);
      for (const cb of this.resourceCbs) cb(kind, rows);
    }
  }

  async getYaml(ref: ResourceRef): Promise<string> {
    const key = `${ref.kind}:${ref.namespace}/${ref.name}`;
    const cached = this.yamlCache.get(key);
    if (cached) return cached;
    return ref.kind === 'pods'
      ? yamlForPodName(ref.name)
      : yamlForGeneric(ref.kind, ref.namespace, ref.name);
  }

  async applyYaml(ref: ResourceRef, text: string): Promise<void> {
    this.yamlCache.set(`${ref.kind}:${ref.namespace}/${ref.name}`, text);
  }

  async dryRunYaml(ref: ResourceRef, text: string): Promise<YamlDiff> {
    const current = await this.getYaml(ref);
    let proposed = text;
    if (!/terminationGracePeriodSeconds:/.test(proposed)) {
      proposed = proposed.replace(/^spec:$/m, 'spec:\n  terminationGracePeriodSeconds: 30');
    }
    if (!/k7s\.demo\/mutated:/.test(proposed)) {
      proposed = proposed.replace(
        /^ {2}annotations:$/m,
        '  annotations:\n    k7s.demo/mutated: "true"'
      );
    }
    return { current, proposed };
  }

  async getEvents(ref: ResourceRef): Promise<EventItem[]> {
    return eventsForPodName(ref.name);
  }

  async getProperties(ref: ResourceRef): Promise<Properties> {
    const props = mockProperties(ref);
    if (!props) throw new Error(`no properties for kind ${ref.kind}`);
    return props;
  }

  async getSecretData(_namespace: string, _name: string): Promise<SecretEntry[]> {
    return [
      { key: 'username', value: 'admin' },
      { key: 'password', value: 's3cret-v4lue!' },
      { key: 'token', value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.demo' },
    ];
  }

  async deleteResource(_ref: ResourceRef): Promise<void> {}
  async scaleResource(_ref: ResourceRef, _replicas: number): Promise<void> {}
  async restartPod(_ref: ResourceRef): Promise<void> {}
  async restartRollout(_ref: ResourceRef): Promise<void> {}

  async listRevisions(ref: ResourceRef): Promise<Revision[]> {
    void ref;
    const now = Date.now();
    const age = (mins: number) => new Date(now - mins * 60_000).toISOString();
    return [
      {
        revision: 3,
        images: [{ name: 'app', image: 'nginx:1.25.3', init: false }],
        desired: 3,
        ready: 3,
        age: age(2),
        isCurrent: true,
      },
      {
        revision: 2,
        images: [{ name: 'app', image: 'nginx:1.25.2', init: false }],
        desired: 0,
        ready: 0,
        age: age(63),
        isCurrent: false,
      },
      {
        revision: 1,
        images: [{ name: 'app', image: 'nginx:1.25.1', init: false }],
        desired: 0,
        ready: 0,
        age: age(60 * 25),
        isCurrent: false,
      },
    ];
  }

  async undoRollout(_ref: ResourceRef, _toRevision?: number): Promise<void> {}
  async setCordon(_node: string, _unschedulable: boolean): Promise<void> {}

  async applyYamlBundle(_yaml: string): Promise<ApplyResult[]> {
    return [
      {
        name: 'demo',
        kind: 'Deployment',
        namespace: 'default',
        action: 'created',
        error: null,
      },
    ];
  }

  async dryRunYamlBundle(yaml: string): Promise<DocDryRun[]> {
    const docs = yaml
      .split(/^---\s*$/m)
      .map((d) => d.trim())
      .filter((d) => d.length > 0);
    return docs.map((doc) => {
      const nameMatch = doc.match(/^\s*name:\s*(\S+)/m);
      const kindMatch = doc.match(/^\s*kind:\s*(\S+)/m);
      return {
        kind: kindMatch?.[1] ?? 'Unknown',
        namespace: 'default',
        name: nameMatch?.[1] ?? 'unknown',
        proposed: doc,
        error: null,
      };
    });
  }

  onResourceUpdate(cb: (kind: KindId, rows: Row[]) => void): Unsub {
    this.resourceCbs.add(cb);
    queueMicrotask(() => {
      for (const kind of KIND_ORDER) cb(kind, buildKindRows(kind));
    });
    return () => {
      this.resourceCbs.delete(cb);
    };
  }

  onCustomKinds(cb: (kinds: CustomKind[]) => void): Unsub {
    this.customKindCbs.add(cb);
    queueMicrotask(() => cb(MOCK_CUSTOM_KINDS));
    return () => {
      this.customKindCbs.delete(cb);
    };
  }

  async watchCustomKind(id: string): Promise<void> {
    const rows = buildCustomRows(id);
    for (const cb of this.resourceCbs) cb(id, rows);
  }

  async unwatchCustomKind(_id: string): Promise<void> {}
}
