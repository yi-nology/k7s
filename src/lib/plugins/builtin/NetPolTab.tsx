/**
 * The "Network Policies" detail-tab component for the netpol-viewer plugin.
 *
 * Extracted from builtin.tsx so that file only exports plugin definitions
 * (react-refresh). This is a lightweight stub — a production version would
 * fetch policies from the backend for the selected pod/namespace.
 */

export function NetPolTab({ row }: { row: unknown }) {
  // Placeholder: a real version would fetch policies from the store or provider.
  const r = row as { namespace?: string; name?: string } | undefined;
  return (
    <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: '13px' }}>
      {`Network policies for ${r?.namespace ?? 'cluster'}/${r?.name ?? '?'}: (stub — install the backend plugin to list policies).`}
    </div>
  );
}
