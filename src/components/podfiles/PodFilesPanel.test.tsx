/**
 * Tests for PodFilesPanel — pod file browser.
 *
 * Covers: rendering, header, breadcrumbs, file list, close button.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { PodFilesPanel } from './PodFilesPanel';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';

// Mock the provider.
vi.mock('../../providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers')>();
  return {
    ...actual,
    getProvider: () => ({
      podFilesList: vi.fn().mockResolvedValue([
        { name: 'etc', kind: 'dir', size: 0 },
        { name: 'var', kind: 'dir', size: 0 },
        { name: 'config.yaml', kind: 'file', size: 1024 },
        { name: 'link', kind: 'symlink', size: 0, target: '/etc' },
      ]),
      podFilesRead: vi.fn().mockResolvedValue('file content here'),
      podFilesWrite: vi.fn().mockResolvedValue(undefined),
      podFilesDownload: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    }),
  };
});

const mockRef = { kind: 'pods' as const, namespace: 'default', name: 'nginx' };

let view: RenderResult;

afterEach(() => {
  cleanup();
});

describe('PodFilesPanel', () => {
  it('renders the panel', () => {
    view = render(<PodFilesPanel ref={mockRef} container="app" />);
    expect(view.container.firstChild).not.toBeNull();
  });

  it('renders the root breadcrumb', () => {
    view = render(<PodFilesPanel ref={mockRef} container="app" />);
    expect(view.queryByText('/')).not.toBeNull();
  });

  it('renders close button when onClose is provided', () => {
    const onClose = vi.fn();
    view = render(<PodFilesPanel ref={mockRef} container="app" onClose={onClose} />);
    expect(view.queryByText('Close')).not.toBeNull();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    view = render(<PodFilesPanel ref={mockRef} container="app" onClose={onClose} />);
    const closeBtn = view.queryByText('Close');
    if (closeBtn) view.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders file entries', async () => {
    view = render(<PodFilesPanel ref={mockRef} container="app" />);
    await new Promise((r) => setTimeout(r, 50));
    expect(view.queryByText('etc')).not.toBeNull();
    expect(view.queryByText('var')).not.toBeNull();
    expect(view.queryByText('config.yaml')).not.toBeNull();
  });

  it('renders directory icons', async () => {
    view = render(<PodFilesPanel ref={mockRef} container="app" />);
    await new Promise((r) => setTimeout(r, 50));
    // Directories show triangle icon
    const icons = view.container.querySelectorAll('[class*="icon"]');
    expect(icons.length).toBeGreaterThan(0);
  });

  it('shows pick file message when no file selected', () => {
    view = render(<PodFilesPanel ref={mockRef} container="app" />);
    expect(view.queryByText('Pick a file to view or edit')).not.toBeNull();
  });

  it('renders up button when path is not root', async () => {
    view = render(<PodFilesPanel ref={mockRef} container="app" initialPath="/etc" />);
    await new Promise((r) => setTimeout(r, 50));
    expect(view.queryByText('Up')).not.toBeNull();
  });
});
