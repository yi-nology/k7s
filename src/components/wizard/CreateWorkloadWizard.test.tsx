/**
 * Tests for CreateWorkloadWizard — the 4-step create-workload wizard (P2 Task 3).
 *
 * Covers: step-0 basics rendering, the step-0 Next gate
 * (validateWorkloadForm — name+image required, name must be a legal k8s name),
 * full 4-step navigation to the read-only YAML preview (apply/dry-run are
 * Task 4), prev-step navigation, array-row add/remove (ports/env/mounts)
 * flowing into the generated YAML, and the Esc-close contract shared with
 * OnboardingWizard.
 *
 * Step transitions are asserted on step-specific content (add buttons, args
 * hint, preview) rather than the stepper — the stepper shows all four labels
 * on every step, so it can't prove which step is active.
 *
 * Locale is pinned to zh (the production default) so the assertions double as
 * a check that every wizard.* copy the component renders exists in the zh
 * dictionary — a missing key falls back to English and fails the Chinese match.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act } from 'react';
import { useStore } from '../../store';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';
import { createMockSettings } from '../../test/types';
import { CreateWorkloadWizard } from './CreateWorkloadWizard';

// The review step renders the shared CodeMirror wrapper; mock it down to a
// plain <pre> so jsdom can assert on the generated YAML without CodeMirror.
// Same approach as HelmInstallWizard.test's EditorCore mock.
vi.mock('../detail/CodeEditor', () => ({
  CodeEditor: ({ value }: { value: string }) =>
    React.createElement('pre', { 'data-testid': 'wizard-yaml' }, value),
}));

let view: RenderResult;
const onClose = vi.fn();

/** Pin zh (production default) and simulate the wizard overlay being open. */
beforeEach(() => {
  onClose.mockReset();
  useStore.setState({
    overlay: 'wizard',
    settings: createMockSettings({ language: 'zh' }),
  });
});

afterEach(cleanup);

/** The Next (下一步) button — rendered on steps 0-2 only. */
function nextButton(): HTMLElement | null {
  return view.queryByText('下一步');
}

/** Fill step 0 with a valid minimal form (name nginx, image nginx:1.27). */
function fillBasics() {
  view.change(view.getByTestId('wizard-name'), 'nginx');
  view.change(view.getByTestId('wizard-image'), 'nginx:1.27');
}

describe('CreateWorkloadWizard', () => {
  it('renders step 1 (basics) when opened', () => {
    view = render(<CreateWorkloadWizard onClose={onClose} />);
    expect(view.queryByText(/基本信息/)).not.toBeNull();
    // Real <label htmlFor> associations — getByLabelText works here and the
    // e2e's getByLabel keeps working against the same markup.
    expect(view.queryByLabelText('名称')).not.toBeNull();
    expect(view.queryByLabelText('镜像')).not.toBeNull();
    expect(view.queryByLabelText('命名空间')).not.toBeNull();
    // Basics only — the container step's port editor is not mounted yet.
    expect(view.queryByText(/添加端口/)).toBeNull();
  });

  it('Next stays disabled until name + image are valid', () => {
    view = render(<CreateWorkloadWizard onClose={onClose} />);
    // Empty form — gate closed, with a hint explaining why.
    expect(nextButton()?.hasAttribute('disabled')).toBe(true);
    expect(view.queryByTestId('wizard-errors')).not.toBeNull();
    // Name alone is not enough (image still empty).
    view.change(view.getByTestId('wizard-name'), 'nginx');
    expect(nextButton()?.hasAttribute('disabled')).toBe(true);
    // An illegal k8s name keeps the gate closed even with a valid image.
    view.change(view.getByTestId('wizard-name'), 'Nginx');
    view.change(view.getByTestId('wizard-image'), 'nginx:1.27');
    expect(nextButton()?.hasAttribute('disabled')).toBe(true);
    // Valid basics — gate opens, hint gone.
    view.change(view.getByTestId('wizard-name'), 'nginx');
    expect(nextButton()?.hasAttribute('disabled')).toBe(false);
    expect(view.queryByTestId('wizard-errors')).toBeNull();
  });

  it('walks all four steps to the read-only YAML preview', () => {
    view = render(<CreateWorkloadWizard onClose={onClose} />);
    fillBasics();

    // Step 2 — container form: port editor + the space-separated args hint.
    view.click(view.getByText('下一步'));
    expect(view.queryByText(/添加端口/)).not.toBeNull();
    expect(view.queryByText(/空格分隔/)).not.toBeNull();
    expect(view.queryByText(/添加挂载/)).toBeNull();

    // Step 3 — storage & config (PVC mounts editor).
    view.click(view.getByText('下一步'));
    expect(view.queryByText(/添加挂载/)).not.toBeNull();
    expect(view.queryByText(/添加端口/)).toBeNull();

    // Step 4 — read-only preview of the generated YAML; no Next button.
    view.click(view.getByText('下一步'));
    expect(view.queryByText(/预览与应用/)).not.toBeNull();
    const yaml = view.getByTestId('wizard-yaml').textContent ?? '';
    expect(yaml).toContain('kind: Deployment');
    expect(yaml).toContain('name: nginx');
    expect(yaml).toContain('image: nginx:1.27');
    expect(nextButton()).toBeNull();
    // The last-step footer is prev + close only.
    expect(view.queryByText('上一步')).not.toBeNull();
    expect(view.queryByText('关闭')).not.toBeNull();

    // 上一步 walks back exactly one step.
    view.click(view.getByText('上一步'));
    expect(view.queryByText(/添加挂载/)).not.toBeNull();
    expect(view.queryByTestId('wizard-yaml')).toBeNull(); // preview unmounted
  });

  it('collects port/env/mount rows into the generated YAML', () => {
    view = render(<CreateWorkloadWizard onClose={onClose} />);
    fillBasics();

    // Step 2 — one port row and one env row.
    view.click(view.getByText('下一步'));
    view.click(view.getByText(/添加端口/));
    view.change(view.queryByLabelText('端口名') as HTMLElement, 'http');
    view.change(view.queryByLabelText('端口号') as HTMLElement, '8080');
    view.click(view.getByText(/添加变量/));
    view.change(view.queryByLabelText('变量名') as HTMLElement, 'ENV');
    view.change(view.queryByLabelText('值') as HTMLElement, 'prod');

    // Step 3 — one PVC mount row.
    view.click(view.getByText('下一步'));
    view.click(view.getByText(/添加挂载/));
    view.change(view.queryByLabelText('挂载 PVC') as HTMLElement, 'data');
    view.change(view.queryByLabelText('挂载路径') as HTMLElement, '/data');

    // Step 4 — all three blocks present in the preview.
    view.click(view.getByText('下一步'));
    const yaml = view.getByTestId('wizard-yaml').textContent ?? '';
    expect(yaml).toContain('- name: http');
    expect(yaml).toContain('containerPort: 8080');
    expect(yaml).toContain('value: "prod"');
    expect(yaml).toContain('mountPath: /data');
    expect(yaml).toContain('claimName: data');
  });

  it('closes on Esc (document keydown), the OnboardingWizard contract', () => {
    view = render(<CreateWorkloadWizard onClose={onClose} />);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
