/**
 * Tests for VulnTable — SBOM vulnerability list table.
 *
 * Covers: rendering vulnerability list, severity labels, package/component info,
 * fix version, severity styling, empty state.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { VulnTable } from './VulnTable';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';
import type { SbomVulnerability } from '../../providers/types/sbom';

// Mock useTranslation so we don't depend on the store.
vi.mock('../../hooks/useI18n', () => ({
  useTranslation: () => ({
    locale: 'en',
    t: (_key: string, fallback: string) => fallback,
  }),
}));

/** Factory for a mock SbomVulnerability. */
function makeVuln(overrides: Partial<SbomVulnerability> = {}): SbomVulnerability {
  return {
    id: 'CVE-2024-0001',
    severity: 'critical',
    affectedComponents: ['lodash'],
    description: 'Prototype pollution',
    fixedVersion: '4.17.21',
    ...overrides,
  };
}

let view: RenderResult;

afterEach(() => {
  cleanup();
});

describe('VulnTable', () => {
  describe('rendering', () => {
    it('renders the table container', () => {
      view = render(<VulnTable vulns={[]} />);
      expect(view.container.querySelector('table')).not.toBeNull();
    });

    it('renders column headers', () => {
      view = render(<VulnTable vulns={[]} />);
      expect(view.queryByText('ID')).not.toBeNull();
      expect(view.queryByText('Severity')).not.toBeNull();
      expect(view.queryByText('Component')).not.toBeNull();
      expect(view.queryByText('Fix')).not.toBeNull();
    });

    it('renders the vulnerability count in the title', () => {
      const vulns = [makeVuln(), makeVuln({ id: 'CVE-2024-0002' })];
      view = render(<VulnTable vulns={vulns} />);
      expect(view.queryByText(/Vulnerabilities.*2/)).not.toBeNull();
    });
  });

  describe('vulnerability list', () => {
    it('renders vulnerability IDs', () => {
      const vulns = [makeVuln({ id: 'CVE-2024-0001' }), makeVuln({ id: 'CVE-2024-0002' })];
      view = render(<VulnTable vulns={vulns} />);
      expect(view.queryByText('CVE-2024-0001')).not.toBeNull();
      expect(view.queryByText('CVE-2024-0002')).not.toBeNull();
    });

    it('renders severity labels in uppercase', () => {
      const vulns = [makeVuln({ severity: 'critical' })];
      view = render(<VulnTable vulns={vulns} />);
      expect(view.queryByText('CRITICAL')).not.toBeNull();
    });

    it('renders affected component names', () => {
      const vulns = [makeVuln({ affectedComponents: ['lodash', 'express'] })];
      view = render(<VulnTable vulns={vulns} />);
      expect(view.queryByText('lodash, express')).not.toBeNull();
    });

    it('renders fix version when available', () => {
      const vulns = [makeVuln({ fixedVersion: '4.17.21' })];
      view = render(<VulnTable vulns={vulns} />);
      expect(view.queryByText('4.17.21')).not.toBeNull();
    });

    it('renders dash when no fix version', () => {
      const vulns = [makeVuln({ fixedVersion: undefined })];
      view = render(<VulnTable vulns={vulns} />);
      expect(view.queryByText('-')).not.toBeNull();
    });

    it('renders a row for each vulnerability', () => {
      const vulns = [
        makeVuln({ id: 'CVE-2024-0001' }),
        makeVuln({ id: 'CVE-2024-0002' }),
        makeVuln({ id: 'CVE-2024-0003' }),
      ];
      view = render(<VulnTable vulns={vulns} />);
      const rows = view.querySelectorAll('tbody tr');
      expect(rows).toHaveLength(3);
    });
  });

  describe('severity display', () => {
    it('applies color style for critical severity', () => {
      const vulns = [makeVuln({ severity: 'critical' })];
      view = render(<VulnTable vulns={vulns} />);
      const span = view.queryByText('CRITICAL');
      expect(span).not.toBeNull();
      expect(span!.style.fontWeight).toBe('600');
    });

    it('applies color style for high severity', () => {
      const vulns = [makeVuln({ severity: 'high' })];
      view = render(<VulnTable vulns={vulns} />);
      const span = view.queryByText('HIGH');
      expect(span).not.toBeNull();
      expect(span!.style.color).not.toBe('');
      expect(span!.style.color).not.toBe('inherit');
    });

    it('applies color style for medium severity', () => {
      const vulns = [makeVuln({ severity: 'medium' })];
      view = render(<VulnTable vulns={vulns} />);
      const span = view.queryByText('MEDIUM');
      expect(span).not.toBeNull();
      expect(span!.style.fontWeight).toBe('600');
    });

    it('applies color style for low severity', () => {
      const vulns = [makeVuln({ severity: 'low' })];
      view = render(<VulnTable vulns={vulns} />);
      const span = view.queryByText('LOW');
      expect(span).not.toBeNull();
      expect(span!.style.color).not.toBe('');
      expect(span!.style.color).not.toBe('inherit');
    });
  });

  describe('empty state', () => {
    it('renders zero count when no vulnerabilities', () => {
      view = render(<VulnTable vulns={[]} />);
      expect(view.queryByText(/Vulnerabilities.*0/)).not.toBeNull();
    });

    it('renders empty tbody when no vulnerabilities', () => {
      view = render(<VulnTable vulns={[]} />);
      const rows = view.querySelectorAll('tbody tr');
      expect(rows).toHaveLength(0);
    });
  });
});
