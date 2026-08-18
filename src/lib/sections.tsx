// src/lib/sections.ts — 5 分区注册表(P1 IA 重构)
import { Home, Boxes, Network, HardDrive, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';
import type { KindId } from '../providers/types';

export type SectionId = 'overview' | 'workloads' | 'config' | 'storage' | 'tools';

export const SECTION_ORDER: SectionId[] = ['overview', 'workloads', 'config', 'storage', 'tools'];

export const SECTION_ICONS: Record<SectionId, ReactNode> = {
  overview: <Home size={18} />,
  workloads: <Boxes size={18} />,
  config: <Network size={18} />,
  storage: <HardDrive size={18} />,
  tools: <Wrench size={18} />,
};

/** 工作负载分区副导航顺序。replicasets 不在一级(从 Deployment 详情页看)。
 *  Kind ids follow KIND_META (kinds.tsx): the Helm release kind's id is `helm`. */
const WORKLOAD_KINDS: KindId[] = [
  'deployments',
  'statefulsets',
  'daemonsets',
  'jobs',
  'cronjobs',
  'pods',
  'helm',
];

/** 配置与网络分区的副导航分组(组名即 SubNav 的分组标题)。 */
export const SECTION_SUBGROUPS = {
  config: [
    { id: 'config', kinds: ['configmaps', 'secrets'] as KindId[] },
    { id: 'network', kinds: ['services', 'ingresses', 'ingressclasses'] as KindId[] },
    {
      id: 'access',
      kinds: [
        'serviceaccounts',
        'roles',
        'rolebindings',
        'clusterroles',
        'clusterrolebindings',
      ] as KindId[],
    },
    { id: 'cluster', kinds: ['nodes', 'namespaces', 'events'] as KindId[] },
  ],
  storage: [
    {
      id: 'storage',
      kinds: ['persistentvolumeclaims', 'persistentvolumes', 'storageclasses'] as KindId[],
    },
  ],
} as const;

const KIND_TO_SECTION: Record<string, SectionId> = (() => {
  const map: Record<string, SectionId> = {};
  for (const k of WORKLOAD_KINDS) map[k] = 'workloads';
  for (const sg of SECTION_SUBGROUPS.config) for (const k of sg.kinds) map[k] = 'config';
  for (const sg of SECTION_SUBGROUPS.storage) for (const k of sg.kinds) map[k] = 'storage';
  // replicasets 归工作负载(副导航不展示,但 setNav('replicasets') 时分区正确高亮)
  map['replicasets'] = 'workloads';
  return map;
})();

/** kind → 分区。未登记的 kind(如 CRD)默认归 config 分区的「自定义资源」组。 */
export function sectionForKind(kind: KindId): SectionId {
  return KIND_TO_SECTION[kind] ?? 'config';
}

export function kindsForSection(section: SectionId): KindId[] {
  if (section === 'workloads') return [...WORKLOAD_KINDS];
  if (section === 'config') return SECTION_SUBGROUPS.config.flatMap((sg) => [...sg.kinds]);
  if (section === 'storage') return SECTION_SUBGROUPS.storage.flatMap((sg) => [...sg.kinds]);
  return [];
}
