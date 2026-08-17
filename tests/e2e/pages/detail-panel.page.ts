import { type Page, type Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * DetailPanel 页面对象模型
 * 
 * 处理详情面板的交互操作
 */
export class DetailPanelPage extends BasePage {
  // 详情面板容器
  readonly panel: Locator;
  
  // 面板头部
  readonly header: Locator;
  
  // 资源名称
  readonly resourceName: Locator;
  
  // 关闭按钮
  readonly closeButton: Locator;
  
  // Tab 标签
  readonly tabs: Locator;
  
  // Tab 内容
  readonly tabContent: Locator;

  constructor(page: Page) {
    super(page);
    
    // 初始化定位器
    this.panel = page.locator('[data-testid="detail-panel"]');
    this.header = page.locator('[data-testid="detail-header"]');
    this.resourceName = page.locator('[data-testid="resource-name"]');
    this.closeButton = page.locator('[data-testid="close-panel"]');
    this.tabs = page.locator('[data-testid="detail-tab"]');
    this.tabContent = page.locator('[data-testid="tab-content"]');
  }

  /**
   * 等待详情面板加载完成
   */
  async waitForLoad() {
    await this.panel.waitFor({ state: 'visible' });
    await this.header.waitFor({ state: 'visible' });
  }

  /**
   * 关闭详情面板
   */
  async close() {
    await this.closeButton.click();
  }

  /**
   * 点击 Tab 标签
   */
  async clickTab(tabName: string) {
    await this.tabs.filter({ hasText: tabName }).click();
  }

  /**
   * 获取资源名称
   */
  async getResourceName(): Promise<string> {
    return await this.resourceName.innerText();
  }

  /**
   * 获取所有 Tab 名称
   */
  async getTabNames(): Promise<string[]> {
    return await this.tabs.allTextContents();
  }

  /**
   * 获取当前激活的 Tab
   */
  async getActiveTab(): Promise<string> {
    const activeTab = this.tabs.locator('.active, [aria-selected="true"]');
    return await activeTab.innerText();
  }

  /**
   * 检查面板是否可见
   */
  async isVisible(): Promise<boolean> {
    return await this.panel.isVisible();
  }

  /**
   * 断言面板可见
   */
  async expectVisible() {
    await expect(this.panel).toBeVisible();
  }

  /**
   * 断言面板不可见
   */
  async expectHidden() {
    await expect(this.panel).toBeHidden();
  }

  /**
   * 断言资源名称
   */
  async expectResourceName(name: string) {
    await expect(this.resourceName).toContainText(name);
  }

  /**
   * 断言 Tab 存在
   */
  async expectTabExists(tabName: string) {
    await expect(this.tabs.filter({ hasText: tabName })).toBeVisible();
  }

  /**
   * 断言 Tab 激活
   */
  async expectTabActive(tabName: string) {
    const tab = this.tabs.filter({ hasText: tabName });
    await expect(tab).toHaveAttribute('aria-selected', 'true');
  }

  /**
   * 断言 Tab 内容包含文本
   */
  async expectTabContentContains(text: string) {
    await expect(this.tabContent).toContainText(text);
  }

  /**
   * 断言面板标题
   */
  async expectHeader(title: string) {
    await expect(this.header).toContainText(title);
  }

  /**
   * 获取 Tab 内容
   */
  async getTabContent(): Promise<string> {
    return await this.tabContent.innerText();
  }

  /**
   * 检查 Tab 是否激活
   */
  async isTabActive(tabName: string): Promise<boolean> {
    const tab = this.tabs.filter({ hasText: tabName });
    const ariaSelected = await tab.getAttribute('aria-selected');
    return ariaSelected === 'true';
  }

  /**
   * 获取面板宽度
   */
  async getWidth(): Promise<number> {
    const box = await this.panel.boundingBox();
    return box?.width || 0;
  }

  /**
   * 获取面板高度
   */
  async getHeight(): Promise<number> {
    const box = await this.panel.boundingBox();
    return box?.height || 0;
  }

  /**
   * 拖动面板边缘调整大小
   */
  async resize(width: number) {
    const box = await this.panel.boundingBox();
    if (!box) return;
    
    const startX = box.x + box.width;
    const startY = box.y + box.height / 2;
    const endX = startX + (width - box.width);
    
    await this.page.mouse.move(startX, startY);
    await this.page.mouse.down();
    await this.page.mouse.move(endX, startY, { steps: 10 });
    await this.page.mouse.up();
  }
}
