/**
 * Tests for AiStatusBar — the compact status line under the AI panel.
 *
 * Covers: model name (configured and fallback), connection dot, context
 * visibility, and permission-mode labels.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { AiStatusBar } from './AiStatusBar';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';
import type { AiConfigView } from '../../lib/ai/types';

let view: RenderResult;

afterEach(() => {
  cleanup();
});

function makeConfig(overrides: Partial<AiConfigView> = {}): AiConfigView {
  return {
    enabled: true,
    provider: { baseUrl: 'http://localhost', model: 'qwen3:8b' },
    permission: 'readOnly',
    maxTurns: 8,
    hasApiKey: true,
    ...overrides,
  };
}

describe('AiStatusBar', () => {
  it('shows the configured model name', () => {
    view = render(
      <AiStatusBar config={makeConfig()} connected contextName="kind-kind" />,
    );
    expect(view.queryByText('qwen3:8b')).not.toBeNull();
  });

  it('falls back to "Not configured" without a config', () => {
    view = render(<AiStatusBar config={null} connected={false} contextName="" />);
    expect(view.queryByText('Not configured')).not.toBeNull();
  });

  it('marks the connection dot via data-connected', () => {
    view = render(
      <AiStatusBar config={makeConfig()} connected contextName="kind-kind" />,
    );
    const dot = view.container.querySelector('[data-connected]');
    expect(dot).not.toBeNull();
    expect(dot!.getAttribute('data-connected')).toBe('true');
  });

  it('shows the context name only while connected', () => {
    view = render(
      <AiStatusBar config={makeConfig()} connected contextName="kind-kind" />,
    );
    expect(view.queryByText(/kind-kind/)).not.toBeNull();

    view = render(
      <AiStatusBar config={makeConfig()} connected={false} contextName="kind-kind" />,
    );
    expect(view.queryByText(/kind-kind/)).toBeNull();
  });

  it('labels the known permission modes', () => {
    view = render(
      <AiStatusBar config={makeConfig({ permission: 'readOnly' })} connected contextName="" />,
    );
    expect(view.queryByText(/Read only/)).not.toBeNull();

    view = render(
      <AiStatusBar
        config={makeConfig({ permission: 'readConfirmWrite' })}
        connected
        contextName=""
      />,
    );
    expect(view.queryByText(/Writes need approval/)).not.toBeNull();

    view = render(
      <AiStatusBar config={makeConfig({ permission: 'fullAuto' })} connected contextName="" />,
    );
    expect(view.queryByText(/Full auto/)).not.toBeNull();
  });

  it('passes an unknown permission mode straight through', () => {
    view = render(
      <AiStatusBar
        config={makeConfig({ permission: 'custom-mode' as AiConfigView['permission'] })}
        connected
        contextName=""
      />,
    );
    expect(view.queryByText(/custom-mode/)).not.toBeNull();
  });

  it('hides the permission label without a config', () => {
    view = render(<AiStatusBar config={null} connected={false} contextName="" />);
    expect(view.container.textContent).not.toMatch(/Read only|Full auto/);
  });
});
