/**
 * Tests for ComponentTable — SBOM component list table.
 *
 * Covers: rendering component list, version info, license info, empty state,
 * component count display, missing license handling.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComponentTable } from './ComponentTable';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';
import type { SbomComponent } from '../../providers/types/sbom';

// Mock useTranslation so we don't depend on the store.
vi.mock('../../hooks/useI18n', () => ({
  useTranslation: () => ({
    locale: 'en',
    t: (_key: string, fallback: string) => fallback,
  }),
}));

/** Factory for a mock SbomComponent. */
function makeComponent(overrides: Partial<SbomComponent> = {}): SbomComponent {
  return {
    name: 'react',
    version: '18.2.0',
    purl: 'pkg:npm/react@18.2.0',
    componentType: 'library',
    licenses: ['MIT'],
    hashes: [],
    ...overrides,
  };
}

let view: RenderResult;

afterEach(() => {
  cleanup();
});

describe('ComponentTable', () => {
  describe('rendering', () => {
    it('renders the table container', () => {
      view = render(<ComponentTable components={[]} />);
      expect(view.container.querySelector('table')).not.toBeNull();
    });

    it('renders column headers', () => {
      view = render(<ComponentTable components={[]} />);
      expect(view.queryByText('Name')).not.toBeNull();
      expect(view.queryByText('Version')).not.toBeNull();
      expect(view.queryByText('Type')).not.toBeNull();
      expect(view.queryByText('Licenses')).not.toBeNull();
    });

    it('renders the component count in the title', () => {
      const components = [makeComponent(), makeComponent({ name: 'vue' })];
      view = render(<ComponentTable components={components} />);
      expect(view.queryByText(/Components.*2/)).not.toBeNull();
    });
  });

  describe('component list', () => {
    it('renders component names', () => {
      const components = [makeComponent({ name: 'react' }), makeComponent({ name: 'lodash' })];
      view = render(<ComponentTable components={components} />);
      expect(view.queryByText('react')).not.toBeNull();
      expect(view.queryByText('lodash')).not.toBeNull();
    });

    it('renders version information', () => {
      const components = [makeComponent({ version: '18.2.0' })];
      view = render(<ComponentTable components={components} />);
      expect(view.queryByText('18.2.0')).not.toBeNull();
    });

    it('renders component type', () => {
      const components = [makeComponent({ componentType: 'library' })];
      view = render(<ComponentTable components={components} />);
      expect(view.queryByText('library')).not.toBeNull();
    });

    it('renders license information', () => {
      const components = [makeComponent({ licenses: ['MIT'] })];
      view = render(<ComponentTable components={components} />);
      expect(view.queryByText('MIT')).not.toBeNull();
    });

    it('renders multiple licenses joined by comma', () => {
      const components = [makeComponent({ licenses: ['MIT', 'Apache-2.0'] })];
      view = render(<ComponentTable components={components} />);
      expect(view.queryByText('MIT, Apache-2.0')).not.toBeNull();
    });

    it('renders dash when licenses array is empty', () => {
      const components = [makeComponent({ licenses: [] })];
      view = render(<ComponentTable components={components} />);
      expect(view.queryByText('-')).not.toBeNull();
    });

    it('renders a row for each component', () => {
      const components = [
        makeComponent({ name: 'react', version: '18.2.0' }),
        makeComponent({ name: 'vue', version: '3.3.0' }),
        makeComponent({ name: 'angular', version: '16.0.0' }),
      ];
      view = render(<ComponentTable components={components} />);
      const rows = view.querySelectorAll('tbody tr');
      expect(rows).toHaveLength(3);
    });
  });

  describe('empty state', () => {
    it('renders zero count when no components', () => {
      view = render(<ComponentTable components={[]} />);
      expect(view.queryByText(/Components.*0/)).not.toBeNull();
    });

    it('renders empty tbody when no components', () => {
      view = render(<ComponentTable components={[]} />);
      const rows = view.querySelectorAll('tbody tr');
      expect(rows).toHaveLength(0);
    });
  });
});
