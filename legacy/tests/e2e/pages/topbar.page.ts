import { type Page, type Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * TopBar 页面对象模型
 * 
 * 处理顶部工具栏的交互操作
 */
export class TopBarPage extends BasePage {
  // 顶部工具栏容器
  readonly topBar: Locator;
  
  // 命名空间选择器
  readonly namespaceSelector: Locator;
  
  // 刷新按钮
  readonly refreshButton: Locator;
  
  // 设置按钮
  readonly settingsButton: Locator;

  constructor(page: Page) {
    super(page);
    
    // 初始化定位器
    this.topBar = page.locator('[data-testid="topbar"]');
    this.namespaceSelector = page.locator('[data-testid="namespace-selector"]');
    this.refreshButton = page.locator('[data-testid="refresh-button"]');
    this.settingsButton = page.locator('[data-testid="settings-button"]');
  }

  /**
   * 等待顶部工具栏加载完成
   */
  async waitForLoad() {
    await this.topBar.waitFor({ state: 'visible' });
  }

  /**
   * 选择命名空间
   */
  async selectNamespace(namespace: string) {
    await this.namespaceSelector.click();
    await this.page.getByText(namespace).click();
  }

  /**
   * 获取当前命名空间
   */
  async getCurrentNamespace(): Promise<string> {
    return await this.namespaceSelector.innerText();
  }

  /**
   * 点击刷新按钮
   */
  async clickRefresh() {
    await this.refreshButton.click();
  }

  /**
   * 点击设置按钮
   */
  async clickSettings() {
    await this.settingsButton.click();
  }

  /**
   * 断言命名空间已选择
   */
  async expectNamespaceSelected(namespace: string) {
    await expect(this.namespaceSelector).toContainText(namespace);
  }

  /**
   * 断言刷新按钮可见
   */
  async expectRefreshButtonVisible() {
    await expect(this.refreshButton).toBeVisible();
  }

  /**
   * 断言设置按钮可见
   */
  async expectSettingsButtonVisible() {
    await expect(this.settingsButton).toBeVisible();
  }
}
