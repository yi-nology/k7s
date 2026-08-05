/**
 * Workload templates: Deployment, StatefulSet, DaemonSet, Job, CronJob.
 */

import type { Template } from '../types';
import { clampInt, labelsBlock, resourcesRequestsBlock } from '../helpers';

export const WORKLOAD_TEMPLATES: Template[] = [
  {
    id: 'deployment',
    kind: 'deployments',
    title: 'Deployment',
    description: 'Single-container Deployment with a Service (ClusterIP).',
    params: [
      { key: 'name', label: 'Name', default: 'my-app', kind: 'text' },
      {
        key: 'image',
        label: 'Image',
        default: 'nginx:1.25',
        kind: 'text',
        help: 'registry/repo:tag',
      },
      {
        key: 'replicas',
        label: 'Replicas',
        default: '1',
        kind: 'number',
        min: 1,
        max: 100,
      },
      {
        key: 'port',
        label: 'Container port',
        default: '80',
        kind: 'number',
        min: 1,
        max: 65535,
      },
      {
        key: 'namespace',
        label: 'Namespace',
        default: 'default',
        kind: 'text',
      },
    ],
    extras: {
      labels: { default: { app: 'my-app' } },
      resources: { default: { cpu: '100m', memory: '128Mi' } },
    },
    render: (v) => {
      const name = v.name || 'my-app';
      const image = v.image || 'nginx:1.25';
      const replicas = clampInt(v.replicas, 1, 100, 1);
      const port = clampInt(v.port, 1, 65535, 80);
      const ns = v.namespace || 'default';
      const podLabels = labelsBlock(v.labels, 8) || `        app: ${name}`;
      const containerRes = resourcesRequestsBlock(v.resources, 8);
      return [
        `apiVersion: apps/v1`,
        `kind: Deployment`,
        `metadata:`,
        `  name: ${name}`,
        `  namespace: ${ns}`,
        `spec:`,
        `  replicas: ${replicas}`,
        `  selector:`,
        `    matchLabels:`,
        `      app: ${name}`,
        `  template:`,
        `    metadata:`,
        `      labels:`,
        podLabels,
        `    spec:`,
        `      containers:`,
        `      - name: ${name}`,
        `        image: ${image}`,
        ...(containerRes ? containerRes.split('\n') : []),
        `        ports:`,
        `        - containerPort: ${port}`,
        `---`,
        `apiVersion: v1`,
        `kind: Service`,
        `metadata:`,
        `  name: ${name}`,
        `  namespace: ${ns}`,
        `spec:`,
        `  type: ClusterIP`,
        `  selector:`,
        `    app: ${name}`,
        `  ports:`,
        `  - port: ${port}`,
        `    targetPort: ${port}`,
      ].join('\n');
    },
  },
  {
    id: 'statefulset',
    kind: 'statefulsets',
    title: 'StatefulSet',
    description: 'Single-container StatefulSet with a headless Service.',
    params: [
      { key: 'name', label: 'Name', default: 'my-app', kind: 'text' },
      {
        key: 'image',
        label: 'Image',
        default: 'nginx:1.25',
        kind: 'text',
        help: 'registry/repo:tag',
      },
      {
        key: 'replicas',
        label: 'Replicas',
        default: '3',
        kind: 'number',
        min: 1,
        max: 100,
      },
      {
        key: 'port',
        label: 'Container port',
        default: '80',
        kind: 'number',
        min: 1,
        max: 65535,
      },
      {
        key: 'namespace',
        label: 'Namespace',
        default: 'default',
        kind: 'text',
      },
    ],
    extras: {
      labels: { default: { app: 'my-app' } },
      resources: { default: { cpu: '100m', memory: '128Mi' } },
    },
    render: (v) => {
      const name = v.name || 'my-app';
      const image = v.image || 'nginx:1.25';
      const replicas = clampInt(v.replicas, 1, 100, 3);
      const port = clampInt(v.port, 1, 65535, 80);
      const ns = v.namespace || 'default';
      const podLabels = labelsBlock(v.labels, 8) || `        app: ${name}`;
      const containerRes = resourcesRequestsBlock(v.resources, 8);
      return [
        `apiVersion: v1`,
        `kind: Service`,
        `metadata:`,
        `  name: ${name}`,
        `  namespace: ${ns}`,
        `spec:`,
        `  clusterIP: None`,
        `  selector:`,
        `    app: ${name}`,
        `  ports:`,
        `  - port: ${port}`,
        `    targetPort: ${port}`,
        `---`,
        `apiVersion: apps/v1`,
        `kind: StatefulSet`,
        `metadata:`,
        `  name: ${name}`,
        `  namespace: ${ns}`,
        `spec:`,
        `  serviceName: ${name}`,
        `  replicas: ${replicas}`,
        `  selector:`,
        `    matchLabels:`,
        `      app: ${name}`,
        `  template:`,
        `    metadata:`,
        `      labels:`,
        podLabels,
        `    spec:`,
        `      containers:`,
        `      - name: ${name}`,
        `        image: ${image}`,
        ...(containerRes ? containerRes.split('\n') : []),
        `        ports:`,
        `        - containerPort: ${port}`,
      ].join('\n');
    },
  },
  {
    id: 'daemonset',
    kind: 'daemonsets',
    title: 'DaemonSet',
    description: 'One pod per node, e.g. a node-level log shipper.',
    params: [
      { key: 'name', label: 'Name', default: 'my-agent', kind: 'text' },
      {
        key: 'image',
        label: 'Image',
        default: 'fluentd:1.16',
        kind: 'text',
        help: 'registry/repo:tag',
      },
      {
        key: 'port',
        label: 'Container port',
        default: '24224',
        kind: 'number',
        min: 1,
        max: 65535,
      },
      {
        key: 'namespace',
        label: 'Namespace',
        default: 'kube-system',
        kind: 'text',
      },
    ],
    extras: {
      labels: { default: { app: 'my-agent' } },
      resources: { default: { cpu: '50m', memory: '64Mi' } },
    },
    render: (v) => {
      const name = v.name || 'my-agent';
      const image = v.image || 'fluentd:1.16';
      const port = clampInt(v.port, 1, 65535, 24224);
      const ns = v.namespace || 'kube-system';
      const podLabels = labelsBlock(v.labels, 8) || `        app: ${name}`;
      const containerRes = resourcesRequestsBlock(v.resources, 8);
      return [
        `apiVersion: apps/v1`,
        `kind: DaemonSet`,
        `metadata:`,
        `  name: ${name}`,
        `  namespace: ${ns}`,
        `  labels:`,
        `    app: ${name}`,
        `spec:`,
        `  selector:`,
        `    matchLabels:`,
        `      app: ${name}`,
        `  template:`,
        `    metadata:`,
        `      labels:`,
        podLabels,
        `    spec:`,
        `      containers:`,
        `      - name: ${name}`,
        `        image: ${image}`,
        ...(containerRes ? containerRes.split('\n') : []),
        `        ports:`,
        `        - containerPort: ${port}`,
      ].join('\n');
    },
  },
  {
    id: 'job',
    kind: 'jobs',
    title: 'Job',
    description: 'Run-to-completion workload, e.g. a one-shot batch task.',
    params: [
      { key: 'name', label: 'Name', default: 'my-job', kind: 'text' },
      {
        key: 'image',
        label: 'Image',
        default: 'busybox:1.36',
        kind: 'text',
        help: 'registry/repo:tag',
      },
      {
        key: 'completions',
        label: 'Completions',
        default: '1',
        kind: 'number',
        min: 1,
        max: 1000,
      },
      {
        key: 'namespace',
        label: 'Namespace',
        default: 'default',
        kind: 'text',
      },
    ],
    extras: {
      labels: { default: { app: 'my-job' } },
      resources: { default: { cpu: '100m', memory: '128Mi' } },
    },
    render: (v) => {
      const name = v.name || 'my-job';
      const image = v.image || 'busybox:1.36';
      const completions = clampInt(v.completions, 1, 1000, 1);
      const ns = v.namespace || 'default';
      const containerRes = resourcesRequestsBlock(v.resources, 8);
      return [
        `apiVersion: batch/v1`,
        `kind: Job`,
        `metadata:`,
        `  name: ${name}`,
        `  namespace: ${ns}`,
        `spec:`,
        `  completions: ${completions}`,
        `  template:`,
        `    metadata:`,
        `      labels:`,
        `        app: ${name}`,
        `    spec:`,
        `      restartPolicy: OnFailure`,
        `      containers:`,
        `      - name: ${name}`,
        `        image: ${image}`,
        ...(containerRes ? containerRes.split('\n') : []),
      ].join('\n');
    },
  },
  {
    id: 'cronjob',
    kind: 'cronjobs',
    title: 'CronJob',
    description: 'Scheduled Job, e.g. a nightly cleanup.',
    params: [
      { key: 'name', label: 'Name', default: 'my-cron', kind: 'text' },
      {
        key: 'image',
        label: 'Image',
        default: 'busybox:1.36',
        kind: 'text',
        help: 'registry/repo:tag',
      },
      {
        key: 'schedule',
        label: 'Schedule',
        default: '0 * * * *',
        kind: 'text',
        help: 'Standard 5-field cron expression (minute hour day month dow).',
        pattern: '^\\S+\\s+\\S+\\s+\\S+\\s+\\S+\\s+\\S+$',
      },
      {
        key: 'namespace',
        label: 'Namespace',
        default: 'default',
        kind: 'text',
      },
    ],
    extras: {
      labels: { default: { app: 'my-cron' } },
      resources: { default: { cpu: '100m', memory: '128Mi' } },
    },
    render: (v) => {
      const name = v.name || 'my-cron';
      const image = v.image || 'busybox:1.36';
      const schedule = v.schedule || '0 * * * *';
      const ns = v.namespace || 'default';
      const containerRes = resourcesRequestsBlock(v.resources, 10);
      return [
        `apiVersion: batch/v1`,
        `kind: CronJob`,
        `metadata:`,
        `  name: ${name}`,
        `  namespace: ${ns}`,
        `spec:`,
        `  schedule: "${schedule}"`,
        `  jobTemplate:`,
        `    spec:`,
        `      template:`,
        `        metadata:`,
        `          labels:`,
        `            app: ${name}`,
        `        spec:`,
        `          restartPolicy: OnFailure`,
        `          containers:`,
        `          - name: ${name}`,
        `            image: ${image}`,
        ...(containerRes ? containerRes.split('\n') : []),
      ].join('\n');
    },
  },
];
