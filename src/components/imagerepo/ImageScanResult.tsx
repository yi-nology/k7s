/**
 * ImageScanResult — displays vulnerability scan results for a container image.
 *
 * Shows a summary with severity counts, a sortable vulnerability table,
 * and expandable rows for detailed descriptions and references.
 */
import { useState } from 'react';
import type { ScanResult, Vulnerability } from '../../providers/types';
import { useTranslation } from '../../hooks/useI18n';
import styles from './ImageScanResult.module.css';

interface ImageScanResultProps {
  result: ScanResult;
  onClose: () => void;
}

export function ImageScanResult({ result, onClose }: ImageScanResultProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<string | null>(null);

  const severityBadgeClass = (sev: string): string => {
    switch (sev.toUpperCase()) {
      case 'CRITICAL': return styles.severityCritical;
      case 'HIGH': return styles.severityHigh;
      case 'MEDIUM': return styles.severityMedium;
      case 'LOW': return styles.severityLow;
      default: return '';
    }
  };

  const { summary, vulnerabilities } = result;

  return (
    <div className={styles.scanResult}>
      <div className={styles.scanResultHeader}>
        <h3 className={styles.scanResultTitle}>
          {t('image.scan.title', 'Vulnerability Scan')}
        </h3>
        <button className={styles.closeBtn} onClick={onClose} title={t('image.scan.close', 'Close')}>
          {t('image.close', 'Close')}
        </button>
      </div>

      {/* Header: engine + target + time */}
      <div className={styles.header}>
        <span className={styles.engineBadge}>{result.engine}</span>
        <span className={styles.target}>{result.target}</span>
        <span className={styles.scannedAt}>
          {new Date(result.scannedAt).toLocaleString()}
        </span>
      </div>

      {/* Summary cards */}
      <div className={styles.summary}>
        <div className={`${styles.summaryCard} ${styles.severityCritical}`}>
          <div className={styles.count}>{summary.critical}</div>
          <div className={styles.label}>{t('image.severity.critical', 'Critical')}</div>
        </div>
        <div className={`${styles.summaryCard} ${styles.severityHigh}`}>
          <div className={styles.count}>{summary.high}</div>
          <div className={styles.label}>{t('image.severity.high', 'High')}</div>
        </div>
        <div className={`${styles.summaryCard} ${styles.severityMedium}`}>
          <div className={styles.count}>{summary.medium}</div>
          <div className={styles.label}>{t('image.severity.medium', 'Medium')}</div>
        </div>
        <div className={`${styles.summaryCard} ${styles.severityLow}`}>
          <div className={styles.count}>{summary.low}</div>
          <div className={styles.label}>{t('image.severity.low', 'Low')}</div>
        </div>
      </div>

      {/* Vulnerability table or empty state */}
      {vulnerabilities.length === 0 ? (
        <div className={styles.empty}>
          {t('image.scan.noVulns', 'No vulnerabilities found.')}
        </div>
      ) : (
        <table className={styles.vulnTable}>
          <thead>
            <tr>
              <th>{t('image.scan.severity', 'Severity')}</th>
              <th>{t('image.scan.cveId', 'CVE ID')}</th>
              <th>{t('image.scan.package', 'Package')}</th>
              <th>{t('image.scan.installed', 'Installed')}</th>
              <th>{t('image.scan.fixed', 'Fixed')}</th>
              <th>{t('image.scan.titleCol', 'Title')}</th>
            </tr>
          </thead>
          <tbody>
            {vulnerabilities.map((vuln: Vulnerability) => {
              const isExpanded = expanded === vuln.id;
              return (
                <>
                  <tr
                    key={vuln.id}
                    className={styles.vulnRow}
                    onClick={() => setExpanded(isExpanded ? null : vuln.id)}
                  >
                    <td>
                      <span className={`${styles.engineBadge} ${severityBadgeClass(vuln.severity)}`}>
                        {vuln.severity}
                      </span>
                    </td>
                    <td className={styles.target}>{vuln.id}</td>
                    <td>{vuln.pkgName}</td>
                    <td>{vuln.installedVersion}</td>
                    <td>{vuln.fixedVersion ?? '-'}</td>
                    <td>{vuln.title}</td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${vuln.id}-detail`} className={styles.vulnDetail}>
                      <td colSpan={6}>
                        {vuln.description && (
                          <p className={styles.description}>{vuln.description}</p>
                        )}
                        {vuln.references.length > 0 && (
                          <ul className={styles.references}>
                            {vuln.references.map((ref: string) => (
                              <li key={ref}>
                                <a href={ref} target="_blank" rel="noopener noreferrer">
                                  {ref}
                                </a>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
