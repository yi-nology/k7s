/**
 * Cluster health scoring module.
 *
 * Computes a 0-100 health score from live cluster data: node readiness,
 * pod status, deployment availability, resource pressure, and recent
 * warning events. The dashboard renders this as a graded card with an
 * expandable check list.
 */

import type { Row, NodeMetricsMap } from '../providers/types';

export interface HealthCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
}

export interface HealthScore {
  score: number; // 0-100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  checks: HealthCheck[];
}

/**
 * Calculate a cluster health score from the current live data.
 *
 * Each check produces a pass/warn/fail verdict. The final score is the
 * percentage of passing checks, mapped to a letter grade.
 */
export function calculateHealth(
  nodes: Row[],
  pods: Row[],
  deployments: Row[],
  events: Row[],
  nodeMetrics: NodeMetricsMap,
  pvcs: Row[] = [],
  _hpas: Row[] = [],
  cronjobs: Row[] = [],
  daemonsets: Row[] = []
): HealthScore {
  const checks: HealthCheck[] = [];

  // --- Check 1: Node readiness ---
  if (nodes.length > 0) {
    const readyNodes = nodes.filter((n) => n.cells[1]?.text?.includes('Ready'));
    checks.push({
      name: 'Node Readiness',
      status:
        readyNodes.length === nodes.length
          ? 'pass'
          : readyNodes.length >= nodes.length * 0.5
            ? 'warn'
            : 'fail',
      message: `${readyNodes.length}/${nodes.length} nodes ready`,
    });
  }

  // --- Check 2: Pod health ---
  if (pods.length > 0) {
    const runningPods = pods.filter((p) => p.pod?.status === 'Running');
    const failedPods = pods.filter((p) => p.pod?.statusTone === 'err');
    checks.push({
      name: 'Pod Health',
      status: failedPods.length === 0 ? 'pass' : failedPods.length > 3 ? 'fail' : 'warn',
      message: `${runningPods.length} running, ${failedPods.length} failed`,
    });
  }

  // --- Check 3: Deployment availability ---
  if (deployments.length > 0) {
    const available = deployments.filter((d) => {
      const ready = d.cells[1]?.text ?? '';
      const [current, desired] = ready.split('/');
      return current === desired && current !== '0';
    });
    checks.push({
      name: 'Deployment Availability',
      status:
        available.length === deployments.length
          ? 'pass'
          : available.length >= deployments.length * 0.7
            ? 'warn'
            : 'fail',
      message: `${available.length}/${deployments.length} fully available`,
    });
  }

  // --- Check 4: Node resource pressure (CPU/MEM > 85%) ---
  const metrics = Object.values(nodeMetrics);
  if (metrics.length > 0) {
    const highCpu = metrics.filter((n) => n.cpuPercent > 85).length;
    const highMem = metrics.filter((n) => n.memPercent > 85).length;
    const pressureNodes = new Set([
      ...metrics.map((n, i) => (n.cpuPercent > 85 ? i : -1)).filter((i) => i >= 0),
      ...metrics.map((n, i) => (n.memPercent > 85 ? i : -1)).filter((i) => i >= 0),
    ]).size;
    checks.push({
      name: 'Resource Pressure',
      status:
        pressureNodes === 0 ? 'pass' : pressureNodes <= metrics.length * 0.3 ? 'warn' : 'fail',
      message:
        pressureNodes === 0 ? 'All nodes below 85%' : `${highCpu} high CPU, ${highMem} high memory`,
    });
  }

  // --- Check 5: Recent warning events ---
  if (events.length > 0) {
    const warnings = events.filter((e) => (e.cells[0]?.text ?? '') === 'Warning');
    checks.push({
      name: 'Warning Events',
      status: warnings.length === 0 ? 'pass' : warnings.length > 10 ? 'fail' : 'warn',
      message: `${warnings.length} warning${warnings.length !== 1 ? 's' : ''} in recent events`,
    });
  }

  // --- Check 6: PVC status ---
  if (pvcs.length > 0) {
    // STATUS column is at index 2 for PVCs (NAME, NAMESPACE, STATUS, ...)
    const pendingOrFailed = pvcs.filter((p) => {
      const status = (p.cells[2]?.text ?? '').toLowerCase();
      return status === 'pending' || status === 'lost' || status === 'failed';
    });
    checks.push({
      name: 'PVC Status',
      status: pendingOrFailed.length === 0 ? 'pass' : pendingOrFailed.length <= 2 ? 'warn' : 'fail',
      message:
        pendingOrFailed.length === 0
          ? 'All PVCs bound'
          : `${pendingOrFailed.length} PVC${pendingOrFailed.length !== 1 ? 's' : ''} not bound`,
    });
  }

  // --- Check 7: Node disk pressure ---
  if (nodes.length > 0) {
    // Check for DiskPressure condition in the STATUS column text
    const diskPressure = nodes.filter((n) => {
      const status = (n.cells[1]?.text ?? '').toLowerCase();
      return status.includes('diskpressure');
    });
    checks.push({
      name: 'Disk Pressure',
      status: diskPressure.length === 0 ? 'pass' : diskPressure.length === 1 ? 'warn' : 'fail',
      message:
        diskPressure.length === 0
          ? 'No disk pressure'
          : `${diskPressure.length} node${diskPressure.length !== 1 ? 's' : ''} under disk pressure`,
    });
  }

  // --- Check 8: DaemonSet coverage ---
  if (daemonsets.length > 0) {
    // Columns: NAME, NAMESPACE, DESIRED, READY, CPU, MEM, AGE
    // DESIRED is index 2, READY is index 3
    const incomplete = daemonsets.filter((ds) => {
      const desired = parseInt(ds.cells[2]?.text ?? '0', 10);
      const ready = parseInt(ds.cells[3]?.text ?? '0', 10);
      return desired > 0 && ready < desired;
    });
    checks.push({
      name: 'DaemonSet Coverage',
      status: incomplete.length === 0 ? 'pass' : incomplete.length === 1 ? 'warn' : 'fail',
      message:
        incomplete.length === 0
          ? 'All DaemonSets fully covered'
          : `${incomplete.length} DaemonSet${incomplete.length !== 1 ? 's' : ''} with missing pods`,
    });
  }

  // --- Check 9: CronJob health ---
  if (cronjobs.length > 0) {
    // Check for failed CronJobs — look for "Failed" or error tone in LAST RUN column
    // CronJob columns: NAME, NAMESPACE, SCHEDULE, LAST RUN, AGE
    // We check if there are jobs with "Failed" status visible
    const failedCronjobs = cronjobs.filter((cj) => {
      const lastRun = (cj.cells[3]?.text ?? '').toLowerCase();
      return lastRun.includes('failed') || lastRun.includes('error');
    });
    checks.push({
      name: 'CronJob Health',
      status: failedCronjobs.length === 0 ? 'pass' : failedCronjobs.length <= 2 ? 'warn' : 'fail',
      message:
        failedCronjobs.length === 0
          ? 'All CronJobs healthy'
          : `${failedCronjobs.length} CronJob${failedCronjobs.length !== 1 ? 's' : ''} with failures`,
    });
  }

  // If no data is available yet, return a neutral state.
  if (checks.length === 0) {
    return { score: 0, grade: 'F', checks: [] };
  }

  // Weighted scoring: critical checks matter more than informational ones.
  const weights: Record<string, number> = {
    'Node Readiness': 3,
    'Pod Health': 2,
    'Deployment Availability': 2,
    'Resource Pressure': 2,
    'Warning Events': 1,
    'PVC Status': 2,
    'Disk Pressure': 2,
    'DaemonSet Coverage': 1,
    'CronJob Health': 1,
  };
  let totalWeight = 0;
  let weightedPass = 0;
  for (const check of checks) {
    const w = weights[check.name] ?? 1;
    totalWeight += w;
    if (check.status === 'pass') weightedPass += w;
    else if (check.status === 'warn') weightedPass += w * 0.5;
  }
  const score = Math.round((weightedPass / totalWeight) * 100);
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';

  return { score, grade, checks };
}

/**
 * Map a health grade to a CSS color variable.
 *
 * @param grade - The letter grade (A-F).
 * @returns A CSS `var(...)` string for the corresponding status color.
 */
export function gradeColor(grade: HealthScore['grade']): string {
  switch (grade) {
    case 'A':
      return 'var(--status-ok)';
    case 'B':
      return '#5cc8ff';
    case 'C':
      return 'var(--status-warn)';
    case 'D':
      return '#fb923c';
    case 'F':
      return 'var(--status-err)';
  }
}
