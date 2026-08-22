/**
 * Tests for FromNodeSection — export an image from a node's runtime.
 *
 * Covers: node options come from the store's node rows, the List-images
 * button gate, listing images through the provider, chip → image ref
 * backfill, and the Export button gate. Provider is mocked; node rows are
 * pushed into the store directly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store';
import { FromNodeSection } from './FromNodeSection';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';
import type { Row } from '../../providers/types';

const providerMocks = vi.hoisted(() => ({
  listNodeImages: vi.fn(),
  exportFromNode: vi.fn(),
}));
vi.mock('../../providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers')>();
  return {
    ...actual,
    getProvider: () => ({
      listNodeImages: providerMocks.listNodeImages,
      exportFromNode: providerMocks.exportFromNode,
    }),
  };
});

function nodeRow(name: string, status: string): Row {
  return {
    uid: `uid-${name}`,
    name,
    namespace: '',
    // nodeOption reads cells[0]/cells[1] via String() — plain strings keep
    // the option labels readable (Cell objects would coerce to "[object
    // Object]", which is how the component is written to consume them).
    cells: [name, status] as unknown as Row['cells'],
  };
}

const NODES: Row[] = [nodeRow('node-a', 'Ready'), nodeRow('node-b', 'NotReady')];

let view: RenderResult;

beforeEach(() => {
  providerMocks.listNodeImages.mockReset();
  providerMocks.exportFromNode.mockReset();
  useStore.setState({ rows: { ...useStore.getState().rows, nodes: NODES } });
});

afterEach(() => {
  cleanup();
});

/** Pick a <select> option and dispatch the change event (React-controlled). */
function selectOption(view: RenderResult, value: string): void {
  const select = view.container.querySelector('select') as HTMLSelectElement;
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('FromNodeSection', () => {
  it('renders the node options from the store', () => {
    view = render(<FromNodeSection />);
    const options = view.container.querySelectorAll('option');
    const values = Array.from(options).map((o) => o.value);
    expect(values).toContain('node-a');
    expect(values).toContain('node-b');
  });

  it('disables List images until a node is picked', () => {
    view = render(<FromNodeSection />);
    const btn = view.getByText('List images on node');
    expect(btn.hasAttribute('disabled')).toBe(true);
  });

  it('disables Export until node and image ref are filled', () => {
    view = render(<FromNodeSection />);
    const exportBtn = view.getByText('Export');
    expect(exportBtn.hasAttribute('disabled')).toBe(true);

    selectOption(view, 'node-a');
    const still = view.getByText('Export');
    expect(still.hasAttribute('disabled')).toBe(true);
  });

  it('lists images on the picked node through the provider', async () => {
    providerMocks.listNodeImages.mockResolvedValue(['nginx:1.25', 'redis:7']);
    view = render(<FromNodeSection />);
    selectOption(view, 'node-a');
    view.click(view.getByText('List images on node'));

    await vi.waitFor(() => {
      expect(providerMocks.listNodeImages).toHaveBeenCalledWith('node-a');
    });
    await vi.waitFor(() => {
      expect(view.queryByText('nginx:1.25')).not.toBeNull();
      expect(view.queryByText('redis:7')).not.toBeNull();
    });
  });

  it('backfills the image ref when a chip is clicked', async () => {
    providerMocks.listNodeImages.mockResolvedValue(['nginx:1.25']);
    view = render(<FromNodeSection />);
    selectOption(view, 'node-a');
    view.click(view.getByText('List images on node'));
    await vi.waitFor(() => {
      expect(view.queryByText('nginx:1.25')).not.toBeNull();
    });

    view.click(view.getByText('nginx:1.25'));
    const input = view.container.querySelector('input[type="text"]') as HTMLInputElement;
    expect(input.value).toBe('nginx:1.25');
    // With node + ref, Export is enabled.
    expect(view.getByText('Export').hasAttribute('disabled')).toBe(false);
  });

  it('shows the error message when listing fails', async () => {
    providerMocks.listNodeImages.mockRejectedValue(new Error('node unreachable'));
    view = render(<FromNodeSection />);
    selectOption(view, 'node-a');
    view.click(view.getByText('List images on node'));

    await vi.waitFor(() => {
      expect(view.queryByText(/node unreachable/)).not.toBeNull();
    });
  });

  it('keeps the image chips cleared when the node changes', async () => {
    providerMocks.listNodeImages.mockResolvedValue(['nginx:1.25']);
    view = render(<FromNodeSection />);
    selectOption(view, 'node-a');
    view.click(view.getByText('List images on node'));
    await vi.waitFor(() => {
      expect(view.queryByText('nginx:1.25')).not.toBeNull();
    });

    selectOption(view, 'node-b');
    expect(view.queryByText('nginx:1.25')).toBeNull();
  });
});
