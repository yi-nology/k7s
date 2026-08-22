import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { getProvider } from '../../providers';
import { useTranslation } from '../../hooks/useI18n';
import { useProviderQuery } from '../../hooks/useProviderQuery';
import type { SbomResult, SbomFormat } from '../../providers/types/sbom';
import { ComponentTable } from './ComponentTable';
import { VulnTable } from './VulnTable';

interface Props {
  onResult: (sbom: SbomResult) => void;
}

export function ClusterSBOMTab({ onResult }: Props) {
  const { t } = useTranslation();
  const [format, setFormat] = useState<SbomFormat>('cyclonedx');

  // The scan runs on demand — the token gates the query until the user
  // clicks "Scan Cluster" (and re-runs on every subsequent click).
  const [scanToken, setScanToken] = useState(0);
  const scanQuery = useProviderQuery<SbomResult>({
    query: () => (scanToken > 0 ? getProvider().sbomGenerateCluster(format) : null),
    deps: [scanToken],
    ttlMs: 0, // scan results are never served from cache
  });
  const sbom = scanQuery.data ?? null;
  const loading = scanQuery.loading;
  const error = scanQuery.error ?? '';

  // Hand each fresh result to the panel (the history/export buttons use it).
  useEffect(() => {
    if (scanQuery.data !== undefined) onResult(scanQuery.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanQuery.data]);

  const handleGenerate = () => setScanToken((tok) => tok + 1);

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <select
          value={format}
          onChange={(e) => setFormat(e.target.value as SbomFormat)}
          style={{
            padding: '6px 10px',
            border: '1px solid var(--border)',
            borderRadius: 4,
            background: 'var(--bg-control)',
            color: 'var(--text-primary)',
          }}
        >
          <option value="cyclonedx">CycloneDX</option>
          <option value="spdx">SPDX</option>
        </select>
        <button
          onClick={handleGenerate}
          disabled={loading}
          style={{
            padding: '6px 12px',
            border: 'none',
            borderRadius: 4,
            background: 'var(--accent)',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          {loading ? <Loader2 size={14} /> : null}
          {t('sbom.cluster.scan', 'Scan Cluster')}
        </button>
      </div>

      {error && (
        <div
          style={{
            padding: 8,
            background: 'var(--status-err-soft, #fef2f2)',
            color: 'var(--status-err, #dc2626)',
            borderRadius: 4,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {sbom && (
        <div>
          <div
            style={{
              display: 'flex',
              gap: 16,
              marginBottom: 16,
              fontSize: 13,
              color: 'var(--text-secondary)',
            }}
          >
            <span>
              {t('sbom.info.components', 'Components')}: {sbom.components.length}
            </span>
            <span>
              {t('sbom.info.vulns', 'Vulnerabilities')}: {sbom.vulnerabilities.length}
            </span>
          </div>
          <ComponentTable components={sbom.components} />
          {sbom.vulnerabilities.length > 0 && <VulnTable vulns={sbom.vulnerabilities} />}
        </div>
      )}
    </div>
  );
}
