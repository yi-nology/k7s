import { useEffect, useState } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { getProvider } from '../../providers';
import { useTranslation } from '../../hooks/useI18n';
import { useProviderQuery } from '../../hooks/useProviderQuery';
import type { SbomResult, SbomFormat } from '../../providers/types/sbom';
import type { ScannerStatus } from '../../providers/types/scanner';
import { ComponentTable } from './ComponentTable';
import { VulnTable } from './VulnTable';

interface Props {
  onResult: (sbom: SbomResult) => void;
}

export function ImageSBOMTab({ onResult }: Props) {
  const { t } = useTranslation();
  const [imageRef, setImageRef] = useState('');
  const [format, setFormat] = useState<SbomFormat>('cyclonedx');

  // Non-critical scanner indicator; failures are silently ignored.
  const scannerQuery = useProviderQuery<ScannerStatus>({
    query: () => getProvider().scannerStatus(),
    deps: [],
    key: 'scanner:status',
  });
  const scannerInfo = scannerQuery.data ?? null;

  // Generation runs on demand — the token gates the query until the user
  // clicks Generate (and re-runs on every subsequent click).
  const [genToken, setGenToken] = useState(0);
  const genQuery = useProviderQuery<SbomResult>({
    query: () =>
      genToken > 0 && imageRef.trim() ? getProvider().sbomGenerateImage(imageRef, format) : null,
    deps: [genToken],
    ttlMs: 0, // generation results are never served from cache
  });
  const sbom = genQuery.data ?? null;
  const loading = genQuery.loading;
  const error = genQuery.error ?? '';

  // Hand each fresh result to the panel (the history/export buttons use it).
  useEffect(() => {
    if (genQuery.data !== undefined) onResult(genQuery.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genQuery.data]);

  const handleGenerate = () => {
    if (!imageRef.trim()) return;
    setGenToken((tok) => tok + 1);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          value={imageRef}
          onChange={(e) => setImageRef(e.target.value)}
          placeholder={t('sbom.image.placeholder', 'Enter image ref (e.g. nginx:1.25)')}
          style={{
            flex: 1,
            padding: '6px 10px',
            border: '1px solid var(--border)',
            borderRadius: 4,
            background: 'var(--bg-control)',
            color: 'var(--text-primary)',
          }}
          onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
        />
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
          {loading ? <Loader2 size={14} /> : <Search size={14} />}{' '}
          {t('sbom.image.generate', 'Generate')}
        </button>
      </div>

      {scannerInfo && (
        <div
          style={{
            fontSize: 12,
            color: 'var(--text-secondary)',
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--status-ok, #22c55e)',
              display: 'inline-block',
            }}
          />
          <span>
            {t('sbom.scanner.via', 'via')}{' '}
            <strong>{scannerInfo.activeEngine}</strong>
            {scannerInfo.activeEngine !== 'native' && (
              <span style={{ opacity: 0.7 }}>
                {' '}
                ({scannerInfo.engines.find((e) => e.name === scannerInfo.activeEngine)?.pathSource})
              </span>
            )}
          </span>
          <span style={{ opacity: 0.5 }}>·</span>
          <span>
            {t('sbom.scanner.fallback', 'fallback')}:{' '}
            {scannerInfo.engines.map((e) => e.name).join(' → ')}
          </span>
        </div>
      )}

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
            <span>
              {t('sbom.info.tool', 'Tool')}: {sbom.metadata.tool} {sbom.metadata.toolVersion}
            </span>
            <span>
              {t('sbom.info.duration', 'Duration')}:{' '}
              {(sbom.metadata.scanDurationMs / 1000).toFixed(1)}s
            </span>
          </div>
          <ComponentTable components={sbom.components} />
          {sbom.vulnerabilities.length > 0 && <VulnTable vulns={sbom.vulnerabilities} />}
        </div>
      )}
    </div>
  );
}
