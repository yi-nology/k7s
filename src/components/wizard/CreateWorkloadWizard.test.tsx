/**
 * Tests for CreateWorkloadWizard — the 4-step create-workload wizard (P2 Task 3
 * + Task 4).
 *
 * Covers: step-0 basics rendering, the step-0 Next gate
 * (validateWorkloadForm — name+image required, name must be a legal k8s name),
 * full 4-step navigation to the YAML review step, prev-step navigation,
 * array-row add/remove (ports/env/mounts) flowing into the generated YAML,
 * the Esc-close contract shared with OnboardingWizard, and the Task-4 apply
 * gate: apply is disabled until a clean bundle dry-run exists, a draft edit
 * invalidates a clean run (stale), and a clean apply calls applyYamlBundle
 * with the draft and closes. Also the 从 YAML 回填表单 backfill button
 * (success regenerates the preview; unparseable drafts surface a message).
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

// Mock the provider's bundle operations (Task 1 surface). vi.hoisted so the
// vi.mock factory (hoisted to the top of the file) can reference the fns.
const bundleMocks = vi.hoisted(() => ({
  dryRunYamlBundle: vi.fn(),
  applyYamlBundle: vi.fn(),
}));
vi.mock('../../providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers')>();
  return {
    ...actual,
    getProvider: () => ({
      dryRunYamlBundle: bundleMocks.dryRunYamlBundle,
      applyYamlBundle: bundleMocks.applyYamlBundle,
    }),
  };
});

// Mock the error/success reporter channels (P3 Task 4) so the apply outcome's
// routing is observable: a clean apply must toast through the SUCCESS channel,
// failed docs through the ERROR channel.
const reporterMocks = vi.hoisted(() => ({
  errorReporter: vi.fn(),
  successReporter: vi.fn(),
}));
vi.mock('../../providers/errorHandler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers/errorHandler')>();
  return {
    ...actual,
    getErrorReporter: () => reporterMocks.errorReporter,
    getSuccessReporter: () => reporterMocks.successReporter,
  };
});

// The review step renders the shared CodeMirror wrapper; mock it down to a
// plain element so jsdom can assert on / edit the draft without CodeMirror:
// read-only mounts render a <pre> (textContent assertions), editable mounts
// render a <textarea> — NOT an <input>, whose value silently strips newlines
// (that would flatten the YAML into one unparseable line).
// Same approach as HelmInstallWizard.test's EditorCore mock.
vi.mock('../detail/CodeEditor', () => ({
  CodeEditor: ({
    value,
    editable,
    onChange,
  }: {
    value: string;
    editable: boolean;
    onChange?: (v: string) => void;
  }) =>
    editable
      ? React.createElement('textarea', {
          'data-testid': 'wizard-yaml',
          value,
          onChange: (e: { target: { value: string } }) => onChange?.(e.target.value),
        })
      : React.createElement('pre', { 'data-testid': 'wizard-yaml' }, value),
}));

let view: RenderResult;
const onClose = vi.fn();

/** Let pending provider promises resolve and their state updates land. */
const flush = () => new Promise((r) => setTimeout(r, 20));

/** The review-step draft text (input value when editable, textContent when not). */
function draftText(): string {
  const el = view.getByTestId('wizard-yaml') as HTMLTextAreaElement;
  return el.value ?? el.textContent ?? '';
}

/** Edit the mocked draft editor. The harness's change() drives the
 * HTMLInputElement value setter, which throws on a <textarea> — so drive the
 * textarea setter directly, same trick, right prototype. */
function changeDraft(text: string) {
  const el = view.getByTestId('wizard-yaml') as HTMLTextAreaElement;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    )?.set;
    setter?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** The 应用 (Apply) footer button on step 4. */
function applyButton(): HTMLButtonElement {
  return view.getByText('应用') as HTMLButtonElement;
}

