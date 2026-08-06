import { useTranslation } from '../../hooks/useI18n';
import type { SbomVulnerability } from '../../providers/types/sbom';

interface Props {
  vulns: SbomVulnerability[];
}

const severityColor: Record<string, string> = {
  critical: 'var(--status-err, #dc2626)',
  high: '#ea580c',
  medium: 'var(--status-warn, #ca8a04)',
  low: '#65a30d',
};

export function VulnTable({ vulns }: Props) {
  const { t } = useTranslation();
  return (
    <div>
      <h3 style={{ fontSize: 14, marginBottom: 8 }}>
        {t('sbom.vulns.title', 'Vulnerabilities')} ({vulns.length})
      </h3>
      <div
        style={{
          maxHeight: 200,
          overflow: 'auto',
          border: '1px solid var(--border)',
          borderRadius: 4,
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr
              style={{
                textAlign: 'left',
                borderBottom: '1px solid var(--border)',
                position: 'sticky',
                top: 0,
                background: 'var(--bg-chrome)',
              }}
            >
              <th style={{ padding: '6px 12px' }}>{t('sbom.vulns.id', 'ID')}</th>
              <th style={{ padding: '6px 12px' }}>{t('sbom.vulns.severity', 'Severity')}</th>
              <th style={{ padding: '6px 12px' }}>{t('sbom.vulns.component', 'Component')}</th>
              <th style={{ padding: '6px 12px' }}>{t('sbom.vulns.fix', 'Fix')}</th>
            </tr>
          </thead>
          <tbody>
            {vulns.map((v) => (
              <tr key={v.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '6px 12px' }}>{v.id}</td>
                <td style={{ padding: '6px 12px' }}>
                  <span style={{ color: severityColor[v.severity] || 'inherit', fontWeight: 600 }}>
                    {v.severity.toUpperCase()}
                  </span>
                </td>
                <td style={{ padding: '6px 12px' }}>{v.affectedComponents.join(', ')}</td>
                <td style={{ padding: '6px 12px' }}>{v.fixedVersion || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
