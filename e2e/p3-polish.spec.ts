// P3 polish smoke — the table-density setting (Settings → 表格密度), the one
// P3 surface that is fully drivable in the dev harness: it needs no cluster
// rows, only the settings panel and the table container, both of which render
// with no backend (HttpProvider parks the connection in the error phase).
//
// The other P3 pieces — localized status badges and hover quick actions —
// need real resource rows to assert against, so they stay unit-covered
// (ResourceTable.test.tsx); this spec exists to prove the density pref flows
// end-to-end: ⚙ → select 紧凑 → the ResourceTable container re-renders with
// the compact class, live, without a reload.
//
// Selectors come from the shipped markup, not guesses:
// - ⚙ button: title is the localized `chrome.sidebar.settings` (zh "设置") —
//   WatchFooter, always mounted in the sidebar footer.
// - The density <select> is the only combobox offering a 紧凑 option (the
//   panel's other comboboxes are 颜色 / 语言 / AI provider / AI permission).
// - The compact class is a CSS-module hash (`ResourceTable.module.css` >
//   .compact on the table's outer container), so the assertion matches a
//   "compact" substring of the class attribute rather than an exact name.
// - The container itself is reached structurally: the toolbar's 新建 button
//   (data-testid="new-resource") sits two levels inside it.

import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Same seed as the P1/P2 specs: without `k7s.onboarded` the first-run
  // wizard's scrim would intercept every click before the app is interactive.
  await page.addInitScript(() => {
    window.localStorage.setItem('k7s.onboarded', '1');
  });
});

test('P3 table density smoke', async ({ page }) => {
  await page.goto('/');

  // 工作负载 mounts the ResourceTable. With no cluster the table is empty,
  // but the toolbar + container render — enough to observe the density class.
  await page.getByTitle('工作负载').click();
  await expect(page.getByRole('tab', { name: 'Deployment', exact: true })).toBeVisible();

  // The table's outer container: 新建 (toolbar) → toolbar div → container.
  const container = page.getByTestId('new-resource').locator('../..');
  // Comfortable is the default (DEFAULT_SETTINGS.tableDensity) — no compact
  // fragment in the hashed class attribute yet.
  await expect(container).not.toHaveClass(/compact/);

  // ⚙ in the sidebar footer opens the settings modal.
  await page.getByTitle('设置').click();

  // 表格密度: the combobox whose options include 紧凑. Pick by the stable
  // pref-file value ("compact"), not the localized label.
  const density = page
    .getByRole('combobox')
    .filter({ has: page.getByRole('option', { name: '紧凑' }) });
  await expect(density).toBeVisible();
  await density.selectOption('compact');

  // Esc closes the panel (SettingsPanel's own Escape handler).
  await page.keyboard.press('Escape');

  // The container picked up the compact class the moment the pref changed —
  // no reload, proving the store → ResourceTable wiring is live.
  await expect(container).toHaveClass(/compact/);
});
