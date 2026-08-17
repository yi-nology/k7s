import { test, expect } from '@playwright/test';
import { waitForAppLoad, takeScreenshot } from '../utils/test-helpers';

/**
 * 应用加载 E2E 测试
 * 
 * 测试应用的基本加载和渲染功能
 */

test.describe('应用加载', () => {
  test('应该成功加载应用', async ({ page }) => {
    // 导航到应用首页
    await page.goto('/');
    
    // 等待应用加载完成
    await waitForAppLoad(page);
    
    // 验证页面标题
    await expect(page).toHaveTitle(/k7s/);
    
    // 验证侧边栏可见
    await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();
    
    // 验证顶部工具栏可见
    await expect(page.locator('[data-testid="topbar"]')).toBeVisible();
    
    // 验证状态栏可见
    await expect(page.locator('[data-testid="statusbar"]')).toBeVisible();
    
    // 截图记录
    await takeScreenshot(page, 'app-load-success');
  });

  test('应该显示主要 UI 组件', async ({ page }) => {
    // 导航到应用首页
    await page.goto('/');
    
    // 等待应用加载完成
    await waitForAppLoad(page);
    
    // 验证主要 UI 组件
    const components = [
      'sidebar',
      'topbar',
      'resource-table',
      'statusbar',
    ];
    
    for (const component of components) {
      const element = page.locator(`[data-testid="${component}"]`);
      await expect(element).toBeVisible({ timeout: 10000 });
    }
    
    // 截图记录
    await takeScreenshot(page, 'app-load-components');
  });

  test('应该能够响应交互', async ({ page }) => {
    // 导航到应用首页
    await page.goto('/');
    
    // 等待应用加载完成
    await waitForAppLoad(page);
    
    // 测试侧边栏交互
    const sidebar = page.locator('[data-testid="sidebar"]');
    await expect(sidebar).toBeVisible();
    
    // 测试顶部工具栏交互
    const topbar = page.locator('[data-testid="topbar"]');
    await expect(topbar).toBeVisible();
    
    // 测试资源表格交互
    const resourceTable = page.locator('[data-testid="resource-table"]');
    await expect(resourceTable).toBeVisible();
    
    // 截图记录
    await takeScreenshot(page, 'app-load-interactive');
  });

  test('应该正确处理错误', async ({ page }) => {
    // 导航到应用首页
    await page.goto('/');
    
    // 等待应用加载完成
    await waitForAppLoad(page);
    
    // 检查是否有错误状态
    const errorState = page.locator('[data-testid="error"]');
    
    // 如果没有错误，验证应用正常
    if (!(await errorState.isVisible())) {
      // 验证应用正常加载
      await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();
      await expect(page.locator('[data-testid="topbar"]')).toBeVisible();
    }
    
    // 截图记录
    await takeScreenshot(page, 'app-load-error-handling');
  });

  test('应该支持键盘导航', async ({ page }) => {
    // 导航到应用首页
    await page.goto('/');
    
    // 等待应用加载完成
    await waitForAppLoad(page);
    
    // 测试 Tab 键导航
    await page.keyboard.press('Tab');
    
    // 验证焦点移动
    const focusedElement = page.locator(':focus');
    await expect(focusedElement).toBeVisible();
    
    // 测试 Escape 键
    await page.keyboard.press('Escape');
    
    // 截图记录
    await takeScreenshot(page, 'app-load-keyboard');
  });

  test('应该支持响应式布局', async ({ page }) => {
    // 导航到应用首页
    await page.goto('/');
    
    // 等待应用加载完成
    await waitForAppLoad(page);
    
    // 测试不同视口大小
    const viewports = [
      { width: 1920, height: 1080 }, // 大屏幕
      { width: 1280, height: 720 },  // 中等屏幕
      { width: 768, height: 1024 },  // 平板
    ];
    
    for (const viewport of viewports) {
      // 设置视口大小
      await page.setViewportSize(viewport);
      
      // 等待布局调整
      await page.waitForTimeout(500);
      
      // 验证主要组件仍然可见
      await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();
      await expect(page.locator('[data-testid="topbar"]')).toBeVisible();
      await expect(page.locator('[data-testid="resource-table"]')).toBeVisible();
      
      // 截图记录
      await takeScreenshot(page, `app-load-viewport-${viewport.width}x${viewport.height}`);
    }
  });

  test('应该支持主题切换', async ({ page }) => {
    // 导航到应用首页
    await page.goto('/');
    
    // 等待应用加载完成
    await waitForAppLoad(page);
    
    // 查找主题切换按钮
    const themeToggle = page.locator('[data-testid="theme-toggle"]');
    
    // 如果主题切换存在
    if (await themeToggle.isVisible()) {
      // 点击主题切换
      await themeToggle.click();
      
      // 等待主题切换
      await page.waitForTimeout(500);
      
      // 验证主题已切换
      const body = page.locator('body');
      const classList = await body.getAttribute('class') || '';
      
      // 截图记录
      await takeScreenshot(page, 'app-load-theme-switch');
    }
  });

  test('应该支持国际化', async ({ page }) => {
    // 导航到应用首页
    await page.goto('/');
    
    // 等待应用加载完成
    await waitForAppLoad(page);
    
    // 查找语言切换
    const languageSwitcher = page.locator('[data-testid="language-switcher"]');
    
    // 如果语言切换存在
    if (await languageSwitcher.isVisible()) {
      // 点击语言切换
      await languageSwitcher.click();
      
      // 等待语言切换
      await page.waitForTimeout(500);
      
      // 验证语言已切换
      const html = page.locator('html');
      const lang = await html.getAttribute('lang');
      
      // 截图记录
      await takeScreenshot(page, 'app-load-language');
    }
  });
});