/** Pin zh (production default) and simulate the wizard overlay being open. */
beforeEach(() => {
  onClose.mockReset();
  bundleMocks.dryRunYamlBundle.mockReset();
  bundleMocks.applyYamlBundle.mockReset();
  reporterMocks.errorReporter.mockReset();
  reporterMocks.successReporter.mockReset();
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

/** Walk a freshly-filled form to step 4 (review & apply). */
function reachReview() {
  fillBasics();
  view.click(view.getByText('下一步'));
  view.click(view.getByText('下一步'));
  view.click(view.getByText('下一步'));
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

  it('walks all four steps to the editable YAML review', () => {
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

    // Step 4 — editable draft seeded from the form; no Next button.
    view.click(view.getByText('下一步'));
    expect(view.queryByText(/预览与应用/)).not.toBeNull();
    expect(draftText()).toContain('kind: Deployment');
    expect(draftText()).toContain('name: nginx');
    expect(draftText()).toContain('image: nginx:1.27');
    expect(nextButton()).toBeNull();
    // The last-step footer: prev + check + apply (gated) + close.
    expect(view.queryByText('上一步')).not.toBeNull();
    expect(view.queryByText('检查')).not.toBeNull();
    expect(applyButton().hasAttribute('disabled')).toBe(true);
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
    const yaml = draftText();
    expect(yaml).toContain('- name: http');
    expect(yaml).toContain('containerPort: 8080');
    expect(yaml).toContain('value: "prod"');
    expect(yaml).toContain('mountPath: /data');
    expect(yaml).toContain('claimName: data');
  });

  it('renders both probe editors simultaneously without duplicate field ids', () => {
    view = render(<CreateWorkloadWizard onClose={onClose} />);
    fillBasics();
    view.click(view.getByText('下一步')); // step 2 (container)

    // The two probe <details> blocks each hold an enable checkbox (inside the
    // collapsed block, still in the DOM). Toggle both so the probe fields
    // actually render.
    const checkboxes = view.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBe(2); // readiness + liveness
    for (const cb of checkboxes) view.click(cb);

    // Both probes show their full field set (path/port/delay) at once.
    expect(view.queryAllByText('路径').length).toBe(2);
    expect(view.queryAllByText('初始延迟(秒)').length).toBe(2);

    // Every wizard-scoped id in the DOM is unique — the probe editors share
    // markup, so a hardcoded id there would appear twice (invalid HTML, and
    // the second probe's label would focus the first probe's input).
    const ids = view.querySelectorAll('[id^="wizard-"]').map((el) => el.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('apply is gated on a clean dry-run', async () => {
    // First check: the server rejects the doc (e.g. missing namespace).
    bundleMocks.dryRunYamlBundle.mockResolvedValueOnce([
      {
        kind: 'Deployment',
        namespace: 'default',
        name: 'nginx',
        proposed: null,
        error: 'namespaces "x" not found',
      },
    ]);
    view = render(<CreateWorkloadWizard onClose={onClose} />);
    reachReview();

    // No dry-run yet → apply disabled.
    expect(applyButton().hasAttribute('disabled')).toBe(true);
    view.click(view.getByText('检查'));
    await flush();

    // The per-doc error row is visible and apply stays disabled.
    expect(bundleMocks.dryRunYamlBundle).toHaveBeenCalledTimes(1);
    expect(bundleMocks.dryRunYamlBundle).toHaveBeenCalledWith(
      expect.stringContaining('name: nginx')
    );
    expect(view.queryByText(/namespaces "x" not found/)).not.toBeNull();
    expect(applyButton().hasAttribute('disabled')).toBe(true);

    // Re-check with a clean result → apply opens up.
    bundleMocks.dryRunYamlBundle.mockResolvedValueOnce([
      {
        kind: 'Deployment',
        namespace: 'default',
        name: 'nginx',
        proposed: 'apiVersion: apps/v1\nkind: Deployment\n',
        error: null,
      },
    ]);
    view.click(view.getByText('检查'));
    await flush();
    expect(view.queryByText('检查通过')).not.toBeNull();
    expect(applyButton().hasAttribute('disabled')).toBe(false);

    // Apply → applyYamlBundle receives the draft, onClose fires on success.
    bundleMocks.applyYamlBundle.mockResolvedValueOnce([
      { kind: 'Deployment', namespace: 'default', name: 'nginx', action: 'created', error: null },
    ]);
    view.click(applyButton());
    await flush();
    expect(bundleMocks.applyYamlBundle).toHaveBeenCalledTimes(1);
    expect(bundleMocks.applyYamlBundle).toHaveBeenCalledWith(
      expect.stringContaining('name: nginx')
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a clean apply toasts through the success channel, not the error channel', async () => {
    bundleMocks.dryRunYamlBundle.mockResolvedValueOnce([
      {
        kind: 'Deployment',
        namespace: 'default',
        name: 'nginx',
        proposed: 'apiVersion: apps/v1\n',
        error: null,
      },
    ]);
    bundleMocks.applyYamlBundle.mockResolvedValueOnce([
      { kind: 'Deployment', namespace: 'default', name: 'nginx', action: 'created', error: null },
    ]);
    view = render(<CreateWorkloadWizard onClose={onClose} />);
    reachReview();
    view.click(view.getByText('检查'));
    await flush();
    view.click(applyButton());
    await flush();

    // Success goes out via getSuccessReporter() — a green toast, not red.
    expect(reporterMocks.successReporter).toHaveBeenCalledTimes(1);
    expect(reporterMocks.successReporter).toHaveBeenCalledWith(
      '已应用',
      expect.stringContaining('created Deployment/nginx')
    );
    expect(reporterMocks.errorReporter).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('failed docs at apply time still toast through the error channel and keep the dialog open', async () => {
    bundleMocks.dryRunYamlBundle.mockResolvedValueOnce([
      {
        kind: 'Deployment',
        namespace: 'default',
        name: 'nginx',
        proposed: 'apiVersion: apps/v1\n',
        error: null,
      },
    ]);
    bundleMocks.applyYamlBundle.mockResolvedValueOnce([
      {
        kind: 'Deployment',
        namespace: 'default',
        name: 'nginx',
        action: 'failed',
        error: 'conflict',
      },
    ]);
    view = render(<CreateWorkloadWizard onClose={onClose} />);
    reachReview();
    view.click(view.getByText('检查'));
    await flush();
    view.click(applyButton());
    await flush();

    expect(reporterMocks.errorReporter).toHaveBeenCalledTimes(1);
    expect(reporterMocks.errorReporter).toHaveBeenCalledWith(
      '应用失败',
      expect.stringContaining('Deployment/nginx')
    );
    expect(reporterMocks.successReporter).not.toHaveBeenCalled();
    // The dialog stays open so the inline result rows are reachable.
    expect(onClose).not.toHaveBeenCalled();
    expect(view.queryByText(/conflict/)).not.toBeNull();
  });

  it('an empty dry-run result does not pass the gate vacuously', async () => {
    // Clearing the draft entirely makes the bundle parse to zero docs —
    // `dry.every(...)` would be vacuously true. The gate must treat a
    // zero-doc run as not clean (TemplatePicker's `review.length > 0`
    // precedent): no 检查通过, apply stays disabled.
    bundleMocks.dryRunYamlBundle.mockResolvedValueOnce([]);
    view = render(<CreateWorkloadWizard onClose={onClose} />);
    reachReview();
    changeDraft('');
    view.click(view.getByText('检查'));
    await flush();
    expect(bundleMocks.dryRunYamlBundle).toHaveBeenCalledWith('');
    expect(view.queryByText('检查通过')).toBeNull();
    expect(applyButton().hasAttribute('disabled')).toBe(true);
  });

  it('a draft edit after a clean dry-run re-gates apply (stale)', async () => {
    bundleMocks.dryRunYamlBundle.mockResolvedValue([
      {
        kind: 'Deployment',
        namespace: 'default',
        name: 'nginx',
        proposed: 'apiVersion: apps/v1\n',
        error: null,
      },
    ]);
    view = render(<CreateWorkloadWizard onClose={onClose} />);
    reachReview();
    view.click(view.getByText('检查'));
    await flush();
    expect(applyButton().hasAttribute('disabled')).toBe(false);

    // Edit the draft: the clean run is invalidated — review rows disappear,
    // stale hint appears, apply closes again until re-checked.
    changeDraft(draftText().replace('nginx', 'web'));
    expect(applyButton().hasAttribute('disabled')).toBe(true);
    expect(view.queryByText(/检查通过/)).toBeNull();
    expect(view.queryByText(/编辑/)).not.toBeNull(); // stale hint

    // Re-check against the edited draft re-opens apply.
    view.click(view.getByText('检查'));
    await flush();
    expect(bundleMocks.dryRunYamlBundle).toHaveBeenLastCalledWith(
      expect.stringContaining('name: web')
    );
    expect(applyButton().hasAttribute('disabled')).toBe(false);
  });

  it('backfills the form from an edited draft and regenerates the preview', () => {
    view = render(<CreateWorkloadWizard onClose={onClose} />);
    reachReview();
    changeDraft(draftText().replace('name: nginx', 'name: web'));
    view.click(view.getByText('从 YAML 回填表单'));

    // The merged form regenerates the draft (fresh preview, gate re-closed).
    expect(draftText()).toContain('name: web');
    expect(view.queryByText(/无法解析/)).toBeNull();
    expect(applyButton().hasAttribute('disabled')).toBe(true);
  });

  it('shows a parse message when the draft is not a workload', () => {
    view = render(<CreateWorkloadWizard onClose={onClose} />);
    reachReview();
    // A Service doc parses as YAML but not as a Deployment/STS/DS.
    changeDraft('apiVersion: v1\nkind: Service\nmetadata:\n  name: s\n');
    view.click(view.getByText('从 YAML 回填表单'));
    expect(view.queryByText('无法解析为工作负载')).not.toBeNull();
    // The draft is untouched (still the Service doc) — the user can fix it.
    expect(draftText()).toContain('kind: Service');
  });

  it('closes on Esc (document keydown), the OnboardingWizard contract', () => {
    view = render(<CreateWorkloadWizard onClose={onClose} />);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
