/**
 * Config templates: ConfigMap, Secret, ResourceQuota, LimitRange.
 */

import type { Template } from '../types';
import { clampInt } from '../helpers';

export const CONFIG_TEMPLATES: Template[] = [
  {
    id: 'configmap',
    kind: 'configmaps',
    title: 'ConfigMap',
    description: 'ConfigMap with two key-value pairs.',
    params: [
      { key: 'name', label: 'Name', default: 'my-config', kind: 'text' },
      {
        key: 'namespace',
        label: 'Namespace',
        default: 'default',
        kind: 'text',
      },
      { key: 'key1', label: 'Key 1', default: 'log.level', kind: 'text' },
      { key: 'value1', label: 'Value 1', default: 'info', kind: 'text' },
      { key: 'key2', label: 'Key 2', default: 'feature.flag', kind: 'text' },
      {
        key: 'value2',
        label: 'Value 2',
        default: 'true',
        kind: 'text',
      },
    ],
    render: (v) => {
      const name = v.name || 'my-config';
      const ns = v.namespace || 'default';
      const k1 = v.key1 || 'log.level';
      const v1 = v.value1 || 'info';
      const k2 = v.key2 || 'feature.flag';
      const v2 = v.value2 || 'true';
      return [
        `apiVersion: v1`,
        `kind: ConfigMap`,
        `metadata:`,
        `  name: ${name}`,
        `  namespace: ${ns}`,
        `data:`,
        `  ${k1}: ${v1}`,
        `  ${k2}: ${v2}`,
      ].join('\n');
    },
  },
  {
    id: 'secret',
    kind: 'secrets',
    title: 'Secret (Opaque)',
    description: 'Opaque Secret with two key/value pairs.',
    params: [
      { key: 'name', label: 'Name', default: 'my-secret', kind: 'text' },
      {
        key: 'namespace',
        label: 'Namespace',
        default: 'default',
        kind: 'text',
      },
      { key: 'key1', label: 'Key 1', default: 'username', kind: 'text' },
      {
        key: 'value1',
        label: 'Value 1',
        default: 'admin',
        kind: 'text',
        help: 'Stored verbatim — this template is for non-sensitive test data. Production secrets should be set via the YAML editor or an external operator.',
      },
      { key: 'key2', label: 'Key 2', default: 'password', kind: 'text' },
      {
        key: 'value2',
        label: 'Value 2',
        default: 'changeme',
        kind: 'text',
      },
    ],
    render: (v) => {
      const name = v.name || 'my-secret';
      const ns = v.namespace || 'default';
      const k1 = v.key1 || 'username';
      const v1 = v.value1 || 'admin';
      const k2 = v.key2 || 'password';
      const v2 = v.value2 || 'changeme';
      // Opaque is the catch-all type; the YAML editor is the right tool for
      // kubernetes.io/tls, dockerconfigjson, and the rest. The form's help
      // text steers users away from treating the rendered YAML as production
      // credentials.
      return [
        `apiVersion: v1`,
        `kind: Secret`,
        `metadata:`,
        `  name: ${name}`,
        `  namespace: ${ns}`,
        `type: Opaque`,
        `stringData:`,
        `  ${k1}: ${v1}`,
        `  ${k2}: ${v2}`,
      ].join('\n');
    },
  },
  {
    id: 'resourcequota',
    kind: 'resourcequotas',
    title: 'ResourceQuota',
    description: 'Limit total CPU, memory, and pod count in a namespace.',
    params: [
      { key: 'name', label: 'Name', default: 'my-quota', kind: 'text' },
      {
        key: 'namespace',
        label: 'Namespace',
        default: 'default',
        kind: 'text',
      },
      {
        key: 'cpuLimit',
        label: 'CPU limit',
        default: '4',
        kind: 'text',
        help: 'e.g. 4 or 2000m',
      },
      {
        key: 'memoryLimit',
        label: 'Memory limit',
        default: '8Gi',
        kind: 'text',
        help: 'e.g. 8Gi or 8192Mi',
      },
      {
        key: 'podCount',
        label: 'Pod count',
        default: '20',
        kind: 'number',
        min: 1,
        max: 10000,
      },
    ],
    render: (v) => {
      const name = v.name || 'my-quota';
      const ns = v.namespace || 'default';
      const cpu = v.cpuLimit || '4';
      const mem = v.memoryLimit || '8Gi';
      const pods = clampInt(v.podCount, 1, 10000, 20);
      return [
        `apiVersion: v1`,
        `kind: ResourceQuota`,
        `metadata:`,
        `  name: ${name}`,
        `  namespace: ${ns}`,
        `spec:`,
        `  hard:`,
        `    requests.cpu: ${cpu}`,
        `    requests.memory: ${mem}`,
        `    limits.cpu: ${cpu}`,
        `    limits.memory: ${mem}`,
        `    pods: ${pods}`,
      ].join('\n');
    },
  },
  {
    id: 'limitrange',
    kind: 'limitranges',
    title: 'LimitRange',
    description: 'Default CPU/memory requests and limits for pods in a namespace.',
    params: [
      { key: 'name', label: 'Name', default: 'my-limitrange', kind: 'text' },
      {
        key: 'namespace',
        label: 'Namespace',
        default: 'default',
        kind: 'text',
      },
      {
        key: 'defaultCpu',
        label: 'Default CPU limit',
        default: '200m',
        kind: 'text',
      },
      {
        key: 'defaultMem',
        label: 'Default memory limit',
        default: '256Mi',
        kind: 'text',
      },
      {
        key: 'defaultRequestCpu',
        label: 'Default CPU request',
        default: '100m',
        kind: 'text',
      },
      {
        key: 'defaultRequestMem',
        label: 'Default memory request',
        default: '128Mi',
        kind: 'text',
      },
    ],
    render: (v) => {
      const name = v.name || 'my-limitrange';
      const ns = v.namespace || 'default';
      const defaultCpu = v.defaultCpu || '200m';
      const defaultMem = v.defaultMem || '256Mi';
      const defaultRequestCpu = v.defaultRequestCpu || '100m';
      const defaultRequestMem = v.defaultRequestMem || '128Mi';
      return [
        `apiVersion: v1`,
        `kind: LimitRange`,
        `metadata:`,
        `  name: ${name}`,
        `  namespace: ${ns}`,
        `spec:`,
        `  limits:`,
        `  - default:`,
        `      cpu: ${defaultCpu}`,
        `      memory: ${defaultMem}`,
        `    defaultRequest:`,
        `      cpu: ${defaultRequestCpu}`,
        `      memory: ${defaultRequestMem}`,
        `    type: Container`,
      ].join('\n');
    },
  },
];
