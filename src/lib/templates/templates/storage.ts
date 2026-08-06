/**
 * Storage templates: PVC, Namespace.
 */

import type { Template } from '../types';
import { clampInt } from '../helpers';

export const STORAGE_TEMPLATES: Template[] = [
  {
    id: 'pvc',
    kind: 'persistentvolumeclaims',
    title: 'PersistentVolumeClaim',
    description: 'Request a persistent volume of a given size and storage class.',
    params: [
      { key: 'name', label: 'Name', default: 'my-pvc', kind: 'text' },
      {
        key: 'namespace',
        label: 'Namespace',
        default: 'default',
        kind: 'text',
      },
      {
        key: 'storageClass',
        label: 'Storage class',
        default: 'standard',
        kind: 'text',
      },
      {
        key: 'capacity',
        label: 'Capacity (Gi)',
        default: '10',
        kind: 'number',
        min: 1,
        max: 100000,
      },
      {
        key: 'accessMode',
        label: 'Access mode',
        default: 'ReadWriteOnce',
        kind: 'text',
        help: 'ReadWriteOnce, ReadOnlyMany, or ReadWriteMany',
      },
    ],
    render: (v) => {
      const name = v.name || 'my-pvc';
      const ns = v.namespace || 'default';
      const sc = v.storageClass || 'standard';
      const capacity = clampInt(v.capacity, 1, 100000, 10);
      const am = v.accessMode || 'ReadWriteOnce';
      return [
        `apiVersion: v1`,
        `kind: PersistentVolumeClaim`,
        `metadata:`,
        `  name: ${name}`,
        `  namespace: ${ns}`,
        `spec:`,
        `  storageClassName: ${sc}`,
        `  accessModes:`,
        `  - ${am}`,
        `  resources:`,
        `    requests:`,
        `      storage: ${capacity}Gi`,
      ].join('\n');
    },
  },
  {
    id: 'namespace',
    kind: 'namespaces',
    title: 'Namespace',
    description: 'Create a new namespace.',
    params: [{ key: 'name', label: 'Name', default: 'my-namespace', kind: 'text' }],
    render: (v) => {
      const name = v.name || 'my-namespace';
      return [`apiVersion: v1`, `kind: Namespace`, `metadata:`, `  name: ${name}`].join('\n');
    },
  },
];
