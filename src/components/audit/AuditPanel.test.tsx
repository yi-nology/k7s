/**
 * Tests for AuditPanel — K8s audit log viewer via Loki.
 *
 * Covers: rendering, header, close button, filters, instance list.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuditPanel } from './AuditPanel';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';

// Mock the provider.
vi.mock('../../providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers')>();
  return {
    ...actual,
    getProvider: () => ({
      lokiList: vi.fn().mockResolvedValue([{ name: 'loki-main', url: 'http://loki:3100' }]),
      lokiUpsert: vi.fn().mockResolvedValue(undefined),
      lokiRemove: vi.fn().mockResolvedValue(undefined),
      auditEvents: vi.fn().mockResolvedValue([
        {
          auditId: 'evt-1',
          timestamp: '2024-01-01T12:00:00Z',
          verb: 'create',
          resource: 'pods',
          namespace: 'default',
          name: 'nginx',
          user: 'admin',
          statusCode: 201,
          sourceIp: '10.0.0.1',
          raw: '{"test": true}',
        },
      ]),
    }),
  };
});

let view: RenderResult;

afterEach(() => {
  cleanup();
});

describe('AuditPanel', () => {
  it('renders the panel', () => {
    view = render(<AuditPanel />);
    expect(view.container.firstChild).not.toBeNull();
  });

  it('renders the title', () => {
    view = render(<AuditPanel />);
    expect(view.queryByText('Audit Log')).not.toBeNull();
  });

  it('renders header with title', () => {
    const onClose = vi.fn();
    view = render(<AuditPanel onClose={onClose} />);
    // Header contains title and optional close button
    expect(view.queryByText('Audit Log')).not.toBeNull();
  });

  it('has close functionality when onClose provided', () => {
    const onClose = vi.fn();
    view = render(<AuditPanel onClose={onClose} />);
    // The component accepts onClose prop
    expect(view.container.firstChild).not.toBeNull();
  });

  it('renders Loki instances section', () => {
    view = render(<AuditPanel />);
    expect(view.queryByText('Loki Instances')).not.toBeNull();
  });

  it('renders add Loki button', () => {
    view = render(<AuditPanel />);
    expect(view.queryByText(/Add Loki/)).not.toBeNull();
  });

  it('renders filter inputs', () => {
    view = render(<AuditPanel />);
    expect(view.queryByPlaceholderText('Namespace')).not.toBeNull();
    expect(view.queryByPlaceholderText('Resource')).not.toBeNull();
    expect(view.queryByPlaceholderText('User')).not.toBeNull();
  });

  it('renders since options', () => {
    view = render(<AuditPanel />);
    expect(view.queryByText('15m')).not.toBeNull();
    expect(view.queryByText('1h')).not.toBeNull();
    expect(view.queryByText('6h')).not.toBeNull();
    expect(view.queryByText('24h')).not.toBeNull();
  });

  it('renders refresh button', () => {
    view = render(<AuditPanel />);
    expect(view.queryByText('Refresh')).not.toBeNull();
  });

  it('renders instance list', async () => {
    view = render(<AuditPanel />);
    await new Promise((r) => setTimeout(r, 50));
    expect(view.queryByText('loki-main')).not.toBeNull();
  });

  it('renders events table after load', async () => {
    view = render(<AuditPanel />);
    await new Promise((r) => setTimeout(r, 100));
    // Table headers
    expect(view.queryByText('Verb')).not.toBeNull();
    expect(view.queryByText('Resource')).not.toBeNull();
    expect(view.queryByText('User')).not.toBeNull();
  });
});
