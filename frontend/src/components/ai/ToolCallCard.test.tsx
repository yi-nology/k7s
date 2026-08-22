/**
 * Tests for ToolCallCard — the collapsible tool-invocation card in AI chat.
 *
 * Covers: tool name formatting, status icon + label per state, read/write
 * icons, expand/collapse, args and result rendering, and the Approve/Deny
 * bar for pending write tools.
 *
 * Locale is pinned to en by the global test setup; status labels come from
 * the en dictionary (Running / Done / Failed / Needs approval / Denied).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolCallCard } from './ToolCallCard';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';

let view: RenderResult;

afterEach(() => {
  cleanup();
});

describe('ToolCallCard', () => {
  it('formats the tool name from snake_case to Title Case', () => {
    view = render(
      <ToolCallCard name="list_pods" args={{ namespace: 'default' }} isWrite={false} state="ok" />,
    );
    expect(view.queryByText('List Pods')).not.toBeNull();
  });

  it('shows the done status icon and label for an ok call', () => {
    view = render(
      <ToolCallCard name="list_pods" args={{}} isWrite={false} state="ok" />,
    );
    expect(view.queryByText('✓')).not.toBeNull();
    expect(view.queryByText('Done')).not.toBeNull();
  });

  it('shows the error status icon and label for a failed call', () => {
    view = render(
      <ToolCallCard name="list_pods" args={{}} isWrite={false} state="err" />,
    );
    expect(view.queryByText('✗')).not.toBeNull();
    expect(view.queryByText('Failed')).not.toBeNull();
  });

  it('shows the read tool icon for read calls and the write icon for writes', () => {
    view = render(
      <>
        <ToolCallCard name="get_pod" args={{}} isWrite={false} state="ok" />
        <ToolCallCard name="scale_deployment" args={{}} isWrite state="ok" />
      </>,
    );
    expect(view.queryByText('🔍')).not.toBeNull();
    expect(view.queryByText('✎')).not.toBeNull();
  });

  it('hides args and result while collapsed', () => {
    view = render(
      <ToolCallCard
        name="list_pods"
        args={{ namespace: 'default' }}
        isWrite={false}
        state="ok"
        result={['pod-a']}
      />,
    );
    expect(view.queryByText('Parameters')).toBeNull();
    expect(view.queryByText('Result')).toBeNull();
  });

  it('shows formatted key: value args and the result when expanded', () => {
    view = render(
      <ToolCallCard
        name="list_pods"
        args={{ namespace: 'default' }}
        isWrite={false}
        state="ok"
        result={['pod-a', 'pod-b']}
        defaultExpanded
      />,
    );
    expect(view.queryByText('Parameters')).not.toBeNull();
    expect(view.queryByText(/namespace: default/)).not.toBeNull();
    expect(view.queryByText('Result')).not.toBeNull();
    // formatResult stringifies the array as JSON.
    expect(view.queryByText(/pod-a/)).not.toBeNull();
  });

  it('toggles expansion from the header', () => {
    view = render(<ToolCallCard name="list_pods" args={{ q: 1 }} isWrite={false} state="ok" />);
    view.click(view.getByText('List Pods'));
    expect(view.queryByText('Parameters')).not.toBeNull();
    view.click(view.getByText('List Pods'));
    expect(view.queryByText('Parameters')).toBeNull();
  });

  it('shows the args summary in the collapsed header', () => {
    view = render(
      <ToolCallCard
        name="scale_deployment"
        args={{ namespace: 'default', name: 'web', replicas: 3 }}
        isWrite
        state="ok"
      />,
    );
    expect(view.queryByText('default · web · → 3 replicas')).not.toBeNull();
  });

  it('renders Approve/Deny buttons for a pending call and fires onApprove', () => {
    const onApprove = vi.fn();
    view = render(
      <ToolCallCard
        name="delete_pod"
        args={{ name: 'web' }}
        isWrite
        state="pending"
        onApprove={onApprove}
      />,
    );
    // Pending cards default to expanded.
    expect(view.queryByText('Needs approval')).not.toBeNull();
    expect(view.queryByText('✓ Approve')).not.toBeNull();
    expect(view.queryByText('✗ Deny')).not.toBeNull();

    view.click(view.getByText('✓ Approve'));
    expect(onApprove).toHaveBeenCalledWith(true);
    view.click(view.getByText('✗ Deny'));
    expect(onApprove).toHaveBeenCalledWith(false);
  });

  it('does not render the approval bar when not pending', () => {
    view = render(
      <ToolCallCard
        name="delete_pod"
        args={{ name: 'web' }}
        isWrite
        state="ok"
        onApprove={vi.fn()}
        defaultExpanded
      />,
    );
    expect(view.queryByText('✓ Approve')).toBeNull();
  });

  it('labels the result section Error for failed calls', () => {
    view = render(
      <ToolCallCard
        name="list_pods"
        args={{}}
        isWrite={false}
        state="err"
        result="boom"
        defaultExpanded
      />,
    );
    expect(view.queryByText('Error')).not.toBeNull();
    expect(view.queryByText('boom')).not.toBeNull();
  });
});
