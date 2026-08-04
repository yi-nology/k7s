/**
 * Tests for ImageRepoPanel — private OCI registry management.
 *
 * Covers: rendering, header, close button, registry list, add form.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageRepoPanel } from './ImageRepoPanel';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';

// Mock the provider.
vi.mock('../../providers', () => ({
  getProvider: () => ({
    imageRegistryList: vi.fn().mockResolvedValue([
      { name: 'harbor', url: 'https://harbor.example.com', description: 'Test registry' },
    ]),
    imageRegistryRepos: vi.fn().mockResolvedValue([]),
    imageRegistryTags: vi.fn().mockResolvedValue([]),
    imageRegistryManifest: vi.fn().mockResolvedValue(null),
    imageRegistryUpsert: vi.fn().mockResolvedValue(undefined),
    imageRegistryTest: vi.fn().mockResolvedValue(undefined),
    imageRegistryRemove: vi.fn().mockResolvedValue(undefined),
  }),
}));

let view: RenderResult;

afterEach(() => {
  cleanup();
});

describe('ImageRepoPanel', () => {
  it('renders the panel', () => {
    view = render(<ImageRepoPanel />);
    expect(view.container.firstChild).not.toBeNull();
  });

  it('renders the title', () => {
    view = render(<ImageRepoPanel />);
    expect(view.queryByText('Image registries')).not.toBeNull();
  });

  it('renders close button when onClose is provided', () => {
    const onClose = vi.fn();
    view = render(<ImageRepoPanel onClose={onClose} />);
    expect(view.queryByText('Close')).not.toBeNull();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    view = render(<ImageRepoPanel onClose={onClose} />);
    const closeBtn = view.queryByText('Close');
    if (closeBtn) view.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders the add registry button', () => {
    view = render(<ImageRepoPanel />);
    expect(view.queryByText('Add registry')).not.toBeNull();
  });

  it('shows add form when add button is clicked', () => {
    view = render(<ImageRepoPanel />);
    const addBtn = view.queryByText('Add registry');
    if (addBtn) view.click(addBtn);
    expect(view.queryByText('Registry')).not.toBeNull();
    expect(view.queryByText('Save')).not.toBeNull();
    expect(view.queryByText('Cancel')).not.toBeNull();
  });

  it('hides add form when cancel is clicked', () => {
    view = render(<ImageRepoPanel />);
    const addBtn = view.queryByText('Add registry');
    if (addBtn) view.click(addBtn);
    const cancelBtn = view.queryByText('Cancel');
    if (cancelBtn) view.click(cancelBtn);
    expect(view.queryByText('Add registry')).not.toBeNull();
  });

  it('renders the side panel with registry items', async () => {
    view = render(<ImageRepoPanel />);
    // Wait for async load
    await new Promise((r) => setTimeout(r, 50));
    expect(view.queryByText('harbor')).not.toBeNull();
  });
});
