import { useState, useEffect, useCallback } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { formatError, getProvider } from '../../providers';
import { useTranslation } from '../../hooks/useI18n';
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sbom, setSbom] = useState<SbomResult | null>(null);
  const [scannerInfo, setScannerInfo] = useState<ScannerStatus | null>(null);

  const fetchScanner = useCallback(async () => {
    try {
      setScannerInfo(await getProvider().scannerStatus());
    } catch {
      // Non-critical; just don't show the indicator.
    }
  }, []);

  useEffect(() => {
    void fetchScanner();
  }, [fetchScanner]);

  const handleGenerate = async () => {
    if (!imageRef.trim()) return;
    setLoading(true);
    setError('');
    try {
      const result = await getProvider().sbomGenerateImage(imageRef, format);
      setSbom(result);
      onResult(result);
    } catch (e: unknown) {
      setError(formatError(e));
    } finally {
      setLoading(false);
    }
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
