/**
 * Tests for tableUtils.renderCell — status pill rendering, and its locale
 * parameter: zh localizes the status word and adds a "raw — hint" tooltip;
 * the default (no locale) keeps the previous raw-text behavior.
 */

import { describe, it, expect } from 'vitest';
import type { Cell } from '../../providers/types';
import { renderCell } from './tableUtils';
import { render } from '../../test/componentUtils';

/** A STATUS-column-style cell: status dot + tone. */
function statusCell(text: string): Cell {
  return { text, tone: 'err', dot: true };
}

describe('renderCell', () => {
  it('renders the raw status text with a title when no locale is given (default behavior)', () => {
    const view = render(<>{renderCell(statusCell('CrashLoopBackOff'), 0)}</>);
    expect(view.getByText('CrashLoopBackOff')).not.toBeNull();
    const pill = view.querySelector(`[class*="status"]`) as HTMLElement;
    expect(pill.getAttribute('title')).toBe('CrashLoopBackOff');
  });

  it('renders plain text cells unchanged (no dot, no pill)', () => {
    const view = render(<>{renderCell({ text: 'default/pod-1', tone: 'primary' }, 0, 'zh')}</>);
    expect(view.getByText('default/pod-1')).not.toBeNull();
    expect(view.querySelector('[title]')).toBeNull();
  });

  it('localizes a known status to zh and puts "raw — hint" in the title', () => {
    const view = render(<>{renderCell(statusCell('CrashLoopBackOff'), 0, 'zh')}</>);
    expect(view.getByText('崩溃循环')).not.toBeNull();
    expect(view.queryByText('CrashLoopBackOff')).toBeNull();
    const pill = view.querySelector(`[class*="status"]`) as HTMLElement;
    const title = pill.getAttribute('title') ?? '';
    expect(title.startsWith('CrashLoopBackOff — ')).toBe(true);
    expect(title).toContain('查看日志或上一个容器的日志');
  });

  it('shows the raw status for unknown statuses even with a locale', () => {
    const view = render(<>{renderCell(statusCell('SomeNewState'), 0, 'zh')}</>);
    expect(view.getByText('SomeNewState')).not.toBeNull();
    const pill = view.querySelector(`[class*="status"]`) as HTMLElement;
    expect(pill.getAttribute('title')).toBe('SomeNewState');
  });

  it('keeps the raw label for the en locale but adds the en hint to the title', () => {
    const view = render(<>{renderCell(statusCell('ImagePullBackOff'), 0, 'en')}</>);
    expect(view.getByText('ImagePullBackOff')).not.toBeNull();
    const pill = view.querySelector(`[class*="status"]`) as HTMLElement;
    const title = pill.getAttribute('title') ?? '';
    expect(title.startsWith('ImagePullBackOff — ')).toBe(true);
    expect(title).toContain('registry credentials');
  });
});
