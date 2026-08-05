import { useTranslation } from '../../hooks/useI18n';
import type { SbomComponent } from '../../providers/types/sbom';

interface Props {
  components: SbomComponent[];
}

export function ComponentTable({ components }: Props) {
  const { t } = useTranslation();
  return (
    <div style={{ marginBottom: 16 }}>
      <h3 style={{ fontSize: 14, marginBottom: 8 }}>
        {t('sbom.components.title', 'Components')} ({components.length})
      </h3>
      <div style={{ maxHeight: 300, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 4 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--bg-chrome)' }}>
              <th style={{ padding: '6px 12px' }}>{t('sbom.components.name', 'Name')}</th>
              <th style={{ padding: '6px 12px' }}>{t('sbom.components.version', 'Version')}</th>
              <th style={{ padding: '6px 12px' }}>{t('sbom.components.type', 'Type')}</th>
              <th style={{ padding: '6px 12px' }}>{t('sbom.components.licenses', 'Licenses')}</th>
            </tr>
          </thead>
          <tbody>
            {components.map((c, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '6px 12px' }}>{c.name}</td>
                <td style={{ padding: '6px 12px' }}>{c.version}</td>
                <td style={{ padding: '6px 12px' }}>{c.componentType}</td>
                <td style={{ padding: '6px 12px' }}>{c.licenses.join(', ') || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
