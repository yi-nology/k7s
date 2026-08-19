// P4 closeout smoke — wizard type dropdown (all 5 workload kinds) and
// SubNav custom-kind collapse badge.
//
// Scope:
// - The create-workload wizard's type <select> now offers all 5 workload kinds
//   (Deployment, StatefulSet, DaemonSet, Job, CronJob). The spec opens the
//   wizard and asserts the dropdown contains both Job and CronJob options.
// - The SubNav's "Custom Resources" group collapses CRD kinds behind a toggle
//   that shows the visible count as a badge. This behavior is NOT e2e-testable
//   in the dev harness: the dev server runs with HttpProvider (no backend),
//   so `customKindCounts` is never populated and no CRD kinds appear. The
//   collapse + badge + zero-instance filtering are covered by SubNav.test.tsx
//   (unit tests with mocked store state).
//
// Selectors (from shipped markup, not guesses):
// - 新建 button: data-testid="new-resource" (ResourceTable toolbar).
// - Type <select>: id="wizard-type" (StepFields.tsx Basics fragment).
// - Options are plain <option value="..."> with English kind names.

import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Same seed as P1/P2/P3 specs: skip the first-run onboarding wizard.
  await page.addInitScript(() => {
    window.localStorage.setItem('k7s.onboarded', '1');
  });
});

test('P4 wizard type dropdown has all 5 workload kinds', async ({ page }) => {
  await page.goto('/');

  // Navigate to workloads and open the create wizard.
  await page.getByTitle('工作负载').click();
  await page.getByTestId('new-resource').click();

  const dialog = page.getByRole('dialog', { name: '创建工作负载' });
  await expect(dialog).toBeVisible();

  // The type <select> (id="wizard-type") must contain all 5 options.
  const typeSelect = dialog.locator('#wizard-type');
  await expect(typeSelect).toBeVisible();

  // Assert each option exists — the select's <option> text is the kind name.
  for (const kind of ['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob']) {
    await expect(typeSelect.locator(`option[value="${kind.toLowerCase()}"]`)).toHaveText(kind);
  }

  // Verify the full option count (5 workload kinds, no extras).
  await expect(typeSelect.locator('option')).toHaveCount(5);

  // Selecting Job should show the Completions field (P4 new behavior).
  // The default locale is zh: "完成数" is the localized label.
  await typeSelect.selectOption('job');
  await expect(dialog.getByText('完成数')).toBeVisible();

  // Selecting CronJob should show the Schedule field (P4 new behavior).
  // The default locale is zh: "计划表达式" is the localized label.
  await typeSelect.selectOption('cronjob');
  await expect(dialog.getByText('计划表达式')).toBeVisible();
});
