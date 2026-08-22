import { type Page, type Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * ResourceTable 页面对象模型
 * 
 * 处理资源表格的交互操作
 */
export class ResourceTablePage extends BasePage {
  // 表格容器
  readonly table: Locator;
  
  // 表头
  readonly headers: Locator;
  
  // 表格行
  readonly rows: Locator;
  
  // 加载状态
  readonly loading: Locator;
  
  // 空状态
  readonly emptyState: Locator;
  
  // 错误状态
  readonly errorState: Locator;

  constructor(page: Page) {
    super(page);
    
    // 初始化定位器
    this.table = page.locator('[data-testid="resource-table"]');
    this.headers = page.locator('[data-testid="table-header"]');
    this.rows = page.locator('[data-testid="table-row"]');
    this.loading = page.locator('[data-testid="table-loading"]');
    this.emptyState = page.locator('[data-testid="table-empty"]');
    this.errorState = page.locator('[data-testid="table-error"]');
  }

  /**
   * 等待表格加载完成
   */
  async waitForLoad() {
    await this.table.waitFor({ state: 'visible' });
    // 等待加载状态消失
    await this.loading.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
  }

  /**
   * 获取表格行数
   */
  async getRowCount(): Promise<number> {
    return await this.rows.count();
  }

  /**
   * 点击指定行
   */
  async clickRow(index: number) {
    await this.rows.nth(index).click();
  }

  /**
   * 点击包含指定文本的行
   */
  async clickRowByText(text: string) {
    await this.rows.filter({ hasText: text }).click();
  }

  /**
   * 获取指定行的文本内容
   */
  async getRowText(index: number): Promise<string> {
    return await this.rows.nth(index).innerText();
  }

  /**
   * 获取所有行的文本内容
   */
  async getAllRowTexts(): Promise<string[]> {
    return await this.rows.allTextContents();
  }

  /**
   * 获取表头文本
   */
  async getHeaderNames(): Promise<string[]> {
    return await this.headers.allTextContents();
  }

  /**
   * 检查表格是否为空
   */
  async isEmpty(): Promise<boolean> {
    return await this.emptyState.isVisible();
  }

  /**
   * 检查是否有错误
   */
  async hasError(): Promise<boolean> {
    return await this.errorState.isVisible();
  }

  /**
   * 获取错误信息
   */
  async getErrorMessage(): Promise<string> {
    return await this.errorState.innerText();
  }

  /**
   * 排序表格
   */
  async sortByColumn(columnName: string) {
    await this.headers.filter({ hasText: columnName }).click();
  }

  /**
   * 搜索资源
   */
  async search(query: string) {
    const searchInput = this.page.locator('[data-testid="table-search"]');
    await searchInput.fill(query);
  }

  /**
   * 断言表格行数
   */
  async expectRowCount(count: number) {
    await expect(this.rows).toHaveCount(count);
  }

  /**
   * 断言表格包含文本
   */
  async expectTableContains(text: string) {
    await expect(this.table).toContainText(text);
  }

  /**
   * 断言表格为空
   */
  async expectEmpty() {
    await expect(this.emptyState).toBeVisible();
  }

  /**
   * 断言表格有错误
   */
  async expectError(message?: string) {
    await expect(this.errorState).toBeVisible();
    if (message) {
      await expect(this.errorState).toContainText(message);
    }
  }

  /**
   * 断言表格加载中
   */
  async expectLoading() {
    await expect(this.loading).toBeVisible();
  }

  /**
   * 断言表格未加载
   */
  async expectNotLoading() {
    await expect(this.loading).toBeHidden();
  }

  /**
   * 断言行包含文本
   */
  async expectRowContainsText(index: number, text: string) {
    await expect(this.rows.nth(index)).toContainText(text);
  }

  /**
   * 断言表头包含文本
   */
  async expectHeaderContains(text: string) {
    await expect(this.headers).toContainText(text);
  }
}
