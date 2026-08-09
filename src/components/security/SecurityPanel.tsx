/**
 * SecurityPanel — RBAC security audit overlay.
 *
 * Two-pane layout:
 *   Left sidebar: severity filters with counts (Critical / High / Medium / Low / All)
 *   Right main area: findings list with expandable details
 *
 * Header: title + "Run Audit" button + last scan time.
 * Clicking a finding's resource reference navigates to that RBAC resource.
 */
import { useCallback, useMemo, useState } from 'react';
import { formatError, getProvider } from '../../providers';
import { cx } from '../../lib/cx';
import type { AuditFinding, AuditReport } from '../../providers/types/security';
import { useStore } from '../../store';
import type { KindId } from '../../providers/types';
import { useTranslation } from '../../hooks/useI18n';
import styles from './SecurityPanel.module.css';

/** Map the audit's resourceKind string to the store's KindId. */
const RESOURCE_KIND_MAP: Record<string, KindId> = {
  Role: 'roles',
  ClusterRole: 'clusterroles',
  RoleBinding: 'rolebindings',
  ClusterRoleBinding: 'clusterrolebindings',
};

type Severity = 'Critical' | 'High' | 'Medium' | 'Low';

const SEVERITY_ORDER: Severity[] = ['Critical', 'High', 'Medium', 'Low'];

function severityClass(severity: string): string {
  switch (severity) {
    case 'Critical':
      return styles.badgeCritical;
    case 'High':
      return styles.badgeHigh;
    case 'Medium':
      return styles.badgeMedium;
    case 'Low':
      return styles.badgeLow;
    default:
      return styles.badgeAll;
  }
}

export function SecurityPanel({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const jumpTo = useStore((s) => s.jumpTo);

  const [report, setReport] = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<Severity | 'All'>('All');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleRunAudit = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getProvider().securityAudit();
      setReport(result);
    } catch (e: unknown) {
      setError(formatError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const counts = useMemo(() => {
    if (!report) return { Critical: 0, High: 0, Medium: 0, Low: 0 };
    const c: Record<Severity, number> = { Critical: 0, High: 0, Medium: 0, Low: 0 };
    for (const f of report.findings) {
      if (f.severity in c) c[f.severity as Severity]++;
    }
    return c;
  }, [report]);

  const filtered = useMemo(() => {
    if (!report) return [];
    if (severityFilter === 'All') return report.findings;
    return report.findings.filter((f) => f.severity === severityFilter);
  }, [report, severityFilter]);

  const handleResourceClick = useCallback(
    (finding: AuditFinding) => {
      const kindId = RESOURCE_KIND_MAP[finding.resourceKind];
      if (!kindId) return;
      // Build a minimal Row object for jumpTo to select.
      jumpTo(kindId, {
        uid: '',
        name: finding.resourceName,
        namespace: finding.namespace ?? undefined,
        cells: [],
      });
      onClose?.();
    },
    [jumpTo, onClose]
  );

  const lastScanTime = report?.scannedAt ? new Date(report.scannedAt).toLocaleString() : null;

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <h2>{t('security.title', 'Security Audit')}</h2>
        <div className={styles.headerRight}>
          {lastScanTime && (
            <span className={styles.lastScan}>
              {t('security.lastScan', 'Last scan')}: {lastScanTime}
            </span>
          )}
          <button className={styles.btnPrimary} onClick={handleRunAudit} disabled={loading}>
            {loading ? t('security.running', 'Scanning…') : t('security.run', 'Run Audit')}
          </button>
          {onClose && (
            <button className={styles.btn} onClick={onClose}>
              {t('security.close', 'Close')}
            </button>
          )}
        </div>
      </header>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.body}>
        <aside className={styles.side}>
          <div className={styles.sideTitle}>{t('security.filters', 'Filters')}</div>
          <div
            className={cx(styles.severityFilter, severityFilter === 'All' && styles.severityFilterActive)}
            onClick={() => setSeverityFilter('All')}
          >
            <span>{t('security.all', 'All')}</span>
            <span className={`${styles.severityBadge} ${styles.badgeAll}`}>
              {report?.findings.length ?? 0}
            </span>
          </div>
          {SEVERITY_ORDER.map((sev) => {
            const sevLabel = sev === 'Critical' ? t('securityExtra.critical')
              : sev === 'High' ? t('securityExtra.high')
              : sev === 'Medium' ? t('securityExtra.medium')
              : t('securityExtra.low');
            return (
              <div
                key={sev}
                className={cx(styles.severityFilter, severityFilter === sev && styles.severityFilterActive)}
                onClick={() => setSeverityFilter(sev)}
              >
                <span>{sevLabel}</span>
                <span className={`${styles.severityBadge} ${severityClass(sev)}`}>{counts[sev]}</span>
              </div>
            );
          })}
        </aside>
        <main className={styles.main}>
          {loading && (
            <div className={styles.loading}>
              {t('security.scanning', 'Scanning RBAC resources…')}
            </div>
          )}
          {!loading && !report && (
            <div className={styles.empty}>
              {t(
                'security.emptyStart',
                'Click "Run Audit" to scan RBAC resources for security issues.'
              )}
            </div>
          )}
          {!loading && report && filtered.length === 0 && (
            <div className={styles.empty}>
              {t('security.emptyFindings', 'No findings match the selected filter.')}
            </div>
          )}
          {!loading &&
            filtered.map((finding, index) => {
              const uniqueKey = `${finding.resourceKind}-${finding.resourceName}-${finding.id}-${index}`;
              const active = expandedId === uniqueKey;
              return (
                <div
                  key={uniqueKey}
                  className={cx(styles.finding, active && styles.findingActive)}
                  onClick={() => setExpandedId(active ? null : uniqueKey)}
                >
                  <div className={styles.findingHeader}>
                    <span
                      className={`${styles.findingSeverity} ${severityClass(finding.severity)}`}
                    >
                      {finding.severity === 'Critical' ? t('securityExtra.critical')
                        : finding.severity === 'High' ? t('securityExtra.high')
                        : finding.severity === 'Medium' ? t('securityExtra.medium')
                        : finding.severity === 'Low' ? t('securityExtra.low')
                        : finding.severity}
                    </span>
                    <span className={styles.findingMessage}>{finding.message}</span>
                  </div>
                  <div>
                    <span
                      className={styles.findingResource}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleResourceClick(finding);
                      }}
                    >
                      {finding.resourceKind}/{finding.resourceName}
                      {finding.namespace ? ` (${finding.namespace})` : ''}
                    </span>
                  </div>
                  {active && (
                    <div className={styles.findingDetail}>
                      <div>{finding.message}</div>
                      <div className={styles.findingRuleId}>
                        {t('security.ruleId', 'Rule')}: {finding.id}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
        </main>
      </div>
    </div>
  );
}
