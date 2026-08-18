// P1 usability smoke — the 5-section IA + first-run flows from the usability
// plan (Tasks 3–10), driven through the real Vite dev server with no backend.
//
// What is covered, and why these selectors:
// - 5-section rail: the sidebar renders exactly one <nav> (aria-label is the
//   localized `sidebar.mainNav`, zh "主导航") with one button per SectionId.
// - Section routing: clicking 工作负载 swaps the overview home for the
//   SubNav + resource table; the workloads strip's first tab is "Deployment"
//   (zh kind labels are singular — see KIND_LABELS_ZH in lib/i18n).
// - Tools catalog: the 运维工具 section renders the tool cards; each card
//   carries a title tooltip with its localized name ("Helm 市场").
// - Overview home: with no cluster connected the Dashboard shows the empty
//   state whose CTA opens the onboarding wizard.
//
// The e2e runs with the production default locale (zh), so the assertions use
// the same Chinese strings the shipped UI shows. If a dictionary key changes,
// this spec is the place that catches the renames.

import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // A fresh browser profile has no `k7s.onboarded` flag, so the App would
  // auto-open the first-run wizard whose scrim intercepts every click. Seed
  // the "finished" marker (src/lib/onboarded.ts) before any page script runs
  // — the app then boots straight into the overview like a returning user.
  await page.addInitScript(() => {
    window.localStorage.setItem('k7s.onboarded', '1');
  });
});

test('P1 usability smoke', async ({ page }) => {
  await page.goto('/');

  // The 5-section rail: 概览 / 工作负载 / 配置与网络 / 存储 / 运维工具.
  const rail = page.getByRole('navigation', { name: '主导航' });
  await expect(rail.locator('button')).toHaveCount(5);

  // Overview is the home page; with no cluster connected it shows the
  // onboarding empty state instead of a dashboard full of zeroes.
  await expect(page.getByRole('heading', { name: '还没有连接任何集群' })).toBeVisible();

  // 概览 → 工作负载: content area swaps to the SubNav strip + resource table.
  await page.getByTitle('工作负载').click();
  await expect(page.getByRole('tab', { name: 'Deployment', exact: true })).toBeVisible();
  // Entering a resource section also selects its first kind and highlights it.
  await expect(
    page.getByRole('tab', { name: 'Deployment', exact: true })
  ).toHaveAttribute('aria-selected', 'true');

  // 工作负载 → 运维工具: the tools catalog replaces the table.
  await page.getByTitle('运维工具').click();
  await expect(page.getByTitle('Helm 市场')).toBeVisible();
});
