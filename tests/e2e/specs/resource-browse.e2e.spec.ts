import { test, expect } from '@playwright/test';
import { waitForAppLoad, waitForLoading, takeScreenshot } from '../utils/test-helpers';

/**
 * 资源浏览 E2E 测试
 * 
 * 测试资源列表浏览和交互功能
 */

test.describe('资源浏览', () => {
  test.beforeEach(async ({ page }) => {
    // 导航到应用首页
    await page.goto('/');
    
    // 等待应用加载完成
    await waitForAppLoad(page);
  });

  test('应该显示资源表格', async ({ page }) => {
    // 验证资源表格可见
    const resourceTable = page.locator('[data-testid="resource-table"]');
    await expect(resourceTable).toBeVisible();
    
    // 验证表格有表头
    const headers = page.locator('[data-testid="table-header"]');
    await expect(headers).toBeVisible();
    
    // 截图记录
    await takeScreenshot(page, 'resource-browse-table');
  });

  test('应该显示资源列表', async ({ page }) => {
    // 等待表格加载完成
    await waitForLoading(page);
    
    // 获取表格行
    const rows = page.locator('[data-testid="table-row"]');
    const rowCount = await rows.count();
    
    // 验证表格有内容（如果连接了集群）
    if (rowCount > 0) {
      // 验证第一行可见
      await expect(rows.first()).toBeVisible();
      
      // 验证行有内容
      const firstRowText = await rows.first().innerText();
      expect(firstRowText.length).toBeGreaterThan(0);
    }
    
    // 截图记录
    await takeScreenshot(page, 'resource-browse-rows');
  });

  test('应该能够切换资源类型', async ({ page }) => {
    // 点击侧边栏的不同资源类型
    const navItems = page.locator('[data-testid="nav-item"]');
    const navItemCount = await navItems.count();
    
    // 遍历前几个资源类型
    for (let i = 0; i < Math.min(navItemCount, 3); i++) {
      const navItem = navItems.nth(i);
      const resourceName = await navItem.innerText();
      
      // 点击资源类型
      await navItem.click();
      
      // 等待表格刷新
      await page.waitForTimeout(1000);
      
      // 验证表格仍然可见
      const resourceTable = page.locator('[data-testid="resource-table"]');
      await expect(resourceTable).toBeVisible();
      
      // 截图记录
      await takeScreenshot(page, `resource-browse-${resourceName.toLowerCase()}`);
    }
  });

  test('应该能够选择表格行', async ({ page }) => {
    // 等待表格加载完成
    await waitForLoading(page);
    
    // 获取表格行
    const rows = page.locator('[data-testid="table-row"]');
    const rowCount = await rows.count();
    
    if (rowCount > 0) {
      // 点击第一行
      await rows.first().click();
      
      // 验证详情面板可见
      const detailPanel = page.locator('[data-testid="detail-panel"]');
      await expect(detailPanel).toBeVisible({ timeout: 5000 });
      
      // 截图记录
      await takeScreenshot(page, 'resource-browse-row-selected');
    }
  });

  test('应该能够查看详情', async ({ page }) => {
    // 等待表格加载完成
    await waitForLoading(page);
    
    // 获取表格行
    const rows = page.locator('[data-testid="table-row"]');
    const rowCount = await rows.count();
    
    if (rowCount > 0) {
      // 点击第一行
      await rows.first().click();
      
      // 等待详情面板加载
      const detailPanel = page.locator('[data-testid="detail-panel"]');
      await expect(detailPanel).toBeVisible({ timeout: 5000 });
      
      // 验证详情面板有内容
      const resourceName = page.locator('[data-testid="resource-name"]');
      await expect(resourceName).toBeVisible();
      
      // 获取资源名称
      const nameText = await resourceName.innerText();
      expect(nameText.length).toBeGreaterThan(0);
      
      // 截图记录
      await takeScreenshot(page, 'resource-browse-detail');
    }
  });

  test('应该能够切换详情标签页', async ({ page }) => {
    // 等待表格加载完成
    await waitForLoading(page);
    
    // 获取表格行
    const rows = page.locator('[data-testid="table-row"]');
    const rowCount = await rows.count();
    
    if (rowCount > 0) {
      // 点击第一行
      await rows.first().click();
      
      // 等待详情面板加载
      const detailPanel = page.locator('[data-testid="detail-panel"]');
      await expect(detailPanel).toBeVisible({ timeout: 5000 });
      
      // 获取所有标签页
      const tabs = page.locator('[data-testid="detail-tab"]');
      const tabCount = await tabs.count();
      
      // 遍历前几个标签页
      for (let i = 0; i < Math.min(tabCount, 3); i++) {
        const tab = tabs.nth(i);
        const tabName = await tab.innerText();
        
        // 点击标签页
        await tab.click();
        
        // 等待内容加载
        await page.waitForTimeout(500);
        
        // 验证标签页内容可见
        const tabContent = page.locator('[data-testid="tab-content"]');
        await expect(tabContent).toBeVisible();
        
        // 截图记录
        await takeScreenshot(page, `resource-browse-tab-${tabName.toLowerCase()}`);
      }
    }
  });

  test('应该能够关闭详情面板', async ({ page }) => {
    // 等待表格加载完成
    await waitForLoading(page);
    
    // 获取表格行
    const rows = page.locator('[data-testid="table-row"]');
    const rowCount = await rows.count();
    
    if (rowCount > 0) {
      // 点击第一行
      await rows.first().click();
      
      // 等待详情面板加载
      const detailPanel = page.locator('[data-testid="detail-panel"]');
      await expect(detailPanel).toBeVisible({ timeout: 5000 });
      
      // 点击关闭按钮
      const closeButton = page.locator('[data-testid="close-panel"]');
      await closeButton.click();
      
      // 验证详情面板已关闭
      await expect(detailPanel).toBeHidden();
      
      // 截图记录
      await takeScreenshot(page, 'resource-browse-panel-closed');
    }
  });

  test('应该能够搜索资源', async ({ page }) => {
    // 等待表格加载完成
    await waitForLoading(page);
    
    // 查找搜索输入框
    const searchInput = page.locator('[data-testid="table-search"]');
    
    // 如果搜索框存在
    if (await searchInput.isVisible()) {
      // 输入搜索关键词
      await searchInput.fill('test');
      
      // 等待搜索结果
      await page.waitForTimeout(1000);
      
      // 验证表格仍然可见
      const resourceTable = page.locator('[data-testid="resource-table"]');
      await expect(resourceTable).toBeVisible();
      
      // 截图记录
      await takeScreenshot(page, 'resource-browse-search');
      
      // 清空搜索
      await searchInput.clear();
      
      // 等待表格恢复
      await page.waitForTimeout(1000);
    }
  });

  test('应该能够排序资源', async ({ page }) => {
    // 等待表格加载完成
    await waitForLoading(page);
    
    // 查找可排序的列头
    const sortableHeaders = page.locator('[data-testid="table-header"][data-sortable="true"]');
    const sortableCount = await sortableHeaders.count();
    
    if (sortableCount > 0) {
      // 点击第一个可排序的列头
      const firstSortable = sortableHeaders.first();
      await firstSortable.click();
      
      // 等待排序完成
      await page.waitForTimeout(1000);
      
      // 验证表格仍然可见
      const resourceTable = page.locator('[data-testid="resource-table"]');
      await expect(resourceTable).toBeVisible();
      
      // 截图记录
      await takeScreenshot(page, 'resource-browse-sorted');
    }
  });

  test('应该能够过滤资源', async ({ page }) => {
    // 等待表格加载完成
    await waitForLoading(page);
    
    // 查找过滤器
    const filterButton = page.locator('[data-testid="filter-button"]');
    
    // 如果过滤器存在
    if (await filterButton.isVisible()) {
      // 点击过滤器
      await filterButton.click();
      
      // 等待过滤器面板
      const filterPanel = page.locator('[data-testid="filter-panel"]');
      await expect(filterPanel).toBeVisible({ timeout: 5000 });
      
      // 截图记录
      await takeScreenshot(page, 'resource-browse-filter');
      
      // 关闭过滤器
      const closeButton = page.locator('[data-testid="close-filter"]');
      await closeButton.click();
    }
  });

  test('应该显示空状态', async ({ page }) => {
    // 等待表格加载完成
    await waitForLoading(page);
    
    // 检查是否显示空状态
    const emptyState = page.locator('[data-testid="table-empty"]');
    
    // 如果表格为空
    if (await emptyState.isVisible()) {
      // 验证空状态消息
      const emptyMessage = await emptyState.innerText();
      expect(emptyMessage.length).toBeGreaterThan(0);
      
      // 截图记录
      await takeScreenshot(page, 'resource-browse-empty');
    }
  });

  test('应该显示加载状态', async ({ page }) => {
    // 检查加载状态
    const loading = page.locator('[data-testid="table-loading"]');
    
    // 如果正在加载
    if (await loading.isVisible()) {
      // 验证加载指示器
      await expect(loading).toBeVisible();
      
      // 截图记录
      await takeScreenshot(page, 'resource-browse-loading');
      
      // 等待加载完成
      await loading.waitFor({ state: 'hidden', timeout: 30000 });
    }
  });

  test('应该显示错误状态', async ({ page }) => {
    // 检查错误状态
    const errorState = page.locator('[data-testid="table-error"]');
    
    // 如果有错误
    if (await errorState.isVisible()) {
      // 验证错误消息
      const errorMessage = await errorState.innerText();
      expect(errorMessage.length).toBeGreaterThan(0);
      
      // 截图记录
      await takeScreenshot(page, 'resource-browse-error');
    }
  });

  test('应该能够分页浏览', async ({ page }) => {
    // 等待表格加载完成
    await waitForLoading(page);
    
    // 查找分页控件
    const pagination = page.locator('[data-testid="pagination"]');
    
    // 如果分页存在
    if (await pagination.isVisible()) {
      // 点击下一页
      const nextButton = page.locator('[data-testid="next-page"]');
      if (await nextButton.isVisible()) {
        await nextButton.click();
        
        // 等待页面加载
        await page.waitForTimeout(1000);
        
        // 验证表格仍然可见
        const resourceTable = page.locator('[data-testid="resource-table"]');
        await expect(resourceTable).toBeVisible();
        
        // 截图记录
        await takeScreenshot(page, 'resource-browse-pagination');
      }
    }
  });
});
