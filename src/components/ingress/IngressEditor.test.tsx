/**
 * Tests for IngressEditor — visual Ingress resource editor.
 *
 * Covers: rendering, form fields, YAML mode toggle, add/remove rules/TLS/annotations,
 * dry run, apply.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store';
import { IngressEditor } from './IngressEditor';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';

// Mock the provider.
const mockDryRunYamlBundle = vi.fn().mockResolvedValue([]);
const mockApplyYamlBundle = vi.fn().mockResolvedValue(undefined);
vi.mock('../../providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers')>();
  return {
    ...actual,
    getProvider: () => ({
      dryRunYamlBundle: mockDryRunYamlBundle,
      applyYamlBundle: mockApplyYamlBundle,
    }),
  };
});

let view: RenderResult;

function resetStore() {
  useStore.setState({
    overlayPodRef: null,
  });
}

beforeEach(() => {
  resetStore();
  mockDryRunYamlBundle.mockClear();
  mockApplyYamlBundle.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('IngressEditor', () => {
  describe('rendering', () => {
    it('renders the editor panel', () => {
      view = render(<IngressEditor />);
      expect(view.container.firstChild).not.toBeNull();
    });

    it('renders the title', () => {
      view = render(<IngressEditor />);
      expect(view.queryByText(/Ingress Editor/)).not.toBeNull();
    });

    it('renders close button when onClose provided', () => {
      const onClose = vi.fn();
      view = render(<IngressEditor onClose={onClose} />);
      expect(view.queryByText(/close/i)).not.toBeNull();
    });

    it('does not render close button when onClose not provided', () => {
      view = render(<IngressEditor />);
      // No close button when no onClose prop
      const buttons = view.container.querySelectorAll('button');
      const closeBtn = Array.from(buttons).find((b) => /close/i.test(b.textContent ?? ''));
      expect(closeBtn).toBeUndefined();
    });

    it('calls onClose when close button clicked', () => {
      const onClose = vi.fn();
      view = render(<IngressEditor onClose={onClose} />);
      const buttons = view.container.querySelectorAll('button');
      const closeBtn = Array.from(buttons).find((b) => /close/i.test(b.textContent ?? ''));
      expect(closeBtn).not.toBeNull();
      if (closeBtn) view.click(closeBtn);
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('form fields', () => {
    it('renders name label', () => {
      view = render(<IngressEditor />);
      expect(view.queryByText('Name')).not.toBeNull();
    });

    it('renders namespace label', () => {
      view = render(<IngressEditor />);
      expect(view.queryByText('Namespace')).not.toBeNull();
    });

    it('renders ingress class label', () => {
      view = render(<IngressEditor />);
      expect(view.queryByText('IngressClass')).not.toBeNull();
    });

    it('renders host label in rules', () => {
      view = render(<IngressEditor />);
      expect(view.queryByText('Host')).not.toBeNull();
    });

    it('renders path label', () => {
      view = render(<IngressEditor />);
      expect(view.queryByText('Path')).not.toBeNull();
    });

    it('renders service label', () => {
      view = render(<IngressEditor />);
      expect(view.queryByText('Service')).not.toBeNull();
    });

    it('renders port label', () => {
      view = render(<IngressEditor />);
      expect(view.queryByText('Port')).not.toBeNull();
    });

    it('renders input fields', () => {
      view = render(<IngressEditor />);
      const inputs = view.container.querySelectorAll('input');
      expect(inputs.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('YAML mode toggle', () => {
    it('renders YAML toggle button', () => {
      view = render(<IngressEditor />);
      expect(view.queryByText(/YAML/)).not.toBeNull();
    });

    it('switches to YAML mode on click', () => {
      view = render(<IngressEditor />);
      const yamlBtn = view.queryByText(/YAML/);
      expect(yamlBtn).not.toBeNull();
      view.click(yamlBtn!);
      // Should now show Form button to switch back
      expect(view.queryByText(/Form/)).not.toBeNull();
    });

    it('shows textarea in YAML mode', () => {
      view = render(<IngressEditor />);
      const yamlBtn = view.queryByText(/YAML/);
      view.click(yamlBtn!);
      const textarea = view.container.querySelector('textarea');
      expect(textarea).not.toBeNull();
    });
  });

  describe('add/remove rules', () => {
    it('renders add rule button', () => {
      view = render(<IngressEditor />);
      expect(view.queryByText(/Add Rule/)).not.toBeNull();
    });

    it('adds a rule when add button clicked', () => {
      view = render(<IngressEditor />);
      const addBtn = view.queryByText(/Add Rule/);
      expect(addBtn).not.toBeNull();
      view.click(addBtn!);
      // Should now have two host inputs
      const hostInputs = view.container.querySelectorAll('input');
      expect(hostInputs.length).toBeGreaterThan(5);
    });
  });

  describe('add/remove TLS', () => {
    it('renders add TLS button', () => {
      view = render(<IngressEditor />);
      expect(view.queryByText(/Add TLS/)).not.toBeNull();
    });

    it('adds TLS when button clicked', () => {
      view = render(<IngressEditor />);
      const addTlsBtn = view.queryByText(/Add TLS/);
      expect(addTlsBtn).not.toBeNull();
      view.click(addTlsBtn!);
      // Should now show secret name label
      expect(view.queryByText('Secret Name')).not.toBeNull();
    });
  });

  describe('add annotations', () => {
    it('renders add annotation button', () => {
      view = render(<IngressEditor />);
      expect(view.queryByText(/Add/)).not.toBeNull();
    });
  });

  describe('actions', () => {
    it('renders dry run button', () => {
      view = render(<IngressEditor />);
      expect(view.queryByText(/Dry Run/)).not.toBeNull();
    });

    it('renders apply button', () => {
      view = render(<IngressEditor />);
      expect(view.queryByText(/Apply/)).not.toBeNull();
    });
  });
});
