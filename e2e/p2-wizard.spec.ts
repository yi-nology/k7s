// P2 create-workload wizard smoke — the 4-step wizard (基本信息 → 容器配置 →
// 存储与配置 → 预览与应用) opened from the workloads section's 新建 button.
//
// Scope (deliberately stops before 检查/应用): the YAML preview is generated
// client-side from the form (generateWorkloadYaml — no provider round-trip), so
// the smoke walks the wizard to step 4 and asserts the Deployment manifest is
// there. The dev server runs without a backend (see playwright.config.ts), so
// dry-run/apply behavior is covered by unit tests, not here. The apply gate is
// still asserted statically: without a clean 检查 run, 应用 stays disabled.
//
// Selectors come from the shipped markup, not guesses:
// - 新建 button: data-testid="new-resource" (ResourceTable toolbar; workload
//   kinds route it to the wizard overlay).
// - name/image inputs: data-testid="wizard-name"/"wizard-image" (StepFields
//   Basics — also have real <label htmlFor> associations).
// - The stepper buttons are the zh dictionary's 下一步/上一步.

import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Same seed as the P1 spec: without `k7s.onboarded` the first-run wizard's
  // scrim would intercept every click before the app becomes interactive.
  await page.addInitScript(() => {
    window.localStorage.setItem('k7s.onboarded', '1');
  });
});

test('P2 wizard smoke', async ({ page }) => {
  await page.goto('/');

  // 工作负载 auto-selects the Deployment tab, whose table toolbar carries 新建.
  await page.getByTitle('工作负载').click();
  await page.getByTestId('new-resource').click();

  const dialog = page.getByRole('dialog', { name: '创建工作负载' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('① 基本信息')).toBeVisible();

  // Step-0 gate (validateWorkloadForm): Next stays disabled until both the
  // name and the image are valid — one at a time proves each field counts.
  const next = dialog.getByRole('button', { name: '下一步' });
  await expect(next).toBeDisabled();
  await dialog.getByTestId('wizard-name').fill('e2e-demo');
  await expect(next).toBeDisabled();
  await dialog.getByTestId('wizard-image').fill('nginx:1.27');
  await expect(next).toBeEnabled();

  // Walk the remaining steps, asserting each step's fragment really swapped in.
  await next.click();
  await expect(dialog.getByText('环境变量')).toBeVisible(); // ② 容器配置
  await next.click();
  await expect(dialog.getByText('存储挂载')).toBeVisible(); // ③ 存储与配置
  await next.click();

  // ④ 预览与应用: the CodeMirror draft holds the generated manifest.
  const preview = dialog.locator('.cm-content');
  await expect(preview).toContainText('kind: Deployment');
  await expect(preview).toContainText('name: e2e-demo');
  await expect(preview).toContainText('image: nginx:1.27');

  // Dry-run gate: with no 检查 run yet, 应用 must stay disabled.
  await expect(dialog.getByRole('button', { name: '应用', exact: true })).toBeDisabled();
});
