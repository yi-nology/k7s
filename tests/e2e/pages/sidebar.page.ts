import { type Page, type Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * Sidebar 页面对象模型
 * 
 * 处理侧边栏的交互操作
 */
export class SidebarPage extends BasePage {
  // 侧边栏容器
  readonly sidebar: Locator;
  
  // 导航项
  readonly navItems: Locator;
  
  // 集群切换器
  readonly clusterSwitcher: Locator;
  
  // 底部状态栏
  readonly footer: Locator;

  constructor(page: Page) {
    super(page);
    
    // 初始化定位器
    this.sidebar = page.locator('[data-testid="sidebar"]');
    this.navItems = page.locator('[data-testid="nav-item"]');
    this.clusterSwitcher = page.locator('[data-testid="cluster-switcher"]');
    this.footer = page.locator('[data-testid="sidebar-footer"]');
  }

  /**
   * 等待侧边栏加载完成
   */
  async waitForLoad() {
    await this.sidebar.waitFor({ state: 'visible' });
    await this.navItems.first().waitFor({ state: 'visible' });
  }

  /**
   * 点击导航项
   */
  async clickNavItem(name: string) {
    await this.navItems.filter({ hasText: name }).click();
  }

  /**
   * 获取所有导航项名称
   */
  async getNavItemNames(): Promise<string[]> {
    return await this.navItems.allTextContents();
  }

  /**
   * 检查导航项是否激活
   */
  async isNavItemActive(name: string): Promise<boolean> {
    const item = this.navItems.filter({ hasText: name });
    const classList = await item.getAttribute('class') || '';
    return classList.includes('active') || classList.includes('selected');
  }

  /**
   * 切换集群
   */
  async switchCluster(clusterName: string) {
    await this.clusterSwitcher.click();
    await this.page.getByText(clusterName).click();
  }

  /**
   * 获取当前集群名称
   */
  async getCurrentCluster(): Promise<string> {
    return await this.clusterSwitcher.innerText();
  }

  /**
   * 断言导航项存在
   */
  async expectNavItemExists(name: string) {
    await expect(this.navItems.filter({ hasText: name })).toBeVisible();
  }

  /**
   * 断言导航项激活
   */
  async expectNavItemActive(name: string) {
    const item = this.navItems.filter({ hasText: name });
    await expect(item).toHaveClass(/active|selected/);
  }

  /**
   * 断言导航项数量
   */
  async expectNavItemCount(count: number) {
    await expect(this.navItems).toHaveCount(count);
  }

  /**
   * 断言当前集群
   */
  async expectCurrentCluster(clusterName: string) {
    await expect(this.clusterSwitcher).toContainText(clusterName);
  }
}
