import { test, expect } from '@playwright/test';
import { waitForAppLoad, waitForToast, takeScreenshot } from '../utils/test-helpers';

/**
 * 连接流程 E2E 测试
 * 
 * 测试应用的连接和断开功能
 */

test.describe('连接流程', () => {
  test.beforeEach(async ({ page }) => {
    // 导航到应用首页
    await page.goto('/');
    
    // 等待应用加载完成
    await waitForAppLoad(page);
  });

  test('应该显示连接界面', async ({ page }) => {
    // 验证侧边栏可见
    await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();
    
    // 验证顶部工具栏可见
    await expect(page.locator('[data-testid="topbar"]')).toBeVisible();
    
    // 验证状态栏可见
    await expect(page.locator('[data-testid="statusbar"]')).toBeVisible();
    
    // 截图记录
    await takeScreenshot(page, 'connect-flow-initial');
  });

  test('应该显示集群列表', async ({ page }) => {
    // 点击集群切换器
    const clusterSwitcher = page.locator('[data-testid="cluster-switcher"]');
    await clusterSwitcher.click();
    
    // 验证集群列表可见
    const clusterList = page.locator('[data-testid="cluster-list"]');
    await expect(clusterList).toBeVisible();
    
    // 截图记录
    await takeScreenshot(page, 'connect-flow-cluster-list');
  });

  test('应该能够选择集群', async ({ page }) => {
    // 点击集群切换器
    const clusterSwitcher = page.locator('[data-testid="cluster-switcher"]');
    await clusterSwitcher.click();
    
    // 选择第一个集群
    const firstCluster = page.locator('[data-testid="cluster-item"]').first();
    const clusterName = await firstCluster.innerText();
    await firstCluster.click();
    
    // 验证集群已选择
    await expect(clusterSwitcher).toContainText(clusterName);
    
    // 截图记录
    await takeScreenshot(page, 'connect-flow-cluster-selected');
  });

  test('应该显示连接状态', async ({ page }) => {
    // 检查连接状态指示器
    const connectionStatus = page.locator('[data-testid="connection-status"]');
    await expect(connectionStatus).toBeVisible();
    
    // 验证状态文本
    const statusText = await connectionStatus.innerText();
    expect(statusText).toMatch(/(connected|disconnected|connecting)/i);
    
    // 截图记录
    await takeScreenshot(page, 'connect-flow-connection-status');
  });

  test('应该能够连接到集群', async ({ page }) => {
    // 点击连接按钮（如果存在）
    const connectButton = page.locator('[data-testid="connect-button"]');
    if (await connectButton.isVisible()) {
      await connectButton.click();
      
      // 等待连接完成
      await page.waitForTimeout(2000);
      
      // 验证连接成功
      const connectionStatus = page.locator('[data-testid="connection-status"]');
      const statusText = await connectionStatus.innerText();
      expect(statusText).toMatch(/connected/i);
    }
    
    // 截图记录
    await takeScreenshot(page, 'connect-flow-connected');
  });

  test('应该显示资源列表', async ({ page }) => {
    // 等待资源表格加载
    const resourceTable = page.locator('[data-testid="resource-table"]');
    await expect(resourceTable).toBeVisible({ timeout: 30000 });
    
    // 验证表格有内容
    const rows = page.locator('[data-testid="table-row"]');
    const rowCount = await rows.count();
    
    // 截图记录
    await takeScreenshot(page, 'connect-flow-resource-list');
    
    // 如果有数据，验证表格结构
    if (rowCount > 0) {
      // 验证表头存在
      const headers = page.locator('[data-testid="table-header"]');
      await expect(headers).toBeVisible();
      
      // 验证第一行可点击
      const firstRow = rows.first();
      await expect(firstRow).toBeVisible();
    }
  });

  test('应该能够切换命名空间', async ({ page }) => {
    // 点击命名空间选择器
    const namespaceSelector = page.locator('[data-testid="namespace-selector"]');
    await namespaceSelector.click();
    
    // 选择不同的命名空间
    const namespaceOptions = page.locator('[data-testid="namespace-option"]');
    const optionCount = await namespaceOptions.count();
    
    if (optionCount > 1) {
      // 选择第二个命名空间
      const secondOption = namespaceOptions.nth(1);
      const namespaceName = await secondOption.innerText();
      await secondOption.click();
      
      // 验证命名空间已切换
      await expect(namespaceSelector).toContainText(namespaceName);
      
      // 等待表格刷新
      await page.waitForTimeout(1000);
    }
    
    // 截图记录
    await takeScreenshot(page, 'connect-flow-namespace-switch');
  });

  test('应该能够刷新资源列表', async ({ page }) => {
    // 点击刷新按钮
    const refreshButton = page.locator('[data-testid="refresh-button"]');
    await refreshButton.click();
    
    // 等待刷新完成
    await page.waitForTimeout(2000);
    
    // 验证表格仍然可见
    const resourceTable = page.locator('[data-testid="resource-table"]');
    await expect(resourceTable).toBeVisible();
    
    // 截图记录
    await takeScreenshot(page, 'connect-flow-refresh');
  });

  test('应该能够打开设置面板', async ({ page }) => {
    // 点击设置按钮
    const settingsButton = page.locator('[data-testid="settings-button"]');
    await settingsButton.click();
    
    // 验证设置面板可见
    const settingsPanel = page.locator('[data-testid="settings-panel"]');
    await expect(settingsPanel).toBeVisible({ timeout: 5000 });
    
    // 截图记录
    await takeScreenshot(page, 'connect-flow-settings');
    
    // 关闭设置面板
    const closeButton = page.locator('[data-testid="close-settings"]');
    await closeButton.click();
    
    // 验证设置面板已关闭
    await expect(settingsPanel).toBeHidden();
  });

  test('应该能够使用命令面板', async ({ page }) => {
    // 使用快捷键打开命令面板
    await page.keyboard.press('Meta+k');
    
    // 验证命令面板可见
    const commandPalette = page.locator('[data-testid="command-palette"]');
    await expect(commandPalette).toBeVisible({ timeout: 5000 });
    
    // 截图记录
    await takeScreenshot(page, 'connect-flow-command-palette');
    
    // 关闭命令面板
    await page.keyboard.press('Escape');
    
    // 验证命令面板已关闭
    await expect(commandPalette).toBeHidden();
  });

  test('应该能够断开连接', async ({ page }) => {
    // 查找断开连接按钮
    const disconnectButton = page.locator('[data-testid="disconnect-button"]');
    
    // 如果断开按钮可见，测试断开功能
    if (await disconnectButton.isVisible()) {
      await disconnectButton.click();
      
      // 等待断开完成
      await page.waitForTimeout(2000);
      
      // 验证连接状态
      const connectionStatus = page.locator('[data-testid="connection-status"]');
      const statusText = await connectionStatus.innerText();
      expect(statusText).toMatch(/disconnected/i);
    }
    
    // 截图记录
    await takeScreenshot(page, 'connect-flow-disconnected');
  });
});
