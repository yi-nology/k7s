/**
 * Tests for useAutoSelect — the shared instance-picker boilerplate.
 *
 * mergeErrors is pure; useFirstInstance is exercised through a tiny probe
 * component (the repo's componentUtils render, no renderHook dependency).
 */

import { describe, expect, it } from 'vitest';
import { mergeErrors, useFirstInstance } from './useAutoSelect';
import { cleanup, render } from '../test/componentUtils';

describe('mergeErrors', () => {
  it('returns the first non-empty error', () => {
    expect(mergeErrors(null, undefined, 'boom', 'later')).toBe('boom');
  });

  it('returns null when everything is empty', () => {
    expect(mergeErrors(null, undefined, null)).toBeNull();
    expect(mergeErrors()).toBeNull();
  });

  it('treats empty strings as absent (query hooks use undefined, actions use null)', () => {
    expect(mergeErrors('', 'real')).toBe('real');
  });
});

describe('useFirstInstance', () => {
  interface Instance {
    name: string;
  }

  function Probe({ instances }: { instances: Instance[] }) {
    const [selected, setSelected] = useFirstInstance(instances);
    return (
      <div>
        <span data-testid="selected">{selected ?? 'none'}</span>
        <button type="button" data-testid="pick" onClick={() => setSelected(instances[1]?.name ?? null)}>
          pick
        </button>
      </div>
    );
  }

  it('auto-selects the first instance once a list arrives', () => {
    const view = render(<Probe instances={[{ name: 'a' }, { name: 'b' }]} />);
    expect(view.getByTestId('selected').textContent).toBe('a');
    cleanup();
  });

  it('stays null for an empty list', () => {
    const view = render(<Probe instances={[]} />);
    expect(view.getByTestId('selected').textContent).toBe('none');
    cleanup();
  });

  it('manual selection wins over the auto-select', () => {
    const instances: Instance[] = [{ name: 'a' }, { name: 'b' }];
    const view = render(<Probe instances={instances} />);
    // view.click already wraps the event in act().
    view.click(view.getByTestId('pick'));
    expect(view.getByTestId('selected').textContent).toBe('b');
    cleanup();
  });
});
